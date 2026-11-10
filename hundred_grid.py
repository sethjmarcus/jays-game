#!/usr/bin/env python3
"""
100-square jump puzzle solver (iterative backtracking, no recursion).

Place 1..100 on a 10x10 grid so each next number is reached by:
  * an orthogonal jump of 3 squares  (A1 -> A4, A1 -> D1)
  * a diagonal jump of 2 squares     (A1 -> C3)

Like N-Queens, the search is a depth-first backtrack, but the recursion is
replaced with an explicit stack: one frame per placed number, each frame
holding its ordered candidate moves and the index of the next one to try.

Uniqueness: two boards are considered the same solution if one can be
turned into the other by
  * any of the 8 rotations/reflections of the square,
  * reversing the numbering (k -> 101-k, i.e. walking the path backwards),
  * for closed tours ("loops", where 100 can jump back to 1): shifting the
    starting point anywhere around the loop.
Each solution is reduced to a canonical form and only new canonical forms
are kept.

Note: the total number of solutions is astronomically large, so a complete
enumeration is not feasible. The solver therefore collects distinct
solutions until it reaches --count or --seconds.

Usage examples:
  python3 hundred_grid.py                    # find 1 solution and print it
  python3 hundred_grid.py --count 20         # 20 distinct solutions
  python3 hundred_grid.py --loops --count 5  # only closed tours
  python3 hundred_grid.py --start A1         # force 1 onto A1
  python3 hundred_grid.py --size 5           # other board sizes work too
"""

import argparse
import time

MOVES = [(3, 0), (-3, 0), (0, 3), (0, -3),
         (2, 2), (2, -2), (-2, 2), (-2, -2)]


def build_neighbors(n):
    nbrs = []
    for r in range(n):
        for c in range(n):
            lst = []
            for dr, dc in MOVES:
                rr, cc = r + dr, c + dc
                if 0 <= rr < n and 0 <= cc < n:
                    lst.append(rr * n + cc)
            nbrs.append(lst)
    return nbrs


def symmetry_maps(n):
    """The 8 symmetries of the square, each as a cell-index permutation."""
    maps = []
    for t in range(8):
        m = [0] * (n * n)
        for r in range(n):
            for c in range(n):
                rr, cc = r, c
                if t & 4:
                    rr, cc = cc, rr          # transpose
                if t & 1:
                    rr = n - 1 - rr          # vertical flip
                if t & 2:
                    cc = n - 1 - cc          # horizontal flip
                m[r * n + c] = rr * n + cc
        maps.append(m)
    return maps


def canonical(path, sym_maps, closed):
    """Smallest equivalent path under symmetry, reversal and (if a loop) rotation."""
    best = None
    L = len(path)
    for m in sym_maps:
        p = [m[x] for x in path]
        for seq in (p, p[::-1]):
            if closed:
                for s in range(L):
                    cand = tuple(seq[s:] + seq[:s])
                    if best is None or cand < best:
                        best = cand
            else:
                cand = tuple(seq)
                if best is None or cand < best:
                    best = cand
    return best


def start_cells(n):
    """By symmetry, a start cell only needs to come from one 1/8 wedge."""
    half = (n + 1) // 2
    return [r * n + c for r in range(half) for c in range(r, half)]


