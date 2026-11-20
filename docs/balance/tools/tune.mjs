// node tune.mjs roster(.mjs|.json) seed iterations out.json
// Simulated annealing over every number of every fighter, speed included (effects stay as designed).
// Goal (rounds 3–4): inside a rarity the fighters form a ladder from weak to strong, so collecting and
// hunting for the best ones is worth it, yet even the strongest has counters. A higher rarity is
// usually stronger, but the best of a lower rarity can beat the weakest of the next one.
// Env: EVEN_W weight of order-decided pairs (default 1.2), T0 start temperature (default 0.02),
//      TOP / BOTTOM in-tier ladder ends (default 0.74 / 0.28).
import { writeFileSync } from 'node:fs';
import { solve, botScore, loadRoster, pairScore, opens } from './lib.mjs';
const [rosterPath, seedArg, itArg, out] = process.argv.slice(2);
const FIGHTERS = await loadRoster(rosterPath);
let seed = +seedArg || 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const F = structuredClone(FIGHTERS);
const ids = Object.keys(F);
const TIER = { common: { hp: [14, 22], attack: [3, 5] }, rare: { hp: [16, 25], attack: [4, 6] }, epic: { hp: [19, 28], attack: [4, 7] }, legendary: { hp: [23, 30], attack: [5, 8] } };
const SK = { power: [-1, 6], heal: [1, 8], shield: [2, 9], weaken: [1, 3], buff: [1, 2], execute: [1, 5], team: [2, 6], recoil: [1, 3],
  sleep: [1, 2], leech: [1, 3], hits: [2, 4], charge: [1, 2] };
