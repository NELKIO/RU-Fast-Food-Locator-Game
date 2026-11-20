// Keeping one player's progress on several devices, with nothing but public Nostr relays.
//
// The account is a random key the player carries from device to device (a link or 32 letters).
// From it every device derives the same signing key and the same AES key. The merged profile
// document (see sync-merge.js) is compressed, encrypted and published as one replaceable NIP-78
// event (kind 30078). Relays only ever see an opaque blob under a pseudonymous key; only the
// holder of the key can read it, and only the holder can replace it.
import { DOC_VERSION, docOf, mergeProfile, stableJson } from './sync-merge.js';

export const SYNC_KIND = 30078;
export const SYNC_TAG = 'foodradar-profile';
// Relays checked to keep app data (a 60 KB event published and read back, 19 Nov 2026).
export const SYNC_RELAYS = Object.freeze([
  'wss://relay.primal.net',
  'wss://nostr-01.yakihonne.com',
  'wss://relay.ditto.pub',
  'wss://relay.nostr.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://nos.lol',
  'wss://relay.damus.io',
]);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_DOC_BYTES = 1_000_000;
const MAX_EVENT_CHARS = 200_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = bytes => Array.from(bytes, octet => octet.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/../g) || [], pair => parseInt(pair, 16));
const sha256 = async data => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data));
const canonical = e => JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);

let schnorrModule = null;
async function schnorr() {
  schnorrModule ??= import('../vendor/duel-trystero-0.27.0.js').then(module => module.schnorr);
  return schnorrModule;
}

// 32 letters, 5 bits each: 160 random bits.
export function newSyncKey() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => ALPHABET[byte & 31]).join('');
}

export function parseSyncKey(value) {
  const text = String(value ?? '').trim();
  const fragment = /(?:^|#|&)sync=([^&\s]+)/i.exec(text);
  const key = (fragment ? fragment[1] : text).replace(/[\s-]/g, '').toUpperCase();
  return key.length === 32 && [...key].every(letter => ALPHABET.includes(letter)) ? key : null;
}

export function formatSyncKey(key) {
  return key.match(/.{4}/g).join('-');
}

export async function accountOf(key) {
  const curve = await schnorr();
  let secret = await sha256('foodradar:sync:sign:1:' + key);
  let pubkey = null;
  // A hash outside the curve order is astronomically unlikely; rehash if it ever happens.
  for (let tries = 0; !pubkey && tries < 8; tries++) {
    try { pubkey = hex(curve.getPublicKey(secret)); } catch { secret = await sha256(secret); }
  }
  const aes = await crypto.subtle.importKey('raw', await sha256('foodradar:sync:aes:1:' + key), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { pubkey, secret, aes };
}

async function pipe(bytes, stream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DOC_BYTES) { await reader.cancel(); throw new Error('document too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };

export async function sealDoc(account, doc, createdAt) {
  const plain = encoder.encode(JSON.stringify(doc));
  const packed = typeof CompressionStream === 'function' ? await pipe(plain, new CompressionStream('deflate-raw')) : plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, account.aes, packed));
  const event = {
    kind: SYNC_KIND, pubkey: account.pubkey, created_at: createdAt, tags: [['d', SYNC_TAG]],
    content: (packed === plain ? 'p1:' : 'z1:') + base64(new Uint8Array([...iv, ...sealed])),
  };
  const digest = await sha256(canonical(event));
  const curve = await schnorr();
  return { ...event, id: hex(digest), sig: hex(await curve.signAsync(digest, account.secret)) };
}

// Returns the document, or null for anything that is not a valid event of this account.
export async function openDoc(account, event) {
  try {
    if (!event || event.kind !== SYNC_KIND || event.pubkey !== account.pubkey || !Number.isSafeInteger(event.created_at) ||
        !/^[a-f\d]{64}$/.test(event.id) || !/^[a-f\d]{128}$/.test(event.sig) || typeof event.content !== 'string' ||
        event.content.length > MAX_EVENT_CHARS || !Array.isArray(event.tags) ||
        !event.tags.some(tag => Array.isArray(tag) && tag[0] === 'd' && tag[1] === SYNC_TAG)) return null;
    const digest = await sha256(canonical(event));
    const curve = await schnorr();
    if (event.id !== hex(digest) || !await curve.verifyAsync(fromHex(event.sig), digest, fromHex(event.pubkey))) return null;
    const mode = event.content.slice(0, 3);
    if (mode !== 'z1:' && mode !== 'p1:') return null;
    const body = Uint8Array.from(atob(event.content.slice(3)), ch => ch.charCodeAt(0));
    const packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12) }, account.aes, body.subarray(12)));
    const plain = mode === 'z1:' ? await pipe(packed, new DecompressionStream('deflate-raw')) : packed;
    if (plain.length > MAX_DOC_BYTES) return null;
    return JSON.parse(decoder.decode(plain));
  } catch {
    return null;
  }
}

