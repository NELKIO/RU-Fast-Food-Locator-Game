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
  if (plain.length > MAX_DOC_BYTES) throw new Error('document too large');
  let compressor;
  try { compressor = new CompressionStream('deflate-raw'); } catch { /* Some browsers only support gzip. */ }
  const packed = compressor ? await pipe(plain, compressor) : plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, account.aes, packed));
  const event = {
    kind: SYNC_KIND, pubkey: account.pubkey, created_at: createdAt, tags: [['d', SYNC_TAG]],
    content: (packed === plain ? 'p1:' : 'z1:') + base64(new Uint8Array([...iv, ...sealed])),
  };
  if (event.content.length > MAX_EVENT_CHARS) throw new Error('document too large');
  const digest = await sha256(canonical(event));
  const curve = await schnorr();
  return { ...event, id: hex(digest), sig: hex(await curve.signAsync(digest, account.secret)) };
}

// An unsigned or unrelated event carries no account data. An authenticated but unreadable
// snapshot must stop publication: replacing it could erase a newer format or a compressed backup.
async function readProfileEvent(account, event) {
  if (!event || event.kind !== SYNC_KIND || event.pubkey !== account.pubkey || !Number.isSafeInteger(event.created_at) ||
      typeof event.content !== 'string' || !Array.isArray(event.tags) ||
      !event.tags.some(tag => Array.isArray(tag) && tag[0] === 'd' && tag[1] === SYNC_TAG) || !await verifyEvent(event)) return null;
  try {
    const mode = event.content.slice(0, 3);
    if (event.content.length > MAX_EVENT_CHARS || (mode !== 'z1:' && mode !== 'p1:')) return {unreadable: true};
    const body = Uint8Array.from(atob(event.content.slice(3)), ch => ch.charCodeAt(0));
    const packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12) }, account.aes, body.subarray(12)));
    const plain = mode === 'z1:' ? await pipe(packed, new DecompressionStream('deflate-raw')) : packed;
    if (plain.length > MAX_DOC_BYTES) return {unreadable: true};
    const doc = JSON.parse(decoder.decode(plain));
    if (!Number.isSafeInteger(doc?.v) || doc.v < 1 || !doc.devices || typeof doc.devices !== 'object' || Array.isArray(doc.devices)) return {unreadable: true};
    return {doc};
  } catch {
    return {unreadable: true};
  }
}

export async function openDoc(account, event) {
  return (await readProfileEvent(account, event))?.doc ?? null;
}

// One short-lived connection per relay: read the account's events, or publish one.
function talk(Socket, url, message, finished, timeoutMs, frameLimit = MAX_EVENT_CHARS + 4096) {
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
      if (typeof data !== 'string') return;
      if (data.length > frameLimit) { end(false); return; }
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
  // Allow enough room to authenticate an older uncompressed save before applying the document
  // limit. An unbounded/non-protocol frame makes only this relay ineligible for publication.
  }, timeoutMs, 2 * MAX_DOC_BYTES).then(result => ({ url, ...result }))));
  return replies;
}

export async function publishEvent(event, { relays = SYNC_RELAYS, Socket = globalThis.WebSocket, timeoutMs = 7000 } = {}) {
  const replies = await Promise.all(relays.map(url => talk(Socket, url, ['EVENT', event], reply => {
    if (reply[0] === 'OK' && reply[1] === event.id) return reply[2] === true;
    return undefined;
  }, timeoutMs)));
  return replies.filter(reply => reply.ok).length;
}

// Any app event signed with a key of its own (the game statistics use a per-browser key).
export async function signEvent(secret, event) {
  const curve = await schnorr();
  const full = { ...event, pubkey: hex(curve.getPublicKey(secret)) };
  const digest = await sha256(canonical(full));
  return { ...full, id: hex(digest), sig: hex(await curve.signAsync(digest, secret)) };
}

export async function verifyEvent(event) {
  try {
    if (!/^[a-f\d]{64}$/.test(event?.id) || !/^[a-f\d]{128}$/.test(event.sig) || !/^[a-f\d]{64}$/.test(event.pubkey)) return false;
    const digest = await sha256(canonical(event));
    if (event.id !== hex(digest)) return false;
    return await (await schnorr()).verifyAsync(fromHex(event.sig), digest, fromHex(event.pubkey));
  } catch {
    return false;
  }
}

