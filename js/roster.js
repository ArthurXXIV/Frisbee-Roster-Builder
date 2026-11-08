// Roster model, constants and settings. Contains no player data.
// Slot strings are comma-separated; a trailing "?" marks a last-resort slot; "" or "-" = not eligible.

export const O_SLOTS = ['CH', 'PR', 'SR', 'IC', 'HC', 'SC', 'FC'];
// Role descriptions from the coach's Lock Lines sheet (plan v0.2.1).
export const ROLES = {
  CH: 'Center Handler: picks up or gets centered to. Confident break and deep throws. Reliably open in the reset space.',
  PR: 'Primary Reset: initiates from 45 back on the open side. Gets open in the dumpset, throws around off the sideline. Values possession.',
  SR: 'Secondary Reset: initiates from neutral on the break side or as the ace in the stack. Dangerous in power position, reads when to return or go deep.',
  IC: 'Initiating Cutter: best at getting open in a vacuum. Can turn and hit a shot downfield with no momentum.',
  SC: 'Secondary Cutter: the 4 in vert / the 2 in ho. Takes the space the initiating cut opens. Ideally a deep threat.',
  HC: 'Hybrid Cutter: the 1 in ho, less needed in vert. Can fill into handler space and run the dumpset.',
  FC: 'Fill Cutter: the 3 in vert / the 4 in ho. Moves without clogging lanes. Can get the disc off the sideline.',
};
// HC is a natural emergency handler: fallback for these slots before flagging the coach.
export const HC_FALLBACK_SLOTS = ['PR', 'SR'];

export const ZONE_SLOTS = ['Wall', 'Wall', 'Mark', 'Deep', 'Wing', 'Wing', 'Sheep'];
// Person D (plan v0.2.2): 3 handler defenders + 4 cutter defenders.
export const PERSON_SLOTS = ['HD', 'HD', 'HD', 'CD', 'CD', 'CD', 'CD'];
export const PERSON_ROLES = ['best', 'handler', 'cutter', '']; // '' = none listed (last resort)

// No player data lives in code (plan v0.3.1). The public repo ships fake data in data/sample-roster.json;
// the coach's real roster is imported once and kept in the browser (backup: private/roster.json, gitignored).

/** Every player field with its default. `cross`: 0 never crosses to D, 1 primary crossover, 2 situational. */
export const PLAYER_DEFAULTS = {
  name: '', o: '', o2: '', o3: '', dlo: '', zone: '', pd: '',
  rookie: false, cross: 0, maxConsec: null, status: 'available', notes: '', provisional: false,
};

/** @deprecated Empty since v0.3.1. Use loadSampleRoster() or an imported roster. Kept so old imports don't crash. */
export const DEFAULT_ROSTER = [];

export const SAMPLE_ROSTER_URL = 'data/sample-roster.json';

/** Browser: fetches the fake sample roster (relative to index.html). Returns normalized Player[]. */
export async function loadSampleRoster(url = SAMPLE_ROSTER_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load sample roster (${res.status})`);
  return normalizeRoster(await res.json()).roster;
}

const STATUSES = ['available', 'injured', 'unavailable'];
const SLOT_FIELDS = ['o', 'o2', 'o3', 'dlo', 'zone'];

/**
 * Validates and fills in an imported roster (JSON array). Never throws on bad players; reports them instead.
 * Returns { roster: Player[], warnings: string[] }. Throws only if `data` isn't an array.
 */
export function normalizeRoster(data) {
  if (!Array.isArray(data)) throw new Error('Roster must be a JSON array of players');
  const warnings = [], seen = new Set();
  const roster = [];
  data.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object' || !String(raw.name ?? '').trim()) { warnings.push(`Row ${i + 1}: no name, skipped`); return; }
    const pl = { ...PLAYER_DEFAULTS, ...raw, name: String(raw.name).trim() };
    for (const f of SLOT_FIELDS) pl[f] = String(pl[f] ?? '').trim();
    if (!PERSON_ROLES.includes(pl.pd)) { warnings.push(`${pl.name}: unknown person D role "${pl.pd}", set to none`); pl.pd = ''; }
    if (!STATUSES.includes(pl.status)) pl.status = 'available';
    pl.cross = [0, 1, 2].includes(+pl.cross) ? +pl.cross : 0;
    pl.maxConsec = +pl.maxConsec > 0 ? +pl.maxConsec : null;
    pl.rookie = !!pl.rookie; pl.provisional = !!pl.provisional;
    if (!SLOT_FIELDS.some(f => pl[f])) warnings.push(`${pl.name}: no slots in any group, the optimizer will never pick them`);
    roster.push(pl);
  });
  const withIdsRoster = withIds(roster).map(pl => {
    let id = pl.id, n = 2;
    while (seen.has(id)) id = `${pl.id}_${n++}`;
    seen.add(id); return { ...pl, id };
  });
  return { roster: withIdsRoster, warnings };
}

/**
 * Rookie quick-add (plan v0.3.1 §13): just a name → a provisional rookie in O3,
 * with starter slots from settings (default FC on offense, Wing in zone, Cutter in person D).
 */
export function makeProvisional(name, settings = DEFAULT_SETTINGS, existingIds = []) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const base = withIds([{ name }])[0].id;
  let id = base, n = 2;
  while (existingIds.includes(id)) id = `${base}_${n++}`;
  return {
    ...PLAYER_DEFAULTS, id, name: String(name).trim(),
    o3: s.provisionalOffense, dlo: s.provisionalOffense, zone: s.provisionalZone, pd: s.provisionalPd,
    rookie: true, provisional: true,
  };
}

export function withIds(roster) {
  return roster.map((pl, i) => ({ ...pl, id: pl.id || `p${i}_${pl.name.trim().toLowerCase().replace(/[^a-z]+/g, '')}`, name: pl.name.trim() }));
}

export const DEFAULT_SETTINGS = {
  restMargin: 3,       // up this many breaks: start resting O with O2
  restBy: 'breaks',    // 'breaks' (v0.3, coach's note) | 'points' (open question #5)
  blowoutUp: 4,        // up this many: O3 + rookies
  blowoutDown: 4,      // down this many: O3 and "?" slots allowed
  maxConsecutive: 3,       // points in a row, everyone else (placeholder until coach confirms)
  maxConsecutiveBest: 5,   // points in a row, Best Players (pd === 'best')
  fatigueWeight: 1.5,
  // Rookie quick-add starter slots (plan v0.3.1 §13)
  provisionalOffense: 'FC',
  provisionalZone: 'Wing',
  provisionalPd: 'cutter',
};
