// Cross-device progress merge. The merge must give the same result whatever the order of syncs,
// however often they repeat and whatever stale copy a relay still holds, and it must never count
// progress twice or drop it. The property tests below play the real game actions on several
// devices, sync them through lossy relays in random order and compare against a ground truth.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CARD_XP_CAP, claimVisit, freshProfile, grantStarter, normalizeProfile, recordBattle, resolveEncounter, setTeam,
  wildEncounter, WILD_COOLDOWN_MS, VISIT_COOLDOWN_MS,
} from '../public/js/game.js';
import { cleanDoc, docOf, mergeProfile, stableJson } from '../public/js/sync-merge.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
const venues = JSON.parse(readFileSync(new URL('../public/data/venues.json', import.meta.url))).slice(0, 40);
const START = Date.UTC(2026, 10, 19, 9);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

function counters(p) {
  const cards = Object.fromEntries(Object.entries(p.collection).map(([id, c]) => [id, c.copies]).sort());
  const cardXp = Object.fromEntries(Object.entries(p.collection).map(([id, c]) => [id, c.xp]).sort());
  const visits = Object.fromEntries(Object.entries(p.visits).map(([id, v]) => [id, v.count]).sort());
  return { xp: p.xp, wins: p.battles.wins, losses: p.battles.losses, draws: p.battles.draws, cards, cardXp, visits };
}

function addInto(total, delta) {
  for (const key of ['xp', 'wins', 'losses', 'draws']) total[key] += delta[key];
  for (const field of ['cards', 'cardXp', 'visits']) {
    for (const [id, n] of Object.entries(delta[field])) total[field][id] = (total[field][id] ?? 0) + n;
  }
}

function diff(after, before) {
  const out = { xp: after.xp - before.xp, wins: after.wins - before.wins, losses: after.losses - before.losses, draws: after.draws - before.draws, cards: {}, cardXp: {}, visits: {} };
  for (const field of ['cards', 'cardXp', 'visits']) {
    for (const [id, n] of Object.entries(after[field])) {
      const d = n - (before[field][id] ?? 0);
      if (d) out[field][id] = d;
    }
  }
  return out;
}

const empty = () => ({ xp: 0, wins: 0, losses: 0, draws: 0, cards: {}, cardXp: {}, visits: {} });

// A device plays real game actions and remembers what it earned itself (the ground truth).
class Device {
  constructor(name, seed, clock) {
    this.name = name;
    this.random = rng(seed);
    this.clock = clock;
    this.earned = empty();
    this.match = 0;
    const start = grantStarter(freshProfile(), menu, { rng: this.random });
    this.profile = start.profile;
    addInto(this.earned, counters(this.profile));
  }
  act(change) {
    const before = counters(this.profile);
    const result = change(this.profile);
    if (result.ok === false) return result;
    this.profile = normalizeProfile(result.profile);
    addInto(this.earned, diff(counters(this.profile), before));
    return result;
  }
  play() {
    const now = this.clock.tick(this.random);
    const r = this.random();
    if (r < 0.35) {
      const point = venues[Math.floor(this.random() * venues.length)];
      return this.act(p => claimVisit(p, point, { lat: point.lat, lon: point.lon, accuracy: 10, timestamp: now }, menu, { now, rng: this.random }));
    }
    if (r < 0.65) {
      const encounter = this.profile.encounter;
      if (!encounter) return this.act(p => wildEncounter(p, menu, { now, rng: this.random }));
      const won = this.random() < 0.6, draw = !won && this.random() < 0.1;
      return this.act(p => resolveEncounter(p, encounter.id, won, menu, { draw, now, teamIds: p.team }));
    }
    if (r < 0.85) {
      const won = this.random() < 0.5;
      return this.act(p => recordBattle(p, { xp: won ? 24 : 4, won, mode: 'online', matchId: `${this.name}-${++this.match}`, cardId: p.team[0] }));
    }
    const owned = Object.keys(this.profile.collection);
    const team = owned.filter(() => this.random() < 0.5).slice(0, 3);
    return this.act(p => setTeam(p, team.length ? team : owned.slice(0, 1)));
  }
}

