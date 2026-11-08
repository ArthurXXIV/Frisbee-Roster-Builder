# AGENTS.md: Roster Builder

How agents work together on this repo. Read this before editing anything.

- Spec: `docs/plan.md` (plan **v0.3.1**). If code and spec disagree, the spec wins. Flag the gap; don't silently pick one.
- Stack: a static site on GitHub Pages. Plain ES modules with no build step, no npm, no packages. Don't add any without asking the user.
- Run it: `python3 -m http.server 8000` → http://localhost:8000. Modules don't load from `file://`.

## 1. Who owns what

| Area | Owner | Files |
|---|---|---|
| **Backend**: data model, roster data, optimizer, game rules | Backend agent | `js/roster.js`, `js/optimizer.js` |
| **Frontend**: rendering, events, styling, local state and persistence | Frontend agent | `index.html`, `css/style.css`, `js/app.js` |
| Sample data | Backend | `data/sample-roster.json` (the team's roster, used as demo data) |
| Shared docs | Either (keep in sync) | `AGENTS.md`, `README.md`, `progress.md`, `docs/` |

**Sample data = the team's roster, presented as demo data** (user decision, Nov 7 2026). It ships in `data/sample-roster.json`, and anyone can import their own roster over it. Spreadsheets (`*.xlsx`) and `private/` stay gitignored.

Rules:
- **No git actions.** Don't commit, push, branch or change git state. The user handles all git and GitHub work. Read-only `git status` is fine.
- **Don't edit the other side's files.** If you need a backend change, add an item to **§7 Requests** below and stop or stub around it. Small, obviously correct fixes are fine if you note them in §8 Changelog.
- The backend never touches the DOM, `localStorage`, `window` or `document`. It must stay importable in Node (`node file.mjs`) for tests.
- The frontend never decides lineups. It doesn't reorder optimizer output or apply its own eligibility rules. Use `replacements()` for any "who can play here" list.

## 2. Data model (backend-owned, frontend persists)

### Player (`S.roster[]`)
```js
{
  id: 'p0_owensuelflow',   // stable; from withIds(). Never derive from array index after creation.
  name: 'Owen Suelflow',
  o:   'IC, SC, SR',       // O-group offensive slots      ┐ comma-separated slot strings.
  o2:  '',                 // O2-group offensive slots     │ "" or "-" = not eligible.
  o3:  '',                 // O3-group offensive slots     │ trailing "?" = last resort
  dlo: 'CH, IC',           // D-Line O slots (after a turn)│ (e.g. "Sheep?").
  zone:'Deep, Wing',       // zone D slots                 ┘
  pd:  'best',             // person D role: 'best' | 'handler' | 'cutter' | ''  (NEW v0.2.2; '' = none listed → last resort)
  rookie: false,
  cross: 1,                // crossover to D: 0 never, 1 primary (Owen, Arone), 2 situational (Aki, Peyton, Jesse)
  maxConsec: null,         // NEW v0.3: per-player max points in a row; null = default by role (best 5, others 3)
  status: 'available',     // 'available' | 'injured' | 'unavailable'
  notes: '',
  provisional: false       // NEW v0.3.1: true for a rookie quick-add until the coach edits their slots
}
```
- A player is in the **O group** if `o` is non-empty (`isOPlayer(p)`).
- Slot strings stay human-editable text. Use `parseSlots(str)` → `{ SLOT: isLastResort }` and never parse them yourself.
- **Migration:** run every roster that comes from localStorage or an import through `normalizeRoster()`. It fills in missing fields like `pd`, `maxConsec` and `provisional`. `DEFAULT_ROSTER` is empty now, so it can't be used to backfill. If a saved roster lost its `pd` values, re-import `private/roster.json`.

### Constants (`js/roster.js`)
| Export | Value |
|---|---|
| `O_SLOTS` | `['CH','PR','SR','IC','HC','SC','FC']` |
| `ROLES` | `{ CH: 'Center Handler: …', … }`: the role text for tooltips and the legend |
| `HC_FALLBACK_SLOTS` | `['PR','SR']`: HC players may fill these as emergency handlers |
| `ZONE_SLOTS` | `['Wall','Wall','Mark','Deep','Wing','Wing','Sheep']` |
| `PERSON_SLOTS` | `['HD','HD','HD','CD','CD','CD','CD']`: HD = handler defender, CD = cutter defender |
| `PERSON_ROLES` | `['best','handler','cutter','']` |
| `PLAYER_DEFAULTS` | every Player field with its default |
| `normalizeRoster(data)` | `{ roster, warnings }`. Validates an import: fills defaults, trims text, fixes bad `pd`/`status`/`cross`, skips nameless rows, makes ids unique. Throws only if `data` isn't an array. **Show `warnings` to the coach.** |
| `loadSampleRoster()` | async, browser only: fetches `data/sample-roster.json` → normalized `Player[]` |
| `makeProvisional(name, settings, existingIds)` | Rookie quick-add → a Player with `rookie`, `provisional`, O3 + D-Line O = `provisionalOffense`, zone = `provisionalZone`, pd = `provisionalPd` |
| `withIds(r)` | id assigner |
| `DEFAULT_ROSTER` | **deprecated, now `[]`**. Don't use it. |
| `DEFAULT_SETTINGS` | `{ restMargin:3, restBy:'breaks', blowoutUp:4, blowoutDown:4, maxConsecutive:3, maxConsecutiveBest:5, fatigueWeight:1.5, provisionalOffense:'FC', provisionalZone:'Wing', provisionalPd:'cutter' }` |

## 3. Optimizer API (`js/optimizer.js`)

All functions are pure. Pass a fresh **context** each call:

```js
ctx = {
  roster,            // full Player[]; the backend filters out status !== 'available' itself
  settings,          // DEFAULT_SETTINGS shape
  stats,             // playerStats(points)
  mode: 'O' | 'D',   // next point (frontend derives it from who scored and halftime)
  margin,            // us - them
  breakMargin,       // NEW v0.3: gameStats(points).breakMargin. Drives the rest-O trigger. If omitted, falls back to `margin`.
  halfPoint, gamePoint, bigGame,   // booleans (crossover moments)
  dScheme: 'zone' | 'person' | 'both'   // D points only. v0.3: the coach calls person or zone each D point; 'both' is available but not the default.
}
```

| Function | Returns | Notes |
|---|---|---|
| `suggest(ctx)` | `Lineup[]` (0–2) | Ranked. `[0]` is best. Option 2 differs from option 1 by ≥2 players when possible. |
| `replacements(ctx, slot, excludeIds)` | `Edge[]` sorted best first | For injury subs and edit dropdowns. `slot` is an O slot, zone slot or `HD`/`CD`, depending on mode and scheme. |
| `playerStats(points)` | `{ total:{id:n}, consec:{id:n} }` | `points[].players` = id arrays. |
| `flags(ctx)` | `{ win, lose, rest }` | Trigger booleans for the scoreboard chips. `rest` = up `restMargin`+ **breaks** (or points if `restBy:'points'`). |
| `gameStats(points)` | `{ breaksUs, breaksThem, breakMargin }` | NEW v0.3. Needs `points[].mode` and `scoredBy`. |
| `maxConsecFor(p, settings)` | number | NEW v0.3. A player's points-in-a-row limit. Over the limit → bottom of both options. |
| `matchDLineO(ids, byId)` | `{ CH:id\|null, … }` | Who plays which O slot after a turn. |
| `matchPerson(ids, byId)` | `{ HD:[ids], CD:[ids], gaps, lastResort }` | Person D cover for any 7. |
| `parseSlots(str)`, `isOPlayer(p)` | helpers | |

### Lineup
```js
{
  mode: 'O' | 'D',
  scheme: 'zone' | 'person' | 'both',  // D only
  label: 'Full O' | 'O + 2 subs' | 'O3 line' | 'Core D' | 'D + Owen crossover' | 'Rest A, B · in C, D',
  players: [id × ≤7],
  assign: [{ slot, id|null, cost, group: 'o'|'o2'|'o3'|'d', fallback?: true, lastResort?: true }],
         // in slot order: O_SLOTS / ZONE_SLOTS / PERSON_SLOTS
  dlo:    { CH: id|null, … },          // D only: the offense after a turn
  person: { HD, CD, gaps, lastResort },// scheme 'both' only
  cost
}
```

Display contract:
- `id === null` → show **"No {slot} available"** as a warning. Never hide it. The coach has to act.
- `fallback: true` → tag "HC fallback". `lastResort: true` → tag "last resort".
- `dlo[s] === null` or `person.gaps > 0` → show a gap warning.
- `label` is for display only. Don't parse it.
- Performance: `suggest` takes under 15 ms, so it's fine to call on every render that changes the context.

## 4. Game rules (currently in `app.js`; keep them as they are)
- We scored → next point is D. They scored → next point is O. After the halftime point, the second half starts with the opposite of `weStart`.
- Half = `ceil(gameTo/2)`. Half point = no halftime yet and the leader is at half−1. Game point = the leader is at gameTo−1.
- Point record: `{ n, mode, scheme?, players, assign, label, option: 1|2|'edited', injuries:[{out,in,slot}], scoredBy:'us'|'them', us, them, dlo?, halftimeAfter?, ts }`.
- Holds = O points we scored. Breaks = D points we scored.

## 5. Testing
- Backend: write Node scripts in the session scratchpad (not the repo) that load `data/sample-roster.json` through `normalizeRoster()`, import `js/*.js` and call `suggest()` across scenarios: even, +5, −5, half point, mass injuries, and each `dScheme`. Then simulate a game to 13.
- Frontend: run `node --check js/app.js`, then click through on a ~390px-wide viewport (dark mode too).
- Before you hand off, check: zone, person and O still return 2 options on the default roster.

## 6. Conventions
- 2-space indent, single quotes, ES modules, no semicolon-free style.
- Put tunable numbers in `DEFAULT_SETTINGS`, not magic numbers in UI code.
- Escape all user-entered text (`esc()` in app.js) because names are editable.

## 7. Requests (frontend ⇄ backend)

Add items as `- [ ] R#  (from → to) what / why`. Tick them when done.

- [ ] **R1 (backend → frontend) Person D UI, plan v0.2.2/v0.3.** Backend is done. Frontend needs:
  1. **A Person / Zone toggle on each D point** (the coach's call, shown above the D options). Changing it re-runs `suggest` with `ctx.dScheme`. Keep the last choice as the default for the next D point. Offer "Both" as a secondary choice. Save it on each point as `scheme`.
  2. Render `HD`/`CD` slots (label them "Handler D" / "Cutter D"). For `'both'`, also show the `person` split under the zone slots, like the existing "After a turn" block.
  3. Roster editor: a `pd` select (Best / Handler / Cutter / None) per player.
  4. ~~Backfill `pd` from DEFAULT_ROSTER~~ is replaced by R4.3 (`normalizeRoster`).
- [ ] **R2 (backend → frontend)** `assign[].fallback` and `lastResort` are lost when a pick is copied into `S.game.current` (`pick()` keeps only `slot`/`id`). Keep the whole entry so the on-field view can show the tags.

- [ ] **R3 (backend → frontend) v0.3 stamina + breaks.**
  1. Pass `breakMargin: gameStats(g.points).breakMargin` in `context()`. The rest-O chip should read "Rest O (up N breaks)".
  2. Settings: add "Max in a row (Best Players)" → `maxConsecutiveBest`, relabel `maxConsecutive` as "Max in a row (others)", and add a "Rest O counts: Breaks / Points" select → `restBy`.
  3. Roster editor: optional "Max in a row" number per player → `maxConsec` (blank = role default). Show the effective limit with `maxConsecFor`.
  4. Optional: show a "tired" tag on players at or over `maxConsecFor`, using `playerStats().consec`.
- [ ] **R4 (backend → frontend) v0.3.1: no hard-coded roster.** ⚠️ `DEFAULT_ROSTER` is now `[]`, so on a fresh browser the app starts with an empty roster until this is done. Browsers with a saved roster are unaffected.
  1. **First launch** (no saved roster, or it's empty): show a welcome card with **Import roster** (JSON file) and **Try sample data** (`loadSampleRoster()`). Show a "Sample data" chip while the sample is loaded.
  2. "Reset to sheet" becomes **Load sample data** (with a confirm), and there's no reset to the real roster.
  3. Run imports and localStorage loads through `normalizeRoster()`. Show any `warnings` in a dismissible list.
  4. Remind the coach to export after each tournament: show a "last exported" date on the Roster tab.
- [ ] **R5 (backend → frontend) v0.3.1: rookie quick-add.**
  1. A **+ Rookie** button that asks only for a name (one input, then Enter or Add, about 5 seconds). Call `makeProvisional(name, S.settings, S.roster.map(p => p.id))` and add the result. This must work mid-game: refresh the options if no line has been picked yet.
  2. Show a **"provisional"** tag wherever the player's name appears in the roster and lineups.
  3. Editing any slot field (`o`, `o2`, `o3`, `dlo`, `zone`, `pd`) for that player sets `provisional = false`.
  4. Settings: a "Rookie starter slots" section for `provisionalOffense` (an O slot select), `provisionalZone` (a zone slot select) and `provisionalPd` (a role select).
- Out of scope for v1 (v0.3): line and player locking. Don't build it.

## 8. Changelog
- **v0.3.1b (backend):** `data/sample-roster.json` now holds the team's roster as demo data (the user's call), instead of invented names.
- **v0.3.1 (backend):** the real roster is removed from code and backed up to `private/roster.json` (gitignored). Fake `data/sample-roster.json` added. New: `normalizeRoster`, `loadSampleRoster`, `makeProvisional`, `PLAYER_DEFAULTS`, the `provisional` field, and `provisional*` settings. `DEFAULT_ROSTER` is deprecated and now `[]`. `.gitignore` added.
- **v0.3 (backend):** per-player stamina (`maxConsec`, `maxConsecutiveBest` = 5, a scaled fatigue ramp, and a heavy penalty over the limit), the rest-O trigger now uses breaks (`gameStats`, `ctx.breakMargin`, `settings.restBy`), and `docs/plan.md` is now the full v0.3 spec.
- **v0.2.2 (backend):** person D added: `pd` field, `PERSON_SLOTS`, `ctx.dScheme`, `matchPerson`. Default rosters have `pd` from the sheet. Mikey, Asher and Christopher have `''` (open question #3).
- **v0.2.1 (backend):** `ROLES`, and HC fallback for PR/SR.
- **v0.2 (both):** initial app.

## 9. Open questions (from the spec; ask the user, don't guess)
1. Core 7 on D? (Today: chosen by fatigue and cost.)
2. Person D role for Mikey, Asher, Christopher?
3. Vert vs ho per point, and does vert relax HC?
4. Max in a row for non-Best Players? (3 for now)
5. Rest O at "up 3+ breaks": real breaks or point lead? (`restBy` supports both; default breaks)
6. Rookies: hard switch at +4, or a gradual phase-in?
