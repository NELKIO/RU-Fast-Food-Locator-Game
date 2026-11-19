// What every move looks like. Each fighter has its own signature skill animation and its own
// basic attack; the status effects the engine reports (burn, shield, drain…) are layered on top
// automatically, timed from the moment the main blow lands.
//
// A recipe is a list of steps for battle-fx.js. Anchors: 'src' is the fighter who moves,
// 'tgt' is the one on the other side. The first step marked `hit` decides when the target
// flinches, the damage number pops and the health bar slides.
import { fxTiming } from './battle-fx.js';

const FIRE = ['#fff1a1', '#ffb52e', '#ff7a1a', '#ff3d12'];
const CHEESE = ['#ffe36e', '#ffd23f', '#ffc21a', '#fff3b0'];
const GOLD = ['#fff6c2', '#ffd76a', '#f2b233'];
const CRUMB = ['#e9b04f', '#d48c2c', '#f6d27a'];
const ICE = ['#e8f8ff', '#a9e4ff', '#6cc9ff'];
const COLA = ['#3a1a0c', '#6b2f14', '#8e4420'];
const SAUCE = ['#ff9a1f', '#ffb84d', '#e96a12'];
const CREAM = ['#fffaf0', '#fff0cc', '#f6e2b0'];
const HERB = ['#4fbf5a', '#2f9a3c', '#9be07a'];
const BERRY = ['#ff4d6d', '#d8274f', '#a0102e'];
const SUGAR = ['#ffffff', '#ffe9f3', '#fff7d6'];
const STEEL = ['#ffffff', '#dfe8f0', '#b8c7d6'];
const SPICE = ['#ff3b2f', '#ff7a1a', '#b81d12', '#ffd166'];
const HEAL = ['#8ff0b0', '#c9ffd9', '#5fd98a'];
const PASTEL = ['#ffb3cf', '#b8e2ff', '#c9f2b0', '#ffe3a3', '#d9c2ff'];
const CHOCO = ['#5a2d17', '#7a3f1f', '#3d1d0e'];
const SMOKE = ['rgba(90,70,60,.55)', 'rgba(130,110,95,.45)', 'rgba(60,45,40,.5)'];

const BRAND = {
  bk: { main: '#ff8732', glow: '#ffb15c', shield: '#ffb15c' },
  vkusno: { main: '#ffbc0d', glow: '#ffd75a', shield: '#7fdc8a' },
  rostics: { main: '#ff3347', glow: '#ff7a86', shield: '#ff8f9a' },
  dodo: { main: '#ff7a1a', glow: '#ffb067', shield: '#ffcf66' },
};

// ------------------------------------------------------------------------------ building blocks
// The blow itself: a flash, a shockwave, sparks and a shake. `big` is for legendaries.
function impact(colors, o = {}) {
  const big = o.big ? 1.5 : 1;
  return [
    { type: 'flash', at: o.at ?? 'tgt', color: colors[0], alpha: 0.55 * big, size: 2.2 * big, dur: 260 },
    { type: 'ring', at: o.at ?? 'tgt', color: colors[1] ?? colors[0], width: 6 * big, dur: 420 * big },
    { type: 'burst', at: o.at ?? 'tgt', shape: 'spark', colors, count: Math.round((o.count ?? 16) * big), speed: [220, 520 * big], life: [260, 520], size: [2.5, 4.5], drag: 3 },
    ...(o.debris ? [{ type: 'burst', at: o.at ?? 'tgt', shape: o.debris, colors: o.debrisColors, count: o.debrisCount ?? 8, speed: [120, 340], life: [500, 850], size: o.debrisSize ?? [4, 7], gravity: 700, spin: [-9, 9] }] : []),
    { type: 'shake', mag: (o.shake ?? 6) * big, dur: 320 * big },
  ];
}

// Gathering power around the fighter before a signature move.
const charge = (colors, t = 0, o = {}) => ({ type: 'charge', at: 'src', t, colors, dur: o.dur ?? 420, count: o.count ?? 20, shape: o.shape ?? 'spark' });

// A thrown piece of food with impact on arrival.
function toss(shape, o = {}) {
  return {
    type: 'projectile', t: o.t ?? 0, shape, colors: o.colors, size: o.size ?? 13, travel: o.travel ?? 420,
    arc: o.arc ?? 0.16, lob: o.lob ?? 0, spin: o.spin ?? 9, face: o.face, faceOffset: o.faceOffset,
    count: o.count, gap: o.gap, fan: o.fan, spread: o.spread, alternate: o.alternate, grow: o.grow, halo: o.halo,
    ease: o.ease, trail: o.trail, hit: o.hit ?? true, hitOnce: o.hitOnce, hitLast: o.hitLast,
    onHit: o.onHit ?? impact(o.impact ?? FIRE, { debris: o.debris, debrisColors: o.debrisColors, count: o.sparks }),
  };
}

const later = (t, steps) => steps.map((s) => ({ ...s, t: t + (s.t ?? 0) }));

// ------------------------------------------------------------------------------ basic attacks
// Short and snappy, about 0.7 s, so plain hits do not slow the fight down.
const throwBasic = (shape, colors, o = {}) => [toss(shape, { size: 12, travel: 380, impact: colors, sparks: 12, ...o })];
const slashBasic = (color, colors, o = {}) => [
  { type: 'slash', t: 120, at: 'tgt', color, count: o.count ?? 2, cross: o.cross, width: 6, len: 1.4, hit: true, gap: 60 },
  ...later(120, impact(colors, { count: 10, debris: o.debris, debrisColors: o.debrisColors })),
];

