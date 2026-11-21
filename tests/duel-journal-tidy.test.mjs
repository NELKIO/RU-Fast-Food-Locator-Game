// Saved duels leave the list by themselves: a delivered and credited result after a day, anything
// untouched for a week, an empty seat of a room nobody joined after an hour. Unfinished ones stay.
import assert from 'node:assert/strict';
import test from 'node:test';

test('saved duels: which ones the arena tidies away', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  const { settled } = await import('../public/js/duels.js');
  const now = Date.UTC(2026, 10, 22, 12), hour = 3600_000;
  const done = { winner: 0, peerHasFinal: true, history: ['hit'], matchId: 'm-1' };
  assert.equal(settled({ updatedAt: now - 2 * hour, awarded: true, snapshot: done }, now), false, 'a fresh result can still be opened');
  assert.equal(settled({ updatedAt: now - 25 * hour, awarded: true, snapshot: done }, now), true, 'a day later it goes');
  assert.equal(settled({ updatedAt: now - 25 * hour, awarded: false, snapshot: done }, now), false, 'not credited yet: it stays');
  assert.equal(settled({ updatedAt: now - 25 * hour, awarded: true, snapshot: { ...done, peerHasFinal: false } }, now), false, 'not delivered yet: it stays');
  assert.equal(settled({ updatedAt: now - 3 * 24 * hour, awarded: false, snapshot: { winner: null, history: ['hit'], matchId: 'm-2' } }, now), false, 'a paused duel stays for a week');
  assert.equal(settled({ updatedAt: now - 8 * 24 * hour, awarded: false, snapshot: { winner: null, history: ['hit'], matchId: 'm-2' } }, now), true);
  assert.equal(settled({ updatedAt: now - 2 * hour, snapshot: null }, now), true, 'an empty seat of a room nobody joined');
  assert.equal(settled({ updatedAt: now - 10 * 60_000, snapshot: null }, now), false);
});
