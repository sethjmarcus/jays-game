/* ---------------- Solver (iterative backtracking, no recursion) ---------------- */

const MOVES = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [2, -2], [-2, 2], [-2, -2]];
const MAXD = 8;                                   // at most 8 moves from any square

// Neighbour table as flat typed arrays: neighbours of cell c are
// nb[c*8 .. c*8 + nbLen[c] - 1].
function buildNeighbors(n) {
  const N = n * n, nb = new Int16Array(N * MAXD), nbLen = new Uint8Array(N);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    for (const [dr, dc] of MOVES) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) nb[i * MAXD + nbLen[i]++] = rr * n + cc;
    }
  }
  return { nb, nbLen };
}

// The 8 rotations/reflections of the square, as cell-index permutations,
// plus each one's inverse.
function symmetryMaps(n) {
  const N = n * n, maps = [], invs = [];
  for (let t = 0; t < 8; t++) {
    const m = new Int16Array(N), inv = new Int16Array(N);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      let rr = r, cc = c;
      if (t & 4) [rr, cc] = [cc, rr];
      if (t & 1) rr = n - 1 - rr;
      if (t & 2) cc = n - 1 - cc;
      m[r * n + c] = rr * n + cc;
      inv[rr * n + cc] = r * n + c;
    }
    maps.push(m); invs.push(inv);
  }
  return { maps, invs };
}

// Canonical form of a solution: the lexicographically smallest of its
// variants under the 8 symmetries x 2 directions (and, for loops, any
// starting point). Variants are compared element by element straight from
// the path, stopping at the first difference, so no copies are built;
// only the winner is turned into a key (one character per cell).
function canonicalKey(path, sym, closed, posOf) {
  const N = path.length;
  let bM = null, bS = 0, bD = 0;                  // best: map, start index, direction
  for (let t = 0; t < 8; t++) {
    const m = sym.maps[t];
    for (const d of [1, -1]) {
      // where the variant starts: for a loop, at the square that maps to cell 0
      // (the smallest rotation must start there); otherwise at an end.
      const s = closed ? posOf[sym.invs[t][0]] : (d === 1 ? 0 : N - 1);
      if (bM !== null) {
        let cmp = 0;
        for (let i = 0, a = s, b = bS; i < N; i++) {
          const x = m[path[a]], y = bM[path[b]];
          if (x !== y) { cmp = x - y; break; }
          a += d; if (a === N) a = 0; else if (a < 0) a = N - 1;
          b += bD; if (b === N) b = 0; else if (b < 0) b = N - 1;
        }
        if (cmp >= 0) continue;
      }
      bM = m; bS = s; bD = d;
    }
  }
  const out = new Array(N);
  for (let i = 0, a = bS; i < N; i++) {
    out[i] = bM[path[a]];
    a += bD; if (a === N) a = 0; else if (a < 0) a = N - 1;
  }
  return String.fromCharCode(...out);
}