def solve(n, want, seconds, loops_only, forced_start):
    N = n * n
    nbrs = build_neighbors(n)
    sym = symmetry_maps(n)
    if forced_start is not None:
        starts = [forced_start]
    elif loops_only:
        starts = [0]                # every loop passes through A1, so start there
    else:
        starts = start_cells(n)

    found = {}                      # canonical form -> (path, closed)
    deadline = time.time() + seconds
    nodes = 0

    visited = [False] * N
    free_deg = [len(nbrs[i]) for i in range(N)]   # unvisited neighbours per cell

    def mark(cell):
        visited[cell] = True
        for nb in nbrs[cell]:
            free_deg[nb] -= 1

    def unmark(cell):
        visited[cell] = False
        for nb in nbrs[cell]:
            free_deg[nb] += 1

    def ordered_candidates(cell, depth):
        """Warnsdorff ordering: try the most constrained squares first.
        Also prune: an unvisited neighbour with no other exit must be next
        (or be the final square)."""
        cands = [nb for nb in nbrs[cell] if not visited[nb]]
        if loops_only:
            home = path[0]
            if depth == N - 1:
                # the last square must be able to jump back to square 1
                return [nb for nb in cands if nb in home_set]
            if free_deg[home] == 0:
                return []            # no way left to close the loop
            # squares next to 1 get one extra "exit" (the closing jump)
            extra = lambda x: 1 if x in home_set else 0
            forced = [nb for nb in cands if free_deg[nb] + extra(nb) == 0]
            if forced:
                return []
            cands.sort(key=lambda x: free_deg[x] + extra(x))
            return cands
        if depth < N - 1:
            forced = [nb for nb in cands if free_deg[nb] == 0]
            if len(forced) > 1:
                return []            # two dead-end squares: impossible
            if forced and depth + 1 < N - 1:
                return []            # a dead-end square that isn't the last one
        cands.sort(key=lambda x: free_deg[x])
        return cands

    for s in starts:
        if len(found) >= want or time.time() > deadline:
            break

        path = [s]
        home_set = set(nbrs[s])
        mark(s)
        # explicit stack: each frame = [candidate list, next index]
        stack = [[ordered_candidates(s, 1), 0]]

        while stack:
            if len(found) >= want or time.time() > deadline:
                break
            frame = stack[-1]
            cands, i = frame
            if i >= len(cands):
                # exhausted this level: backtrack
                stack.pop()
                unmark(path.pop())
                continue
            frame[1] = i + 1
            nxt = cands[i]
            if visited[nxt]:
                continue

            nodes += 1
            path.append(nxt)
            mark(nxt)

            if len(path) == N:
                closed = path[0] in nbrs[path[-1]]
                if closed or not loops_only:
                    key = canonical(path, sym, closed)
                    if key not in found:
                        found[key] = (list(path), closed)
                unmark(path.pop())
                continue

            stack.append([ordered_candidates(nxt, len(path)), 0])

        # leave the board clean before trying the next start square
        while path:
            unmark(path.pop())

    return list(found.values()), nodes


def cell_name(idx, n):
    r, c = divmod(idx, n)
    return f"{chr(ord('A') + c)}{r + 1}"


def parse_cell(text, n):
    col = ord(text[0].upper()) - ord('A')
    row = int(text[1:]) - 1
    if not (0 <= col < n and 0 <= row < n):
        raise ValueError(f"{text} is off a {n}x{n} board")
    return row * n + col


def render(path, n):
    board = [0] * (n * n)
    for k, cell in enumerate(path, 1):
        board[cell] = k
    w = len(str(n * n))
    lines = []
    for r in range(n - 1, -1, -1):          # row n at top, like a chessboard
        row = " ".join(f"{board[r * n + c]:>{w}}" for c in range(n))
        lines.append(f"{r + 1:>2} | {row}")
    lines.append("   +" + "-" * (n * (w + 1)))
    lines.append("     " + " ".join(f"{chr(ord('A') + c):>{w}}" for c in range(n)))
    return "\n".join(lines)


def verify(path, n):
    nbrs = build_neighbors(n)
    if sorted(path) != list(range(n * n)):
        return False
    return all(path[k + 1] in nbrs[path[k]] for k in range(len(path) - 1))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--size", type=int, default=10)
    ap.add_argument("--count", type=int, default=1, help="distinct solutions to find")
    ap.add_argument("--seconds", type=float, default=60, help="time limit")
    ap.add_argument("--loops", action="store_true", help="only closed tours")
    ap.add_argument("--start", help="force the square for 1, e.g. A1")
    args = ap.parse_args()

    n = args.size
    start = parse_cell(args.start, n) if args.start else None
    t0 = time.time()
    sols, nodes = solve(n, args.count, args.seconds, args.loops, start)
    dt = time.time() - t0

    for k, (path, closed) in enumerate(sols, 1):
        assert verify(path, n)
        kind = "closed loop" if closed else "open path"
        print(f"Solution {k} ({kind}): 1 on {cell_name(path[0], n)}, "
              f"{n * n} on {cell_name(path[-1], n)}")
        print(render(path, n))
        print()

    print(f"{len(sols)} distinct solution(s), {nodes:,} moves tried, {dt:.2f}s")


if __name__ == "__main__":
    main()