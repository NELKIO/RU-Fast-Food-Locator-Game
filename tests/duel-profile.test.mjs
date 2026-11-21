import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileStore, recordBattle} from '../public/js/game.js';
import {docOf, mergeProfile} from '../public/js/sync-merge.js';

const match = {mode: 'online', matchId: 'final-match-001', won: true, xp: 24, cardId: 'fighter'};
const claim = store => store.update(profile => recordBattle(profile, match), {requirePersistence: true});
const totals = profile => [profile.xp, profile.battles.wins, profile.collection.fighter?.xp ?? 0];

function storageFixture() {
  const data = new Map();
  return {
    fail: '',
    getItem(key) {
      if (this.fail === 'read') throw new Error('read denied');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.fail === 'write') throw new Error('write denied');
      data.set(key, value);
    }
  };
}
const open = (storage, locks = null) => createProfileStore({storage, locks});
const sync = (profile, docs = []) => mergeProfile(profile, docs, {device: 'testdevice', now: 1000});

async function prepare(store) {
  await store.update(profile => ({ok: true, profile: sync({...profile, collection: {fighter: {copies: 1, xp: 0}}, team: ['fighter']})}));
}

for (const fail of ['read', 'write']) {
  test('a refused profile ' + fail + ' cannot publish a duel reward; reopening and retry pays once', async () => {
    const storage = storageFixture();
    const first = open(storage);
    await prepare(first);
    let notifications = 0;
    first.subscribe(() => notifications++);
    storage.fail = fail;
    const refused = await claim(first);
    assert.equal(refused.reason, 'storage-unavailable');
    assert.equal(refused.persistent, false);
    assert.equal(notifications, 0);
    assert.deepEqual(totals(first.read()), [0, 0, 0]);
    assert.equal(first.read().battleIds[match.matchId], undefined);
    const cloudDuringFailure = docOf(sync(first.read()));

    storage.fail = '';
    const reopened = open(storage);
    await reopened.update(profile => ({ok: true, profile: sync(profile, [cloudDuringFailure])}));
    assert.deepEqual(totals(reopened.read()), [0, 0, 0]);
    assert.equal((await claim(reopened)).ok, true);
    const uploaded = await reopened.update(profile => ({ok: true, profile: sync(profile)}));
    await reopened.update(profile => ({ok: true, profile: sync(profile, [docOf(uploaded.profile)])}));
    const replay = await claim(open(storage));
    assert.equal(replay.reason, 'already-recorded');
    assert.deepEqual(totals(replay.profile), [24, 1, 24]);
  });
}

test('a retry in the same tab commits only after permission is restored', async () => {
  for (const failure of ['read', 'write']) {
    const storage = storageFixture(), store = open(storage);
    await prepare(store);
    storage.fail = failure;
    assert.equal((await claim(store)).ok, false);
    storage.fail = '';
    assert.equal((await claim(store)).persistent, true);
    assert.deepEqual(totals(open(storage).read()), [24, 1, 24]);
    assert.equal((await claim(store)).reason, 'already-recorded');
  }
});

test('an unavailable or stale store keeps its ordinary in-memory progress and defers a duel', async () => {
  const ephemeral = open(null);
  await prepare(ephemeral);
  assert.ok(ephemeral.read().collection.fighter);
  assert.equal((await claim(ephemeral)).reason, 'storage-unavailable');

  const storage = storageFixture(), first = open(storage);
  await prepare(first);
  storage.fail = 'write';
  await first.update(profile => ({ok: true, profile: {...profile, xp: 7}}));
  storage.fail = '';
  const other = open(storage);
  await other.update(profile => ({ok: true, profile: {...profile, xp: 4}}));
  assert.equal((await claim(first)).reason, 'storage-unavailable');
  assert.equal(first.read().xp, 7);
  assert.equal(other.read().xp, 4);
  assert.deepEqual(totals((await claim(other)).profile), [28, 1, 24]);
});

test('leaving the result during its profile write and reopening it cannot pay twice', async () => {
  const storage = storageFixture();
  await prepare(open(storage));
  let unlock;
  let waiting = new Promise(resolve => { unlock = resolve; });
  const locks = {request(_key, _options, callback) { return waiting = waiting.then(callback); }};
  const previousView = claim(open(storage, locks));
  const reopenedView = claim(open(storage, locks));
  assert.deepEqual(totals(open(storage).read()), [0, 0, 0]);
  unlock();
  const [first, retry] = await Promise.all([previousView, reopenedView]);
  assert.equal(first.ok, true);
  assert.equal(retry.reason, 'already-recorded');
  assert.deepEqual(totals(open(storage).read()), [24, 1, 24]);
});
