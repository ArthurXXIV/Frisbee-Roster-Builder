# Progress: Roster Builder

**As of:** November 7, 2026 · **Spec:** plan v0.3.1 ([docs/plan.md](docs/plan.md)) · **Agent handoff:** [AGENTS.md](AGENTS.md)

A static web app for GitHub Pages (plain HTML, CSS and JavaScript; no build step, no packages). Run it locally with `python3 -m http.server 8000`.

## Done

### Backend (`js/roster.js`, `js/optimizer.js`)
- [x] **No player data in the code** (v0.3.1). The real 21-player roster is backed up at `private/roster.json` (gitignored, as is `*.xlsx`). The repo ships the team's roster as demo data in `data/sample-roster.json`. Anyone can import their own.
- [x] **Import validation:** `normalizeRoster()` fills in defaults, fixes bad values, skips nameless rows, makes ids unique, and returns warnings.
- [x] **Rookie quick-add** (v0.3.1): `makeProvisional(name)` creates a provisional rookie in O3 with FC (offense), Wing (zone) and Cutter (person D). The starter slots are settings.
- [x] Slot parsing: comma lists, `-` or empty means not eligible, and `?` means last resort.
- [x] **O points:** fills all 7 slots (CH, PR, SR, IC, HC, SC, FC). Tries O first, then O2, then O3. A slot with nobody eligible is flagged as "No X available".
- [x] **HC fallback** (v0.2.1): HC players can fill PR or SR before a slot gets flagged.
- [x] **Role descriptions** for all 7 offensive slots (`ROLES`).
- [x] **Zone D:** fills Wall ×2, Mark, Deep, Wing ×2 and Sheep. It also checks that the same 7 can fill all 7 offensive slots after a turn.
- [x] **Person D** (v0.2.2): 3 handler defenders plus 4 cutter defenders, with Best Players able to fill either side. The D scheme can be `zone`, `person` or `both` (`both` = a zone line that must also work for person D).
- [x] **Score triggers:** rest O at +3. Bring in O3 and rookies at +4. Allow O3 and `?` slots at −4.
- [x] **Crossovers:** Owen and Arone (primary), and Aki, Peyton and Jesse (situational), are favored at half point, game point, or with the big-game toggle.
- [x] **Stamina per player** (v0.3): Best Players can play 5 in a row, everyone else 3, and any player can have their own limit (`maxConsec`). Fatigue ramps up toward each player's own limit, and a player over it drops out of both options.
- [x] **Rest-O trigger counts breaks** (v0.3): up 3+ breaks, with a setting to switch back to point lead.
- [x] **Two ranked options per point,** with Option 2 at least 2 players different from Option 1. Labels read like "Full O", "Core D", "D + Owen crossover" or "Rest A, B · in C, D".
- [x] **Replacement suggestions** for injuries and edits.
- [x] **Speed:** under 15 ms per suggestion, and about 45 ms to simulate a full game to 13.

### Frontend (`index.html`, `css/style.css`, `js/app.js`)
- [x] Scoreboard with chips for next point (O or D), half point, game point and active triggers.
- [x] **Game tab:** pick 1 of 2 lineups, then **We scored** or **They scored**. Next O/D, halftime and the end of the game are worked out automatically.
- [x] On-field view: swap a player through each slot's dropdown, an **Injury** button that suggests a same-slot sub, and **Undo last point**.
- [x] **Roster tab:** edit each player's slots, rookie flag, crossover level and status. Also: role legend, add or remove players, import and export JSON, and reset to the sheet.
- [x] **Stats tab:** O and D points per player, +/−, holds and breaks, point log, and CSV/JSON export.
- [x] **Settings tab:** opponent, game to (11/13/15), who starts on O or D, the big-game toggle, and all trigger thresholds.
- [x] Data saved in the browser (localStorage).
- [x] Redesigned UI: mobile-first, dark mode, and an icon tab bar.
- [x] "HC fallback" tag shown on lineup options.

### Docs and hosting
- [x] `README.md` with local run and GitHub Pages deploy steps, plus a `.nojekyll` file.
- [x] `AGENTS.md`: backend/frontend contract, data model, API, and the requests list.
- [x] `docs/plan.md`: the full v0.3 spec.

## Confirmed behavior (by the user)
- Arone is the main CH on O, so he plays more points than others. That's expected.
- Best Players are expected to play more than others.

## To do

### Frontend (requests in AGENTS.md §7)
- [ ] **R1: person D in the UI.** Add a zone / person / both picker, show HD and CD slots, add a person D role dropdown in the roster editor, and fill in `pd` for rosters saved before this change.
- [ ] **R1 update (v0.3):** the D scheme is a Person / Zone toggle on each D point, with "Both" as a secondary choice.
- [ ] **R2:** keep the `fallback` and `lastResort` tags after a pick so the on-field view shows them.
- [ ] **R4 (v0.3.1):** first-launch "Import roster / Try sample data", import warnings, and "Load sample data" replacing "Reset to sheet". ⚠️ Until this is done, a fresh browser starts with an empty roster.
- [ ] **R5 (v0.3.1):** **+ Rookie** quick-add button, "provisional" tag, and starter-slot settings.
- [ ] **R3:** pass `breakMargin`, add stamina settings and a per-player "max in a row" field, and optionally a "tired" tag.

### Not started
- [ ] Put the project in a git repo and deploy to GitHub Pages (commands in README).
- [ ] Import the roster straight from `For Art.xlsx` or CSV. Today it's a hard-coded default plus JSON import.
- ~~Locking lines or players~~: deferred past v1 (v0.3). The coach edits a pick instead.
- [ ] Phase 1 simulation write-up: games to 11, 13 and 15 with injuries and blowouts both ways.
- [ ] Add last names for Michael, Mikey, Asher and Reeves.
- [ ] Pilot at practice (Phase 3), then performance modeling (Phase 4).

## Open questions for the coach
1. Who are the core 7 on D?
2. What person D role do Mikey, Asher and Christopher have?
3. Vert vs ho each point, and does vert relax the HC requirement?
4. Max in a row for players who aren't Best Players? (3 for now)
5. Rest O at "up 3+ breaks": real breaks or point lead? (Default is breaks.)
6. Rookies: a hard switch at +4, or a gradual phase-in?