// A public relay keeps only the newest document of the account (a replaceable event). Lossy
// relays sometimes miss a publish or a read.
class Relay {
  constructor(random, lossy) { this.random = random; this.lossy = lossy; this.event = null; }
  publish(event) {
    if (this.lossy && this.random() < 0.3) return false;
    if (!this.event || event.created_at > this.event.created_at ||
        (event.created_at === this.event.created_at && event.id < this.event.id)) this.event = event;
    return true;
  }
  read() { return this.lossy && this.random() < 0.3 ? null : this.event; }
}

let eventId = 0;
function sync(device, relays, now, seen = { at: 0 }) {
  const events = relays.map(relay => relay.read()).filter(Boolean);
  // Round-trip through JSON: what travels is text, not shared objects.
  const docs = events.map(event => JSON.parse(event.content));
  device.profile = mergeProfile(device.profile, docs, { now });
  const doc = docOf(device.profile);
  const latest = Math.max(seen.at, ...events.map(event => event.created_at));
  const event = { id: String(++eventId).padStart(8, '0'), created_at: Math.max(Math.floor(now / 1000), latest + 1), content: JSON.stringify(doc) };
  seen.at = event.created_at;
  for (const relay of relays) relay.publish(event);
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i < a.length || i < b.length ? `…${a.slice(Math.max(0, i - 120), i + 80)}\n  vs …${b.slice(Math.max(0, i - 120), i + 80)}` : '';
}

function comparable(p) {
  const saved = normalizeProfile(p);
  delete saved.battleIds;
  delete saved.recentWild;
  delete saved.sync.device;
  delete saved.sync.key;
  return stableJson(saved);
}

function clock(start = START) {
  let now = start;
  return { tick(random) { now += Math.floor((random?.() ?? 0.5) * 3 * VISIT_COOLDOWN_MS / 4) + WILD_COOLDOWN_MS; return now; }, get now() { return now; } };
}

test('two independent profiles merge into one with every fighter, visit and win of both', () => {
  const time = clock();
  const laptop = new Device('laptop', 11, time), phone = new Device('phone', 22, time);
  for (let i = 0; i < 25; i++) { laptop.play(); phone.play(); }
  const relay = [new Relay(rng(1), false)];
  sync(laptop, relay, time.now);
  sync(phone, relay, time.now);
  sync(laptop, relay, time.now);
  const total = empty();
  addInto(total, laptop.earned); addInto(total, phone.earned);
  for (const device of [laptop, phone]) {
    const c = counters(device.profile);
    assert.equal(c.xp, total.xp, device.name + ' player XP is the sum');
    assert.deepEqual([c.wins, c.losses, c.draws], [total.wins, total.losses, total.draws]);
    assert.deepEqual(c.cards, Object.fromEntries(Object.entries(total.cards).sort()));
    assert.deepEqual(c.visits, Object.fromEntries(Object.entries(total.visits).sort()));
    for (const [id, xp] of Object.entries(c.cardXp)) assert.equal(xp, Math.min(CARD_XP_CAP, total.cardXp[id] ?? 0), id);
  }
  assert.equal(comparable(laptop.profile), comparable(phone.profile));
});

test('syncing again and again changes nothing and never counts twice', () => {
  const time = clock();
  const a = new Device('a', 5, time), b = new Device('b', 6, time);
  for (let i = 0; i < 15; i++) { a.play(); b.play(); }
  const relays = [new Relay(rng(2), false), new Relay(rng(3), false)];
  for (let round = 0; round < 3; round++) { sync(a, relays, time.now); sync(b, relays, time.now); }
  const settled = comparable(a.profile);
  for (let round = 0; round < 10; round++) { sync(b, relays, time.now); sync(a, relays, time.now); sync(a, relays, time.now); }
  assert.equal(comparable(a.profile), settled);
  assert.equal(comparable(b.profile), settled);
  // Merging the same document several times in a row is a no-op.
  const doc = docOf(b.profile);
  const once = mergeProfile(a.profile, [doc], { now: time.now });
  const thrice = mergeProfile(mergeProfile(once, [doc, doc], { now: time.now }), [doc], { now: time.now });
  assert.equal(comparable(thrice), comparable(once));
});

test('the order of merges does not matter', () => {
  const time = clock();
  const devices = [new Device('x', 31, time), new Device('y', 32, time), new Device('z', 33, time)];
  for (let i = 0; i < 20; i++) for (const d of devices) d.play();
  for (const d of devices) d.profile = mergeProfile(d.profile, [], { now: time.now });
  const docs = devices.map(d => docOf(d.profile));
  const orders = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0]];
  const results = orders.map(order => {
    let p = devices[0].profile;
    for (const i of order) p = mergeProfile(p, [docs[i]], { now: time.now });
    return stableJson(counters(p));
  });
  assert.equal(new Set(results).size, 1);
  // Merging everything at once equals merging one by one.
  assert.equal(stableJson(counters(mergeProfile(devices[0].profile, docs, { now: time.now }))), results[0]);
});