const BASIC = {
  'bk-angus-parmigiano': () => throwBasic('patty', FIRE, { size: 15, spin: 6, trail: { shape: 'smoke', colors: SMOKE, size: [5, 9], size2: 14, life: [300, 500], rate: 50 }, debris: 'cheese', debrisColors: CHEESE }),
  'bk-whopper': () => throwBasic('bun', FIRE, { size: 14, spin: 5, trail: { shape: 'flame', colors: FIRE, size: [4, 7], size2: 1, rate: 55 }, debris: 'seed' }),
  'bk-double-whopper': () => [
    { type: 'slash', t: 100, at: 'tgt', color: '#ffb15c', count: 2, cross: true, width: 7, len: 1.5, hit: true, gap: 110 },
    ...later(100, impact(FIRE, { count: 10, debris: 'crumb', debrisColors: CRUMB })),
    ...later(210, impact(FIRE, { count: 8, shake: 4 })),
  ],
  'bk-chicken-parmesan': () => slashBasic('#ffe36e', CHEESE, { count: 1, debris: 'crumb', debrisColors: CRUMB }),
  'bk-onion-rings': () => throwBasic('onion', CRUMB, { size: 13, spin: 14, arc: 0.3 }),
  'bk-fries': () => throwBasic('fry', ['#fff3b0', '#ffd45a'], { size: 12, travel: 300, face: true, faceOffset: Math.PI / 2, spin: 0, debris: 'fry', debrisSize: [5, 7] }),
  'bk-cheese-sauce': () => throwBasic('drop', CHEESE, { size: 8, count: 5, gap: 45, fan: 8, spread: 18, colors: CHEESE, spin: 0, face: true, faceOffset: Math.PI / 2, hitOnce: true, debris: 'splat', debrisColors: CHEESE }),
  'bk-shrimps': () => [
    toss('shrimp', { size: 12, travel: 360, impact: SAUCE, onHit: [] }),
    { type: 'slash', t: 360, at: 'tgt', color: '#ff9a5a', count: 2, cross: true, width: 5, len: 0.9, gap: 40 },
    ...later(360, impact(SAUCE, { count: 10 })),
  ],
  'bk-cola-04': () => throwBasic('drop', COLA, { size: 9, count: 3, gap: 60, fan: 6, spread: 14, colors: COLA, spin: 0, face: true, faceOffset: Math.PI / 2, hitOnce: true, impact: ICE, debris: 'bubble', debrisColors: ICE }),
  'bk-cola-05': () => [
    { type: 'beam', t: 80, shape: 'drop', colors: COLA, size: [5, 8], size2: 6, dur: 320, rate: 70, speed: [800, 950], spread: 0.06, hit: true },
    ...later(340, impact(ICE, { count: 10, debris: 'bubble', debrisColors: ICE })),
  ],
  'bk-cola-08': () => throwBasic('cube', ICE, { size: 11, count: 3, gap: 70, fan: 10, spread: 16, colors: ICE, spin: 10, hitOnce: true, impact: ICE, debris: 'shard', debrisColors: ICE }),
  'bk-shrimp-roll': () => throwBasic('roll', SAUCE, { size: 12, spin: 16, impact: SAUCE, debris: 'shrimp', debrisSize: [4, 6] }),
  'bk-sundae': () => throwBasic('drop', CHOCO, { size: 8, count: 3, gap: 55, fan: 6, spread: 14, colors: CHOCO, spin: 0, face: true, faceOffset: Math.PI / 2, hitOnce: true, impact: CREAM, debris: 'splat', debrisColors: CHOCO }),
  'bk-cheese-medallions': () => throwBasic('medallion', CHEESE, { size: 12, spin: 12, arc: 0.24, debris: 'crumb', debrisColors: CRUMB }),

  'vkusno-double-cheeseburger': () => [
    toss('cheese', { t: 0, size: 11, count: 2, gap: 110, alternate: true, arc: 0.22, spin: 8, travel: 360, hitOnce: true, colors: CHEESE, impact: CHEESE, sparks: 10 }),
  ],
  'vkusno-caesar-roll': () => throwBasic('leaf', HERB, { size: 12, spin: 10, colors: HERB, impact: HERB, debris: 'cube', debrisColors: ['#e8c27a', '#d9a85a'], debrisSize: [3, 4] }),
  'vkusno-chocolate-cake': () => throwBasic('crumb', CHOCO, { size: 7, count: 5, gap: 40, fan: 8, spread: 18, spin: 10, hitOnce: true, colors: CHOCO, impact: CREAM }),
  'vkusno-big-hit': () => throwBasic('patty', FIRE, { size: 16, spin: 4, lob: 0.15, trail: { shape: 'smoke', colors: SMOKE, size: [4, 8], size2: 12, rate: 40 } }),
  'vkusno-grand': () => slashBasic('#ffd75a', GOLD, { count: 1, debris: 'seed' }),
  'vkusno-chicken-premier': () => slashBasic('#fff3b0', CRUMB, { count: 2, cross: true, debris: 'crumb', debrisColors: CRUMB }),
  'vkusno-big-special': () => throwBasic('drop', SAUCE, { size: 10, spin: 0, face: true, faceOffset: Math.PI / 2, colors: SAUCE, impact: SAUCE, debris: 'splat', debrisColors: SAUCE }),
  'vkusno-chicken-hit': () => throwBasic('drumstick', CRUMB, { size: 12, spin: 12 }),
  'vkusno-nuggets': () => throwBasic('nugget', CRUMB, { size: 12, spin: 8, debris: 'crumb', debrisColors: CRUMB }),
  'vkusno-pie': () => throwBasic('drop', BERRY, { size: 8, count: 3, gap: 50, fan: 6, spread: 16, colors: BERRY, spin: 0, face: true, faceOffset: Math.PI / 2, hitOnce: true, impact: BERRY, debris: 'splat', debrisColors: BERRY }),
  'vkusno-macarons': () => throwBasic('macaron', PASTEL, { size: 11, spin: 10, colors: PASTEL, impact: SUGAR, debris: 'sugar', debrisColors: SUGAR }),

  'rostics-chefburger-junior': () => throwBasic('bun', SPICE, { size: 11, spin: 8, impact: SPICE, debris: 'seed' }),
  'rostics-fries': () => throwBasic('fry', ['#fff3b0', '#ffd45a'], { size: 12, count: 2, gap: 70, travel: 300, face: true, faceOffset: Math.PI / 2, spin: 0, hitOnce: true, debris: 'fry', debrisSize: [5, 7] }),
  'rostics-ice-cream-cone': () => throwBasic('cone', ICE, { size: 12, spin: 7, impact: ICE, debris: 'twinkle', debrisColors: ICE }),
  'rostics-chefburger': () => slashBasic('#ffffff', STEEL, { count: 2, cross: true }),
  'rostics-boxmaster': () => [
    { type: 'burst', t: 140, at: 'tgt', shape: 'star', colors: ['#fff', '#ffd166'], count: 6, speed: [160, 300], life: [300, 500], size: [5, 8], hit: true },
    ...later(140, impact(['#fff', '#ff3347'], { count: 12 })),
  ],
  'rostics-wings': () => throwBasic('wing', SPICE, { size: 12, spin: 11, trail: { shape: 'spark', colors: SPICE, size: [2, 3], rate: 60 }, impact: SPICE }),
  'rostics-twister': () => throwBasic('roll', CREAM, { size: 11, spin: 18, impact: CREAM, debris: 'leaf', debrisColors: HERB }),
  'rostics-basket': () => throwBasic('basket', CRUMB, { size: 14, lob: 0.25, spin: 4, debris: 'drumstick', debrisSize: [5, 7] }),
  'rostics-strips': () => throwBasic('strip', CRUMB, { size: 11, travel: 330, face: true, spin: 0, debris: 'crumb', debrisColors: CRUMB }),
  'rostics-bites': () => [
    { type: 'slash', t: 120, at: 'tgt', color: '#ffffff', count: 2, angle: 0, curve: 0.45, space: 26, width: 5, len: 1.1, hit: true, gap: 0 },
    ...later(140, impact(CRUMB, { count: 10, debris: 'crumb', debrisColors: CRUMB })),
  ],
  'rostics-drumsticks': () => throwBasic('drumstick', CRUMB, { size: 13, spin: 14, arc: 0.3 }),

  'dodo-pepperoni': () => throwBasic('slice', FIRE, { size: 14, spin: 10, trail: { shape: 'flame', colors: FIRE, size: [3, 6], size2: 1, rate: 50 }, debris: 'pepperoni', debrisSize: [5, 7] }),
  'dodo-four-cheeses': () => throwBasic('cheese', CHEESE, { size: 13, spin: 8, colors: CHEESE, impact: CHEESE, debris: 'cheese', debrisColors: CHEESE }),
  'dodo-dodster': () => throwBasic('roll', CRUMB, { size: 12, spin: 14 }),
  'dodo-carbonara': () => throwBasic('drop', CREAM, { size: 10, colors: CREAM, spin: 0, face: true, faceOffset: Math.PI / 2, impact: CREAM, debris: 'splat', debrisColors: CREAM }),
  'dodo-margherita': () => throwBasic('leaf', HERB, { size: 12, spin: 6, colors: HERB, arc: 0.3, impact: HERB, trail: { shape: 'leaf', colors: HERB, size: [3, 5], rate: 22 } }),
  'dodo-cheese': () => [
    { type: 'bolt', t: 60, color: '#ffd23f', width: 7, amp: 6, sag: 28, dur: 360, segments: 7, hit: true },
    ...later(240, impact(CHEESE, { count: 10 })),
  ],
  'dodo-oven-potatoes': () => throwBasic('potato', CRUMB, { size: 12, spin: 10, trail: { shape: 'smoke', colors: SMOKE, size: [3, 6], size2: 10, rate: 30 } }),
  'dodo-cheesecake': () => throwBasic('cake', SUGAR, { size: 12, spin: 5, lob: 0.2, impact: SUGAR, debris: 'sugar', debrisColors: SUGAR }),
  'dodo-bbq': () => throwBasic('slice', FIRE, { size: 13, spin: 9, trail: { shape: 'smoke', colors: SMOKE, size: [4, 7], size2: 12, rate: 45 }, impact: SAUCE, debris: 'splat', debrisColors: ['#6b2a12', '#8e3a18'] }),
  'dodo-hawaiian': () => throwBasic('cube', ['#ffe36e', '#ffd23f'], { size: 9, count: 3, gap: 60, fan: 8, spread: 14, colors: ['#ffe36e', '#ffd23f'], spin: 10, hitOnce: true, impact: CHEESE, debris: 'cube', debrisColors: ['#ffe36e', '#ffd23f'], debrisSize: [3, 5] }),
  'dodo-diablo': () => throwBasic('chili', SPICE, { size: 12, spin: 12, impact: SPICE, trail: { shape: 'flame', colors: FIRE, size: [3, 6], size2: 1, rate: 50 } }),
};

