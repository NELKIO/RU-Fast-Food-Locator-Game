import assert from 'node:assert/strict';
import test from 'node:test';
import { watchGps } from '../public/js/gps-watch.js';

function openWatch(initialCandidate) {
  let stream;
  const requests = [], cleared = [], readings = [], errors = [];
  const geo = {
    watchPosition(success, error) {
      stream = { success, error };
      return 17;
    },
    getCurrentPosition(success, error, options) {
      requests.push({ success, error, options });
    },
    clearWatch(id) { cleared.push(id); },
  };
  const stop = watchGps(geo, (reading) => {
    readings.push(reading);
    return reading.candidate;
  }, (error) => errors.push(error), initialCandidate);
  return { stream, requests, cleared, readings, errors, stop };
}

test('a persistent jump requests one uncached position after 1.5 seconds and a brief jump requests none', (t) => {
  const clock = t.mock.timers;
  clock.enable({ apis: ['setTimeout'] });
  const { stream, requests } = openWatch();
  stream.success({ candidate: null });
  clock.tick(2_000);
  assert.equal(requests.length, 0);

  const jump = {};
  stream.success({ candidate: jump });
  clock.tick(1_000);
  stream.success({ candidate: jump });
  clock.tick(499);
  assert.equal(requests.length, 0);
  clock.tick(1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.maximumAge, 0);
  requests[0].success({ candidate: jump });
  clock.tick(3_000);
  assert.equal(requests.length, 1);

  stream.success({ candidate: {} });
  clock.tick(1_499);
  stream.success({ candidate: null });
  clock.tick(2_000);
  assert.equal(requests.length, 1);
});

test('a replaced candidate discards its pending success or error and the new candidate can confirm', (t) => {
  const clock = t.mock.timers;
  clock.enable({ apis: ['setTimeout'] });
  for (const callback of ['success', 'error']) {
    const { stream, requests, readings, errors, stop } = openWatch({});
    clock.tick(1_500);
    assert.equal(requests.length, 1);
    const replacement = { candidate: {} };
    stream.success(replacement);
    requests[0][callback](callback === 'success' ? { candidate: null } : { code: 3 });
    assert.deepEqual(readings, [replacement]);
    assert.deepEqual(errors, []);

    clock.tick(1_500);
    assert.equal(requests.length, 2);
    const confirmed = { candidate: null };
    requests[1].success(confirmed);
    assert.deepEqual(readings, [replacement, confirmed]);
    clock.tick(2_000);
    assert.equal(requests.length, 2);
    stop();
  }
});

test('stopping cancels the timer and silences late stream and one-shot callbacks', (t) => {
  const clock = t.mock.timers;
  clock.enable({ apis: ['setTimeout'] });
  const waiting = openWatch({});
  clock.tick(1_499);
  waiting.stop();
  clock.tick(1);
  assert.deepEqual(waiting.cleared, [17]);
  assert.equal(waiting.requests.length, 0);

  const inFlight = openWatch({});
  clock.tick(1_500);
  assert.equal(inFlight.requests.length, 1);
  inFlight.stop();
  inFlight.stream.success({ candidate: {} });
  inFlight.stream.error({ code: 1 });
  inFlight.requests[0].success({ candidate: {} });
  clock.tick(2_000);
  assert.deepEqual(inFlight.cleared, [17]);
  assert.deepEqual(inFlight.readings, []);
  assert.deepEqual(inFlight.errors, []);
  assert.equal(inFlight.requests.length, 1);
});