// Events matching a filter from every relay that answers, without duplicates.
export async function queryRelays(filter, { relays = SYNC_RELAYS, Socket = globalThis.WebSocket, timeoutMs = 7000 } = {}) {
  const sub = 'fq' + Math.random().toString(36).slice(2, 10);
  const replies = await Promise.all(relays.map(url => talk(Socket, url, ['REQ', sub, filter], (reply, got) => {
    if (reply[0] === 'EVENT' && reply[1] === sub) got.push(reply[2]);
    if ((reply[0] === 'EOSE' || reply[0] === 'CLOSED') && reply[1] === sub) return reply[0] === 'EOSE';
    return undefined;
  }, timeoutMs)));
  // Identical copies from several relays collapse; anything that differs is kept for the caller to
  // verify (a relay could send a doctored copy under a genuine id).
  const seen = new Map();
  for (const reply of replies) for (const event of reply.got) if (event && typeof event.id === 'string') seen.set(JSON.stringify(event), event);
  return { events: [...seen.values()], reachable: replies.filter(reply => reply.ok).length };
}

// The controller the app uses. It pulls, merges into the local profile in one store update,
// and publishes only when the relays do not already hold the merged document.
export function createSync({ store, relays = SYNC_RELAYS, Socket = globalThis.WebSocket, clock = () => Date.now(),
  onStatus = () => {}, initializeEmpty, debounceMs = 2500, intervalMs = 90_000, paused = () => false } = {}) {
  let status = { state: 'off', at: null, relays: 0, error: null };
  let running = null, timer = null, ticker = null, account = null, accountKey = null, written = null;
  let latestCreated = 0;

  const set = next => { status = { ...status, ...next }; onStatus(status); };
  const key = () => store.read().sync?.key ?? null;

  async function accountFor(k) {
    if (accountKey !== k) { account = await accountOf(k); accountKey = k; latestCreated = 0; }
    return account;
  }

  let reading = null;
  async function pull(k) {
    const acc = await accountFor(k);
    const replies = await fetchEvents(acc, {relays, Socket});
    const checkedRelays = replies.filter(reply => reply.ok).map(reply => reply.url);
    const reachable = checkedRelays.length;
    const opened = [];
    let unreadable = false;
    for (const reply of replies) {
      for (const event of reply.got) {
        const data = await readProfileEvent(acc, event);
        if (data?.unreadable) unreadable = true;
        if (data?.doc) opened.push({url: reply.url, created: event.created_at, doc: data.doc});
      }
    }
    if (key() !== k) return {state: 'off'};
    if (unreadable) return {state: 'unreadable', relays: reachable};
    if (!reachable) return {state: 'offline', relays: 0};
    const now = clock();
    const newer = opened.some(item => item.doc.v > DOC_VERSION);
    latestCreated = Math.max(latestCreated, ...opened.map(item => item.created));
    const result = await store.update(profile => {
      if (profile.sync?.key !== k) return {ok: false, reason: 'account-changed', profile};
      let next = mergeProfile(profile, opened.map(item => item.doc), {now});
      if (!newer && initializeEmpty && !Object.keys(next.collection).length) {
        const starter = initializeEmpty(next);
        if (starter.ok) next = mergeProfile(starter.profile, [], {now});
      }
      written = stableJson(next);
      return written === stableJson(profile) ? {ok: false, reason: 'unchanged', profile} : {ok: true, profile: next};
    });
    if (result.reason === 'account-changed' || key() !== k) return {state: 'off'};
    return {state: newer ? 'outdated' : 'ok', reachable, checkedRelays, relays: reachable, at: now, opened, acc, merged: result.profile};
  }

  // Claims need a completed read and merge. They can share an in-flight read, and can make a
  // fresh read immediately while a previous run is waiting for slow publication acknowledgements.
  function read(k) {
    if (!k) return Promise.resolve({state: 'off'});
    if (paused()) { schedule(3000); return Promise.resolve({state: 'paused'}); }
    if (reading?.key === k) return reading.promise;
    const promise = pull(k).catch(error => ({state: 'error', error: String(error?.message ?? error)}))
      .finally(() => { if (reading?.promise === promise) reading = null; });
    reading = {key: k, promise};
    return promise;
  }

  async function run() {
    const k = key();
    if (!k) { set({state: 'off'}); return status; }
    if (paused()) { schedule(3000); return {...status, state: 'paused'}; }
    set({state: 'syncing', error: null});
    try {
      const phase = await read(k);
      if (phase.state !== 'ok') {
        if (phase.state === 'paused') return {...status, state: 'paused'};
        set({state: phase.state, at: phase.at, relays: phase.relays ?? 0, error: phase.error ?? null});
        return status;
      }
      const {acc, reachable, checkedRelays, opened, merged, at: now} = phase;
      const doc = docOf(merged);
      const text = stableJson(doc);
      const holding = new Set(opened.filter(item => stableJson(item.doc) === text).map(item => item.url));
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
          const accepted = await publishEvent(await sealDoc(acc, doc, createdAt), { relays: checkedRelays, Socket });
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
    async readNow() {
      const {state, relays = 0, at = null} = await read(key());
      return {state, relays, at};
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
