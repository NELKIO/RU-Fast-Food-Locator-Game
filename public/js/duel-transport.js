import { makeCodec, openRelays } from './duel-relay.js';

// The direct data channel has priority. A second signed, encrypted path also
// works on networks where a browser cannot establish a WebRTC connection.
export const SIGNAL_RELAYS = Object.freeze([
  'wss://relay.primal.net',
  'wss://bucket.coracle.social',
  'wss://nostr-01.yakihonne.com',
  'wss://relay.ditto.pub',
  'wss://relay.nostr.net'
]);

export async function connectDuel(code, handlers, signal) {
  const { joinRoom, schnorr } = await import('../vendor/duel-trystero-0.27.0.js');
  const codec = await makeCodec(code, schnorr);
  if (signal.aborted) return;
  let room;
  if (typeof RTCPeerConnection === 'function' && typeof Promise.withResolvers === 'function') {
    room = joinRoom({
      appId: 'NELKIO/fast-food-locator/duel-v1',
      identity: 'none',
      password: code,
      maxUsers: 2,
      maxReceiveBytes: 16_384,
      relayConfig: { urls: SIGNAL_RELAYS, warnOnRelayFailure: false }
    }, 'arena-' + code);
  }
  const action = room?.makeAction('duel');
  const self = room?.getSelf().then(({ userId }) => userId).catch(() => null);
  const connected = new Set();
  const direct = new Map();
  const stalled = new Set();
  const rawPeers = new Set();
  const pending = new Set();
  let relays = null, lastAd = 0;

  function enableRelays() {
    if (relays || signal.aborted) return;
    relays = openRelays(SIGNAL_RELAYS, codec.topic, event => accept(event), () => advertiseRelays(), () => handlers.error('relay'));
  }

  async function advertiseRelays(force = false) {
    if (!relays || signal.aborted || (direct.size && !force) || Date.now() - lastAd < 900) return;
    lastAd = Date.now();
    const event = await codec.seal({ kind: 'presence', to: null });
    relays?.publish(event);
  }

  async function advertiseDirect(userId) {
    const event = await codec.seal({ kind: 'presence', to: null, via: await self });
    if (!signal.aborted) await action.send(event, { target: userId }).catch(() => {});
  }

  async function accept(event, rawId = null) {
    const verified = await codec.open(event);
    if (!verified || signal.aborted) return;
    const { sender, payload } = verified;
    if (rawId && (payload.via !== rawId || !rawPeers.has(rawId))) return;
    const first = !connected.has(sender);
    const learnedDirect = rawId && !direct.has(sender);
    if (rawId) {
      const recovered = stalled.delete(sender);
      direct.set(sender, rawId);
      if (learnedDirect) void advertiseDirect(rawId);
      if (learnedDirect || recovered) handlers.path?.(sender, 'direct');
    } else if (first || !direct.has(sender) || stalled.has(sender)) handlers.path?.(sender, 'relay');
    if (first) {
      connected.add(sender);
      handlers.up(sender);
      if (!rawId) void advertiseRelays(true);
    }
    if (payload.kind === 'packet' && payload.to === codec.id) handlers.message(sender, payload.packet);
  }

  async function deliver(peer, packet) {
    const rawId = direct.get(peer);
    const envelope = { kind: 'packet', to: peer, packet };
    if (rawId) envelope.via = await self;
    const event = await codec.seal(envelope);
    if (rawId && stalled.has(peer)) relays?.publish(event);
    if (rawId) {
      try { await action.send(event, { target: rawId }); return; }
      catch { enableRelays(); }
    }
    relays?.publish(event);
  }

  action?.onReceive(({ byteLength }) => byteLength <= 16_384);
  action?.onMessage((event, { userId }) => { void accept(event, userId); });
  room?.onUserJoin(({ userId }) => { rawPeers.add(userId); void advertiseDirect(userId); }, { replay: true });
  room?.onUserLeave(({ userId }) => {
    rawPeers.delete(userId);
    for (const [peer, id] of direct) {
      if (id !== userId) continue;
      direct.delete(peer);
      stalled.delete(peer);
      connected.delete(peer);
      handlers.down(peer);
      enableRelays();
      void advertiseRelays(true);
    }
  });
  room?.onError(error => {
    if (error.code === 'relay-failed') enableRelays();
    if (error.code === 'room-full' && !Object.keys(room.getUsers()).length) handlers.error('full');
  });
  const fallback = setTimeout(() => { if (!direct.size) enableRelays(); }, room ? 7000 : 0);
  const pulse = setInterval(() => {
    for (const userId of rawPeers) {
      const established = [...direct].some(([peer, id]) => id === userId && !stalled.has(peer));
      if (!established) void advertiseDirect(userId);
    }
    if (!direct.size || stalled.size) void advertiseRelays(stalled.size > 0);
  }, 4500);
  signal.addEventListener('abort', () => {
    clearTimeout(fallback); clearInterval(pulse);
    // Give an explicit leave packet a chance to reach an open data channel.
    const grace = new Promise(resolve => setTimeout(resolve, 250));
    void Promise.race([Promise.allSettled([...pending]), grace]).then(() => {
      relays?.close();
      return room?.leave();
    }).catch(() => {});
  }, { once: true });
  return {
    recover(peer) {
      if (!peer || !direct.has(peer) || stalled.has(peer) || signal.aborted) return;
      stalled.add(peer);
      enableRelays();
      void advertiseRelays(true);
    },
    send(peer, packet) {
      if (signal.aborted) return;
      const delivery = deliver(peer, packet).catch(() => {});
      pending.add(delivery);
      void delivery.finally(() => pending.delete(delivery));
    }
  };
}
