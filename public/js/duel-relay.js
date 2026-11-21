// NIP-01 ephemeral events. A room-scoped AES-GCM key keeps even the fallback
// match private. The signed sender ID persists across relay/WebRTC handovers.
export const RELAY_KIND = 28791;
export const FINAL_KIND = 30078;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = bytes => Array.from(bytes, octet => octet.toString(16).padStart(2, '0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g) || [], pair => parseInt(pair, 16));
const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const canonical = e => JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);

export async function makeCodec(code, schnorr, signingSecret) {
  const topic = hex(await hash('foodradar:duel:topic:1:' + code));
  const secret = await hash('foodradar:duel:aes:1:' + code);
  const key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const secretKey = signingSecret ? bytes(signingSecret) : schnorr.keygen().secretKey;
  const id = hex(schnorr.getPublicKey(secretKey));
  const seen = new Map();
  async function encrypt(message, kind, tags) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(message))
    ));
    const event = {
      kind, pubkey: id, created_at: Math.floor(Date.now() / 1000), tags,
      content: btoa(String.fromCharCode(...iv, ...encrypted))
    };
    const digest = await hash(canonical(event));
    return { ...event, id: hex(digest), sig: hex(await schnorr.signAsync(digest, secretKey)) };
  }
  async function decrypt(event, kind, tag, value) {
    if (!event || event.kind !== kind || event.pubkey === id || !Number.isSafeInteger(event.created_at) ||
        !/^[a-f\d]{64}$/.test(event.pubkey) || !/^[a-f\d]{64}$/.test(event.id) || !/^[a-f\d]{128}$/.test(event.sig) ||
        !Array.isArray(event.tags) || event.tags.length !== 1 || !Array.isArray(event.tags[0]) ||
        event.tags[0].length !== 2 || event.tags[0][0] !== tag || event.tags[0][1] !== value ||
        typeof event.content !== 'string' || event.content.length > 12_000) return null;
    try {
      const digest = await hash(canonical(event));
      if (event.id !== hex(digest) || !await schnorr.verifyAsync(bytes(event.sig), digest, bytes(event.pubkey))) return null;
      const body = Uint8Array.from(atob(event.content), ch => ch.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: body.subarray(0, 12)}, key, body.subarray(12));
      return JSON.parse(decoder.decode(plain));
    } catch { return null; }
  }
  const seal = message => encrypt(message, RELAY_KIND, [['x', topic]]);
  async function open(event) {
    if (!event || Math.abs(Date.now() / 1000 - event.created_at) > 90 || seen.has(event.id)) return null;
    const payload = await decrypt(event, RELAY_KIND, 'x', topic);
    if (!payload || (payload.to !== null && payload.to !== id) || !['presence', 'packet'].includes(payload.kind) ||
        seen.has(event.id)) return null;
    seen.set(event.id, event.created_at);
    if (seen.size > 512) seen.delete(seen.keys().next().value);
    return {sender: event.pubkey, payload};
  }
  // One address per match and author. Relays see neither the room code nor either team's moves.
  const finalTag = async matchId => hex(await hash('foodradar:duel:final:5:' + topic + ':' + matchId));
  async function sealFinal(to, packet) {
    return encrypt({to, packet}, FINAL_KIND, [['d', await finalTag(packet.matchId)]]);
  }
  async function openFinal(event, peer, matchId) {
    if (event?.pubkey !== peer) return null;
    const payload = await decrypt(event, FINAL_KIND, 'd', await finalTag(matchId));
    return payload?.to === id && payload.packet?.kind === 'state' && payload.packet.matchId === matchId
      ? payload.packet : null;
  }
  return {id, topic, seal, open, finalTag, sealFinal, openFinal};
}

export function openRelays(urls, topic, receive, onOpen, onUnavailable) {
  let closed = false, warned = false;
  const links = new Map();
  const retry = new Set();
  const attempted = new Set();
  const sub = 'foodradar-' + topic.slice(0, 10);
  function available() {
    return [...links.values()].some(socket => socket.readyState === WebSocket.OPEN);
  }
  function open(url) {
    if (closed) return;
    const socket = new WebSocket(url);
    links.set(url, socket);
    socket.onopen = () => {
      warned = false;
      attempted.add(url);
      socket.send(JSON.stringify(['REQ', sub, { kinds: [RELAY_KIND], '#x': [topic], since: Math.floor(Date.now() / 1000) - 20 }]));
      onOpen();
    };
    socket.onmessage = ({ data }) => {
      if (closed || typeof data !== 'string' || data.length > 16_384) return;
      try {
        const message = JSON.parse(data);
        if (Array.isArray(message) && message[0] === 'EVENT' && message[1] === sub) void receive(message[2]);
      } catch { /* Non-NIP-01 response from an external endpoint. */ }
    };
    socket.onerror = () => {}; // The browser also emits close for failed handshakes.
    socket.onclose = () => {
      if (closed) return;
      attempted.add(url);
      if (attempted.size === urls.length && !available() && !warned) { warned = true; onUnavailable(); }
      const timer = setTimeout(() => { retry.delete(timer); open(url); }, 5500);
      retry.add(timer);
    };
  }
  urls.forEach(open);
  return {
    publish(event) {
      if (closed) return;
      const command = JSON.stringify(['EVENT', event]);
      for (const socket of links.values()) {
        if (socket.readyState === WebSocket.OPEN) socket.send(command);
      }
    },
    close() {
      closed = true;
      for (const timer of retry) clearTimeout(timer);
      for (const socket of links.values()) socket.close();
      links.clear(); retry.clear();
    }
  };
}
