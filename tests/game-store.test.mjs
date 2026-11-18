import test from 'node:test';
import assert from 'node:assert/strict';
import {claimVisit, createProfileStore, freshProfile, recordBattle} from '../public/js/game.js';

const key = 'test-profile';
const now = new Date(2026, 4, 8, 18, 0, 0).getTime();
const point = {id: 'osm:test', brand: 'bk', lat: 55.7, lon: 37.6};
const fix = {lat: point.lat, lon: point.lon, accuracy: 15, timestamp: now};
const menu = [{id: 'bk-whopper', brand: 'bk', name: 'Воппер'}];
const spin = profile => claimVisit(profile, point, fix, menu, {now, rng: () => 0});

function memoryStorage() {
  const values = new Map();
  return {getItem: id => values.get(id) ?? null, setItem: (id, value) => values.set(id, value)};
}

function exclusiveLocks() {
  let tail = Promise.resolve();
  return {request: (name, {mode}, operation) => {
    assert.equal(name, key);
    assert.equal(mode, 'exclusive');
    const job = tail.then(operation);
    tail = job.catch(() => {});
    return job;
  }};
}

test('simultaneous tabs claim one reward and settle one match; a freshly created tab sees the complete result', async () => {
  const storage = memoryStorage();
  const locks = exclusiveLocks();
  const a = createProfileStore({storage, locks, key});
  const b = createProfileStore({storage, locks, key});
  const spins = await Promise.all([a.update(spin), b.update(spin)]);
  assert.deepEqual(spins.map(result => result.reason), ['claimed', 'cooldown']);
  const finish = profile => recordBattle(profile, {mode: 'pvp', won: true, xp: 14, cardId: 'bk-whopper', matchId: 'game-room:4'});
  const battles = await Promise.all([b.update(finish), a.update(finish)]);
  assert.deepEqual(battles.map(result => result.reason), ['recorded', 'already-recorded']);
  const reloaded = createProfileStore({storage, locks: null, key}).read();
  assert.equal(reloaded.collection['bk-whopper'].copies, 1);
  assert.equal(reloaded.collection['bk-whopper'].xp, 14);
  assert.equal(reloaded.visits[point.id].count, 1);
  assert.equal(reloaded.battles.wins, 1);
  assert.deepEqual(reloaded, a.read());
});

test('a store reads the latest state for each operation, and subscribers cannot mutate saved data', async () => {
  const storage = memoryStorage();
  const store = createProfileStore({storage, locks: null, key});
  const secondTab = createProfileStore({storage, locks: null, key});
  let changes = 0;
  const unsubscribe = store.subscribe(profile => { changes++; profile.xp = 999; });
  await store.update(spin);
  assert.equal(changes, 1);
  assert.equal(secondTab.read().xp, 12);
  await secondTab.update(profile => recordBattle(profile, {mode: 'training', xp: 3, won: false, matchId: 'a'}));
  assert.equal(store.read().xp, 15);
  await store.update(spin);
  assert.equal(changes, 1);
  unsubscribe();
  await store.update(profile => recordBattle(profile, {mode: 'training', xp: 1, won: true, matchId: 'b'}));
  assert.equal(changes, 1);
});

test('an unavailable or quota-limited browser keeps the current session playable with an explicit persistence flag', async () => {
  const missing = createProfileStore({storage: null, locks: null, key});
  assert.equal(missing.persistent, false);
  const ephemeral = await missing.update(spin);
  assert.equal(ephemeral.persistent, false);
  assert.deepEqual(missing.read(), ephemeral.profile);

  const underlying = memoryStorage();
  const store = createProfileStore({storage: underlying, locks: null, key});
  await store.update(spin);
  underlying.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  const finish = await store.update(p => recordBattle(p, {xp: 4, won: true, matchId: 'training:one'}));
  assert.equal(store.persistent, false);
  assert.equal(finish.profile.xp, 16);
  assert.deepEqual(store.read(), finish.profile);
  assert.equal((await store.update(spin)).reason, 'cooldown');
});

test('a corrupt value is replaced only after a successful action and the caller receives a separate profile snapshot', async () => {
  const storage = memoryStorage();
  storage.setItem(key, '{truncated');
  const store = createProfileStore({storage, locks: null, key});
  assert.deepEqual(store.read(), freshProfile());
  assert.equal(storage.getItem(key), '{truncated');
  const result = await store.update(spin);
  result.profile.team.length = 0;
  const view = store.read();
  view.collection['bk-whopper'].xp = 99;
  assert.deepEqual(store.read().team, ['bk-whopper']);
  assert.equal(store.read().collection['bk-whopper'].xp, 0);
});

test('denied lock access falls back once and an exception inside a held operation is never retried', async () => {
  const storage = memoryStorage();
  const forbidden = {request: async () => { throw new DOMException('blocked', 'SecurityError'); }};
  const fallback = createProfileStore({storage, locks: forbidden, key});
  assert.equal((await fallback.update(spin)).ok, true);
  const safe = createProfileStore({storage, locks: exclusiveLocks(), key});
  let calls = 0;
  await assert.rejects(() => safe.update(() => { calls++; throw new DOMException('callback error', 'SecurityError'); }));
  assert.equal(calls, 1);
  assert.equal(safe.read().visits[point.id].count, 1);
});
