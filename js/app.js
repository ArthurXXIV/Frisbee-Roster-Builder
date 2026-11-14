import { DEFAULT_SETTINGS, O_SLOTS, ROLES, withIds, loadSampleRoster, loadTeam, normalizeRoster, rosterToRows, rowsToRoster } from './roster.js';
import { readXlsx, writeXlsx } from './xlsx.js';
import { suggest, replacements, playerStats, flags, matchDLineO, parseSlots } from './optimizer.js';

// Team links: ?team=block loads data/block-roster.json and keeps its own saved data (separate from the default team).
const TEAM = (new URLSearchParams(location.search).get('team') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const KEY = 'roster-builder-v1' + (TEAM ? ':' + TEAM : '');
const ROSTER_URL = TEAM ? `data/${TEAM}-roster.json` : undefined;
if (TEAM) document.title = `Roster Builder · ${TEAM[0].toUpperCase() + TEAM.slice(1)}`;
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = n => n.split(' ')[0];
const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const hue = n => [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const newGame = (prev = {}) => ({
  opponent: '', gameTo: prev.gameTo || 13, weStart: prev.weStart || 'O', bigGame: false,
  us: 0, them: 0, points: [], current: null, options: null,
});

let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
if (!S) S = { roster: [], settings: { ...DEFAULT_SETTINGS }, game: newGame() };
S.settings = { ...DEFAULT_SETTINGS, ...S.settings };
let tab = 'game';
let sel = 0; // which line option is highlighted (UI only)

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const byId = () => Object.fromEntries(S.roster.map(p => [p.id, p]));
const name = id => byId()[id]?.name ?? '—';

// ---------- game logic ----------
const halfAt = g => Math.ceil(g.gameTo / 2);
const halftimeHappened = g => g.points.some(p => p.halftimeAfter);
const gameOver = g => g.us >= g.gameTo || g.them >= g.gameTo;

function nextMode(g) {
  if (!g.points.length) return g.weStart;
  const last = g.points.at(-1);
  if (last.halftimeAfter) return g.weStart === 'O' ? 'D' : 'O';
  return last.scoredBy === 'us' ? 'D' : 'O';
}

function context(g) {
  const hi = Math.max(g.us, g.them);
  return {
    roster: S.roster, settings: S.settings, stats: playerStats(g.points), mode: nextMode(g),
    margin: g.us - g.them, bigGame: g.bigGame,
    halfPoint: !halftimeHappened(g) && hi === halfAt(g) - 1,
    gamePoint: hi === g.gameTo - 1,
  };
}

function refreshOptions() {
  const g = S.game;
  g.options = gameOver(g) ? [] : suggest(context(g));
}

function pick(i) {
  sel = 0;
  const o = S.game.options[i];
  S.game.current = { mode: o.mode, assign: o.assign.map(a => ({ slot: a.slot, id: a.id })), label: o.label, option: i + 1, injuries: [] };
  save(); render(); toTop();
}

function scored(by) {
  const g = S.game, c = g.current;
  if (!c) return;
  if (by === 'us') g.us++; else g.them++;
  const players = c.assign.map(a => a.id).filter(Boolean);
  const pt = {
    n: g.points.length + 1, mode: c.mode, players, assign: c.assign, label: c.label, option: c.option,
    injuries: c.injuries, scoredBy: by, us: g.us, them: g.them, ts: new Date().toISOString(),
  };
  if (c.mode === "D") pt.dlo = matchDLineO(players, byId(), { useOSlots: !!S.settings.interchange });
  if (!halftimeHappened(g) && Math.max(g.us, g.them) === halfAt(g)) pt.halftimeAfter = true;
  g.points.push(pt);
  g.current = null;
  refreshOptions(); save(); render(); toTop();
}

function undo() {
  sel = 0;
  const g = S.game, pt = g.points.pop();
  if (!pt) return;
  if (pt.scoredBy === 'us') g.us--; else g.them--;
  g.current = { mode: pt.mode, assign: pt.assign, label: pt.label, option: pt.option, injuries: pt.injuries || [] };
  refreshOptions(); save(); render();
}

function swap(slotIdx, newId, injured) {
  const c = S.game.current, old = c.assign[slotIdx].id;
  if (injured && old) {
    const p = byId()[old]; p.status = 'injured';
    c.injuries.push({ out: old, in: newId, slot: c.assign[slotIdx].slot });
  }
  const other = c.assign.findIndex(a => a.id === newId);
  if (other >= 0) c.assign[other].id = old; // swapping two on-field players
  c.assign[slotIdx].id = newId;
  if (!injured) c.option = 'edited';
  save(); render();
}

// ---------- views ----------
function scoreboard() {
  const g = S.game, ctx = context(g), f = flags(ctx);
  const tags = [];
  if (gameOver(g)) tags.push(`<span class="tag">Final · ${g.us > g.them ? 'Win' : 'Loss'}</span>`);
  else {
    tags.push(`<span class="tag ${ctx.mode.toLowerCase()}">Next: ${ctx.mode === 'O' ? 'Offense' : 'Defense'}</span>`);
    if (ctx.halfPoint) tags.push(`<span class="tag warn">Half point</span>`);
    if (ctx.gamePoint) tags.push(`<span class="tag warn">Game point</span>`);
    if (f.win) tags.push(`<span class="tag warn">Up ${ctx.margin}: O3 / rookies</span>`);
    else if (f.rest) tags.push(`<span class="tag">Resting O</span>`);
    if (f.lose) tags.push(`<span class="tag warn">Down ${-ctx.margin}: O3 / "?" OK</span>`);
    if (g.bigGame) tags.push(`<span class="tag">Big game</span>`);
  }
  const pct = n => Math.min(100, 100 * n / g.gameTo) / 2;
  $('#scoreboard').innerHTML = `<div class="score">
    <div class="brand"><span>Roster Builder</span><span>Game to ${g.gameTo} · Point ${g.points.length + (gameOver(g) ? 0 : 1)}</span></div>
    <div class="board">
      <div class="team us"><span class="lbl">Us</span><span class="n">${g.us}</span></div>
      <span class="dash">–</span>
      <div class="team them right"><span class="lbl">${esc(g.opponent || 'Opponent')}</span><span class="n">${g.them}</span></div>
    </div>
    <div class="progress"><i class="pu" style="width:${pct(g.us)}%"></i><i class="pt" style="width:${pct(g.them)}%"></i></div>
    <div class="chips">${tags.join('')}</div></div>`;
}

function slotRows(assign, dlo) {
  return assign.map(a => `<div class="slot"><span class="badge" title="${esc(ROLES[a.slot] || a.slot)}">${a.slot}</span>${a.id
      ? `<span class="who">${esc(name(a.id))}${a.fallback ? ' <span class="tag warn mini">HC fallback</span>' : ''}${a.fillIn ? ' <span class="tag warn mini">fill-in</span>' : ''}${a.fromD ? ' <span class="tag mini">from D</span>' : ''}</span>`
      : `<span class="who missing">No ${a.slot} available</span>`}</div>`).join('')
    + (dlo ? `<div class="divider">If we get the turn</div>` +
      O_SLOTS.map(s => `<div class="slot after"><span class="badge o">${s}</span><span class="who ${dlo[s] ? '' : 'missing'}">${dlo[s] ? esc(name(dlo[s])) : 'Gap'}</span></div>`).join('') : '');
}

function gameView() {
  const g = S.game;
  if (!g.options) refreshOptions();
  let h = '';
  if (gameOver(g)) {
    h += `<div class="card empty"><span class="ico">${g.us > g.them ? '🏆' : '🥏'}</span><h3 style="justify-content:center">${g.us > g.them ? 'Win' : 'Loss'} · ${g.us}–${g.them}</h3><p class="sub">Points played, holds and breaks are on the Stats tab.</p>
      <button class="primary" data-act="newgame">Start new game</button></div>`;
  } else if (!g.current) {
    const m = nextMode(g);
    h += `<h2 class="title">Point ${g.points.length + 1}: pick a line</h2><p class="lede">You're on <b>${m === 'O' ? 'offense' : 'defense'}</b>. Option 1 is the recommended line.</p>`;
    h += '<div class="opts">';
    g.options.forEach((o, i) => {
      const on = i === (sel < g.options.length ? sel : 0);
      h += `<div class="card pickable ${on ? 'best' : ''} ${i === 0 ? 'rec' : ''} mode-${o.mode.toLowerCase()}" data-act="select" data-i="${i}" role="radio" aria-checked="${on}" tabindex="0" aria-label="${esc(o.label)}"><h3><span>${esc(o.label)}</span> <span class="rank">${i === 0 ? '★ Best' : 'Option ' + (i + 1)}</span></h3>
        <div class="slots">${slotRows(o.assign, o.dlo)}</div>
        ${on ? `<button class="cta" data-act="pick" data-i="${i}">Send out this line</button>` : `<div class="cta ghosted" aria-hidden="true">Tap to select</div>`}</div>`;
    });
    h += '</div>';
    if (!g.options.length) h += `<div class="card empty"><span class="ico">🙅</span>Not enough available players to field a line.<br>Check who's marked available on the Roster tab.</div>`;
  } else {
    const c = g.current, onIds = c.assign.map(a => a.id);
    const ctx = context(g);
    h += `<h2 class="title">On the field <span class="tag ${c.mode.toLowerCase()}">${c.mode === 'O' ? 'Offense' : 'Defense'}</span></h2><p class="lede">${esc(c.label)}. Tap a name to swap, or hit Injury to auto-sub.</p><div class="card mode-${c.mode.toLowerCase()}">`;
    c.assign.forEach((a, i) => {
      h += `<div class="field"><span class="badge" title="${esc(ROLES[a.slot] || a.slot)}">${a.slot}</span>
        <button class="picker ${a.id ? '' : 'empty'}" data-act="subMenu" data-i="${i}" aria-haspopup="dialog"><span>${a.id ? esc(name(a.id)) : 'Empty: tap to fill'}</span><svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5"/></svg></button>
        ${a.id ? `<button class="inj" data-act="injure" data-i="${i}">Injury</button>` : '<span></span>'}</div>`;
    });
    h += `</div><div class="big"><button class="us" data-act="us">We scored<small>→ ${g.us + 1}–${g.them}</small></button><button class="them" data-act="them">They scored<small>→ ${g.us}–${g.them + 1}</small></button></div>
      <div class="links"><button class="ghost" data-act="back">← Back to options</button>`;
  }
  if (g.points.length) h += `${g.current ? '' : '<div class="links">'}<button class="ghost" data-act="undo">↺ Undo last point</button></div>`;
  else if (g.current) h += '</div>';
  return h;
}

function rosterView() {
  const fields = [['o', 'O slots'], ['o2', 'O2 slots'], ['o3', 'O3 slots'], ['dlo', 'D-Line O slots'], ['zone', 'Zone slots (? = last resort)'], ['notes', 'Notes']];
  const avail = S.roster.filter(p => p.status === 'available').length;
  let h = `<h2 class="title">Roster</h2><p class="lede"><b>${avail}</b> of ${S.roster.length} available. Tap a player to edit. Status changes apply from the next point.</p>`;
  S.roster.forEach((p, i) => {
    h += `<details class="player status-${p.status}"><summary><span class="avatar" style="--h:${hue(p.name)}">${esc(initials(p.name))}</span><span class="nm"><span>${esc(p.name)}${p.rookie ? ' <span class="tag mini">Rookie</span>' : ''}</span><small>${esc(p.o ? 'O: ' + p.o : p.o2 ? 'O2: ' + p.o2 : p.o3 ? 'O3: ' + p.o3 : 'D: ' + (p.dlo || '—'))}</small></span>
      <button class="pill st-${p.status}" data-act="statusMenu" data-i="${i}" aria-haspopup="menu"><i></i>${STATUS_LABEL[p.status]}<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5"/></svg></button></summary><div class="body">
      <label class="f">Name<input type="text" data-act="field" data-i="${i}" data-k="name" value="${esc(p.name)}"></label>
      ${fields.map(([k, l]) => `<label class="f">${l}<input type="text" data-act="field" data-i="${i}" data-k="${k}" value="${esc(p[k])}"></label>`).join('')}
      <div class="grid2" style="margin-top:6px">
        <label class="check"><input type="checkbox" data-act="rookie" data-i="${i}" ${p.rookie ? 'checked' : ''}> Rookie</label>
        <label class="f">Crossover to D<select data-act="cross" data-i="${i}">
          ${[[0, 'Never'], [1, 'Primary'], [2, 'Situational']].map(([v, l]) => `<option value="${v}" ${p.cross == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <button class="danger" style="margin-top:8px" data-act="del" data-i="${i}">Remove player</button></div></details>`;
  });
  h += `<h2>Offensive roles</h2><div class="card slots legend">${O_SLOTS.map(s => `<div class="slot"><span class="badge o">${s}</span><span class="who">${esc(ROLES[s])}</span></div>`).join('')}</div>`;
  h += `<h2>Manage</h2>`;
  h += `<div class="row"><button data-act="add" class="primary" style="margin:0 0 4px">+ Add player</button>
    <button data-act="exportRoster">Export Excel</button><button data-act="importRoster">Import Excel</button>
    <button data-act="healAll">Mark all available</button><button class="danger" data-act="resetRoster">Reset to sheet</button></div>`;
  return h;
}

function statsView() {
  const g = S.game, st = playerStats(g.points);
  const oPts = g.points.filter(p => p.mode === 'O'), dPts = g.points.filter(p => p.mode === 'D');
  const holds = oPts.filter(p => p.scoredBy === 'us').length, breaks = dPts.filter(p => p.scoredBy === 'us').length;
  const pc = (a, b) => b ? Math.round(100 * a / b) : 0;
  const tile = (cls, k, v, of) => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}<small> / ${of}</small></div><div class="bar"><i style="width:${pc(v, of)}%"></i></div><div class="sub" style="margin-top:6px">${pc(v, of)}% ${cls === 'ot' ? 'hold' : 'break'} rate</div></div>`;
  let h = `<h2 class="title">Stats</h2><p class="lede">${g.points.length ? `${g.points.length} points played${g.opponent ? ' vs ' + esc(g.opponent) : ''}.` : 'Nothing yet. Stats fill in as you log points.'}</p>
    <div class="tiles">${tile('ot', 'O holds', holds, oPts.length)}${tile('dt', 'D breaks', breaks, dPts.length)}</div>
    <h2>Points played</h2><div class="card table-card"><table><tr><th>Player</th><th class="n">O</th><th class="n">D</th><th class="n">Total</th><th class="n">+/−</th></tr>`;
  S.roster.map(p => {
    const mine = g.points.filter(pt => pt.players.includes(p.id));
    return { p, o: mine.filter(x => x.mode === 'O').length, d: mine.filter(x => x.mode === 'D').length,
      pm: mine.filter(x => x.scoredBy === 'us').length - mine.filter(x => x.scoredBy === 'them').length };
  }).sort((a, b) => (b.o + b.d) - (a.o + a.d)).forEach(r => {
    h += `<tr><td>${esc(r.p.name)}</td><td class="n">${r.o}</td><td class="n">${r.d}</td><td class="n tot">${st.total[r.p.id] || 0}</td><td class="n ${r.pm > 0 ? 'pos' : r.pm < 0 ? 'neg' : ''}">${r.pm > 0 ? '+' : ''}${r.pm}</td></tr>`;
  });
  h += `</table></div><h2>Point log</h2><div class="card table-card"><table><tr><th>#</th><th>Line</th><th>Pick</th><th class="n">Score</th></tr>`;
  if (!g.points.length) h += `<tr><td colspan="4" class="empty">No points logged yet</td></tr>`;
  g.points.forEach(p => { h += `<tr><td>${p.n}</td><td><span class="tag mini ${p.mode.toLowerCase()}">${p.mode}</span> ${esc(p.label)}</td><td>${p.option}</td><td class="n">${p.us}–${p.them}${p.halftimeAfter ? ' (half)' : ''}</td></tr>`; });
  h += `</table></div><div class="row"><button data-act="csv">Export points CSV</button><button data-act="json">Export game JSON</button></div>`;
  return h;
}

function settingsView() {
  const g = S.game, s = S.settings;
  const num = (k, l) => `<label class="f">${l}<input type="number" data-act="setting" data-k="${k}" value="${s[k]}" step="${k === 'fatigueWeight' ? 0.5 : 1}"></label>`;
  return `<h2 class="title">Settings</h2><h2>Game</h2><div class="card">
    <label class="f">Opponent<input type="text" data-act="game" data-k="opponent" value="${esc(g.opponent)}"></label>
    <div class="grid2">
      <label class="f">Game to<select data-act="game" data-k="gameTo">${[11, 13, 15].map(n => `<option ${g.gameTo == n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f">We start on<select data-act="game" data-k="weStart"><option value="O" ${g.weStart === 'O' ? 'selected' : ''}>Offense (they pull)</option><option value="D" ${g.weStart === 'D' ? 'selected' : ''}>Defense (we pull)</option></select></label>
    </div>
    <label class="check"><input type="checkbox" data-act="big" ${g.bigGame ? 'checked' : ''}> Big game (allow crossovers every D point)</label>
    <p class="sub">Halftime at ${halfAt(g)}. The other team pulls to start the second half.</p>
    <button class="danger" style="width:100%;margin-top:6px" data-act="newgame">New game (clears score & log)</button></div>
  <h2>Line rules</h2><div class="card grid2">
    ${num('restMargin', 'Rest O when up by')}${num('blowoutUp', 'O3 + rookies when up by')}
    ${num('blowoutDown', 'O3 / "?" when down by')}${num('maxConsecutive', 'Max points in a row')}
    ${num('fatigueWeight', 'Fatigue weight')}</div>
  <p class="sub" style="margin:0 4px">Data is saved in this browser only. Use Export on the Roster/Stats tabs to back up.</p>`;
}

function render() {
  scoreboard();
  $('#view').innerHTML = { game: gameView, roster: rosterView, stats: statsView, settings: settingsView }[tab]();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function download(filename, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#view').addEventListener('keydown', e => {
  const c = e.target.closest?.('[data-act="select"]');
  if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); }
});
function toTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
const buzz = () => { try { navigator.vibrate?.(12); } catch {} };
window.addEventListener('error', e => tell('Something went wrong', String(e.message || e.error)));
window.addEventListener('unhandledrejection', e => tell('Something went wrong', String(e.reason?.message || e.reason)));

const STATUS_LABEL = { available: 'Available', injured: 'Injured', unavailable: 'Out' };

// ---------- glass popover menu (replaces native <select> where it shows) ----------
function menu(anchor, items, current) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'menu-wrap';
    wrap.innerHTML = `<div class="menu" role="menu">${items.map(([v, l]) =>
      `<button role="menuitem" data-v="${v}" class="st-${v} ${v === current ? 'on' : ''}"><i></i>${esc(l)}${v === current ? '<b>✓</b>' : ''}</button>`).join('')}</div>`;
    document.body.appendChild(wrap);
    const m = wrap.firstChild, r = anchor.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
    const below = r.bottom + 6 + mh < window.innerHeight - 90;
    m.style.top = (below ? r.bottom + 6 : r.top - 6 - mh) + 'px';
    m.style.left = Math.max(12, Math.min(r.right - mw, window.innerWidth - mw - 12)) + 'px';
    m.style.transformOrigin = below ? 'top right' : 'bottom right';
    const done = v => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 140); removeEventListener('keydown', key); resolve(v); };
    const key = e => e.key === 'Escape' && done(null);
    wrap.addEventListener('click', e => { const b = e.target.closest('[data-v]'); done(b ? b.dataset.v : null); });
    addEventListener('keydown', key);
    m.querySelector('.on, button')?.focus();
  });
}

// ---------- substitution picker: only players listed for the slot, by group ----------
const O_TIERS = [['o', 'O'], ['o2', 'O2'], ['o3', 'O3'], ['dlo', 'D']];
const PD_FOR = { HD: ['best', 'handler'], CD: ['best', 'cutter'] };

function subGroups(slot, mode, currentId, onIds, assign = []) {
  // Teammates already playing this same slot (e.g. the other Wall) are left out: swapping them changes nothing.
  const sameSlot = new Set(assign.filter(x => x.slot === slot).map(x => x.id));
  const avail = S.roster.filter(p => p.id !== currentId && !sameSlot.has(p.id) && (p.status === 'available' || onIds.includes(p.id)));
  const seen = new Set(), groups = [];
  const add = (title, list) => { list = list.filter(x => !seen.has(x.p.id)); list.forEach(x => seen.add(x.p.id)); if (list.length) groups.push({ title, list }); };
  const onF = x => onIds.includes(x.p.id);
  const sortLR = l => l.sort((a, b) => onF(a) - onF(b) || a.lr - b.lr || a.p.name.localeCompare(b.p.name));
  if (O_SLOTS.includes(slot)) {
    for (const [k, t] of O_TIERS) add(t === 'D' ? 'D-Line O (off the D line)' : `${t} line`,
      sortLR(avail.map(p => ({ p, lr: parseSlots(p[k])[slot] })).filter(x => x.lr !== undefined).map(x => ({ ...x, tag: `${t} ${slot}${x.lr ? '?' : ''}`, off: t === 'D' }))));
  } else if (PD_FOR[slot]) {
    add(`Person D ${slot}`, sortLR(avail.filter(p => PD_FOR[slot].includes(p.pd)).map(p => ({ p, lr: false, tag: p.pd }))));
  } else {
    add(`Zone ${slot}`, sortLR(avail.map(p => ({ p, lr: parseSlots(p.zone)[slot] })).filter(x => x.lr !== undefined).map(x => ({ ...x, tag: `${slot}${x.lr ? '? last resort' : ''}` }))));
  }
  const rest = avail.filter(p => !seen.has(p.id)).map(p => ({ p, tag: 'not listed', off: true })).sort((a, b) => a.p.name.localeCompare(b.p.name));
  return { groups, rest };
}

function subSheet(slot, mode, currentId, onIds, assign) {
  return new Promise(resolve => {
    const { groups, rest } = subGroups(slot, mode, currentId, onIds, assign);
    const slotOf = id => assign.find(x => x.id === id)?.slot;
    const row = x => `<button class="sub-row ${x.off ? 'off' : ''}" data-v="${x.p.id}"><span class="avatar" style="--h:${hue(x.p.name)}">${esc(initials(x.p.name))}</span>
      <span class="sub-nm">${esc(x.p.name)}${onIds.includes(x.p.id) ? `<small>On field at ${esc(slotOf(x.p.id))}: swap spots</small>` : ''}</span><span class="tag mini ${x.off ? 'd' : 'o'}">${esc(x.tag)}</span></button>`;
    const el = document.createElement('div');
    el.className = 'sheet-wrap';
    el.innerHTML = `<div class="sheet sub-sheet" role="dialog" aria-modal="true" aria-label="Substitute ${slot}">
      <div class="grab"></div><h3>Sub in at <span class="badge">${slot}</span></h3>
      <p>${currentId ? `Replacing ${esc(name(currentId))}. ` : ''}${esc(ROLES[slot] || '')}</p>
      <div class="sub-list">${groups.map(g => `<div class="sub-h">${esc(g.title)}</div>${g.list.map(row).join('')}`).join('') || '<div class="sub-h">Nobody is listed for this slot</div>'}
      ${rest.length ? `<details class="more"><summary>Everyone else (${rest.length})</summary>${rest.map(row).join('')}</details>` : ''}</div>
      <div class="sheet-btns"><button data-v="">Cancel</button></div></div>`;
    const done = v => { el.classList.add('out'); setTimeout(() => el.remove(), 160); removeEventListener('keydown', key); resolve(v || null); };
    const key = e => e.key === 'Escape' && done(null);
    el.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v); else if (e.target === el) done(null); });
    addEventListener('keydown', key);
    document.body.appendChild(el);
  });
}

// ---------- in-app dialog (replaces native confirm/alert) ----------
function ask(title, body = '', { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'sheet-wrap';
    el.innerHTML = `<div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
      <h3 id="dlg-t">${esc(title)}</h3>${body ? `<p>${esc(body).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="sheet-btns">${cancel ? `<button data-r="0">${esc(cancel)}</button>` : ''}<button data-r="1" class="${danger ? 'danger-solid' : 'go'}">${esc(ok)}</button></div></div>`;
    const done = r => { el.classList.add('out'); setTimeout(() => el.remove(), 160); document.removeEventListener('keydown', key); resolve(r); };
    const key = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
    el.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === el) done(false); });
    document.addEventListener('keydown', key);
    document.body.appendChild(el);
    el.querySelector('[data-r="1"]').focus();
  });
}
const tell = (title, body) => ask(title, body, { cancel: '', ok: 'Got it' });

function rosterChanged() { S.game.options = null; if (!S.game.current) refreshOptions(); save(); }

// ---------- events ----------
document.querySelector('.tabs').addEventListener('click', e => {
  const t = e.target.closest('button')?.dataset.tab;
  if (t) { tab = t; render(); window.scrollTo(0, 0); }
});

$('#view').addEventListener('click', async e => {
  const b = e.target.closest('button, [data-act="select"]'); if (!b) return;
  buzz();
  const i = +b.dataset.i, g = S.game;
  switch (b.dataset.act) {
    case 'subMenu': {
      const c = g.current, a = c.assign[i];
      const v = await subSheet(a.slot, c.mode, a.id, c.assign.map(x => x.id).filter(Boolean), c.assign);
      if (v) swap(i, v, false);
      return;
    }
    case 'select': if (sel !== i) { sel = i; render(); } return;
    case 'statusMenu': {
      e.preventDefault(); // don't toggle the <details>
      const v = await menu(b, Object.entries(STATUS_LABEL), S.roster[i].status);
      if (v && v !== S.roster[i].status) { S.roster[i].status = v; rosterChanged(); render(); }
      return;
    }
    case 'pick': return pick(i);
    case 'us': return scored('us');
    case 'them': return scored('them');
    case 'undo': return (await ask('Undo the last point?', `Score goes back to ${g.points.at(-1)?.scoredBy === 'us' ? g.us - 1 : g.us}–${g.points.at(-1)?.scoredBy === 'them' ? g.them - 1 : g.them} and that line returns to the field.`, { ok: 'Undo point' })) && undo();
    case 'back': g.current = null; save(); return render();
    case 'injure': {
      const a = g.current.assign[i], ctx = context(g);
      ctx.roster = S.roster.map(p => p.id === a.id ? { ...p, status: 'injured' } : p);
      const rep = replacements(ctx, a.slot, g.current.assign.map(x => x.id))[0];
      if (!rep) return tell(`No ${a.slot} available`, 'Pick a replacement from the dropdown instead.');
      if (await ask(`Sub out ${name(a.id)}?`, `${name(rep.id)} comes in at ${a.slot}. ${first(name(a.id))} is marked injured.`, { ok: `Sub in ${first(name(rep.id))}` })) swap(i, rep.id, true);
      return;
    }
    case 'newgame':
      if (g.points.length && !(await ask('Start a new game?', 'The score and point log will be cleared. Export stats first if you need them.', { ok: 'New game', danger: true }))) return;
      S.game = newGame(g); S.roster.forEach(p => { if (p.status === 'injured') p.status = 'available'; });
      refreshOptions(); save(); tab = 'game'; return render();
    case 'add': S.roster.push({ ...withIds([{ name: 'New Player' }])[0], id: 'p' + Date.now(), o: '', o2: '', o3: '', dlo: '', zone: '', rookie: false, cross: 0, status: 'available', notes: '' }); rosterChanged(); return render();
    case 'del': if (await ask(`Remove ${S.roster[i].name}?`, 'They will be taken off the roster.', { ok: 'Remove', danger: true })) { S.roster.splice(i, 1); rosterChanged(); render(); } return;
    case 'healAll': S.roster.forEach(p => p.status = 'available'); rosterChanged(); return render();
    case 'resetRoster': if (await ask('Replace the roster?', 'Your current players will be replaced with the sample roster.', { ok: 'Replace', danger: true })) loadSampleRoster(ROSTER_URL).then(r => { S.roster = r; rosterChanged(); render(); }).catch(err => tell('Could not load roster', err.message)); return;
    case 'exportRoster': return download(`roster-${new Date().toISOString().slice(0, 10)}.xlsx`, writeXlsx(rosterToRows(S.roster)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    case 'importRoster': {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        try {
          const { roster, warnings } = /\.json$/i.test(f.name)
            ? normalizeRoster(JSON.parse(await f.text()))            // old JSON backups still work
            : rowsToRoster(await readXlsx(await f.arrayBuffer()), S.roster);
          S.roster = roster; rosterChanged(); render();
          if (warnings.length) tell('Imported with notes', warnings.join('\n'));
        } catch (err) { tell('Could not import', err.message || 'That file is not a roster spreadsheet.'); }
      };
      return inp.click();
    }
    case 'json': return download(`game-${g.opponent || 'unnamed'}.json`, JSON.stringify({ game: g, roster: S.roster }, null, 2));
    case 'csv': {
      const rows = [['point', 'mode', 'label', 'option', 'scored_by', 'us', 'them', ...g.points[0]?.assign.map((_, k) => `player${k + 1}`) ?? []]];
      g.points.forEach(p => rows.push([p.n, p.mode, p.label, p.option, p.scoredBy, p.us, p.them, ...p.assign.map(a => `${a.slot}:${name(a.id)}`)]));
      return download('points.csv', rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    }
  }
});

$('#view').addEventListener('change', e => {
  const t = e.target, i = +t.dataset.i;
  switch (t.dataset.act) {
    case 'swap': return t.value && swap(i, t.value, false);
    case 'status': S.roster[i].status = t.value; rosterChanged(); return render();
    case 'field': S.roster[i][t.dataset.k] = t.value; return rosterChanged();
    case 'rookie': S.roster[i].rookie = t.checked; return rosterChanged();
    case 'cross': S.roster[i].cross = +t.value; return rosterChanged();
    case 'setting': S.settings[t.dataset.k] = +t.value; return rosterChanged();
    case 'game': S.game[t.dataset.k] = t.dataset.k === 'gameTo' ? +t.value : t.value; rosterChanged(); return render();
    case 'big': S.game.bigGame = t.checked; rosterChanged(); return render();
  }
});

async function boot() {
  if (!S.roster?.length) {
    try { S.roster = await loadSampleRoster(ROSTER_URL); save(); }
    catch (err) { console.error(err); }
  }
  // Team links: the team file's rules (e.g. Block: max 3 on the sideline, O/D interchange, 3 handlers) always apply.
  if (TEAM) {
    try {
      const t = await loadTeam(ROSTER_URL);
      S.settings = { ...S.settings, ...t.settings };
      // Newer team file than the saved roster → refresh it, keeping each player's injured/unavailable status.
      if (t.version && t.version !== S.teamVersion) {
        const status = Object.fromEntries((S.roster || []).map(p => [p.name.trim().toLowerCase(), p.status]));
        S.roster = t.roster.map(p => ({ ...p, status: status[p.name.trim().toLowerCase()] || p.status }));
        S.teamVersion = t.version;
        if (S.game) S.game.options = null; // re-suggest; a line already on the field is kept (ids are stable)
      }
      save();
    } catch (err) { console.error(err); }
  }
  S.game.options = null; refreshOptions(); render();
}
boot();
