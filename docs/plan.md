# Ultimate Frisbee Roster Builder: Project Plan

**Status:** Draft v0.3.1 · November 7, 2026
**Purpose:** A living spec, updated with the coach's roster sheet and line rules.
**Changes from v0.1:** Replaced generic SSR/SR/U tiers with real line groups, added 7 named position slots, zone D slots, score-driven triggers, and a "pick 1 of 2" sideline flow.
**Changes in v0.2.1:** Added full role descriptions for all 7 offensive slots (IC, SC, HC, FC defined), HC as emergency handler fallback, and vert vs ho as an open question.
**Changes in v0.2.2:** Person D added back in scope with the coach's 3 handler defenders + 4 cutter defenders rule. Coach calls person or zone per point. Stamina limits by role.
**Changes in v0.3:** Synced with the built prototype. Roster is 21 players. Rest-O trigger tied to breaks. Fatigue limits per player. Line locking moved out of v1. Added build status section.
**Changes in v0.3.1:** No hard-coded roster (sample data + import, real roster stays in the coach's browser). Added rookie quick-add with provisional profiles.

## 1. Problem

The coach manages a roster of 21 players across several line groups. During games he needs to call the right 7 for each point fast, rest the O line when possible, get rookies minutes when the game allows, and cover injuries without breaking positional coverage. Doing that in his head every point, while also coaching, is the problem.

## 2. Product vision

A mobile-friendly sideline app. The coach enters **only who scored** each point. The app works out everything else and shows **two ranked lineup options** for the next point. He taps one and moves on. v1 uses rules and constraint optimization, not machine learning.

## 3. Line groups (replaces tiers)

| Group | Meaning | Players (from sheet) |
|---|---|---|
| **O (Offense)** | Peak offensive line. 9-man rotation. Rarely plays D. Rested whenever the score allows. | Owen, Akilesh, Arone, Jesse, Bijan, Peyton, Tommy, Michael, Mikey |
| **O2 (Sub Offense)** | Substitutes for O, like American football subs. First backup for any O slot. | Jack, JP, Kethan, Milo, Andrew Fletcher, Wyatt |
| **O3** | Comes out when the game is out of hand, either direction. | Tommy, Alan, Mikey, Diego, Andy Chen, Asher, Christopher, Reeves |
| **D (Defense)** | Defensive line. Must defend in zone **and** score after a turnover. | Core 7 to confirm with coach |
| **D-Line O** | Each D player's offensive slots after a turn (same 7 stay on). | Per-player column in sheet |

**Rookies:** Diego, Andy Chen, Asher, Christopher, Reeves.

**Crossovers:** In big games and at half point or game point, Arone and/or Owen cross from O to D. Aki, Peyton and Jesse can also cross depending on context.

## 4. Positions

### Offense: 7 named slots, one player each (strict)

| Slot | Role (from coach's Lock Lines sheet) |
|---|---|
| **CH: Center Handler** | Picks up or gets centered to. Confident break and deep throws. Reliably open in the reset space. |
| **PR: Primary Reset** | Initiates from 45 back on the open side. Gets open in the dumpset, throws around off the sideline. Values possession, gets the disc back to handlers. |
| **SR: Secondary Reset** | Initiates from neutral on the break side or as the ace in the stack. Dangerous in power position, works in cutter space, reads when to return to handler space or go deep. |
| **IC: Initiating Cutter** | Best at getting open in a vacuum. Can turn and hit a shot downfield with no momentum. |
| **SC: Secondary Cutter** | Sets up at the 4 in vert or the 2 in ho. Takes the space the initiating cut opens. Ideally a deep threat if IC can shoot. |
| **HC: Hybrid Cutter** | Sets up at the 1 in ho, less needed in vert. Can fill into handler space and run the dumpset. |
| **FC: Fill Cutter** | Sets up at the 3 in vert or the 4 in ho. Moves around without clogging lanes. Can get the disc off the sideline. |

Every offensive line (O, O2-mixed, O3, and D after a turn) fills all 7 slots: 3 handlers plus one of each cutter type.

**Note:** HC is a natural emergency handler, since the role already includes filling handler space. It's a reasonable fallback for PR or SR before flagging the coach.

### Zone defense: 7 fixed slots

2 Walls · 1 Mark · 1 Deep · 2 Wings · 1 Sheep

### Person defense: 3 handler defenders + 4 cutter defenders

Coach's rule: every line must be able to guard each opposing position. Each player has one person D role:

| Role | Can guard | Players (from sheet) |
|---|---|---|
| **Best Player** | Handler **or** cutter (flex) | Owen, Akilesh, Arone, Jack, Andrew Fletcher |
| **Handler** | Handlers only | Jesse, Bijan, Milo, Alan, Wyatt, Diego, Andy Chen |
| **Cutter** | Cutters only | JP, Kethan, Peyton, Tommy, Michael, Reeves |
| **None listed** | Treat as last resort | Mikey, Asher, Christopher |

A valid person D line has at most 3 handler-only defenders, at most 4 cutter-only defenders, and Best Players fill whatever is left. Examples: 3 H + 4 C, or 2 H + 3 C + 2 Best.

Note: 3 of the 5 Best Players (Owen, Akilesh, Arone) are on the O line, which rarely plays D. On a normal D point the flex players are mostly Jack and Andrew, unless a crossover is called.

### Eligibility rules

- Eligibility is **per group**. The same player can have different slots on O, O2, O3 and D-Line O.
- "-" means not eligible for that group.
- "?" (e.g. "Sheep?") means **last resort**: only used if no one else can fill the slot, or when down by 4 or more.

## 5. Game state and triggers

| Setting | Default | Notes |
|---|---|---|
| Game to | 13 | Options: 11, 13, 15 |
| Halftime | Auto | First to 6 / 7 / 8 respectively |
| Rest O trigger | Up 3+ breaks | From coach's note. Uses break count, not point lead (to confirm) |
| Rookie / O3 trigger (winning) | +4 | Rest O, bring in O3 and rookies |
| O3 / "?" trigger (losing) | -4 | O3 and last-resort fills allowed |
| D scheme | Coach's call | Person or Zone toggle on each D point (default). A "Both" option stays available but is not the default |
| Max points in a row (Best Player) | 5 | High stamina, can go 5 to 6 |
| Max points in a row (everyone else) | 3 | Placeholder until coach confirms |
| Crossover moments | Auto | Half point and game point, plus a "big game" toggle |

All thresholds are editable settings.

**Derived from "who scored" alone (per the rules of ultimate):**
- The team that scores pulls next, so **we scored → next point is D**, **they scored → next point is O**. The coach only sets who pulls first in each half.
- Score margin, half point, game point, and whether a trigger is active.
- Subs only happen between points, except injury subs mid-point.

## 6. Sideline flow

### Before the game
1. Import or update the roster sheet.
2. Mark anyone Unavailable or Injured.
3. Set game target (default 13), who pulls first, and the big-game toggle.

### Each point
1. App shows **2 ranked lineup options**, each with a short label so the difference is obvious at a glance, e.g.:
   - "Full O" vs "Rest 3, O2 in"
   - "Core D" vs "D + Arone crossover"
2. Coach taps one. A small **Edit** button lets him swap a player, but it is secondary.
3. When the point ends, coach taps **We scored** or **They scored**.
4. Mid-point injury: tap the player, app suggests a same-slot replacement.

### After the game
- Review points played per player, line usage, holds and breaks.
- Export for later analysis.

## 7. Optimizer

**Hard constraints**
- Exactly 7 distinct, available players.
- All 7 offensive slots filled by eligible players (and on D points, the coverage for whichever scheme the coach called: all 7 zone slots for zone, or 3 handler + 4 cutter defenders for person). A D line only has to be valid for the called scheme, not both.
- No Injured or Unavailable players.
- Line and player locking is **deferred past v1**. The coach edits a pick instead.

**Fallback order for an empty O slot**
1. Another eligible O player
2. Eligible O2 player
3. Flag "no [slot] available" and ask the coach

Known thin spot: **CH** has only Arone on O and only Wyatt on O2. Losing both at once is unlikely, but the flag stays as a safety net.

**Soft objectives**
- Rest O players whenever the score allows (they play the most consecutive points).
- Respect stamina: Best Players can play 5 to 6 points in a row, everyone else gets rested sooner. Players over their limit drop to the bottom of both options.
- Favor rookies and O3 when at +4 or more.
- Use "?" slots only as a last resort or at -4 or worse.
- Make Option 2 meaningfully different from Option 1, not a one-player shuffle.

**Candidate implementation:** Python, pandas/openpyxl for roster import, OR-Tools CP-SAT for slot assignment.

## 8. Data design

**Players:** `player_id`, `name`, `is_rookie`, `o_slots`, `o2_slots`, `o3_slots`, `d_line_o_slots`, `zone_slots`, `zone_last_resort_slots`, `person_d_role` (best/handler/cutter), `max_consecutive_points` (default by person D role: Best Player 5, others 3), `status`, `notes`

**Games:** `game_id`, `opponent`, `game_to`, `big_game`, `first_pull_by`, `date`

**Points:** `point_id`, `game_id`, `point_number`, `started_on` (O/D, derived), `player_ids` (the actual 7, snapshotted), `option_picked` (1, 2, or edited), `scored_by` (us/them), `score_after`, `injury_subs`, `timestamp`

`started_on` + `scored_by` gives holds and breaks for free, which is far more useful than plain won/lost.

## 9. Roster data cleanup

- Strip trailing spaces ("Wyatt Dunn ").
- Add last names for Michael, Mikey, Asher, Reeves.
- "Andy" = Andy Chen. "Milo/Andy" in coach notes = Milo or Andrew Fletcher.
- Move the free-text coach rules into structured settings.

## 10. Delivery phases

**Phase 1: Offline prototype.** Parse the real sheet, build the slot optimizer, simulate games to 11/13/15 with injuries and blowouts in both directions.

**Phase 2: Coach app.** Mobile web app with the pick-1-of-2 flow, score buttons, injury swap. Test on a phone at practice.

**Phase 3: Pilot.** Use in practices and a tournament. Watch whether the coach actually picks Option 1 or 2, and how often he edits.

**Phase 4: Performance modeling (later).** Once real hold/break data exists, look at which lineups perform best. Be careful about reading individual synergy from 7-player results.

## 11. Still open (non-blocking)

1. Who are the core 7 on D?
2. Mikey, Asher and Christopher have no person D role. Are they cutter defenders, handler defenders, or zone only?
3. Vert vs ho: HC is "less necessary in vert." Should the coach pick the offensive set per point, and does vert relax the HC requirement?
4. Best Players can go 5 to 6 points in a row. What's the limit for everyone else? (Prototype uses 3.)
5. "Up 3+ breaks" to rest O: is that actual breaks, or just being up 3 points?
6. Rookie minutes: is +4 a hard switch, or should rookies phase in gradually?

## 12. Build status (prototype)

Static web app (plain HTML, CSS, JS) for GitHub Pages, data saved in the browser.

**Built**
- Full roster from the sheet with all slot columns, rookies, crossover levels and person D roles
- O lineups filling all 7 slots with O, then O2, then O3 fallback, plus the HC fallback for PR/SR
- Zone D and person D lines, both checked for offense after a turn
- Score triggers, crossovers at half/game point and the big-game toggle
- Two ranked, labeled options per point (Option 2 differs by at least 2 players)
- Injury and edit replacements, undo last point
- Roster editor, stats (holds, breaks, +/-), settings, CSV/JSON export
- Under 15 ms per suggestion

**Next, in order**
1. Remove the hard-coded real roster. Ship a fake `data/sample-roster.json`, and show "Import roster" or "Try sample data" on first launch. Keep real rosters in a gitignored folder
2. Rookie quick-add (see section 13)
3. Person D in the UI (scheme picker defaulting to the coach's call, HD/CD slots, role dropdown in the roster editor)
4. Per-player fatigue limits (Best Player 5, others 3)
5. Rest-O trigger based on breaks instead of point lead
6. Keep fallback and last-resort tags visible after a pick
7. Deploy to GitHub Pages and test on the coach's phone
8. Excel/CSV roster import, then the Phase 1 simulation write-up

## 13. Dynamic roster and new players

The optimizer has no player names built in. It works from whatever roster is loaded, so the coach can add, edit or remove players at any time and the next suggestion uses the updated roster.

**Where the roster lives**
- The public repo ships only fake sample data.
- The coach imports the real roster once (JSON now, Excel/CSV later). It is saved in his phone's browser.
- Export after each tournament as a backup. Browser data does not sync between devices and is lost if cleared.

**Rookie quick-add**
For a new player whose positions aren't known yet:
- Coach enters just a name. Takes about 5 seconds, works mid-tournament.
- App creates a **provisional profile**: rookie flag on, group O3, starter slots FC (offense), Wing (zone), Cutter (person D), and the default stamina limit.
- Player shows a "provisional" tag until the coach edits their slots.
- Starter slots are editable in Settings in case the coach prefers different defaults.

---

*Evolving design document. A working prototype exists (see section 12). It has not been piloted yet.*
