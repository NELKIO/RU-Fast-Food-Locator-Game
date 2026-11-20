// Hard sync scenarios: devices that diverged offline, crashes between writing and publishing,
// restores from old backups, clocks that are wrong by a year, partitions, relays that serve old
// versions, account switches. Every scenario checks the exact numbers, not just "looks merged".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CARD_XP_CAP, claimVisit, freshProfile, grantStarter, normalizeProfile, recordBattle, resolveEncounter, setTeam,
  visitStatus, wildEncounter, VISIT_COOLDOWN_MS, WILD_COOLDOWN_MS,
} from '../public/js/game.js';
import { docOf, mergeProfile, stableJson } from '../public/js/sync-merge.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
const venues = JSON.parse(readFileSync(new URL('../public/data/venues.json', import.meta.url))).slice(0, 60);
const T0 = Date.UTC(2026, 10, 20, 8);
const HOUR = 3600_000;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

const fixAt = (point, now) => ({ lat: point.lat, lon: point.lon, accuracy: 10, timestamp: now });

function counters(p) {
  const sorted = o => Object.fromEntries(Object.entries(o).sort());
  return {
    xp: p.xp, wins: p.battles.wins, losses: p.battles.losses, draws: p.battles.draws,
    cards: sorted(Object.fromEntries(Object.entries(p.collection).map(([id, c]) => [id, c.copies]))),
    cardXp: sorted(Object.fromEntries(Object.entries(p.collection).map(([id, c]) => [id, c.xp]))),
    visits: sorted(Object.fromEntries(Object.entries(p.visits).map(([id, v]) => [id, v.count]))),
  };
}
const zero = () => ({ xp: 0, wins: 0, losses: 0, draws: 0, cards: {}, cardXp: {}, visits: {} });
function add(total, delta, sign = 1) {
  for (const key of ['xp', 'wins', 'losses', 'draws']) total[key] += sign * delta[key];
  for (const field of ['cards', 'cardXp', 'visits']) {
    for (const [id, n] of Object.entries(delta[field])) total[field][id] = (total[field][id] ?? 0) + sign * n;
  }
  return total;
}
const diff = (after, before) => add(add(zero(), after), before, -1);

// A device: a profile plus what it earned with its own hands (ground truth for the totals).
class Device {
  constructor(name, seed, start = freshProfile()) {
    this.name = name;
    this.random = rng(seed);
    this.earned = zero();
    this.match = 0;
    this.profile = normalizeProfile(start);
    if (!Object.keys(this.profile.collection).length) this.act(p => grantStarter(p, menu, { rng: this.random }));
  }
  act(change) {
    const before = counters(this.profile);
    const result = change(this.profile);
    if (result.ok === false) return result;
    this.profile = normalizeProfile(result.profile);
    add(this.earned, diff(counters(this.profile), before));
    return result;
  }
  visit(point, now) { return this.act(p => claimVisit(p, point, fixAt(point, now), menu, { now, rng: this.random })); }
  duel(won = true, cardId) {
    return this.act(p => recordBattle(p, { xp: won ? 24 : 4, won, mode: 'online', matchId: `${this.name}-${++this.match}-${this.random()}`, cardId: cardId ?? p.team[0] }));
  }
  play(now) {
    const r = this.random();
    if (r < 0.35) return this.visit(venues[Math.floor(this.random() * venues.length)], now);
    if (r < 0.6) {
      const e = this.profile.encounter;
      if (!e) return this.act(p => wildEncounter(p, menu, { now, rng: this.random }));
      const won = this.random() < 0.6;
      return this.act(p => resolveEncounter(p, e.id, won, menu, { draw: !won && this.random() < 0.15, now, teamIds: p.team }));
    }
    if (r < 0.85) return this.duel(this.random() < 0.5);
    const owned = Object.keys(this.profile.collection);
    const team = owned.filter(() => this.random() < 0.5).slice(0, 3);
    return this.act(p => setTeam(p, team.length ? team : owned.slice(0, 1)));
  }
}

