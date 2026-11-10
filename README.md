# Jay's Game: 100-Square Jump Puzzle

Fill a 10×10 grid with 1–100 so that each next number is a jump of
3 squares orthogonally or 2 squares diagonally.

- `hundred_grid.py`: command-line solver (iterative backtracking, no recursion,
  duplicates removed under rotation, reflection, reversal and loop rotation).
  Run `python3 hundred_grid.py --help`.
- `site/`: static web app, live at https://jays-game.sethjmarcus.us
  (Cloudflare Pages, build output directory `site`, no build command).
  `site/_headers` sets the security headers.
