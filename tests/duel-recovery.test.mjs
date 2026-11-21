import assert from 'node:assert/strict';
import test from 'node:test';
import {createDuelJournal} from '../public/js/duel-journal.js';
import {createDuelMailbox} from '../public/js/duel-mailbox.js';
import {makeCodec, FINAL_KIND} from '../public/js/duel-relay.js';
import {schnorr} from '../public/vendor/duel-trystero-0.27.0.js';

function memoryStorage() {
  const records = new Map();
  return {get length() { return records.size; }, key: i => [...records.keys()][i],
    getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k)};
}
const code = 'AAAAA2222A';
const matchId = 'duel-recovery-1';

test('reload keeps the same signing identity and replay; only one tab owns a seat', async () => {
  const storage = memoryStorage();
  const journal = createDuelJournal({storage});
  const otherTab = createDuelJournal({storage});
  const release = await journal.acquire(code, 'host');
  assert.equal(typeof release, 'function');
  assert.equal(await otherTab.acquire(code, 'host'), null);
  const secret = journal.identity(code, 'host');
  const put = (history, awarded) => journal.save({code, role: 'host', secret, snapshot: {matchId, history}, awarded});
  const joining = {matchId: null, history: []};
  assert.ok(journal.save({code, role: 'host', secret, snapshot: joining}));
  assert.ok(put(['hit'], false));
  assert.equal(journal.save({code, role: 'host', secret, snapshot: joining}), false);
  assert.ok(put(['hit', 'hit'], true));
  assert.equal(otherTab.remove(code, 'host'), false);
  assert.equal(put(['hit'], false), false);
  assert.equal(put(['hit', 'block'], false), false);
  assert.equal(put(['block', 'hit', 'hit'], false), false);
  await release();
  const nextRelease = await otherTab.acquire(code, 'host');
  assert.equal(typeof nextRelease, 'function');
  assert.equal(otherTab.identity(code, 'host'), secret);
  assert.deepEqual(otherTab.list()[0].snapshot.history, ['hit', 'hit']);
  assert.equal(otherTab.list()[0].awarded, true);
  const releaseGuest = await otherTab.acquire(code, 'guest');
  const otherSecret = otherTab.identity(code, 'guest');
  assert.notEqual(secret, otherSecret);
  assert.equal(otherTab.remove(code, 'guest'), true);
  await releaseGuest(); await nextRelease();
});

test('a failed browser write retains the replay in this page and reports that it is volatile', async () => {
  const storage = memoryStorage();
  const journal = createDuelJournal({storage});
  const release = await journal.acquire(code, 'host');
  const secret = journal.identity(code, 'host');
  storage.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  assert.ok(journal.save({code, role: 'host', secret, snapshot: {matchId, history: ['hit']}}));
  assert.equal(journal.persistent, false);
  await release();
  const resume = await journal.acquire(code, 'host');
  assert.equal(journal.identity(code, 'host'), secret);
  assert.deepEqual(journal.list()[0].snapshot.history, ['hit']);
  await resume();
  assert.equal(createDuelJournal({storage}).list()[0].snapshot, null);
});

test('a durable signing key never publishes a move forgotten after a failed write', async () => {
  const storage = memoryStorage();
  const journal = createDuelJournal({storage});
  const release = await journal.acquire(code, 'host');
  const secret = journal.identity(code, 'host');
  const entry = history => ({code, role: 'host', secret, snapshot: {matchId, history}});
  assert.ok(journal.commitMove(entry(['hit'])));
  assert.equal(journal.canAcknowledge(code, 'host'), true);
  storage.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  assert.equal(journal.commitMove(entry(['hit', 'guard'])), false);
  assert.equal(journal.canAcknowledge(code, 'host'), false);
  assert.deepEqual(journal.list()[0].snapshot.history, ['hit']);
  await release();
  assert.deepEqual(createDuelJournal({storage}).list()[0].snapshot.history, ['hit']);
});

test('a seat which was only in memory from the start can play until the page closes', async () => {
  const journal = createDuelJournal({storage: null});
  const release = await journal.acquire(code, 'guest');
  const secret = journal.identity(code, 'guest');
  assert.equal(journal.persistent, false);
  assert.ok(journal.commitMove({code, role: 'guest', secret, snapshot: {matchId, history: ['hit']}}));
  assert.equal(journal.canAcknowledge(code, 'guest'), true);
  await release();
  assert.equal(journal.canAcknowledge(code, 'guest'), false);
  assert.deepEqual(createDuelJournal({storage: null}).list(), []);
});

