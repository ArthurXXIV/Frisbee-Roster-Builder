# Ultimate Roster Builder

A mobile-friendly sideline app for calling ultimate frisbee lines. The coach taps **We scored** / **They scored**; the app works out O vs D, score triggers, half/game point, fatigue, and shows **two ranked 7-player lineups** with every offensive slot (CH, PR, SR, IC, HC, SC, FC) and zone slot (Wall ×2, Mark, Deep, Wing ×2, Sheep) filled.

Spec: [docs/plan.md](docs/plan.md) (v0.2.2) · Agent handoff: [AGENTS.md](AGENTS.md)

## Use it
Open the GitHub Pages URL on a phone → Share → *Add to Home Screen*. Data is saved in that browser (localStorage); use **Export** on the Roster/Stats tabs to back up.

## Roster data
The app ships with a demo roster (`data/sample-roster.json`). To use your own team, tap **Import Excel** on the Roster tab. It reads a sheet with columns like `O`, `O2`, `O3`, `D-Line O`, `Zone D` and `Person D`, the same layout as the coach's sheet. **Export Excel** gives you a full copy to edit and re-import. Export a backup after each tournament, because data is saved only in that browser.

## Run locally
```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
(ES modules don't load from `file://`, so use a local server.)

## Deploy to GitHub Pages
```sh
git init && git add . && git commit -m "Initial roster builder"
git branch -M main
git remote add origin https://github.com/<you>/roster-builder.git
git push -u origin main
```
Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.

## Layout
- `js/roster.js`: default roster from the coach's sheet, role descriptions, default settings
- `js/optimizer.js`: branch-and-bound slot assignment (O points: 7 offensive slots; D points: 7 zone slots plus a check that the same 7 can fill all D-Line O slots after a turn)
- `js/app.js`: UI, game state, stats, export

## How lines are chosen (tunable in Settings)
- O points: O group first → O2 → O3. Up by `restMargin` (3), O gets rested for O2. Up by `blowoutUp` (4), O3 and rookies. Down by `blowoutDown` (4), O3 and "?" slots allowed.
- HC players are the emergency fallback for PR/SR before a slot is flagged empty.
- D points: non-O players. Primary crossovers (Owen, Arone) and situational ones (Aki, Peyton, Jesse) are favored at half point, game point, or with the Big game toggle.
- Fatigue: penalty grows with consecutive points; heavy penalty at `maxConsecutive`.
- Option 2 is pushed to differ from Option 1 by at least 2 players.
