# Jay's Game: 100-Square Jump Puzzle

Fill a 10×10 grid with 1–100 so that each next number is a jump of
3 squares orthogonally or 2 squares diagonally.

- `hundred_grid.py`: command-line solver (iterative backtracking, no recursion,
  duplicates removed under rotation, reflection, reversal and loop rotation).
  Run `python3 hundred_grid.py --help`.
- `site/`: static web app, live at https://jays-game.sethjmarcus.us
  (Cloudflare Pages, build output directory `site`, no build command).
  `site/_headers` sets the security headers.

## How the algorithm works

The board is treated as a graph: each square connects to the squares one legal
jump away (at most 8). A solution is a path that visits every square exactly
once (a Hamiltonian path), and a *loop* is one where 100 can also jump back to 1.

**Search.** Depth-first backtracking, like N-Queens, but with an explicit stack
instead of recursion: one stack level per placed number, each holding its
candidate next squares and which one to try next. When a level runs out of
candidates, the solver un-places that number and steps back.

**Move ordering (Warnsdorff's rule).** Candidates are tried in order of how few
onward exits they have, so squares at risk of being cut off are visited first.
On 10×10 this usually finds a solution with no backtracking at all.

**Pruning.** A branch is abandoned as soon as an unvisited square is left with
no way in or out (unless it can still be the final square). In loop mode, the
search also stops if every square that could jump back to the start is used up.

**Removing duplicates.** Two solutions count as the same if one becomes the
other by any of the 8 rotations/reflections, by reversing the numbering, or (for
loops) by starting at a different point. Each solution is reduced to a canonical
form, the smallest of its variants, and only new forms are kept. The search
also avoids most duplicates up front: open paths start only from one-eighth of
the board, and loops always start at A1 (in the web app, always A1 → D1).

**Cost.** Exponential in the number of squares in the worst case (as with any
Hamiltonian-path search), but in practice each solution costs only tens of
moves for open paths and hundreds to thousands for loops. Working memory is
O(N); stored solutions take about 100 bytes each.

The web app (`site/app.js`) runs the search in batches of 20,000 moves so the
page stays responsive; this is possible because the search is iterative.
