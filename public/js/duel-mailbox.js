// The live transport is ephemeral. Only a finished replay is also offered to a store-and-forward
// relay, so a returning opponent can verify it even if the last mover has already left.
import {FINAL_KIND} from './duel-relay.js';
import {publishEvent, queryRelays} from './sync.js';

export function createDuelMailbox(codec, relays, onArchive, {publish = publishEvent, query = queryRelays, now = Date.now} = {}) {
  let stored = false, writing = false, reading = false;
  let nextWrite = 0, nextRead = 0, readDelay = 10_000, event = null;
  return {
    async checkpoint(peer, packet) {
      if (stored || writing || now() < nextWrite) return;
      writing = true;
      nextWrite = now() + 15_000;
      try {
        event ??= await codec.sealFinal(peer, packet);
        const copies = await publish(event, {relays});
        stored = copies >= Math.max(1, Math.min(3, relays.length));
        if (copies) nextWrite = now() + 60_000;
      } finally { writing = false; }
    },
    async lookup(peer, matchId) {
      if (reading || now() < nextRead) return;
      reading = true;
      // A peer may return days later. Space out empty lookups while this window stays open.
      nextRead = now() + readDelay;
      readDelay = Math.min(60_000, readDelay * 2);
      try {
        const tag = await codec.finalTag(matchId);
        const {events} = await query({kinds: [FINAL_KIND], authors: [peer], '#d': [tag], limit: 1}, {relays});
        for (const event of events) {
          const packet = await codec.openFinal(event, peer, matchId);
          if (packet && onArchive(peer, packet)) break;
        }
      } finally { reading = false; }
    },
  };
}
