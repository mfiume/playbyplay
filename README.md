# ⚾ Bombers · Play-by-Play

A **tap-to-score** baseball scorecard for the bench. Tap what the batter did and
watch the runners **glide around the bases** on a live diamond — for **both teams**.
The line score, box score, and play-by-play log fill themselves in.

**Live site:** https://mfiume.github.io/playbyplay/

> A static site, auto-deployed to GitHub Pages by a GitHub Action.
> No server, no accounts, no cost.

## What it does

- **Both teams, full play-by-play.** Away bats the top, home bats the bottom; the
  app switches sides automatically on the third out and keeps a separate batting
  order, line score, and box for each.
- **The diamond is the star.** A rendered clay-and-grass field where each runner is
  a numbered token that travels base-to-base along the basepaths. Hits auto-advance
  every runner; a home run trots all the way around.
- **Tap a runner** for quick actions — steal, take a base, score, send back, or out.
- **Big outcome buttons** — 1B/2B/3B/HR · BB/HBP/Error/FC · K/Ground/Fly/Pop · Sac/DP.
- **Auto stats** — AB, R, H, RBI, BB, K per batter; R/H/E by inning on the line score.
  RBIs and runs are credited automatically on hits, sacs, and forced walks.
- **Color-coded** — each team has its own color, and the whole interface tints to
  whoever is batting so you always know whose turn it is.
- **Undo** any play · **export / import** a game as JSON · **installable** PWA that
  works offline; everything is saved on-device.

## How scoring works

1. **Setup** → name both teams (pick their colors), then build each batting order.
   The home order is pre-loaded with the Bombers; tap **Fill 9 spots** for a quick
   away lineup, or add players by hand. **Play ball.**
2. **Game** → tap the result of each plate appearance. Runners advance and the score
   updates with the play.
3. **Tap a runner** on the diamond to steal, advance, score, send back, or call out.
4. **Plays** shows the running log by half-inning; **Box** has the line score and
   batting lines for both teams.

## Tech

Pure HTML / CSS / vanilla JS — a single static folder, no build step. The diamond is
drawn on a `<canvas>`; runners are DOM tokens animated with CSS transitions. State
lives in `localStorage`. Deployed by `.github/workflows/deploy.yml` to GitHub Pages.
To run locally, open `index.html` or serve the folder: `python3 -m http.server`.
