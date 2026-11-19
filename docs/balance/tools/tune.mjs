// node tune.mjs roster(.mjs|.json) seed iterations out.json
// Simulated annealing over every number of every fighter (effects stay as designed).
// Env: EVEN_W weight of order-decided matchups (default 1.2), T0 start temperature (default 0.02).
import { writeFileSync } from 'node:fs';
import { solve, botScore, rank, loadRoster } from './lib.mjs';
const [rosterPath, seedArg, itArg, out] = process.argv.slice(2);
const FIGHTERS = await loadRoster(rosterPath);
let seed = +seedArg || 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const F = structuredClone(FIGHTERS);
const ids = Object.keys(F);
const TIER = { common: { hp: [14, 21], attack: [3, 5] }, rare: { hp: [17, 24], attack: [4, 6] }, epic: { hp: [20, 27], attack: [5, 7] }, legendary: { hp: [24, 30], attack: [6, 8] } };
const SK = { power: [-1, 6], heal: [1, 8], shield: [2, 9], weaken: [1, 3], buff: [1, 2], execute: [1, 5], team: [2, 6], recoil: [1, 3] };
const ULT = { ...SK, power: [0, 9], shield: [3, 10], heal: [2, 9] };
const TR = { armor: [1, 2], thorns: [1, 2], regen: [1, 2], rage: [1, 3], vamp: [1, 2] };
// Every number the search may move, as [id, path, lo, hi].
const knobs = [];
for (const id of ids) {
  const f = F[id], t = TIER[f.rarity];
  knobs.push([id, ['hp'], ...t.hp], [id, ['attack'], ...t.attack]);
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
function pair(a, b) {
  const k = JSON.stringify(F[a]) + '#' + JSON.stringify(F[b]);
  let v = cache.get(k);
  if (!v) { v = { r: solve(F[a], F[b], 0, true, 2e5), bot: botScore(F[a], F[b], 24) }; cache.set(k, v); }
  return v;
}
const R = {};
for (const a of ids) { R[a] = {}; for (const b of ids) if (a !== b) R[a][b] = pair(a, b); }
const pts = r => r === null ? 0.5 : (r + 1) / 2;
const s = (a, b) => (pts(R[a][b].r) + 1 - pts(R[b][a].r)) / 2;
const bs = (a, b) => (R[a][b].bot + 1 - R[b][a].bot) / 2;
const tiers = ['common', 'rare', 'epic', 'legendary'];
const groups = tiers.map(t => ids.filter(i => F[i].rarity === t));
function objective(detail = false) {
  const c = { spread: 0, even: 0, counters: 0, bot: 0, cross: 0, draws: 0, top: 0, unsolved: 0 };
  groups.forEach((G, gi) => {
    const need = G.length <= 4 ? 1 : 2;
    let even = 0, pairs = 0, draws = 0, top = 0;
    for (const i of G) {
      let a = 0, b = 0, w = 0, l = 0;
      for (const j of G) if (j !== i) {
        const x = s(i, j); a += x; b += bs(i, j);
        if (x === 1) w++; else if (x === 0) l++; else even++;
        if (R[i][j].r === 0) draws++;
        if (R[i][j].r === null) c.unsolved += 1;
        pairs++;
      }
      a /= G.length - 1; b /= G.length - 1;
      c.spread += 8 * (a - 0.5) ** 2 / G.length;
      c.bot += 3 * (b - 0.5) ** 2 / G.length;
      c.counters += 0.12 * (Math.max(0, need - w) + Math.max(0, need - l)) / G.length;
      top = Math.max(top, a);
    }
    c.even += (+process.env.EVEN_W || 1.2) * even / pairs / 4;
    c.draws += draws / pairs / 4;
    c.top += 5 * Math.max(0, top - 0.68) ** 2;
  });
  for (let u = 0; u < 4; u++) for (let v = 0; v < u; v++) {
    let x = 0, y = 0, n = 0;
    for (const a of groups[u]) for (const b of groups[v]) { x += s(a, b); y += bs(a, b); n++; }
    x /= n; y /= n;
    const lo = u - v === 1 ? 0.8 : 0.95, hi = u - v === 1 ? 0.94 : 1;
    c.cross += 10 * (Math.max(0, lo - x) ** 2 + Math.max(0, x - hi) ** 2) + 4 * Math.max(0, (u - v === 1 ? 0.75 : 0.9) - y) ** 2;
  }
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
  const touched = [...new Set(moves.map(m => m[0]))];
  const saved = [];
  for (const a of touched) for (const b of ids) if (a !== b) {
    saved.push([a, b, R[a][b]], [b, a, R[b][a]]);
    R[a][b] = pair(a, b); R[b][a] = pair(b, a);
  }
  const J2 = objective();
  if (J2 <= J || rnd() < Math.exp((J - J2) / T)) {
    J = J2;
    if (J < best) { best = J; bestF = structuredClone(F); }
  } else {
    for (const [id, path, old] of moves.reverse()) set(F[id], path, old);
    for (const [a, b, v] of saved.reverse()) R[a][b] = v;
  }
  if (it % 200 === 0 || it === iters - 1) {
    writeFileSync(out, JSON.stringify({ it, J, best, secs: (Date.now() - t0) / 1000, cache: cache.size, detail: objective(true), F: bestF }));
    if (cache.size > 400000) cache.clear();
  }
}