// ------------------------------------------------------------------------------ signature skills
// Each returns a full recipe. `covers` names the status layers the recipe already shows.
const SKILL = {
  // Бургер Кинг
  'bk-angus-parmigiano': () => ({
    covers: ['buff'],
    steps: [
      charge(GOLD, 0, { dur: 480, count: 26 }),
      { type: 'stamp', t: 120, at: 'src', shape: 'crown', size: 0.55, dy: -0.95, halo: '#ffd76a', dur: 900, lift: 0.3 },
      { type: 'rise', t: 200, at: 'src', shape: 'arrowUp', colors: GOLD, dur: 500, rate: 14, size: [7, 10] },
      { type: 'rain', t: 520, at: 'tgt', shape: ['cheese', 'shard'], colors: CHEESE, count: 12, dur: 380, fall: 380, size: [9, 13], splash: { shape: 'twinkle', colors: GOLD, speed: [80, 200], life: [300, 500], size: [4, 7] } },
      { type: 'slash', t: 820, at: 'tgt', color: '#ffd76a', count: 2, cross: true, width: 10, len: 2, curve: 0.1, gap: 90, dur: 360, hit: true },
      { type: 'flash', t: 820, screen: true, color: '#fff2b0', alpha: 0.14, dur: 300 },
      ...later(830, impact(GOLD, { big: true, debris: 'cheese', debrisColors: CHEESE, debrisCount: 10 })),
      { type: 'burst', t: 900, at: 'tgt', shape: 'shard', colors: ['#ffffff', '#cfe8ff'], count: 12, speed: [260, 520], life: [400, 700], size: [4, 7], gravity: 500 },
    ],
  }),
  'bk-whopper': () => ({
    covers: ['burn'],
    steps: [
      charge(FIRE, 0, { dur: 360, shape: 'flame' }),
      { type: 'beam', t: 300, shape: 'flame', colors: FIRE, size: [7, 12], size2: 20, dur: 650, rate: 110, speed: [620, 820], spread: 0.15, hit: true },
      { type: 'slash', t: 700, at: 'tgt', color: '#ff7b2a', count: 3, angle: -0.35, curve: 0, space: 16, width: 6, len: 1.2, gap: 40, dur: 500 },
      ...later(560, impact(FIRE, { count: 12, debris: 'smoke', debrisColors: SMOKE })),
      { type: 'rise', t: 760, at: 'tgt', shape: 'flame', colors: FIRE, dur: 700, rate: 30, size: [6, 11], size2: 2, speed: [80, 160] },
    ],
  }),
  'bk-double-whopper': () => ({
    steps: [
      charge(FIRE, 0, { dur: 380 }),
      { type: 'orbit', t: 120, at: 'src', shape: 'patty', count: 2, from: 1.1, to: 0.9, turns: 0.8, size: 14, dur: 440 },
      toss('patty', { t: 520, size: 16, travel: 360, arc: 0.28, spin: 6, impact: FIRE, sparks: 12, debris: 'crumb', debrisColors: CRUMB, trail: { shape: 'flame', colors: FIRE, size: [4, 7], size2: 1, rate: 50 } }),
      toss('patty', { t: 700, size: 16, travel: 360, arc: -0.28, spin: -6, impact: FIRE, sparks: 14, hit: false, debris: 'seed', trail: { shape: 'flame', colors: FIRE, size: [4, 7], size2: 1, rate: 50 } }),
      { type: 'ring', t: 1060, at: 'tgt', color: '#ffb15c', width: 9, dur: 500 },
    ],
  }),
  'bk-chicken-parmesan': () => ({
    steps: [
      charge(CHEESE, 0, { dur: 380 }),
      toss('strip', { t: 360, size: 14, travel: 300, face: true, spin: 0, arc: 0.05, impact: CHEESE, hit: true, sparks: 18,
        trail: { shape: 'drop', colors: CHEESE, size: [3, 5], rate: 40 }, debris: 'crumb', debrisColors: CRUMB }),
      { type: 'burst', t: 680, at: 'tgt', shape: 'shard', colors: ['#ffffff', '#cfe8ff', '#ffe36e'], count: 14, speed: [260, 560], life: [380, 650], size: [4, 7], gravity: 600 },
      { type: 'ring', t: 680, at: 'tgt', shape: 'hex', color: '#cfe8ff', width: 4, dur: 380 },
    ],
  }),
  'bk-onion-rings': () => ({
    covers: ['weaken'],
    steps: [
      charge(CRUMB, 0, { dur: 320 }),
      toss('onion', { t: 280, size: 12, count: 5, gap: 70, fan: 14, spread: 20, alternate: true, arc: 0.28, spin: 16, travel: 420, hitOnce: true, impact: CRUMB, sparks: 10 }),
      { type: 'rain', t: 700, at: 'tgt', shape: 'drop', colors: ['#bfe6ff', '#8fd3ff', '#e2f5ff'], count: 14, dur: 520, fall: 360, size: [5, 8], splash: { shape: 'dot', colors: ['#cfefff'], speed: [40, 120], life: [200, 360], size: [2, 4] } },
      { type: 'rise', t: 900, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 400, rate: 12, down: true, size: [6, 9] },
    ],
  }),
  'bk-fries': () => ({
    steps: [
      charge(['#fff3b0', '#ffd45a'], 0, { dur: 300 }),
      toss('fry', { t: 260, size: 12, count: 8, gap: 40, fan: 18, spread: 24, face: true, faceOffset: Math.PI / 2, spin: 0, travel: 320, arc: 0.1, alternate: true, hitOnce: true, impact: ['#fff3b0', '#ffd45a'], sparks: 8 }),
      { type: 'rain', t: 640, at: 'tgt', shape: 'sugar', colors: ['#ffffff', '#f2f2f2'], count: 22, dur: 360, fall: 300, size: [2.5, 4], spin: [-2, 2] },
      { type: 'burst', t: 860, at: 'tgt', shape: 'twinkle', colors: ['#ffffff'], count: 10, speed: [60, 180], life: [300, 520], size: [4, 7] },
    ],
  }),
  'bk-cheese-sauce': () => ({
    covers: ['sap'],
    steps: [
      charge(CHEESE, 0, { dur: 320, shape: 'dot' }),
      { type: 'beam', t: 260, shape: 'drop', colors: CHEESE, size: [6, 10], size2: 7, dur: 560, rate: 90, speed: [600, 760], spread: 0.08, gravity: 260, hit: true },
      { type: 'burst', t: 520, at: 'tgt', shape: 'splat', colors: CHEESE, count: 12, speed: [80, 260], life: [700, 1000], size: [6, 11], gravity: 320 },
      ...later(500, impact(CHEESE, { count: 8, shake: 4 })),
      { type: 'projectile', t: 860, from: 'tgt', to: 'src', shape: 'orb', colors: ['#ffe066'], size: 4, count: 5, gap: 50, fan: 16, travel: 420, arc: 0.3, alternate: true, trail: { shape: 'dot', colors: ['#ffe066'], size: [2, 4], rate: 40 } },
    ],
  }),
  'bk-shrimps': () => ({
    covers: ['shield'],
    steps: [
      { type: 'orbit', t: 0, at: 'src', shape: 'shrimp', count: 6, from: 1.8, to: 1.05, turns: 1.4, size: 10, dur: 900, flat: 0.6 },
      { type: 'burst', t: 650, at: 'src', shape: 'crumb', colors: CRUMB, count: 18, speed: [120, 260], life: [500, 800], size: [3, 6], gravity: 300 },
      { type: 'bubble', t: 680, at: 'src', color: '#ffb15c', hex: true, size: 1.4, dur: 1000 },
      { type: 'ring', t: 680, at: 'src', shape: 'hex', color: '#ffd28a', width: 5, dur: 500 },
    ],
  }),
  'bk-cola-04': () => ({
    covers: ['heal', 'cleanse'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'cup', size: 0.42, dy: -0.9, halo: '#a9e4ff', dur: 900, colors: ['#d62300'] },
      { type: 'rise', t: 150, at: 'src', shape: ['bubble', 'cube'], colors: ICE, dur: 700, rate: 26, size: [4, 8], speed: [70, 150], wobble: 60 },
      { type: 'burst', t: 400, at: 'src', shape: 'twinkle', colors: ICE, count: 14, speed: [80, 220], life: [400, 700], size: [4, 7] },
      { type: 'ring', t: 400, at: 'src', color: '#a9e4ff', width: 5, dur: 500 },
    ],
  }),
  'bk-cola-05': () => ({
    covers: ['sap'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'cup', size: 0.48, dy: -0.95, halo: '#a9e4ff', dur: 700, colors: ['#d62300'] },
      { type: 'beam', t: 280, shape: 'bubble', colors: ICE, size: [4, 7], size2: 9, dur: 520, rate: 70, speed: [520, 700], spread: 0.22, hit: true },
      { type: 'bolt', t: 360, color: '#bfeaff', width: 3, amp: 18, dur: 400, segments: 10 },
      ...later(520, impact(ICE, { count: 14, debris: 'bubble', debrisColors: ICE })),
      { type: 'projectile', t: 800, from: 'tgt', to: 'src', shape: 'orb', colors: ['#ffe066'], size: 4, count: 4, gap: 60, fan: 14, travel: 400, arc: 0.3, alternate: true },
    ],
  }),
  'bk-cola-08': () => ({
    covers: ['weaken', 'cleanse'],
    steps: [
      charge(ICE, 0, { dur: 420, count: 24 }),
      { type: 'stamp', t: 60, at: 'src', shape: 'cup', size: 0.56, dy: -1, halo: '#a9e4ff', dur: 760, colors: ['#d62300'] },
      { type: 'projectile', t: 420, shape: 'cube', colors: ICE, size: 11, count: 7, gap: 45, fan: 16, spread: 22, alternate: true, arc: 0.22, spin: 12, travel: 380, hit: true, hitOnce: true, onHit: impact(ICE, { count: 14, debris: 'shard', debrisColors: ICE }) },
      { type: 'rain', t: 760, at: 'tgt', shape: 'cube', colors: ICE, count: 8, dur: 300, fall: 340, size: [6, 9], splash: { shape: 'shard', colors: ICE, speed: [80, 200], life: [300, 500], size: [3, 5], gravity: 400 } },
      { type: 'flash', t: 820, screen: true, color: '#dff6ff', alpha: 0.16, dur: 260 },
      { type: 'rise', t: 1000, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 380, rate: 12, down: true, size: [6, 9] },
    ],
  }),
  'bk-cheese-medallions': () => ({
    steps: [
      charge(CHEESE, 0, { dur: 340 }),
      { type: 'orbit', t: 100, at: 'src', shape: 'medallion', count: 4, from: 1.5, to: 1, turns: 1, size: 10, dur: 480 },
      toss('medallion', { t: 520, size: 12, count: 4, gap: 70, fan: 12, alternate: true, arc: 0.26, spin: 14, travel: 380, hitOnce: true, impact: CHEESE, sparks: 10 }),
      { type: 'burst', t: 1000, at: 'tgt', shape: 'splat', colors: CHEESE, count: 12, speed: [80, 240], life: [600, 900], size: [5, 9], gravity: 380 },
      { type: 'rise', t: 1000, at: 'tgt', shape: 'smoke', colors: ['rgba(255,240,200,.5)'], dur: 500, rate: 20, size: [6, 10], size2: 18 },
    ],
  }),

  'bk-shrimp-roll': () => ({
    covers: ['shield'],
    steps: [
      { type: 'orbit', t: 0, at: 'src', shape: 'shrimp', count: 3, from: 1.6, to: 0.9, turns: 1, size: 9, dur: 520 },
      toss('roll', { t: 360, size: 14, spin: 22, travel: 380, arc: 0.22, impact: SAUCE, sparks: 12, debris: 'shrimp', debrisSize: [4, 6], debrisCount: 5,
        trail: { shape: 'crumb', colors: CRUMB, size: [2, 4], rate: 40 } }),
      { type: 'bubble', t: 820, at: 'src', color: '#ffb15c', size: 1.3, dur: 800 },
      { type: 'burst', t: 820, at: 'src', shape: 'crumb', colors: CRUMB, count: 12, speed: [100, 220], life: [500, 800], size: [3, 5], gravity: 300 },
    ],
  }),
  'bk-sundae': () => ({
    covers: ['weaken', 'heal'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'cone', size: 0.45, dy: -0.95, halo: '#ffe9d6', dur: 700, colors: ['#fff6ee'] },
      { type: 'rain', t: 260, at: 'tgt', shape: 'drop', colors: CHOCO, count: 14, dur: 420, fall: 340, size: [6, 9], splash: { shape: 'splat', colors: CHOCO, speed: [40, 120], life: [400, 600], size: [3, 5] } },
      { type: 'flash', t: 600, at: 'tgt', color: '#cfefff', alpha: 0.6, size: 2.2, dur: 300, hit: true },
      { type: 'burst', t: 620, at: 'tgt', shape: ['twinkle', 'shard'], colors: ICE, count: 14, speed: [90, 240], life: [400, 700], size: [3, 6] },
      { type: 'rise', t: 760, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 380, rate: 12, down: true, size: [6, 9] },
      { type: 'rise', t: 820, at: 'src', shape: ['plus', 'heart'], colors: [...HEAL, '#ffd1e6'], dur: 520, rate: 18 },
    ],
  }),

  // Вкусно — и точка
  'vkusno-double-cheeseburger': () => ({
    steps: [
      charge(CHEESE, 0, { dur: 340 }),
      { type: 'stamp', t: 80, at: 'src', shape: 'bun', size: 0.45, dy: -1, halo: '#ffd23f', dur: 520 },
      toss('patty', { t: 420, size: 14, travel: 340, arc: 0.24, spin: 6, impact: FIRE, sparks: 12 }),
      toss('cheese', { t: 560, size: 13, travel: 340, arc: -0.24, spin: -6, colors: CHEESE, impact: CHEESE, sparks: 12, hit: false, debris: 'splat', debrisColors: CHEESE }),
      { type: 'ring', t: 900, at: 'tgt', color: '#ffd23f', width: 7, dur: 460 },
    ],
  }),
  'vkusno-caesar-roll': () => ({
    covers: ['heal', 'weaken'],
    steps: [
      { type: 'orbit', t: 0, at: 'src', shape: 'leaf', colors: HERB, count: 7, from: 0.6, to: 1.6, turns: 1.4, size: 7, dur: 520 },
      { type: 'beam', t: 300, shape: 'drop', colors: CREAM, size: [5, 8], size2: 6, dur: 420, rate: 70, speed: [600, 760], spread: 0.1, hit: true },
      { type: 'burst', t: 560, at: 'tgt', shape: ['cube', 'leaf'], colors: ['#e8c27a', '#d9a85a', ...HERB], count: 14, speed: [100, 280], life: [500, 800], size: [3, 6], gravity: 420 },
      ...later(540, impact(CREAM, { count: 8, shake: 4 })),
      { type: 'rise', t: 760, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 360, rate: 12, down: true, size: [6, 9] },
      { type: 'rise', t: 800, at: 'src', shape: 'plus', colors: HEAL, dur: 460, rate: 16 },
    ],
  }),
  'vkusno-chocolate-cake': () => ({
    covers: ['shield', 'heal'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'cake', size: 0.5, dy: -0.95, colors: ['#6b3a1f'], halo: '#c98a5a', dur: 760 },
      { type: 'orbit', t: 200, at: 'src', shape: ['crumb', 'drop'], colors: CHOCO, count: 10, from: 1.9, to: 1.2, turns: 0.9, size: 6, dur: 600 },
      { type: 'bubble', t: 620, at: 'src', color: '#c98a5a', hex: true, size: 1.38, dur: 900 },
      { type: 'rise', t: 700, at: 'src', shape: ['plus', 'heart'], colors: [...HEAL, '#ffd1e6'], dur: 500, rate: 16 },
    ],
  }),
  'vkusno-big-hit': () => ({
    covers: ['shield'],
    steps: [
      charge(GOLD, 0, { dur: 500, count: 28 }),
      { type: 'stamp', t: 100, at: 'src', shape: 'bun', size: 0.7, dy: -1.15, halo: '#ffd75a', dur: 620, lift: 0.4 },
      toss('bun', { t: 620, size: 26, travel: 520, lob: 0.55, arc: 0, spin: 1.2, grow: 1.3, halo: '#ffd75a', ease: 'in', impact: GOLD, sparks: 22,
        onHit: [...impact(GOLD, { big: true, debris: 'seed', debrisColors: ['#fff1cf'], debrisCount: 18 }), { type: 'flash', screen: true, color: '#fff4c2', alpha: 0.14, dur: 300 }, { type: 'burst', shape: 'patty', count: 3, speed: [120, 220], life: [600, 800], size: [6, 8], gravity: 700 }] }),
      { type: 'bubble', t: 1250, at: 'src', color: '#7fdc8a', hex: true, size: 1.4, dur: 900 },
    ],
  }),
  'vkusno-grand': () => ({
    covers: ['buff'],
    steps: [
      { type: 'orbit', t: 0, at: 'src', shape: 'patty', count: 2, from: 1.6, to: 1, turns: 1.5, size: 13, dur: 560 },
      { type: 'rise', t: 100, at: 'src', shape: 'arrowUp', colors: GOLD, dur: 520, rate: 16, size: [7, 10] },
      { type: 'ring', t: 380, at: 'src', color: '#ffd75a', width: 5, dur: 420 },
      toss('patty', { t: 580, size: 15, count: 2, gap: 120, alternate: true, arc: 0.24, spin: 7, travel: 380, hitOnce: false, impact: FIRE, sparks: 12, debris: 'seed' }),
    ],
  }),
  'vkusno-chicken-premier': () => ({
    covers: ['shield'],
    steps: [
      charge(CRUMB, 0, { dur: 340, shape: 'crumb' }),
      { type: 'beam', t: 300, shape: 'crumb', colors: CRUMB, size: [4, 7], size2: 5, dur: 500, rate: 100, speed: [700, 880], spread: 0.18, hit: true },
      ...later(520, impact(GOLD, { count: 14, debris: 'crumb', debrisColors: CRUMB })),
      { type: 'orbit', t: 780, at: 'src', shape: 'crumb', colors: CRUMB, count: 12, from: 1.9, to: 1.2, turns: 0.8, size: 5, dur: 500 },
      { type: 'bubble', t: 900, at: 'src', color: '#ffbc0d', hex: true, size: 1.35, dur: 800 },
    ],
  }),
  'vkusno-big-special': () => ({
    covers: ['heal', 'buff'],
    steps: [
      { type: 'orbit', t: 0, at: 'src', shape: 'drop', colors: SAUCE, count: 5, from: 1.5, to: 0.9, turns: 1.2, size: 7, dur: 520 },
      { type: 'burst', t: 180, at: 'src', shape: 'twinkle', colors: GOLD, count: 10, speed: [60, 160], life: [400, 700], size: [4, 7] },
      toss('drop', { t: 480, size: 14, face: true, faceOffset: Math.PI / 2, spin: 0, colors: SAUCE, travel: 400, impact: SAUCE, sparks: 12, debris: 'splat', debrisColors: SAUCE, debrisCount: 12,
        trail: { shape: 'drop', colors: SAUCE, size: [3, 5], rate: 40 } }),
      { type: 'rise', t: 900, at: 'src', shape: ['plus', 'arrowUp'], colors: [...HEAL, '#ffd75a'], dur: 600, rate: 20 },
    ],
  }),
  'vkusno-chicken-hit': () => ({
    covers: ['buff'],
    steps: [
      { type: 'burst', t: 0, at: 'src', shape: 'note', colors: ['#ffd75a', '#ffffff', '#ff8f6b'], count: 8, speed: [60, 160], life: [700, 1000], size: [8, 11], spin: [-2, 2] },
      { type: 'ring', t: 0, at: 'src', color: '#ffd75a', width: 4, dur: 500 },
      { type: 'ring', t: 180, at: 'src', color: '#ff8f6b', width: 3, dur: 500 },
      toss('note', { t: 380, size: 12, count: 4, gap: 70, alternate: true, arc: 0.35, spin: 3, colors: ['#ffd75a', '#ffffff'], travel: 420, hitOnce: true, halo: '#ffd75a', impact: GOLD, sparks: 12 }),
      { type: 'burst', t: 1000, at: 'tgt', shape: 'star', colors: GOLD, count: 10, speed: [120, 300], life: [400, 700], size: [5, 8] },
    ],
  }),
  'vkusno-nuggets': () => ({
    covers: ['heal'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'drop', size: 0.3, dy: -0.9, colors: ['#ff9a1f'], dur: 500 },
      toss('nugget', { t: 260, size: 12, travel: 420, spin: 8, lob: 0.15, impact: SAUCE, sparks: 12, debris: 'splat', debrisColors: SAUCE,
        trail: { shape: 'drop', colors: SAUCE, size: [3, 5], rate: 35, rise: 120 } }),
      { type: 'rise', t: 700, at: 'src', shape: 'plus', colors: HEAL, dur: 500, rate: 18 },
    ],
  }),
  'vkusno-pie': () => ({
    covers: ['burn'],
    steps: [
      { type: 'rise', t: 0, at: 'src', shape: 'smoke', colors: ['rgba(255,255,255,.45)'], dur: 380, rate: 22, size: [5, 8], size2: 16, speed: [60, 120] },
      toss('pie', { t: 300, size: 15, travel: 420, spin: 7, impact: BERRY, sparks: 14, debris: 'cherry', debrisCount: 7,
        trail: { shape: 'flame', colors: FIRE, size: [4, 7], size2: 1, rate: 50 } }),
      { type: 'burst', t: 720, at: 'tgt', shape: 'splat', colors: BERRY, count: 14, speed: [90, 280], life: [700, 1000], size: [5, 9], gravity: 380 },
      { type: 'rise', t: 820, at: 'tgt', shape: ['flame', 'smoke'], colors: [...FIRE.slice(1), 'rgba(255,255,255,.4)'], dur: 600, rate: 26, size: [6, 10], size2: 3 },
    ],
  }),
  'vkusno-macarons': () => ({
    covers: ['sap', 'heal'],
    steps: [
      { type: 'orbit', t: 0, at: 'tgt', shape: 'macaron', colors: PASTEL, count: 6, from: 1.9, to: 0.4, turns: 1.6, size: 10, dur: 900 },
      { type: 'rain', t: 200, at: 'tgt', shape: 'sugar', colors: SUGAR, count: 18, dur: 500, fall: 300, size: [2.5, 4] },
      { type: 'flash', t: 860, at: 'tgt', color: '#ffd1e6', alpha: 0.6, size: 2.4, dur: 360, hit: true },
      { type: 'rise', t: 900, at: 'tgt', shape: 'zz', colors: ['#d9c2ff', '#ffffff'], dur: 700, rate: 6, size: [6, 9], speed: [40, 70], wobble: 80 },
      { type: 'projectile', t: 950, from: 'tgt', to: 'src', shape: 'orb', colors: ['#ffe066'], size: 4, count: 4, gap: 60, fan: 14, travel: 420, arc: 0.3, alternate: true },
      { type: 'rise', t: 1150, at: 'src', shape: ['heart', 'plus'], colors: ['#ffb3cf', ...HEAL], dur: 500, rate: 18 },
    ],
  }),

  // Rostic's
  'rostics-chefburger': () => ({
    covers: ['heal'],
    steps: [
      charge(SPICE, 0, { dur: 460, count: 24 }),
      { type: 'stamp', t: 80, at: 'src', shape: 'bun', size: 0.55, dy: -1.05, halo: '#ff7a86', dur: 700, lift: 0.25 },
      { type: 'orbit', t: 420, at: 'tgt', shape: ['seed', 'leaf', 'sugar', 'shard'], colors: [...SPICE, ...HERB], count: 14, from: 2.1, to: 0.25, turns: 1.4, size: 6, dur: 620 },
      { type: 'flash', t: 1020, at: 'tgt', color: '#ffd166', alpha: 0.7, size: 3, dur: 320, hit: true },
      { type: 'flash', t: 1020, screen: true, color: '#ffe6d6', alpha: 0.2, dur: 280 },
      ...later(1020, impact(SPICE, { big: true, debris: 'star', debrisColors: GOLD, debrisCount: 10 })),
      { type: 'rise', t: 1150, at: 'src', shape: ['heart', 'plus'], colors: ['#ff7a86', ...HEAL], dur: 700, rate: 24, size: [6, 10] },
    ],
  }),
  'rostics-boxmaster': () => ({
    steps: [
      { type: 'charge', t: 0, at: 'src', colors: ['#ffffff', '#ff3347'], dur: 280, count: 14 },
      ...[0, 1, 2, 3].flatMap((i) => [
        { type: 'burst', t: 260 + i * 130, at: 'tgt', jitter: 18, shape: 'star', colors: ['#ffffff', '#ffd166'], count: 4, speed: [150, 260], life: [260, 420], size: [5, 8], hit: i === 0 },
        { type: 'ring', t: 260 + i * 130, at: 'tgt', color: i % 2 ? '#ff3347' : '#ffffff', from: 10, to: 46 + i * 10, width: 5, dur: 260 },
        { type: 'shake', t: 260 + i * 130, mag: 4 + i * 1.5, dur: 160 },
      ]),
      { type: 'slash', t: 790, at: 'tgt', color: '#ff3347', count: 1, angle: -1.2, curve: 0.05, width: 12, len: 1.8, dur: 340 },
      ...later(800, impact(['#ffffff', '#ff3347', '#ffd166'], { big: true, count: 12 })),
    ],
  }),
  'rostics-wings': () => ({
    covers: ['burn'],
    steps: [
      charge(SPICE, 0, { dur: 340 }),
      toss('wing', { t: 300, size: 12, count: 3, gap: 80, fan: 10, alternate: true, arc: 0.3, spin: 14, travel: 380, hitOnce: true, impact: SPICE, sparks: 10 }),
      { type: 'orbit', t: 640, at: 'tgt', shape: ['shard', 'flame', 'seed'], colors: SPICE, count: 16, from: 0.4, to: 1.7, turns: 2.2, size: 6, dur: 700, flat: 0.45 },
      { type: 'rise', t: 760, at: 'tgt', shape: 'flame', colors: FIRE, dur: 650, rate: 30, size: [6, 11], size2: 2, speed: [80, 160] },
    ],
  }),
  'rostics-twister': () => ({
    covers: ['shield'],
    steps: [
      { type: 'orbit', t: 0, at: 'src', shape: 'leaf', colors: HERB, count: 8, from: 0.5, to: 1.6, turns: 2, size: 6, dur: 600 },
      toss('roll', { t: 300, size: 14, spin: 26, travel: 420, arc: 0.24, impact: CREAM, sparks: 14, debris: 'leaf', debrisColors: HERB, debrisCount: 8,
        trail: { shape: 'leaf', colors: HERB, size: [3, 5], rate: 30 } }),
      { type: 'bubble', t: 820, at: 'src', color: '#9be07a', size: 1.35, dur: 850 },
      { type: 'ring', t: 820, at: 'src', color: '#ffffff', width: 4, dur: 400 },
    ],
  }),
  'rostics-basket': () => ({
    covers: ['team'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'basket', size: 0.55, dy: -1, halo: '#ff7a86', dur: 1100 },
      { type: 'burst', t: 260, at: 'src', offset: 0, angle: -Math.PI / 2, spread: 0.7, shape: ['drumstick', 'wing', 'nugget'], colors: CRUMB, count: 10, speed: [280, 420], life: [900, 1100], size: [7, 10], gravity: 700, spin: [-7, 7] },
      { type: 'rise', t: 500, at: 'src', shape: 'heart', colors: ['#ff7a86', '#ffb3c0', '#ffffff'], dur: 800, rate: 26, size: [6, 10], width: 1.4 },
      { type: 'ring', t: 500, at: 'src', color: '#ff7a86', width: 5, dur: 600 },
      { type: 'ring', t: 700, at: 'src', color: '#ffffff', width: 3, dur: 600 },
    ],
  }),
  'rostics-strips': () => ({
    steps: [
      charge(CRUMB, 0, { dur: 300 }),
      toss('strip', { t: 260, size: 12, count: 3, gap: 110, fan: 6, face: true, spin: 0, arc: 0.06, travel: 300, hitOnce: false, impact: CRUMB, sparks: 8 }),
      { type: 'slash', t: 600, at: 'tgt', color: '#ffd76a', count: 3, angle: -0.5, curve: 0.05, space: 14, width: 6, len: 1.4, gap: 70, dur: 300 },
      { type: 'burst', t: 800, at: 'tgt', shape: 'crumb', colors: CRUMB, count: 12, speed: [120, 300], life: [500, 800], size: [3, 6], gravity: 500 },
    ],
  }),
  'rostics-bites': () => ({
    covers: ['drain'],
    steps: [
      toss('nugget', { t: 0, size: 9, count: 7, gap: 40, fan: 20, spread: 26, alternate: true, arc: 0.24, spin: 10, travel: 360, hitOnce: true, impact: CRUMB, sparks: 10, debris: 'crumb', debrisColors: CRUMB }),
      { type: 'slash', t: 560, at: 'tgt', color: '#ffffff', count: 2, angle: 0, curve: 0.45, space: 26, width: 5, len: 1.1, gap: 0, dur: 300 },
      { type: 'projectile', t: 760, from: 'tgt', to: 'src', shape: 'orb', colors: ['#8ff0b0'], size: 5, count: 6, gap: 50, fan: 16, travel: 460, arc: 0.3, alternate: true, trail: { shape: 'dot', colors: ['#8ff0b0'], size: [2, 4], rate: 40 } },
      { type: 'rise', t: 1150, at: 'src', shape: 'plus', colors: HEAL, dur: 450, rate: 18 },
    ],
  }),
  'rostics-drumsticks': () => ({
    covers: ['sap'],
    steps: [
      toss('drumstick', { t: 0, size: 14, travel: 380, arc: 0.5, spin: 18, impact: CRUMB, sparks: 14 }),
      { type: 'slash', t: 380, at: 'tgt', color: '#ffd76a', count: 1, angle: 0.2, curve: -0.35, width: 9, len: 1.6, dur: 320 },
      { type: 'burst', t: 420, at: 'tgt', shape: 'star', colors: ['#ffffff', '#ffd166'], count: 6, speed: [100, 220], life: [500, 700], size: [5, 7] },
      { type: 'projectile', t: 640, from: 'tgt', to: 'src', shape: 'orb', colors: ['#ffe066'], size: 4, count: 4, gap: 60, fan: 14, travel: 400, arc: 0.3, alternate: true },
    ],
  }),

  'rostics-chefburger-junior': () => ({
    covers: ['buff'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'bun', size: 0.38, dy: -0.9, halo: '#ff7a86', dur: 520, lift: 0.2 },
      { type: 'rise', t: 100, at: 'src', shape: 'arrowUp', colors: GOLD, dur: 420, rate: 14, size: [6, 9] },
      toss('bun', { t: 380, size: 13, spin: 10, travel: 380, lob: 0.12, impact: SPICE, sparks: 14, debris: 'seed', debrisCount: 10 }),
      { type: 'burst', t: 780, at: 'tgt', shape: 'star', colors: GOLD, count: 6, speed: [100, 220], life: [400, 600], size: [4, 7] },
    ],
  }),
  'rostics-fries': () => ({
    steps: [
      { type: 'burst', t: 0, at: 'src', angle: -Math.PI / 2, spread: 0.5, shape: 'fry', colors: ['#ffd45a'], count: 8, speed: [220, 320], life: [380, 460], size: [7, 9], gravity: 600, spin: [-6, 6] },
      toss('fry', { t: 300, size: 12, count: 6, gap: 40, fan: 16, spread: 22, face: true, faceOffset: Math.PI / 2, spin: 0, travel: 320, alternate: true, arc: 0.12, hitOnce: true, impact: ['#fff3b0', '#ffd45a'], sparks: 8, debris: 'fry', debrisSize: [5, 7] }),
    ],
  }),
  'rostics-ice-cream-cone': () => ({
    covers: ['sap', 'weaken', 'cleanse'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'cone', size: 0.45, dy: -0.95, halo: '#cfefff', dur: 640 },
      { type: 'beam', t: 260, shape: ['twinkle', 'dot'], colors: ICE, size: [4, 7], size2: 3, dur: 460, rate: 80, speed: [560, 720], spread: 0.14 },
      { type: 'flash', t: 560, at: 'tgt', color: '#dff6ff', alpha: 0.75, size: 2.4, dur: 360, hit: true },
      { type: 'orbit', t: 560, at: 'tgt', shape: 'shard', colors: ICE, count: 8, from: 0.5, to: 1.3, turns: 0.4, size: 9, dur: 700, flat: 0.8 },
      { type: 'rise', t: 760, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 360, rate: 12, down: true, size: [6, 9] },
      { type: 'projectile', t: 800, from: 'tgt', to: 'src', shape: 'orb', colors: ['#ffe066'], size: 4, count: 4, gap: 60, fan: 14, travel: 400, arc: 0.3, alternate: true },
    ],
  }),

  // Додо Пицца
  'dodo-diablo': () => ({
    covers: ['burn'],
    steps: [
      charge(SPICE, 0, { dur: 420, shape: 'flame', count: 24 }),
      { type: 'orbit', t: 100, at: 'src', shape: 'chili', count: 5, from: 1.7, to: 1.1, turns: 1.2, size: 10, dur: 520 },
      toss('chili', { t: 520, size: 13, count: 5, gap: 50, fan: 14, spread: 20, alternate: true, arc: 0.26, spin: 12, travel: 360, hitOnce: true,
        trail: { shape: 'flame', colors: FIRE, size: [4, 7], size2: 1, rate: 50 }, onHit: impact(SPICE, { big: true, debris: 'flame', debrisColors: FIRE, debrisCount: 10 }) }),
      { type: 'rise', t: 1100, at: 'tgt', shape: 'flame', colors: FIRE, dur: 700, rate: 36, size: [7, 12], size2: 2, speed: [100, 200] },
      { type: 'flash', t: 1100, screen: true, color: '#ff9a7a', alpha: 0.13, dur: 260 },
    ],
  }),
  'dodo-hawaiian': () => ({
    covers: ['heal'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'pizza', size: 0.45, dy: -0.95, halo: '#ffe36e', dur: 560, spin: 2 },
      { type: 'rain', t: 300, at: 'tgt', shape: 'cube', colors: ['#ffe36e', '#ffd23f', '#fff3b0'], count: 10, dur: 360, fall: 340, size: [6, 9], splash: { shape: 'twinkle', colors: CHEESE, speed: [60, 160], life: [300, 500], size: [3, 5] } },
      { type: 'flash', t: 640, at: 'tgt', color: '#ffe36e', alpha: 0.5, size: 2, dur: 260, hit: true },
      ...later(640, impact(CHEESE, { count: 10, shake: 4 })),
      { type: 'rise', t: 760, at: 'src', shape: ['plus', 'cube'], colors: [...HEAL, '#ffe36e'], dur: 500, rate: 18 },
    ],
  }),
  'dodo-pepperoni': () => ({
    covers: ['burn'],
    steps: [
      charge(FIRE, 0, { dur: 520, count: 30, shape: 'flame' }),
      { type: 'stamp', t: 60, at: 'src', shape: 'pizza', size: 0.6, dy: -1.05, halo: '#ff7a1a', dur: 640, spin: 3 },
      { type: 'projectile', t: 520, shape: 'pepperoni', size: 11, count: 9, gap: 45, fan: 20, spread: 26, alternate: true, arc: 0.32, spin: 16, travel: 400, hit: true, hitOnce: true,
        trail: { shape: 'flame', colors: FIRE, size: [3, 6], size2: 1, rate: 40 }, onHit: impact(FIRE, { big: true, debris: 'pepperoni', debrisCount: 8, debrisSize: [5, 8] }) },
      { type: 'flash', t: 1240, screen: true, color: '#ffd3a8', alpha: 0.18, dur: 300 },
      { type: 'rise', t: 1240, at: 'tgt', shape: 'flame', colors: FIRE, dur: 800, rate: 40, size: [7, 13], size2: 2, speed: [100, 200], width: 1.2 },
      { type: 'ring', t: 1240, at: 'tgt', color: '#ff3d12', width: 8, dur: 600 },
    ],
  }),
  'dodo-four-cheeses': () => ({
    covers: ['weaken', 'shield'],
    steps: [
      { type: 'orbit', t: 0, at: 'tgt', shape: 'cheese', colors: ['#ffe36e', '#fff3b0', '#ffb84d', '#f3ead2'], count: 4, from: 1.9, to: 0.3, turns: 1.2, size: 12, dur: 760 },
      { type: 'flash', t: 740, at: 'tgt', color: '#ffe36e', alpha: 0.65, size: 2.6, dur: 300, hit: true },
      ...later(740, impact(CHEESE, { count: 12, debris: 'splat', debrisColors: CHEESE })),
      { type: 'bolt', t: 820, color: '#ffd23f', width: 6, amp: 5, sag: 34, dur: 520, segments: 8 },
      { type: 'rise', t: 900, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 380, rate: 12, down: true, size: [6, 9] },
      { type: 'bubble', t: 1000, at: 'src', color: '#ffd23f', hex: true, size: 1.4, dur: 800 },
    ],
  }),
  'dodo-dodster': () => ({
    covers: ['drain'],
    steps: [
      { type: 'rise', t: 0, at: 'src', shape: 'flame', colors: FIRE, dur: 380, rate: 30, size: [5, 9], size2: 2 },
      { type: 'beam', t: 260, shape: 'dot', colors: ['#ffb067', '#ff7a1a', '#ffd166'], size: [8, 14], size2: 22, dur: 460, rate: 80, speed: [600, 780], spread: 0.14 },
      toss('roll', { t: 440, size: 14, spin: 22, travel: 360, impact: FIRE, sparks: 14, debris: 'crumb', debrisColors: CRUMB }),
      { type: 'projectile', t: 900, from: 'tgt', to: 'src', shape: 'orb', colors: ['#8ff0b0'], size: 5, count: 5, gap: 50, fan: 16, travel: 440, arc: 0.3, alternate: true, trail: { shape: 'dot', colors: ['#8ff0b0'], size: [2, 4], rate: 40 } },
      { type: 'rise', t: 1250, at: 'src', shape: 'plus', colors: HEAL, dur: 450, rate: 18 },
    ],
  }),
  'dodo-carbonara': () => ({
    covers: ['heal'],
    steps: [
      { type: 'beam', t: 120, shape: 'drop', colors: CREAM, size: [6, 10], size2: 8, dur: 540, rate: 85, speed: [560, 720], spread: 0.1, gravity: -120, hit: true },
      { type: 'burst', t: 420, at: 'tgt', shape: ['splat', 'crumb'], colors: [...CREAM, '#d98a6a'], count: 14, speed: [80, 260], life: [600, 900], size: [5, 9], gravity: 340 },
      ...later(400, impact(CREAM, { count: 10, shake: 4 })),
      { type: 'rise', t: 760, at: 'src', shape: ['plus', 'smoke'], colors: [...HEAL, 'rgba(255,250,240,.6)'], dur: 600, rate: 22 },
    ],
  }),
  'dodo-margherita': () => ({
    covers: ['shield', 'heal'],
    steps: [
      { type: 'orbit', t: 0, at: 'src', shape: ['leaf', 'dot'], colors: ['#3fae49', '#e8322a', '#ffffff'], count: 9, from: 1.9, to: 1.1, turns: 1.1, size: 8, dur: 800 },
      { type: 'bubble', t: 520, at: 'src', color: '#4fbf5a', hex: true, size: 1.4, dur: 1000 },
      { type: 'ring', t: 520, at: 'src', color: '#e8322a', width: 4, dur: 460 },
      { type: 'ring', t: 640, at: 'src', color: '#ffffff', width: 3, dur: 460 },
      { type: 'rise', t: 700, at: 'src', shape: ['plus', 'leaf'], colors: [...HEAL, '#3fae49'], dur: 600, rate: 20 },
    ],
  }),
  // The slice lands, the cheese stretches back and wraps the pizza in a melted shield.
  'dodo-cheese': () => ({
    covers: ['shield'],
    steps: [
      toss('slice', { t: 0, size: 14, spin: 6, travel: 380, impact: CHEESE, sparks: 12 }),
      { type: 'bolt', t: 380, color: '#ffd23f', width: 8, amp: 4, sag: 40, dur: 720, segments: 8 },
      { type: 'bolt', t: 440, color: '#ffe98a', width: 4, amp: 7, sag: 26, dur: 640, segments: 8 },
      { type: 'ring', t: 700, at: 'src', color: '#ffd23f', from: 96, to: 34, width: 7, dur: 420 },
      { type: 'bubble', t: 820, at: 'src', color: '#ffd23f', size: 1.35, dur: 900 },
    ],
  }),
  'dodo-oven-potatoes': () => ({
    steps: [
      { type: 'rise', t: 0, at: 'src', shape: 'flame', colors: FIRE, dur: 300, rate: 26, size: [4, 8], size2: 2 },
      toss('potato', { t: 220, size: 11, count: 3, gap: 80, fan: 10, alternate: true, arc: 0.24, spin: 12, travel: 360, hitOnce: true, impact: CRUMB, sparks: 12,
        trail: { shape: 'flame', colors: FIRE, size: [3, 6], size2: 1, rate: 45 } }),
      { type: 'burst', t: 760, at: 'tgt', shape: 'crumb', colors: CRUMB, count: 12, speed: [120, 300], life: [500, 800], size: [3, 6], gravity: 500 },
    ],
  }),
  'dodo-cheesecake': () => ({
    covers: ['heal'],
    steps: [
      { type: 'stamp', t: 0, at: 'src', shape: 'cake', size: 0.5, dy: -0.95, halo: '#ffd1e6', dur: 900, lift: 0.2 },
      { type: 'rise', t: 150, at: 'src', shape: ['twinkle', 'heart', 'plus'], colors: ['#ffffff', '#ffb3cf', ...HEAL], dur: 900, rate: 28, size: [5, 9], wobble: 50 },
      { type: 'ring', t: 300, at: 'src', color: '#ffd1e6', width: 5, dur: 600 },
      { type: 'burst', t: 300, at: 'src', shape: 'sugar', colors: SUGAR, count: 18, speed: [80, 220], life: [500, 800], size: [2.5, 4] },
    ],
  }),
  'dodo-bbq': () => ({
    covers: ['burn'],
    steps: [
      { type: 'rise', t: 0, at: 'src', shape: 'smoke', colors: SMOKE, dur: 420, rate: 26, size: [6, 10], size2: 20, speed: [50, 110] },
      { type: 'beam', t: 300, shape: ['smoke', 'flame'], colors: [...SMOKE, '#ff7a1a'], size: [8, 13], size2: 24, dur: 560, rate: 80, speed: [520, 680], spread: 0.18, hit: true },
      { type: 'burst', t: 580, at: 'tgt', shape: 'splat', colors: ['#6b2a12', '#8e3a18', '#b5521f'], count: 14, speed: [80, 260], life: [700, 1000], size: [5, 9], gravity: 360 },
      ...later(560, impact(SAUCE, { count: 12 })),
      { type: 'rise', t: 800, at: 'tgt', shape: ['flame', 'smoke'], colors: [...FIRE.slice(1), ...SMOKE], dur: 650, rate: 30, size: [6, 11], size2: 4 },
    ],
  }),
};