// Relays. `history` relays may answer with any version they ever stored (a buggy or lagging relay).
class Relay {
  constructor(random, { lossy = false, history = false } = {}) { Object.assign(this, { random, lossy, history, event: null, all: [] }); }
  publish(event) {
    if (this.lossy && this.random() < 0.35) return false;
    this.all.push(event);
    if (!this.event || event.created_at > this.event.created_at || (event.created_at === this.event.created_at && event.id < this.event.id)) this.event = event;
    return true;
  }
  read() {
    if (this.lossy && this.random() < 0.35) return null;
    if (this.history && this.all.length && this.random() < 0.5) return this.all[Math.floor(this.random() * this.all.length)];
    return this.event;
  }
}

let ids = 0;
// Pull from the relays, merge, publish. `publish: false` stops after the local write (a crash).
function sync(device, relays, now, { publish = true } = {}) {
  const events = relays.map(relay => relay.read()).filter(Boolean);
  device.profile = mergeProfile(device.profile, events.map(event => JSON.parse(event.content)), { now });
  if (!publish) return;
  const latest = Math.max(device.seen ?? 0, ...events.map(e => e.created_at));
  const event = { id: String(++ids).padStart(9, '0'), created_at: Math.max(Math.floor(now / 1000), latest + 1), content: JSON.stringify(docOf(device.profile)) };
  device.seen = event.created_at;
  for (const relay of relays) relay.publish(event);
}

function settleAll(devices, relays, now, rounds = 3) {
  for (let i = 0; i < rounds; i++) for (const d of devices) sync(d, relays, now + i);
}

const view = p => { const s = normalizeProfile(p); delete s.battleIds; delete s.recentWild; delete s.sync.device; delete s.sync.key; return stableJson(s); };

function assertExact(devices, label = '') {
  const total = devices.reduce((sum, d) => add(sum, d.earned), zero());
  const reference = view(devices[0].profile);
  for (const d of devices) {
    assert.equal(view(d.profile), reference, `${label}${d.name} sees the same profile`);
    const c = counters(d.profile);
    assert.equal(c.xp, total.xp, label + 'player XP');
    assert.deepEqual([c.wins, c.losses, c.draws], [total.wins, total.losses, total.draws], label + 'battles');
    assert.deepEqual(c.cards, Object.fromEntries(Object.entries(total.cards).filter(([, n]) => n).sort()), label + 'copies');
    assert.deepEqual(c.visits, Object.fromEntries(Object.entries(total.visits).filter(([, n]) => n).sort()), label + 'visits');
    for (const [id, xp] of Object.entries(c.cardXp)) assert.ok(xp <= CARD_XP_CAP && xp >= Math.min(CARD_XP_CAP, total.cardXp[id] ?? 0), `${label}${id} XP`);
    assert.ok(d.profile.team.length >= 1 && d.profile.team.every(id => d.profile.collection[id]), label + 'team is owned');
    if (d.profile.encounter) assert.ok(!d.profile.retired[d.profile.encounter.id], label + 'no retired wild fighter');
  }
}

function linked(n, seed = 1) {
  const relays = [new Relay(rng(seed)), new Relay(rng(seed + 1)), new Relay(rng(seed + 2))];
  const devices = Array.from({ length: n }, (_, i) => new Device('d' + i, seed * 10 + i));
  settleAll(devices, relays, T0);
  return { devices, relays };
}

test('offline: both devices fight the same shared wild fighter', () => {
  const { devices: [a, b], relays } = linked(2, 1);
  a.act(p => wildEncounter(p, menu, { now: T0 + HOUR, rng: a.random }));
  settleAll([a, b], relays, T0 + HOUR);
  const shared = b.profile.encounter;
  assert.ok(shared && shared.id === a.profile.encounter.id, 'the wild fighter is shared');
  // Offline: the laptop wins, the phone loses, against the same fighter.
  a.act(p => resolveEncounter(p, shared.id, true, menu, { now: T0 + 2 * HOUR, teamIds: p.team }));
  b.act(p => resolveEncounter(p, shared.id, false, menu, { now: T0 + 3 * HOUR, teamIds: p.team }));
  settleAll([a, b], relays, T0 + 4 * HOUR);
  assertExact([a, b]);
  for (const d of [a, b]) {
    assert.equal(d.profile.encounter, null, 'the fought fighter is gone everywhere');
    assert.ok(d.profile.retired[shared.id]);
    assert.equal(d.profile.lastScoutAt, T0 + 3 * HOUR, 'the pause starts at the later fight');
    assert.ok(d.profile.collection[shared.enemyId], 'the win on the laptop kept the card');
  }
});

