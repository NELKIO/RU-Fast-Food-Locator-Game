// The trainer AI: legal, tactically sound, and clearly stronger than the simple bot. Plus the
// trainer offer and its rewards, and the wild fighter tuning that uses the same AI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyMove, battleStats, botMove, legalMoves, startBattle } from '../public/js/duel-engine.js';
import { evaluate, smartMove, WEIGHTS } from '../public/js/duel-ai.js';
import { smartMove as earlierMove } from '../docs/balance/tools/ai-baseline.mjs';
import { FIGHTERS } from '../public/js/fighters.js';
import { cardFor, freshProfile, normalizeProfile, recordTrainer, trainerOffer, TRAINERS, wildFighter } from '../public/js/game.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
function seq(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const fighter = (id, extra = {}) => ({ id, hp: 20, attack: 5, speed: 5, skill: { name: id, cost: 2, power: 2 }, ...extra });

test('the trainer always picks a legal move and plays a whole battle', () => {
  const random = seq(3);
  const ids = Object.keys(FIGHTERS);
  for (let g = 0; g < 6; g++) {
    const pick = () => ids[Math.floor(random() * ids.length)];
    const a = [...new Set([pick(), pick(), pick()])].map(id => battleStats({ id, ...FIGHTERS[id] }, true));
    const b = [...new Set([pick(), pick(), pick()])].map(id => battleStats({ id, ...FIGHTERS[id] }, true));
    let s = startBattle([a, b], 0, { tempo: false });
    while (s.winner === null) {
      const m = smartMove(s, s.turn, { nodes: 1500, random });
      assert.ok(legalMoves(s).includes(m), m);
      s = applyMove(s, s.turn, m);
    }
  }
});

test('the trainer finishes a fighter it can knock out', () => {
  // The opponent is on 4 HP behind a guard; only the piercing skill gets through.
  const s = startBattle([[fighter('me', { attack: 5, skill: { name: 'Укол', cost: 1, power: 0, pierce: true } })], [fighter('foe', { hp: 20 })]], 0, { tempo: false });
  s.teams[1][0].hp = 4;
  s.teams[1][0].guarding = true;
  assert.equal(smartMove(s, 0, { nodes: 4000, random: seq(1) }), 'special');
});

test('the evaluation prefers more health, more attack and fewer booked losses', () => {
  const base = startBattle([[fighter('a')], [fighter('b')]], 0, { tempo: false });
  const hurt = structuredClone(base); hurt.teams[1][0].hp = 10;
  assert.ok(evaluate(hurt, 0) > evaluate(base, 0));
  const burning = structuredClone(base); burning.teams[1][0].burn = { dmg: 3, turns: 3 };
  assert.ok(evaluate(burning, 0) > evaluate(base, 0));
  const won = structuredClone(base); won.winner = 0;
  assert.ok(evaluate(won, 0) > 1000 && evaluate(won, 1) < -1000);
});

test('the trainer beats the simple bot clearly over many even battles, swapping fighters as it goes', () => {
  const random = seq(19);
  const ids = Object.keys(FIGHTERS);
  let score = 0, games = 0, switches = 0, moves = 0;
  for (let g = 0; g < 32; g++) {
    const rarity = ['common', 'rare', 'epic', 'legendary'][g % 4];
    const pool = ids.filter(i => FIGHTERS[i].rarity === rarity);
    const team = () => { const out = new Set(); while (out.size < 3) out.add(pool[Math.floor(random() * pool.length)]); return [...out].map(id => battleStats({ id, ...FIGHTERS[id] }, true)); };
    const a = team(), b = team();
    const smart = g % 2;
    let s = startBattle([a, b], g % 3 === 0 ? 1 : 0, { tempo: false });
    while (s.winner === null) {
      let m;
      if (s.turn === smart) { m = smartMove(s, smart, { nodes: 3000, random }); moves++; if (m.startsWith('switch:')) switches++; }
      else m = botMove(s, random);
      s = applyMove(s, s.turn, m);
    }
    score += s.winner === 'draw' ? 0.5 : s.winner === smart ? 1 : 0;
    games++;
  }
  assert.ok(score / games >= 0.65, `the trainer won ${score} of ${games}`);
  // Swapping is part of its play, not a fluke: the simple bot never swaps.
  assert.ok(switches / moves > 0.03, `${switches} swaps in ${moves} moves`);
});

// Positions from battles between the trainer and its earlier version (docs/balance/tools/ai-baseline.mjs)
// where a full search to the turn limit shows that some moves win and others lose. With the same
// small budget the earlier version took a losing move every time; the trainer now takes a winning one.
const POSITIONS = [
  { teams: [['bk-angus-parmigiano', 'rostics-boxmaster', 'bk-burger-box'], ['bk-burger-box', 'rostics-chefburger', 'bk-angus-parmigiano']], first: 1,
    moves: 'hit switch:2 hit hit ultimate hit hit ultimate hit hit hit guard special guard hit ultimate guard guard special guard special guard hit guard hit special hit hit hit hit special ultimate hit hit',
    win: ['hit', 'guard', 'special'], lose: ['switch:2'] },
  { teams: [['bk-fries', 'dodo-hawaiian', 'rostics-bites'], ['vkusno-chocolate-cake', 'dodo-oven-potatoes', 'bk-shrimps']], first: 0,
    moves: 'hit hit special hit switch:2 special hit hit special guard hit special hit guard special hit special guard hit hit ' +
      'switch:2 switch:1 switch:1 switch:2 switch:2 switch:1 switch:1 switch:2 switch:2 switch:1 switch:1 switch:2 switch:2 switch:1 switch:1 switch:2 switch:2 switch:1 switch:1 switch:2',
    win: ['hit', 'guard', 'special'], lose: ['switch:2'] },
  { teams: [['bk-fries', 'vkusno-caesar-roll', 'bk-whopper-junior'], ['vkusno-caesar-roll', 'bk-shrimp-roll', 'rostics-bites']], first: 0,
    moves: 'switch:1 hit hit special special hit hit hit hit hit hit special hit hit hit hit special special hit hit hit hit hit special hit hit special hit guard special guard hit special guard hit guard hit',
    win: ['hit', 'special'], lose: ['guard', 'switch:2'] },
];
const stats = id => battleStats({ id, ...FIGHTERS[id] }, true);

test('the trainer finds the winning move where its earlier version slipped', () => {
  for (const p of POSITIONS) {
    let s = startBattle(p.teams.map(t => t.map(stats)), p.first, { tempo: false });
    for (const m of p.moves.split(' ')) s = applyMove(s, s.turn, m);
    // The verdicts hold: a search to the end of the battle proves every listed move.
    for (const m of [...p.win, ...p.lose]) {
      const next = applyMove(s, s.turn, m), info = {};
      smartMove(next, next.turn, { nodes: 200000, info, random: seq(1) });
      const value = next.turn === s.turn ? info.score : -info.score;
      assert.ok(p.win.includes(m) ? value > 999000 : value < -999000, `${m}: ${value}`);
    }
    for (let k = 1; k <= 3; k++) {
      assert.ok(p.win.includes(smartMove(s, s.turn, { nodes: 3000, random: seq(k) })));
      assert.ok(p.lose.includes(earlierMove(s, s.turn, { nodes: 3000, random: seq(k) })));
    }
  }
});

test('the trainer beats its earlier version at the same node budget', () => {
  // Both sides get the same team, so only play decides; each deal is played from both sides.
  const random = seq(29);
  const ids = Object.keys(FIGHTERS);
  let score = 0, games = 0;
  for (let d = 0; d < 32; d++) {
    const pool = ids.filter(i => FIGHTERS[i].rarity === ['common', 'rare', 'epic', 'legendary'][d % 4]);
    const picked = new Set();
    while (picked.size < 3) picked.add(pool[Math.floor(random() * pool.length)]);
    const team = [...picked].map(stats);
    for (const smart of [0, 1]) {
      let s = startBattle([team, team], d % 2, { tempo: false });
      while (s.winner === null) {
        const options = { nodes: 3000, random };
        s = applyMove(s, s.turn, s.turn === smart ? smartMove(s, s.turn, options) : earlierMove(s, s.turn, options));
      }
      score += s.winner === 'draw' ? 0.5 : s.winner === smart ? 1 : 0;
      games++;
    }
  }
  assert.ok(score / games >= 0.56, `the trainer scored ${score} of ${games}`);
});

test('a node budget gives the same move every time; more time searches deeper', () => {
  const s = startBattle([['bk-whopper', 'bk-big-king', 'bk-cola-08'].map(stats), ['dodo-pepperoni', 'bk-double-whopper', 'bk-wet-wipe'].map(stats)], 0, { tempo: false });
  const a = {}, b = {};
  assert.equal(smartMove(s, 0, { nodes: 20000, random: () => 0.5, info: a }), smartMove(s, 0, { nodes: 20000, random: () => 0.5, info: b }));
  assert.deepEqual([a.depth, a.nodes, a.score], [b.depth, b.nodes, b.score]);
  const quick = {}, slow = {};
  const t0 = Date.now();
  smartMove(s, 0, { timeMs: 20, info: quick });
  assert.ok(Date.now() - t0 < 200, 'stays near its time budget');
  smartMove(s, 0, { timeMs: 300, info: slow });
  assert.ok(slow.depth > quick.depth && slow.nodes > quick.nodes, `${quick.depth} → ${slow.depth}`);
  // Older weight objects without the play-out share still work.
  const { race, ...older } = WEIGHTS;
  assert.equal(evaluate(s, 0, older), evaluate(s, 0));
});

test('noise (slack) varies the trainer among close moves but never takes a move that loses', () => {
  // Proven positions: with a real budget the trainer still avoids every losing move, even with slack.
  for (const p of POSITIONS) {
    let s = startBattle(p.teams.map(t => t.map(stats)), p.first, { tempo: false });
    for (const m of p.moves.split(' ')) s = applyMove(s, s.turn, m);
    for (let k = 1; k <= 4; k++) assert.ok(p.win.includes(smartMove(s, s.turn, { nodes: 20000, random: seq(k), slack: 0.2 })), 'slack 0.2, seed ' + k);
  }
  // In an open position more slack gives more different moves over many seeds; none gives the same play.
  const s = startBattle([['bk-whopper', 'bk-big-king', 'bk-cola-08'].map(stats), ['dodo-pepperoni', 'bk-double-whopper', 'bk-wet-wipe'].map(stats)], 0, { tempo: false });
  const spread = slack => new Set(Array.from({ length: 24 }, (_, k) => smartMove(s, 0, { nodes: 4000, random: seq(k + 1), slack }))).size;
  assert.ok(spread(0.3) > spread(0), `${spread(0)} → ${spread(0.3)}`);
  assert.equal(smartMove(s, 0, { nodes: 4000, random: seq(3), slack: 0 }), smartMove(s, 0, { nodes: 4000, random: seq(3) }), 'no slack is the default');
});

test('a trainer brings fighters of the same rarities and levels, from its own chain when it can', () => {
  const team = ['bk-whopper', 'dodo-pepperoni', 'vkusno-nuggets'].map(id => cardFor(menu.find(m => m.id === id), 4));
  for (const trainer of TRAINERS.filter(t => t.brand)) {
    const offer = trainerOffer(menu, team, { trainer: trainer.id, rng: seq(7) });
    assert.equal(offer.trainer.id, trainer.id);
    assert.deepEqual(offer.team.map(c => c.rarity), team.map(c => c.rarity));
    assert.ok(offer.team.every(c => c.level === 4));
    assert.ok(offer.team.every(c => !team.some(t => t.id === c.id)), 'never the player’s own fighters');
    assert.equal(new Set(offer.team.map(c => c.id)).size, 3);
    assert.ok(offer.team.filter(c => c.brand === trainer.brand).length >= 2, trainer.id);
  }
});

test('a trainer battle pays modest experience once per match', () => {
  const p = normalizeProfile({ ...freshProfile(), collection: { 'bk-whopper': { copies: 1, xp: 0 }, 'bk-fries': { copies: 1, xp: 0 } }, team: ['bk-whopper', 'bk-fries'] });
  const won = recordTrainer(p, { won: true, teamIds: ['bk-whopper', 'bk-fries'], matchId: 'm1' });
  assert.deepEqual([won.playerXp, won.partyXp, won.profile.xp, won.profile.battles.wins], [12, 8, 12, 1]);
  assert.equal(won.profile.collection['bk-fries'].xp, 8);
  assert.equal(recordTrainer(won.profile, { won: true, teamIds: ['bk-whopper'], matchId: 'm1' }).reason, 'already-recorded');
  const lost = recordTrainer(p, { won: false, teamIds: ['bk-whopper'], matchId: 'm2' });
  assert.deepEqual([lost.playerXp, lost.partyXp, lost.profile.battles.losses], [3, 2, 1]);
});

test('a rarer team meets a bigger wild fighter (the rarity bonus)', () => {
  const encounter = { id: 'w', enemyId: 'bk-whopper' };
  const commons = ['bk-fries', 'vkusno-nuggets', 'dodo-cheese'].map(id => cardFor(menu.find(m => m.id === id), 3));
  const legends = ['bk-angus-parmigiano', 'dodo-pepperoni', 'vkusno-big-hit'].map(id => cardFor(menu.find(m => m.id === id), 3));
  const power = c => c.maxHp * c.attack;
  const teamPower = t => t.reduce((n, c) => n + c.maxHp, 0) * t.reduce((n, c) => n + c.attack, 0) / t.length;
  const forCommons = power(wildFighter(encounter, menu, commons)) / teamPower(commons);
  const forLegends = power(wildFighter(encounter, menu, legends)) / teamPower(legends);
  assert.ok(forLegends > forCommons * 1.15, `${forLegends} vs ${forCommons}`);
});