// ------------------------------------------------------------------------------ status layers
function layers(event, skill, covered, t0, brand) {
  const steps = [];
  const has = (k) => event.effects.includes(k) && !covered.has(k);
  if (event.blocked) steps.push({ type: 'ring', t: t0, at: 'tgt', shape: 'hex', color: '#9fd0ff', width: 5, dur: 420 }, { type: 'bubble', t: t0, at: 'tgt', color: '#9fd0ff', hex: true, size: 1.25, dur: 420 });
  if (event.absorbed) steps.push({ type: 'flash', t: t0, at: 'tgt', color: '#bfe6ff', alpha: 0.6, size: 1.8, dur: 300 }, { type: 'burst', t: t0, at: 'tgt', shape: 'shard', colors: ['#bfe6ff', '#ffffff'], count: 10, speed: [160, 320], life: [300, 500], size: [3, 5], gravity: 400 });
  if (event.executed) {
    steps.push(
      { type: 'slash', t: t0 + 80, at: 'tgt', color: '#ff3d3d', count: 2, cross: true, width: 9, len: 1.8, curve: 0.08, gap: 60, dur: 320 },
      { type: 'flash', t: t0 + 80, screen: true, color: '#ff4d4d', alpha: 0.12, dur: 260 },
      { type: 'shake', t: t0 + 100, mag: 9, dur: 300 },
    );
  }
  if (has('burn')) steps.push({ type: 'rise', t: t0 + 120, at: 'tgt', shape: 'flame', colors: FIRE, dur: 600, rate: 28, size: [6, 10], size2: 2, speed: [80, 160] });
  if (has('weaken')) steps.push({ type: 'rise', t: t0 + 160, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 380, rate: 12, down: true, size: [6, 9] });
  if (has('sap')) steps.push({ type: 'projectile', t: t0 + 160, from: 'tgt', to: 'src', shape: 'orb', colors: ['#ffe066'], size: 4, count: 4, gap: 60, fan: 14, travel: 400, arc: 0.3, alternate: true });
  if (has('buff')) steps.push({ type: 'rise', t: t0 + 120, at: 'src', shape: 'arrowUp', colors: GOLD, dur: 420, rate: 14, size: [7, 10] }, { type: 'ring', t: t0 + 120, at: 'src', color: '#ffd76a', width: 4, dur: 400 });
  if (has('shield')) steps.push({ type: 'bubble', t: t0 + 120, at: 'src', color: BRAND[brand]?.shield ?? '#8fd3ff', hex: true, size: 1.35, dur: 800 });
  if (has('shatter')) steps.push({ type: 'burst', t: t0 - 60, at: 'tgt', shape: 'shard', colors: ['#bfe6ff', '#ffffff', '#ffd76a'], count: 16, speed: [200, 420], life: [320, 560], size: [3, 6], gravity: 500 }, { type: 'ring', t: t0 - 60, at: 'tgt', shape: 'hex', color: '#ffffff', from: 40, to: 110, width: 4, dur: 320 });
  if (event.thorns) steps.push({ type: 'burst', t: t0 + 160, at: 'src', shape: 'spark', colors: ['#7bd88f', '#ff6b6b'], count: 9, speed: [120, 260], life: [260, 420], size: [2, 4] });
  if (event.saved) steps.push({ type: 'ring', t: t0 + 120, at: 'tgt', color: '#ffd76a', from: 20, to: 120, width: 6, dur: 520 }, { type: 'burst', t: t0 + 160, at: 'tgt', shape: 'star', colors: GOLD, count: 8, speed: [80, 200], life: [500, 800], size: [5, 8] });
  if (has('team')) steps.push({ type: 'rise', t: t0 + 100, at: 'src', shape: 'heart', colors: ['#ff7a86', '#ffffff'], dur: 600, rate: 20 });
  if (skill?.drain && !covered.has('drain') && event.heal) steps.push({ type: 'projectile', t: t0 + 160, from: 'tgt', to: 'src', shape: 'orb', colors: ['#8ff0b0'], size: 5, count: 4, gap: 50, fan: 14, travel: 420, arc: 0.3, alternate: true });
  if (event.heal && !covered.has('heal') && !covered.has('team') && !(skill?.drain && !covered.has('drain'))) steps.push({ type: 'rise', t: t0 + 140, at: 'src', shape: 'plus', colors: HEAL, dur: 480, rate: 18 });
  if (has('cleanse')) steps.push({ type: 'rise', t: t0 + 140, at: 'src', shape: 'drop', colors: ICE, dur: 420, rate: 16, size: [4, 7], speed: [40, 90], down: true });
  if (event.recoil) steps.push({ type: 'burst', t: t0 + 220, at: 'src', shape: 'spark', colors: ['#ff6b6b', '#ffd166'], count: 10, speed: [140, 300], life: [260, 460], size: [2, 4] }, { type: 'shake', t: t0 + 220, mag: 3, dur: 200 });
  return steps;
}