// Build a solver whose run(budget) does at most `budget` moves, then returns,
// so the page stays responsive. Possible only because the search is iterative.
// All search state lives in preallocated typed arrays: nothing is allocated
// per move.
function makeSolver(n, { want, loopsOnly, forcedStart }) {
  const N = n * n;
  const { nb, nbLen } = buildNeighbors(n);
  const sym = symmetryMaps(n);

  // Symmetry breaking for loops. Every loop passes through A1 and uses exactly
  // two of A1's three jumps: D1, A4, C3. Reversing the loop swaps its two ends,
  // and mirroring along the A1-J10 diagonal swaps D1 and A4, so every loop has
  // an equivalent that goes A1 -> D1 first. Searching only those, and closing
  // only through A4 or C3, skips the copies that the duplicate check would
  // discard anyway (each loop was otherwise found up to 16 times).
  const D1 = 3, A4 = 3 * n, C3 = 2 * n + 2;
  const breakLoops = loopsOnly && forcedStart == null;

  // Orbit of each cell under the 8 symmetries: the smallest cell it maps to.
  // Used to skip open paths whose reversal is found from the other end.
  const orbit = new Int16Array(N);
  for (let c = 0; c < N; c++) {
    let o = c;
    for (const m of sym.maps) if (m[c] < o) o = m[c];
    orbit[c] = o;
  }

  let starts;
  if (forcedStart != null) starts = [forcedStart];
  else if (loopsOnly) starts = [0];                    // every loop passes through A1
  else { starts = []; const h = Math.ceil(n / 2);      // one 1/8 wedge is enough
         for (let r = 0; r < h; r++) for (let c = r; c < h; c++) starts.push(r * n + c); }

  const visited = new Uint8Array(N);
  const freeDeg = new Int8Array(N);                    // unvisited neighbours per cell
  for (let c = 0; c < N; c++) freeDeg[c] = nbLen[c];
  const isClose = new Uint8Array(N);                   // squares allowed to jump back to the start
  const path = new Int16Array(N);
  const PathArray = N <= 256 ? Uint8Array : Int16Array;  // compact storage for found solutions
  const posOf = new Int16Array(N);
  const cand = new Int16Array(N * MAXD);               // candidate moves, 8 slots per depth
  const candKey = new Int8Array(MAXD);
  const candLen = new Uint8Array(N + 1);
  const candIdx = new Uint8Array(N + 1);
  let len = 0, startIdx = -1, done = false, nodes = 0, closeOpen = 0;
  const found = new Map();
  let fresh = [];                                      // solutions not yet handed to the page

  function mark(c) {
    visited[c] = 1;
    if (isClose[c]) closeOpen--;
    const b = c * MAXD, e = b + nbLen[c];
    for (let k = b; k < e; k++) freeDeg[nb[k]]--;
  }
  function unmark(c) {
    visited[c] = 0;
    if (isClose[c]) closeOpen++;
    const b = c * MAXD, e = b + nbLen[c];
    for (let k = b; k < e; k++) freeDeg[nb[k]]++;
  }

  // Fill cand[] for the move after path[len-1], best first (Warnsdorff:
  // fewest onward exits first). Leaves candLen[len] = 0 when the position
  // is already hopeless.
  function fillCandidates() {
    const cell = path[len - 1], base = len * MAXD;
    let k = 0;
    candLen[len] = 0; candIdx[len] = 0;
    const b = cell * MAXD, e = b + nbLen[cell];

    if (loopsOnly) {
      if (len === N - 1) {                             // last square must close the loop
        for (let j = b; j < e; j++) { const x = nb[j]; if (!visited[x] && isClose[x]) cand[base + k++] = x; }
        candLen[len] = k; return;
      }
      if (breakLoops && len === 1) {                   // second square is always D1
        if (!visited[D1] && nb.subarray(b, e).includes(D1)) { cand[base] = D1; candLen[len] = 1; }
        return;
      }
      if (closeOpen === 0) return;                     // no way left to close the loop
      for (let j = b; j < e; j++) {
        const x = nb[j];
        if (visited[x]) continue;
        const key = freeDeg[x] + isClose[x];           // a closing square has one extra exit
        if (key === 0) return;                         // a square with no way out: dead end
        let p = k++;                                   // insertion sort by key (at most 8 items)
        while (p > 0 && candKey[p - 1] > key) { cand[base + p] = cand[base + p - 1]; candKey[p] = candKey[p - 1]; p--; }
        cand[base + p] = x; candKey[p] = key;
      }
      candLen[len] = k; return;
    }

    let forced = 0;
    for (let j = b; j < e; j++) {
      const x = nb[j];
      if (visited[x]) continue;
      const key = freeDeg[x];
      if (key === 0) forced++;
      let p = k++;
      while (p > 0 && candKey[p - 1] > key) { cand[base + p] = cand[base + p - 1]; candKey[p] = candKey[p - 1]; p--; }
      cand[base + p] = x; candKey[p] = key;
    }
    // A neighbour with no other exit has to be the very last square.
    if (len < N - 1 && (forced > 1 || (forced === 1 && len + 1 < N - 1))) return;
    candLen[len] = k;
  }

  function nextStart() {
    while (len) unmark(path[--len]);
    startIdx++;
    if (startIdx >= starts.length) { done = true; return; }
    const s = starts[startIdx];
    isClose.fill(0);
    if (breakLoops) { isClose[A4] = 1; isClose[C3] = 1; }
    else { const b = s * MAXD; for (let j = b; j < b + nbLen[s]; j++) isClose[nb[j]] = 1; }
    closeOpen = 0;
    for (let c = 0; c < N; c++) closeOpen += isClose[c];
    path[len++] = s; mark(s);
    fillCandidates();
  }
  nextStart();

  function record() {
    const closed = isClose[path[N - 1]] === 1;      // can the last square jump back to the start?
    if (!closed && loopsOnly) return;
    // An open path whose far end lies in an earlier orbit is also found,
    // reversed, from that end's start square, so skip it here.
    if (!closed && forcedStart == null && orbit[path[N - 1]] < orbit[path[0]]) return;
    for (let i = 0; i < N; i++) posOf[path[i]] = i;
    const key = canonicalKey(path, sym, closed, posOf);
    if (!found.has(key)) {
      const sol = { path: PathArray.from(path), closed };   // 1 byte per square on boards up to 16x16
      found.set(key, sol);
      fresh.push(sol);
    }
  }

  // Run at most `budget` moves. Returns only the solutions found since the
  // previous call, so the page never re-copies the whole list.
  function run(budget) {
    while (!done && budget > 0) {
      if (found.size >= want) { done = true; break; }
      if (len === 0) { nextStart(); continue; }
      const L = len;
      if (candIdx[L] >= candLen[L]) {                  // level exhausted: backtrack
        unmark(path[--len]);
        if (len === 0) nextStart();
        continue;
      }
      const nxt = cand[L * MAXD + candIdx[L]++];
      if (visited[nxt]) continue;
      budget--; nodes++;
      path[len++] = nxt; mark(nxt);
      if (len === N) { record(); unmark(path[--len]); continue; }
      fillCandidates();
    }
    const out = fresh; fresh = [];
    return { done, nodes, total: found.size, newSolutions: out };
  }
  return { run };
}

