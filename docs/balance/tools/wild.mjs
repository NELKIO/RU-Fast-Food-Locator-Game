// Wild fighter difficulty: the player is the strong computer opponent (duel-ai.js), the wild fighter
// is sized by wildFighter() with the given tuning. Prints the player win rate per team type and level.
// node wild.mjs <seed> <games per cell> <tuning JSON> <smart|simple wild brain>
// e.g. node wild.mjs 13 50 '{"strength":0.85,"rarityBonus":0.1,"skillUp":0}' smart
import { readFileSync } from 'node:fs';
import { startBattle, applyMove, botMove, battleStats, opener } from '../../../public/js/duel-engine.js';
import { smartMove } from '../../../public/js/duel-ai.js';
import { cardFor, wildFighter } from '../../../public/js/game.js';
const menu = JSON.parse(readFileSync(new URL('../../../public/data/menu.json', import.meta.url)));
let seed = +process.argv[2] || 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const byR = r => menu.filter(m => cardFor(m).rarity === r);
const xpFor = { 1: 0, 5: 70, 10: 270 };
const profiles = { starter: ['common', 'common', 'common'], mixed: ['rare', 'epic', 'common'], strong: ['legendary', 'epic', 'epic'], legends: ['legendary', 'legendary', 'legendary'] };
const N = +process.argv[3] || 60;
const rows = [];
const TUNE = JSON.parse(process.argv[4] || '{"strength":0.95,"rarityBonus":0}');
const BRAINS = (process.argv[5] || 'smart').split(',');
for (const wildBrain of BRAINS) for (const [name, rs] of Object.entries(profiles)) for (const level of [1, 5, 10]) {
  let wins = 0;
  for (let g = 0; g < N; g++) {
    const used = new Set(); const team = rs.map(r => { let it; do { it = pick(byR(r)); } while (used.has(it.id)); used.add(it.id); return cardFor(it, level); });
    const enemyItem = pick(menu);
    const enemy = wildFighter({ enemyId: enemyItem.id }, menu, team, TUNE);
    const teams = [team.map(c => battleStats(c)), [battleStats(enemy)]];
    let s = startBattle(teams, opener(teams, 0), { tempo: false });
    while (s.winner === null) {
      const m = s.turn === 0 ? smartMove(s, 0, { nodes: 4000, random: rnd }) : wildBrain === 'smart' ? smartMove(s, 1, { nodes: 4000, random: rnd }) : botMove(s, rnd);
      s = applyMove(s, s.turn, m);
    }
    wins += s.winner === 0 ? 1 : s.winner === 'draw' ? 0.5 : 0;
  }
  rows.push([name, level, wins / N]);
}

console.log(JSON.stringify(TUNE), rows.map(([n, l, w]) => n.slice(0, 4) + l + ':' + Math.round(w * 100)).join(' '), '| avg', Math.round(rows.reduce((a, r) => a + r[2], 0) / rows.length * 100), 'min', Math.round(Math.min(...rows.map(r => r[2])) * 100), 'max', Math.round(Math.max(...rows.map(r => r[2])) * 100));
