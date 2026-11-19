// node matrix.mjs roster.mjs out.json [shard total]
import { writeFileSync } from 'node:fs';
import { solve, botScore, loadRoster } from './lib.mjs';
const [rosterPath, out, shard = '0', total = '1'] = process.argv.slice(2);
const FIGHTERS = await loadRoster(rosterPath);
const ids = Object.keys(FIGHTERS);
const res = {};
let k = 0;
for (const a of ids) for (const b of ids) {
  if (k++ % +total !== +shard) continue;
  // r: a moves first and b gets the tempo energy. bot: a's points against b, speed decides who opens.
  res[a + ' ' + b] = { r: solve(FIGHTERS[a], FIGHTERS[b], 0), bot: botScore(FIGHTERS[a], FIGHTERS[b], 60) };
}
writeFileSync(out, JSON.stringify(res));
