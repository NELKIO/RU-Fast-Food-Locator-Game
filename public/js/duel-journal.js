// Local to this browser: the signing identity and replay for each seat in a room.
// A Web Lock keeps a second tab from playing divergent moves under the same identity.
const PREFIX = 'foodradar.duel.v5.';
const volatileSeats = new Set();

function newSecret() {
  // Draw a nonzero 255-bit scalar, always below the secp256k1 group order.
  const bytes = new Uint8Array(32);
  do {
    crypto.getRandomValues(bytes);
    bytes[0] &= 127;
  } while (!bytes.some(Boolean));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function createDuelJournal({storage, locks} = {}) {
  if (locks === undefined) {
    try { locks = globalThis.navigator?.locks; } catch { locks = null; }
  }
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  // Without an exclusive lock, independent tabs must never share the signing key.
  const volatileRecords = new Map();
  const heldSeats = new Set();
  const durableSigners = new Map();
  let persistent = Boolean(storage && locks?.request);
  let useLocks = persistent;
  const keyOf = (code, role) => PREFIX + code + '.' + role;
  function get(key) {
    if (persistent) {
      try {
        const value = storage.getItem(key);
        if (value === null) return null;
        const entry = JSON.parse(value);
        if (!entry || keyOf(entry.code, entry.role) !== key || !/^[0-9a-f]{64}$/.test(entry.secret)) return null;
        durableSigners.set(key, entry.secret);
        volatileRecords.set(key, entry);
        return entry;
      } catch (error) { if (error instanceof SyntaxError) return null; persistent = false; }
    }
    return volatileRecords.get(key) ?? null;
  }
  function put(entry, requireDurable = false) {
    const key = keyOf(entry.code, entry.role);
    entry.updatedAt = Date.now();
    if (persistent) {
      try {
        storage.setItem(key, JSON.stringify(entry));
        durableSigners.set(key, entry.secret);
      } catch { persistent = false; }
    }
    if (requireDurable && !persistent) return false;
    volatileRecords.set(key, entry);
    return true;
  }

  function save({code, role, secret, snapshot, awarded = false}, ownMove = false) {
    const key = keyOf(code, role);
    if (!heldSeats.has(key)) return false;
    const previous = get(key);
    if (!previous || previous.secret !== secret || !Array.isArray(snapshot?.history)) return false;
    const saved = previous.snapshot;
    if (saved && ((saved.matchId != null && saved.matchId !== snapshot.matchId) ||
        saved.peer !== snapshot.peer || !Array.isArray(saved.history) ||
        saved.history.length > snapshot.history.length ||
        !saved.history.every((command, i) => command === snapshot.history[i]) ||
        (saved.peerHasFinal && !snapshot.peerHasFinal))) return false;
    // Once this signer exists on disk, a reload can replay that seat. Never send an own
    // move that would disappear on reload and let the same player choose again.
    const requireDurable = ownMove && durableSigners.get(key) === secret;
    return put({code, role, secret, snapshot, awarded: awarded || previous.awarded}, requireDurable);
  }

  return {
    get persistent() { return persistent; },
    async acquire(code, role) {
      const key = keyOf(code, role);
      if (useLocks) {
        try {
          return await new Promise((resolve, reject) => {
            const held = locks.request(key, {ifAvailable: true}, lock => {
              if (!lock) { resolve(null); return; }
              let unlock;
              const wait = new Promise(done => { unlock = done; });
              heldSeats.add(key);
              resolve(() => { heldSeats.delete(key); unlock(); return held; });
              return wait;
            });
            held.catch(reject);
          });
        } catch (error) {
          if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error?.name)) throw error;
          // Never reuse a persistent signer across tabs if the browser denies locking.
          if (get(key) || heldSeats.size) return null;
          volatileRecords.clear();
          useLocks = persistent = false;
        }
      }
      if (volatileSeats.has(key)) return null;
      volatileSeats.add(key);
      heldSeats.add(key);
      return () => { heldSeats.delete(key); volatileSeats.delete(key); };
    },
    identity(code, role) {
      const key = keyOf(code, role);
      if (!heldSeats.has(key)) throw new Error('Для ключа дуэли нужно занять место в комнате');
      const previous = get(key);
      if (previous) return previous.secret;
      const entry = {code, role, secret: newSecret(), snapshot: null, awarded: false};
      put(entry);
      return entry.secret;
    },
    save(entry) { return save(entry); },
    commitMove(entry) { return save(entry, true); },
    canAcknowledge(code, role) {
      const key = keyOf(code, role);
      return heldSeats.has(key) && (persistent || durableSigners.get(key) !== volatileRecords.get(key)?.secret);
    },
    list() {
      const keys = new Set(volatileRecords.keys());
      if (persistent) {
        try {
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith(PREFIX)) keys.add(key);
          }
        } catch { persistent = false; }
      }
      return [...keys].map(get).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    remove(code, role) {
      const key = keyOf(code, role);
      if (!heldSeats.has(key)) return false;
      if (persistent) {
        try {
          storage.removeItem(key);
          durableSigners.delete(key);
        } catch { persistent = false; }
      }
      volatileRecords.delete(key);
      return true;
    },
  };
}