/* ---------------- UI ---------------- */

const $ = id => document.getElementById(id);
for (let s = 4; s <= 12; s++) $("size").add(new Option(`${s} × ${s}`, s, s === 10, s === 10));

let solutions = [], current = 0, boardN = 10, running = false, stopFlag = false, animTimer = null;

const cellName = (i, n) => String.fromCharCode(65 + (i % n)) + (Math.floor(i / n) + 1);
// Limits are enforced here in code, not just by the HTML min/max attributes,
// which a user can edit or bypass in dev tools. Invalid input is rejected with
// a message; nothing is silently replaced with a default.
const LIMITS = { size: [4, 12], count: [1, 100000], seconds: [1, 600] };
const fmt = x => x.toLocaleString("en-US");

// Strict whole number in [lo, hi]: digits only, so "", "abc", "1.5", "-3",
// "1e5" and "  " are all rejected.
function readInt(el, label, [lo, hi]) {
  const raw = String(el.value).trim();
  if (el.validity && el.validity.badInput) throw new FieldError(el, `${label} must be a number.`);
  if (raw === "") throw new FieldError(el, `${label} is required.`);
  if (!/^\d+$/.test(raw)) throw new FieldError(el, `${label} must be a whole number from ${fmt(lo)} to ${fmt(hi)}.`);
  const v = Number(raw);
  if (v < lo || v > hi) throw new FieldError(el, `${label} must be from ${fmt(lo)} to ${fmt(hi)} (got ${fmt(v)}).`);
  return v;
}

class FieldError extends Error {
  constructor(el, msg) { super(msg); this.el = el; }
}

function parseCell(t, n) {
  t = String(t).trim().toUpperCase();
  if (!t) return null;
  const m = /^([A-Z])(\d{1,2})$/.exec(t);          // exactly: one letter + 1–2 digits
  const c = m ? m[1].charCodeAt(0) - 65 : -1, r = m ? +m[2] - 1 : -1;
  if (!(c >= 0 && c < n && r >= 0 && r < n)) {
    const last = String.fromCharCode(64 + n) + n;
    throw new FieldError($("start"), `Start square must be a square from A1 to ${last}, like C4.`);
  }
  return r * n + c;
}

const FIELDS = ["size", "count", "seconds", "start"];
function showErrors(errs) {
  for (const id of FIELDS) { $(id).classList.remove("invalid"); $(id).removeAttribute("aria-invalid"); }
  let box = $("errors");
  if (!box) {                       // works even with an index.html that lacks the box
    box = document.createElement("ul");
    box.id = "errors"; box.className = "errors"; box.setAttribute("role", "alert");
    $("go").before(box);
  }
  box.replaceChildren();
  box.hidden = errs.length === 0;
  for (const e of errs) {
    const li = document.createElement("li");
    li.textContent = e.message;
    box.append(li);
    if (e.el) { e.el.classList.add("invalid"); e.el.setAttribute("aria-invalid", "true"); }
  }
  if (errs.length && errs[0].el) errs[0].el.focus();
}
// clear a field's highlight as soon as the user edits it
for (const id of FIELDS) $(id).addEventListener("input", () => {
  $(id).classList.remove("invalid"); $(id).removeAttribute("aria-invalid");
});

