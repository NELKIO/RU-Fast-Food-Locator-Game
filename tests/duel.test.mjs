import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, battleStats, botMove, legalMoves, MAX_ENERGY, START_ENERGY, startBattle, validTeam } from '../public/js/duel-engine.js';
import { DuelRoom, newRoomCode, parseRoomCode, RECONNECT_MS, SILENT_MS } from '../public/js/duel-room.js';
import { SIGNAL_RELAYS } from '../public/js/duel-transport.js';
import { makeCodec } from '../public/js/duel-relay.js';
import { schnorr } from '../public/vendor/duel-trystero-0.27.0.js';

const a = { id: 'burger', hp: 18, attack: 5 };
const b = { id: 'fries', hp: 18, attack: 3 };
const c = { id: 'cola', hp: 8, attack: 2 };
const catalog = [a, b, c].map(card => ({ ...card, baseHp: card.hp, baseAttack: card.attack }));

// One fighter per side; side 0 moves first and neither side gets the tempo energy.
function duel(left, right, first = 0) {
  return startBattle([[{ id: 'left', hp: 20, attack: 5, ...left }], [{ id: 'right', hp: 20, attack: 5, ...right }]], first, { tempo: false });
}
const fighter = (state, side) => state.teams[side][state.active[side]];
function play(state, ...moves) {
  for (const move of moves) {
    const next = applyMove(state, state.turn, move);
    assert.ok(next, 'illegal move ' + move);
    state = next;
  }
  return state;
}

test('guard halves a hit rounding up and charges energy; the second player in a duel starts with one extra energy', () => {
  let fight = play(duel({}, {}), 'guard', 'hit');
  assert.deepEqual([fighter(fight, 0).hp, fighter(fight, 0).guarding, fighter(fight, 0).energy], [17, false, 2]);
  assert.equal(fight.last.blocked, true);
  const online = startBattle([[a], [b]], 1);
  assert.deepEqual([online.teams[0][0].energy, online.teams[1][0].energy], [START_ENERGY + 1, START_ENERGY]);
  const solo = startBattle([[a], [b]], 0, { tempo: false });
  assert.deepEqual([solo.teams[0][0].energy, solo.teams[1][0].energy], [START_ENERGY, START_ENERGY]);
});

test('a skill needs its energy, spends it, names itself and pierces guard when it says so', () => {
  const skill = { name: 'Укол', cost: 2, power: 3, pierce: true };
  let fight = duel({ skill }, {}, 1);
  fight = play(fight, 'guard');
  assert.ok(!legalMoves(fight).includes('special'));
  fight = play(fight, 'hit', 'guard');
  assert.equal(fighter(fight, 0).energy, 2);
  fight = play(fight, 'special');
  assert.deepEqual([fight.last.skill, fight.last.damage, fight.last.blocked], ['Укол', 8, false]);
  assert.equal(fighter(fight, 0).energy, 0);
});

test('a shield soaks damage before health; drain heals half the dealt damage rounding up', () => {
  let fight = duel({ skill: { cost: 1, shield: 4 } }, { skill: { cost: 1, power: 0, drain: true } });
  fight = play(fight, 'special');
  assert.equal(fighter(fight, 0).shield, 4);
  fight = play(fight, 'hit');
  assert.deepEqual([fight.last.absorbed, fight.last.damage, fighter(fight, 0).hp, fighter(fight, 0).shield], [4, 1, 19, 0]);
  fight = play(fight, 'hit', 'special');
  assert.equal(fight.last.damage, 5);
  assert.equal(fight.last.heal, 3);
  assert.equal(fighter(fight, 1).hp, 18);
});

test('burning ticks after the burning fighter acts, pauses on a switch and runs out', () => {
  const teams = [
    [{ id: 'torch', hp: 20, attack: 1, skill: { cost: 1, power: 0, burn: { dmg: 2, turns: 2 } } }],
    [{ id: 'target', hp: 20, attack: 1 }, { id: 'bench', hp: 20, attack: 1 }],
  ];
  let fight = play(startBattle(teams, 0, { tempo: false }), 'special');
  assert.deepEqual([fight.teams[1][0].hp, fight.teams[1][0].burn], [19, { dmg: 2, turns: 2 }]);
  fight = play(fight, 'switch:1', 'hit', 'switch:0');
  assert.equal(fight.teams[1][0].hp, 19, 'switching does not burn');
  fight = play(fight, 'hit', 'hit');
  assert.deepEqual([fight.last.burned, fight.teams[1][0].hp], [2, 16]);
  fight = play(fight, 'hit', 'hit');
  assert.deepEqual([fight.teams[1][0].hp, fight.teams[1][0].burn], [13, null]);
  fight = play(fight, 'hit', 'hit');
  assert.equal(fight.last.burned, 0);
});