// One short-lived connection per relay: read the account's events, or publish one.
function talk(Socket, url, message, finished, timeoutMs) {
  return new Promise(resolve => {
    const got = [];
    let socket, done = false;
    const end = ok => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket?.close(); } catch { /* already closed */ }
      resolve({ ok, got });
    };
    const timer = setTimeout(() => end(false), timeoutMs);
    try { socket = new Socket(url); } catch { end(false); return; }
    socket.onopen = () => { try { socket.send(JSON.stringify(message)); } catch { end(false); } };
    socket.onerror = () => end(false);
    socket.onclose = () => end(false);
    socket.onmessage = ({ data }) => {
      if (typeof data !== 'string' || data.length > MAX_EVENT_CHARS + 4096) return;
      let reply;
      try { reply = JSON.parse(data); } catch { return; }
      if (!Array.isArray(reply)) return;
      const verdict = finished(reply, got);
      if (verdict !== undefined) end(verdict);
    };
  });
}

export async function fetchEvents(account, { relays = SYNC_RELAYS, Socket = globalThis.WebSocket, timeoutMs = 7000 } = {}) {
  const sub = 'fr' + account.pubkey.slice(0, 8);
  const filter = { kinds: [SYNC_KIND], authors: [account.pubkey], '#d': [SYNC_TAG], limit: 3 };
  const replies = await Promise.all(relays.map(url => talk(Socket, url, ['REQ', sub, filter], (reply, got) => {
    if (reply[0] === 'EVENT' && reply[1] === sub) got.push(reply[2]);
    if ((reply[0] === 'EOSE' || reply[0] === 'CLOSED') && reply[1] === sub) return reply[0] === 'EOSE';
    return undefined;
  }, timeoutMs).then(result => ({ url, ...result }))));
  return replies;
}

export async function publishEvent(event, { relays = SYNC_RELAYS, Socket = globalThis.WebSocket, timeoutMs = 7000 } = {}) {
  const replies = await Promise.all(relays.map(url => talk(Socket, url, ['EVENT', event], reply => {
    if (reply[0] === 'OK' && reply[1] === event.id) return reply[2] === true;
    return undefined;
  }, timeoutMs)));
  return replies.filter(reply => reply.ok).length;
}

