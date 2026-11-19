import * as E from '../../../public/js/duel-engine.js';
export { E };
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// A roster is a fighters module (FIGHTERS export) or a JSON file: a plain map or a tune.mjs result with `F`.
export async function loadRoster(path) {
  const full = resolve(process.cwd(), path);
  if (full.endsWith('.json')) { const data = JSON.parse(readFileSync(full, 'utf8')); return data.F ?? data; }
  return (await import(pathToFileURL(full).href)).FIGHTERS;
}
const RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };
export const rank = r => RANK[r];
function fkey(x) {
  return x.hp + ',' + x.attack + ',' + x.energy + ',' + (x.guarding ? 1 : 0) + ',' + x.shield + ',' + (x.burn ? x.burn.dmg * 10 + x.burn.turns : 0) + (x.saved ? 's' : '');
}
let budget = Infinity;
// Exact result with perfect play: +1 side 0 wins, -1 side 1 wins, 0 draw. null if over the state budget.
export function solve(a, b, first = 0, tempo = true, maxStates = 3e6) {
  const memo = new Map();
  const st = E.startBattle([[E.battleStats({ id: 'a', ...a }, true)], [E.battleStats({ id: 'b', ...b }, true)]], first, { tempo });
  function v(s) {
    if (s.winner !== null) return s.winner === 'draw' ? 0 : s.winner === 0 ? 1 : -1;
    const k = fkey(s.teams[0][0]) + '|' + fkey(s.teams[1][0]) + '|' + s.turn + '|' + s.moves;
    const m = memo.get(k); if (m !== undefined) return m;
    if (memo.size > maxStates) throw new Error('budget');
    const max = s.turn === 0;
    let best = max ? -2 : 2;
    for (const mv of E.legalMoves(s)) {
      const r = v(E.applyMove(s, s.turn, mv));
      if (max ? r > best : r < best) best = r;
      if (best === (max ? 1 : -1)) break;
    }
    memo.set(k, best); return best;
  }
  try { return v(st); } catch (e) { if (e.message === 'budget') return null; throw e; }
}
// Score of a against b over both move orders: 1 win, .5 draw, 0 loss each.
export function score(a, b) {
  const r1 = solve(a, b, 0), r2 = solve(a, b, 1);
  return [r1, r2];
}
// Bot against bot, as wild fights and casual play look: average over seeds and both orders.
export function botScore(a, b, games = 200, tempo = true) {
  let pts = 0, n = 0, seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let g = 0; g < games; g++) {
    const first = g & 1;
    let s = E.startBattle([[E.battleStats({ id: 'a', ...a }, true)], [E.battleStats({ id: 'b', ...b }, true)]], first, { tempo });
    while (s.winner === null) s = E.applyMove(s, s.turn, E.botMove(s, rnd));
    pts += s.winner === 'draw' ? 0.5 : s.winner === 0 ? 1 : 0; n++;
  }
  return pts / n;
}
