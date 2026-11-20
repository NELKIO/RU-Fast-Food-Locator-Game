// Battle sounds: every sound builds a valid Web Audio graph, lands at the asked time, and stays
// silent when the sound is off or the audio is not running yet.
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSfx } from '../public/js/sfx.js';

function fakeContext() {
  const log = { started: [], connected: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime(v) { assert.ok(v > 0, 'exponential ramps need a positive value'); } });
  const node = extra => ({ connect(next) { log.connected++; return next; }, ...extra });
  const ctx = {
    state: 'running', currentTime: 10, sampleRate: 8000, destination: node(),
    createGain: () => node({ gain: param() }),
    createOscillator: () => node({ type: 'sine', frequency: param(), detune: param(), start: t => log.started.push(t), stop() {} }),
    createBufferSource: () => node({ buffer: null, loop: false, start: t => log.started.push(t), stop() {} }),
    createBiquadFilter: () => node({ type: 'lowpass', Q: param(), frequency: param() }),
    createBuffer: (ch, len, rate) => ({ sampleRate: rate, getChannelData: () => new Float32Array(len) }),
  };
  return { ctx, log };
}

test('every battle sound plays at the time of its animation beat', () => {
  const { ctx, log } = fakeContext();
  const sfx = makeSfx({ context: () => ctx });
  for (const name of sfx.names) {
    log.started.length = 0;
    sfx.play(name, 500, 0.7);
    assert.ok(log.started.length > 0, name + ' makes a sound');
    assert.ok(log.started.every(t => t >= 10.5 - 1e-9), name + ' waits for its beat');
  }
  for (const name of ['hit', 'strike', 'switch', 'guard', 'ultimate', 'faint', 'win', 'lose', 'draw', 'freeze', 'sleep', 'burn', 'toxic', 'leech', 'heal'])
    assert.ok(sfx.names.includes(name), name);
});

test('no sound when it is switched off, the audio is not running yet, or the name is unknown', () => {
  const { ctx, log } = fakeContext();
  let on = false;
  const sfx = makeSfx({ enabled: () => on, context: () => ctx });
  sfx.play('hit');
  assert.equal(log.started.length, 0);
  on = true;
  ctx.state = 'suspended';
  sfx.play('hit');
  assert.equal(log.started.length, 0);
  ctx.state = 'running';
  sfx.play('nope');
  assert.equal(log.started.length, 0);
  assert.doesNotThrow(() => makeSfx({ context: () => null }).play('hit'));
});
