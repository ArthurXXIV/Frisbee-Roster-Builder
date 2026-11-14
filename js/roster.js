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
  dOnly: false, // never on an O line, even when the team has O/D interchange
};

/** @deprecated Empty since v0.3.1. Use loadSampleRoster() or an imported roster. Kept so old imports don't crash. */
export const DEFAULT_ROSTER = [];

export const SAMPLE_ROSTER_URL = 'data/sample-roster.json';

/** Browser: fetches the fake sample roster (relative to index.html). Returns normalized Player[]. */
export async function loadSampleRoster(url = SAMPLE_ROSTER_URL) {
  return (await loadTeam(url)).roster;
}

/**
 * Loads a team file. Either a bare Player[] or { name, settings, players } (settings = team rule overrides,
 * e.g. Block's maxBench/interchange). Returns { name, settings, roster }.
 */
export async function loadTeam(url = SAMPLE_ROSTER_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load roster (${res.status})`);
  const data = await res.json();
  const players = Array.isArray(data) ? data : data.players;
  return { name: data.name || '', version: data.version || '', settings: (!Array.isArray(data) && data.settings) || {}, roster: normalizeRoster(players).roster };
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
    for (const f of SLOT_FIELDS) pl[f] = String(pl[f] ?? '').split(',').map(x => x.trim()).filter(x => x && x !== '-').join(', ');
    if (!PERSON_ROLES.includes(pl.pd)) { warnings.push(`${pl.name}: unknown person D role "${pl.pd}", set to none`); pl.pd = ''; }
    if (!STATUSES.includes(pl.status)) pl.status = 'available';
    pl.cross = [0, 1, 2].includes(+pl.cross) ? +pl.cross : 0;
    pl.maxConsec = +pl.maxConsec > 0 ? +pl.maxConsec : null;
    pl.rookie = !!pl.rookie; pl.provisional = !!pl.provisional; pl.dOnly = !!pl.dOnly;
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
  maxBench: 0,          // max points in a row on the sideline; 0 = off (Block team: 3)
  interchange: false,   // O and D players swap freely (Block team: true)
  minHandlers: 0,       // at least this many handlers (CH/PR/SR-eligible) on every line; 0 = off (Block team: 3)
  // Rookie quick-add starter slots (plan v0.3.1 §13)
  provisionalOffense: 'FC',
  provisionalZone: 'Wing',
  provisionalPd: 'cutter',
};

// ---------- Excel import / export (roster ⇄ spreadsheet rows) ----------
// Column headers match the coach's sheet ("O", "D-Line O", "Person D", "Zone D", "O2", "O3"),
// plus app-only columns. Headers are matched case-insensitively; the first column with a blank header is the name.

const PD_TO_SHEET = { best: 'Best Player', handler: 'Handler', cutter: 'Cutter', '': '' };
const CROSS_TO_SHEET = { 0: '', 1: 'Primary', 2: 'Situational' };

export const ROSTER_COLUMNS = [
  { header: 'Name',         key: 'name',       aliases: ['player', ''] },
  { header: 'O',            key: 'o',          aliases: ['o slots'] },
  { header: 'O2',           key: 'o2',         aliases: ['o2 slots'] },
  { header: 'O3',           key: 'o3',         aliases: ['o3 slots'] },
  { header: 'D-Line O',     key: 'dlo',        aliases: ['dline o', 'd line o', 'dlo'] },
  { header: 'Zone D',       key: 'zone',       aliases: ['zone'] },
  { header: 'Person D',     key: 'pd',         aliases: ['person', 'pd'] },
  { header: 'Rookie',       key: 'rookie',     aliases: [] },
  { header: 'Crossover',    key: 'cross',      aliases: ['cross'] },
  { header: 'Max in a row', key: 'maxConsec',  aliases: ['max consecutive', 'stamina'] },
  { header: 'Status',       key: 'status',     aliases: [] },
  { header: 'Notes',        key: 'notes',      aliases: [] },
  { header: 'Provisional',  key: 'provisional',aliases: [] },
  { header: 'D only',       key: 'dOnly',      aliases: ['defense only', 'd-only'] },
];

const norm = s => String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
const yes = v => ['yes', 'y', 'true', '1', 'x', '✓'].includes(norm(v));

function fromCell(key, v) {
  const t = String(v ?? '').trim();
  switch (key) {
    case 'o': case 'o2': case 'o3': case 'dlo': case 'zone': return t === '-' ? '' : t;
    case 'pd': { if (t === '-') return ''; const n = norm(t); return n.startsWith('best') ? 'best' : n.startsWith('hand') ? 'handler' : n.startsWith('cut') ? 'cutter' : n === '' || n === '-' ? '' : t; }
    case 'rookie': case 'provisional': case 'dOnly': return yes(t);
    case 'cross': { const n = norm(t); return n.startsWith('prim') || n === '1' ? 1 : n.startsWith('sit') || n === '2' ? 2 : 0; }
    case 'maxConsec': return +t > 0 ? +t : null;
    case 'status': return norm(t) || 'available';
    default: return t;
  }
}

/** Roster → rows for writeXlsx (header row first). Empty slots are written as "-", like the coach's sheet. */
export function rosterToRows(roster) {
  return [ROSTER_COLUMNS.map(c => c.header), ...roster.map(p => ROSTER_COLUMNS.map(({ key }) => {
    const v = p[key];
    if (['o', 'o2', 'o3', 'dlo', 'zone'].includes(key)) return v || '-';
    if (key === 'pd') return PD_TO_SHEET[v || ''] ?? '';
    if (key === 'cross') return CROSS_TO_SHEET[v || 0] ?? '';
    if (key === 'rookie' || key === 'provisional' || key === 'dOnly') return v ? 'Yes' : '';
    if (key === 'maxConsec') return v ? String(v) : '';
    return v ?? '';
  }))];
}

/**
 * Spreadsheet rows → { roster, warnings }. Finds the header row (the first row containing an "O" or "Zone D" column).
 * Columns missing from the sheet keep their value from `existing` (matched by name), so re-importing the coach's
 * sheet doesn't wipe app-only fields like rookie or crossover.
 */
export function rowsToRoster(rows, existing = []) {
  const hi = rows.findIndex(r => r.some(c => ['o', 'zone d', 'zone'].includes(norm(c))));
  if (hi < 0) throw new Error('No header row found. The sheet needs columns like "O", "D-Line O", "Zone D".');
  const header = rows[hi].map(norm), colOf = {};
  for (const c of ROSTER_COLUMNS) {
    const names = [norm(c.header), ...c.aliases];
    const i = header.findIndex(h => names.includes(h) && (h !== '' || !Object.values(colOf).includes(header.indexOf(''))));
    if (i >= 0 && !Object.values(colOf).includes(i)) colOf[c.key] = i;
  }
  if (colOf.name === undefined) colOf.name = 0;
  const prev = Object.fromEntries(existing.map(p => [norm(p.name), p]));
  const players = [];
  for (const r of rows.slice(hi + 1)) {
    // A second table on the same sheet (its own header row: blank name cell + "O" + "Zone D" columns): stop.
    if (!String(r[colOf.name] ?? '').trim() && r.some(c => norm(c) === 'o') && r.some(c => ['zone d', 'zone'].includes(norm(c)))) break;
    const name = String(r[colOf.name] ?? '').trim();
    if (!name) continue;
    const old = prev[norm(name)];
    const p = old ? { ...old } : {};
    for (const [key, i] of Object.entries(colOf)) p[key] = fromCell(key, r[i]);
    p.name = name;
    players.push(p);
  }
  const res = normalizeRoster(players);
  const missing = ROSTER_COLUMNS.filter(c => colOf[c.key] === undefined).map(c => c.header);
  const optional = ['Status', 'Notes', 'Provisional', 'Max in a row', 'D only'];
  const important = missing.filter(h => !optional.includes(h));
  const newNames = players.filter(p => !prev[norm(p.name)]).map(p => p.name);
  if (important.length && newNames.length) res.warnings.unshift(`No ${important.join(' / ')} column. Set these in the Roster tab for: ${newNames.join(', ')}`);
  return res;
}
