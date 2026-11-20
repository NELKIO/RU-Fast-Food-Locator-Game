// Can a player beat the trainer? The player is the same strong bot (a careful human) or the simple
// bot (a casual one). Usage: node trainer-odds.mjs <easy|normal|hard|lord> <smart|simple> <games>
// LEG=1 gives the player three legends. Search budgets are in positions, so runs repeat exactly.
const R = new URL('../../../public/', import.meta.url).href;
const { applyMove, battleStats, botMove, legalMoves, opener, startBattle } = await import(R + 'js/duel-engine.js');
const { smartMove } = await import(R + 'js/duel-ai.js');
const { cardFor, trainerOffer, TRAINERS } = await import(R + 'js/game.js');
const { FIGHTERS } = await import(R + 'js/fighters.js');
const fs = await import('node:fs');
const menu = JSON.parse(fs.readFileSync(new URL('data/menu.json', R)));
function seq(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const [level, player, games, msArg] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5] || 0];
const NODES = { easy: 1500, normal: 6000, hard: 15000, lord: 20000 };
const ids = menu.map(m => m.id).filter(id => FIGHTERS[id]);
let score = 0, moves0 = 0, distinct = 0;
const random = seq(1234 + games);
for (let g = 0; g < games; g++) {
  const rar = ['common', 'rare', 'epic', 'legendary'];
  const pick = new Set(); while (pick.size < 3) { const r = process.env.LEG ? 'legendary' : rar[Math.floor(random() * 4)]; const pool = ids.filter(i => FIGHTERS[i].rarity === r); pick.add(pool[Math.floor(random() * pool.length)]); }
  const cards = [...pick].map(id => cardFor(menu.find(m => m.id === id), 5));
  const lord = level === 'lord';
  const coach = lord ? 'luka' : TRAINERS.filter(t => !t.lord)[g % 9].id;
  const offer = trainerOffer(menu, cards, { trainer: coach, difficulty: lord ? 'normal' : level, rng: seq(g + 7) });
  const teams = [cards.map(c => battleStats(c)), offer.team.map(c => battleStats(c))];
  let s = startBattle(teams, opener(teams, 0), { tempo: false });
  while (s.winner === null) {
    let m;
    if (s.turn === 1) {
      const moves = legalMoves(s);
      m = level === 'easy' && random() < 0.25 ? moves[Math.floor(random() * moves.length)] : smartMove(s, 1, { nodes: NODES[level], random });
    } else m = player === 'smart' ? smartMove(s, 0, { nodes: 6000, random }) : botMove(s, random);
    s = applyMove(s, s.turn, m);
  }
  score += s.winner === 'draw' ? 0.5 : s.winner === 0 ? 1 : 0;
}
console.log(level, player, `${score}/${games}`, Math.round(100 * score / games) + '%');
