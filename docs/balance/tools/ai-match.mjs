// Head-to-head tournament between two computer players on random 3-on-3 deals.
// Every deal is played twice with the same teams and the same opener: once with A on side 0, once
// with A on side 1, so a lucky team or a lucky opener cancels out.
//
//   node ai-match.mjs A B [options]
//     A, B        a module path exporting smartMove (relative to this folder or absolute), or `bot`
//                 for the simple botMove from the engine
//     --deals=N   number of deals (2 games each), default 50
//     --seed=S    team seed, default 1
//     --teams=T   equal (each team one rarity, rarities in turn) | mixed (any fighters) | both
//                 (equal, every fifth deal mixed) | mirror (both sides get the same equal team)
//     --budget=B  nodes:3000 (deterministic) or time:350 (milliseconds per move), default nodes:3000
//     --abudget / --bbudget   per-player override of --budget
//     --aopts / --bopts       extra smartMove options as JSON, e.g. '{"maxDepth":6}'
//     --out=F     write the per-game results and the summary as JSON
//
//   node ai-match.mjs --sum res/*.json   combine shards and print the summary
//
// Besides the score it prints the share of "decisive" deals (one player won with both teams) that A won:
// about four deals in five are split by the teams, so the score itself moves at most ±10–12%.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyMove, battleStats, botMove, opener, startBattle } from '../../../public/js/duel-engine.js';
import { FIGHTERS } from '../../../public/js/fighters.js';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter(a => a.startsWith('--') && a.includes('=')).map(a => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const pos = args.filter(a => !a.startsWith('--'));

export function summary(games) {
  const n = games.length;
  const score = games.reduce((s, g) => s + g.a, 0);
  const p = n ? score / n : 0;
  const half = 1.96 * Math.sqrt(p * (1 - p) / Math.max(1, n));
  const wins = games.filter(g => g.a === 1).length, draws = games.filter(g => g.a === 0.5).length;
  const t = k => games.reduce((s, g) => s + g[k], 0);
  const moves = t('aMoves') || 1, bMoves = t('bMoves') || 1;
  // Most deals are decided by the teams: each player wins once, with the stronger team. The deals
  // where one player wins both games carry the difference between the players.
  const deals = new Map();
  for (const g of games) deals.set((g.file ?? '') + ':' + g.deal, (deals.get((g.file ?? '') + ':' + g.deal) ?? 0) + g.a);
  const both = [...deals.values()].filter(v => v === 2).length, none = [...deals.values()].filter(v => v === 0).length;
  const decisive = both + none, share = decisive ? both / decisive : 0;
  return {
    deals: deals.size, decisive, decisiveShare: +(100 * share).toFixed(1), decisiveCi95: +(196 * Math.sqrt(share * (1 - share) / Math.max(1, decisive))).toFixed(1),
    games: n, wins, draws, losses: n - wins - draws, score: +(100 * p).toFixed(1), ci95: +(100 * half).toFixed(1),
    aMsPerMove: +(t('aMs') / moves).toFixed(1), bMsPerMove: +(t('bMs') / bMoves).toFixed(1),
    aMaxMs: Math.max(0, ...games.map(g => g.aMax)), bMaxMs: Math.max(0, ...games.map(g => g.bMax)),
    aDepth: +(t('aDepth') / moves).toFixed(2), bDepth: +(t('bDepth') / bMoves).toFixed(2),
  };
}

function print(label, games) {
  const s = summary(games);
  console.log(`${label.padEnd(10)} A scores ${s.score}% ± ${s.ci95} (${s.wins}W ${s.draws}D ${s.losses}L of ${s.games}); ` +
    `A wins ${s.decisiveShare}% ± ${s.decisiveCi95} of ${s.decisive}/${s.deals} deals won twice by one player` +
    `  ms/move A ${s.aMsPerMove} (max ${s.aMaxMs}) B ${s.bMsPerMove} (max ${s.bMaxMs})  depth A ${s.aDepth} B ${s.bDepth}`);
}

function report(games) {
  print('all', games);
  for (const kind of [...new Set(games.map(g => g.kind))].sort()) print(kind, games.filter(g => g.kind === kind));
}

if (opt.sum !== undefined || args[0] === '--sum') {
  const files = args.filter(a => !a.startsWith('--'));
  const games = files.flatMap(f => JSON.parse(readFileSync(f, 'utf8')).games.map(g => ({ ...g, file: f })));
  report(games);
  process.exit(0);
}

async function player(spec, budget, extra) {
  if (spec === 'bot') return { move: (s, random) => ({ move: botMove(s, random), depth: 0 }) };
  const mod = await import(pathToFileURL(resolve(new URL('.', import.meta.url).pathname, spec)).href);
  const [kind, value] = budget.split(':');
  const base = kind === 'nodes' ? { nodes: +value } : { timeMs: +value };
  return {
    move(s, random) {
      const info = {};
      const move = mod.smartMove(s, s.turn, { ...base, ...extra, random, info });
      return { move, depth: info.depth ?? 0 };
    },
  };
}

const deals = +(opt.deals ?? 50);
const seed0 = +(opt.seed ?? 1);
const teamsKind = opt.teams ?? 'both';
const budget = opt.budget ?? 'nodes:3000';
const A = await player(pos[0], opt.abudget ?? budget, JSON.parse(opt.aopts ?? '{}'));
const B = await player(pos[1], opt.bbudget ?? budget, JSON.parse(opt.bopts ?? '{}'));

function rng(seed) { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const ids = Object.keys(FIGHTERS);
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
function team(random, rarity) {
  const pool = rarity ? ids.filter(i => FIGHTERS[i].rarity === rarity) : ids;
  const out = new Set();
  while (out.size < 3) out.add(pool[Math.floor(random() * pool.length)]);
  return [...out].map(id => battleStats({ id, ...FIGHTERS[id] }, true));
}

const games = [];
for (let d = 0; d < deals; d++) {
  const random = rng(seed0 * 100003 + d * 7919 + 17);
  const mixed = teamsKind === 'mixed' || (teamsKind === 'both' && d % 5 === 4);
  const rarity = mixed ? null : RARITIES[d % 4];
  const first0 = team(random, rarity);
  const teams = [first0, teamsKind === 'mirror' ? first0 : team(random, rarity)];
  const first = opener(teams, d & 1);
  for (const aSide of [0, 1]) {
    const moveRandom = rng(seed0 * 31 + d * 2 + aSide + 5);
    let s = startBattle(teams, first, { tempo: false });
    const g = { deal: d, kind: rarity ?? 'mixed', aSide, aMs: 0, bMs: 0, aMoves: 0, bMoves: 0, aMax: 0, bMax: 0, aDepth: 0, bDepth: 0 };
    while (s.winner === null) {
      const who = s.turn === aSide ? 'a' : 'b';
      const t0 = performance.now();
      const { move, depth } = (who === 'a' ? A : B).move(s, moveRandom);
      const ms = performance.now() - t0;
      g[who + 'Ms'] += ms; g[who + 'Moves']++; g[who + 'Depth'] += depth;
      g[who + 'Max'] = Math.max(g[who + 'Max'], Math.round(ms));
      const next = applyMove(s, s.turn, move);
      if (!next) throw new Error(`illegal move ${move} by ${who}`);
      s = next;
    }
    g.a = s.winner === 'draw' ? 0.5 : s.winner === aSide ? 1 : 0;
    g.turns = s.moves;
    games.push(g);
  }
}

if (opt.out) writeFileSync(opt.out, JSON.stringify({ args, summary: summary(games), games }));
report(games);
