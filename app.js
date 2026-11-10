/* ---------------- Solver (iterative backtracking, no recursion) ---------------- */

const MOVES = [[3,0],[-3,0],[0,3],[0,-3],[2,2],[2,-2],[-2,2],[-2,-2]];

function buildNeighbors(n) {
  const nb = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const list = [];
    for (const [dr, dc] of MOVES) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) list.push(rr * n + cc);
    }
    nb.push(list);
  }
  return nb;
}

// the 8 rotations/reflections of the square, as cell-index permutations
function symmetryMaps(n) {
  const maps = [];
  for (let t = 0; t < 8; t++) {
    const m = new Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      let rr = r, cc = c;
      if (t & 4) [rr, cc] = [cc, rr];
      if (t & 1) rr = n - 1 - rr;
      if (t & 2) cc = n - 1 - cc;
      m[r * n + c] = rr * n + cc;
    }
    maps.push(m);
  }
  return maps;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// canonical form: smallest equivalent under symmetry, reversal and (for loops) rotation
function canonicalKey(path, maps, closed) {
  let best = null;
  const L = path.length;
  for (const m of maps) {
    const p = path.map(x => m[x]);
    for (const seq of [p, p.slice().reverse()]) {
      const shifts = closed ? L : 1;
      for (let s = 0; s < shifts; s++) {
        const cand = s ? seq.slice(s).concat(seq.slice(0, s)) : seq;
        if (best === null || lexLess(cand, best)) best = cand.slice();
      }
    }
  }
  return best.join(",");
}

// Build a solver whose run(budget) does at most `budget` moves, then returns,
// so the page stays responsive. Possible only because the search is iterative.
function makeSolver(n, { want, loopsOnly, forcedStart }) {
  const N = n * n, nbrs = buildNeighbors(n), maps = symmetryMaps(n);
  let starts;
  if (forcedStart != null) starts = [forcedStart];
  else if (loopsOnly) starts = [0];                    // every loop passes through A1
  else { starts = []; const h = Math.ceil(n / 2);      // one 1/8 wedge is enough
         for (let r = 0; r < h; r++) for (let c = r; c < h; c++) starts.push(r * n + c); }

  const visited = new Array(N).fill(false);
  const freeDeg = nbrs.map(l => l.length);
  const found = new Map();
  let path = [], stack = [], startIdx = -1, homeSet = null, done = false, nodes = 0;

  const mark = c => { visited[c] = true;  for (const x of nbrs[c]) freeDeg[x]--; };
  const unmark = c => { visited[c] = false; for (const x of nbrs[c]) freeDeg[x]++; };

  function candidates(cell, depth) {
    let cands = nbrs[cell].filter(x => !visited[x]);
    if (loopsOnly) {
      if (depth === N - 1) return cands.filter(x => homeSet.has(x));
      if (freeDeg[path[0]] === 0) return [];
      const extra = x => homeSet.has(x) ? 1 : 0;
      if (cands.some(x => freeDeg[x] + extra(x) === 0)) return [];
      return cands.sort((a, b) => (freeDeg[a] + extra(a)) - (freeDeg[b] + extra(b)));
    }
    if (depth < N - 1) {
      const forced = cands.filter(x => freeDeg[x] === 0);
      if (forced.length > 1) return [];
      if (forced.length && depth + 1 < N - 1) return [];
    }
    return cands.sort((a, b) => freeDeg[a] - freeDeg[b]);   // Warnsdorff
  }

  function nextStart() {
    while (path.length) unmark(path.pop());
    startIdx++;
    if (startIdx >= starts.length) { done = true; return; }
    const s = starts[startIdx];
    path = [s]; homeSet = new Set(nbrs[s]); mark(s);
    stack = [{ cands: candidates(s, 1), i: 0 }];
  }
  nextStart();

  function run(budget) {
    while (!done && budget > 0) {
      if (found.size >= want) { done = true; break; }
      if (!stack.length) { nextStart(); continue; }
      const f = stack[stack.length - 1];
      if (f.i >= f.cands.length) { stack.pop(); unmark(path.pop()); continue; }
      const nxt = f.cands[f.i++];
      if (visited[nxt]) continue;
      budget--; nodes++;
      path.push(nxt); mark(nxt);
      if (path.length === N) {
        const closed = nbrs[path[N - 1]].includes(path[0]);
        if (closed || !loopsOnly) {
          const key = canonicalKey(path, maps, closed);
          if (!found.has(key)) found.set(key, { path: path.slice(), closed });
        }
        unmark(path.pop());
        continue;
      }
      stack.push({ cands: candidates(nxt, path.length), i: 0 });
    }
    return { done, nodes, solutions: [...found.values()] };
  }
  return { run };
}

/* ---------------- UI ---------------- */

const $ = id => document.getElementById(id);
for (let s = 4; s <= 12; s++) $("size").add(new Option(`${s} × ${s}`, s, s === 10, s === 10));

let solutions = [], current = 0, boardN = 10, running = false, stopFlag = false, animTimer = null;

const cellName = (i, n) => String.fromCharCode(65 + (i % n)) + (Math.floor(i / n) + 1);
function parseCell(t, n) {
  t = t.trim().toUpperCase();
  if (!t) return null;
  const c = t.charCodeAt(0) - 65, r = parseInt(t.slice(1), 10) - 1;
  if (!(c >= 0 && c < n && r >= 0 && r < n)) throw new Error(`"${t}" is not on a ${n}×${n} board`);
  return r * n + c;
}

function setRunning(on) {
  running = on;
  $("go").style.display = on ? "none" : "";
  $("stop").style.display = on ? "" : "none";
}

$("go").onclick = () => {
  const n = +$("size").value;
  let forcedStart;
  try { forcedStart = parseCell($("start").value, n); }
  catch (e) { $("status").textContent = e.message; return; }
  const want = Math.max(1, +$("count").value || 1);
  const deadline = performance.now() + 1000 * Math.max(1, +$("seconds").value || 20);
  const solver = makeSolver(n, { want, loopsOnly: $("loops").checked, forcedStart });
  boardN = n; solutions = []; current = 0; stopFlag = false;
  setRunning(true);
  const t0 = performance.now();

  (function tick() {
    const res = solver.run(20000);
    const prevCount = solutions.length;
    solutions = res.solutions;
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
  $("info").innerHTML = `<b>Solution ${current + 1}</b> of ${solutions.length}` +
    `<span class="tag ${s.closed ? "loop" : ""}">${s.closed ? "closed loop" : "open path"}</span>` +
    `<br><span style="color:var(--muted);font-size:13px">1 on ${cellName(s.path[0], n)}, ${N} on ${cellName(s.path[N - 1], n)}</span>`;
}

function render() {
  stopAnim();
  const N = boardN * boardN;
  $("step").max = N; $("step").value = N;
  updateNav();
  const has = solutions.length > 0;
  $("sliderRow").style.display = has ? "" : "none";
  $("legend").style.display = has ? "" : "none";
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
      const fill = mark ? ` style="fill:#fff"` : "";
      const cls = k > upto ? "num hidden-step" : "num";
      const halo = $("showLines").checked && !mark ? ` paint-order="stroke" stroke="var(--panel)" stroke-width="4"` : "";
      s += `<text class="${cls}" x="${cx(i)}" y="${cy(i)}" font-size="${fs}"${fill}${halo}>${k}</text>`;
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
