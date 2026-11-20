// Statistics of the whole game, with no server of our own.
//
// Every browser publishes what it has played itself as one public, replaceable Nostr event (kind
// 30078) under a key of its own: battles, wins, losses, draws, fighters caught, restaurant visits
// and the experience each fighter earned. A newer report from the same browser replaces the older
// one on the relays, so reporting again never adds up. Linked devices report only their own part
// of the shared progress (the sync ledger), so a progress synced to three devices still counts
// once. Reading collects the latest report of every browser and adds them up.
import { FIGHTERS } from './fighters.js';
import { ownContribution } from './sync-merge.js';
import { queryRelays, publishEvent, signEvent, SYNC_KIND, SYNC_RELAYS, verifyEvent } from './sync.js';

export const STATS_TAG = 'foodradar-stats';
export const STATS_TOPIC = 'foodradar-stats-v1';
const STORE_KEY = 'foodradar.stats.v1';
const CACHE_KEY = 'foodradar.stats.total.v1';
const MAX = 1_000_000; // per browser and counter: anything larger is not a real player
const REFRESH_MS = 24 * 3600_000;

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/../g) || [], pair => parseInt(pair, 16));
const count = value => (Number.isSafeInteger(value) && value > 0 && value <= MAX ? value : 0);

// The report of one browser, built from its own contribution.
export function reportOf(profile, earlierIds = []) {
  const own = ownContribution(profile, earlierIds);
  const xp = {}, caught = {};
  let cards = 0;
  for (const [id, [copies, gained]] of Object.entries(own.cards)) {
    if (!FIGHTERS[id]) continue;
    cards += copies;
    if (copies) caught[id] = copies;
    if (gained) xp[id] = gained;
  }
  const visits = Object.values(own.visits).reduce((sum, n) => sum + n, 0);
  return {
    v: 1, games: own.wins + own.losses + own.draws, wins: own.wins, losses: own.losses, draws: own.draws,
    cards, kinds: Object.keys(caught).length, visits, places: Object.values(own.visits).filter(Boolean).length, xp,
  };
}

function cleanReport(value) {
  if (!value || typeof value !== 'object' || value.v !== 1) return null;
  const out = { games: 0, wins: 0, losses: 0, draws: 0, cards: 0, kinds: 0, visits: 0, places: 0, xp: {} };
  for (const key of ['wins', 'losses', 'draws', 'cards', 'kinds', 'visits', 'places']) out[key] = count(value[key]);
  out.games = out.wins + out.losses + out.draws;
  if (value.xp && typeof value.xp === 'object') {
    for (const [id, xp] of Object.entries(value.xp)) if (Object.hasOwn(FIGHTERS, id) && count(xp)) out.xp[id] = count(xp);
  }
  return out;
}

// Adds up the latest report of every browser. Events are verified: a relay cannot forge one.
export async function totalOf(events) {
  // Per author, newest first; the first one with a valid signature is that browser's report.
  const byAuthor = new Map();
  for (const event of events) {
    if (event?.kind !== SYNC_KIND || !Array.isArray(event.tags) || !event.tags.some(t => t[0] === 'd' && t[1] === STATS_TAG)) continue;
    if (typeof event.content !== 'string' || event.content.length > 20_000 || !Number.isSafeInteger(event.created_at)) continue;
    byAuthor.set(event.pubkey, [...(byAuthor.get(event.pubkey) ?? []), event]);
  }
  const latest = [];
  for (const list of byAuthor.values()) {
    list.sort((a, b) => b.created_at - a.created_at);
    for (const event of list) if (await verifyEvent(event)) { latest.push(event); break; }
  }
  const total = { players: 0, games: 0, wins: 0, losses: 0, draws: 0, cards: 0, visits: 0, favorites: [] };
  const xp = {};
  for (const event of latest) {
    let report;
    try { report = cleanReport(JSON.parse(event.content)); } catch { report = null; }
    if (!report || (!report.games && !report.cards && !report.visits)) continue;
    total.players++;
    for (const key of ['games', 'wins', 'losses', 'draws', 'cards', 'visits']) total[key] += report[key];
    for (const [id, gained] of Object.entries(report.xp)) xp[id] = (xp[id] ?? 0) + gained;
  }
  total.favorites = Object.entries(xp).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([id, gained]) => ({ id, xp: gained }));
  return total;
}

export function createSiteStats({ storage = globalThis.localStorage, relays = SYNC_RELAYS, Socket = globalThis.WebSocket,
  live = false, clock = () => Date.now(), debounceMs = 20_000 } = {}) {
  const read = key => { try { return JSON.parse(storage?.getItem(key) ?? 'null'); } catch { return null; } };
  const write = (key, value) => { try { storage?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

  // This browser's statistics key and every device id it has used (a rollback gives a new one).
  async function identity(profile) {
    let me = read(STORE_KEY);
    if (!me || !/^[a-f\d]{64}$/.test(me.secret)) {
      const { schnorr } = await import('../vendor/duel-trystero-0.27.0.js');
      let secret;
      do { secret = crypto.getRandomValues(new Uint8Array(32)); } while ((() => { try { schnorr.getPublicKey(secret); return false; } catch { return true; } })());
      me = { secret: hex(secret), devices: [], sent: '', sentAt: 0 };
    }
    const device = profile?.sync?.device;
    if (device && !me.devices.includes(device)) me.devices = [...me.devices, device].slice(-64);
    write(STORE_KEY, me);
    return me;
  }

  let timer = null, running = null;
  // Publishes this browser's report when it changed (or once a day, so relays keep it).
  async function report(profile) {
    if (!live || !profile) return 0;
    const me = await identity(profile);
    const body = JSON.stringify(reportOf(profile, me.devices));
    if (body === me.sent && clock() - me.sentAt < REFRESH_MS) return 0;
    const event = await signEvent(fromHex(me.secret), {
      kind: SYNC_KIND, created_at: Math.floor(clock() / 1000), tags: [['d', STATS_TAG], ['t', STATS_TOPIC]], content: body,
    });
    const accepted = await publishEvent(event, { relays, Socket });
    if (accepted) write(STORE_KEY, { ...read(STORE_KEY), sent: body, sentAt: clock() });
    return accepted;
  }

  return {
    // Soon after a change, one report at a time.
    schedule(profile, delay = debounceMs) {
      if (!live) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        running = (running ?? Promise.resolve()).then(() => report(profile)).catch(() => 0).finally(() => { running = null; });
      }, delay);
    },
    report,
    cached: () => read(CACHE_KEY),
    // The total over all browsers; the last good answer is kept for an instant first view.
    async total() {
      const { events, reachable } = await queryRelays({ kinds: [SYNC_KIND], '#t': [STATS_TOPIC], limit: 5000 }, { relays, Socket });
      if (!reachable && !events.length) return read(CACHE_KEY);
      const total = { ...(await totalOf(events)), at: clock() };
      write(CACHE_KEY, total);
      return total;
    },
  };
}
