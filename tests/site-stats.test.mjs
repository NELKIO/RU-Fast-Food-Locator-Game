// The statistics of the whole game: every browser reports only its own play, replaceably, so the
// total counts every battle once however many devices share a progress or how often they report.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { freshProfile, grantStarter, normalizeProfile, recordBattle } from '../public/js/game.js';
import { createSiteStats, reportOf, totalOf, STATS_TOPIC } from '../public/js/site-stats.js';
import { docOf, mergeProfile } from '../public/js/sync-merge.js';
import { signEvent } from '../public/js/sync.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
const seq = seed => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
let match = 0;
function play(profile, wins, losses) {
  let p = profile;
  for (let i = 0; i < wins + losses; i++) p = recordBattle(p, { xp: 10, won: i < wins, mode: 'online', matchId: 'm' + ++match, cardId: p.team[0] }).profile;
  return p;
}
const start = seed => grantStarter(freshProfile(), menu, { rng: seq(seed) }).profile;

// A relay that keeps the newest replaceable event per author, and answers REQ by kind and #t.
function relayNetwork() {
  const stored = new Map();
  class Socket {
    constructor() { setTimeout(() => this.onopen?.(), 0); }
    send(text) {
      const [type, a, b] = JSON.parse(text);
      const reply = msg => setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 0);
      if (type === 'EVENT') {
        const key = a.pubkey + ':' + a.tags.find(t => t[0] === 'd')?.[1];
        const kept = stored.get(key);
        if (!kept || a.created_at >= kept.created_at) stored.set(key, a);
        reply(['OK', a.id, true]);
      } else if (type === 'REQ') {
        for (const event of stored.values()) {
          if (b.kinds?.includes(event.kind) && (!b['#t'] || event.tags.some(t => t[0] === 't' && b['#t'].includes(t[1])))) reply(['EVENT', a, event]);
        }
        reply(['EOSE', a]);
      }
    }
    close() {}
  }
  return { Socket, stored };
}
function memoryStorage() {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

test('a browser that never synced reports its whole progress', () => {
  const p = play(start(1), 3, 2);
  const r = reportOf(p);
  assert.deepEqual([r.games, r.wins, r.losses, r.cards, r.kinds], [5, 3, 2, 1, 1]);
  assert.ok(Object.values(r.xp).reduce((a, b) => a + b, 0) > 0);
});

test('linked devices report only their own part: the sum is what was really played', () => {
  // Two devices with their own progress link up and keep playing.
  let laptop = play(start(2), 4, 1), phone = play(start(3), 2, 2);
  laptop = mergeProfile(laptop, [], { now: 1 });
  phone = mergeProfile(phone, [docOf(laptop)], { now: 2 });
  laptop = mergeProfile(laptop, [docOf(phone)], { now: 3 });
  laptop = play(laptop, 1, 0);
  phone = play(phone, 0, 3);
  for (let i = 0; i < 3; i++) {
    phone = mergeProfile(phone, [docOf(laptop)], { now: 10 + i });
    laptop = mergeProfile(laptop, [docOf(phone)], { now: 20 + i });
  }
  // Each shows everything (5 + 4 + 1 + 3 = 13 battles), but together they report 13, not 26.
  assert.equal(laptop.battles.wins + laptop.battles.losses, 13);
  assert.equal(phone.battles.wins + phone.battles.losses, 13);
  const a = reportOf(laptop), b = reportOf(phone);
  assert.deepEqual([a.games + b.games, a.wins + b.wins, a.losses + b.losses, a.cards + b.cards], [13, 7, 6, 2]);
  // A device rolled back to a new id still reports its earlier part through the ids it remembers.
  const rolled = normalizeProfile({ ...laptop, sync: { ...laptop.sync, device: 'newdevice01' } });
  assert.equal(reportOf(rolled, [laptop.sync.device]).games, a.games);
});

test('reports replace each other: the total counts every browser once and checks signatures', async () => {
  const { Socket, stored } = relayNetwork();
  let t = 1_800_000_000_000;
  const options = { relays: ['wss://a', 'wss://b'], Socket, live: true, clock: () => t };
  const first = createSiteStats({ ...options, storage: memoryStorage() });
  const second = createSiteStats({ ...options, storage: memoryStorage() });
  let p1 = play(start(4), 2, 1);
  const p2 = play(start(5), 1, 1);
  assert.ok(await first.report(p1));
  assert.ok(await second.report(p2));
  assert.equal(await first.report(p1), 0, 'nothing new, nothing sent');
  // The same browser plays more and reports again: its newer report replaces the old one.
  p1 = play(p1, 1, 0);
  t += 5000;
  assert.ok(await first.report(p1));
  // A forged report under someone else's key is dropped, and an unrelated event is ignored.
  const forged = { ...[...stored.values()][0], content: JSON.stringify({ v: 1, wins: 999999 }) };
  stored.set('forged', forged);
  stored.set('other', await signEvent(new Uint8Array(32).fill(7), { kind: 30078, created_at: 1, tags: [['d', 'x'], ['t', STATS_TOPIC]], content: '{}' }));
  const total = await first.total();
  assert.deepEqual([total.players, total.games, total.wins, total.losses], [2, 6, 4, 2]);
  assert.ok(total.favorites.length >= 1 && total.favorites.every(f => f.xp > 0));
  assert.deepEqual(first.cached().games, 6, 'the last total is kept for the next view');
  // Off the live site nothing is published.
  const local = createSiteStats({ ...options, live: false, storage: memoryStorage() });
  assert.equal(await local.report(p1), 0);
});

test('reports are cleaned: impossible numbers and unknown fighters do not count', async () => {
  const secret = new Uint8Array(32).fill(3);
  const event = await signEvent(secret, { kind: 30078, created_at: 5, tags: [['d', 'foodradar-stats'], ['t', STATS_TOPIC]],
    content: JSON.stringify({ v: 1, wins: 2, losses: -5, draws: 1e12, cards: 3, xpSource: 'battle', xp: { 'bk-whopper': 40, 'not-a-fighter': 99 } }) });
  const total = await totalOf([event]);
  assert.deepEqual([total.players, total.wins, total.losses, total.draws, total.cards], [1, 2, 0, 0, 3]);
  assert.deepEqual(total.favorites, [{ id: 'bk-whopper', xp: 40 }]);
});

test('two first reports from the same browser count as one player', async () => {
  const { Socket, stored } = relayNetwork();
  const options = { storage: memoryStorage(), relays: ['wss://a'], Socket, live: true };
  const tabs = [createSiteStats(options), createSiteStats(options)];
  const p = start(6);
  await Promise.all(tabs.map(tab => tab.report(p)));
  assert.equal(stored.size, 1);
  const { players, cards } = await tabs[0].total();
  assert.deepEqual([players, cards], [1, 1]);
});

test('a browser without writable storage never reports an ephemeral player', async () => {
  const { Socket, stored } = relayNetwork();
  const blocked = { getItem: () => null, setItem() { throw new Error('storage denied'); } };
  const stats = createSiteStats({ live: true, storage: blocked, relays: ['wss://a'], Socket });
  assert.equal(await stats.report(start(7)), 0);
  assert.equal(stored.size, 0);
});

test('favorites use local battle awards, including past the level cap, and exclude other card XP', async () => {
  let p = start(8);
  const id = p.team[0];
  p.collection[id].xp = 270; // duplicate/login XP and the XP of older saves have no recorded source
  assert.deepEqual(reportOf(p).xp, {});
  p = play(p, 2, 0);
  assert.deepEqual(reportOf(normalizeProfile(p)).xp, { [id]: 20 });
  const linked = mergeProfile(p);
  const other = mergeProfile(freshProfile(), [docOf(linked)]);
  assert.deepEqual(other.battleXp, { [id]: 20 }, 'the linked device downloaded the account ledger');
  assert.deepEqual(reportOf(other).xp, {}, 'it reports only the battles it played itself');
  const old = await signEvent(new Uint8Array(32).fill(4), { kind: 30078, created_at: 5,
    tags: [['d', 'foodradar-stats'], ['t', STATS_TOPIC]], content: JSON.stringify({ v: 1, wins: 1, cards: 1, xp: { [id]: 270 } }) });
  const total = await totalOf([old]);
  assert.deepEqual([total.players, total.games, total.favorites], [1, 1, []]);
});

test('two tabs reporting in one second preserve the newest counters in either delivery order', async () => {
  const { Socket, stored } = relayNetwork();
  const options = { storage: memoryStorage(), Socket, relays: ['wss://a'], live: true, clock: () => 1_800_000_000_000 };
  const older = createSiteStats(options), newer = createSiteStats(options);
  const initial = start(9), played = play(initial, 1, 0);
  await older.report(initial);
  const before = [...stored.values()][0];
  await newer.report(played);
  const after = [...stored.values()][0];
  assert.ok(after.created_at > before.created_at);
  assert.equal(await older.report(initial), 0, 'a delayed tab cannot replace the newer totals');
  for (const events of [[before, after], [after, before]]) {
    const total = await totalOf(events);
    assert.deepEqual([total.games, total.favorites], [1, [{ id: played.team[0], xp: 10 }]]);
  }
});
