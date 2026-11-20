// Trainers: names, the lord of trainers, the mixed team, difficulty levels and their rewards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cardFor, freshProfile, LORD_TEAM, normalizeProfile, recordTrainer, trainerOffer, TRAINERS } from '../public/js/game.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
function seq(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const team = (ids, level) => ids.map(id => cardFor(menu.find(m => m.id === id), level));

test('ten trainers by name, one mixed team, one lord', () => {
  assert.deepEqual(TRAINERS.map(t => t.name), ['Артём', 'Миша', 'Андрей', 'Саша', 'Даня', 'Ярослав', 'Марк', 'Лев С', 'Лев Б', 'Лука']);
  assert.equal(TRAINERS.find(t => t.name === 'Саша').she, true);
  // Everyone but the lord has a funny job in front of the name, all different.
  const roles = TRAINERS.filter(t => !t.lord).map(t => t.role);
  assert.ok(roles.every(Boolean) && new Set(roles).size === roles.length);
  assert.equal(TRAINERS.find(t => t.name === 'Андрей').role, 'Курьер');
  assert.equal(TRAINERS.find(t => t.id === 'luka').lord, true);
  for (const brand of ['bk', 'vkusno', 'rostics', 'dodo']) assert.equal(TRAINERS.filter(t => t.brand === brand).length, 2, brand);
});

test('the mixed trainer brings fighters from several chains', () => {
  const brands = new Set();
  for (let k = 0; k < 12; k++) {
    const offer = trainerOffer(menu, team(['bk-fries', 'vkusno-nuggets', 'dodo-cheese'], 2), { trainer: 'lev-b', rng: seq(40 + k) });
    for (const card of offer.team) brands.add(card.brand);
  }
  assert.ok(brands.size >= 3, [...brands].join(','));
});

test('the lord brings the three strongest legends a level above the best fighter, and pays double', () => {
  const mine = team(['bk-fries', 'vkusno-nuggets', 'dodo-cheese'], 1);
  mine[1] = cardFor(menu.find(m => m.id === 'vkusno-nuggets'), 6);
  const offer = trainerOffer(menu, mine, { trainer: 'luka', difficulty: 'easy', rng: seq(3) });
  assert.deepEqual(offer.team.map(c => c.id), LORD_TEAM);
  assert.ok(offer.team.every(c => c.rarity === 'legendary' && c.level === 7));
  assert.equal(offer.difficulty, 'lord', 'difficulty does not soften the lord');
  const p = normalizeProfile({ ...freshProfile(), collection: { 'bk-fries': { copies: 1, xp: 0 } }, team: ['bk-fries'] });
  const r = recordTrainer(p, { won: true, teamIds: ['bk-fries'], matchId: 'lord-1', difficulty: 'lord' });
  assert.deepEqual([r.playerXp, r.partyXp], [24, 16]);
});

test('difficulty moves the trainer team level (warm-up) and its pick (no mercy), and scales the reward', () => {
  const mine = team(['bk-whopper', 'dodo-pepperoni', 'vkusno-nuggets'], 5);
  const levels = d => trainerOffer(menu, mine, { trainer: 'artem', difficulty: d, rng: seq(9) }).team.map(c => c.level);
  assert.deepEqual(levels('easy'), [4, 4, 4]);
  assert.deepEqual(levels('normal'), [5, 5, 5]);
  assert.deepEqual(levels('hard'), [5, 5, 5], 'no level up: the strongest picks make it hard enough');
  // Without mercy: the strongest of each rarity (one of the top two by health × attack).
  const hard = trainerOffer(menu, mine, { trainer: 'lev-b', difficulty: 'hard', rng: seq(5) });
  const power = c => c.maxHp * c.attack;
  for (const card of hard.team) {
    const same = menu.filter(m => cardFor(m).rarity === card.rarity).map(m => cardFor(m, card.level));
    const better = same.filter(c => power(c) > power(card)).length;
    assert.ok(better <= 1, card.id);
  }
  const p = normalizeProfile({ ...freshProfile(), collection: { 'bk-whopper': { copies: 1, xp: 0 } }, team: ['bk-whopper'] });
  const xp = d => recordTrainer(p, { won: true, teamIds: ['bk-whopper'], matchId: 'x-' + d, difficulty: d });
  assert.deepEqual(['easy', 'normal', 'hard'].map(d => xp(d).playerXp), [7, 12, 18]);
});

test('the same seed gives the same trainer team (stable for the visit)', () => {
  const mine = team(['bk-whopper', 'dodo-pepperoni', 'vkusno-nuggets'], 3);
  const a = trainerOffer(menu, mine, { trainer: 'mark', rng: seq(77) });
  const b = trainerOffer(menu, mine, { trainer: 'mark', rng: seq(77) });
  assert.deepEqual(a.team.map(c => c.id), b.team.map(c => c.id));
});
