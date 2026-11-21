import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyMove, battleStats, legalMoves, MAX_ENERGY, startBattle } from '../public/js/duel-engine.js';
import { DuelRoom } from '../public/js/duel-room.js';
import { describeSkill } from '../public/js/fighters.js';
import { cardFor } from '../public/js/game.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
const cards = menu.map(item => cardFor(item));
const card = id => cards.find(fighter => fighter.id === id);

test('tempo adds to the second lead without exceeding the energy cap', () => {
  const lead = battleStats(card('bk-fries'));
  const quick = battleStats(card('vkusno-seasoning-provence-sour-cream'));
  assert.equal(startBattle([[lead], [quick]], 0, {tempo: false}).teams[1][0].energy, 2);
  assert.equal(startBattle([[lead], [{...quick, trait: {quick: 2}}]], 0).teams[1][0].energy, MAX_ENERGY);
});

test('the published flurry damage is shared across strikes, including totals smaller than the hit count', () => {
  const king = card('bk-big-king');
  const herbs = card('vkusno-seasoning-provence-sour-cream');
  for (const [fighter, attack, expected] of [[king, king.attack, 6], [herbs, herbs.attack, 5], [herbs, 3, 2], [herbs, 1, 0]]) {
    const attacker = {...battleStats(fighter), attack, trait: {quick: 2}};
    const target = {id: 'practice-target', hp: 40, attack: 1};
    const fight = startBattle([[attacker], [target]], 0, {tempo: false});
    const result = applyMove(fight, 0, 'special');
    assert.equal(Number.parseInt(describeSkill(fighter.skill, attack), 10), expected);
    assert.equal(result.last.hits, 4);
    assert.equal(result.last.damage, expected);
    assert.equal(result.teams[1][0].hp, target.hp - expected);
  }
});

test('two duel peers agree on the extra starting energy and the damage from a flurry', () => {
  const queue = [], rooms = {};
  for (const role of ['host', 'guest']) {
    rooms[role] = new DuelRoom({role, code: 'AAAABBBBCC', cards, onChange() {},
      send(destination, packet) { queue.push({source: role, destination, packet}); }});
  }
  function deliver() {
    while (queue.length) {
      const {source, destination, packet} = queue.shift();
      rooms[destination].receive(source, packet);
    }
  }
  rooms.host.contact('guest');
  rooms.guest.contact('host');
  deliver();
  rooms.host.ready(['bk-fries']);
  rooms.guest.ready(['vkusno-seasoning-provence-sour-cream']);
  deliver();
  assert.equal(rooms.host.state.teams[1][0].energy, MAX_ENERGY);
  assert.ok(rooms.host.move('hit'));
  deliver();
  assert.ok(legalMoves(rooms.guest.state).includes('ultimate'));
  assert.ok(rooms.guest.move('special'));
  deliver();
  assert.equal(rooms.host.state.last.damage, 5);
  assert.deepEqual(rooms.host.state, rooms.guest.state);
});