const ULT = { ...SK, power: [0, 9], shield: [3, 10], heal: [2, 9] };
const TR = { armor: [1, 2], thorns: [1, 2], regen: [1, 2], rage: [1, 3], vamp: [1, 2], intimidate: [1, 2] };
// Every number the search may move, as [id, path, lo, hi].
// FOCUS=epic,legendary moves only those tiers and scores only their pairs (a quick follow-up pass).
const FOCUS = process.env.FOCUS ? process.env.FOCUS.split(',') : null;
const knobs = [];
for (const id of ids) {
  const f = F[id], t = TIER[f.rarity];
  if (FOCUS && !FOCUS.includes(f.rarity)) continue;
  f.speed ??= 5;
  knobs.push([id, ['hp'], ...t.hp], [id, ['attack'], ...t.attack], [id, ['speed'], 1, 9]);
  for (const [part, table] of [['skill', SK], ['ultimate', ULT]]) {
    const s = f[part]; if (!s) continue;
    if (part === 'skill') knobs.push([id, [part, 'cost'], 1, 2]);
    for (const k of Object.keys(table)) if (Number.isFinite(s[k])) knobs.push([id, [part, k], ...table[k]]);
    if (s.burn) knobs.push([id, [part, 'burn', 'dmg'], 1, 4], [id, [part, 'burn', 'turns'], 2, 4]);
  }
  if (f.trait) for (const k of Object.keys(TR)) if (Number.isFinite(f.trait[k])) knobs.push([id, ['trait', k], ...TR[k]]);
}
const get = (o, p) => p.reduce((x, k) => x[k], o);
const set = (o, p, v) => { const last = p.at(-1); p.slice(0, -1).reduce((x, k) => x[k], o)[last] = v; };
const cache = new Map();
// One ordered fight: a moves first, b gets the tempo energy. Cached by both fighters' full stats.
function fight(a, b) {
  const k = JSON.stringify(F[a]) + '#' + JSON.stringify(F[b]);
  let v = cache.get(k);
  if (v === undefined) { v = solve(F[a], F[b], 0, true, 2e6); cache.set(k, v); }
  return v;
}
function botPair(a, b) {
  const k = 'bot' + JSON.stringify(F[a]) + '#' + JSON.stringify(F[b]);
  let v = cache.get(k);
  if (v === undefined) { v = botScore(F[a], F[b], 24); cache.set(k, v); }
  return v;
}
// Only the order that speed allows is solved; equal speed needs both.
function s(a, b) {
  const o = opens(F[a], F[b]);
  return pairScore(F[a], F[b], o === 1 ? null : fight(a, b), o === 0 ? null : fight(b, a));
}
const ordered = (a, b) => { const o = opens(F[a], F[b]); return o === 1 ? fight(b, a) : fight(a, b); };
const bs = (a, b) => botPair(a, b);
const tiers = ['common', 'rare', 'epic', 'legendary'];
const groups = tiers.map(t => ids.filter(i => F[i].rarity === t));
const TOP = +process.env.TOP || 0.74, BOTTOM = +process.env.BOTTOM || 0.28;
const ladder = n => Array.from({ length: n }, (_, k) => TOP - (TOP - BOTTOM) * k / (n - 1));
function objective(detail = false) {
  const c = { ladder: 0, even: 0, counters: 0, bot: 0, cross: 0, legendCounter: 0, draws: 0, top: 0, unsolved: 0 };
  groups.forEach((G, gi) => {
    if (FOCUS && !FOCUS.includes(tiers[gi])) return;
    const need = G.length <= 4 ? 1 : 2;
    let even = 0, pairs = 0, draws = 0, top = 0;
    const A = [], B = [];
    for (const i of G) {
      let a = 0, b = 0, w = 0, l = 0;
      for (const j of G) if (j !== i) {
        const x = s(i, j); a += x; b += bs(i, j);
        if (x === 1) w++; else if (x === 0) l++; else even++;
        const r = ordered(i, j);
        if (r === 0) draws++;
        if (r === null) c.unsolved += 1;
        pairs++;
      }
      a /= G.length - 1; b /= G.length - 1;
      A.push(a); B.push(b);
      // No meta: even the best fighter loses to some, and even the weakest beats someone.
      c.counters += 0.12 * (Math.max(0, 1 - w) + Math.max(0, need - l)) / G.length;
      top = Math.max(top, a);
    }
    const goal = ladder(G.length);
    A.sort((x, y) => y - x); B.sort((x, y) => y - x);
    c.ladder += 8 * A.reduce((p, x, k) => p + (x - goal[k]) ** 2, 0) / G.length;
    c.bot += 2 * B.reduce((p, x, k) => p + (x - goal[k]) ** 2, 0) / G.length;
    c.even += (+process.env.EVEN_W || 1.2) * even / pairs / 4;
    c.draws += draws / pairs / 4;
    c.top += 5 * Math.max(0, top - 0.85) ** 2;
  });
  // A rarity above wins most fights, two above nearly all; the overlap leaves room for upsets.
  // Legendaries beat most epics but not all: every legendary has an epic that beats it outright
  // (a fighter that hits its weak spot), so even the top tier has a counter worth looking for.
  for (let u = 0; u < 4; u++) for (let v = 0; v < u; v++) {
    if (FOCUS && !(FOCUS.includes(tiers[u]) && FOCUS.includes(tiers[v]))) continue;
    let x = 0, y = 0, n = 0;
    for (const a of groups[u]) for (const b of groups[v]) { x += s(a, b); y += bs(a, b); n++; }
    x /= n; y /= n;
    const d = u - v, lo = [0, 0.72, 0.9, 0.97][d], hi = [0, u === 3 ? 0.86 : 0.88, 1, 1][d];
    c.cross += 10 * (Math.max(0, lo - x) ** 2 + Math.max(0, x - hi) ** 2) + 4 * Math.max(0, lo - 0.04 - y) ** 2;
  }
  // Each legend has its own counter: no epic may be the answer to more than two legends.
  c.legendCounter = 0;
  const kills = new Map();
  for (const L of groups[3]) {
    const by = groups[2].filter(e => s(e, L) === 1);
    for (const e of by) kills.set(e, (kills.get(e) ?? 0) + 1);
    c.legendCounter += 0.25 * Math.max(0, 1 - by.length) + 0.05 * Math.max(0, by.length - 3);
  }
  for (const n of kills.values()) c.legendCounter += 0.12 * Math.max(0, n - 2);
  const J = Object.values(c).reduce((p, q) => p + q, 0);
  return detail ? { J, ...c } : J;
}
let J = objective(), best = J, bestF = structuredClone(F);
const iters = +itArg;
const t0 = Date.now();
for (let it = 0; it < iters; it++) {
  const T = (+process.env.T0 || 0.02) * Math.pow(0.02, it / iters);
  const moves = [];
  const n = rnd() < 0.7 ? 1 : 2;
  for (let m = 0; m < n; m++) {
    const [id, path, lo, hi] = knobs[Math.floor(rnd() * knobs.length)];
    const old = get(F[id], path);
    const nv = Math.min(hi, Math.max(lo, old + (rnd() < 0.5 ? -1 : 1)));
    if (nv === old) continue;
    set(F[id], path, nv); moves.push([id, path, old]);
  }
  if (!moves.length && it !== iters - 1) continue;
  const J2 = objective();
  if (J2 <= J || rnd() < Math.exp((J - J2) / T)) {
    J = J2;
    if (J < best) { best = J; bestF = structuredClone(F); }
  } else {
    for (const [id, path, old] of moves.reverse()) set(F[id], path, old);
  }
  if (it % 200 === 0 || it === iters - 1) {
    writeFileSync(out, JSON.stringify({ it, J, best, secs: (Date.now() - t0) / 1000, cache: cache.size, detail: objective(true), F: bestF }));
    if (cache.size > 300000) cache.clear();
  }
}
