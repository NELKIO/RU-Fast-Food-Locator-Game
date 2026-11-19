// The real sync controller under asynchronous chaos: the player keeps playing while syncs are in
// flight, two tabs of one device sync the same storage, relays answer late and out of order, go
// down and come back, and refuse events from the future. Afterwards every device must hold the
// same profile and exactly what all devices earned.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CARD_XP_CAP, claimVisit, createProfileStore, grantStarter, normalizeProfile, recordBattle, resolveEncounter, setTeam, wildEncounter,
} from '../public/js/game.js';
import { stableJson } from '../public/js/sync-merge.js';
import { createSync, newSyncKey } from '../public/js/sync.js';

const menu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
const venues = JSON.parse(readFileSync(new URL('../public/data/venues.json', import.meta.url))).slice(0, 40);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function relayNet(random, urls = ['wss://a.test', 'wss://b.test', 'wss://c.test', 'wss://d.test']) {
  const stored = new Map(urls.map(url => [url, null]));
  const down = new Set();
  const delay = () => Math.floor(random() * 12);
  class Socket {
    constructor(url) {
      this.url = url;
      setTimeout(() => (down.has(url) ? this.onclose?.() : this.onopen?.()), delay());
    }
    send(raw) {
      const [kind, a, b] = JSON.parse(raw);
      const reply = message => setTimeout(() => this.onmessage?.({ data: JSON.stringify(message) }), delay());
      if (down.has(this.url)) { setTimeout(() => this.onclose?.(), delay()); return; }
      if (kind === 'REQ') {
        const event = stored.get(this.url);
        if (event && b.authors.includes(event.pubkey)) reply(['EVENT', a, event]);
        reply(['EOSE', a]);
      } else if (kind === 'EVENT') {
        if (a.created_at > Math.floor(Date.now() / 1000) + 900) { reply(['OK', a.id, false, 'invalid: too far in the future']); return; }
        const kept = stored.get(this.url);
        if (!kept || a.created_at > kept.created_at || (a.created_at === kept.created_at && a.id < kept.id)) stored.set(this.url, a);
        reply(['OK', a.id, true, '']);
      }
    }
    close() { setTimeout(() => this.onclose?.(), delay()); }
  }
  return { urls, Socket, down, stored };
}

function memoryStore() {
  const data = new Map();
  return createProfileStore({ storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }, locks: null });
}

const counters = p => ({
  xp: p.xp, wins: p.battles.wins, losses: p.battles.losses, draws: p.battles.draws,
  cards: Object.fromEntries(Object.entries(p.collection).map(([id, c]) => [id, c.copies]).sort()),
  cardXp: Object.fromEntries(Object.entries(p.collection).map(([id, c]) => [id, c.xp]).sort()),
  visits: Object.fromEntries(Object.entries(p.visits).map(([id, v]) => [id, v.count]).sort()),
});
const zero = () => ({ xp: 0, wins: 0, losses: 0, draws: 0, cards: {}, cardXp: {}, visits: {} });
function add(total, delta, sign = 1) {
  for (const key of ['xp', 'wins', 'losses', 'draws']) total[key] += sign * delta[key];
  for (const f of ['cards', 'cardXp', 'visits']) for (const [id, n] of Object.entries(delta[f])) total[f][id] = (total[f][id] ?? 0) + sign * n;
  return total;
}
const view = p => { const s = normalizeProfile(p); delete s.battleIds; delete s.sync.device; delete s.sync.key; return stableJson(s); };