function guardFx(brand) {
  const c = BRAND[brand]?.shield ?? '#8fd3ff';
  return [
    { type: 'ring', t: 0, at: 'src', shape: 'hex', color: c, from: 70, to: 30, width: 5, dur: 300 },
    { type: 'bubble', t: 160, at: 'src', color: c, hex: true, size: 1.3, dur: 700 },
    { type: 'burst', t: 200, at: 'src', shape: 'twinkle', colors: ['#ffffff', c], count: 8, speed: [60, 160], life: [400, 600], size: [4, 7] },
  ];
}

function enterFx(brand) {
  const c = BRAND[brand]?.glow ?? '#ffffff';
  return [
    { type: 'ring', t: 0, at: 'src', color: c, from: 10, to: 90, width: 6, dur: 460 },
    { type: 'burst', t: 0, at: 'src', shape: 'twinkle', colors: ['#ffffff', c], count: 12, speed: [100, 260], life: [400, 650], size: [4, 8] },
  ];
}

// Fallback for fighters added later without a hand-made recipe: built from the skill fields.
function genericSkill(skill, brand) {
  const c = BRAND[brand] ?? BRAND.bk;
  const colors = [c.glow, c.main, '#ffffff'];
  const steps = [charge(colors, 0, { dur: 380 })];
  if (Number.isFinite(skill?.power)) steps.push(toss('orb', { t: 340, size: 10, halo: c.main, colors: ['#ffffff'], travel: 400, impact: colors, trail: { shape: 'dot', colors, size: [4, 7], rate: 60 } }));
  else steps.push({ type: 'ring', t: 340, at: 'src', color: c.glow, width: 5, dur: 500 });
  return { steps };
}

