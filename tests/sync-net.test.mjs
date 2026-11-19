// The account key, the encrypted signed event, and the whole sync loop against fake relays that
// behave like real ones: one replaceable event per account, outages, and refusal of far-future events.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  claimVisit, createProfileStore, freshProfile, grantStarter, normalizeProfile, recordBattle, setTeam,
} from '../public/js/game.js';
import { stableJson } from '../public/js/sync-merge.js';
import {
  accountOf, createSync, formatSyncKey, newSyncKey, openDoc, parseSyncKey, sealDoc, SYNC_KIND, SYNC_TAG,
} from '../public/js/sync.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
const venues = JSON.parse(readFileSync(new URL('../public/data/venues.json', import.meta.url))).slice(0, 30);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

// Relays as the internet has them: each keeps the newest event per account and tag.
function relayNet({ urls = ['wss://a.test', 'wss://b.test', 'wss://c.test'], futureLimit = 900 } = {}) {
  const stored = new Map(urls.map(url => [url, null]));
  const down = new Set();
  let publishes = 0, nowSeconds = () => Math.floor(Date.now() / 1000);
  class Socket {
    constructor(url) {
      this.url = url;
      setTimeout(() => (down.has(url) || !stored.has(url) ? this.onclose?.() : this.onopen?.()), 1);
    }
    send(raw) {
      const [kind, a, b] = JSON.parse(raw);
      const reply = message => setTimeout(() => this.onmessage?.({ data: JSON.stringify(message) }), 1);
      if (kind === 'REQ') {
        const event = stored.get(this.url);
        if (event && b.authors.includes(event.pubkey) && b.kinds.includes(event.kind)) reply(['EVENT', a, event]);
        reply(['EOSE', a]);
      } else if (kind === 'EVENT') {
        publishes++;
        if (a.created_at > nowSeconds() + futureLimit) { reply(['OK', a.id, false, 'invalid: created_at too far in the future']); return; }
        const kept = stored.get(this.url);
        if (!kept || a.created_at > kept.created_at || (a.created_at === kept.created_at && a.id < kept.id)) stored.set(this.url, a);
        reply(['OK', a.id, true, '']);
      }
    }
    close() { setTimeout(() => this.onclose?.(), 1); }
  }
  return { urls, Socket, stored, down, get publishes() { return publishes; }, setNow(fn) { nowSeconds = fn; } };
}

function memoryStore() {
  const data = new Map();
  return createProfileStore({ storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }, locks: null });
}

async function device(net, seed, { clock } = {}) {
  const store = memoryStore();
  const random = rng(seed);
  await store.update(p => grantStarter(p, menu, { rng: random }));
  const sync = createSync({ store, relays: net.urls, Socket: net.Socket, debounceMs: 5, intervalMs: 1e9, clock });
  return { store, sync, random, played: 0 };
}

async function play(d, steps, start = Date.UTC(2026, 10, 19, 9)) {
  for (let i = 0; i < steps; i++) {
    const now = start + (d.played++) * 7 * 3600_000;
    const point = venues[Math.floor(d.random() * venues.length)];
    await d.store.update(p => claimVisit(p, point, { lat: point.lat, lon: point.lon, accuracy: 10, timestamp: now }, menu, { now, rng: d.random }));
    await d.store.update(p => recordBattle(p, { xp: 24, won: true, mode: 'online', matchId: `${d.played}-${d.random()}`, cardId: p.team[0] }));
  }
}

const counters = p => stableJson({ xp: p.xp, battles: p.battles, collection: p.collection, visits: p.visits });
const settle = () => new Promise(resolve => setTimeout(resolve, 40));

test('the account key reads from a link, with dashes or in lower case, and nothing else', () => {
  const key = newSyncKey();
  assert.match(key, /^[A-HJ-NP-Z2-9]{32}$/);
  assert.equal(parseSyncKey(key), key);
  assert.equal(parseSyncKey(formatSyncKey(key)), key);
  assert.equal(parseSyncKey(formatSyncKey(key).toLowerCase()), key);
  assert.equal(parseSyncKey('https://nelkio.github.io/RU-Fast-Food-Locator-Game/#sync=' + key), key);
  assert.equal(parseSyncKey(' ' + key + '\n'), key);
  for (const bad of ['', key.slice(1), key + 'A', key.slice(0, 31) + '0', key.slice(0, 31) + 'O', key.slice(0, 31) + 'I', '#duel=' + key, null]) {
    assert.equal(parseSyncKey(bad), null, String(bad));
  }
  assert.notEqual(newSyncKey(), newSyncKey());
});

