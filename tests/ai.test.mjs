// The trainer AI: legal, tactically sound, and clearly stronger than the simple bot. Plus the
// trainer offer and its rewards, and the wild fighter tuning that uses the same AI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyMove, battleStats, botMove, legalMoves, startBattle } from '../public/js/duel-engine.js';
import { evaluate, smartMove } from '../public/js/duel-ai.js';
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

test('a trainer brings fighters of the same rarities and levels, from its own chain when it can', () => {
  const team = ['bk-whopper', 'dodo-pepperoni', 'vkusno-nuggets'].map(id => cardFor(menu.find(m => m.id === id), 4));
  for (const trainer of TRAINERS) {
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
