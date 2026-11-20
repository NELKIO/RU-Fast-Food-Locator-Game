// How hard is a trainer (or a wild fighter) for a player, by AI version and noise (`slack`)?
// Real battles: the player's random team of level 5 against trainerOffer() at the difficulty, or
// against wildFighter(). The player is the old AI with a small budget (a thinking human) or the
// simple botMove (a casual one). Budgets are in positions, matched to the think time of each level
// on a mid-range phone, so runs repeat exactly and do not depend on the machine's load.
//
//   node trainer-noise.mjs <easy|normal|hard|lord|wild> <think|casual> <old|new> <slack> <games> [seed]
import { readFileSync } from 'node:fs';
import { applyMove, battleStats, botMove, legalMoves, opener, startBattle } from '../../../public/js/duel-engine.js';
import * as NEW from '../../../public/js/duel-ai.js';
import * as OLD from './ai-baseline.mjs';
import { FIGHTERS } from '../../../public/js/fighters.js';
import { cardFor, trainerOffer, TRAINERS, wildFighter } from '../../../public/js/game.js';

const menu = JSON.parse(readFileSync(new URL('../../../public/data/menu.json', import.meta.url)));
const [level, player, version, slackArg, gamesArg, seedArg] = process.argv.slice(2);
const slack = +slackArg || 0, games = +gamesArg || 100;
// Positions per ms on a mid-range phone: about a third of a laptop (old 533, new 1176 in Node).
const RATE = { old: 180, new: 400 };
const THINK = { wild: 90, easy: 60, normal: 350, hard: 900, lord: 1200 };
const budget = RATE[version] * THINK[level];
const PLAYER_NODES = 20000;
function seq(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const ids = menu.map(m => m.id).filter(id => FIGHTERS[id]);
const rarities = ['common', 'rare', 'epic', 'legendary'];
let score = 0, moves = 0, varied = 0;
for (let g = 0; g < games; g++) {
  const deal = seq(1000 + g + 7919 * (+seedArg || 1)), random = seq(77 + g);
  const pick = new Set();
  while (pick.size < 3) { const pool = ids.filter(i => FIGHTERS[i].rarity === rarities[Math.floor(deal() * 4)]); pick.add(pool[Math.floor(deal() * pool.length)]); }
  const cards = [...pick].map(id => cardFor(menu.find(m => m.id === id), 5));
  let foes;
  if (level === 'wild') foes = [wildFighter({ enemyId: ids[Math.floor(deal() * ids.length)] }, menu, cards)];
  else {
    const coach = level === 'lord' ? 'luka' : TRAINERS.filter(t => !t.lord)[g % 9].id;
    foes = trainerOffer(menu, cards, { trainer: coach, difficulty: level === 'lord' ? 'normal' : level, rng: deal }).team;
  }
  const teams = [cards.map(c => battleStats(c)), foes.map(c => battleStats(c))];
  let s = startBattle(teams, opener(teams, 0), { tempo: false });
  while (s.winner === null) {
    let m;
    if (s.turn === 1) {
      const list = legalMoves(s);
      if (level === 'easy' && random() < 0.25) m = list[Math.floor(random() * list.length)];
      else m = version === 'new' ? NEW.smartMove(s, 1, { nodes: budget, random, slack }) : OLD.smartMove(s, 1, { nodes: budget, random });
    } else m = player === 'think' ? OLD.smartMove(s, 0, { nodes: PLAYER_NODES, random }) : botMove(s, random);
    s = applyMove(s, s.turn, m);
  }
  const w = s.winner === 'draw' ? 0.5 : s.winner === 0 ? 1 : 0;
  score += w;
  // One line per battle, so a run cut short still counts (and deals pair up across settings).
  console.log(JSON.stringify({ level, player, version, slack, deal: g, w }));
}
console.error(JSON.stringify({ level, player, version, slack, games, playerWins: +(score / games).toFixed(3) }));
