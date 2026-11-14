import { O_SLOTS, ZONE_SLOTS, PERSON_SLOTS, HC_FALLBACK_SLOTS } from './roster.js';

const MISSING = 1000; // cost of leaving a slot empty (flagged to coach)

/** "IC, SC, Sheep?" -> { IC:false, SC:false, Sheep:true }  (value = last resort) */
export function parseSlots(str) {
  const out = {};
  (str || '').split(',').map(s => s.trim()).filter(s => s && s !== '-').forEach(s => {
    const lr = s.endsWith('?');
    out[s.replace(/\?/g, '').trim()] = lr;
  });
  return out;
}

export const isOPlayer = p => Object.keys(parseSlots(p.o)).length > 0;

/** Consecutive and total points played, from the point log. */
export function playerStats(points) {
  const total = {}, consec = {};
  for (const pt of points) for (const id of pt.players) total[id] = (total[id] || 0) + 1;
  for (const id of Object.keys(total)) {
    let c = 0;
    for (let i = points.length - 1; i >= 0 && points[i].players.includes(id); i--) c++;
    consec[id] = c;
  }
  return { total, consec };
}

/** Breaks from the point log: our breaks = D points we scored; theirs = O points they scored. */
export function gameStats(points) {
  const breaksUs = points.filter(p => p.mode === 'D' && p.scoredBy === 'us').length;
  const breaksThem = points.filter(p => p.mode === 'O' && p.scoredBy === 'them').length;
  return { breaksUs, breaksThem, breakMargin: breaksUs - breaksThem };
}

/** rest: up restMargin+ breaks (v0.3) — or points if settings.restBy === 'points' or ctx.breakMargin is missing. */
export function flags(ctx) {
  const s = ctx.settings, m = ctx.margin;
  const restBasis = s.restBy === 'points' || ctx.breakMargin === undefined ? m : ctx.breakMargin;
  return { win: m >= s.blowoutUp, lose: m <= -s.blowoutDown, rest: restBasis >= s.restMargin };
}

/** Max points in a row for a player: own override, else Best Player default, else everyone-else default. */
export function maxConsecFor(p, settings) {
  if (p.maxConsec > 0) return p.maxConsec;
  return p.pd === 'best' ? settings.maxConsecutiveBest : settings.maxConsecutive;
}

function fatigue(p, ctx) {
  const s = ctx.settings;
  const c = ctx.stats.consec[p.id] || 0, t = ctx.stats.total[p.id] || 0;
  const lim = maxConsecFor(p, s), r = (c * 3) / lim; // scaled so every player ramps up toward their own limit
  let x = s.fatigueWeight * r * r + 0.2 * t;
  if (c >= lim) x += 60; // over the limit: bottom of both options (still below an empty slot)
  return x;
}

const available = ctx => ctx.roster.filter(p => p.status === 'available');

/** O point: for each offensive slot, list of {id, cost, group}. */
function offenseEdges(ctx) {
  const { win, lose, rest } = flags(ctx);
  const gcost = { o: win ? 12 : rest ? 4 : 0, o2: win ? 2 : 5, o3: win ? 0 : lose ? 3 : 25 };
  const edges = Object.fromEntries(O_SLOTS.map(s => [s, []]));
  for (const p of available(ctx)) {
    const base = fatigue(p, ctx) + (p.rookie && win ? -2 : 0);
    for (const slot of O_SLOTS) {
      let best = null;
      for (const g of ['o', 'o2', 'o3']) {
        const m = parseSlots(p[g]);
        let c = null;
        if (slot in m) c = gcost[g] + (m[slot] && !lose ? 10 : 0);
        else if (HC_FALLBACK_SLOTS.includes(slot) && 'HC' in m) c = gcost[g] + 20; // emergency handler
        if (c !== null && (!best || c < best.cost)) best = { cost: c, group: g, fallback: !(slot in m) };
      }
      if (best) edges[slot].push({ id: p.id, cost: best.cost + base, group: best.group, fallback: best.fallback });
    }
  }
  // Fill-in: a slot nobody on the roster can play (e.g. a team with no HC) is filled by any offensive
  // player, tagged so the coach sees it. Still flagged as empty if there are no offensive players at all.
  for (const slot of O_SLOTS) {
    if (edges[slot].length) continue;
    for (const p of available(ctx)) {
      const base = fatigue(p, ctx) + (p.rookie && win ? -2 : 0);
      const g = ['o', 'o2', 'o3'].filter(k => Object.keys(parseSlots(p[k])).length).sort((a, b) => gcost[a] - gcost[b])[0];
      if (g) edges[slot].push({ id: p.id, cost: gcost[g] + 30 + base, group: g, fillIn: true });
    }
  }
  return edges;
}