// A super move replays the fighter's own skill animation inside a golden wind-up and shockwave.
const ULT_LEAD = 300;
function ultimateFx(id, skill, brand) {
  const base = (SKILL[id] ?? (() => genericSkill(skill, brand)))();
  const shifted = base.steps.map((step) => ({ ...step, t: (step.t ?? 0) + ULT_LEAD }));
  const impact = fxTiming(shifted).impact;
  const steps = [
    { type: 'ring', t: 0, at: 'src', color: '#ffd76a', from: 120, to: 26, width: 6, dur: 320 },
    { type: 'burst', t: 40, at: 'src', shape: 'twinkle', colors: GOLD, count: 14, speed: [90, 220], life: [380, 620], size: [4, 8] },
    { type: 'flash', t: 120, screen: true, color: '#ffd76a', alpha: 0.12, dur: 260 },
    ...shifted,
  ];
  if (impact !== null) steps.push(
    { type: 'ring', t: impact, at: 'tgt', color: '#ffd76a', from: 30, to: 150, width: 7, dur: 460 },
    { type: 'burst', t: impact, at: 'tgt', shape: 'star', colors: GOLD, count: 10, speed: [160, 320], life: [420, 700], size: [5, 9], gravity: 260 },
    { type: 'shake', t: impact, mag: 7, dur: 280 },
  );
  return { ...base, steps };
}

