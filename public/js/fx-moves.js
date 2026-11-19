// What every move looks like. Each fighter has its own basic attack, its own signature skill and,
// if it has one, its own super move scene; the status effects and talents the engine reports
// (burn, shield, drain, armour, thorns…) are layered on top, timed from the moment the blow lands.
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

// A flat shockwave along the ground under an anchor.
const groundRing = (color, o = {}) => ({ type: 'ring', t: o.t ?? 0, at: o.at, color, flat: 0.3, dy: o.dy ?? 0.72, from: 14, to: o.to ?? 120, width: o.width ?? 5, dur: o.dur ?? 440 });
// Orbs flying back from the target: stolen energy (yellow) or stolen health (green).
const backOrbs = (colors, t, o = {}) => ({ type: 'projectile', t, from: 'tgt', to: 'src', shape: 'orb', colors, size: o.size ?? 4, count: o.count ?? 4, gap: 55, fan: 14, travel: o.travel ?? 420, arc: 0.3, alternate: true,
  trail: { shape: 'dot', colors, size: [2, 4], rate: 40 } });

const BASIC = {
  // Бургер Кинг
  // A marbled patty dropped from above, cheese flying off on landing.
  'bk-angus-parmigiano': () => [
    { type: 'slam', t: 40, at: 'tgt', shape: 'patty', size: 0.5, height: 2.6, fall: 300, hold: 120, spin: 0.6, hit: true,
      onHit: [...impact(FIRE, { count: 10, debris: 'cheese', debrisColors: CHEESE, debrisCount: 6 }), groundRing('#ffd76a')] },
  ],
  // Two glowing grill marks seared across the target, then a wisp of smoke.
  'bk-whopper': () => [
    { type: 'slash', t: 80, at: 'tgt', color: '#ff8a2a', count: 2, angle: -0.35, curve: 0, space: 16, width: 8, len: 1.2, gap: 80, dur: 380, hit: true },
    ...later(80, impact(FIRE, { count: 10 })),
    { type: 'burst', t: 260, at: 'tgt', shape: 'smoke', colors: SMOKE, count: 6, angle: -Math.PI / 2, spread: 0.5, speed: [40, 90], life: [500, 700], size: [5, 8], size2: 16 },
    { type: 'burst', t: 200, at: 'tgt', shape: 'spark', colors: FIRE, count: 8, angle: -Math.PI / 2, spread: 0.8, speed: [80, 200], life: [400, 600], size: [2, 3], gravity: -60 },
  ],
  'bk-double-whopper': () => [
    { type: 'slash', t: 100, at: 'tgt', color: '#ffb15c', count: 2, cross: true, width: 7, len: 1.5, hit: true, gap: 110 },
    ...later(100, impact(FIRE, { count: 10, debris: 'crumb', debrisColors: CRUMB })),
    ...later(210, impact(FIRE, { count: 8, shake: 4 })),
  ],
  // A fencing lunge: the crispy fillet flies straight like a rapier and breadcrumbs burst out the back.
  'bk-chicken-parmesan': () => [
    toss('strip', { size: 13, travel: 240, ease: 'in', face: true, spin: 0, arc: 0, trail: { shape: 'spark', colors: ['#ffffff', '#ffe36e'], size: [2, 3], rate: 80 },
      onHit: [...impact(CHEESE, { count: 8 }), { type: 'burst', along: true, spread: 0.35, shape: 'crumb', colors: CRUMB, count: 10, speed: [260, 460], life: [380, 600], size: [3, 5], gravity: 300 }] }),
  ],
  // The ring is thrown like a hoop and closes around the target.
  'bk-onion-rings': () => [
    toss('onion', { size: 13, spin: 14, arc: 0.3, travel: 380,
      onHit: [...impact(CRUMB, { count: 8 }), { type: 'ring', color: '#e9b04f', from: 96, to: 34, width: 7, dur: 360 }, { type: 'ring', t: 90, color: '#f6d27a', from: 80, to: 30, width: 4, dur: 320 }] }),
  ],
  // A quick fry jab with a pinch of salt.
  'bk-fries': () => [
    toss('fry', { size: 12, travel: 300, face: true, faceOffset: Math.PI / 2, spin: 0, arc: 0.05,
      onHit: [...impact(['#fff3b0', '#ffd45a'], { count: 10, debris: 'fry', debrisSize: [5, 7], debrisCount: 4 }), { type: 'burst', shape: 'sugar', colors: ['#ffffff'], count: 10, speed: [80, 200], life: [400, 600], size: [2, 3.5], gravity: 300 }] }),
  ],
  'bk-cheese-sauce': () => throwBasic('drop', CHEESE, { size: 8, count: 5, gap: 45, fan: 8, spread: 18, colors: CHEESE, spin: 0, face: true, faceOffset: Math.PI / 2, hitOnce: true, debris: 'splat', debrisColors: CHEESE }),
  'bk-shrimps': () => [
    toss('shrimp', { size: 12, travel: 360, impact: SAUCE, onHit: [] }),
    { type: 'slash', t: 360, at: 'tgt', color: '#ff9a5a', count: 2, cross: true, width: 5, len: 0.9, gap: 40 },
    ...later(360, impact(SAUCE, { count: 10 })),
  ],
  // A short fizzy spray; the bubbles keep popping upwards on the target.
  'bk-cola-04': () => [
    { type: 'beam', t: 60, shape: 'drop', colors: COLA, size: [4, 7], size2: 5, dur: 240, rate: 60, speed: [760, 900], spread: 0.16, hit: true },
    ...later(280, impact(ICE, { count: 8 })),
    { type: 'burst', t: 300, at: 'tgt', shape: 'bubble', colors: ICE, count: 9, angle: -Math.PI / 2, spread: 0.7, speed: [60, 150], life: [500, 750], size: [3, 6], gravity: -160, wobble: 50 },
  ],
  'bk-cola-05': () => [
    { type: 'beam', t: 80, shape: 'drop', colors: COLA, size: [5, 8], size2: 6, dur: 320, rate: 70, speed: [800, 950], spread: 0.06, hit: true },
    ...later(340, impact(ICE, { count: 10, debris: 'bubble', debrisColors: ICE })),
  ],
  // An icy splash erupts from under the target's feet.
  'bk-cola-08': () => [
    charge(ICE, 0, { dur: 220, count: 10 }),
    { type: 'pillar', t: 180, at: 'tgt', colors: ['#ffffff', '#8fd3ff'], width: 0.42, height: 2.2, dur: 480, hit: true },
    { type: 'burst', t: 180, at: 'tgt', dy: 0.5, angle: -Math.PI / 2, spread: 0.6, shape: ['shard', 'drop'], colors: ICE, count: 12, speed: [300, 520], life: [400, 620], size: [4, 7], gravity: 900 },
    ...later(180, impact(ICE, { count: 6, shake: 4 })),
    groundRing('#bfeaff', { t: 180, to: 100 }),
  ],
  // The roll rolls in, shedding crumbs.
  'bk-shrimp-roll': () => throwBasic('roll', SAUCE, { size: 12, spin: 20, arc: 0.05, impact: SAUCE, debris: 'shrimp', debrisSize: [4, 6], trail: { shape: 'crumb', colors: CRUMB, size: [2, 4], rate: 45 } }),
  'bk-sundae': () => throwBasic('drop', CHOCO, { size: 8, count: 3, gap: 55, fan: 6, spread: 14, colors: CHOCO, spin: 0, face: true, faceOffset: Math.PI / 2, hitOnce: true, impact: CREAM, debris: 'splat', debrisColors: CHOCO }),
  // A boomerang: the medallion hits and curves back to the thrower.
  'bk-cheese-medallions': () => [
    toss('medallion', { size: 12, spin: 14, arc: 0.36, travel: 360, impact: CHEESE, debris: 'crumb', debrisColors: CRUMB }),
    { type: 'projectile', t: 400, from: 'tgt', to: 'src', shape: 'medallion', size: 10, spin: 14, arc: 0.36, travel: 380, ease: 'out' },
  ],

  // Вкусно — и точка
  // Two cheese slices clap together on the target from both sides.
  'vkusno-double-cheeseburger': () => [
    toss('cheese', { size: 12, count: 2, gap: 0, alternate: true, arc: 0.42, spin: 6, travel: 360, hitOnce: true, colors: CHEESE,
      onHit: [...impact(CHEESE, { count: 10 }), { type: 'slash', color: '#ffe36e', count: 1, angle: -Math.PI / 2, curve: 0, width: 7, len: 1.1, dur: 240 }] }),
  ],
  // A lettuce leaf thrown like a shuriken.
  'vkusno-caesar-roll': () => [
    toss('leaf', { size: 12, spin: 26, arc: 0.12, travel: 340, colors: HERB, trail: { shape: 'leaf', colors: HERB, size: [2, 4], rate: 30 },
      onHit: [...impact(HERB, { count: 8, debris: 'cube', debrisColors: ['#e8c27a', '#d9a85a'], debrisSize: [3, 4] }), { type: 'slash', color: '#c9ffd9', count: 1, angle: -0.6, width: 5, len: 1.2, dur: 260 }] }),
  ],
  'vkusno-chocolate-cake': () => throwBasic('crumb', CHOCO, { size: 7, count: 5, gap: 40, fan: 8, spread: 18, spin: 10, hitOnce: true, colors: CHOCO, impact: CREAM }),
  // A heavy patty with a shockwave along the ground.
  'vkusno-big-hit': () => [
    toss('patty', { size: 16, spin: 4, lob: 0.18, travel: 400, trail: { shape: 'smoke', colors: SMOKE, size: [4, 8], size2: 12, rate: 40 },
      onHit: [...impact(FIRE, { count: 12, shake: 7 }), groundRing('#ffd75a', { to: 140, width: 6 })] }),
  ],
  // A golden uppercut: one vertical stroke, stars thrown upwards.
  'vkusno-grand': () => [
    { type: 'slash', t: 100, at: 'tgt', color: '#ffd75a', count: 1, angle: -1.45, curve: 0.32, width: 10, len: 1.5, dur: 340, hit: true },
    ...later(100, impact(GOLD, { count: 10, debris: 'seed' })),
    { type: 'burst', t: 140, at: 'tgt', angle: -Math.PI / 2, spread: 0.5, shape: 'star', colors: GOLD, count: 6, speed: [220, 360], life: [500, 700], size: [5, 8], gravity: 500 },
  ],
  'vkusno-chicken-premier': () => slashBasic('#fff3b0', CRUMB, { count: 2, cross: true, debris: 'crumb', debrisColors: CRUMB }),
  // A whip of sauce that cracks on the target.
  'vkusno-big-special': () => [
    { type: 'bolt', t: 60, color: '#ff9a1f', width: 6, amp: 6, sag: -34, dur: 320, segments: 9, hit: true },
    ...later(80, impact(SAUCE, { count: 8, debris: 'splat', debrisColors: SAUCE })),
  ],
  // A drumstick swung like a club.
  'vkusno-chicken-hit': () => [
    { type: 'stamp', t: 0, at: 'tgt', shape: 'drumstick', size: 0.6, dx: -0.5, dy: -0.5, tilt: -1.6, spin: 2.4, dur: 380 },
    { type: 'burst', t: 230, at: 'tgt', shape: 'star', colors: ['#ffffff', '#ffd166'], count: 5, speed: [140, 260], life: [300, 500], size: [5, 8], hit: true },
    ...later(230, impact(CRUMB, { count: 10, debris: 'crumb', debrisColors: CRUMB })),
  ],
  // A nugget dipped in sauce: it leaves a sauce trail and splats.
  'vkusno-nuggets': () => throwBasic('nugget', SAUCE, { size: 12, spin: 8, trail: { shape: 'drop', colors: SAUCE, size: [2, 4], rate: 35 }, debris: 'splat', debrisColors: SAUCE }),
  // Steam puffs from the pie, then hot filling squirts out.
  'vkusno-pie': () => [
    { type: 'rise', t: 0, at: 'src', shape: 'smoke', colors: ['rgba(255,255,255,.45)'], dur: 200, rate: 24, size: [4, 7], size2: 14, speed: [60, 120] },
    toss('drop', { t: 120, size: 8, count: 3, gap: 50, fan: 6, spread: 16, colors: BERRY, spin: 0, face: true, faceOffset: Math.PI / 2, hitOnce: true, travel: 360,
      onHit: [...impact(BERRY, { count: 8, debris: 'splat', debrisColors: BERRY }), { type: 'rise', shape: 'smoke', colors: ['rgba(255,255,255,.4)'], dur: 260, rate: 20, size: [4, 7], size2: 14, speed: [60, 110] }] }),
  ],
  // A meringue lobbed high that shatters into sugar dust.
  'vkusno-macarons': () => [
    toss('macaron', { size: 11, spin: 6, lob: 0.35, travel: 420, colors: PASTEL,
      onHit: [...impact(SUGAR, { count: 8 }), { type: 'burst', shape: ['shard', 'sugar'], colors: PASTEL, count: 12, speed: [160, 340], life: [400, 700], size: [3, 6], gravity: 600 }] }),
  ],

  // Rostic's
  'rostics-chefburger-junior': () => throwBasic('bun', SPICE, { size: 11, spin: 8, impact: SPICE, debris: 'seed' }),
  'rostics-fries': () => throwBasic('fry', ['#fff3b0', '#ffd45a'], { size: 12, count: 2, gap: 70, travel: 300, face: true, faceOffset: Math.PI / 2, spin: 0, hitOnce: true, debris: 'fry', debrisSize: [5, 7] }),
  // A cold breath of snowflakes; frost settles around the target.
  'rostics-ice-cream-cone': () => [
    { type: 'beam', t: 60, shape: ['snowflake', 'dot'], colors: ICE, size: [3, 6], size2: 4, dur: 300, rate: 55, speed: [520, 680], spread: 0.16, hit: true },
    ...later(300, impact(ICE, { count: 6, shake: 3 })),
    { type: 'ring', t: 300, at: 'tgt', shape: 'hex', color: '#cfefff', from: 80, to: 40, width: 4, dur: 380 },
  ],
  // Three quick knife chops with steel sparks.
  'rostics-chefburger': () => [
    { type: 'slash', t: 80, at: 'tgt', color: '#ffffff', count: 3, angle: -1.5, curve: 0.04, space: 18, width: 5, len: 1.2, gap: 80, dur: 240, hit: true },
    ...[0, 1, 2].map((i) => ({ type: 'burst', t: 120 + i * 80, at: 'tgt', jitter: 14, shape: 'spark', colors: STEEL, count: 5, speed: [180, 320], life: [200, 340], size: [2, 3.5] })),
    ...later(280, impact(SPICE, { count: 8, shake: 5 })),
  ],
  // A jab: the glove snaps forward and back.
  'rostics-boxmaster': () => [
    toss('glove', { size: 13, travel: 220, ease: 'in', face: true, spin: 0, arc: 0, grow: 1.3, trail: { shape: 'spark', colors: ['#ffffff'], size: [2, 3], rate: 70 },
      onHit: [...impact(['#ffffff', '#ff3347', '#ffd166'], { count: 10 }), { type: 'burst', shape: 'star', colors: ['#ffffff', '#ffd166'], count: 4, speed: [140, 240], life: [300, 480], size: [5, 7] }] }),
  ],
  // A wide fiery swipe of the wing.
  'rostics-wings': () => [
    { type: 'slash', t: 90, at: 'tgt', color: '#ff3b2f', count: 1, angle: -0.25, curve: 0.5, width: 10, len: 1.9, dur: 340, hit: true },
    ...later(110, impact(SPICE, { count: 10 })),
    { type: 'burst', t: 140, at: 'tgt', shape: ['flame', 'seed'], colors: SPICE, count: 8, speed: [120, 260], life: [300, 500], size: [3, 6] },
  ],
  // The wrap spirals around the target and squeezes.
  'rostics-twister': () => [
    { type: 'orbit', t: 0, at: 'tgt', shape: ['roll', 'leaf'], colors: [...HERB, '#fff0cc'], count: 4, from: 1.8, to: 0.35, turns: 1.4, size: 9, dur: 480 },
    { type: 'flash', t: 460, at: 'tgt', color: '#fff0cc', alpha: 0.5, size: 1.8, dur: 240, hit: true },
    ...later(460, impact(CREAM, { count: 10, debris: 'leaf', debrisColors: HERB, debrisCount: 5 })),
  ],
  'rostics-basket': () => throwBasic('basket', CRUMB, { size: 14, lob: 0.25, spin: 4, debris: 'drumstick', debrisSize: [5, 7] }),
  // A crispy strip cracked like a whip.
  'rostics-strips': () => [
    { type: 'bolt', t: 60, color: '#e9b04f', width: 6, amp: 3, sag: 42, dur: 300, segments: 10, hit: true },
    { type: 'burst', t: 80, at: 'tgt', shape: 'spark', colors: ['#ffffff', '#ffd76a'], count: 8, speed: [260, 420], life: [180, 300], size: [2, 3.5] },
    ...later(80, impact(CRUMB, { count: 8, debris: 'crumb', debrisColors: CRUMB })),
  ],
  'rostics-bites': () => [
    { type: 'slash', t: 120, at: 'tgt', color: '#ffffff', count: 2, angle: 0, curve: 0.45, space: 26, width: 5, len: 1.1, hit: true, gap: 0 },
    ...later(140, impact(CRUMB, { count: 10, debris: 'crumb', debrisColors: CRUMB })),
  ],
  'rostics-drumsticks': () => throwBasic('drumstick', CRUMB, { size: 13, spin: 14, arc: 0.3 }),

  // Додо Пицца
  // A slice spun like a blade, leaving a fiery trail and a cut.
  'dodo-pepperoni': () => [
    toss('slice', { size: 14, spin: 16, travel: 360, trail: { shape: 'flame', colors: FIRE, size: [3, 6], size2: 1, rate: 50 },
      onHit: [...impact(FIRE, { count: 10, debris: 'pepperoni', debrisSize: [5, 7], debrisCount: 5 }), { type: 'slash', color: '#ff7a1a', count: 1, angle: -0.7, width: 6, len: 1.3, dur: 260 }] }),
  ],
  // A volley of four different cheeses.
  'dodo-four-cheeses': () => throwBasic('cheese', CHEESE, { size: 10, count: 4, gap: 55, fan: 10, spread: 16, alternate: true, arc: 0.22, spin: 8, travel: 360, hitOnce: true,
    colors: ['#ffe36e', '#fff3b0', '#ffb84d', '#f3ead2'], impact: CHEESE, debris: 'splat', debrisColors: CHEESE }),
  'dodo-dodster': () => throwBasic('roll', CRUMB, { size: 12, spin: 14, trail: { shape: 'crumb', colors: CRUMB, size: [2, 3], rate: 30 } }),
  // A wave of cream sauce that splashes over the target.
  'dodo-carbonara': () => [
    { type: 'beam', t: 60, shape: 'drop', colors: CREAM, size: [6, 10], size2: 8, dur: 280, rate: 70, speed: [600, 760], spread: 0.22, gravity: -160, hit: true },
    ...later(280, impact(CREAM, { count: 8, debris: 'splat', debrisColors: CREAM })),
  ],
  'dodo-margherita': () => throwBasic('leaf', HERB, { size: 12, spin: 6, colors: HERB, arc: 0.3, impact: HERB, trail: { shape: 'leaf', colors: HERB, size: [3, 5], rate: 22 } }),
  'dodo-cheese': () => [
    { type: 'bolt', t: 60, color: '#ffd23f', width: 7, amp: 6, sag: 28, dur: 360, segments: 7, hit: true },
    ...later(240, impact(CHEESE, { count: 10 })),
  ],
  'dodo-oven-potatoes': () => throwBasic('potato', CRUMB, { size: 12, spin: 10, trail: { shape: 'smoke', colors: SMOKE, size: [3, 6], size2: 10, rate: 30 } }),
  'dodo-cheesecake': () => throwBasic('cake', SUGAR, { size: 12, spin: 5, lob: 0.2, impact: SUGAR, debris: 'sugar', debrisColors: SUGAR }),
  'dodo-bbq': () => throwBasic('slice', FIRE, { size: 13, spin: 9, trail: { shape: 'smoke', colors: SMOKE, size: [4, 7], size2: 12, rate: 45 }, impact: SAUCE, debris: 'splat', debrisColors: ['#6b2a12', '#8e3a18'] }),
  'dodo-hawaiian': () => throwBasic('cube', ['#ffe36e', '#ffd23f'], { size: 9, count: 3, gap: 60, fan: 8, spread: 14, colors: ['#ffe36e', '#ffd23f'], spin: 10, hitOnce: true, impact: CHEESE, debris: 'cube', debrisColors: ['#ffe36e', '#ffd23f'], debrisSize: [3, 5] }),
  // A chili hurled like a fireball.
  'dodo-diablo': () => throwBasic('chili', SPICE, { size: 13, spin: 12, impact: SPICE, halo: '#ff3d12', trail: { shape: 'flame', colors: FIRE, size: [4, 7], size2: 1, rate: 60 } }),
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
  // The medallion cracks open on the enemy and molten cheese pours out.
  'bk-cheese-medallions': () => ({
    steps: [
      charge(CHEESE, 0, { dur: 340 }),
      { type: 'orbit', t: 80, at: 'src', shape: 'medallion', count: 3, from: 1.5, to: 1, turns: 1, size: 10, dur: 440 },
      toss('medallion', { t: 440, size: 18, travel: 400, lob: 0.25, spin: 8, halo: '#ffd23f',
        onHit: [...impact(CHEESE, { count: 14 }), { type: 'burst', shape: 'crumb', colors: CRUMB, count: 12, speed: [180, 360], life: [500, 800], size: [3, 6], gravity: 600 }] }),
      { type: 'burst', t: 860, at: 'tgt', shape: 'splat', colors: CHEESE, count: 10, speed: [60, 200], life: [700, 1000], size: [5, 9], gravity: 420 },
      { type: 'rise', t: 860, at: 'tgt', shape: 'drop', colors: CHEESE, down: true, dur: 560, rate: 24, size: [5, 8], speed: [80, 160], width: 0.8 },
      { type: 'rise', t: 900, at: 'tgt', shape: 'flame', colors: FIRE, dur: 480, rate: 14, size: [5, 8], size2: 2 },
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
  // Three lashes of the crispy strip, each one harder than the last.
  'rostics-strips': () => ({
    steps: [
      charge(CRUMB, 0, { dur: 300 }),
      ...[0, 1, 2].flatMap((i) => [
        { type: 'bolt', t: 260 + i * 170, color: i === 2 ? '#ffd76a' : '#e9b04f', width: 5 + i * 2.5, amp: 3, sag: i % 2 ? -40 : 40, dur: 300, segments: 10, hit: i === 0 },
        { type: 'burst', t: 280 + i * 170, at: 'tgt', shape: 'spark', colors: ['#ffffff', '#ffd76a'], count: 5 + i * 3, speed: [240, 420 + i * 80], life: [180, 320], size: [2, 4] },
        { type: 'shake', t: 280 + i * 170, mag: 3 + i * 2, dur: 180 },
      ]),
      ...later(620, impact(CRUMB, { count: 12, debris: 'crumb', debrisColors: CRUMB })),
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
  // A handful of fries thrown up high rains down on the enemy.
  'rostics-fries': () => ({
    steps: [
      { type: 'burst', t: 0, at: 'src', angle: -Math.PI / 2, spread: 0.45, shape: 'fry', colors: ['#ffd45a'], count: 8, speed: [380, 520], life: [380, 460], size: [7, 9], gravity: 300, spin: [-6, 6] },
      { type: 'rain', t: 260, at: 'tgt', shape: 'fry', count: 12, dur: 360, fall: 340, size: [9, 12], spin: [-4, 4], width: 1.2, hit: true,
        splash: { shape: 'sugar', colors: ['#ffffff'], count: 2, speed: [40, 120], life: [200, 360], size: [2, 3] } },
      ...later(740, impact(['#fff3b0', '#ffd45a'], { count: 10, shake: 4 })),
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
  // Potatoes straight from the oven: they roast the enemy in a ring of embers.
  'dodo-oven-potatoes': () => ({
    steps: [
      { type: 'rise', t: 0, at: 'src', shape: 'flame', colors: FIRE, dur: 300, rate: 26, size: [4, 8], size2: 2 },
      toss('potato', { t: 220, size: 11, count: 3, gap: 80, fan: 10, alternate: true, arc: 0.24, spin: 12, travel: 360, hitOnce: true, impact: CRUMB, sparks: 12,
        trail: { shape: 'flame', colors: FIRE, size: [3, 6], size2: 1, rate: 45 } }),
      groundRing('#ff7a1a', { t: 740, at: 'tgt', to: 150, width: 7, dur: 600 }),
      { type: 'burst', t: 760, at: 'tgt', shape: 'crumb', colors: CRUMB, count: 10, speed: [120, 300], life: [500, 800], size: [3, 6], gravity: 500 },
      { type: 'rise', t: 780, at: 'tgt', shape: ['spark', 'smoke'], colors: [...FIRE, ...SMOKE], dur: 560, rate: 22, size: [3, 7], size2: 10, speed: [60, 140] },
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
  // Regeneration is drawn by its own layer; the rest of `heal` is the move's own healing.
  const heal = Math.max(0, (event.heal ?? 0) - (event.regen ?? 0));
  if (event.rage) steps.push(
    { type: 'charge', t: 0, at: 'src', colors: ['#ff3b2f', '#ff7a1a'], dur: 300, count: 10 },
    { type: 'stamp', t: 0, at: 'src', shape: 'anger', colors: ['#ff3b2f'], size: 0.3, dx: 0.75, dy: -0.85, dur: 700 },
  );
  if (event.blocked) steps.push({ type: 'ring', t: t0, at: 'tgt', shape: 'hex', color: '#9fd0ff', width: 5, dur: 420 }, { type: 'bubble', t: t0, at: 'tgt', color: '#9fd0ff', hex: true, size: 1.25, dur: 420 });
  if (event.absorbed) steps.push({ type: 'flash', t: t0, at: 'tgt', color: '#bfe6ff', alpha: 0.6, size: 1.8, dur: 300 }, { type: 'burst', t: t0, at: 'tgt', shape: 'shard', colors: ['#bfe6ff', '#ffffff'], count: 10, speed: [160, 320], life: [300, 500], size: [3, 5], gravity: 400 });
  // Armour plates take the edge off the blow: a steel hexagon and sparks glancing off.
  if (event.armored) steps.push(
    { type: 'ring', t: t0, at: 'tgt', shape: 'hex', color: '#cfd8e3', from: 64, to: 44, width: 5, dur: 320 },
    { type: 'burst', t: t0 + 20, at: 'tgt', shape: 'spark', colors: STEEL, count: 8, speed: [220, 400], life: [200, 340], size: [2, 3.5], drag: 2 },
  );
  if (event.executed) {
    steps.push(
      { type: 'slash', t: t0 + 80, at: 'tgt', color: '#ff3d3d', count: 2, cross: true, width: 9, len: 1.8, curve: 0.08, gap: 60, dur: 320 },
      { type: 'flash', t: t0 + 80, screen: true, color: '#ff4d4d', alpha: 0.12, dur: 260 },
      { type: 'shake', t: t0 + 100, mag: 9, dur: 300 },
    );
  }
  if (has('burn')) steps.push({ type: 'rise', t: t0 + 120, at: 'tgt', shape: 'flame', colors: FIRE, dur: 600, rate: 28, size: [6, 10], size2: 2, speed: [80, 160] });
  if (has('weaken')) steps.push({ type: 'rise', t: t0 + 160, at: 'tgt', shape: 'arrowDown', colors: ['#8fb8ff'], dur: 380, rate: 12, down: true, size: [6, 9] });
  if (has('sap')) steps.push(backOrbs(['#ffe066'], t0 + 160, { travel: 400 }));
  if (has('buff')) steps.push({ type: 'rise', t: t0 + 120, at: 'src', shape: 'arrowUp', colors: GOLD, dur: 420, rate: 14, size: [7, 10] }, { type: 'ring', t: t0 + 120, at: 'src', color: '#ffd76a', width: 4, dur: 400 });
  if (has('shield')) steps.push({ type: 'bubble', t: t0 + 120, at: 'src', color: BRAND[brand]?.shield ?? '#8fd3ff', hex: true, size: 1.35, dur: 800 });
  if (has('shatter')) steps.push(
    { type: 'ring', t: t0 - 60, at: 'tgt', shape: 'hex', color: '#bfe6ff', from: 56, to: 64, width: 5, dur: 160 },
    { type: 'burst', t: t0 + 40, at: 'tgt', shape: 'shard', colors: ['#bfe6ff', '#ffffff', '#ffd76a'], count: 16, speed: [200, 420], life: [320, 560], size: [3, 6], gravity: 500 },
    { type: 'ring', t: t0 + 40, at: 'tgt', shape: 'hex', color: '#ffffff', from: 50, to: 120, width: 4, dur: 320 },
  );
  // Thorns: green spikes fly back from the target into the attacker.
  if (event.thorns) steps.push({ type: 'projectile', t: t0 + 140, from: 'tgt', to: 'src', shape: 'thorn', colors: ['#5fbf4a', '#9be07a', '#3f8f3a'], size: 8, count: 3, gap: 45, fan: 12, spread: 10,
    travel: 260, face: true, arc: 0.12, alternate: true, hitOnce: true, ease: 'in',
    onHit: [{ type: 'burst', shape: 'spark', colors: ['#7bd88f', '#ff6b6b'], count: 8, speed: [120, 260], life: [240, 400], size: [2, 4] }, { type: 'shake', mag: 3, dur: 160 }] });
  // Last stand: a golden heart refuses to break.
  if (event.saved) steps.push(
    { type: 'stamp', t: t0 + 160, at: 'tgt', shape: 'heart', colors: ['#ffd76a'], size: 0.42, dy: -0.15, halo: '#ffd76a', dur: 900 },
    { type: 'ring', t: t0 + 160, at: 'tgt', color: '#ffd76a', from: 20, to: 120, width: 6, dur: 520 },
    { type: 'burst', t: t0 + 220, at: 'tgt', shape: 'star', colors: GOLD, count: 8, speed: [80, 200], life: [500, 800], size: [5, 8] },
  );
  if (has('team')) steps.push({ type: 'rise', t: t0 + 100, at: 'src', shape: 'heart', colors: ['#ff7a86', '#ffffff'], dur: 600, rate: 20 });
  const drained = skill?.drain && !covered.has('drain') && heal;
  if (drained) steps.push(backOrbs(['#8ff0b0'], t0 + 160, { size: 5 }));
  // Vampiric bite: a basic hit that heals sends drops of red back to the attacker.
  if (event.command === 'hit' && heal) steps.push({ type: 'projectile', t: t0 + 120, from: 'tgt', to: 'src', shape: 'drop', colors: ['#ff4d6d', '#d8274f'], size: 5, count: 3, gap: 60, fan: 12, travel: 380, arc: 0.3, alternate: true,
    trail: { shape: 'dot', colors: ['#ff8fa3'], size: [2, 3], rate: 35 } });
  if (heal && !['heal', 'team', 'drain'].some((k) => covered.has(k)) && !drained) steps.push({ type: 'rise', t: t0 + 140, at: 'src', shape: 'plus', colors: HEAL, dur: 480, rate: 18 });
  if (has('cleanse')) steps.push({ type: 'rise', t: t0 + 140, at: 'src', shape: 'drop', colors: ICE, dur: 420, rate: 16, size: [4, 7], speed: [40, 90], down: true });
  if (event.recoil) steps.push({ type: 'burst', t: t0 + 220, at: 'src', shape: 'spark', colors: ['#ff6b6b', '#ffd166'], count: 10, speed: [140, 300], life: [260, 460], size: [2, 4] }, { type: 'shake', t: t0 + 220, mag: 3, dur: 200 });
  return steps;
}

// Regeneration after the fighter's own turn: a soft green pulse and leaves spiralling up.
function regenFx(t) {
  return [
    { type: 'ring', t, at: 'src', color: '#7fdc8a', from: 20, to: 80, width: 4, dur: 500 },
    { type: 'orbit', t, at: 'src', shape: ['plus', 'leaf'], colors: [...HEAL, ...HERB], count: 6, from: 1.2, to: 0.7, turns: 0.8, dy: 0.5, lift: 1.1, size: 7, dur: 720 },
  ];
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

// ------------------------------------------------------------------------------ super moves
// Every super move opens with the same short golden signature (the arena dims, gold gathers
// on the fighter), so a super move reads as one at a glance, then plays its own scene.
const HOT = ['#fff1a1', '#ff7a1a', '#ff3d12'];
const CONFETTI = ['#ffd75a', '#ff6b8b', '#7fdcff', '#ffffff', '#9be07a'];
const ultIntro = (dim, color) => [
  { type: 'dim', t: 0, dur: dim, color, alpha: 0.5 },
  { type: 'ring', t: 0, at: 'src', color: '#ffd76a', from: 120, to: 26, width: 6, dur: 320 },
  { type: 'burst', t: 40, at: 'src', shape: 'twinkle', colors: GOLD, count: 12, speed: [90, 220], life: [380, 620], size: [4, 8] },
  { type: 'flash', t: 140, at: 'src', color: '#ffd76a', alpha: 0.5, size: 1.8, dur: 280 },
];
const heavy = (colors, o = {}) => impact(colors, { big: true, ...o });

const ULT = {
  // The crown rises over the king, then drops onto the enemy and breaks its defences.
  'bk-angus-parmigiano': () => ({
    covers: ['shatter'],
    steps: [
      { type: 'spot', t: 150, at: 'src', dur: 900, color: '#fff2b0' },
      { type: 'stamp', t: 200, at: 'src', shape: 'crown', size: 0.6, dy: -1.1, halo: '#ffd76a', dur: 520, lift: 0.5 },
      { type: 'rise', t: 220, at: 'src', shape: 'twinkle', colors: GOLD, dur: 380, rate: 18, size: [4, 7] },
      { type: 'slam', t: 640, at: 'tgt', shape: 'crown', size: 0.95, height: 3.4, fall: 380, hold: 320, halo: '#ffd76a', ground: 0.75, hit: true,
        onHit: [
          { type: 'ring', shape: 'hex', color: '#cfe8ff', from: 40, to: 130, width: 5, dur: 360 },
          { type: 'burst', shape: 'shard', colors: ['#ffffff', '#cfe8ff', '#ffd76a'], count: 16, speed: [260, 560], life: [400, 700], size: [4, 7], gravity: 600 },
          groundRing('#ffd76a', { to: 200, width: 8, dur: 560 }),
          { type: 'flash', screen: true, color: '#fff2b0', alpha: 0.2, dur: 320 },
          ...heavy(GOLD, { debris: 'star', debrisColors: GOLD, debrisCount: 8 }),
        ] },
      { type: 'rain', t: 1150, at: 'tgt', shape: 'twinkle', colors: GOLD, count: 10, dur: 420, fall: 380, size: [4, 7] },
    ],
  }),
  // A red-hot grill closes over the enemy: fire from below, three sizzling grill marks, smoke.
  'bk-whopper': () => ({
    covers: ['burn'],
    steps: [
      charge(FIRE, 180, { dur: 360, shape: 'flame' }),
      { type: 'pillar', t: 420, at: 'tgt', colors: ['#fff3a8', '#ff7a1a'], width: 0.95, height: 2.4, dur: 950, alpha: 0.55 },
      { type: 'stamp', t: 440, at: 'tgt', shape: 'grill', size: 0.8, dy: 0, dur: 860, halo: '#ff7a1a' },
      { type: 'rise', t: 440, at: 'tgt', shape: 'flame', colors: FIRE, dur: 650, rate: 34, size: [7, 12], size2: 2, speed: [120, 220], width: 1.1 },
      { type: 'slash', t: 780, at: 'tgt', color: '#ff8a2a', count: 3, angle: -0.3, curve: 0, space: 20, width: 9, len: 1.35, gap: 90, dur: 420, hit: true },
      ...later(780, heavy(FIRE)),
      { type: 'flash', t: 780, screen: true, color: '#ffb366', alpha: 0.14, dur: 300 },
      { type: 'burst', t: 1100, at: 'tgt', shape: 'smoke', colors: SMOKE, count: 8, angle: -Math.PI / 2, spread: 0.6, speed: [50, 110], life: [700, 900], size: [8, 12], size2: 26 },
      { type: 'burst', t: 1100, at: 'tgt', shape: 'spark', colors: FIRE, count: 10, angle: -Math.PI / 2, spread: 0.9, speed: [80, 200], life: [600, 900], size: [2, 3], gravity: -40 },
    ],
  }),
  // Two flaming patties swing in on wide arcs from both sides and clap the enemy between them.
  'bk-double-whopper': () => ({
    covers: ['shatter'],
    steps: [
      charge(FIRE, 160, { dur: 380, shape: 'flame' }),
      { type: 'orbit', t: 200, at: 'src', shape: 'patty', count: 2, from: 1.4, to: 1.0, turns: 1.2, size: 15, dur: 420 },
      ...[0.62, -0.62].map((arc, i) => toss('patty', { t: 620, size: 19, travel: 420, arc, spin: arc * 12, grow: 1.25, hit: i === 0,
        trail: { shape: 'flame', colors: FIRE, size: [4, 8], size2: 1, rate: 55 },
        onHit: i ? [] : [
          { type: 'slash', color: '#fff1a1', count: 1, angle: -Math.PI / 2, curve: 0, width: 12, len: 1.6, dur: 280 },
          { type: 'ring', color: '#ffb15c', width: 9, dur: 520 },
          { type: 'ring', t: 110, color: '#ffffff', width: 5, dur: 460 },
          { type: 'burst', shape: 'shard', colors: ['#ffffff', '#cfe8ff', '#ffb15c'], count: 14, speed: [260, 520], life: [400, 650], size: [4, 7], gravity: 600 },
          { type: 'flash', screen: true, color: '#ffc68a', alpha: 0.2, dur: 300 },
          ...heavy(FIRE, { debris: 'crumb', debrisColors: CRUMB, debrisCount: 8 }),
        ] })),
      { type: 'burst', t: 1100, at: 'tgt', shape: 'smoke', colors: SMOKE, count: 7, angle: -Math.PI / 2, spread: 0.6, speed: [50, 100], life: [700, 900], size: [7, 11], size2: 22 },
    ],
  }),
  // The ice age: snow falls, an ice column freezes the enemy, its energy is pulled away and
  // the cola wraps itself in ice.
  'bk-cola-08': () => ({
    covers: ['sap', 'shield'],
    dim: '#06233d',
    steps: [
      { type: 'stamp', t: 150, at: 'src', shape: 'cup', colors: ['#d62300'], size: 0.58, dy: -1.05, halo: '#a9e4ff', dur: 720 },
      { type: 'rain', t: 220, at: 'tgt', shape: 'snowflake', colors: ICE, count: 14, dur: 700, fall: 640, size: [5, 9], spin: [-2, 2], width: 1.6 },
      { type: 'charge', t: 380, at: 'tgt', colors: ICE, dur: 400, count: 16 },
      { type: 'pillar', t: 780, at: 'tgt', colors: ['#ffffff', '#8fd3ff'], width: 0.7, height: 2.8, dur: 700, hit: true },
      { type: 'bubble', t: 780, at: 'tgt', color: '#bfeaff', hex: true, size: 1.15, dur: 700 },
      { type: 'burst', t: 780, at: 'tgt', dy: 0.5, angle: -Math.PI / 2, spread: 0.7, shape: 'shard', colors: ICE, count: 14, speed: [320, 560], life: [400, 650], size: [5, 9], gravity: 900 },
      ...later(780, heavy(ICE, { count: 12 })),
      { type: 'flash', t: 780, screen: true, color: '#dff6ff', alpha: 0.22, dur: 340 },
      backOrbs(['#ffe066'], 1250, { size: 5, count: 5 }),
      { type: 'bubble', t: 1600, at: 'src', color: '#a9e4ff', hex: true, size: 1.4, dur: 880 },
      { type: 'orbit', t: 1600, at: 'src', shape: 'snowflake', colors: ICE, count: 6, from: 1.55, to: 1.35, turns: 0.6, size: 7, dur: 880 },
    ],
  }),
  // A stage hit: spotlights and music, a giant bun drops on the enemy like a mic drop, the
  // shield comes up with notes circling it.
  'vkusno-big-hit': () => ({
    covers: ['shield'],
    steps: [
      { type: 'spot', t: 120, at: 'src', dx: -1.3, dur: 1000 },
      { type: 'spot', t: 180, at: 'src', dx: 1.3, dur: 1000, color: '#ffe08a' },
      { type: 'rise', t: 250, at: 'src', shape: 'note', colors: ['#ffd75a', '#ffffff', '#ff8f6b'], dur: 520, rate: 10, size: [8, 11], speed: [70, 130], wobble: 60 },
      { type: 'slam', t: 620, at: 'tgt', shape: 'bun', size: 1.0, height: 3.6, fall: 420, hold: 280, halo: '#ffd75a', hit: true,
        onHit: [
          ...heavy(GOLD, { debris: 'seed', debrisColors: ['#fff1cf'], debrisCount: 14 }),
          groundRing('#ffd75a', { to: 220, width: 9, dur: 600 }),
          groundRing('#ffffff', { t: 120, to: 160, dur: 520 }),
          { type: 'flash', screen: true, color: '#fff4c2', alpha: 0.2, dur: 320 },
          { type: 'burst', shape: 'note', colors: ['#ffd75a', '#ffffff'], count: 6, speed: [140, 260], life: [600, 900], size: [8, 11], gravity: 200, spin: [-2, 2] },
        ] },
      { type: 'bubble', t: 1400, at: 'src', color: '#7fdc8a', hex: true, size: 1.45, dur: 950 },
      { type: 'orbit', t: 1400, at: 'src', shape: 'note', colors: ['#ffd75a', '#ffffff'], count: 5, from: 1.65, to: 1.45, turns: 0.7, size: 9, dur: 950 },
    ],
  }),
  // Fireworks: three rockets burst over the enemy, then a golden finale and the fighter powers up.
  'vkusno-grand': () => ({
    covers: ['buff'],
    steps: [
      { type: 'ring', t: 200, at: 'src', color: '#ffd75a', width: 5, dur: 420 },
      { type: 'projectile', t: 340, shape: 'orb', colors: ['#ffffff'], size: 7, halo: '#ffd75a', count: 3, gap: 170, spread: 24, lob: 0.55, arc: 0.12, alternate: true, travel: 480, ease: 'out', hit: true,
        trail: { shape: 'spark', colors: GOLD, size: [3, 5], rate: 80, rise: 40 },
        onHit: [
          { type: 'burst', dy: -0.35, jitter: 30, shape: ['star', 'twinkle'], colors: CONFETTI, count: 16, speed: [180, 380], life: [700, 1000], size: [5, 9], drag: 2.2, gravity: 120 },
          { type: 'flash', color: '#fff4c2', alpha: 0.35, size: 1.4, dur: 200 },
          { type: 'shake', mag: 4, dur: 200 },
        ] },
      { type: 'flash', t: 1240, screen: true, color: '#fff4c2', alpha: 0.18, dur: 320 },
      ...later(1240, heavy(GOLD, { debris: 'star', debrisColors: CONFETTI, debrisCount: 10 })),
      { type: 'rain', t: 1300, at: 'tgt', shape: 'twinkle', colors: CONFETTI, count: 12, dur: 500, fall: 520, size: [3, 6], width: 1.6 },
      { type: 'rise', t: 1450, at: 'src', shape: 'arrowUp', colors: GOLD, dur: 520, rate: 16, size: [7, 10] },
      { type: 'ring', t: 1450, at: 'src', color: '#ffd76a', width: 4, dur: 420 },
    ],
  }),
  // A premiere: the spotlight and camera flashes, then one golden lance straight through the enemy.
  'vkusno-chicken-premier': () => ({
    steps: [
      { type: 'spot', t: 120, at: 'src', dur: 900 },
      ...[0, 1, 2].map((i) => ({ type: 'burst', t: 240 + i * 120, at: 'src', jitter: 46, shape: 'twinkle', colors: ['#ffffff'], count: 2, speed: [10, 30], life: [160, 240], size: [11, 15] })),
      charge(['#ffffff', '#ffd75a'], 420, { dur: 400, count: 22 }),
      { type: 'bolt', t: 840, color: '#ffd75a', width: 14, amp: 0, segments: 2, dur: 400, hit: true },
      { type: 'bolt', t: 850, color: '#ffffff', width: 5, amp: 0, segments: 2, dur: 320 },
      { type: 'burst', t: 850, at: 'tgt', along: true, spread: 0.22, shape: 'spark', colors: ['#ffffff', ...GOLD], count: 20, speed: [520, 900], life: [260, 460], size: [3, 5] },
      { type: 'ring', t: 850, at: 'tgt', shape: 'hex', color: '#cfe8ff', from: 40, to: 110, width: 5, dur: 360 },
      ...later(850, heavy(GOLD, { debris: 'crumb', debrisColors: CRUMB })),
      { type: 'flash', t: 850, screen: true, color: '#fff4c2', alpha: 0.2, dur: 300 },
      { type: 'rain', t: 1250, at: 'src', shape: ['twinkle', 'star'], colors: CONFETTI, count: 10, dur: 500, fall: 480, size: [4, 7], width: 1.4 },
    ],
  }),
  // The chef at work: a flurry of knife chops, ingredients whirling in, the taste back to the
  // chef and hearts for the whole team.
  'rostics-chefburger': () => ({
    covers: ['drain', 'team'],
    steps: [
      { type: 'stamp', t: 150, at: 'src', shape: 'toque', size: 0.5, dy: -1.15, dur: 950, lift: 0.15, halo: '#ffffff' },
      { type: 'orbit', t: 300, at: 'tgt', shape: ['leaf', 'seed', 'pepperoni', 'cube'], colors: [...HERB, '#ffd23f', '#e8322a'], count: 10, from: 2.0, to: 0.8, turns: 1.2, size: 7, dur: 900 },
      { type: 'slash', t: 640, at: 'tgt', color: '#ffffff', count: 6, angle: -1.45, cross: true, curve: 0.04, space: 12, width: 6, len: 1.3, gap: 70, dur: 240, hit: true },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ type: 'burst', t: 660 + i * 70, at: 'tgt', jitter: 18, shape: 'spark', colors: STEEL, count: 4, speed: [180, 320], life: [200, 340], size: [2, 3.5] })),
      ...later(1040, heavy(SPICE, { debris: 'leaf', debrisColors: HERB, debrisCount: 8 })),
      backOrbs(['#8ff0b0'], 1220, { size: 5, count: 5, travel: 440 }),
      { type: 'rise', t: 1560, at: 'src', shape: 'heart', colors: ['#ff7a86', '#ffffff', ...HEAL], dur: 700, rate: 22, size: [6, 10], width: 1.4 },
      { type: 'ring', t: 1560, at: 'src', color: '#ff7a86', width: 5, dur: 600 },
    ],
  }),
  // Knockout: the glove winds up, then a punch that grows as it flies; stars circle the head.
  'rostics-boxmaster': () => ({
    dim: '#200008',
    steps: [
      { type: 'stamp', t: 150, at: 'src', shape: 'glove', size: 0.5, dy: -0.15, dx: -0.4, tilt: Math.PI, spin: -0.5, halo: '#ff3347', dur: 520 },
      { type: 'charge', t: 160, at: 'src', colors: ['#ffffff', '#ff3347'], dur: 460, count: 18 },
      toss('glove', { t: 640, size: 15, travel: 260, ease: 'in', face: true, spin: 0, arc: 0.04, grow: 2, halo: '#ff3347', hit: true,
        trail: { shape: 'spark', colors: ['#ffffff'], size: [2, 4], rate: 90 },
        onHit: [
          ...heavy(['#ffffff', '#ff3347', '#ffd166'], { shake: 9 }),
          { type: 'ring', t: 90, color: '#ff3347', width: 7, dur: 420 },
          { type: 'flash', screen: true, color: '#ffffff', alpha: 0.32, dur: 240 },
          { type: 'burst', along: true, spread: 0.4, shape: 'spark', colors: ['#ffffff', '#ffd166'], count: 14, speed: [400, 700], life: [240, 400], size: [3, 5] },
        ] }),
      { type: 'orbit', t: 1100, at: 'tgt', shape: 'star', colors: ['#ffd166', '#ffffff'], count: 4, from: 0.75, to: 0.75, turns: 1.6, flat: 0.32, dy: -1.05, size: 8, dur: 1100 },
    ],
  }),
  // A fire tornado spins up around the enemy, wings caught in it, embers raining after.
  'rostics-wings': () => ({
    covers: ['burn'],
    steps: [
      charge(SPICE, 150, { dur: 380, shape: 'flame' }),
      toss('wing', { t: 420, size: 12, count: 3, gap: 60, fan: 10, alternate: true, arc: 0.3, spin: 14, travel: 340, hitOnce: true, hit: true, onHit: impact(SPICE, { count: 10 }) }),
      { type: 'pillar', t: 740, at: 'tgt', colors: HOT, width: 0.5, height: 3.4, dur: 1000, alpha: 0.6 },
      { type: 'orbit', t: 700, at: 'tgt', shape: 'flame', colors: FIRE, count: 18, from: 0.45, to: 0.7, funnel: 1.6, stack: 2.6, dy: 0.8, lift: 0.3, turns: 3, flat: 0.3, size: 10, dur: 1100 },
      { type: 'orbit', t: 780, at: 'tgt', shape: ['wing', 'seed'], colors: SPICE, count: 5, from: 0.5, to: 0.8, funnel: 1, stack: 2, dy: 0.5, turns: 2.4, flat: 0.3, size: 8, dur: 1000 },
      { type: 'flash', t: 760, screen: true, color: '#ff9a5a', alpha: 0.14, dur: 300 },
      ...later(1100, heavy(SPICE, { count: 10 })),
      { type: 'rain', t: 1600, at: 'tgt', shape: 'dot', colors: FIRE, count: 12, dur: 400, fall: 420, size: [2, 4], width: 1.4 },
    ],
  }),
  // A huge pizza spins over the enemy and sheds a storm of burning pepperoni.
  'dodo-pepperoni': () => ({
    covers: ['burn'],
    steps: [
      charge(FIRE, 150, { dur: 400, shape: 'flame', count: 24 }),
      { type: 'stamp', t: 300, at: 'tgt', shape: 'pizza', size: 0.75, dy: -1.9, spin: 6, halo: '#ff7a1a', dur: 1300 },
      { type: 'rain', t: 520, at: 'tgt', shape: 'pepperoni', count: 16, dur: 700, fall: 380, top: 1.9, size: [9, 13], spin: [-8, 8], width: 1.3, hit: true,
        splash: { shape: 'flame', colors: FIRE, count: 3, speed: [60, 160], life: [300, 500], size: [4, 7], gravity: -200 } },
      { type: 'flash', t: 1180, screen: true, color: '#ff9a5a', alpha: 0.16, dur: 300 },
      ...later(1180, heavy(FIRE, { debris: 'pepperoni', debrisCount: 6 })),
      { type: 'rise', t: 1250, at: 'tgt', shape: 'flame', colors: FIRE, dur: 700, rate: 32, size: [7, 12], size2: 2, speed: [100, 200], width: 1.2 },
    ],
  }),
  // Cheese walls drop down around the pizza and become a golden fortress; one wedge hits the enemy.
  'dodo-four-cheeses': () => ({
    covers: ['shield', 'heal'],
    steps: [
      toss('cheese', { t: 300, size: 14, travel: 360, spin: 8, colors: CHEESE, hit: true, onHit: impact(CHEESE, { count: 12, debris: 'splat', debrisColors: CHEESE }) }),
      ...[-0.95, 0, 0.95].map((dx, i) => ({ type: 'slam', t: 700 + i * 110, at: 'src', shape: 'cheese', colors: [['#ffe36e', '#ffb84d', '#fff3b0'][i]], dx, dy: 0.45, ground: 0.8, size: 0.5, height: 2.4, fall: 280, hold: 900 - i * 110,
        onHit: [{ type: 'burst', dy: 0.6, shape: 'crumb', colors: CHEESE, count: 6, speed: [80, 200], life: [400, 600], size: [3, 5], gravity: 500 }, { type: 'shake', mag: 3, dur: 160 }] })),
      { type: 'ring', t: 1280, at: 'src', shape: 'hex', color: '#ffd23f', from: 150, to: 60, width: 6, dur: 420 },
      { type: 'bubble', t: 1320, at: 'src', color: '#ffd23f', hex: true, size: 1.55, dur: 1100 },
      { type: 'rise', t: 1450, at: 'src', shape: ['plus', 'twinkle'], colors: [...HEAL, '#ffe36e'], dur: 600, rate: 16 },
    ],
  }),
  // Hellfire: the screen turns red, fire columns burst under the enemy and a chili meteor lands.
  'dodo-diablo': () => ({
    covers: ['burn'],
    dim: '#3a0000',
    steps: [
      charge(SPICE, 150, { dur: 420, shape: 'flame', count: 24 }),
      ...[-0.9, 0.9, 0].map((dx, i) => ({ type: 'pillar', t: 480 + i * 110, at: 'tgt', dx, colors: ['#ffe08a', '#ff2a12'], width: 0.38, height: 3, dur: 800 })),
      { type: 'slam', t: 720, at: 'tgt', shape: 'chili', size: 0.8, height: 3.6, fall: 340, hold: 200, spin: 3, tilt: -0.6, halo: '#ff3d12', hit: true,
        onHit: [
          ...heavy(SPICE, { debris: 'flame', debrisColors: FIRE, debrisCount: 10 }),
          groundRing('#ff3d12', { to: 200, width: 8, dur: 560 }),
          { type: 'flash', screen: true, color: '#ff5a3a', alpha: 0.2, dur: 320 },
        ] },
      { type: 'rise', t: 1150, at: 'tgt', shape: 'flame', colors: FIRE, dur: 800, rate: 34, size: [7, 13], size2: 2, speed: [110, 210], width: 1.2 },
    ],
  }),
  // Two rolls spin up like a buzzsaw, cut the enemy in an X, then a stream of health flows back.
  'dodo-dodster': () => ({
    covers: ['drain'],
    steps: [
      { type: 'orbit', t: 150, at: 'src', shape: 'roll', count: 2, from: 1.3, to: 1.1, turns: 2.2, size: 14, dur: 520 },
      { type: 'rise', t: 150, at: 'src', shape: 'flame', colors: FIRE, dur: 400, rate: 24, size: [5, 9], size2: 2 },
      ...[0.45, -0.45].map((arc, i) => toss('roll', { t: 640 + i * 40, size: 16, spin: arc * 50, travel: 380, arc, hit: i === 0,
        trail: { shape: 'crumb', colors: CRUMB, size: [2, 4], rate: 40 }, onHit: i ? [] : heavy(FIRE, { debris: 'crumb', debrisColors: CRUMB }) })),
      { type: 'slash', t: 1060, at: 'tgt', color: '#ffb067', count: 2, cross: true, width: 10, len: 1.7, gap: 50, dur: 320 },
      { type: 'beam', t: 1240, from: 'tgt', to: 'src', shape: ['dot', 'plus'], colors: ['#8ff0b0', '#5fd98a', '#c9ffd9'], size: [8, 12], size2: 4, dur: 560, rate: 90, speed: [560, 700], spread: 0.12 },
      { type: 'ring', t: 1600, at: 'src', color: '#8ff0b0', from: 20, to: 80, width: 5, dur: 500 },
      { type: 'rise', t: 1600, at: 'src', shape: 'plus', colors: HEAL, dur: 420, rate: 20, life: [500, 700] },
    ],
  }),
};

// Fallback for a super move added later without a recipe: the skill inside a golden frame.
function genericUltimate(id, skill, brand) {
  const base = (SKILL[id] ?? (() => genericSkill(skill, brand)))();
  const steps = base.steps.map((step) => ({ ...step, t: (step.t ?? 0) + 300 }));
  const at = fxTiming(steps).impact;
  steps.push(
    { type: 'ring', t: at, at: 'tgt', color: '#ffd76a', from: 30, to: 150, width: 7, dur: 460 },
    { type: 'burst', t: at, at: 'tgt', shape: 'star', colors: GOLD, count: 10, speed: [160, 320], life: [420, 700], size: [5, 9], gravity: 260 },
    { type: 'shake', t: at, mag: 7, dur: 280 },
  );
  return { ...base, steps };
}

function ultimateFx(id, skill, brand) {
  const recipe = ULT[id]?.() ?? genericUltimate(id, skill, brand);
  const { impact: at, end } = fxTiming(recipe.steps);
  return { ...recipe, steps: [...ultIntro(Math.min(end, at + 800), recipe.dim), ...recipe.steps] };
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
  if (event.regen && !event.command.startsWith('switch:')) steps.push(...regenFx(blow ? timing.impact + 480 : 320));
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

export const RECIPE_IDS = { skill: Object.keys(SKILL), basic: Object.keys(BASIC), ult: Object.keys(ULT) };

// Raw recipes, so tests can compare a super move with the skill it grew from.
export const RECIPES = { skill: SKILL, basic: BASIC, ult: ULT };