test('weaken stops three below base attack; buff stops four above; sap empties energy', () => {
  let fight = play(duel({ attack: 6 }, { hp: 40, skill: { cost: 1, weaken: 2, sap: true } }), 'hit', 'special');
  assert.deepEqual([fighter(fight, 0).attack, fighter(fight, 0).energy], [4, 0]);
  assert.deepEqual(fight.last.effects, ['weaken', 'sap']);
  fight = play(fight, 'hit', 'hit', 'hit', 'special');
  assert.equal(fighter(fight, 0).attack, 3);
  fight = play(fight, 'hit', 'hit', 'hit', 'special');
  assert.equal(fighter(fight, 0).attack, 3);
  assert.ok(!fight.last.effects.includes('weaken'));
  fight = play(duel({ skill: { cost: 1, power: 0, buff: 3 } }, {}), 'special', 'hit', 'hit', 'hit', 'special');
  assert.equal(fighter(fight, 0).attack, 9);
});

test('execute adds damage only against a hurt target; recoil never knocks out its user; team heal reaches the bench', () => {
  const finisher = { skill: { cost: 1, power: 0, execute: 4 } };
  let fight = play(duel(finisher, {}), 'special');
  assert.deepEqual([fight.last.damage, fight.last.executed], [5, false]);
  fight = play(duel(finisher, {}), 'hit', 'hit', 'hit', 'hit', 'special');
  assert.deepEqual([fight.last.damage, fight.last.executed], [9, true]);
  fight = play(duel({ hp: 2, skill: { cost: 1, power: 1, recoil: 5 } }, {}), 'special');
  assert.deepEqual([fighter(fight, 0).hp, fight.last.recoil], [1, 1]);
  const medics = [[{ id: 'medic', hp: 20, attack: 1, skill: { cost: 1, team: 5 } }, { id: 'bench', hp: 20, attack: 1 }], [{ id: 'foe', hp: 20, attack: 4 }]];
  fight = play(startBattle(medics, 1, { tempo: false }), 'hit', 'switch:1', 'hit', 'switch:0', 'hit', 'special');
  assert.deepEqual(fight.teams[0].map(f => f.hp), [17, 20]);
  assert.ok(fight.last.effects.includes('team'));
});

test('the bot takes a knockout when one hit is enough and otherwise uses a damaging skill', () => {
  let fight = duel({}, { hp: 3 });
  assert.equal(botMove(fight, () => 0), 'hit');
  fight = duel({ skill: { cost: 1, power: 2 } }, {});
  assert.equal(botMove(fight, () => 0), 'special');
  for (let i = 0; i < 40 && fight.winner === null; i++) fight = applyMove(fight, fight.turn, botMove(fight, () => 0.5));
  assert.notEqual(fight.winner, null);
});

test('armour trims blows that do not pierce, never below 1; thorns hurt the attacker but never knock it out', () => {
  let fight = play(duel({}, { trait: { armor: 2 } }), 'hit');
  assert.deepEqual([fight.last.damage, fight.last.armored], [3, 2]);
  fight = play(duel({ attack: 2 }, { trait: { armor: 2 } }), 'hit');
  assert.equal(fight.last.damage, 1);
  fight = play(duel({ skill: { cost: 1, power: 0, pierce: true } }, { trait: { armor: 2 } }), 'special');
  assert.equal(fight.last.damage, 5);
  fight = play(duel({ hp: 2 }, { trait: { thorns: 2 } }), 'hit');
  assert.deepEqual([fight.last.thorns, fighter(fight, 0).hp], [1, 1]);
  fight = play(duel({}, { trait: { thorns: 2 } }), 'hit');
  assert.deepEqual([fight.last.thorns, fighter(fight, 0).hp], [2, 18]);
});