for (let seed = 1; seed <= 30; seed++) {
  const skewed = seed % 2 === 0;
  test(`random play on three devices with lossy relays converges to the exact total (seed ${seed}${skewed ? ', clocks off by up to 2 h' : ''})`, () => {
    const random = rng(seed * 977);
    const time = clock();
    const devices = ['laptop', 'phone', 'tablet'].map((name, i) => new Device(name, seed * 100 + i, time));
    const relays = [new Relay(rng(seed + 1), true), new Relay(rng(seed + 2), true), new Relay(rng(seed + 3), false)];
    const seen = devices.map(() => ({ at: 0 }));
    // Device clocks may disagree; a fast clock must not lock the others out of the relays.
    const skew = devices.map(() => (skewed ? Math.round((random() * 2 - 1) * 2 * 3600_000) : 0));
    // Two devices link first, the third joins halfway with its own progress.
    let linked = 2;
    for (let step = 0; step < 240; step++) {
      if (step === 120) linked = 3;
      const i = Math.floor(random() * 3);
      devices[i].play();
      if (i < linked && random() < 0.4) sync(devices[i], relays.filter(() => random() < 0.8), time.now + skew[i], seen[i]);
    }
    // Back online: everyone syncs over reliable relays until nothing changes.
    for (const relay of relays) relay.lossy = false;
    for (let round = 0; round < 3; round++) devices.forEach((d, i) => sync(d, relays, time.now + skew[i], seen[i]));
    const total = empty();
    for (const d of devices) addInto(total, d.earned);
    const reference = comparable(devices[0].profile);
    for (const d of devices) {
      assert.equal(comparable(d.profile), reference, d.name + ' sees the same profile: ' + firstDifference(comparable(d.profile), reference));
      const c = counters(d.profile);
      assert.equal(c.xp, total.xp, 'player XP');
      assert.deepEqual([c.wins, c.losses, c.draws], [total.wins, total.losses, total.draws], 'battles');
      assert.deepEqual(c.cards, Object.fromEntries(Object.entries(total.cards).sort()), 'copies');
      assert.deepEqual(c.visits, Object.fromEntries(Object.entries(total.visits).sort()), 'visits');
      for (const [id, xp] of Object.entries(c.cardXp)) {
        assert.ok(xp <= CARD_XP_CAP && xp >= Math.min(CARD_XP_CAP, total.cardXp[id] ?? 0), `${id} XP ${xp}`);
      }
      // The game keeps working on the merged profile.
      assert.ok(d.profile.team.length >= 1 && d.profile.team.every(id => d.profile.collection[id]));
      if (d.profile.encounter) assert.ok(!d.profile.retired[d.profile.encounter.id]);
    }
  });
}

test('a wild fighter fought on one device disappears on the other; a newer one stays', () => {
  const time = clock();
  const a = new Device('a', 41, time);
  a.act(p => wildEncounter(p, menu, { now: time.now, rng: a.random }));
  const relay = [new Relay(rng(4), false)];
  sync(a, relay, time.now);
  const b = new Device('b', 42, time);
  sync(b, relay, time.now);
  const shared = a.profile.encounter;
  assert.equal(b.profile.encounter.id, shared.id, 'the waiting fighter is shared');
  // a fights it, b goes offline still showing it.
  a.act(p => resolveEncounter(p, shared.id, true, menu, { now: time.tick(), teamIds: p.team }));
  sync(a, relay, time.now);
  sync(b, relay, time.now);
  assert.equal(b.profile.encounter, null, 'b no longer offers the fighter a already beat');
  assert.ok(b.profile.retired[shared.id]);
  // After the pause b finds a new one; a keeps it after syncing.
  const later = time.tick();
  b.act(p => wildEncounter(p, menu, { now: later + WILD_COOLDOWN_MS, rng: b.random }));
  sync(b, relay, later + WILD_COOLDOWN_MS);
  sync(a, relay, later + WILD_COOLDOWN_MS);
  assert.equal(a.profile.encounter.id, b.profile.encounter.id);
  assert.notEqual(a.profile.encounter.id, shared.id);
});