test('offline: both devices visit the same restaurant; counts add up and the cooldown holds everywhere', () => {
  const { devices: [a, b], relays } = linked(2, 2);
  const point = venues[3];
  a.visit(point, T0 + HOUR);
  b.visit(point, T0 + 2 * HOUR);
  settleAll([a, b], relays, T0 + 3 * HOUR);
  assertExact([a, b]);
  for (const d of [a, b]) {
    assert.equal(d.profile.visits[point.id].count, 2);
    assert.equal(d.profile.visits[point.id].lastAt, T0 + 2 * HOUR);
    assert.equal(visitStatus(d.profile, point, fixAt(point, T0 + 4 * HOUR), T0 + 4 * HOUR).reason, 'cooldown');
    assert.equal(visitStatus(d.profile, point, fixAt(point, T0 + 2 * HOUR + VISIT_COOLDOWN_MS), T0 + 2 * HOUR + VISIT_COOLDOWN_MS).reason, 'ready');
  }
});

test('offline: the same fighter levelled past the cap on both devices stays capped, copies add up', () => {
  const { devices: [a, b], relays } = linked(2, 3);
  const id = a.profile.team[0];
  b.profile = normalizeProfile({ ...b.profile, collection: { ...b.profile.collection, [id]: b.profile.collection[id] ?? { copies: 0, xp: 0 } } });
  for (let i = 0; i < 15; i++) { a.duel(true, id); b.duel(true, id); }
  settleAll([a, b], relays, T0 + HOUR);
  assert.equal(a.profile.collection[id].xp, CARD_XP_CAP);
  assert.equal(view(a.profile), view(b.profile));
});

test('offline: both change the team; the later change wins, even with a fighter only one device had', () => {
  for (const laptopLater of [false, true]) {
    const { devices: [a, b], relays } = linked(2, 4 + Number(laptopLater));
    // The laptop wins a new fighter offline and builds its team around it.
    let card = null;
    for (let i = 0; i < 10 && !card; i++) {
      const r = a.visit(venues[10 + i], T0 + (i + 1) * VISIT_COOLDOWN_MS);
      if (r.isNew) card = r.card.id;
    }
    assert.ok(card, 'a new fighter was found');
    assert.equal(b.profile.collection[card], undefined);
    a.act(p => setTeam(p, [card]));
    // A real change on the phone: a team different from the one it has.
    b.act(p => setTeam(p, Object.keys(p.collection).filter(id => id !== p.team[0]).slice(0, 1)));
    const phoneTeam = b.profile.team;
    assert.notDeepEqual(phoneTeam, a.profile.team);
    const [first, second] = laptopLater ? [b, a] : [a, b];
    sync(first, relays, T0 + 20 * HOUR);
    sync(second, relays, T0 + 21 * HOUR);
    settleAll([a, b], relays, T0 + 22 * HOUR);
    assertExact([a, b], laptopLater ? 'laptop later: ' : 'phone later: ');
    assert.deepEqual(a.profile.team, laptopLater ? [card] : phoneTeam);
    if (laptopLater) assert.ok(b.profile.collection[card], 'the phone owns the new fighter of its new team');
  }
});

