// Battle sounds, synthesised with Web Audio: no files to download, every sound a few oscillators
// and a burst of noise. `play(name, delayMs, strength)` schedules a sound on the audio clock, so it
// lands together with the animation that was scheduled with the same delay.

const NOTE = { C4: 261.6, D4: 293.7, E4: 329.6, G4: 392, A4: 440, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, C6: 1046.5, E6: 1318.5 };

export function makeSfx({ enabled = () => true, context = () => null } = {}) {
  let noiseBuffer = null;

  function noise(ctx) {
    if (noiseBuffer?.sampleRate === ctx.sampleRate) return noiseBuffer;
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  // One voice: an oscillator (or noise) through an optional filter and a short envelope.
  function voice(ctx, out, t, { type = 'sine', from = 440, to = from, dur = 0.15, gain = 0.2, attack = 0.006, filter = null, q = 1, filterTo = null, detune = 0 }) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src;
    if (type === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      src.loop = true;
    } else {
      src = ctx.createOscillator();
      src.type = type;
      src.frequency.setValueAtTime(from, t);
      if (to !== from) src.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
      src.detune.value = detune;
    }
    let node = src;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.Q.value = q;
      f.frequency.setValueAtTime(type === 'noise' ? from : filterTo ?? from * 2, t);
      if (type === 'noise' && to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
      node = node.connect(f);
    }
    node.connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  const notes = (ctx, out, t, list, { step = 0.09, type = 'triangle', dur = 0.16, gain = 0.14 } = {}) =>
    list.forEach((hz, i) => voice(ctx, out, t + i * step, { type, from: hz, dur, gain }));

  // Each sound: (ctx, out, t, strength 0..1).
  const SOUNDS = {
    hit: (c, o, t, s) => {
      voice(c, o, t, { type: 'sine', from: 170, to: 55, dur: 0.16, gain: 0.32 + 0.25 * s });
      voice(c, o, t, { type: 'noise', from: 2400, to: 500, filter: 'lowpass', dur: 0.09, gain: 0.16 + 0.14 * s });
    },
    strike: (c, o, t) => {
      voice(c, o, t, { type: 'sine', from: 210, to: 80, dur: 0.09, gain: 0.22 });
      voice(c, o, t, { type: 'noise', from: 3200, to: 900, filter: 'bandpass', q: 1.5, dur: 0.05, gain: 0.12 });
    },
    blocked: (c, o, t) => {
      voice(c, o, t, { type: 'square', from: 520, to: 480, dur: 0.12, gain: 0.07, filter: 'lowpass', filterTo: 1800 });
      voice(c, o, t + 0.01, { type: 'triangle', from: 1240, dur: 0.18, gain: 0.08 });
    },
    whoosh: (c, o, t) => voice(c, o, t, { type: 'noise', from: 500, to: 3000, filter: 'bandpass', q: 2.5, dur: 0.22, gain: 0.12, attack: 0.05 }),
    ultimate: (c, o, t) => {
      voice(c, o, t, { type: 'sawtooth', from: 110, to: 440, dur: 0.42, gain: 0.08, filter: 'lowpass', filterTo: 1600, attack: 0.12 });
      voice(c, o, t, { type: 'noise', from: 300, to: 4000, filter: 'bandpass', q: 1.2, dur: 0.45, gain: 0.1, attack: 0.15 });
      notes(c, o, t + 0.3, [NOTE.C5, NOTE.G5, NOTE.C6], { step: 0.06, gain: 0.09 });
    },
    guard: (c, o, t) => {
      voice(c, o, t, { type: 'triangle', from: 660, to: 640, dur: 0.28, gain: 0.12 });
      voice(c, o, t, { type: 'triangle', from: 990, to: 960, dur: 0.22, gain: 0.07 });
      voice(c, o, t, { type: 'noise', from: 4000, filter: 'highpass', dur: 0.05, gain: 0.05 });
    },
    switch: (c, o, t) => {
      voice(c, o, t, { type: 'noise', from: 700, to: 2600, filter: 'bandpass', q: 3, dur: 0.2, gain: 0.1, attack: 0.04 });
      voice(c, o, t + 0.16, { type: 'sine', from: 380, to: 760, dur: 0.12, gain: 0.12 });
    },
    burn: (c, o, t) => {
      voice(c, o, t, { type: 'noise', from: 900, to: 300, filter: 'lowpass', dur: 0.45, gain: 0.14, attack: 0.04 });
      for (let i = 0; i < 6; i++) voice(c, o, t + 0.04 + i * 0.06 + Math.random() * 0.03, { type: 'noise', from: 5000, filter: 'highpass', dur: 0.025, gain: 0.07 });
    },
    freeze: (c, o, t) => {
      notes(c, o, t, [NOTE.E6, NOTE.C6, NOTE.A5, NOTE.E6], { step: 0.05, type: 'sine', dur: 0.32, gain: 0.07 });
      voice(c, o, t, { type: 'noise', from: 7000, to: 4000, filter: 'highpass', dur: 0.3, gain: 0.04 });
    },
    sleep: (c, o, t) => notes(c, o, t, [NOTE.A4, NOTE.E4, NOTE.C4], { step: 0.16, type: 'sine', dur: 0.3, gain: 0.1 }),
    toxic: (c, o, t) => {
      for (let i = 0; i < 4; i++) voice(c, o, t + i * 0.07, { type: 'sine', from: 180 + i * 40, to: 420 + i * 60, dur: 0.07, gain: 0.1 });
    },
    leech: (c, o, t) => voice(c, o, t, { type: 'sawtooth', from: 520, to: 160, dur: 0.35, gain: 0.05, filter: 'lowpass', filterTo: 1200 }),
    heal: (c, o, t) => notes(c, o, t, [NOTE.C5, NOTE.E5, NOTE.G5], { step: 0.07, type: 'sine', dur: 0.2, gain: 0.1 }),
    buff: (c, o, t) => notes(c, o, t, [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5], { step: 0.05, type: 'square', dur: 0.1, gain: 0.04 }),
    debuff: (c, o, t) => voice(c, o, t, { type: 'square', from: 420, to: 140, dur: 0.3, gain: 0.05, filter: 'lowpass', filterTo: 900 }),
    shield: (c, o, t) => {
      voice(c, o, t, { type: 'triangle', from: 300, to: 600, dur: 0.25, gain: 0.1 });
      voice(c, o, t + 0.08, { type: 'sine', from: 900, dur: 0.25, gain: 0.06 });
    },
    shatter: (c, o, t) => {
      voice(c, o, t, { type: 'noise', from: 6000, to: 2500, filter: 'highpass', dur: 0.22, gain: 0.12 });
      notes(c, o, t, [2100, 2700, 1800], { step: 0.03, type: 'triangle', dur: 0.12, gain: 0.05 });
    },
    tick: (c, o, t) => voice(c, o, t, { type: 'sine', from: 330, to: 250, dur: 0.08, gain: 0.08 }),
    skip: (c, o, t) => notes(c, o, t, [NOTE.D4, NOTE.C4], { step: 0.1, type: 'triangle', dur: 0.12, gain: 0.07 }),
    growl: (c, o, t) => voice(c, o, t, { type: 'sawtooth', from: 85, to: 70, dur: 0.5, gain: 0.09, filter: 'lowpass', filterTo: 500, attack: 0.08 }),
    faint: (c, o, t) => {
      voice(c, o, t, { type: 'sawtooth', from: 440, to: 70, dur: 0.6, gain: 0.07, filter: 'lowpass', filterTo: 1400 });
      voice(c, o, t + 0.5, { type: 'sine', from: 120, to: 45, dur: 0.25, gain: 0.3 });
    },
    win: (c, o, t) => {
      notes(c, o, t, [NOTE.C5, NOTE.E5, NOTE.G5], { step: 0.11, gain: 0.13 });
      voice(c, o, t + 0.34, { type: 'triangle', from: NOTE.C6, dur: 0.6, gain: 0.14 });
      voice(c, o, t + 0.34, { type: 'sine', from: NOTE.G5, dur: 0.6, gain: 0.08 });
    },
    lose: (c, o, t) => notes(c, o, t, [NOTE.G4, NOTE.E4, NOTE.D4, NOTE.C4 * 0.94], { step: 0.18, type: 'triangle', dur: 0.32, gain: 0.12 }),
    draw: (c, o, t) => notes(c, o, t, [NOTE.E5, NOTE.E5], { step: 0.2, type: 'triangle', dur: 0.2, gain: 0.1 }),
    start: (c, o, t) => notes(c, o, t, [NOTE.C5, NOTE.G5], { step: 0.12, type: 'square', dur: 0.12, gain: 0.05 }),
  };

  // Loudness per sound, measured offline (peak of each rendered sound), so that every effect is
  // about as loud as a hit and the quiet beats (swing, tick) sit under it.
  const LEVEL = { hit: 2.6, strike: 3.6, blocked: 6, whoosh: 9, ultimate: 5, guard: 5, switch: 3, burn: 4.5, freeze: 3.5,
    sleep: 3.5, toxic: 3.5, leech: 18, heal: 3.5, buff: 8, debuff: 14, shield: 5, shatter: 6, tick: 6, skip: 3,
    growl: 4.5, faint: 1.6, win: 2.3, lose: 3.5, draw: 3.5, start: 6 };
  // One compressor per audio context: sounds that overlap stay clean instead of clipping.
  const buses = new WeakMap();
  function bus(ctx) {
    let node = buses.get(ctx);
    if (!node) {
      node = ctx.createDynamicsCompressor?.() ?? ctx.createGain();
      if (node.threshold) { node.threshold.value = -6; node.ratio.value = 4; node.knee.value = 6; node.attack.value = 0.005; node.release.value = 0.15; }
      node.connect(ctx.destination);
      buses.set(ctx, node);
    }
    return node;
  }

  function play(name, delayMs = 0, strength = 0.5) {
    if (!enabled()) return;
    const ctx = context();
    const sound = SOUNDS[name];
    if (!ctx || ctx.state !== 'running' || !sound) return;
    try {
      const out = ctx.createGain();
      out.gain.value = 0.7 * (LEVEL[name] ?? 1);
      out.connect(bus(ctx));
      sound(ctx, out, ctx.currentTime + Math.max(0, delayMs) / 1000, Math.max(0, Math.min(1, strength)));
    } catch {}
  }

  return { play, names: Object.keys(SOUNDS) };
}
