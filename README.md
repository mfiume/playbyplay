# ⚾ Bloordale 10U A · Scorekeeper

A dead-simple, **tap-to-score** digital baseball scorecard for the bench. It turns
the paper play-by-play sheet into a phone-friendly app: tap what the batter did,
tap runners to move them around the bases, and the box score, scorecard grid, and
per-inning R/H/E/LOB fill themselves in.

**Live site:** https://mfiume.github.io/playbyplay/

> Built as a sibling to the WalkUp Music app and the Toronto Eagles hub —
> same idea: a static site, auto-deployed to GitHub Pages by a GitHub Action.
> No server, no accounts, no cost.

## Features

- 📋 **Setup** — teams, date, place, and your batting order (drag to reorder, save/load roster)
- ⚾ **Live scoring** — big outcome buttons (1B/2B/3B/HR, BB/HBP/Error/FC, K/Ground/Fly/Pop, Sac, etc.)
- 💎 **Interactive diamond** — tap a runner to advance, steal, score, or call out; runners auto-advance on hits
- 🤖 **Auto stats** — AB, R, H, RBI, SO, BB, SB and per-inning R/H/E/LOB computed for you
- ▦ **Digital scorecard** — the classic grid with mini diamonds, fills in as you score
- 📊 **Box score** — batting totals + pitcher lines (editable)
- ↶ **Undo** any play; ⬇⬆ **export/import** a game as JSON; 🖨 **print** the scorecard
- 📱 **Installable** (PWA) and works offline once loaded; everything saved on-device

## How scoring works (quick guide)

1. **Setup tab** → enter teams + add your lineup → **Start game**.
2. **Score tab** → when you're batting, tap the result. When you're on defense, tap
   *+1 Run allowed* / *Out* to move the game along.
3. Tap any **runner on a base** to advance them, mark a steal, score them, or call them out.
4. RBIs and runs are credited automatically on hits/sacs/forced walks; use the
   stats tab to fine-tune errors and pitcher lines.

## Tech

Pure HTML/CSS/vanilla JS — a single static folder. State lives in `localStorage`.
Deployed by `.github/workflows/deploy.yml` (GitHub Pages). To run locally just open
`index.html`, or serve the folder: `python3 -m http.server`.