for (let seed = 1; seed <= 8; seed++) {
  test(`live chaos (seed ${seed}): play during syncs, two tabs, late and lost relay answers, a fast clock`, async () => {
    const random = rng(seed * 6007);
    const net = relayNet(rng(seed * 31));
    const key = newSyncKey();
    let fakeNow = Date.UTC(2026, 10, 20, 8);
    // Three devices; the first has two tabs on one storage; the last one's clock runs 3 hours fast.
    const devices = [0, 1, 2].map(i => {
      const store = memoryStore();
      return { name: 'live' + i, store, random: rng(seed * 100 + i), earned: zero(), match: 0, offset: i === 2 ? 3 * 3600_000 : 0 };
    });
    const controllers = [];
    for (const d of devices) {
      const tabs = d.name === 'live0' ? 2 : 1;
      for (let t = 0; t < tabs; t++) {
        controllers.push({ d, sync: createSync({ store: d.store, relays: net.urls, Socket: net.Socket, debounceMs: 8, intervalMs: 1e9, clock: () => Date.now() + d.offset }) });
      }
    }
    // Every game action goes through the store; what it adds is the ground truth.
    async function act(d, change) {
      await d.store.update(p => {
        const result = change(p);
        if (result.ok !== false) add(d.earned, add(counters(normalizeProfile(result.profile)), counters(p), -1));
        return result;
      });
    }
    function play(d) {
      const now = (fakeNow += Math.floor(d.random() * 3 * 3600_000));
      const r = d.random();
      if (r < 0.35) {
        const point = venues[Math.floor(d.random() * venues.length)];
        return act(d, p => claimVisit(p, point, { lat: point.lat, lon: point.lon, accuracy: 10, timestamp: now }, menu, { now, rng: d.random }));
      }
      if (r < 0.6) return act(d, p => {
        if (!p.encounter) return wildEncounter(p, menu, { now, rng: d.random });
        return resolveEncounter(p, p.encounter.id, d.random() < 0.6, menu, { now, teamIds: p.team });
      });
      if (r < 0.85) return act(d, p => recordBattle(p, { xp: 24, won: d.random() < 0.5, mode: 'online', matchId: `${d.name}-${++d.match}`, cardId: p.team[0] }));
      return act(d, p => {
        const owned = Object.keys(p.collection);
        const team = owned.filter(() => d.random() < 0.5).slice(0, 3);
        return setTeam(p, team.length ? team : owned.slice(0, 1));
      });
    }

    for (const d of devices) await act(d, p => grantStarter(p, menu, { rng: d.random }));
    for (const d of devices) for (let i = 0; i < 5; i++) await play(d);
    await Promise.all(controllers.map(c => c.sync.link(key)));

    // Chaos: plays, explicit syncs and the automatic debounced ones overlap; relays flap.
    const pending = [];
    for (let step = 0; step < 160; step++) {
      const r = random();
      if (r < 0.1) { const url = net.urls[Math.floor(random() * net.urls.length)]; net.down.has(url) ? net.down.delete(url) : net.down.add(url); }
      else if (r < 0.7) pending.push(play(devices[Math.floor(random() * devices.length)]));
      else pending.push(controllers[Math.floor(random() * controllers.length)].sync.syncNow());
      if (random() < 0.3) await wait(Math.floor(random() * 10));
    }
    await Promise.all(pending);

    // Back online; let the automatic syncs finish, then sync everyone a few times.
    net.down.clear();
    await wait(80);
    for (let round = 0; round < 4; round++) for (const c of controllers) await c.sync.syncNow();
    controllers.forEach(c => c.sync.stop());

    const total = devices.reduce((sum, d) => add(sum, d.earned), zero());
    const reference = view(devices[0].store.read());
    for (const d of devices) {
      const p = d.store.read();
      assert.equal(view(p), reference, d.name + ' holds the same profile');
      const c = counters(p);
      assert.equal(c.xp, total.xp, 'player XP');
      assert.deepEqual([c.wins, c.losses, c.draws], [total.wins, total.losses, total.draws], 'battles');
      assert.deepEqual(c.cards, Object.fromEntries(Object.entries(total.cards).filter(([, n]) => n).sort()), 'copies');
      assert.deepEqual(c.visits, Object.fromEntries(Object.entries(total.visits).filter(([, n]) => n).sort()), 'visits');
      for (const [id, xp] of Object.entries(c.cardXp)) assert.ok(xp <= CARD_XP_CAP && xp >= Math.min(CARD_XP_CAP, total.cardXp[id] ?? 0), id);
      assert.ok(p.team.every(id => p.collection[id]));
    }
  });
}
