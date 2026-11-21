import test from 'node:test';
import assert from 'node:assert/strict';
import {GPS_RULES, INITIAL_GPS_TRACK, freshProfile, updateGpsTrack, visitStatus} from '../public/js/game.js';

const start = 1_800_000_000_000;
// Offsets in metres from an invented point in the Pacific.
function sample(north, elapsed, accuracy = 8) {
  return {lat: -10 + north / 111_200, lon: -140, accuracy, timestamp: start + elapsed};
}

const update = (track, position, now = position.timestamp) => updateGpsTrack(track, position, now);
const initial = () => update(INITIAL_GPS_TRACK, sample(0, 0));

function assertFix(track, expected, status = 'ready') {
  assert.equal(track.status, status);
  assert.deepEqual([track.fix.lat, track.fix.lon, track.fix.timestamp], [expected.lat, expected.lon, expected.timestamp]);
  if (status === 'ready') assert.equal(track.candidate, null);
}

test('the first browser fix, a short walk and ordinary road travel update the map immediately', () => {
  const here = sample(0, 0);
  const browser = {coords: {latitude: here.lat, longitude: here.lon, accuracy: here.accuracy}, timestamp: here.timestamp};
  const first = update(INITIAL_GPS_TRACK, browser);
  const step = sample(9, 5_000);
  const walk = update(first, step);
  for (const delayed of [sample(28, 4_000), sample(35, 5_000)]) {
    assertFix(update(walk, delayed, start + 6_000), step);
  }
  const ride = sample(340, 35_000);
  assertFix(update(walk, ride), ride);
  assertFix(walk, step);
  assertFix(first, here);
  assert.equal(INITIAL_GPS_TRACK.status, 'empty');
  assert.equal(INITIAL_GPS_TRACK.fix, null);
});

test('a jump holds the map until a second independent sample confirms the new area', () => {
  const jump = sample(1_000, 2_000);
  let track = update(initial(), jump);
  assertFix(track, sample(0, 0), 'confirming');
  assert.equal(track.candidate.lat, jump.lat);
  for (const elapsed of [2_000, 1_500, 2_000 + GPS_RULES.minConfirmationMs - 1]) {
    track = update(track, sample(1_010, elapsed), start + 2_000 + GPS_RULES.minConfirmationMs);
    assertFix(track, sample(0, 0), 'confirming');
  }
  const confirmed = sample(1_020, 2_000 + GPS_RULES.minConfirmationMs);
  assertFix(update(track, confirmed), confirmed);
});

test('returning to the original location cancels a one-off jump', () => {
  const pending = update(initial(), sample(1_300, 2_000));
  const back = sample(5, 4_000);
  assertFix(update(pending, back), back);
});

test('a reading in a third location starts a new confirmation window', () => {
  const pending = update(initial(), sample(1_000, 2_000, 90));
  const next = update(pending, sample(1_160, 5_000, 90));
  assertFix(next, sample(0, 0), 'confirming');
  const confirmed = sample(1_170, 8_000);
  assertFix(update(next, confirmed), confirmed);
});

test('two nearby readings with overlapping uncertainty can confirm on the last allowed millisecond', () => {
  const pending = update(initial(), sample(2_000, 2_000, 60));
  const confirmed = sample(2_090, 2_000 + GPS_RULES.confirmationWindowMs, 60);
  assertFix(update(pending, confirmed), confirmed);
});

test('a long pause and an expired candidate cannot independently confirm a distant location', () => {
  const elapsed = GPS_RULES.maxAgeMs * 3;
  const pending = update(initial(), sample(8_000, elapsed));
  assertFix(pending, sample(0, 0), 'confirming');
  const later = elapsed + GPS_RULES.confirmationWindowMs + 1;
  const expired = update(pending, sample(8_010, later));
  assertFix(expired, sample(0, 0), 'confirming');
  const fresh = sample(8_020, later + GPS_RULES.minConfirmationMs);
  assertFix(update(expired, fresh), fresh);
});

test('a coarse first estimate cannot prove a visit or prevent the first reliable fix', () => {
  const rough = sample(3_000, 0, GPS_RULES.maxAccuracy + 1);
  const track = update(INITIAL_GPS_TRACK, rough);
  const venue = {id: 'synthetic:1', brand: 'bk', lat: rough.lat, lon: rough.lon};
  assert.equal(track.status, 'inaccurate');
  assert.equal(visitStatus(freshProfile(), venue, track.fix, rough.timestamp).ok, false);
  const reliable = sample(0, 1_000, GPS_RULES.maxAccuracy);
  assertFix(update(track, reliable), reliable);
});

test('a noisy reading keeps the last reliable position and cannot refresh its collection eligibility', () => {
  const now = start + GPS_RULES.maxAgeMs + 1;
  const noisy = sample(500, now - start, 900);
  const track = update(initial(), noisy);
  assertFix(track, sample(0, 0), 'inaccurate');
  const venue = {id: 'synthetic:2', brand: 'bk', ...sample(0, 0)};
  assert.equal(visitStatus(freshProfile(), venue, track.fix, now).reason, 'stale');
});

test('a stale or future sample cannot place the player or block the next fresh sample', () => {
  for (const offset of [-GPS_RULES.maxAgeMs - 1, GPS_RULES.futureToleranceMs + 1]) {
    const stale = update(INITIAL_GPS_TRACK, sample(2_000, offset), start);
    assert.equal(stale.status, 'stale');
    assert.equal(stale.fix, null);
    const here = sample(0, 0);
    assertFix(update(stale, here), here);
  }
  const limit = sample(0, -GPS_RULES.maxAgeMs);
  assertFix(update(INITIAL_GPS_TRACK, limit, start), limit);
});