test('the most recent team change wins on every device', () => {
  const time = clock();
  const a = new Device('a', 51, time), b = new Device('b', 52, time);
  const relay = [new Relay(rng(5), false)];
  sync(a, relay, START); sync(b, relay, START + 1000); sync(a, relay, START + 2000);
  const owned = Object.keys(a.profile.collection);
  assert.ok(owned.length >= 2);
  a.act(p => setTeam(p, [owned[0]]));
  sync(a, relay, START + 10_000);
  b.act(p => setTeam(p, [owned[1], owned[0]]));
  sync(b, relay, START + 20_000);
  sync(a, relay, START + 30_000);
  assert.deepEqual(a.profile.team, [owned[1], owned[0]]);
  assert.deepEqual(b.profile.team, [owned[1], owned[0]]);
});

test('a device that unlinks and links again does not add its progress a second time', () => {
  const time = clock();
  const a = new Device('a', 61, time), b = new Device('b', 62, time);
  for (let i = 0; i < 10; i++) { a.play(); b.play(); }
  const relay = [new Relay(rng(6), false)];
  sync(a, relay, time.now); sync(b, relay, time.now); sync(a, relay, time.now);
  const before = stableJson(counters(a.profile));
  // Unlinking only forgets the key; the ledger stays, so a later link is not a fresh merge.
  a.profile = normalizeProfile({ ...a.profile, sync: { ...a.profile.sync, key: null } });
  sync(a, relay, time.now); sync(b, relay, time.now);
  assert.equal(stableJson(counters(a.profile)), before);
  assert.equal(stableJson(counters(b.profile)), before);
});

test('a device that lost its local progress gets it back from the shared document', () => {
  const time = clock();
  const a = new Device('a', 71, time);
  for (let i = 0; i < 12; i++) a.play();
  const relay = [new Relay(rng(7), false)];
  sync(a, relay, time.now);
  const full = stableJson(counters(a.profile));
  // A failed write rolls the profile back but keeps the device ledger.
  const rolledBack = normalizeProfile({ ...freshProfile(), sync: a.profile.sync });
  a.profile = rolledBack;
  sync(a, relay, time.now);
  assert.equal(stableJson(counters(a.profile)), full);
});

test('fighter XP stays capped and keeps growing on each device until the cap', () => {
  const id = 'bk-whopper';
  const make = (xp, device) => normalizeProfile({ ...freshProfile(), collection: { [id]: { copies: 1, xp } }, team: [id], sync: { device, devices: {} } });
  const a = mergeProfile(make(200, 'devicea1'), [], { now: START });
  const b = mergeProfile(make(150, 'deviceb1'), [docOf(a)], { now: START });
  assert.equal(b.collection[id].xp, CARD_XP_CAP);
  assert.equal(b.collection[id].copies, 2);
  const back = mergeProfile(a, [docOf(b)], { now: START });
  assert.equal(back.collection[id].xp, CARD_XP_CAP);
  assert.equal(back.sync.devices.devicea1.cards[id][1], 200, 'own share is not reduced by the cap');
});

test('renamed dishes in an old document land on their new fighter', () => {
  const a = mergeProfile(normalizeProfile({ ...freshProfile(), collection: { 'bk-whopper': { copies: 1, xp: 0 } }, sync: { device: 'devicea1', devices: {} } }), [], { now: START });
  const old = docOf(a);
  old.devices.olddevice1 = { xp: 5, wins: 0, losses: 0, draws: 0, cards: { 'bk-cheeseburger': [2, 10] }, visits: {} };
  const merged = mergeProfile(a, [old], { now: START });
  assert.equal(merged.collection['bk-chicken-parmesan'].copies, 2);
  assert.equal(merged.collection['bk-cheeseburger'], undefined);
});

