// Search speed and depth: how many positions a player looks at per millisecond and how deep it
// gets within a time budget, over positions taken from real battles.
//   node ai-rate.mjs <timeMs> <module> [module…]     e.g. node ai-rate.mjs 350 ai-baseline.mjs ../../../public/js/duel-ai.js
//   node ai-rate.mjs d8 <module> [module…]           a fixed depth instead: fewer nodes = better pruning
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyMove, battleStats, botMove, opener, startBattle } from '../../../public/js/duel-engine.js';
import { FIGHTERS } from '../../../public/js/fighters.js';

const [timeMs, ...specs] = process.argv.slice(2);
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const random = rng(4242);
const ids = Object.keys(FIGHTERS);
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const team = r => { const pool = ids.filter(i => FIGHTERS[i].rarity === r); const out = new Set(); while (out.size < 3) out.add(pool[Math.floor(random() * pool.length)]); return [...out].map(id => battleStats({ id, ...FIGHTERS[id] }, true)); };

// Positions from simple-bot battles: every third position of 24 battles, all rarities.
const positions = [];
for (let g = 0; g < 24; g++) {
  const teams = [team(RARITIES[g % 4]), team(RARITIES[g % 4])];
  let s = startBattle(teams, opener(teams, g & 1), { tempo: false }), k = 0;
  while (s.winner === null) {
    if (k++ % 3 === 0) positions.push(s);
    s = applyMove(s, s.turn, botMove(s, random));
  }
}

for (const spec of specs) {
  const { smartMove } = await import(pathToFileURL(resolve(new URL('.', import.meta.url).pathname, spec)).href);
  smartMove(positions[0], positions[0].turn, { timeMs: 50 }); // warm up
  let nodes = 0, ms = 0, depth = 0, max = 0, n = 0;
  for (const s of positions) {
    const info = {};
    const t0 = performance.now();
    const budget = timeMs.startsWith('d') ? { maxDepth: +timeMs.slice(1), nodes: 1e9 } : { timeMs: +timeMs };
    smartMove(s, s.turn, { ...budget, info, random: rng(1) });
    const t = performance.now() - t0;
    if (info.nodes === undefined) continue; // a single legal move
    nodes += info.nodes; ms += t; depth += info.depth; max = Math.max(max, t); n++;
  }
  console.log(`${spec}: ${n} positions, ${(nodes / ms).toFixed(0)} nodes/ms, ${(nodes / n / 1000).toFixed(0)}k nodes/move, ` +
    `${(ms / n).toFixed(0)} ms/move (max ${max.toFixed(0)}), depth ${(depth / n).toFixed(2)}`);
}