test('a device whose clock is a year ahead cannot freeze the team: a later change elsewhere still wins', () => {
  const { devices: [a, b], relays } = linked(2, 6);
  const YEAR = 365 * 24 * HOUR;
  const owned = Object.keys(a.profile.collection);
  a.act(p => setTeam(p, [owned[0]]));
  sync(a, relays, T0 + YEAR); // its clock is a year ahead
  sync(b, relays, T0 + HOUR);
  assert.deepEqual(b.profile.team, [owned[0]]);
  b.act(p => setTeam(p, [owned[1] ?? owned[0], owned[0]].filter((id, i, all) => all.indexOf(id) === i)));
  const chosen = b.profile.team;
  sync(b, relays, T0 + 2 * HOUR);
  sync(a, relays, T0 + YEAR + HOUR);
  assert.deepEqual(a.profile.team, chosen, 'the phone change is not reverted by the fast laptop clock');
  settleAll([a, b], relays, T0 + 3 * HOUR);
  assertExact([a, b]);
});

test('daily route: different days keep the later one, the same day unites the points', () => {
  const { devices: [a, b], relays } = linked(2, 7);
  const day1 = Date.UTC(2026, 10, 21, 9), day2 = Date.UTC(2026, 10, 22, 9);
  a.visit(venues[20], day1); a.visit(venues[21], day1 + HOUR);
  b.visit(venues[22], day2);
  settleAll([a, b], relays, day2 + HOUR);
  assertExact([a, b]);
  assert.deepEqual(a.profile.daily, b.profile.daily);
  assert.equal(a.profile.daily.pointIds.length, 1, 'only the later day survives');
  const c = linked(2, 8);
  const [x, y] = c.devices;
  x.visit(venues[30], day1); y.visit(venues[31], day1 + HOUR);
  settleAll([x, y], c.relays, day1 + 2 * HOUR);
  assert.deepEqual([...x.profile.daily.pointIds].sort(), [venues[30].id, venues[31].id].sort());
  assertExact([x, y]);
});

test('a week offline on three devices with hundreds of actions each adds up exactly', () => {
  const { devices, relays } = linked(3, 9);
  let now = T0;
  for (let i = 0; i < 300; i++) for (const d of devices) d.play((now += 23 * 60_000));
  settleAll(devices, relays, now + HOUR);
  assertExact(devices);
});

test('a crash after the local merge but before publishing loses nothing', () => {
  const { devices: [a, b], relays } = linked(2, 10);
  let now = T0;
  for (let i = 0; i < 20; i++) { a.play(now += HOUR); b.play(now += HOUR); }
  sync(a, relays, now, { publish: false }); // wrote the merge, crashed before publishing
  for (let i = 0; i < 10; i++) a.play(now += HOUR);
  sync(b, relays, now, { publish: false });
  settleAll([a, b], relays, now + HOUR);
  assertExact([a, b]);
});

test('a device restored from an old backup keeps what it published before and what it plays after', () => {
  const { devices: [a, b], relays } = linked(2, 11);
  let now = T0;
  for (let i = 0; i < 10; i++) a.play(now += HOUR);
  sync(a, relays, now);
  const backup = { profile: structuredClone(a.profile), earned: structuredClone(a.earned) };
  for (let i = 0; i < 15; i++) a.play(now += HOUR); // played and published after the backup
  sync(a, relays, now);
  const lostLocally = diff(a.earned, backup.earned);
  // The phone is restored from the backup: local progress since then is gone from the device…
  a.profile = structuredClone(backup.profile);
  a.earned = add(structuredClone(backup.earned), lostLocally); // …but it was published, so it counts
  for (let i = 0; i < 8; i++) a.play(now += HOUR); // and the player goes on
  for (let i = 0; i < 5; i++) b.play(now += HOUR);
  settleAll([a, b], relays, now + HOUR);
  assertExact([a, b]);
  assert.equal(Object.keys(a.profile.sync.devices).length, 3, 'the restored device continues under a new id');
});