test('the event is encrypted, signed, and opens only with the same key', async () => {
  const key = newSyncKey(), other = newSyncKey();
  const account = await accountOf(key), again = await accountOf(key), stranger = await accountOf(other);
  assert.equal(account.pubkey, again.pubkey, 'the same key gives the same account on every device');
  assert.notEqual(account.pubkey, stranger.pubkey);
  const doc = { v: 1, devices: { abcdefgh: { xp: 5, wins: 1, losses: 0, draws: 0, cards: { 'bk-whopper': [1, 0] }, visits: {} } }, secret: 'Воппер' };
  const event = await sealDoc(account, doc, 1_800_000_000);
  assert.equal(event.kind, SYNC_KIND);
  assert.deepEqual(event.tags, [['d', SYNC_TAG]]);
  assert.ok(!event.content.includes('Воппер') && !event.content.includes('bk-whopper'), 'relays see no plain text');
  assert.deepEqual(await openDoc(again, event), doc);
  assert.equal(await openDoc(stranger, event), null, 'another key cannot read it');
  // Anything altered or not from this account is refused.
  const flip = (text, at) => text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1);
  assert.equal(await openDoc(account, { ...event, content: flip(event.content, 20) }), null, 'edited content');
  assert.equal(await openDoc(account, { ...event, sig: flip(event.sig.toUpperCase(), 5).toLowerCase() }), null, 'edited signature');
  assert.equal(await openDoc(account, { ...event, created_at: event.created_at + 1 }), null, 'edited time');
  assert.equal(await openDoc(account, { ...event, pubkey: stranger.pubkey }), null, 'foreign author');
  assert.equal(await openDoc(account, { ...event, kind: 1 }), null, 'other kind');
  const forged = await sealDoc(stranger, doc, 1_800_000_000);
  assert.equal(await openDoc(account, forged), null, 'signed by someone else');
  for (const junk of [null, {}, 'x', { ...event, content: 'z1:%%%' }, { ...event, content: 'q1:' + event.content.slice(3) }]) {
    assert.equal(await openDoc(account, junk), null);
  }
});

test('a large profile compresses well under the relay size limits', async () => {
  const account = await accountOf(newSyncKey());
  const visits = Object.fromEntries(Array.from({ length: 800 }, (_, i) => ['bk-' + i, 1 + (i % 5)]));
  const devices = Object.fromEntries(Array.from({ length: 4 }, (_, d) => ['device0' + d + 'x', {
    xp: 9000, wins: 300, losses: 200, draws: 9, visits,
    cards: Object.fromEntries(menu.map(item => [item.id, [12, 270]])),
  }]));
  const event = await sealDoc(account, { v: 1, devices, visitsAt: Object.fromEntries(Object.keys(visits).map(id => [id, 1_795_000_000_000])) }, 1_800_000_000);
  assert.ok(event.content.length < 60_000, `${event.content.length} characters`);
  assert.equal(Object.keys((await openDoc(account, event)).devices).length, 4);
});

test('a ledger full of 256 devices still fits the relay size limits', async () => {
  const account = await accountOf(newSyncKey());
  const devices = Object.fromEntries(Array.from({ length: 256 }, (_, d) => ['dev' + String(d).padStart(6, '0'), {
    xp: 40 + d, wins: d % 7, losses: d % 5, draws: 0,
    cards: { [menu[d % menu.length].id]: [1, 10], [menu[(d * 7) % menu.length].id]: [2, 30] },
    visits: { ['bk-' + d]: 1, ['dodo-' + (d * 3)]: 2 },
  }]));
  const event = await sealDoc(account, { v: 1, devices }, 1_800_000_000);
  assert.ok(event.content.length < 60_000, `${event.content.length} characters`);
  assert.equal(Object.keys((await openDoc(account, event)).devices).length, 256);
});