// Everything the arena needs for one engine event: the steps and the moments that matter.
export function movePlan(event, { brand, energyFor } = {}) {
  const id = event.fighter;
  let recipe;
  if (event.command.startsWith('switch:')) recipe = { steps: enterFx(brand) };
  else if (event.command === 'guard') recipe = { steps: guardFx(brand) };
  else if (event.command === 'special') recipe = (SKILL[id] ?? (() => genericSkill(energyFor, brand)))();
  else if (event.command === 'ultimate') recipe = ultimateFx(id, energyFor, brand);
  else recipe = { steps: (BASIC[id] ?? (() => throwBasic('orb', [BRAND[brand]?.glow ?? '#fff', '#ffffff'], { size: 8, halo: BRAND[brand]?.main ?? '#fff', spin: 0 })))() };
  const timing = fxTiming(recipe.steps);
  const steps = [...recipe.steps];
  const blow = !event.command.startsWith('switch:') && event.command !== 'guard';
  if (blow) steps.push(...layers(event, energyFor, new Set(recipe.covers ?? []), timing.impact, brand));
  if (event.burned) steps.push({ type: 'rise', t: timing.impact + 450, at: 'src', shape: 'flame', colors: FIRE, dur: 420, rate: 26, size: [5, 9], size2: 2 });
  if (event.ko.length) {
    const at = event.ko.includes(event.target) ? 'tgt' : 'src';
    steps.push(
      { type: 'burst', t: timing.impact + 260, at, shape: 'smoke', colors: ['rgba(200,200,200,.55)', 'rgba(150,150,150,.5)'], count: 14, speed: [60, 160], life: [700, 1000], size: [8, 14], size2: 26 },
      { type: 'burst', t: timing.impact + 300, at, shape: 'star', colors: GOLD, count: 7, speed: [120, 240], life: [600, 900], size: [5, 8], gravity: 300 },
    );
  }
  const full = fxTiming(steps.map((s) => ({ ...s, hit: false })));
  // The lunge starts just before the first thing leaves the fighter.
  const launch = recipe.steps.find((s) => ['projectile', 'beam', 'slash', 'bolt'].includes(s.type) || s.hit);
  return { steps, impact: blow ? timing.impact : 0, end: Math.max(full.end, timing.impact + 500), lungeAt: Math.max(0, (launch?.t ?? 0) - 140) };
}

export const RECIPE_IDS = { skill: Object.keys(SKILL), basic: Object.keys(BASIC) };