test('a profile write that silently failed (the device reloads an older save) is repaired the same way', () => {
  const { devices: [a, b], relays } = linked(2, 12);
  let now = T0;
  for (let i = 0; i < 6; i++) a.play(now += HOUR);
  sync(a, relays, now);
  const saved = structuredClone(a.profile), savedEarned = structuredClone(a.earned);
  for (let i = 0; i < 6; i++) a.play(now += HOUR);
  sync(a, relays, now); // published, but the write to storage failed
  const unsaved = diff(a.earned, savedEarned);
  a.profile = saved; // the reload brings back the older save
  a.earned = add(structuredClone(savedEarned), unsaved);
  settleAll([a, b], relays, now + HOUR);
  assertExact([a, b]);
});

test('moving a device to another account and back never counts its progress twice', () => {
  const relays1 = [new Relay(rng(1))], relays2 = [new Relay(rng(2))];
  const a = new Device('a', 131), b = new Device('b', 132), c = new Device('c', 133);
  let now = T0;
  for (let i = 0; i < 10; i++) { a.play(now += HOUR); b.play(now += HOUR); c.play(now += HOUR); }
  settleAll([a, b], relays1, now);
  settleAll([c], relays2, now);
  // b leaves account 1 for account 2, then a follows; nothing may be counted twice.
  settleAll([b, c], relays2, now + HOUR);
  for (let i = 0; i < 5; i++) { a.play(now += HOUR); b.play(now += HOUR); }
  settleAll([a], relays1, now + HOUR);
  settleAll([a, b, c], relays2, now + 2 * HOUR);
  assertExact([a, b, c]);
  // b goes back to account 1, where only the old copy of a is.
  settleAll([b], relays1, now + 3 * HOUR);
  settleAll([a, b, c], relays2, now + 4 * HOUR);
  settleAll([a, b], relays1, now + 4 * HOUR);
  assertExact([a, b, c]);
});

test('a network split: two groups sync on different relays for days, then the network heals', () => {
  const left = new Relay(rng(1)), right = new Relay(rng(2));
  const devices = [new Device('l1', 141), new Device('l2', 142), new Device('r1', 143)];
  settleAll(devices, [left, right], T0);
  let now = T0;
  for (let i = 0; i < 80; i++) {
    for (const d of devices) d.play((now += 40 * 60_000));
    sync(devices[0], [left], now); sync(devices[1], [left], now); sync(devices[2], [right], now);
  }
  settleAll(devices, [left, right], now + HOUR);
  assertExact(devices);
});

// Chaos 1: relays at their worst (they lose publishes and reads, and serve any old version they
// ever stored), crashes before publishing, clocks off by up to 36 hours, devices joining late.
for (let seed = 1; seed <= 15; seed++) {
  test(`chaos with unreliable relays (seed ${seed}): stale versions, losses, crashes, clocks off, late joins`, () => {
    const random = rng(seed * 7919);
    const relays = [
      new Relay(rng(seed + 1), { lossy: true, history: true }),
      new Relay(rng(seed + 2), { lossy: true }),
      new Relay(rng(seed + 3), { history: true }),
    ];
    const devices = Array.from({ length: 4 }, (_, i) => new Device('c' + i, seed * 100 + i));
    const skew = devices.map(() => Math.round((random() * 2 - 1) * 36 * HOUR));
    const active = new Set([0, 1]);
    let now = T0;
    for (let step = 0; step < 400; step++) {
      now += Math.floor(random() * 50 * 60_000);
      if (step === 120) active.add(2);
      if (step === 260) active.add(3);
      const i = Math.floor(random() * devices.length);
      if (random() < 0.62) devices[i].play(now);
      else if (active.has(i)) sync(devices[i], relays.filter(() => random() < 0.75), now + skew[i], { publish: random() < 0.85 });
    }
    for (const relay of relays) { relay.lossy = false; relay.history = false; }
    for (let round = 0; round < 4; round++) devices.forEach((d, i) => sync(d, relays, now + skew[i] + round));
    assertExact(devices);
  });
}