// Read and check every input; returns the settings, or null after showing errors.
function readSettings() {
  const errs = [];
  const attempt = f => { try { return f(); } catch (e) { errs.push(e); return undefined; } };
  const n = attempt(() => readInt($("size"), "Board size", LIMITS.size));
  const want = attempt(() => readInt($("count"), "Solutions to find", LIMITS.count));
  const secs = attempt(() => readInt($("seconds"), "Time limit", LIMITS.seconds));
  const forcedStart = n === undefined ? undefined : attempt(() => parseCell($("start").value, n));
  showErrors(errs);
  return errs.length ? null : { n, want, secs, forcedStart };
}

function setRunning(on) {
  running = on;
  $("go").hidden = on;
  $("stop").hidden = !on;
}

$("go").onclick = () => {
  if (running) return;
  const settings = readSettings();
  if (!settings) { $("status").textContent = ""; return; }   // errors are shown; don't run
  const { n, want, secs, forcedStart } = settings;
  const deadline = performance.now() + 1000 * secs;
  const solver = makeSolver(n, { want, loopsOnly: $("loops").checked, forcedStart });
  boardN = n; solutions = []; current = 0; stopFlag = false;
  setRunning(true);
  const t0 = performance.now();

  (function tick() {
    const res = solver.run(20000);
    const prevCount = solutions.length;
    for (const s of res.newSolutions) solutions.push(s);   // only the new ones, no re-copying
    if (prevCount === 0 && solutions.length) { current = 0; render(); }
    else updateNav();
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const timedOut = performance.now() > deadline;
    if (res.done || stopFlag || timedOut) {
      setRunning(false);
      const why = res.done ? (solutions.length >= want ? "" : " · searched everything")
        : stopFlag ? " · stopped" : " · time limit reached";
      $("status").textContent =
        `${solutions.length} distinct solution(s) · ${res.nodes.toLocaleString()} moves · ${secs}s${why}`;
      if (!solutions.length) render();
      return;
    }
    $("status").textContent = `Searching… ${solutions.length} found · ${res.nodes.toLocaleString()} moves · ${secs}s`;
    setTimeout(tick, 0);
  })();
};
$("stop").onclick = () => { stopFlag = true; };

$("prev").onclick = () => { if (current > 0) { current--; render(); } };
$("next").onclick = () => { if (current < solutions.length - 1) { current++; render(); } };
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") $("prev").click();
  if (e.key === "ArrowRight") $("next").click();
});
for (const id of ["showLines", "showNums", "gradient", "showArrows"]) $(id).onchange = () => drawBoard();
$("step").oninput = () => { stopAnim(); drawBoard(); };
$("animate").onclick = () => {
  if (animTimer) { stopAnim(); return; }
  if (!solutions.length) return;
  const total = boardN * boardN;
  let k = 1; $("step").value = 1; $("animate").textContent = "■ Stop";
  animTimer = setInterval(() => {
    k++; $("step").value = k; drawBoard();
    if (k >= total) stopAnim();
  }, Math.max(20, 4000 / total));
  drawBoard();
};
function stopAnim() {
  if (animTimer) clearInterval(animTimer);
  animTimer = null; $("animate").textContent = "▶ Animate path";
}

function updateNav() {
  $("prev").disabled = current <= 0;
  $("next").disabled = current >= solutions.length - 1;
  if (!solutions.length) { $("info").textContent = "No solutions yet"; return; }
  const s = solutions[current], n = boardN, N = n * n;
  // built with DOM nodes + textContent rather than innerHTML, so nothing is parsed as HTML
  const info = $("info");
  info.replaceChildren();
  const title = document.createElement("b");
  title.textContent = `Solution ${current + 1}`;
  const tag = document.createElement("span");
  tag.className = "tag" + (s.closed ? " loop" : "");
  tag.textContent = s.closed ? "closed loop" : "open path";
  const where = document.createElement("span");
  where.className = "where";
  where.textContent = `1 on ${cellName(s.path[0], n)}, ${N} on ${cellName(s.path[N - 1], n)}`;
  info.append(title, ` of ${solutions.length}`, tag, document.createElement("br"), where);
}

function render() {
  stopAnim();
  const N = boardN * boardN;
  $("step").max = N; $("step").value = N;
  updateNav();
  const has = solutions.length > 0;
  $("sliderRow").hidden = !has;
  $("legend").hidden = !has;
  if (!has) { $("boardWrap").innerHTML = `<div class="empty">No solutions found with these settings.</div>`; return; }
  drawBoard();
}