/** D point player base cost (crossovers, rookies). */
function defenseBase(p, ctx) {
  const { win } = flags(ctx);
  let c = fatigue(p, ctx);
  if (isOPlayer(p)) {
    const moment = ctx.halfPoint || ctx.gamePoint || ctx.bigGame;
    c += p.cross === 1 && moment ? 3 : p.cross === 2 && moment ? 6 : 30;
  } else if (p.rookie) c += win ? -2 : 3;
  return c;
}

function defenseEdges(ctx) {
  const { lose } = flags(ctx);
  const edges = {};
  for (const s of ZONE_SLOTS) edges[s] = [];
  for (const p of available(ctx)) {
    const z = parseSlots(p.zone), base = defenseBase(p, ctx);
    for (const s of Object.keys(edges)) if (s in z) edges[s].push({ id: p.id, cost: base + (z[s] ? (lose ? 2 : 10) : 0), group: 'd' });
  }
  return edges;
}

/** Person D: HD = handler defender, CD = cutter defender. best = either; '' = last resort for either. */
function personEdges(ctx) {
  const { lose } = flags(ctx);
  const edges = { HD: [], CD: [] };
  for (const p of available(ctx)) {
    const base = defenseBase(p, ctx), r = p.pd || '';
    const lr = lose ? 2 : 10;
    if (r === 'best' || r === 'handler') edges.HD.push({ id: p.id, cost: base + (r === 'best' ? 1 : 0), group: 'd' });
    if (r === 'best' || r === 'cutter') edges.CD.push({ id: p.id, cost: base + (r === 'best' ? 1 : 0), group: 'd' });
    if (!r) { edges.HD.push({ id: p.id, cost: base + lr, group: 'd', lastResort: true }); edges.CD.push({ id: p.id, cost: base + lr, group: 'd', lastResort: true }); }
  }
  return edges;
}

/** Can these 7 play person D? Max matching onto 3 HD + 4 CD. Returns {HD:[ids], CD:[ids], gaps}. */
export function matchPerson(ids, byId) {
  const h = [], c = [], best = [], none = [];
  ids.forEach(id => ({ handler: h, cutter: c, best }[byId[id].pd] || none).push(id));
  const HD = h.slice(0, 3), CD = c.slice(0, 4);
  for (const id of [...best, ...none, ...h.slice(3), ...c.slice(4)]) {
    const r = byId[id].pd;
    if (r === 'handler' || r === 'cutter') continue; // overflow specialists can't cover the other side
    if (HD.length < 3) HD.push(id); else if (CD.length < 4) CD.push(id);
  }
  return { HD, CD, gaps: (3 - HD.length) + (4 - CD.length), lastResort: none.filter(id => HD.includes(id) || CD.includes(id)).length };
}

/** Max matching of players -> D-Line O slots (Kuhn's algorithm). Returns {slot:id}. */
export function matchDLineO(ids, byId) {
  const elig = ids.map(id => parseSlots(byId[id].dlo));
  const slotOwner = {};
  const tryAssign = (i, seen) => {
    for (const s of O_SLOTS) {
      if (!(s in elig[i]) || seen.has(s)) continue;
      seen.add(s);
      if (slotOwner[s] === undefined || tryAssign(slotOwner[s], seen)) { slotOwner[s] = i; return true; }
    }
    return false;
  };
  ids.forEach((_, i) => tryAssign(i, new Set()));
  const out = {};
  for (const s of O_SLOTS) out[s] = slotOwner[s] === undefined ? null : ids[slotOwner[s]];
  return out;
}

/**
 * Branch-and-bound min-cost assignment of `slots` (keys may repeat) to distinct players.
 * extra(id): added cost per player; leaf(ids): extra cost for a full lineup (Infinity = reject).
 */