test('two devices with their own progress link and end up with one shared profile', async () => {
  const net = relayNet();
  const laptop = await device(net, 1), phone = await device(net, 2);
  await play(laptop, 6); await play(phone, 4, Date.UTC(2026, 10, 25));
  const before = [laptop.store.read(), phone.store.read()];
  const key = newSyncKey();
  assert.equal((await laptop.sync.link(key)).status.state, 'ok');
  assert.equal((await phone.sync.link(formatSyncKey(key).toLowerCase())).status.state, 'ok');
  await laptop.sync.syncNow();
  const [a, b] = [laptop.store.read(), phone.store.read()];
  assert.equal(counters(a), counters(b));
  assert.equal(a.xp, before[0].xp + before[1].xp);
  assert.equal(a.battles.wins, before[0].battles.wins + before[1].battles.wins);
  for (const p of before) for (const id of Object.keys(p.collection)) assert.ok(a.collection[id], id + ' kept');
  // Further play on both converges again, still without double counting.
  await play(laptop, 2, Date.UTC(2026, 11, 2)); await play(phone, 3, Date.UTC(2026, 11, 3));
  const gained = laptop.store.read().xp + phone.store.read().xp - 2 * a.xp;
  for (let i = 0; i < 3; i++) { await laptop.sync.syncNow(); await phone.sync.syncNow(); }
  assert.equal(counters(laptop.store.read()), counters(phone.store.read()));
  assert.equal(laptop.store.read().xp, a.xp + gained);
  laptop.sync.stop(); phone.sync.stop();
});

test('a sync that changes nothing writes nothing and publishes nothing new', async () => {
  const net = relayNet();
  const d = await device(net, 3);
  await play(d, 3);
  await d.sync.link(newSyncKey());
  await d.sync.syncNow();
  const writes = [];
  const off = d.store.subscribe(p => writes.push(p));
  const published = net.publishes;
  await d.sync.syncNow(); await d.sync.syncNow();
  assert.equal(writes.length, 0, 'no profile writes');
  assert.equal(net.publishes, published, 'no repeated publishing');
  off(); d.sync.stop();
});

test('with every relay down the profile stays exactly as it was', async () => {
  const net = relayNet();
  const d = await device(net, 4);
  await play(d, 3);
  for (const url of net.urls) net.down.add(url);
  const before = stableJson(d.store.read());
  const { status } = await d.sync.link(newSyncKey());
  assert.equal(status.state, 'offline');
  const after = d.store.read();
  assert.equal(counters(after), counters(normalizeProfile(JSON.parse(before))));
  // Back online, the next sync publishes it.
  net.down.clear();
  assert.equal((await d.sync.syncNow()).state, 'ok');
  assert.ok([...net.stored.values()].every(Boolean));
  d.sync.stop();
});

test('progress made on one device reaches the other through a relay that was down for the first', async () => {
  const net = relayNet();
  const a = await device(net, 5), b = await device(net, 6);
  const key = newSyncKey();
  await a.sync.link(key); await b.sync.link(key);
  net.down.add(net.urls[0]); net.down.add(net.urls[1]);
  await play(a, 2);
  await a.sync.syncNow();
  net.down.clear(); net.down.add(net.urls[2]);
  // b only reaches the two relays a could not; a later sync of a fills them.
  await b.sync.syncNow();
  net.down.clear();
  await a.sync.syncNow(); await b.sync.syncNow();
  assert.equal(counters(a.store.read()), counters(b.store.read()));
  a.sync.stop(); b.sync.stop();
});

test('a device whose clock runs hours ahead cannot lock out the other one', async () => {
  const net = relayNet({ futureLimit: 900 });
  const real = () => Date.now();
  const fast = await device(net, 7, { clock: () => real() + 3 * 3600_000 });
  const normal = await device(net, 8);
  const key = newSyncKey();
  await normal.sync.link(key);
  await fast.sync.link(key); // its far-future event is refused by the relays
  await play(normal, 2);
  await normal.sync.syncNow();
  await fast.sync.syncNow();
  await normal.sync.syncNow();
  assert.equal(counters(fast.store.read()), counters(normal.store.read()));
  fast.sync.stop(); normal.sync.stop();
});

