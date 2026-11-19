// Battle effects: one canvas above the page that plays short timelines of particles, flying
// food, beams, shields and flashes between the two fighter portraits. Each move is described
// by a recipe (see fx-moves.js): a list of steps, each starting at `t` milliseconds.
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const val = (v) => (Array.isArray(v) ? rand(v[0], v[1]) : v);
const pick = (list) => (Array.isArray(list) ? list[Math.floor(Math.random() * list.length)] : list);
const ease = {
  out: (k) => 1 - (1 - k) ** 3,
  in: (k) => k * k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  back: (k) => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2,
};
const MAX_PARTICLES = 420;

// ---------------------------------------------------------------------------------------------
// Shapes. Each draws around (0, 0) with size `s` (roughly a radius) in the current transform.
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, Math.max(0, r)) : ctx.rect(x, y, w, h);
}
function blob(ctx, s, seed, points = 9, rough = 0.22) {
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * TAU;
    const r = s * (1 - rough / 2 + rough * Math.abs(Math.sin(seed * 7.3 + i * 2.1)));
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.86;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}
function star(ctx, s, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? s * inner : s;
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v + amount * 255))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Soft round glows are the most common particle, so each color is rendered once and reused.
const sprites = new Map();
function glowSprite(color, edge) {
  const key = color + edge;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const c = sprite.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, edge);
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    sprites.set(key, sprite);
  }
  return sprite;
}