// Chaos 2: devices restored from backups. Relays behave like real ones (each keeps its newest event)
// but go up and down; a sync reads and publishes on the relays that are up at that moment.
for (let seed = 1; seed <= 15; seed++) {
  test(`chaos with backup restores (seed ${seed}): restores, relays up and down, crashes, clocks off`, () => {
    const random = rng(seed * 104_729);
    const relays = [new Relay(rng(seed + 11)), new Relay(rng(seed + 12)), new Relay(rng(seed + 13))];
    const devices = Array.from({ length: 3 }, (_, i) => new Device('r' + i, seed * 1000 + i));
    const skew = devices.map(() => Math.round((random() * 2 - 1) * 12 * HOUR));
    const backups = new Map();
    let now = T0, restores = 0;
    settleAll(devices, relays, now);
    for (let step = 0; step < 400; step++) {
      now += Math.floor(random() * 50 * 60_000);
      const i = Math.floor(random() * devices.length);
      const d = devices[i];
      const r = random();
      if (r < 0.6) d.play(now);
      else if (r < 0.92) {
        const up = relays.filter(() => random() < 0.7);
        if (!up.length) continue; // offline: the app does not merge or publish
        sync(d, up, now + skew[i], { publish: random() < 0.9 });
        if (random() < 0.2) backups.set(i, { profile: structuredClone(d.profile), earned: structuredClone(d.earned) });
      } else if (backups.has(i)) {
        // Before the restore everything the device did reaches the relays (it was online),
        // then the device is reset to its backup and goes on playing.
        sync(d, relays, now + skew[i]);
        const since = diff(d.earned, backups.get(i).earned);
        d.profile = structuredClone(backups.get(i).profile);
        d.earned = add(structuredClone(backups.get(i).earned), since);
        backups.delete(i);
        restores++;
      }
    }
    for (let round = 0; round < 4; round++) devices.forEach((d, i) => sync(d, relays, now + skew[i] + round));
    assertExact(devices);
    assert.ok(restores > 0, 'the run did restore some backups');
  });
}

test('restoring a backup that held offline progress not yet synced loses nothing; only that part can count twice', () => {
  const { devices: [a, b], relays } = linked(2, 15);
  let now = T0;
  for (let i = 0; i < 5; i++) a.play(now += HOUR);
  sync(a, relays, now);
  const unsynced = structuredClone(a.earned);
  for (let i = 0; i < 6; i++) a.play(now += HOUR); // offline progress, then the backup is taken
  const offline = diff(a.earned, unsynced);
  const backup = { profile: structuredClone(a.profile), earned: structuredClone(a.earned) };
  for (let i = 0; i < 7; i++) a.play(now += HOUR);
  sync(a, relays, now); // everything, including the offline part, reaches the relays
  const since = diff(a.earned, backup.earned);
  a.profile = structuredClone(backup.profile);
  a.earned = add(structuredClone(backup.earned), since);
  for (let i = 0; i < 4; i++) a.play(now += HOUR);
  settleAll([a, b], relays, now + HOUR);
  const truth = add(add(zero(), a.earned), b.earned);
  const got = counters(a.profile);
  assert.equal(view(a.profile), view(b.profile), 'still one profile on both devices');
  assert.ok(got.xp >= truth.xp && got.xp <= truth.xp + offline.xp, `XP ${got.xp}: nothing lost, at most the offline part twice`);
  for (const key of ['wins', 'losses', 'draws']) assert.ok(got[key] >= truth[key] && got[key] <= truth[key] + offline[key], key);
  for (const [id, n] of Object.entries(truth.cards)) if (n) assert.ok(got.cards[id] >= n && got.cards[id] <= n + (offline.cards[id] ?? 0), id);
  for (const [id, n] of Object.entries(truth.visits)) if (n) assert.ok(got.visits[id] >= n && got.visits[id] <= n + (offline.visits[id] ?? 0), id);
});