function stepColor(k, N) {               // blue → purple → orange along the path
  const t = (k - 1) / Math.max(1, N - 2);
  return `hsl(${220 - 190 * t} 75% 52%)`;
}

function drawBoard() {
  if (!solutions.length) return;
  const n = boardN, N = n * n, sol = solutions[current];
  const upto = +$("step").value;
  $("stepLabel").textContent = `${upto} / ${N}`;
  const cs = 48, pad = 22, W = n * cs + pad;
  const cx = i => pad + (i % n) * cs + cs / 2;
  const cy = i => (n - 1 - Math.floor(i / n)) * cs + cs / 2;   // row 1 at the bottom
  const num = new Array(N);
  sol.path.forEach((cell, k) => num[cell] = k + 1);

  let s = `<svg viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / n), c = i % n;
    s += `<rect class="cell ${(r + c) % 2 ? "alt" : ""}" x="${pad + c * cs}" y="${(n - 1 - r) * cs}" width="${cs}" height="${cs}"/>`;
  }
  for (let c = 0; c < n; c++) s += `<text class="axis" x="${pad + c * cs + cs / 2}" y="${n * cs + pad / 2}">${String.fromCharCode(65 + c)}</text>`;
  for (let r = 0; r < n; r++) s += `<text class="axis" x="${pad / 2}" y="${(n - 1 - r) * cs + cs / 2}">${r + 1}</text>`;

  if ($("showLines").checked) {
    const grad = $("gradient").checked;
    s += `<g stroke-linecap="round" fill="none" opacity="0.85">`;
    for (let k = 1; k < upto; k++) {
      const a = sol.path[k - 1], b = sol.path[k];
      s += `<line x1="${cx(a)}" y1="${cy(a)}" x2="${cx(b)}" y2="${cy(b)}" stroke="${grad ? stepColor(k, N) : "var(--accent)"}" stroke-width="3"/>`;
    }
    if (sol.closed && upto === N) {        // the jump from the last square back to 1
      const a = sol.path[N - 1], b = sol.path[0];
      s += `<line x1="${cx(a)}" y1="${cy(a)}" x2="${cx(b)}" y2="${cy(b)}" stroke="var(--muted)" stroke-width="2.5" stroke-dasharray="5 5"/>`;
    }
    s += `</g>`;
  }

  const first = sol.path[0], last = sol.path[upto - 1];
  s += `<circle cx="${cx(first)}" cy="${cy(first)}" r="${cs * 0.36}" fill="var(--start)" opacity=".9"/>`;
  s += `<circle cx="${cx(last)}" cy="${cy(last)}" r="${cs * 0.36}" fill="var(--end)" opacity=".9"/>`;

  if ($("showNums").checked) {
    const fs = N >= 100 ? 15 : 17;
    for (let i = 0; i < N; i++) {
      const k = num[i], mark = i === first || i === last;
      const cls = "num" + (k > upto ? " hidden-step" : "") + (mark ? " on-marker" : "");
      const halo = $("showLines").checked && !mark ? ` paint-order="stroke" stroke="var(--panel)" stroke-width="4"` : "";
      s += `<text class="${cls}" x="${cx(i)}" y="${cy(i)}" font-size="${fs}"${halo}>${k}</text>`;
    }
  }
  // direction arrows: on each square, a small arrow at the edge facing the next jump
  if ($("showArrows").checked) {
    const grad = $("gradient").checked;
    const L = cs * 0.39, h = cs * 0.13;            // distance from centre, arrow size
    for (let k = 1; k <= N; k++) {
      if (k === N && !sol.closed) break;           // open path: 100 has no next step
      if (k >= upto && !(k === N && upto === N)) break;
      const a = sol.path[k - 1], b = sol.path[k % N];
      const dx = cx(b) - cx(a), dy = cy(b) - cy(a), len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const tx = cx(a) + ux * L, ty = cy(a) + uy * L;       // arrow tip
      const bx = tx - ux * h * 1.6, by = ty - uy * h * 1.6; // base centre
      const pts = `${tx},${ty} ${bx - uy * h},${by + ux * h} ${bx + uy * h},${by - ux * h}`;
      const col = grad ? stepColor(Math.min(k, N - 1), N) : "var(--accent)";
      s += `<polygon points="${pts}" fill="${col}" stroke="var(--panel)" stroke-width="1" stroke-linejoin="round"/>`;
    }
  }

  s += `</svg>`;
  $("boardWrap").innerHTML = s;
}
