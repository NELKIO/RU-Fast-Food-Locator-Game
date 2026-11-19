// node report.mjs roster.mjs res/part-*.json
import { readFileSync } from 'node:fs';
import { rank, loadRoster } from './lib.mjs';
const [rosterPath, ...files] = process.argv.slice(2);
const FIGHTERS = await loadRoster(rosterPath);
const R = Object.assign({}, ...files.map(f => JSON.parse(readFileSync(f))));
const ids = Object.keys(FIGHTERS);
const pts = r => r === null ? 0.5 : (r + 1) / 2;
// s(a,b): a vs b over both orders (a first, then b first).
const s = (a, b) => (pts(R[a + ' ' + b].r) + 1 - pts(R[b + ' ' + a].r)) / 2;
const bot = (a, b) => (R[a + ' ' + b].bot + 1 - R[b + ' ' + a].bot) / 2;
let draws = 0, nulls = 0, games = 0;
for (const v of Object.values(R)) { games++; if (v.r === 0) draws++; if (v.r === null) nulls++; }
console.log(`games ${games} draws ${draws} unsolved ${nulls}`);
const tiers = ['common', 'rare', 'epic', 'legendary'];
for (const t of tiers) {
  const group = ids.filter(i => FIGHTERS[i].rarity === t);
  console.log(`\n== ${t} (${group.length}) perfect-play in-tier score | bot in-tier | wins/losses/even in tier`);
  const rows = group.map(i => {
    const others = group.filter(j => j !== i);
    const sc = others.map(j => s(i, j));
    return [i, sc.reduce((x, y) => x + y, 0) / others.length, others.map(j => bot(i, j)).reduce((x, y) => x + y, 0) / others.length,
      sc.filter(x => x === 1).length, sc.filter(x => x === 0).length, sc.filter(x => x === 0.5).length,
      others.filter(j => s(i, j) === 1).map(j => j.replace(/^\w+-/, '')).join(' ')];
  }).sort((a, b) => b[1] - a[1]);
  for (const r of rows) console.log(r[0].padEnd(28), r[1].toFixed(2), r[2].toFixed(2), `${r[3]}/${r[4]}/${r[5]}`, ' beats:', r[6]);
}
console.log('\n== cross tier (row tier vs column tier), perfect | bot');
for (const t of tiers) {
  const line = tiers.map(u => {
    const A = ids.filter(i => FIGHTERS[i].rarity === t), B = ids.filter(i => FIGHTERS[i].rarity === u);
    let x = 0, y = 0, n = 0;
    for (const a of A) for (const b of B) if (a !== b) { x += s(a, b); y += bot(a, b); n++; }
    return (x / n).toFixed(2) + '|' + (y / n).toFixed(2);
  });
  console.log(t.padEnd(10), line.join('  '));
}
// Fighters of a lower tier that beat a higher-tier one in both orders.
const upsets = [];
for (const a of ids) for (const b of ids) if (rank(FIGHTERS[a].rarity) < rank(FIGHTERS[b].rarity) && s(a, b) === 1) upsets.push(a + '>' + b);
console.log('\nupsets (lower tier wins both orders):', upsets.length, upsets.slice(0, 30).join(', '));
