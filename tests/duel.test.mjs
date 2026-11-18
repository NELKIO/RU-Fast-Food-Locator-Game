import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, battleStats, legalMoves, startBattle, validTeam } from '../public/js/duel-engine.js';
import { DuelRoom, newRoomCode, parseRoomCode, RECONNECT_MS, SILENT_MS } from '../public/js/duel-room.js';
import { SIGNAL_RELAYS } from '../public/js/duel-transport.js';
import { makeCodec } from '../public/js/duel-relay.js';
import { schnorr } from '../public/vendor/duel-trystero-0.27.0.js';

const a = { id: 'burger', hp: 18, attack: 5 };
const b = { id: 'fries', hp: 18, attack: 3 };
const c = { id: 'cola', hp: 8, attack: 2 };
const catalog = [a, b, c].map(card => ({ ...card, baseHp: card.hp, baseAttack: card.attack }));

test('a guard cuts a 5-point hit to 3, then clears; a charged special deals 8 through a fresh guard', () => {
  let fight = startBattle([[a], [b]], 1);
  const start = fight;
  for (const [side, action] of [[1, 'guard'], [0, 'hit'], [1, 'hit'], [0, 'hit'], [1, 'guard']]) {
    fight = applyMove(fight, side, action);
  }
  assert.equal(start.teams[1][0].hp, 18);
  assert.deepEqual([fight.teams[0][0].charge, fight.teams[1][0].hp], [2, 10]);
  fight = applyMove(fight, 0, 'special');
  assert.deepEqual([fight.teams[1][0].hp, fight.teams[1][0].guarding, fight.teams[0][0].charge], [2, false, 0]);
  assert.equal(applyMove(fight, 0, 'hit'), null);
});

test('switching consumes the turn; the first surviving reserve replaces a defeated fighter', () => {
  let fight = startBattle([[a, { ...c, hp: 2 }], [b]]);
  fight = applyMove(fight, 0, 'switch:1');
  assert.deepEqual([fight.turn, fight.active[0]], [1, 1]);
  fight = applyMove(fight, 1, 'hit');
  assert.deepEqual([fight.turn, fight.active[0], fight.teams[0][1].hp, fight.winner], [0, 0, 0, null]);
  assert.ok(!legalMoves(fight).includes('switch:1'));
  assert.equal(applyMove(fight, 0, 'special'), null);
});

test('the 48th turn ends a stalemate; the larger remaining health fraction wins, with exact ties drawn', () => {
  function run(equal) {
    const cards = [{ id: 'one', hp: 10, attack: 1 }, { id: 'two', hp: 10, attack: 1 }];
    const enemies = cards.map(item => ({ ...item, hp: equal ? 10 : 20 }));
    let fight = startBattle([cards, enemies]);
    fight = applyMove(fight, 0, 'hit');
    fight = applyMove(fight, 1, 'hit');
    for (let turn = 2; turn < 48; turn++) fight = applyMove(fight, fight.turn, 'switch:' + (1 - fight.active[fight.turn]));
    return fight;
  }
  assert.equal(run(true).winner, 'draw');
  assert.equal(run(false).winner, 1);
  assert.deepEqual(legalMoves(run(true)), []);
});

test('competition uses base stats, single-player retains levels; invalid team selections are rejected', () => {
  const card = { ...catalog[0], maxHp: 28, attack: 9 };
  assert.deepEqual(battleStats(card, true), { id: 'burger', hp: 18, attack: 5 });
  assert.deepEqual(battleStats(card), { id: 'burger', hp: 28, attack: 9 });
  const index = new Map(catalog.map(item => [item.id, item]));
  for (const ids of [[], ['ghost'], ['cola', 'cola'], ['cola', 'fries', 'burger', 'ghost'], null]) {
    assert.equal(validTeam(ids, index), false);
  }
});

test('codes copied with hyphens or shared as fragments round-trip; the relay pool spans different operators', () => {
  const code = newRoomCode();
  assert.equal(parseRoomCode(code.slice(0,5) + '-' + code.slice(5).toLowerCase()), code);
  assert.equal(parseRoomCode('https://example.org/game/#duel=' + code), code);
  for (const invalid of ['ABCDEFGHIJ', 'SHORT', 'ABC!234567', '#duel=', '', null]) assert.equal(parseRoomCode(invalid), null);
  assert.ok(new Set(SIGNAL_RELAYS.map(url => new URL(url).hostname)).size >= 3);
});

test('relay events keep commands private, authenticate the sender, bind the room and recipient, and deduplicate across paths', async () => {
  const [sender, recipient, other, stranger] = await Promise.all(
    ['BBBBB2222A', 'BBBBB2222A', 'BBBBB2222A', 'XXXXX7777H'].map(code => makeCodec(code, schnorr))
  );
  const body = { kind: 'packet', to: recipient.id, packet: { kind: 'state', history: ['special'] } };
  const event = await sender.seal(body);
  assert.ok(!JSON.stringify(event).includes('special'));
  assert.equal(await recipient.open({ ...event, content: event.content + 'x' }), null);
  assert.equal(await recipient.open({ ...event, pubkey: other.id }), null);
  assert.equal(await other.open(event), null);
  assert.equal(await stranger.open(event), null);
  const repeats = await Promise.all([recipient.open(event), recipient.open(event)]);
  assert.deepEqual(repeats.filter(Boolean), [{ sender: sender.id, payload: body }]);
  assert.equal(await recipient.open(event), null);
});

