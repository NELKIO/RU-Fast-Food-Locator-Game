import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, battleStats, botMove, legalMoves, MAX_ENERGY, opener, SPEED, START_ENERGY, startBattle, validTeam } from '../public/js/duel-engine.js';
import { DUEL_PROTOCOL, DuelRoom, newRoomCode, parseRoomCode, RECONNECT_MS, SILENT_MS } from '../public/js/duel-room.js';
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
  fight = play(fight, 'hit');
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
  assert.deepEqual(battleStats(card, true), { id: 'burger', hp: 18, attack: 5, speed: 5, skill: clean });
  assert.deepEqual(battleStats(card), { id: 'burger', hp: 28, attack: 9, speed: 5, skill: clean });
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

function pair({ hostCatalog = catalog, guestCatalog = catalog, levelCard = null } = {}) {
  let time = 1_000;
  const queue = [];
  const make = (role, cards) => new DuelRoom({
    role, cards, code: 'AAAAA2222A', now: () => time, makeId: () => 'match-12345', onChange() {}, levelCard,
    send: (to, packet) => queue.push({ to, packet: structuredClone(packet) })
  });
  let host = make('host', hostCatalog);
  let guest = make('guest', guestCatalog);
  const deliver = (allow = () => true) => {
    for (let count = 0; queue.length; count++) {
      assert.ok(count < 100, 'the protocol must settle without an echo loop');
      const message = queue.shift();
      if (!allow(message)) continue;
      const { to, packet } = message;
      (to === 'h' ? host : guest).receive(to === 'h' ? 'g' : 'h', packet);
    }
  };
  const bind = () => { host.contact('g'); guest.contact('h'); deliver(); };
  const ready = () => { bind(); host.ready(['burger', 'cola']); guest.ready(['fries']); deliver(); };
  const reload = (role, snapshot, cards = role === 'host' ? hostCatalog : guestCatalog) => {
    const fresh = make(role, cards);
    assert.equal(fresh.restore(snapshot), true);
    if (role === 'host') host = fresh;
    else guest = fresh;
    return fresh;
  };
  return { get host() { return host; }, get guest() { return guest; }, queue, deliver, bind, ready, reload, elapse(ms) { time += ms; } };
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
    if (turn === 6) assert.deepEqual([host.finished, host.peerHasFinal], [true, false]);
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

test('a lineup confirmed before meeting the peer stays private until the seat is checkpointed', () => {
  const { host, guest, queue, deliver } = pair();
  host.ready(['burger']); guest.ready(['fries']);
  let saved;
  guest.onChange = () => { saved = guest.snapshot(); };
  const send = guest.send;
  guest.send = (peer, packet) => {
    if (packet.kind === 'hello' && packet.team) {
      assert.equal(saved?.phase, 'ready');
      assert.equal(saved.peer, peer);
      assert.deepEqual(saved.team, packet.team);
    }
    send(peer, packet);
  };
  host.contact('g'); guest.contact('h');
  const initial = queue.splice(0);
  assert.ok(initial.every(({ packet }) => packet.team === null));
  for (const message of initial) if (message.to === 'h') host.receive('g', message.packet);
  queue.length = 0; // Lose the host greeting.
  assert.equal(host.state, null);
  assert.equal(guest.peer, null);
  host.tick(); guest.tick(); deliver();
  assert.equal(guest.peer, 'h');
  assert.deepEqual(host.state, guest.state);
  assert.equal(host.actionable, true);
});

test('a lost first state survives the grace period and a reload of both players', () => {
  const network = pair();
  network.bind();
  network.host.ready(['burger']); network.guest.ready(['fries']);
  network.deliver(({ packet }) => packet.kind !== 'state');
  assert.equal(network.host.matchId, 'match-12345');
  assert.equal(network.host.move('hit'), false);
  const ready = network.guest.snapshot();
  assert.deepEqual([ready.phase, ready.matchId, ready.peerTeam, ready.history], ['ready', null, ['burger'], []]);
  network.host.disconnect('g'); network.guest.disconnect('h');
  network.elapse(RECONNECT_MS * 3);
  network.host.tick(); network.guest.tick();
  assert.deepEqual([network.host.pending, network.guest.pending, network.guest.reason], [true, true, null]);
  network.queue.length = 0;
  const host = network.reload('host', network.host.snapshot());
  const guest = network.reload('guest', ready);
  host.makeId = () => assert.fail('The host already allocated the match.');
  assert.equal(guest.ready(['cola']), false);
  assert.equal(guest.receiveArchive('h', host.statePacket()), false);
  network.bind();
  assert.equal(guest.snapshot().phase, 'battle');
  assert.equal(host.matchId, guest.matchId);
  assert.equal(host.move('hit'), true);
  network.deliver();
  assert.deepEqual(host.state, guest.state);
});

test('two lost ready messages keep the frozen levels, peer and revisions through reload', () => {
  const withLevel = level => catalog.map(card => ({ ...card, level }));
  const levelCard = (card, level) => ({ ...card, maxHp: card.baseHp + 2 * (level - 1) });
  const network = pair({ hostCatalog: withLevel(3), guestCatalog: withLevel(4), levelCard });
  network.bind();
  network.host.setFair(false); network.guest.setFair(false); network.deliver();
  network.host.ready(['burger']); network.guest.ready(['fries']);
  network.queue.length = 0;
  network.host.disconnect('g'); network.guest.disconnect('h');
  network.elapse(RECONNECT_MS * 3);
  network.host.tick(); network.guest.tick(); network.queue.length = 0;
  const host = network.reload('host', network.host.snapshot(), withLevel(9));
  const guest = network.reload('guest', network.guest.snapshot(), withLevel(10));
  assert.deepEqual([host.revision, guest.revision, host.peerRevision, guest.peerRevision], [2, 2, 1, 1]);
  assert.deepEqual([host.peerTeam, guest.peerTeam, host.reason, guest.reason], [null, null, null, null]);
  host.contact('g');
  host.receive('g', { v: DUEL_PROTOCOL, side: 1, kind: 'hello', revision: 0, fair: true, team: null });
  assert.equal(host.peerFair, false);
  network.bind();
  assert.deepEqual(host.levels, [{ burger: 3 }, { fries: 4 }]);
  assert.deepEqual(host.state.teams.map(team => team[0].maxHp), [22, 24]);
  assert.deepEqual(host.state, guest.state);
});

test('ready checkpoints reject inconsistent seats or histories and an explicit quit closes the provisional start', () => {
  const network = pair();
  network.bind();
  network.host.ready(['burger']); network.guest.ready(['fries']);
  network.deliver(({ packet }) => packet.kind !== 'state');
  const saved = network.guest.snapshot();
  const fresh = pair().guest;
  for (const change of [
    { phase: 'other' }, { matchId: 'impossible-match' }, { history: ['hit'] }, { peerHasFinal: true },
    { peer: '' }, { team: ['missing'] }, { peerTeam: ['missing'] }, { ownLevels: { fries: 0 } },
    { peerLevels: { burger: 3 } }, { revision: 0 }, { peerRevision: -1 }, { reason: 'quit' },
  ]) {
    assert.equal(fresh.restore({ ...saved, ...change }), false);
    assert.equal(fresh.snapshot(), null);
  }
  network.guest.cancel('quit'); network.deliver();
  assert.deepEqual([network.guest.reason, network.host.reason], ['quit', 'quit']);
  assert.equal(network.guest.snapshot(), null);
  assert.equal(network.host.finished, false);
});

test('a silent network partition suspends the match on both devices without minting a victory', () => {
  const network = pair();
  network.ready();
  network.elapse(SILENT_MS + 10);
  network.host.tick(); network.guest.tick();
  assert.equal(network.host.actionable, false);
  network.queue.length = 0;
  network.elapse(RECONNECT_MS + 10);
  network.host.tick(); network.guest.tick();
  assert.deepEqual([network.host.pending, network.guest.pending], [true, true]);
  assert.deepEqual([network.host.reason, network.guest.reason], [null, null]);
  assert.deepEqual([network.host.finished, network.guest.finished], [false, false]);
  network.deliver();
  assert.deepEqual([network.host.pending, network.guest.pending], [false, false]);
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

function finalMoveInFlight() {
  const network = pair();
  const { host, guest, deliver } = network;
  network.ready();
  for (let turn = 0; turn < 6; turn++) { (turn % 2 ? guest : host).move('hit'); deliver(); }
  assert.equal(host.move('hit'), true);
  assert.equal(host.state.winner, 0);
  assert.equal(host.finished, true);
  assert.equal(host.peerHasFinal, false);
  return network;
}

test('a lost final packet leaves the other player pending and a lost receipt never cancels a winner', () => {
  for (const deliveredLastMove of [false, true]) {
    const { host, guest, queue, elapse } = finalMoveInFlight();
    if (deliveredLastMove) guest.receive('h', queue.shift().packet);
    queue.length = 0;
    host.disconnect('g'); guest.disconnect('h');
    elapse(RECONNECT_MS + 1);
    host.tick(); guest.tick();
    assert.deepEqual([host.reason, guest.reason], [null, null]);
    assert.deepEqual([host.finished, guest.finished], [true, deliveredLastMove]);
    assert.equal(host.peerHasFinal, false);
    if (!deliveredLastMove) assert.equal(guest.pending, true);
    host.cancel('quit');
    assert.equal(host.reason, null);
  }
});

test('reconnecting after the grace period recovers the last move and both receipts', () => {
  const { host, guest, queue, elapse, deliver } = finalMoveInFlight();
  queue.length = 0;
  host.disconnect('g'); guest.disconnect('h');
  elapse(RECONNECT_MS * 8);
  host.tick(); guest.tick(); queue.length = 0;
  host.contact('g'); guest.contact('h'); deliver();
  assert.deepEqual([host.finished, guest.finished], [true, true]);
  assert.deepEqual([host.peerHasFinal, guest.peerHasFinal], [true, true]);
  assert.equal(host.matchId, guest.matchId);
  assert.deepEqual(host.state, guest.state);
  assert.equal(host.state.winner, 0);
});

test('a terminal archive completes only the bound journal and does not mark the sender online', () => {
  const { host, guest } = finalMoveInFlight();
  const packet = host.finalPacket();
  const before = guest.snapshot();
  guest.disconnect('h');
  const lostAt = guest.lostAt;
  let updates = 0;
  guest.onChange = () => updates++;
  for (const [peer, change] of [
    ['another-person', {}], ['h', { v: DUEL_PROTOCOL - 1 }], ['h', { side: 1 }],
    ['h', { matchId: 'another-match' }], ['h', { signature: 'another-lineup' }],
    ['h', { teams: [['burger'], ['fries']] }], ['h', { levels: [{}, {}] }],
    ['h', { history: before.history }], ['h', { history: ['guard', ...packet.history.slice(1)] }],
    ['h', { history: [...packet.history, 'hit'] }],
  ]) assert.equal(guest.receiveArchive(peer, { ...packet, ...change }), false);
  assert.equal(updates, 0);
  assert.deepEqual(guest.snapshot(), before);
  assert.equal(pair().guest.receiveArchive('h', packet), false);
  assert.equal(guest.receiveArchive('h', packet), true);
  assert.equal(guest.receiveArchive('h', packet), true);
  assert.equal(updates, 1);
  assert.deepEqual(guest.state, host.state);
  assert.equal(guest.peerHasFinal, true);
  assert.equal(guest.lostAt, lostAt);
  assert.equal(guest.known.has('h'), false);
});

test('a browser departure preserves the match, and a verified terminal history survives a simultaneous quit', () => {
  const { host, guest, queue } = finalMoveInFlight();
  const packet = host.finalPacket();
  queue.length = 0;
  guest.cancel('left');
  assert.equal(guest.reason, null);
  assert.equal(queue.length, 0);
  guest.cancel('quit');
  assert.equal(guest.reason, 'quit');
  host.receive('g', queue.shift().packet);
  assert.equal(host.finished, true);
  assert.equal(host.reason, null);
  assert.equal(guest.receiveArchive('h', packet), true);
  assert.equal(guest.finished, true);
  assert.equal(guest.reason, null);
  assert.deepEqual(guest.state, host.state);
});

test('a revived browser uses match-time levels and waits for the bound player and the matching history', () => {
  const levelCard = (card, level) => ({ ...card, maxHp: card.baseHp + 2 * (level - 1) });
  const ranked = catalog.map(card => ({ ...card, level: 3 }));
  const network = pair({ hostCatalog: ranked, guestCatalog: ranked, levelCard });
  network.bind();
  network.host.setFair(false); network.guest.setFair(false);
  network.host.ready(['burger']); network.guest.ready(['fries']); network.deliver();
  network.host.move('hit'); network.deliver();
  network.guest.move('hit'); network.deliver();
  const saved = JSON.parse(JSON.stringify(network.host.snapshot()));
  const remote = network.guest.statePacket();
  const fresh = network.reload('host', { ...saved, winner: 1 }, ranked.map(card => ({ ...card, level: 10 })));
  assert.equal(fresh.state.winner, null);
  assert.equal(fresh.state.teams[0][0].maxHp, 22);
  assert.equal(fresh.actionable, false);
  fresh.contact('somebody-else');
  fresh.receive('somebody-else', remote);
  fresh.contact('g');
  fresh.receive('g', { v: DUEL_PROTOCOL, side: 1, kind: 'hello', revision: 1, team: ['fries'] });
  fresh.receive('g', { ...remote, history: ['hit'] });
  fresh.receive('g', { ...remote, matchId: 'different-match' });
  assert.equal(fresh.actionable, false);
  fresh.receive('g', remote);
  assert.equal(fresh.actionable, true);
  assert.deepEqual(fresh.state, network.guest.state);
});

test('restore rejects incompatible snapshots atomically and derives the winner from all legal moves', () => {
  const { host, guest } = finalMoveInFlight();
  const saved = host.snapshot();
  const fresh = pair().host;
  for (const change of [
    { code: 'BBBBB2222A' }, { side: 1 }, { v: 4 }, { peer: '' }, { matchId: 'x' },
    { v: DUEL_PROTOCOL + 1 }, { phase: undefined }, { phase: 'other' }, { revision: undefined },
    { peerRevision: -1 }, { ownLevels: null },
    { matchId: 'prototype' }, { matchId: 'constructor' }, { matchId: 'match\n12345' },
    { teams: [['burger'], ['missing']] }, { signature: 'wrong' }, { levels: [{}, {}] },
    { leveled: true }, { history: [...saved.history, 'hit'] }, { history: ['switch:2'] },
  ]) {
    assert.equal(fresh.restore({ ...saved, ...change }), false);
    assert.equal(fresh.snapshot(), null);
  }
  assert.equal(fresh.restore({ ...saved, winner: 1 }), true);
  assert.equal(fresh.state.winner, 0);
  assert.deepEqual(fresh.state, host.state);
  assert.equal(fresh.restore(guest.snapshot()), false);
  const copy = fresh.snapshot();
  copy.teams[0].pop();
  copy.history.pop();
  assert.deepEqual(fresh.snapshot(), saved);
});

test('a local move is checkpointed before it is offered to the transport', () => {
  const network = pair();
  network.ready();
  const { host } = network;
  let saved;
  host.onChange = () => { saved = host.snapshot(); };
  host.send = (_, packet) => assert.deepEqual(saved.history, packet.history);
  assert.equal(host.move('guard'), true);
});

test('a final move refused by local storage cannot finish the match or reach its peer', () => {
  const network = pair();
  network.ready();
  const { host, guest } = network;
  for (let i = 0; i < 6; i++) { (i % 2 ? guest : host).move('hit'); network.deliver(); }
  const before = host.snapshot();
  let allow = false;
  const events = [];
  host.persistMove = snapshot => {
    assert.deepEqual(snapshot.history, [...before.history, 'hit']);
    assert.equal(snapshot.winner, 0);
    events.push('write');
    return allow;
  };
  host.onChange = () => events.push(host.finished ? 'finished' : 'playing');
  host.send = () => events.push('send');
  assert.equal(host.move('hit'), false);
  assert.deepEqual(host.snapshot(), before);
  assert.deepEqual(events, ['write', 'playing']);
  allow = true;
  assert.equal(host.move('hit'), true);
  assert.deepEqual(events, ['write', 'playing', 'write', 'finished', 'send']);
});

test('speed decides who opens, equal speed falls back to the tie rule, and odd values are clamped', () => {
  const quick = { id: 'quick', hp: 10, attack: 3, speed: 8 }, slow = { id: 'slow', hp: 10, attack: 3, speed: 2 };
  assert.equal(opener([[quick], [slow]]), 0);
  assert.equal(opener([[slow], [quick]]), 0 + 1);
  assert.equal(opener([[{ ...slow, speed: 8 }], [quick]], 1), 1);
  assert.equal(opener([[{ id: 'x', hp: 5, attack: 1 }], [{ id: 'y', hp: 5, attack: 1 }]], 0), 0, 'missing speed is the base speed on both sides');
  assert.equal(battleStats({ id: 'x', hp: 5, attack: 1 }).speed, SPEED.base);
  assert.equal(battleStats({ id: 'x', hp: 5, attack: 1, speed: 99 }).speed, SPEED.max);
  assert.equal(battleStats({ id: 'x', hp: 5, attack: 1, speed: 0 }).speed, SPEED.min);
  assert.equal(battleStats({ id: 'x', hp: 5, attack: 1, speed: 2.5 }).speed, SPEED.base);
});

test('after a knockout the faster fighter on the arena moves first, even twice in a row', () => {
  const teams = (reserveSpeed) => [
    [{ id: 'hammer', hp: 30, attack: 9, speed: 6 }],
    [{ id: 'glass', hp: 5, attack: 2, speed: 9 }, { id: 'reserve', hp: 30, attack: 2, speed: reserveSpeed }],
  ];
  let fight = startBattle(teams(3), 0, { tempo: false });
  fight = applyMove(fight, 0, 'hit');
  assert.deepEqual(fight.last.ko, ['glass']);
  assert.equal(fight.turn, 0, 'the slower newcomer waits: the hammer strikes again');
  assert.ok(applyMove(fight, 0, 'hit'));
  assert.equal(applyMove(fight, 1, 'hit'), null);
  fight = applyMove(startBattle(teams(8), 0, { tempo: false }), 0, 'hit');
  assert.equal(fight.turn, 1, 'a faster newcomer moves at once');
  fight = applyMove(startBattle(teams(6), 0, { tempo: false }), 0, 'hit');
  assert.equal(fight.turn, 1, 'equal speed keeps the usual order');
});

test('a duel peer that moves twice after a knockout is followed even when the first packet is lost', () => {
  const cards = [
    { id: 'hammer', hp: 30, attack: 9, speed: 7 }, { id: 'anvil', hp: 30, attack: 2, speed: 7 },
    { id: 'glass', hp: 5, attack: 2, speed: 1 }, { id: 'reserve', hp: 30, attack: 2, speed: 2 },
  ].map(card => ({ ...card, baseHp: card.hp, baseAttack: card.attack }));
  const queue = [];
  const make = role => new DuelRoom({
    role, cards, code: 'AAAAA2222A', now: () => 1_000, makeId: () => 'match-speed', onChange() {},
    send: (to, packet) => queue.push({ to, packet: structuredClone(packet) })
  });
  const host = make('host'), guest = make('guest');
  const deliver = () => { while (queue.length) { const { to, packet } = queue.shift(); (to === 'h' ? host : guest).receive(to === 'h' ? 'g' : 'h', packet); } };
  host.contact('g'); guest.contact('h'); deliver();
  host.ready(['hammer', 'anvil']); guest.ready(['glass', 'reserve']); deliver();
  assert.equal(host.state.turn, host.side, 'the faster host opens');
  assert.equal(host.move('hit'), true);
  queue.length = 0;
  assert.equal(host.move('hit'), true, 'the host moves again after the knockout');
  deliver();
  assert.deepEqual(guest.history, ['hit', 'hit']);
  assert.deepEqual(guest.state, host.state);
  assert.equal(guest.state.turn, guest.side);
});

// New effects (round 4): freeze, sleep, heartburn, draining, flurries, wipe, charge, grim look.
test('freeze: the target misses its next turn, the freezer moves again, and it cannot be refrozen right away', () => {
  const skill = { name: 'Лёд', cost: 1, power: 0, freeze: true };
  let fight = duel({ skill }, {});
  fight = play(fight, 'special');
  assert.ok(fight.last.effects.includes('freeze'));
  assert.equal(fight.turn, 0, 'the frozen side is skipped at once');
  assert.deepEqual(fight.last.skips.map(s => [s.kind, s.recovered]), [['freeze', true]]);
  assert.equal(fighter(fight, 1).status, null);
  assert.equal(fighter(fight, 1).rested, true);
  fight.teams[0][0].energy = 3;
  fight = play(fight, 'special');
  assert.ok(!fight.last.effects.includes('freeze') && fight.turn === 1, 'just thawed: alert, not frozen again');
  fight = play(fight, 'hit');
  assert.equal(fighter(fight, 1).rested, false, 'its own action ends the alert');
});

test('fire thaws a frozen fighter; only a sterile fighter does not freeze', () => {
  const fire = duel({ skill: { name: 'Огонь', cost: 1, power: 0, burn: { dmg: 1, turns: 2 } } }, { trait: { fireproof: true } });
  fire.teams[1][0].status = { kind: 'freeze', turns: 1 };
  const after = play(fire, 'special');
  assert.ok(after.last.effects.includes('thaw'));
  assert.equal(fighter(after, 1).status, null);
  assert.equal(fighter(after, 1).burn, null, 'fireproof still does not burn, but the ice is gone');
  for (const trait of [{ pure: true }]) {
    const iced = play(duel({ skill: { name: 'Лёд', cost: 1, freeze: true } }, { trait }), 'special');
    assert.ok(iced.last.effects.includes('immune'));
    assert.equal(fighter(iced, 1).status, null);
    assert.equal(iced.turn, 1);
  }
});

test('sleep lasts its turns unless a blow lands; moves without damage keep the target asleep', () => {
  const skill = { name: 'Сытость', cost: 1, sleep: 2 };
  let fight = duel({ skill, ultimate: { name: 'Щит', cost: 3, shield: 4 } }, {});
  fight = play(fight, 'special');
  assert.equal(fight.turn, 0);
  assert.deepEqual(fighter(fight, 1).status, { kind: 'sleep', turns: 1 });
  fight = play(fight, 'guard'); // no blow: still asleep, the second turn is skipped too
  assert.equal(fight.turn, 0);
  assert.equal(fighter(fight, 1).status, null);
  const woken = play(play(duel({ skill }, {}), 'special'), 'hit');
  assert.ok(woken.last.effects.includes('wake'));
  assert.equal(fighter(woken, 1).status, null);
  assert.equal(woken.turn, 1, 'awake, it moves');
  const sterile = play(duel({ skill }, { trait: { pure: true } }), 'special');
  assert.ok(sterile.last.effects.includes('immune'));
});

test('heartburn hurts 1, 2, 3, 4, 4 after each own turn and leaves with the fighter', () => {
  let fight = duel({ skill: { name: 'Острый', cost: 1, toxic: true } }, { hp: 40 }, 0);
  fight = play(fight, 'special');
  const losses = [];
  for (let i = 0; i < 5; i++) {
    fight = play(fight, i % 2 ? 'hit' : 'guard');
    losses.push(fight.last.poisoned);
    fight = play(fight, 'hit');
  }
  assert.deepEqual(losses, [1, 2, 3, 4, 4]);
  const team = startBattle([[{ id: 'x', hp: 20, attack: 5, skill: { cost: 1, toxic: true } }], [{ id: 'y', hp: 20, attack: 5 }, { id: 'z', hp: 20, attack: 5 }]], 0, { tempo: false });
  const switched = play(team, 'special', 'switch:1');
  assert.equal(switched.teams[1][0].toxic, 0, 'switching out clears it');
  assert.equal(switched.last.poisoned, 0);
});

test('draining moves HP from the target to whoever faces it, and a sterile fighter is immune', () => {
  let fight = duel({ skill: { name: 'Соус', cost: 1, leech: 2 }, hp: 20 }, {});
  fight.teams[0][0].hp = 15;
  fight = play(fight, 'special', 'guard');
  assert.equal(fight.last.leeched, 2);
  assert.equal(fight.last.leechHeal, 2);
  assert.deepEqual([fighter(fight, 0).hp, fighter(fight, 1).hp], [17, 18]);
  const clean = play(duel({ skill: { cost: 1, leech: 2 } }, { trait: { pure: true } }), 'special');
  assert.equal(fighter(clean, 1).leech, 0);
  const wiped = play(duel({ skill: { cost: 1, leech: 2 } }, { skill: { cost: 1, cleanse: true } }), 'special', 'special');
  assert.equal(fighter(wiped, 1).leech, 0, 'cleanse removes it');
});

test('a flurry: guard softens only the first strike, armour every strike, and it breaks a last stand', () => {
  const flurry = { name: 'Шесть соусов', cost: 1, power: 3, hits: 4 }; // 8 split into 2+2+2+2
  let fight = duel({ skill: flurry }, {}, 1);
  fight = play(fight, 'guard', 'special');
  assert.equal(fight.last.hits, 4);
  assert.equal(fight.last.damage, 1 + 2 + 2 + 2);
  const armored = play(duel({ skill: flurry }, { trait: { armor: 1 } }), 'special');
  assert.equal(armored.last.damage, 4, 'armour trims each of the four strikes');
  const sturdy = duel({ skill: flurry }, { trait: { laststand: true } });
  sturdy.teams[1][0].hp = 5;
  const broken = play(sturdy, 'special');
  assert.equal(broken.last.saved, true, 'the last stand holds the first lethal strike…');
  assert.equal(broken.winner, 0, '…and the next strike finishes the fight');
  const spiky = play(duel({ skill: flurry }, { trait: { thorns: 1 } }), 'special');
  assert.equal(spiky.last.thorns, 4, 'thorns prick on every strike');
});

test('a wipe removes the target attack boost, shield and guard; charge adds energy', () => {
  let fight = duel({ skill: { name: 'Салфетка', cost: 1, power: 0, purge: true } }, { skill: { cost: 1, buff: 2, shield: 5 } }, 1);
  fight = play(fight, 'special');
  assert.deepEqual([fighter(fight, 1).attack, fighter(fight, 1).shield], [7, 5]);
  fight = play(fight, 'special');
  assert.ok(fight.last.effects.includes('purge'));
  assert.deepEqual([fighter(fight, 1).attack, fighter(fight, 1).shield], [5, 0]);
  const charged = play(duel({ skill: { cost: 1, charge: 2 } }, {}), 'special');
  assert.equal(fighter(charged, 0).energy, 2);
});

test('a grim look lowers the attack of the fighter it meets: at the start, on a switch and after a knockout', () => {
  const start = duel({ trait: { intimidate: 2 } }, {});
  assert.equal(fighter(start, 1).attack, 3);
  assert.equal(duel({ trait: { intimidate: 2 } }, { trait: { steady: true } }).teams[1][0].attack, 5, 'steady ignores it');
  const team = startBattle([[{ id: 'x', hp: 20, attack: 5 }, { id: 'boss', hp: 20, attack: 5, trait: { intimidate: 1 } }], [{ id: 'y', hp: 20, attack: 5 }]], 0, { tempo: false });
  const switched = play(team, 'switch:1');
  assert.equal(fighter(switched, 1).attack, 4);
  assert.deepEqual(switched.last.intimidated, ['boss']);
});

test('the new effects keep the engine deterministic and the bot uses them', () => {
  const cards = [
    { id: 'ice', hp: 22, attack: 5, speed: 6, skill: { cost: 2, power: 1, freeze: true } },
    { id: 'nap', hp: 24, attack: 4, speed: 4, skill: { cost: 1, sleep: 2 }, trait: { intimidate: 1 } },
  ];
  const foes = [
    { id: 'hot', hp: 22, attack: 5, speed: 5, skill: { cost: 2, power: 1, toxic: true, hits: 2 } },
    { id: 'wipe', hp: 20, attack: 5, speed: 7, skill: { cost: 1, purge: true, leech: 2 }, trait: { pure: true } },
  ];
  const run = seed => {
    let s = startBattle([cards, foes], 0);
    let n = seed;
    const random = () => ((n = (n * 16807) % 2147483647) / 2147483647);
    const moves = [];
    while (s.winner === null) { const m = botMove(s, random); moves.push(m); s = applyMove(s, s.turn, m); assert.ok(s, 'bot moves are legal'); }
    return { moves, s: JSON.stringify(s) };
  };
  assert.deepEqual(run(7), run(7));
  const freezeFirst = duel({ skill: { cost: 1, power: 0, freeze: true } }, {});
  assert.equal(botMove(freezeFirst, () => 0.99), 'special');
});

test('passives: fresh halves a blow at full health, opener strengthens the first blow after coming on', () => {
  let fight = play(duel({ trait: { opener: 3 } }, { trait: { fresh: true } }), 'hit');
  // 5 + 3 opener = 8, halved by fresh to 4.
  assert.deepEqual([fight.last.damage, fight.last.opener, fight.last.fresh], [4, true, true]);
  fight = play(fight, 'hit', 'hit');
  assert.equal(fight.last.damage, 5, 'the opener is spent and the target is no longer fresh');
});

test('passives: moxie after a knockout, parting gift on the one who did it, refresh when leaving', () => {
  const team = (id, extra = {}) => ({ id, hp: 20, attack: 5, ...extra });
  let fight = startBattle([[team('m', { attack: 6, trait: { moxie: 1 } }), team('r', { trait: { refresh: 4 } })],
    [team('p', { hp: 6, trait: { parting: 2 } }), team('q')]], 0, { tempo: false });
  fight = play(fight, 'hit');
  assert.deepEqual([fight.last.ko, fight.last.moxie, fight.last.parting], [['p'], true, 2]);
  assert.deepEqual([fight.teams[0][0].attack, fight.teams[0][0].hp], [7, 18]);
  // The refreshing fighter comes on, takes a blow, and leaves again.
  fight = play(fight, 'hit', 'switch:1', 'hit', 'switch:0');
  assert.equal(fight.last.refresh, 4, 'the hurt fighter catches its breath on the bench');
  assert.equal(fight.teams[0][1].hp, 19);
});

test('passives: snack once at half health, breaker hits through guard', () => {
  let fight = play(duel({ attack: 11 }, { trait: { snack: 5 } }), 'hit');
  assert.deepEqual([fighter(fight, 1).hp, fight.last.snack, fight.last.snackSides], [14, 5, [1]]);
  fight = play(fight, 'hit', 'hit');
  assert.equal(fighter(fight, 1).hp, 3, 'only once per battle');
  const breaking = play(duel({ trait: { breaker: true } }, {}, 1), 'guard', 'hit');
  assert.deepEqual([breaking.last.damage, breaking.last.blocked], [5, false]);
});

test('transformation: once per battle for energy, new stats and moves, and an effect at once', () => {
  const form = { name: 'Без мороженого', cost: 2, hp: 4, attack: 2, speed: 2, skill: { name: 'Шоколад', cost: 1, power: 3 },
    trait: { rage: 2 }, effect: { name: 'Бросок мороженого', power: 0, freeze: true } };
  let fight = duel({ transform: form, energy: 1 }, { hp: 30 });
  assert.ok(!legalMoves(fight).includes('transform'), 'needs 2 energy');
  fight = play(fight, 'hit', 'hit');
  assert.ok(legalMoves(fight).includes('transform'));
  const hpBefore = fighter(fight, 0).hp;
  fight = play(fight, 'transform');
  const me = fighter(fight, 0);
  assert.deepEqual([fight.last.transformed, me.transformed, me.attack, me.maxHp, me.hp, me.speed, me.skill.name, me.trait.rage],
    ['Без мороженого', true, 7, 24, hpBefore + 4, 7, 'Шоколад', 2]);
  assert.equal(me.energy, 0);
  assert.ok(fight.last.effects.includes('freeze') && fight.last.damage === 7, 'the thrown ice cream hits (with the new attack) and freezes');
  // The frozen opponent misses its turn; the form stays and cannot transform again.
  assert.equal(fight.turn, 0);
  fight = play(fight, 'hit', 'hit', 'hit');
  assert.ok(!legalMoves(fight).includes('transform'));
  // Both duel peers see the same form: battleStats carries it.
  assert.equal(battleStats({ id: 'x', hp: 10, attack: 3, transform: form }).transform.effect.cost, 0);
});

test('level equaliser: levels count only when both players switch it off, each at the level its owner has', () => {
  // Each player owns its own fighters at a level; the catalog card carries it.
  const levelCard = (card, level) => ({ ...card, level, maxHp: card.baseHp + 2 * (level - 1), attack: card.baseAttack + Math.floor((level - 1) / 2) });
  const leveledCatalog = mine => catalog.map(card => ({ ...card, level: mine.includes(card.id) ? 7 : 1 }));
  const build = (hostFair, guestFair) => {
    let time = 1_000;
    const queue = [];
    const make = (role, cards) => new DuelRoom({ role, cards, code: 'AAAAA2222A', now: () => time, makeId: () => 'match-12345', onChange() {}, levelCard,
      send: (to, packet) => queue.push({ to, packet: structuredClone(packet) }) });
    const host = make('host', leveledCatalog(['burger'])), guest = make('guest', leveledCatalog(['fries']));
    const deliver = () => { while (queue.length) { const { to, packet } = queue.shift(); (to === 'h' ? host : guest).receive(to === 'h' ? 'g' : 'h', packet); } };
    host.contact('g'); guest.contact('h'); deliver();
    host.setFair(hostFair); guest.setFair(guestFair); deliver();
    assert.equal(guest.peerFair, hostFair, 'each sees the other side\'s choice');
    host.ready(['burger']); guest.ready(['fries']); deliver();
    return { host, guest };
  };
  // Both off: the host's burger at level 7 (18 + 12 HP), the guest's fries at level 7 too.
  const both = build(false, false);
  assert.equal(both.host.leveled, true);
  assert.equal(both.guest.leveled, true, 'the guest agrees on the same leveled match');
  assert.deepEqual([both.host.state.teams[0][0].maxHp, both.host.state.teams[1][0].maxHp], [30, 30]);
  assert.equal(both.host.signature, both.guest.signature);
  // One of them keeps it on: base numbers for everyone, as before.
  for (const [h, g] of [[false, true], [true, false], [true, true]]) {
    const room = build(h, g);
    assert.equal(room.host.leveled, false);
    assert.deepEqual([room.host.state.teams[0][0].maxHp, room.host.state.teams[1][0].maxHp], [18, 18]);
    assert.equal(room.host.signature, room.guest.signature);
  }
  // After the team is confirmed the equaliser is fixed.
  assert.equal(both.host.setFair(true), false);
});

test('level equaliser: a host cannot force levels on a guest that kept it on, nor inflate the guest\'s levels', () => {
  const levelCard = (card, level) => ({ ...card, level, maxHp: card.baseHp + 2 * (level - 1), attack: card.baseAttack });
  const { guest } = pair();
  guest.levelCard = levelCard;
  guest.contact('h');
  guest.receive('h', { v: DUEL_PROTOCOL, side: 0, kind: 'hello', revision: 1, team: ['burger'], fair: false, levels: { burger: 9 } });
  guest.ready(['fries']);
  guest.receive('h', { v: DUEL_PROTOCOL, side: 0, kind: 'state', matchId: 'match-12345', teams: [['burger'], ['fries']], signature: 'x',
    leveled: true, levels: [{ burger: 9 }, { fries: 1 }], history: [] });
  assert.equal(guest.state, null);
  assert.equal(guest.reason, 'version', 'the guest refuses a leveled match it did not agree to');
});

test('a delayed lobby heartbeat cannot reverse an equaliser change or erase a confirmed team', () => {
  const { host, guest, bind, queue, deliver } = pair({
    guestCatalog: catalog.map(card => ({ ...card, level: 8 })),
    levelCard: (card, level) => ({ ...card, maxHp: card.baseHp + 2 * (level - 1) }),
  });
  bind();
  guest.tick();
  const early = queue.shift().packet;
  host.setFair(false); guest.setFair(false); deliver();
  host.receive('g', early);
  assert.equal(host.equalized, false);
  guest.tick();
  const beforeReady = queue.shift().packet;
  guest.ready(['fries']); deliver();
  host.receive('g', beforeReady);
  host.receive('g', early);
  host.ready(['burger']); deliver();
  assert.deepEqual([host.leveled, guest.leveled], [true, true]);
  assert.equal(host.state.teams[1][0].maxHp, 32);
  assert.deepEqual(host.state, guest.state);
});

test('the first host state can arrive before the final equaliser preference and still restore', () => {
  const network = pair({ levelCard: (card, level) => ({ ...card, level }) });
  network.bind();
  network.host.setFair(false); network.guest.setFair(false); network.deliver();
  network.host.setFair(true);
  network.host.ready(['burger']); network.guest.ready(['fries']);
  network.deliver(({ to, packet }) => !(to === 'g' && packet.kind === 'hello'));
  assert.equal(network.guest.leveled, false);
  assert.equal(network.guest.peerFair, true);
  const restored = network.reload('guest', network.guest.snapshot());
  assert.deepEqual(restored.state, network.host.state);
});

test('a legacy peer receives an update notice in the protocol it understands', () => {
  for (const version of [2, 3, 4]) {
    const { guest, queue } = pair();
    guest.contact('h'); queue.length = 0;
    guest.receive('h', { v: version, side: 0, kind: 'hello', team: null });
    assert.equal(guest.reason, 'version');
    assert.deepEqual(queue.map(({ packet }) => [packet.v, packet.kind]), [[version, 'hello'], [version, 'stop']]);
    assert.equal(queue[1].packet.reason, 'version');
    assert.equal(guest.matchId, null);
  }
});

test('two clients with different catalogs immediately report an unknown team to both players', () => {
  const { host, guest, bind, deliver } = pair({ hostCatalog: catalog.slice(0, 2) });
  bind(); host.ready(['burger']); guest.ready(['cola']); deliver();
  assert.deepEqual([host.reason, guest.reason], ['version', 'version']);
  assert.deepEqual([host.matchId, guest.matchId], [null, null]);
});
