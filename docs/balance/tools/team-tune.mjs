// Team balance by simulation: random 3-on-3 battles between all fighters, a logistic model of who
// wins (each fighter's strength θ, adjusted for teammates and opponents), and a loop that nudges
// health and attack towards a target strength per fighter.
//
//   node team-tune.mjs play  <overrides.json> <shard> <shards> <deals> <nodes> <seed> <out.jsonl>
//   node team-tune.mjs fit   <out.jsonl>...            → θ per fighter (JSON to stdout)
//   node team-tune.mjs loop  <dir> <iterations> <workers> <deals> <nodes>
//
// Overrides: { id: { hp, attack } } replace a fighter's base health and attack. Every fighter plays
// at level 5, both sides are the strong computer player with a fixed node budget, and every deal is
// played twice with the sides swapped, so neither the opener nor the side decides.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMove, battleStats, opener, startBattle } from '../../../public/js/duel-engine.js';
import { smartMove } from '../../../public/js/duel-ai.js';
import { FIGHTERS } from '../../../public/js/fighters.js';
import { cardFor } from '../../../public/js/game.js';

const menu = JSON.parse(readFileSync(new URL('../../../public/data/menu.json', import.meta.url)));
const IDS = Object.keys(FIGHTERS).sort();
const LEVEL = 5;
const seq = seed => { let s = (seed % 2147483646) + 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

function applyOverrides(overrides) {
  for (const [id, o] of Object.entries(overrides ?? {})) {
    if (!FIGHTERS[id]) continue;
    if (Number.isSafeInteger(o.hp)) FIGHTERS[id].hp = o.hp;
    if (Number.isSafeInteger(o.attack)) FIGHTERS[id].attack = o.attack;
  }
}

function play(cards, A, B, seed, nodes) {
  const teams = [A.map(id => battleStats(cards[id])), B.map(id => battleStats(cards[id]))];
  const random = seq(seed);
  let s = startBattle(teams, opener(teams, 0), { tempo: false });
  while (s.winner === null) s = applyMove(s, s.turn, smartMove(s, s.turn, { nodes, random }));
  return s.winner === 'draw' ? 0.5 : s.winner === 0 ? 1 : 0;
}

function playShard([file, shard, shards, deals, nodes, seed, out]) {
  applyOverrides(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
  const cards = Object.fromEntries(IDS.map(id => [id, cardFor(menu.find(m => m.id === id), LEVEL)]));
  for (let d = +shard; d < +deals; d += +shards) {
    const r = seq(1000003 * (d + 1) + 7919 * +seed);
    const pool = [...IDS];
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    const A = pool.slice(0, 3), B = pool.slice(3, 6);
    const ab = play(cards, A, B, 7 * d + 11 + +seed, +nodes), ba = play(cards, B, A, 7 * d + 13 + +seed, +nodes);
    appendFileSync(out, JSON.stringify({ A, B, ab, ba }) + '\n');
  }
}

// Ridge-regularised logistic regression by Newton steps: P(side 0 wins) = σ(Σθ side 0 − Σθ side 1 + bias).
export function fit(deals, lambda = 0.5) {
  const index = Object.fromEntries(IDS.map((id, i) => [id, i])), P = IDS.length + 1;
  const rows = [];
  for (const d of deals) for (const [S0, S1, w] of [[d.A, d.B, d.ab], [d.B, d.A, d.ba]]) {
    const x = new Float64Array(P);
    for (const id of S0) x[index[id]] += 1;
    for (const id of S1) x[index[id]] -= 1;
    x[P - 1] = 1;
    rows.push([x, w]);
  }
  const b = new Float64Array(P);
  for (let it = 0; it < 25; it++) {
    const H = Array.from({ length: P }, () => new Float64Array(P)), g = new Float64Array(P);
    for (const [x, y] of rows) {
      let z = 0; for (let i = 0; i < P; i++) if (x[i]) z += x[i] * b[i];
      const p = 1 / (1 + Math.exp(-z)), w = p * (1 - p);
      for (let i = 0; i < P; i++) {
        if (!x[i]) continue;
        g[i] += x[i] * (y - p);
        for (let j = 0; j < P; j++) if (x[j]) H[i][j] += w * x[i] * x[j];
      }
    }
    for (let i = 0; i < P - 1; i++) { H[i][i] += lambda; g[i] -= lambda * b[i]; }
    H[P - 1][P - 1] += 1e-6;
    const step = solve(H, g);
    let max = 0;
    for (let i = 0; i < P; i++) { b[i] += step[i]; max = Math.max(max, Math.abs(step[i])); }
    if (max < 1e-7) break;
  }
  const mean = IDS.reduce((s, _, i) => s + b[i], 0) / IDS.length;
  return { theta: Object.fromEntries(IDS.map((id, i) => [id, b[i] - mean])), bias: b[P - 1], battles: rows.length };
}

function solve(A, g) {
  const n = g.length, M = A.map((row, i) => [...row, g[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !M[r][c]) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const readDeals = files => files.flatMap(f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));

// Where each fighter should land: the mean of its rarity plus a ladder step that keeps the order
// found in the first round, with a few deliberate placements.
export const RARITY_MEAN = { legendary: 2.1, epic: 1.0, rare: 0, common: -1.0 };
export const LADDER = { legendary: 0.55, epic: 0.6, rare: 0.55, common: 0.6 };
export const PLACE = { 'bk-burger-box': 1, 'vkusno-big-hit': 0.45 }; // 1 = top of its rarity, 0 = bottom

function targets(theta) {
  const out = {};
  for (const rarity of Object.keys(RARITY_MEAN)) {
    const ids = IDS.filter(id => FIGHTERS[id].rarity === rarity).sort((a, b) => theta[a] - theta[b]);
    const free = ids.filter(id => !(id in PLACE));
    const slots = ids.map((_, i) => (ids.length > 1 ? i / (ids.length - 1) : 0.5));
    // Placed fighters take the slot nearest to their wish; the rest keep their order.
    const taken = new Set();
    const pos = {};
    for (const [id, want] of Object.entries(PLACE)) {
      if (FIGHTERS[id]?.rarity !== rarity) continue;
      let best = -1; for (let i = 0; i < slots.length; i++) if (!taken.has(i) && (best < 0 || Math.abs(slots[i] - want) < Math.abs(slots[best] - want))) best = i;
      taken.add(best); pos[id] = slots[best];
    }
    let k = 0;
    for (const id of free) { while (taken.has(k)) k++; pos[id] = slots[k++]; }
    for (const id of ids) out[id] = RARITY_MEAN[rarity] + LADDER[rarity] * (2 * pos[id] - 1);
  }
  const mean = IDS.reduce((s, id) => s + out[id], 0) / IDS.length;
  for (const id of IDS) out[id] -= mean;
  return out;
}

// Health and attack for a wanted change of power (health × attack): attack moves by one only when
// health alone would have to change by more than a quarter.
function resize(id, factor) {
  const f = FIGHTERS[id], power = f.hp * f.attack * factor;
  let best = null;
  for (const attack of [f.attack - 1, f.attack, f.attack + 1]) {
    if (attack < 2 || attack > 10) continue;
    const hp = Math.round(power / attack);
    if (hp < 10 || hp > 40) continue;
    const cost = Math.abs(Math.log(hp / f.hp)) + (attack === f.attack ? 0 : 0.25);
    if (!best || cost < best.cost) best = { hp, attack, cost };
  }
  return best ?? { hp: f.hp, attack: f.attack };
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit' });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error('worker ' + code))));
  });
}

async function loop([dir, iterations, workers, deals, nodes]) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'overrides.json');
  let overrides = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let goal = existsSync(join(dir, 'targets.json')) ? JSON.parse(readFileSync(join(dir, 'targets.json'), 'utf8')) : null;
  for (let it = 0; it < +iterations; it++) {
    const t0 = Date.now();
    writeFileSync(file, JSON.stringify(overrides));
    const out = join(dir, `it${String(it).padStart(2, '0')}-`);
    await Promise.all(Array.from({ length: +workers }, (_, w) => run(['play', file, w, workers, deals, nodes, it + 1, out + w + '.jsonl'])));
    const result = fit(readDeals(Array.from({ length: +workers }, (_, w) => out + w + '.jsonl')));
    applyOverrides(overrides);
    goal ??= targets(result.theta);
    writeFileSync(join(dir, 'targets.json'), JSON.stringify(goal));
    // Step size: about a third of the gap in log power per unit of θ, smaller in later rounds.
    const eta = it < 3 ? 0.35 : 0.22;
    const next = {};
    let err = 0;
    for (const id of IDS) {
      const gap = goal[id] - result.theta[id];
      err += gap * gap;
      next[id] = resize(id, Math.exp(Math.max(-0.35, Math.min(0.35, eta * gap))));
    }
    const rmse = Math.sqrt(err / IDS.length);
    appendFileSync(join(dir, 'log.jsonl'), JSON.stringify({ it, rmse, battles: result.battles, bias: result.bias, ms: Date.now() - t0, theta: result.theta, stats: Object.fromEntries(IDS.map(id => [id, [FIGHTERS[id].hp, FIGHTERS[id].attack]])) }) + '\n');
    console.log(`round ${it}: rmse ${rmse.toFixed(3)} (${result.battles} battles, ${Math.round((Date.now() - t0) / 1000)} s)`);
    overrides = next;
    for (const [id, o] of Object.entries(next)) { FIGHTERS[id].hp = o.hp; FIGHTERS[id].attack = o.attack; }
  }
  writeFileSync(file, JSON.stringify(overrides));
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'play') playShard(rest);
else if (mode === 'fit') console.log(JSON.stringify(fit(readDeals(rest)), null, 1));
else if (mode === 'loop') await loop(rest);