test('reported bug: the laptop fights its wild fighter while the phone spawned another; no second fight follows', () => {
  const { devices: [laptop, phone], relays } = linked(2, 21);
  laptop.act(p => wildEncounter(p, menu, { now: T0 + HOUR, rng: laptop.random }));
  sync(laptop, relays, T0 + HOUR);
  // The phone opens offline: its stale profile has no wild fighter and the pause is over, so it spawns one.
  phone.profile = normalizeProfile({ ...phone.profile, encounter: null });
  phone.act(p => wildEncounter(p, menu, { now: T0 + 2 * HOUR, rng: phone.random }));
  const phoneWild = phone.profile.encounter;
  assert.ok(phoneWild && phoneWild.id !== laptop.profile.encounter.id);
  sync(phone, relays, T0 + 2 * HOUR);
  // Meanwhile the laptop fights the one it had and wins.
  const laptopWild = laptop.profile.encounter;
  laptop.act(p => resolveEncounter(p, laptopWild.id, true, menu, { now: T0 + 3 * HOUR, teamIds: p.team }));
  settleAll([laptop, phone], relays, T0 + 3 * HOUR + 60_000);
  for (const d of [laptop, phone]) {
    assert.equal(d.profile.encounter, null, d.name + ': no second wild fighter right after the fight');
    assert.equal(d.profile.lastScoutAt, T0 + 3 * HOUR, 'the pause runs from the fight');
  }
  assertExact([laptop, phone]);
});

test('after a fight, a wild fighter spawned during the pause by an unaware device goes; one lured by a visit stays', () => {
  const { devices: [a, b], relays } = linked(2, 22);
  const fight = T0 + 5 * HOUR;
  a.act(p => wildEncounter(p, menu, { now: T0 + 4 * HOUR, rng: a.random }));
  const e = a.profile.encounter;
  a.act(p => resolveEncounter(p, e.id, false, menu, { now: fight, teamIds: p.team }));
  // b has not heard of the fight and spawns one a minute later by itself.
  b.profile = normalizeProfile({ ...b.profile, encounter: null, lastScoutAt: null });
  b.act(p => wildEncounter(p, menu, { now: fight + 60_000, rng: b.random }));
  assert.ok(b.profile.encounter && !b.profile.encounter.visit);
  settleAll([a, b], relays, fight + 120_000);
  assert.equal(a.profile.encounter, null);
  assert.equal(b.profile.encounter, null, 'two fights in a row are not offered');
  // A restaurant visit right after the fight lures a wild fighter on purpose: it stays everywhere.
  const r = b.visit(venues[44], fight + 3 * 60_000);
  assert.ok(r.spawned?.visit, 'a visit marks its wild fighter');
  settleAll([a, b], relays, fight + 4 * 60_000);
  assert.equal(a.profile.encounter?.id, r.spawned.id);
  assert.equal(b.profile.encounter?.id, r.spawned.id);
  assertExact([a, b]);
});

test('two wild fighters waiting at once: the one that came first stays on every device', () => {
  const { devices: [a, b], relays } = linked(2, 23);
  a.act(p => wildEncounter(p, menu, { now: T0 + HOUR, rng: a.random }));
  b.profile = normalizeProfile({ ...b.profile, encounter: null });
  b.act(p => wildEncounter(p, menu, { now: T0 + 2 * HOUR, rng: b.random }));
  const first = a.profile.encounter;
  settleAll([b, a], relays, T0 + 3 * HOUR);
  assert.equal(a.profile.encounter.id, first.id);
  assert.equal(b.profile.encounter.id, first.id);
  assert.ok(a.profile.retired[b.profile.encounter.id] === undefined);
});

test('the login week syncs: a reward taken on one device cannot be taken again on the other the same day', async () => {
  const { claimDaily, dailyStatus } = await import('../public/js/game.js');
  const { devices: [a, b], relays } = linked(2, 31);
  const today = Date.UTC(2026, 10, 25, 9);
  a.act(p => claimDaily(p, menu, { now: today, rng: a.random }));
  settleAll([a, b], relays, today + 60_000);
  assert.equal(dailyStatus(b.profile, today + 120_000).claimable, false, 'already taken today');
  assert.equal(dailyStatus(b.profile, today + 86_400_000).today, 2, 'tomorrow continues the week on either device');
  assertExact([a, b]);
});