function pair({ guestCatalog = catalog } = {}) {
  let time = 1_000;
  const queue = [];
  const make = (role, cards) => new DuelRoom({
    role, cards, code: 'AAAAA2222A', now: () => time, makeId: () => 'match-12345', onChange() {},
    send: (to, packet) => queue.push({ to, packet: structuredClone(packet) })
  });
  const host = make('host', catalog);
  const guest = make('guest', guestCatalog);
  const deliver = () => {
    for (let count = 0; queue.length; count++) {
      assert.ok(count < 100, 'the protocol must settle without an echo loop');
      const { to, packet } = queue.shift();
      (to === 'h' ? host : guest).receive(to === 'h' ? 'g' : 'h', packet);
    }
  };
  const bind = () => { host.contact('g'); guest.contact('h'); deliver(); };
  const ready = () => { bind(); host.ready(['burger', 'cola']); guest.ready(['fries']); deliver(); };
  return { host, guest, queue, deliver, bind, ready, elapse(ms) { time += ms; } };
}

test('players confirm their teams independently, get equal team size and agree on every turn and the winner', () => {
  const { host, guest, deliver, bind } = pair();
  bind();
  guest.ready(['fries']); deliver();
  assert.equal(guest.state, null);
  assert.equal(host.state, null);
  host.ready(['burger', 'cola']); deliver();
  assert.deepEqual(host.state.teams.map(t => t.map(card => card.id)), [['burger'], ['fries']]);
  for (let turn = 0; turn < 7; turn++) {
    const player = turn % 2 === 0 ? host : guest;
    assert.equal(player.move('hit'), true);
    if (turn === 6) assert.equal(host.finished, false, 'last mover waits for the peer acknowledgment');
    deliver();
    assert.deepEqual(host.state, guest.state);
  }
  assert.deepEqual([host.finished, guest.finished, host.state.winner, guest.state.winner], [true, true, 0, 0]);
  assert.equal(guest.move('hit'), false);
});

test('duplicate moves, another sender, wrong actor, arbitrary state and fabricated replay entries cannot alter a match', () => {
  const { host, guest, queue, deliver, ready } = pair();
  ready();
  host.move('hit');
  const first = structuredClone(queue[0].packet);
  deliver();
  const before = structuredClone(guest.state);
  guest.contact('stranger');
  guest.receive('stranger', { ...first, history: ['hit', 'special'] });
  guest.receive('h', first);
  guest.receive('h', { ...first, history: ['hit', 'hit'] });
  guest.receive('h', { ...first, history: ['guard'] });
  guest.receive('h', { ...first, history: ['hit', 'hit', 'special'] });
  guest.receive('h', { ...first, matchId: 'old-room-id', history: [] });
  assert.deepEqual(guest.state, before);
  assert.equal(guest.move('hit'), true);
  deliver();
  assert.deepEqual(host.state, guest.state);
});

test('one lost in-flight move is recovered on reconnect; no move is accepted during the outage', () => {
  const network = pair();
  const { host, guest, queue, deliver } = network;
  network.ready();
  host.move('guard');
  queue.length = 0;
  host.disconnect('g'); guest.disconnect('h');
  network.elapse(8_000);
  assert.equal(guest.move('hit'), false);
  host.contact('g'); guest.contact('h'); deliver();
  assert.equal(guest.lostAt, null);
  assert.deepEqual(guest.history, ['guard']);
  guest.move('hit'); deliver();
  assert.deepEqual(host.state, guest.state);
});

test('a guest that missed the initial host hello still receives both lineups and the first turn', () => {
  const { host, guest, queue, deliver } = pair();
  host.ready(['burger']); guest.ready(['fries']);
  host.contact('g'); guest.contact('h');
  const initial = queue.splice(0);
  for (const message of initial) if (message.to === 'h') host.receive('g', message.packet);
  assert.ok(host.state);
  queue.length = 0; // Lose the host greeting and initial match packet.
  assert.equal(guest.peer, null);
  host.tick(); guest.tick(); deliver();
  assert.equal(guest.peer, 'h');
  assert.deepEqual(host.state, guest.state);
});

test('silent network partition ends the match on both devices without minting a victory', () => {
  const network = pair();
  network.ready();
  network.elapse(SILENT_MS + 10);
  network.host.tick(); network.guest.tick();
  assert.equal(network.host.actionable, false);
  network.queue.length = 0;
  network.elapse(RECONNECT_MS + 10);
  network.host.tick(); network.guest.tick();
  network.deliver();
  assert.deepEqual([network.host.reason, network.guest.reason], ['timeout', 'timeout']);
  assert.deepEqual([network.host.finished, network.guest.finished], [false, false]);
});

test('catalog mismatch aborts both seats; leaving a live match also reaches the other seat', () => {
  const mismatched = pair({ guestCatalog: catalog.map(card => ({ ...card, baseHp: card.hp + 1 })) });
  mismatched.ready();
  assert.deepEqual([mismatched.host.reason, mismatched.guest.reason], ['version', 'version']);
  const normal = pair();
  normal.ready();
  normal.guest.cancel('quit'); normal.deliver();
  assert.deepEqual([normal.host.reason, normal.guest.reason], ['quit', 'quit']);
});