function solve(slots, edges, { extra = () => 0, leaf = () => 0, budget = 400000 } = {}) {
  const order = slots.map((k, i) => ({ k, i })).sort((a, b) => edges[a.k].length - edges[b.k].length);
  const lists = order.map(o => edges[o.k].map(e => ({ ...e, cost: e.cost + extra(e.id) })).sort((a, b) => a.cost - b.cost));
  const minRest = new Array(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) minRest[i] = minRest[i + 1] + Math.min(lists[i][0]?.cost ?? MISSING, MISSING);

  let best = null, bestCost = Infinity, nodes = 0;
  const pick = new Array(order.length), used = new Set(), lastIdx = {};
  const dfs = (d, cost) => {
    if (++nodes > budget) return;
    if (cost + minRest[d] >= bestCost) return;
    if (d === order.length) {
      const ids = pick.filter(Boolean).map(e => e.id);
      const lc = leaf(ids);
      if (cost + lc < bestCost) { bestCost = cost + lc; best = pick.slice(); }
      return;
    }
    const key = order[d].k, start = (lastIdx[key] ?? -1) + 1, prev = lastIdx[key];
    for (let j = start; j < lists[d].length; j++) { // ordered picks for duplicate slots (Wall/Wall)
      const e = lists[d][j];
      if (used.has(e.id)) continue;
      used.add(e.id); pick[d] = e; lastIdx[key] = j;
      dfs(d + 1, cost + e.cost);
      used.delete(e.id); lastIdx[key] = prev;
    }
    pick[d] = null; // leave slot empty (flagged)
    dfs(d + 1, cost + MISSING);
  };
  dfs(0, 0);
  if (!best) return null;
  const assign = new Array(slots.length);
  order.forEach((o, d) => { assign[o.i] = best[d] ? { slot: o.k, ...best[d] } : { slot: o.k, id: null, cost: MISSING }; });
  return { assign, cost: bestCost };
}

function lineupFor(ctx, extra) {
  const byId = Object.fromEntries(ctx.roster.map(p => [p.id, p]));
  if (ctx.mode === 'O') {
    const r = solve(O_SLOTS, offenseEdges(ctx), { extra });
    return r && { mode: 'O', assign: r.assign, players: r.assign.map(a => a.id).filter(Boolean), cost: r.cost };
  }
  const scheme = ctx.dScheme || 'zone';
  // Rosters without any D-Line O data (e.g. a sheet with that column blank) skip the after-turn check,
  // otherwise O players would be dragged onto D just to cover it.
  const hasDlo = ctx.roster.some(p => Object.keys(parseSlots(p.dlo)).length);
  const leaf = ids => {
    let c = hasDlo ? Object.values(matchDLineO(ids, byId)).filter(v => !v).length * 40 : 0;
    if (scheme === 'both') { const m = matchPerson(ids, byId); c += m.gaps * 40 + m.lastResort * 10; }
    return c;
  };
  const r = scheme === 'person'
    ? solve(PERSON_SLOTS, personEdges(ctx), { extra, leaf })
    : solve(ZONE_SLOTS, defenseEdges(ctx), { extra, leaf });
  if (!r) return null;
  const players = r.assign.map(a => a.id).filter(Boolean);
  const out = { mode: 'D', scheme, assign: r.assign, players, dlo: matchDLineO(players, byId), cost: r.cost };
  if (scheme === 'both') out.person = matchPerson(players, byId);
  return out;
}

const first = n => n.split(' ')[0];

function label(lu, ctx, base) {
  const byId = Object.fromEntries(ctx.roster.map(p => [p.id, p]));
  if (base) {
    const out = base.players.filter(id => !lu.players.includes(id)).map(id => first(byId[id].name));
    const inn = lu.players.filter(id => !base.players.includes(id)).map(id => first(byId[id].name));
    return out.length ? `Rest ${out.join(', ')} · in ${inn.join(', ')}` : 'Same line';
  }
  if (lu.mode === 'O') {
    const g = lu.assign.map(a => a.group);
    const subs = g.filter(x => x !== 'o').length, o3 = g.filter(x => x === 'o3').length;
    if (!subs) return 'Full O';
    if (o3 >= 4) return 'O3 line';
    return `O + ${subs} sub${subs > 1 ? 's' : ''}`;
  }
  const cross = lu.players.filter(id => isOPlayer(byId[id])).map(id => first(byId[id].name));
  return cross.length ? `D + ${cross.join(', ')} crossover` : 'Core D';
}

/** Two ranked, meaningfully different options. */
export function suggest(ctx) {
  const opt1 = lineupFor(ctx, () => 0);
  if (!opt1) return [];
  opt1.label = label(opt1, ctx);
  let opt2 = null;
  for (const pen of [4, 8, 16, 32]) {
    const cand = lineupFor(ctx, id => (opt1.players.includes(id) ? pen : 0));
    if (cand && cand.players.filter(id => !opt1.players.includes(id)).length >= 2) { opt2 = cand; break; }
    opt2 = cand;
  }
  const res = [opt1];
  if (opt2 && opt2.players.some(id => !opt1.players.includes(id))) { opt2.label = label(opt2, ctx, opt1); res.push(opt2); }
  return res;
}

/** Best replacement for one slot (injury / edit), excluding players already on. */
export function replacements(ctx, slot, excludeIds) {
  const edges = ctx.mode === 'O' ? offenseEdges(ctx) : ctx.dScheme === 'person' ? personEdges(ctx) : defenseEdges(ctx);
  return (edges[slot] || []).filter(e => !excludeIds.includes(e.id)).sort((a, b) => a.cost - b.cost);
}