test('a browser which denies locks cannot reuse a signing key belonging to another tab', async () => {
  const storage = memoryStorage();
  const owner = createDuelJournal({storage});
  const release = await owner.acquire(code, 'host');
  const secret = owner.identity(code, 'host');
  const locks = {request: async () => { throw new DOMException('Denied', 'SecurityError'); }};
  const denied = createDuelJournal({storage, locks});
  assert.equal(await denied.acquire(code, 'host'), null);
  const play = await denied.acquire(code, 'guest');
  assert.equal(denied.persistent, false);
  assert.notEqual(denied.identity(code, 'guest'), secret);
  assert.equal(owner.list().length, 1);
  await play();
  await release();
});

test('encrypted final can be read later by the original seat, bound to peer, room and match', async () => {
  const aliceKey = Buffer.from(schnorr.keygen().secretKey).toString('hex');
  const bobKey = Buffer.from(schnorr.keygen().secretKey).toString('hex');
  const alice = await makeCodec(code, schnorr, aliceKey);
  const bob = await makeCodec(code, schnorr, bobKey);
  const packet = {v: 5, side: 0, kind: 'state', matchId, history: ['hit','block','special']};
  const saved = await alice.sealFinal(bob.id, packet);
  assert.equal(saved.kind, FINAL_KIND);
  assert.ok(!JSON.stringify(saved).includes(matchId));
  assert.ok(!JSON.stringify(saved).includes('special'));
  assert.equal(await bob.open(saved), null); // stored events cannot masquerade as fresh presence
  const returned = await makeCodec(code, schnorr, bobKey);
  assert.deepEqual(await returned.openFinal(saved, alice.id, matchId), packet);
  assert.equal(await returned.openFinal(saved, alice.id, 'another-match'), null);
  assert.equal(await returned.openFinal(saved, bob.id, matchId), null);
  assert.equal(await returned.openFinal({...saved, sig: '0'.repeat(128)}, alice.id, matchId), null);
  const stranger = await makeCodec(code, schnorr);
  assert.equal(await stranger.openFinal(saved, alice.id, matchId), null);
  const wrongRoom = await makeCodec('BBBBB2222A', schnorr, bobKey);
  assert.equal(await wrongRoom.openFinal(saved, alice.id, matchId), null);
  assert.deepEqual(await returned.openFinal(saved, alice.id, matchId), packet); // duplicates remain verifiable after a failed local write
});

test('an absent final backs off bounded relay lookups while the match waits', async () => {
  let time = 0, requests = 0;
  const codec = {finalTag: async () => 'tag'};
  const reader = createDuelMailbox(codec, [], () => false, {
    now: () => time,
    query: async () => { requests++; return {events: []}; },
  });
  for (const moment of [0, 9_999, 10_000, 20_000, 30_000, 50_000, 70_000, 120_000, 130_000]) {
    time = moment;
    await reader.lookup('peer', matchId);
  }
  assert.equal(requests, 5);
});

test('a temporary relay outage retries; the returning opponent reads the final without a live peer', async () => {
  let time = 1, stored, attempts = 0;
  const a = await makeCodec(code, schnorr), b = await makeCodec(code, schnorr);
  const packet = {v: 5, side: 0, kind: 'state', matchId, history: ['hit']};
  const writer = createDuelMailbox(a, [], () => {}, {now: () => time, publish: async event => {
    attempts++;
    if (attempts === 1) return 0;
    stored = event;
    return 1;
  }});
  await writer.checkpoint(b.id, packet);
  await writer.checkpoint(b.id, packet);
  assert.equal(attempts, 1);
  time += 16_000;
  await writer.checkpoint(b.id, packet);
  await writer.checkpoint(b.id, packet);
  assert.equal(attempts, 2);
  const received = [];
  const reader = createDuelMailbox(b, [], (peer, value) => {received.push([peer,value]); return true;},
    {now: () => time, query: async filter => {
      assert.deepEqual(filter.authors, [a.id]);
      assert.equal(filter['#d'][0], stored.tags[0][1]);
      return {events: [{...stored, sig: '0'.repeat(128)}, stored]};
    }});
  await reader.lookup(a.id, matchId);
  assert.deepEqual(received, [[a.id,packet]]);
});