test('a document written by a newer game version is merged but never overwritten', async () => {
  const net = relayNet();
  const key = newSyncKey(), account = await accountOf(key);
  const d = await device(net, 9);
  const future = await sealDoc(account, { v: 2, devices: { futuredev1: { xp: 50, wins: 0, losses: 0, draws: 0, cards: {}, visits: {} } }, newThing: [1, 2, 3] }, Math.floor(Date.now() / 1000));
  for (const url of net.urls) net.stored.set(url, future);
  const xp = d.store.read().xp;
  const { status } = await d.sync.link(key);
  assert.equal(status.state, 'outdated');
  assert.equal(d.store.read().xp, xp + 50, 'what this version understands is merged');
  for (const url of net.urls) assert.equal(net.stored.get(url).id, future.id, 'the newer document is left alone');
  d.sync.stop();
});

test('events from strangers or with a broken signature on a relay are ignored', async () => {
  const net = relayNet();
  const key = newSyncKey(), account = await accountOf(key);
  const stranger = await accountOf(newSyncKey());
  const d = await device(net, 10);
  const before = counters(d.store.read());
  const fake = await sealDoc(stranger, { v: 1, devices: { evildevice: { xp: 99999, wins: 0, losses: 0, draws: 0, cards: {}, visits: {} } } }, Math.floor(Date.now() / 1000));
  const broken = { ...(await sealDoc(account, { v: 1, devices: { evildevice: { xp: 99999, wins: 0, losses: 0, draws: 0, cards: {}, visits: {} } } }, Math.floor(Date.now() / 1000))), sig: '0'.repeat(128) };
  net.stored.set(net.urls[0], { ...fake, pubkey: account.pubkey });
  net.stored.set(net.urls[1], broken);
  await d.sync.link(key);
  assert.equal(counters(d.store.read()), before);
  d.sync.stop();
});

test('unlinking stops syncing and keeps the progress; linking again adds nothing twice', async () => {
  const net = relayNet();
  const a = await device(net, 11), b = await device(net, 12);
  await play(a, 3); await play(b, 3, Date.UTC(2026, 11, 1));
  const key = newSyncKey();
  await a.sync.link(key); await b.sync.link(key); await a.sync.syncNow();
  const shared = counters(a.store.read());
  await b.sync.unlink();
  assert.equal(b.store.read().sync.key, null);
  assert.equal(counters(b.store.read()), shared, 'unlinking keeps everything');
  const published = net.publishes;
  await b.store.update(p => setTeam(p, p.team.slice(0, 1)));
  await settle();
  assert.equal(net.publishes, published, 'an unlinked device does not publish');
  await b.sync.link(key); await a.sync.syncNow();
  assert.equal(counters(a.store.read()), shared);
  assert.equal(counters(b.store.read()), shared);
  a.sync.stop(); b.sync.stop();
});

test('a game change on a linked device is synced by itself, and two quick calls run once', async () => {
  const net = relayNet();
  const a = await device(net, 13), b = await device(net, 14);
  const key = newSyncKey();
  await a.sync.link(key); await b.sync.link(key);
  const [x, y, z] = [a.sync.syncNow(), a.sync.syncNow(), a.sync.syncNow()];
  assert.notEqual(x, y, 'a request during a run gets a fresh run');
  assert.equal(y, z, 'requests during the same run share one follow-up');
  await z;
  await play(a, 1, Date.UTC(2026, 11, 20));
  for (let i = 0; i < 20 && net.urls.some(url => !net.stored.get(url)); i++) await settle();
  await settle(); await settle();
  await b.sync.syncNow();
  assert.equal(counters(b.store.read()), counters(a.store.read()));
  a.sync.stop(); b.sync.stop();
});

test('a fresh profile without a ledger and a stored profile from before this feature both link', async () => {
  const net = relayNet();
  const legacy = memoryStore();
  await legacy.update(() => ({ ok: true, profile: { ...freshProfile(), xp: 120, collection: { 'bk-whopper': { copies: 3, xp: 40 } }, team: ['bk-whopper'] } }));
  const sync = createSync({ store: legacy, relays: net.urls, Socket: net.Socket, debounceMs: 5, intervalMs: 1e9 });
  const { status } = await sync.link(newSyncKey());
  assert.equal(status.state, 'ok');
  const p = legacy.read();
  assert.equal(p.xp, 120);
  assert.equal(p.collection['bk-whopper'].copies, 3);
  assert.equal(p.sync.devices[p.sync.device].xp, 120);
  sync.stop();
});