// The controller the app uses. It pulls, merges into the local profile in one store update,
// and publishes only when the relays do not already hold the merged document.
export function createSync({ store, relays = SYNC_RELAYS, Socket = globalThis.WebSocket, clock = () => Date.now(),
  onStatus = () => {}, debounceMs = 2500, intervalMs = 90_000, paused = () => false } = {}) {
  let status = { state: 'off', at: null, relays: 0, error: null };
  let running = null, timer = null, ticker = null, account = null, accountKey = null, written = null;
  let latestCreated = 0;

  const set = next => { status = { ...status, ...next }; onStatus(status); };
  const key = () => store.read().sync?.key ?? null;

  async function accountFor(k) {
    if (accountKey !== k) { account = await accountOf(k); accountKey = k; latestCreated = 0; }
    return account;
  }

  async function run() {
    const k = key();
    if (!k) { set({ state: 'off' }); return status; }
    // A fight in progress keeps its wild fighter: the merge waits until the result is saved.
    // The caller learns that nothing was checked (the shown status stays as it was).
    if (paused()) { schedule(3000); return { ...status, state: 'paused' }; }
    set({ state: 'syncing', error: null });
    try {
      const acc = await accountFor(k);
      const replies = await fetchEvents(acc, { relays, Socket });
      const reachable = replies.filter(reply => reply.ok).length;
      const opened = [];
      for (const reply of replies) {
        for (const event of reply.got) {
          const doc = await openDoc(acc, event);
          if (doc) opened.push({ url: reply.url, created: event.created_at, doc });
        }
      }
      if (!reachable && !opened.length) { set({ state: 'offline', relays: 0 }); return status; }
      latestCreated = Math.max(latestCreated, ...opened.map(item => item.created));
      if (key() !== k) return status; // unlinked meanwhile
      const now = clock();
      // One store update: the merge always starts from the freshest local profile.
      const result = await store.update(profile => {
        const next = mergeProfile(profile, opened.map(item => item.doc), { now });
        written = stableJson(next);
        return written === stableJson(profile) ? { ok: false, reason: 'unchanged', profile } : { ok: true, profile: next };
      });
      const merged = result.profile;
      const newer = opened.some(item => item.doc?.v > DOC_VERSION);
      const doc = docOf(merged);
      const text = stableJson(doc);
      const holding = new Set(opened.filter(item => stableJson(item.doc) === text).map(item => item.url));
      if (newer) { set({ state: 'outdated', at: clock(), relays: reachable }); return status; }
      let published = holding.size;
      if (holding.size < Math.min(3, reachable)) {
        // Never behind what a relay holds, so the relay takes the new version; a clock that is
        // far ahead on another device is followed by at most ten minutes.
        const nowSeconds = Math.floor(now / 1000);
        const tries = [Math.max(nowSeconds, Math.min(latestCreated + 1, nowSeconds + 600))];
        // Relays refuse events from the future: a device whose own clock runs ahead falls back
        // to the time of the newest event they already hold.
        if (latestCreated && tries[0] !== latestCreated + 1) tries.push(latestCreated + 1);
        for (const createdAt of tries) {
          const accepted = await publishEvent(await sealDoc(acc, doc, createdAt), { relays, Socket });
          if (accepted) { latestCreated = Math.max(latestCreated, createdAt); published = Math.max(published, accepted); break; }
        }
      }
      set(published ? { state: 'ok', at: clock(), relays: published } : { state: 'offline', relays: 0 });
    } catch (error) {
      set({ state: 'error', error: String(error?.message ?? error) });
    }
    return status;
  }

  // One sync at a time. A request during a run gets one more run right after it, shared by every
  // caller who asked meanwhile, so nobody gets a result that started before their request.
  let followUp = null;
  function syncNow() {
    if (running) {
      followUp ??= running.then(() => { followUp = null; return syncNow(); });
      return followUp;
    }
    running = run().finally(() => { running = null; });
    return running;
  }

  function schedule(delay = debounceMs) {
    clearTimeout(timer);
    if (key()) timer = setTimeout(syncNow, delay);
  }

  // Any change that is not this module's own merge (a visit, a fight, another tab) is synced soon.
  const unsubscribe = store.subscribe?.(profile => { if (profile.sync?.key && stableJson(profile) !== written) schedule(); }) ?? (() => {});
  const visible = () => { if (!globalThis.document?.hidden) schedule(300); };
  globalThis.document?.addEventListener?.('visibilitychange', visible);

  return {
    get status() { return status; },
    start() {
      clearInterval(ticker);
      ticker = setInterval(() => { if (!globalThis.document?.hidden) syncNow(); }, intervalMs);
      if (key()) return syncNow();
      set({ state: 'off' });
      return Promise.resolve(status);
    },
    async link(newKey) {
      const k = parseSyncKey(newKey);
      if (!k) return { ok: false, reason: 'bad-key' };
      await store.update(profile => {
        const ready = mergeProfile(profile, [], { now: clock() });
        return { ok: true, profile: { ...ready, sync: { ...ready.sync, key: k } } };
      });
      return { ok: true, status: await syncNow() };
    },
    async unlink() {
      clearTimeout(timer);
      await store.update(profile => (profile.sync ? { ok: true, profile: { ...profile, sync: { ...profile.sync, key: null } } } : { ok: false, profile }));
      set({ state: 'off', at: null, relays: 0 });
    },
    syncNow,
    stop() {
      clearTimeout(timer);
      clearInterval(ticker);
      unsubscribe();
      globalThis.document?.removeEventListener?.('visibilitychange', visible);
    },
  };
}