test('regeneration follows own actions but not while burning; rage adds to blows at half health', () => {
  let fight = play(duel({ trait: { regen: 2 } }, {}), 'guard', 'hit', 'hit');
  assert.deepEqual([fight.last.regen, fighter(fight, 0).hp], [2, 19]);
  const torch = { skill: { cost: 1, power: 0, burn: { dmg: 1, turns: 3 } } };
  fight = play(duel({ trait: { regen: 2 } }, torch), 'guard', 'special', 'hit');
  assert.equal(fight.last.regen, 0);
  fight = play(duel({ hp: 20, trait: { rage: 3 } }, { attack: 10 }), 'hit', 'hit', 'hit');
  assert.deepEqual([fight.last.damage, fight.last.rage], [8, true]);
});

test('fireproof stops burning, steady stops weakening and energy loss, quick starts charged, vamp heals on hits', () => {
  const nasty = { skill: { cost: 1, power: 0, burn: { dmg: 2, turns: 2 }, weaken: 2, sap: true } };
  let fight = play(duel({ trait: { fireproof: true } }, nasty, 1), 'special');
  assert.deepEqual([fighter(fight, 0).burn, fighter(fight, 0).attack], [null, 3]);
  fight = play(duel({ trait: { steady: true } }, nasty, 1), 'special');
  assert.deepEqual([fighter(fight, 0).attack, fighter(fight, 0).energy, fighter(fight, 0).burn?.dmg], [5, 1, 2]);
  assert.equal(duel({ trait: { quick: 1 } }, {}).teams[0][0].energy, START_ENERGY + 1);
  fight = play(duel({ trait: { vamp: 2 } }, {}), 'guard', 'hit', 'hit');
  assert.deepEqual([fight.last.heal, fighter(fight, 0).hp], [2, 19]);
});

test('last stand survives the first lethal blow once; a super move costs 3 and shatter strips shield and guard', () => {
  let fight = play(duel({ attack: 30 }, { trait: { laststand: true } }), 'hit');
  assert.deepEqual([fighter(fight, 1).hp, fight.last.saved, fight.winner], [1, true, null]);
  fight = play(fight, 'hit', 'hit');
  assert.equal(fight.winner, 0);
  const ultimate = { name: 'Финал', cost: 3, power: 4, shatter: true };
  fight = play(duel({ ultimate }, { skill: { cost: 1, shield: 6 } }, 1), 'guard', 'hit', 'special');
  assert.ok(!legalMoves(fight).includes('ultimate'));
  fight = play(fight, 'hit', 'guard');
  assert.ok(legalMoves(fight).includes('ultimate'));
  fight = play(fight, 'ultimate');
  assert.deepEqual([fight.last.skill, fight.last.damage, fight.last.blocked, fighter(fight, 1).shield, fighter(fight, 0).energy], ['Финал', 9, false, 0, 0]);
  assert.ok(fight.last.effects.includes('shatter'));
  assert.equal(botMove(duel({ ultimate: { cost: 3, power: 1 }, trait: { quick: 2 } }, {}), () => 0.9), 'ultimate');
  const stats = battleStats({ id: 'x', hp: 9, attack: 2, skill: { cost: 2 }, ultimate, trait: { armor: 1, name: 'ignored' } }, true);
  assert.deepEqual([stats.ultimate.name, stats.trait], ['Финал', { armor: 1 }]);
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
  const skill = { name: 'Укус', cost: 9, power: 2, label: 'ignored' };
  const card = { ...catalog[0], maxHp: 28, attack: 9, skill };
  const clean = { name: 'Укус', cost: MAX_ENERGY, power: 2 };
  assert.deepEqual(battleStats(card, true), { id: 'burger', hp: 18, attack: 5, skill: clean });
  assert.deepEqual(battleStats(card), { id: 'burger', hp: 28, attack: 9, skill: clean });
  assert.deepEqual(battleStats(catalog[1]).skill, { name: 'Фирменный приём', cost: 2 });
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

test('the last mover keeps a finished result when the acknowledgment never arrives', () => {
  const network = pair();
  const { host, guest, queue, deliver } = network;
  network.ready();
  for (let turn = 0; turn < 6; turn++) { (turn % 2 ? guest : host).move('hit'); deliver(); }
  assert.equal(host.move('hit'), true);
  assert.equal(host.state.winner, 0);
  assert.equal(host.finished, false);
  queue.length = 0;
  host.disconnect('g');
  network.elapse(RECONNECT_MS + 10);
  host.tick();
  assert.deepEqual([host.finished, host.reason, host.settledAlone], [true, null, true]);
  host.cancel('left');
  assert.equal(host.reason, null, 'a settled match cannot be cancelled afterwards');
});