const SHAPES = {
  dot(ctx, s, c) {
    ctx.drawImage(glowSprite(c, 'rgba(0,0,0,0)'), -s, -s, s * 2, s * 2);
  },
  orb(ctx, s, c) {
    SHAPES.dot(ctx, s * 1.8, c);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.45, 0, TAU);
    ctx.fill();
  },
  smoke(ctx, s, c) {
    ctx.drawImage(glowSprite(c, 'rgba(120,120,120,0)'), -s, -s, s * 2, s * 2);
  },
  spark(ctx, s, c, p) {
    const len = s * (1.4 + Math.min(3, Math.hypot(p.vx, p.vy) / 260));
    ctx.strokeStyle = c;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, s * 0.32);
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len * 0.4, 0);
    ctx.stroke();
  },
  star(ctx, s, c) {
    ctx.fillStyle = c;
    star(ctx, s);
    ctx.fill();
  },
  twinkle(ctx, s, c) {
    ctx.fillStyle = c;
    star(ctx, s, 4, 0.22);
    ctx.fill();
  },
  plus(ctx, s, c) {
    ctx.fillStyle = c;
    roundRect(ctx, -s * 0.28, -s, s * 0.56, s * 2, s * 0.2);
    ctx.fill();
    roundRect(ctx, -s, -s * 0.28, s * 2, s * 0.56, s * 0.2);
    ctx.fill();
  },
  heart(ctx, s, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.85);
    ctx.bezierCurveTo(-s * 1.3, -s * 0.1, -s * 0.6, -s * 1.1, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.6, -s * 1.1, s * 1.3, -s * 0.1, 0, s * 0.85);
    ctx.fill();
  },
  ring(ctx, s, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, TAU);
    ctx.stroke();
  },
  flame(ctx, s, c, p) {
    const g = ctx.createRadialGradient(0, s * 0.35, 0, 0, s * 0.2, s * 1.3);
    g.addColorStop(0, p.c2 || '#fff3a8');
    g.addColorStop(0.45, c);
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.5);
    ctx.bezierCurveTo(s * 0.9, -s * 0.4, s * 0.95, s * 0.9, 0, s * 0.95);
    ctx.bezierCurveTo(-s * 0.95, s * 0.9, -s * 0.9, -s * 0.4, 0, -s * 1.5);
    ctx.fill();
  },
  drop(ctx, s, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.3);
    ctx.bezierCurveTo(s * 0.9, -s * 0.2, s * 0.85, s * 0.9, 0, s * 0.9);
    ctx.bezierCurveTo(-s * 0.85, s * 0.9, -s * 0.9, -s * 0.2, 0, -s * 1.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.3, s * 0.15, s * 0.16, s * 0.3, 0.3, 0, TAU);
    ctx.fill();
  },
  splat(ctx, s, c, p) {
    ctx.fillStyle = c;
    blob(ctx, s, p.seed, 12, 0.55);
    ctx.fill();
  },
  shard(ctx, s, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.2);
    ctx.lineTo(s * 0.5, s * 0.6);
    ctx.lineTo(-s * 0.45, s * 0.8);
    ctx.closePath();
    ctx.fill();
  },
  crumb(ctx, s, c, p) {
    ctx.fillStyle = c;
    blob(ctx, s, p.seed, 6, 0.6);
    ctx.fill();
  },
  seed(ctx, s, c) {
    ctx.fillStyle = c || '#fff1cf';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.45, s, 0, 0, TAU);
    ctx.fill();
  },
  sugar(ctx, s, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.6, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.6, 0);
    ctx.closePath();
    ctx.fill();
  },
  bubble(ctx, s, c) {
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.strokeStyle = c;
    ctx.lineWidth = Math.max(1, s * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.62, -2.4, -1.5);
    ctx.stroke();
  },
  cube(ctx, s, c) {
    ctx.fillStyle = c || '#c9eeff';
    ctx.globalAlpha *= 0.85;
    roundRect(ctx, -s, -s, s * 2, s * 2, s * 0.35);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.2);
    ctx.lineTo(-s * 0.55, -s * 0.55);
    ctx.lineTo(-s * 0.2, -s * 0.55);
    ctx.stroke();
  },
  arrowUp(ctx, s, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.42;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, s * 0.3);
    ctx.lineTo(0, -s * 0.5);
    ctx.lineTo(s * 0.8, s * 0.3);
    ctx.stroke();
  },
  arrowDown(ctx, s, c) {
    ctx.rotate(Math.PI);
    SHAPES.arrowUp(ctx, s, c);
  },
  bolt(ctx, s, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.25, -s * 1.2);
    ctx.lineTo(-s * 0.55, s * 0.12);
    ctx.lineTo(-s * 0.02, s * 0.12);
    ctx.lineTo(-s * 0.3, s * 1.2);
    ctx.lineTo(s * 0.6, -s * 0.2);
    ctx.lineTo(s * 0.05, -s * 0.2);
    ctx.closePath();
    ctx.fill();
  },
  hex(ctx, s, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) ctx.lineTo(Math.cos((i / 6) * TAU) * s, Math.sin((i / 6) * TAU) * s);
    ctx.closePath();
    ctx.stroke();
  },
  // Food.
  fry(ctx, s, c) {
    const w = s * 0.42, h = s * 2.3;
    const g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, '#e9a12a');
    g.addColorStop(0.5, c || '#ffd45a');
    g.addColorStop(1, '#d88a1f');
    ctx.fillStyle = g;
    roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.35);
    ctx.fill();
  },
  wedge(ctx, s) {
    ctx.fillStyle = '#c9822f';
    ctx.beginPath();
    ctx.moveTo(-s * 1.1, s * 0.35);
    ctx.quadraticCurveTo(0, -s * 1.1, s * 1.1, s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f6d27a';
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, s * 0.3);
    ctx.quadraticCurveTo(0, -s * 0.6, s * 0.8, s * 0.3);
    ctx.closePath();
    ctx.fill();
  },
  onion(ctx, s) {
    ctx.lineWidth = s * 0.5;
    ctx.strokeStyle = '#d6912e';
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.8, 0, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = s * 0.16;
    ctx.strokeStyle = '#ffd77a';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.9, s * 0.72, 0, 3.6, 5.6);
    ctx.stroke();
  },
  pepperoni(ctx, s, c, p) {
    ctx.fillStyle = '#b8261b';
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#8f160f';
    ctx.lineWidth = s * 0.14;
    ctx.stroke();
    ctx.fillStyle = '#e9a08a';
    for (let i = 0; i < 5; i++) {
      const a = p.seed * 5 + i * 1.3, r = s * (0.25 + 0.4 * ((i * 37) % 10) / 10);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, s * 0.12, 0, TAU);
      ctx.fill();
    }
  },
  slice(ctx, s) {
    ctx.fillStyle = '#ffd25e';
    ctx.beginPath();
    ctx.moveTo(0, s * 1.3);
    ctx.lineTo(-s * 0.95, -s * 0.8);
    ctx.quadraticCurveTo(0, -s * 1.25, s * 0.95, -s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#c47a2c';
    ctx.lineWidth = s * 0.32;
    ctx.beginPath();
    ctx.moveTo(-s * 0.95, -s * 0.8);
    ctx.quadraticCurveTo(0, -s * 1.25, s * 0.95, -s * 0.8);
    ctx.stroke();
    ctx.fillStyle = '#c0311f';
    for (const [x, y] of [[-0.3, -0.45], [0.35, -0.35], [0, 0.25]]) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, s * 0.2, 0, TAU);
      ctx.fill();
    }
  },
  cheese(ctx, s, c) {
    ctx.fillStyle = c || '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(-s, s * 0.7);
    ctx.lineTo(s, s * 0.7);
    ctx.lineTo(s * 0.8, -s * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(c || '#ffd23f', -0.18);
    for (const [x, y, r] of [[0.1, 0.3, 0.17], [0.55, -0.05, 0.12], [-0.4, 0.45, 0.1]]) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, r * s, 0, TAU);
      ctx.fill();
    }
  },
  leaf(ctx, s, c) {
    ctx.fillStyle = c || '#3fae49';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.55, s, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.85);
    ctx.lineTo(0, s * 0.85);
    ctx.stroke();
  },
  patty(ctx, s) {
    ctx.fillStyle = '#5a2e17';
    roundRect(ctx, -s * 1.2, -s * 0.42, s * 2.4, s * 0.84, s * 0.42);
    ctx.fill();
    ctx.strokeStyle = '#2e170b';
    ctx.lineWidth = s * 0.12;
    for (const x of [-0.6, 0, 0.6]) {
      ctx.beginPath();
      ctx.moveTo((x - 0.2) * s, -s * 0.3);
      ctx.lineTo((x + 0.2) * s, s * 0.3);
      ctx.stroke();
    }
  },
  bun(ctx, s) {
    ctx.fillStyle = '#e39a3b';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.15, s * 1.2, s * 0.85, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#5a2e17';
    roundRect(ctx, -s * 1.2, s * 0.1, s * 2.4, s * 0.38, s * 0.18);
    ctx.fill();
    ctx.fillStyle = '#77c043';
    roundRect(ctx, -s * 1.25, s * 0.02, s * 2.5, s * 0.14, s * 0.07);
    ctx.fill();
    ctx.fillStyle = '#e39a3b';
    roundRect(ctx, -s * 1.15, s * 0.45, s * 2.3, s * 0.34, s * 0.17);
    ctx.fill();
    ctx.fillStyle = '#fff1cf';
    for (const [x, y] of [[-0.5, -0.35], [0, -0.55], [0.5, -0.35], [-0.2, -0.2], [0.3, -0.15]]) {
      ctx.beginPath();
      ctx.ellipse(x * s, y * s, s * 0.06, s * 0.12, x, 0, TAU);
      ctx.fill();
    }
  },
  nugget(ctx, s, c, p) {
    ctx.fillStyle = c || '#e2a443';
    blob(ctx, s, p.seed, 9, 0.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,230,160,.6)';
    blob(ctx, s * 0.55, p.seed + 1, 7, 0.4);
    ctx.fill();
  },
  strip(ctx, s) {
    ctx.fillStyle = '#d68a2a';
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) ctx.lineTo(-s * 1.6 + (i / 10) * s * 3.2, -s * 0.38 + Math.sin(i * 2.3) * s * 0.08);
    for (let i = 10; i >= 0; i--) ctx.lineTo(-s * 1.6 + (i / 10) * s * 3.2, s * 0.38 + Math.cos(i * 2.1) * s * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,224,150,.55)';
    roundRect(ctx, -s * 1.3, -s * 0.14, s * 2.6, s * 0.16, s * 0.08);
    ctx.fill();
  },
  wing(ctx, s, c, p) {
    ctx.fillStyle = '#b4521d';
    blob(ctx, s, p.seed, 8, 0.3);
    ctx.fill();
    ctx.fillStyle = '#e34b2a';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(Math.cos(i * 1.7 + p.seed) * s * 0.5, Math.sin(i * 1.7) * s * 0.4, s * 0.1, 0, TAU);
      ctx.fill();
    }
  },
  drumstick(ctx, s) {
    ctx.fillStyle = '#f2e6cf';
    roundRect(ctx, s * 0.3, -s * 0.15, s * 1.1, s * 0.3, s * 0.15);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s * 1.4, -s * 0.15, s * 0.2, 0, TAU);
    ctx.arc(s * 1.4, s * 0.15, s * 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#c7782b';
    ctx.beginPath();
    ctx.ellipse(-s * 0.3, 0, s * 0.85, s * 0.62, 0, 0, TAU);
    ctx.fill();
  },
  shrimp(ctx, s) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#e8762c';
    ctx.lineWidth = s * 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.7, -0.5, 3.6);
    ctx.stroke();
    ctx.strokeStyle = '#ffb36b';
    ctx.lineWidth = s * 0.12;
    for (let i = 0; i < 4; i++) {
      const a = -0.2 + i * 0.85;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45);
      ctx.lineTo(Math.cos(a) * s * 0.95, Math.sin(a) * s * 0.95);
      ctx.stroke();
    }
  },
  cherry(ctx, s) {
    ctx.strokeStyle = '#3e7d2b';
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.6);
    ctx.quadraticCurveTo(s * 0.3, -s * 1.3, s * 0.7, -s * 1.4);
    ctx.stroke();
    ctx.fillStyle = '#b3122c';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath();
    ctx.arc(-s * 0.25, -s * 0.25, s * 0.16, 0, TAU);
    ctx.fill();
  },
  pie(ctx, s) {
    ctx.fillStyle = '#d99a3e';
    roundRect(ctx, -s * 1.2, -s * 0.6, s * 2.4, s * 1.2, s * 0.4);
    ctx.fill();
    ctx.strokeStyle = '#8f2a1c';
    ctx.lineWidth = s * 0.14;
    for (const x of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo((x - 0.15) * s, -s * 0.3);
      ctx.lineTo((x + 0.15) * s, s * 0.3);
      ctx.stroke();
    }
  },
  macaron(ctx, s, c) {
    ctx.fillStyle = c || '#ffb3cf';
    roundRect(ctx, -s, -s * 0.62, s * 2, s * 0.5, s * 0.25);
    ctx.fill();
    roundRect(ctx, -s, s * 0.12, s * 2, s * 0.5, s * 0.25);
    ctx.fill();
    ctx.fillStyle = '#fff7ef';
    roundRect(ctx, -s * 0.9, -s * 0.14, s * 1.8, s * 0.28, s * 0.12);
    ctx.fill();
  },
  roll(ctx, s) {
    ctx.fillStyle = '#efd7a4';
    roundRect(ctx, -s * 1.3, -s * 0.5, s * 2.6, s * 1, s * 0.5);
    ctx.fill();
    ctx.strokeStyle = '#c99a55';
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.5);
    ctx.quadraticCurveTo(-s * 0.2, 0, -s * 0.5, s * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#7cc04a';
    ctx.beginPath();
    ctx.ellipse(s * 1.25, 0, s * 0.2, s * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d64a2a';
    ctx.beginPath();
    ctx.arc(s * 1.25, s * 0.1, s * 0.13, 0, TAU);
    ctx.fill();
  },
  cup(ctx, s, c) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-s * 0.75, -s);
    ctx.lineTo(s * 0.75, -s);
    ctx.lineTo(s * 0.55, s * 1.1);
    ctx.lineTo(-s * 0.55, s * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c || '#d62300';
    ctx.beginPath();
    ctx.moveTo(-s * 0.69, -s * 0.4);
    ctx.lineTo(s * 0.69, -s * 0.4);
    ctx.lineTo(s * 0.6, s * 0.5);
    ctx.lineTo(-s * 0.6, s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8e8e8';
    roundRect(ctx, -s * 0.85, -s * 1.15, s * 1.7, s * 0.22, s * 0.1);
    ctx.fill();
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    ctx.moveTo(s * 0.1, -s * 1.1);
    ctx.lineTo(s * 0.35, -s * 1.7);
    ctx.stroke();
  },
  medallion(ctx, s) {
    ctx.fillStyle = '#d9902c';
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f2b54a';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.76, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.moveTo(s * 0.7, -s * 0.2);
    ctx.quadraticCurveTo(s * 1.3, s * 0.1, s * 1.05, s * 0.7);
    ctx.quadraticCurveTo(s * 0.8, s * 0.3, s * 0.55, s * 0.4);
    ctx.fill();
  },
  crown(ctx, s) {
    const g = ctx.createLinearGradient(0, -s, 0, s);
    g.addColorStop(0, '#fff2a8');
    g.addColorStop(1, '#e0a419');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-s * 1.2, s * 0.7);
    ctx.lineTo(-s * 1.3, -s * 0.6);
    ctx.lineTo(-s * 0.6, 0);
    ctx.lineTo(0, -s * 1);
    ctx.lineTo(s * 0.6, 0);
    ctx.lineTo(s * 1.3, -s * 0.6);
    ctx.lineTo(s * 1.2, s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d62300';
    for (const x of [-0.6, 0, 0.6]) {
      ctx.beginPath();
      ctx.arc(x * s, s * 0.38, s * 0.14, 0, TAU);
      ctx.fill();
    }
  },
  basket(ctx, s) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.6);
    ctx.lineTo(s, -s * 0.6);
    ctx.lineTo(s * 0.75, s);
    ctx.lineTo(-s * 0.75, s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e4002b';
    for (const x of [-0.62, -0.08, 0.46]) {
      ctx.beginPath();
      ctx.moveTo((x) * s, -s * 0.6);
      ctx.lineTo((x + 0.22) * s, -s * 0.6);
      ctx.lineTo((x + 0.18) * s, s);
      ctx.lineTo((x + 0.02) * s, s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#c7782b';
    for (const x of [-0.55, 0, 0.55]) {
      ctx.beginPath();
      ctx.ellipse(x * s, -s * 0.72, s * 0.32, s * 0.24, x, 0, TAU);
      ctx.fill();
    }
  },
  cake(ctx, s, c) {
    ctx.fillStyle = c || '#fff4dc';
    ctx.beginPath();
    ctx.moveTo(-s * 1.1, s * 0.5);
    ctx.lineTo(s * 1.1, s * 0.5);
    ctx.lineTo(s * 1.1, -s * 0.2);
    ctx.lineTo(-s * 0.7, -s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b77a3a';
    roundRect(ctx, -s * 1.1, s * 0.5, s * 2.2, s * 0.32, s * 0.08);
    ctx.fill();
    ctx.fillStyle = '#d8274f';
    ctx.beginPath();
    ctx.arc(s * 0.2, -s * 0.5, s * 0.22, 0, TAU);
    ctx.fill();
  },
  potato(ctx, s) {
    ctx.fillStyle = '#b8732d';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.1, s * 0.7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f2cf7d';
    ctx.beginPath();
    ctx.ellipse(s * 0.12, -s * 0.05, s * 0.8, s * 0.48, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#5d8f2e';
    for (const [x, y] of [[-0.2, -0.1], [0.3, 0.1]]) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, s * 0.08, 0, TAU);
      ctx.fill();
    }
  },
  pizza(ctx, s) {
    ctx.fillStyle = '#c9802f';
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffd25e';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.82, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#c0311f';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(Math.cos(i * 1.05) * s * 0.5, Math.sin(i * 1.05) * s * 0.5, s * 0.14, 0, TAU);
      ctx.fill();
    }
  },
  chili(ctx, s) {
    ctx.fillStyle = '#d81e12';
    ctx.beginPath();
    ctx.moveTo(-s * 1.1, -s * 0.2);
    ctx.quadraticCurveTo(-s * 0.2, -s * 0.55, s * 1.2, s * 0.6);
    ctx.quadraticCurveTo(-s * 0.1, s * 0.2, -s * 1.1, s * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.2, -s * 0.18, s * 0.45, s * 0.08, 0.25, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#3f8f2b';
    ctx.lineWidth = s * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 1.05, 0);
    ctx.quadraticCurveTo(-s * 1.4, -s * 0.1, -s * 1.45, -s * 0.5);
    ctx.stroke();
  },
  cone(ctx, s, c) {
    ctx.fillStyle = '#d9a35a';
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, -s * 0.1);
    ctx.lineTo(s * 0.6, -s * 0.1);
    ctx.lineTo(0, s * 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b07a35';
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    ctx.moveTo(-s * 0.35, -s * 0.1);
    ctx.lineTo(s * 0.15, s * 0.9);
    ctx.moveTo(s * 0.35, -s * 0.1);
    ctx.lineTo(-s * 0.15, s * 0.9);
    ctx.stroke();
    ctx.fillStyle = c || '#fffaf2';
    ctx.beginPath();
    ctx.arc(-s * 0.3, -s * 0.25, s * 0.38, 0, TAU);
    ctx.arc(s * 0.3, -s * 0.25, s * 0.38, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -s * 0.6, s * 0.42, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s * 0.08, -s * 1.02, s * 0.2, 0, TAU);
    ctx.fill();
  },
  note(ctx, s, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(-s * 0.3, s * 0.6, s * 0.42, s * 0.32, -0.4, 0, TAU);
    ctx.fill();
    ctx.fillRect(s * 0.06, -s, s * 0.16, s * 1.6);
    ctx.fillRect(s * 0.06, -s, s * 0.6, s * 0.2);
  },
  zz(ctx, s, c) {
    ctx.fillStyle = c;
    ctx.font = `800 ${Math.round(s * 2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('z', 0, 0);
  },
};
export const SHAPE_NAMES = Object.keys(SHAPES);

// Shapes are drawn through one guard: an easing overshoot must never produce a negative radius.
function drawShape(name, ctx, size, color, p) {
  SHAPES[name]?.(ctx, Math.max(0.3, size), color, p);
}

// Food shapes have their own natural colors; everything else is white unless a recipe says so.
const NATURAL = new Set(['seed', 'cube', 'fry', 'cheese', 'leaf', 'nugget', 'macaron', 'cup', 'cake', 'cone',
  'wedge', 'onion', 'pepperoni', 'slice', 'patty', 'bun', 'strip', 'wing', 'drumstick', 'shrimp', 'cherry', 'pie',
  'roll', 'medallion', 'crown', 'basket', 'potato', 'pizza', 'chili']);
function paint(shape, colors) {
  if (colors) return pick(colors);
  return NATURAL.has(shape) ? undefined : '#fff';
}

// Shapes that look like light are drawn additively; food and solids are drawn normally.
const GLOWS = new Set(['dot', 'orb', 'spark', 'twinkle', 'flame', 'star']);

// ---------------------------------------------------------------------------------------------
export function createFx({ anchor, shakeTarget }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'duel-fx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, dpr = 1;
  let particles = [], things = [], queue = [], frame = 0, last = 0, clock = 0;
  const light = () => document.documentElement.dataset.theme === 'white';

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  resize();
  addEventListener('resize', resize);

  // Anchor positions are looked up every frame, so effects follow the layout if it moves.
  // `alias` maps the recipe's 'src'/'tgt' to the actual panels of the move being played.
  function where(name, jitter = 0, alias) {
    const a = anchor(alias?.[name] ?? name);
    if (!a) return { x: width / 2, y: height / 2, r: 40 };
    return { x: a.x + rand(-jitter, jitter), y: a.y + rand(-jitter, jitter), r: a.r };
  }

  function particle(o) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    const shape = pick(o.shape ?? 'dot');
    particles.push({
      x: o.x, y: o.y, vx: o.vx ?? 0, vy: o.vy ?? 0, ax: o.ax ?? 0, ay: o.ay ?? 0, drag: o.drag ?? 0,
      life: o.life ?? 600, age: 0, size: o.size ?? 6, size2: o.size2 ?? (o.size ?? 6) * 0.4,
      rot: o.rot ?? rand(0, TAU), vr: o.vr ?? 0, shape, color: paint(shape, o.colors), c2: o.c2,
      alpha: o.alpha ?? 1, glow: o.glow ?? GLOWS.has(shape), seed: Math.random() * 10, align: shape === 'spark',
      fadeIn: o.fadeIn ?? 0, wobble: o.wobble ?? 0,
    });
  }

  // Spray `count` particles from a point with speed and angle ranges.
  function spray(at, o) {
    const count = Math.round(val(o.count ?? 16));
    const base = o.angle ?? null;
    for (let i = 0; i < count; i++) {
      const a = base === null ? rand(0, TAU) : base + rand(-(o.spread ?? 0.6), o.spread ?? 0.6);
      const speed = val(o.speed ?? [120, 380]);
      const off = val(o.offset ?? 0);
      particle({
        ...o, x: at.x + Math.cos(a) * off, y: at.y + Math.sin(a) * off,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ay: o.gravity ?? 0,
        life: val(o.life ?? [380, 720]), size: val(o.size ?? [3, 7]), size2: o.size2,
        vr: val(o.spin ?? [-6, 6]),
      });
    }
  }

  // ------------------------------------------------------------------ step types
  const STEPS = {
    burst(s) {
      spray(where(s.at ?? 'tgt', s.jitter ?? 6, s.alias), s);
    },
    // Particles appear on a ring and rush into the point: gathering power.
    charge(s) {
      const dur = s.dur ?? 380;
      things.push({
        age: 0, life: dur, draw(k) {
          const p = where(s.at ?? 'src', 0, s.alias);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9;
          ctx.translate(p.x, p.y);
          SHAPES.dot(ctx, p.r * (0.6 + k * 0.9), pick(s.colors ?? '#fff'));
        },
      });
      const p = where(s.at ?? 'src', 0, s.alias);
      const count = s.count ?? 18;
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU), r = p.r * rand(1.6, 2.4);
        const life = dur * rand(0.6, 1);
        particle({
          x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, vx: -Math.cos(a) * r / (life / 1000),
          vy: -Math.sin(a) * r / (life / 1000), life, size: val(s.size ?? [2.5, 5]), size2: 1,
          shape: s.shape ?? 'spark', colors: s.colors ?? '#fff', glow: true, rot: a + Math.PI,
        });
      }
    },
    projectile(s) {
      const count = s.count ?? 1;
      for (let i = 0; i < count; i++) {
        const from = s.from ?? 'src', to = s.to ?? 'tgt';
        const travel = s.travel ?? 420;
        const side = (s.alternate && i % 2 ? -1 : 1) * (s.arc ?? 0.18);
        const jitter = s.spread ?? 0;
        const off = { x: rand(-jitter, jitter), y: rand(-jitter, jitter) };
        const startOff = { x: rand(-(s.fan ?? 0), s.fan ?? 0), y: rand(-(s.fan ?? 0), s.fan ?? 0) };
        const shape = pick(s.shape ?? 'orb');
        const color = paint(shape, s.colors);
        const size = val(s.size ?? 12);
        const seed = Math.random() * 10;
        let trailClock = 0;
        const thing = {
          age: -(i * (s.gap ?? 70)), life: travel, rot: rand(0, TAU),
          update(dt) {
            if (this.age < 0 || !s.trail) return;
            trailClock += dt;
            const every = 1000 / (s.trail.rate ?? 60);
            while (trailClock > every) {
              trailClock -= every;
              const p = this.pos;
              if (!p) break;
              particle({
                x: p.x + rand(-3, 3), y: p.y + rand(-3, 3), vx: rand(-30, 30), vy: rand(-30, 30) + (s.trail.rise ?? 0),
                life: val(s.trail.life ?? [220, 420]), size: val(s.trail.size ?? [3, 6]), shape: s.trail.shape ?? 'dot',
                colors: s.trail.colors ?? color, size2: s.trail.size2, vr: rand(-4, 4), c2: s.trail.c2,
              });
            }
          },
          draw(k) {
            const a = where(from, 0, s.alias), b = where(to, 0, s.alias);
            const sx = a.x + startOff.x, sy = a.y + startOff.y;
            const tx = b.x + off.x, ty = b.y + off.y;
            const dx = tx - sx, dy = ty - sy, dist = Math.hypot(dx, dy) || 1;
            const cx = (sx + tx) / 2 - (dy / dist) * dist * side, cy = (sy + ty) / 2 + (dx / dist) * dist * side - (s.lob ?? 0) * dist;
            const e = (ease[s.ease ?? 'inOut'] ?? ease.inOut)(k);
            const x = (1 - e) ** 2 * sx + 2 * (1 - e) * e * cx + e * e * tx;
            const y = (1 - e) ** 2 * sy + 2 * (1 - e) * e * cy + e * e * ty;
            this.pos = { x, y };
            const scale = 1 + ((s.grow ?? 1) - 1) * e;
            ctx.translate(x, y);
            if (s.face) ctx.rotate(Math.atan2(2 * (1 - e) * (cy - sy) + 2 * e * (ty - cy), 2 * (1 - e) * (cx - sx) + 2 * e * (tx - cx)) + (s.faceOffset ?? 0));
            else ctx.rotate(this.rot + (s.spin ?? 0) * k);
            if (s.halo) {
              ctx.save();
              ctx.globalCompositeOperation = light() ? 'source-over' : 'lighter';
              ctx.globalAlpha = 0.55;
              SHAPES.dot(ctx, size * 2.2 * scale, s.halo);
              ctx.restore();
            }
            ctx.globalCompositeOperation = GLOWS.has(shape) && !light() ? 'lighter' : 'source-over';
            drawShape(shape, ctx, size * scale, color, { seed, vx: 0, vy: 0, c2: s.c2 });
          },
          done() {
            if (s.onHit && (!s.hitOnce || i === count - 1)) {
              for (const step of [].concat(s.onHit)) later(step.t ?? 0, () => run({ ...step, at: step.at ?? to, alias: s.alias }));
            }
          },
        };
        things.push(thing);
      }
    },
    // A continuous stream from one anchor towards another (flamethrower, sauce jet, fizz).
    beam(s) {
      const dur = s.dur ?? 520;
      let acc = 0;
      things.push({
        age: 0, life: dur, update(dt) {
          acc += dt;
          const every = 1000 / (s.rate ?? 90);
          while (acc > every) {
            acc -= every;
            const a = where(s.from ?? 'src', 0, s.alias), b = where(s.to ?? 'tgt', 0, s.alias);
            const ang = Math.atan2(b.y - a.y, b.x - a.x) + rand(-(s.spread ?? 0.12), s.spread ?? 0.12);
            const dist = Math.hypot(b.x - a.x, b.y - a.y);
            const speed = val(s.speed ?? [700, 900]);
            particle({
              x: a.x + Math.cos(ang) * a.r * 0.5, y: a.y + Math.sin(ang) * a.r * 0.5,
              vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, ay: s.gravity ?? 0,
              life: Math.min(val(s.life ?? 900), (dist / speed) * 1000 * rand(0.9, 1.15)),
              size: val(s.size ?? [5, 10]), size2: s.size2 ?? val(s.size ?? [5, 10]) * 1.8, shape: s.shape ?? 'dot',
              colors: s.colors, c2: s.c2, vr: rand(-5, 5),
            });
          }
        },
        draw() {},
      });
    },
    ring(s) {
      const dur = s.dur ?? 460;
      things.push({
        age: 0, life: dur, draw(k) {
          const p = where(s.at ?? 'tgt', 0, s.alias);
          const r = (s.from ?? p.r * 0.4) + ((s.to ?? p.r * 2.2) - (s.from ?? p.r * 0.4)) * ease.out(k);
          ctx.globalCompositeOperation = light() ? 'source-over' : 'lighter';
          ctx.globalAlpha = (1 - k) * (s.alpha ?? 0.9);
          ctx.strokeStyle = s.color ?? '#fff';
          ctx.lineWidth = (s.width ?? 6) * (1 - k * 0.7);
          ctx.beginPath();
          if (s.shape === 'hex') for (let i = 0; i <= 6; i++) ctx.lineTo(p.x + Math.cos(i / 6 * TAU) * r, p.y + Math.sin(i / 6 * TAU) * r);
          else ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.stroke();
        },
      });
    },
    // A soft burst of light around an anchor, or over the whole screen.
    flash(s) {
      const dur = s.dur ?? 220;
      things.push({
        age: 0, life: dur, draw(k) {
          const a = (1 - k) * (s.alpha ?? 0.45);
          ctx.globalAlpha = a;
          if (s.screen) {
            ctx.fillStyle = s.color ?? '#fff';
            ctx.fillRect(0, 0, width, height);
            return;
          }
          const p = where(s.at ?? 'tgt', 0, s.alias);
          ctx.globalCompositeOperation = light() ? 'source-over' : 'lighter';
          ctx.translate(p.x, p.y);
          SHAPES.dot(ctx, p.r * (s.size ?? 2.4) * (0.7 + k * 0.5), s.color ?? '#fff');
        },
      });
    },
    shake(s) {
      const el = shakeTarget?.();
      if (!el?.animate) return;
      const m = s.mag ?? 7, frames = [];
      for (let i = 0; i < 7; i++) frames.push({ transform: `translate(${rand(-m, m) * (1 - i / 7)}px, ${rand(-m, m) * (1 - i / 7)}px)` });
      frames.push({ transform: 'none' });
      el.animate(frames, { duration: s.dur ?? 320, easing: 'ease-out' });
    },
    // Objects falling from above onto an anchor.
    rain(s) {
      const count = s.count ?? 8;
      const dur = s.dur ?? 420;
      for (let i = 0; i < count; i++) {
        later(rand(0, dur), () => {
          const p = where(s.at ?? 'tgt', 0, s.alias);
          const fall = s.height ?? p.r * 3.2;
          const x = p.x + rand(-p.r * (s.width ?? 1.1), p.r * (s.width ?? 1.1));
          const t = (s.fall ?? 420) / 1000;
          particle({
            x, y: p.y - fall, vx: rand(-20, 20), vy: fall / t - 0.5 * 900 * t, ay: 900,
            life: (s.fall ?? 420) * rand(1, 1.15), size: val(s.size ?? [8, 12]), size2: val(s.size ?? [8, 12]),
            shape: s.shape, colors: s.colors, vr: val(s.spin ?? [-5, 5]), fadeIn: 0.15,
          });
          if (s.splash) later(s.fall ?? 420, () => spray({ x, y: p.y + rand(-p.r * 0.3, p.r * 0.3) }, { count: 5, ...s.splash }));
        });
      }
    },
    // Particles rising around an anchor for a while (healing, steam, buffs).
    rise(s) {
      const dur = s.dur ?? 700;
      let acc = 0;
      things.push({
        age: 0, life: dur, update(dt) {
          acc += dt;
          const every = 1000 / (s.rate ?? 22);
          while (acc > every) {
            acc -= every;
            const p = where(s.at ?? 'src', 0, s.alias);
            particle({
              x: p.x + rand(-p.r, p.r) * (s.width ?? 0.9), y: p.y + rand(-p.r * 0.2, p.r * 0.7),
              vx: rand(-15, 15), vy: (s.down ? 1 : -1) * val(s.speed ?? [60, 130]), life: val(s.life ?? [600, 900]),
              size: val(s.size ?? [5, 9]), size2: s.size2 ?? val(s.size ?? [5, 9]) * 0.6, shape: s.shape ?? 'plus',
              colors: s.colors ?? '#7ef0a6', c2: s.c2, vr: s.spin ? rand(-s.spin, s.spin) : 0, rot: s.spin ? undefined : 0,
              fadeIn: 0.2, wobble: s.wobble ?? 0,
            });
          }
        },
        draw() {},
      });
    },
    // A shield around an anchor: fades in, shimmers, fades out.
    bubble(s) {
      const dur = s.dur ?? 900;
      things.push({
        age: 0, life: dur, draw(k) {
          const p = where(s.at ?? 'src', 0, s.alias);
          const r = Math.max(1, p.r * (s.size ?? 1.35) * (k < 0.2 ? ease.back(k / 0.2) : 1));
          const a = k < 0.2 ? k / 0.2 : k > 0.7 ? (1 - k) / 0.3 : 1;
          const c = s.color ?? '#8fd3ff';
          ctx.globalAlpha = a * 0.9;
          ctx.translate(p.x, p.y);
          const g = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(1, c + '66');
          ctx.fillStyle = g;
          ctx.strokeStyle = c;
          ctx.lineWidth = 3;
          ctx.beginPath();
          if (s.hex) for (let i = 0; i <= 6; i++) ctx.lineTo(Math.cos(i / 6 * TAU + k) * r, Math.sin(i / 6 * TAU + k) * r);
          else ctx.arc(0, 0, r, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = a * 0.8;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.86, -2.2 + k * 3, -1.5 + k * 3);
          ctx.stroke();
        },
      });
    },
    // Swift curved strokes across an anchor: claws, knives, punches.
    slash(s) {
      const count = s.count ?? 3;
      for (let i = 0; i < count; i++) {
        const angle = (s.angle ?? -0.7) + (s.cross && i % 2 ? 1.4 : 0) + rand(-0.15, 0.15);
        const off = (i - (count - 1) / 2) * (s.space ?? 14);
        things.push({
          age: -i * (s.gap ?? 70), life: s.dur ?? 300, draw(k) {
            const p = where(s.at ?? 'tgt', 0, s.alias);
            const len = p.r * (s.len ?? 1.5);
            ctx.translate(p.x, p.y);
            ctx.rotate(angle);
            ctx.globalCompositeOperation = light() ? 'source-over' : 'lighter';
            const head = ease.out(Math.min(1, k * 1.8)), tail = ease.in(k);
            ctx.globalAlpha = 1 - tail * 0.6;
            ctx.strokeStyle = s.color ?? '#fff';
            ctx.lineCap = 'round';
            ctx.lineWidth = (s.width ?? 5) * (1 - k * 0.6);
            ctx.shadowColor = s.color ?? '#fff';
            ctx.shadowBlur = 12;
            const bend = -(s.curve ?? 0.25) * len;
            ctx.beginPath();
            for (let j = 0; j <= 12; j++) {
              const u = tail + (head - tail) * (j / 12);
              const x = -len + 2 * len * u, y = off + bend * Math.sin(Math.PI * u);
              j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.stroke();
          },
        });
      }
    },
    // A big emblem that pops in over an anchor and fades (a crown, a giant bun, a basket).
    stamp(s) {
      const dur = s.dur ?? 800;
      const seed = Math.random() * 10;
      things.push({
        age: 0, life: dur, draw(k) {
          const p = where(s.at ?? 'src', 0, s.alias);
          const pop = k < 0.3 ? ease.back(k / 0.3) : 1;
          const a = k > 0.75 ? (1 - k) / 0.25 : 1;
          ctx.globalAlpha = a;
          ctx.translate(p.x + (s.dx ?? 0) * p.r, p.y + (s.dy ?? -1.1) * p.r - (s.lift ?? 0) * k * p.r);
          ctx.rotate((s.spin ?? 0) * k + (s.tilt ?? 0));
          if (s.halo) {
            ctx.save();
            ctx.globalCompositeOperation = light() ? 'source-over' : 'lighter';
            ctx.globalAlpha = a * 0.6;
            SHAPES.dot(ctx, p.r * (s.size ?? 0.6) * 2.6 * pop, s.halo);
            ctx.restore();
          }
          drawShape(s.shape, ctx, p.r * (s.size ?? 0.6) * pop, paint(s.shape, s.colors), { seed, vx: 0, vy: 0 });
        },
      });
    },
    // Items circling an anchor, closing in or flying out.
    orbit(s) {
      const count = s.count ?? 6;
      const dur = s.dur ?? 800;
      for (let i = 0; i < count; i++) {
        const phase = (i / count) * TAU, shape = pick(s.shape ?? 'dot'), color = paint(shape, s.colors);
        const seed = Math.random() * 10, size = val(s.size ?? 8);
        things.push({
          age: 0, life: dur, draw(k) {
            const p = where(s.at ?? 'tgt', 0, s.alias);
            const r = p.r * ((s.from ?? 1.6) + ((s.to ?? 0.6) - (s.from ?? 1.6)) * ease.inOut(k));
            const a = phase + (s.turns ?? 1.2) * TAU * k;
            ctx.globalAlpha = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
            ctx.translate(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * (s.flat ?? 0.55));
            ctx.rotate(a * 2);
            ctx.globalCompositeOperation = GLOWS.has(shape) && !light() ? 'lighter' : 'source-over';
            drawShape(shape, ctx, size, color, { seed, vx: 0, vy: 0 });
          },
        });
      }
    },
    // A jagged crackling line between two anchors (fizz, stretching cheese, lightning).
    bolt(s) {
      const dur = s.dur ?? 380;
      let pts = [], acc = 99;
      things.push({
        age: 0, life: dur, update(dt) {
          acc += dt;
          if (acc < 45) return;
          acc = 0;
          const a = where(s.from ?? 'src', 0, s.alias), b = where(s.to ?? 'tgt', 0, s.alias);
          const n = s.segments ?? 9, amp = s.amp ?? 16;
          pts = Array.from({ length: n + 1 }, (_, i) => {
            const u = i / n, j = i === 0 || i === n ? 0 : rand(-amp, amp);
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
            return [a.x + dx * u - (dy / d) * j, a.y + dy * u + (dx / d) * j + (s.sag ?? 0) * Math.sin(Math.PI * u)];
          });
        },
        draw(k) {
          if (!pts.length) return;
          ctx.globalCompositeOperation = light() ? 'source-over' : 'lighter';
          ctx.globalAlpha = 1 - k * k;
          ctx.strokeStyle = s.color ?? '#fff';
          ctx.shadowColor = s.color ?? '#fff';
          ctx.shadowBlur = 14;
          ctx.lineWidth = s.width ?? 4;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
          ctx.lineWidth = (s.width ?? 4) * 0.35;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        },
      });
    },
  };

  function later(ms, fn) {
    queue.push({ at: clock + ms, fn });
  }
  function run(step) {
    STEPS[step.type]?.(step);
  }

  // A broken frame must not stop every later animation, so a failure resets the layer.
  function tick(now) {
    try {
      step(now);
    } catch (error) {
      console.warn('battle effects reset', error);
      particles = [];
      things = [];
      queue = [];
      frame = 0;
      last = 0;
      ctx.reset?.();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function step(now) {
    const dt = Math.min(50, now - (last || now));
    last = now;
    clock += dt;
    const due = queue.filter((q) => q.at <= clock);
    queue = queue.filter((q) => q.at > clock);
    for (const q of due) q.fn();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const s = dt / 1000;
    const isLight = light();
    particles = particles.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) return false;
      p.vx += p.ax * s;
      p.vy += p.ay * s;
      if (p.drag) {
        const f = Math.max(0, 1 - p.drag * s);
        p.vx *= f;
        p.vy *= f;
      }
      p.x += p.vx * s + (p.wobble ? Math.sin(p.age / 90 + p.seed) * p.wobble * s : 0);
      p.y += p.vy * s;
      p.rot += p.vr * s;
      const k = p.age / p.life;
      const size = p.size + (p.size2 - p.size) * k;
      const fade = p.fadeIn && k < p.fadeIn ? k / p.fadeIn : k > 0.6 ? (1 - k) / 0.4 : 1;
      ctx.save();
      ctx.globalAlpha = p.alpha * fade;
      ctx.globalCompositeOperation = p.glow && !isLight ? 'lighter' : 'source-over';
      ctx.translate(p.x, p.y);
      ctx.rotate(p.align ? Math.atan2(p.vy, p.vx) : p.rot);
      drawShape(p.shape, ctx, Math.max(0.5, size), p.color, p);
      ctx.restore();
      return true;
    });
    things = things.filter((t) => {
      t.age += dt;
      if (t.age < 0) return true;
      if (t.age >= t.life) {
        t.done?.();
        return false;
      }
      t.update?.(dt);
      ctx.save();
      t.draw(t.age / t.life);
      ctx.restore();
      return true;
    });
    if (particles.length || things.length || queue.length) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      last = 0;
      ctx.clearRect(0, 0, width, height);
    }
  }

  return {
    // Schedules every step of a recipe; the caller already knows its timing from `fxTiming`.
    play(steps, alias) {
      for (const step of steps) later(step.t ?? 0, () => run({ ...step, alias }));
      if (!frame) frame = requestAnimationFrame(tick);
    },
    clear() {
      particles = [];
      things = [];
      queue = [];
    },
    destroy() {
      cancelAnimationFrame(frame);
      removeEventListener('resize', resize);
      canvas.remove();
    },
  };
}

// How long a recipe runs, and when its main blow lands. Pure, so the arena can plan the turn.
export function fxTiming(steps) {
  let impact = null, end = 0;
  for (const s of steps) {
    const t = s.t ?? 0;
    let dur;
    switch (s.type) {
      case 'projectile': dur = (s.travel ?? 420) + ((s.count ?? 1) - 1) * (s.gap ?? 70) + 450; break;
      case 'beam': dur = (s.dur ?? 520) + 500; break;
      case 'rain': dur = (s.dur ?? 420) + (s.fall ?? 420) * 1.15 + (s.splash ? 500 : 0); break;
      case 'rise': dur = (s.dur ?? 700) + 900; break;
      case 'slash': dur = (s.count ?? 3) * (s.gap ?? 70) + (s.dur ?? 300); break;
      case 'burst': dur = Array.isArray(s.life) ? s.life[1] : s.life ?? 720; break;
      case 'shake': dur = s.dur ?? 320; break;
      default: dur = s.dur ?? 500;
    }
    end = Math.max(end, t + dur);
    if (s.hit && impact === null) {
      impact = t + (s.type === 'projectile' ? (s.travel ?? 420) + (s.hitLast ? ((s.count ?? 1) - 1) * (s.gap ?? 70) : 0)
        : s.type === 'rain' ? (s.fall ?? 420) + (s.dur ?? 420) * 0.4 : s.type === 'beam' ? Math.min(260, s.dur ?? 520) : 0);
    }
  }
  return { impact: impact ?? Math.min(300, end), end: Math.min(end, 2600) };
}