test('broken or hostile documents never throw and never change the local counters', () => {
  const time = clock();
  const a = new Device('a', 81, time);
  for (let i = 0; i < 10; i++) a.play();
  a.profile = mergeProfile(a.profile, [], { now: time.now });
  const before = stableJson(counters(a.profile));
  const junk = [
    null, 7, 'text', [], {}, { v: 0 }, { v: 'one' }, { v: 1 }, { v: 1, devices: null },
    { v: 1, devices: { '__proto__': { xp: 1e9 } } },
    { v: 1, devices: { 'BAD ID': { xp: 1e9 }, constructor: { xp: 5 } } },
    { v: 1, devices: { goodid12: { xp: -50, wins: 'x', cards: { 'bk-whopper': ['a', -3], prototype: [1, 1] }, visits: { '__proto__': 3 } } } },
    { v: 1, team: ['bk-angus-parmigiano'], teamAt: 8.64e15 + 1, encounter: { id: '__proto__', enemyId: 'x', kind: 'recruit', startedAt: -1 } },
    { v: 1, retired: 'all', visitsAt: { 'bk-1': 'yesterday' }, daily: { day: 'never', pointIds: 5 } },
    { v: 1, devices: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => ['flood' + String(i).padStart(4, '0'), {}])) },
  ];
  let p = a.profile;
  for (const doc of junk) {
    assert.doesNotThrow(() => { p = mergeProfile(p, [doc], { now: time.now }); }, JSON.stringify(doc)?.slice(0, 80));
  }
  assert.equal(stableJson(counters(p)), before.replace(/x/g, 'x'));
  assert.ok(Object.keys(p.sync.devices).length <= 256);
  assert.equal(Object.getPrototypeOf(p.collection), Object.prototype);
  assert.equal(({}).xp, undefined, 'no prototype pollution');
  // A document from a newer version is still read for what this version knows.
  const newer = { ...docOf(a.profile), v: 2, futureField: { anything: true } };
  assert.ok(cleanDoc(newer));
});

test('a brand-new device with only its starter joins without losing the account progress', () => {
  const time = clock();
  const a = new Device('a', 91, time);
  for (let i = 0; i < 30; i++) a.play();
  const relay = [new Relay(rng(9), false)];
  sync(a, relay, time.now);
  const fresh = new Device('fresh', 92, time);
  sync(fresh, relay, time.now);
  sync(a, relay, time.now);
  const total = empty();
  addInto(total, a.earned); addInto(total, fresh.earned);
  assert.equal(counters(fresh.profile).xp, total.xp);
  assert.deepEqual(counters(fresh.profile).cards, Object.fromEntries(Object.entries(total.cards).sort()));
  assert.equal(comparable(fresh.profile), comparable(a.profile), firstDifference(comparable(fresh.profile), comparable(a.profile)));
});

test('the shared document survives a text round trip unchanged', () => {
  const time = clock();
  const a = new Device('a', 101, time);
  for (let i = 0; i < 20; i++) a.play();
  a.profile = mergeProfile(a.profile, [], { now: time.now });
  const doc = docOf(a.profile);
  assert.equal(stableJson(cleanDoc(JSON.parse(JSON.stringify(doc)))), stableJson(cleanDoc(doc)));
  assert.ok(JSON.stringify(doc).length < 40_000);
});

test('many devices: a hundred linked browsers sum up exactly, and the ledger keeps its own entry past the limit', () => {
  const id = 'bk-whopper';
  let shared = [];
  // A hundred devices, e.g. years of cleared browsers, each adds one copy and 3 XP.
  for (let i = 0; i < 100; i++) {
    const device = 'dev' + String(i).padStart(5, '0');
    const own = normalizeProfile({ ...freshProfile(), xp: 3, collection: { [id]: { copies: 1, xp: 0 } }, team: [id], sync: { device, devices: {} } });
    const merged = mergeProfile(own, shared, { now: START + i });
    shared = [docOf(merged)];
  }
  const last = mergeProfile(normalizeProfile({ ...freshProfile(), sync: { device: 'reader0001', devices: {} } }), shared, { now: START + 200 });
  assert.equal(last.xp, 300);
  assert.equal(last.collection[id].copies, 100);
  assert.equal(Object.keys(last.sync.devices).length, 101, 'a hundred devices plus the one reading');
  // Past the limit every device keeps the same sorted entries, and always its own one.
  const crowd = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['crowd' + String(i).padStart(5, '0'), { xp: 1, wins: 0, losses: 0, draws: 0, cards: {}, visits: {} }]));
  const late = normalizeProfile({ ...freshProfile(), xp: 7, sync: { device: 'zzzzzzzzlast', devices: crowd } });
  assert.equal(Object.keys(late.sync.devices).length, 256);
  const merged = mergeProfile(late, [], { now: START });
  assert.ok(merged.sync.devices.zzzzzzzzlast, 'own entry survives');
  assert.ok(Object.keys(merged.sync.devices).length <= 257);
});
