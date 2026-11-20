// Per-move time and search depth of the computer players inside Chrome, as in the game: the
// search runs on the page's main thread. Optionally slows the CPU down like a phone.
//   node ai-browser.mjs [throttle=1] [budgets=60,350,900]
// Needs Chrome (or CHROME_PATH) and playwright-core, like tests/duel-browser.mjs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const throttle = +(process.argv[2] ?? 1);
const budgets = (process.argv[3] ?? '60,350,900').split(',').map(Number);

const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(root.replace(/[\\/]$/, '') + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': ['.js', '.mjs'].includes(extname(path)) ? 'text/javascript' : 'text/html' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, channel: process.env.CHROME_PATH ? undefined : 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(base + '/public/index.html').catch(() => {});
  if (throttle > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const rows = await page.evaluate(async ({ budgets }) => {
    const E = await import('/public/js/duel-engine.js');
    const { FIGHTERS } = await import('/public/js/fighters.js');
    const players = { old: await import('/docs/balance/tools/ai-baseline.mjs'), new: await import('/public/js/duel-ai.js') };
    let seed = 99;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = Object.keys(FIGHTERS), R = ['common', 'rare', 'epic', 'legendary'];
    const team = r => { const pool = ids.filter(i => FIGHTERS[i].rarity === r); const o = new Set(); while (o.size < 3) o.add(pool[Math.floor(random() * pool.length)]); return [...o].map(id => E.battleStats({ id, ...FIGHTERS[id] }, true)); };
    const positions = [];
    for (let g = 0; g < 8; g++) {
      const teams = [team(R[g % 4]), team(R[g % 4])];
      let s = E.startBattle(teams, E.opener(teams, g & 1), { tempo: false }), k = 0;
      while (s.winner === null) { if (k++ % 4 === 0 && E.legalMoves(s).length > 1) positions.push(s); s = E.applyMove(s, s.turn, E.botMove(s, random)); }
    }
    const out = [];
    for (const ms of budgets) for (const [name, ai] of Object.entries(players)) {
      ai.smartMove(positions[0], positions[0].turn, { timeMs: 30 });
      let total = 0, max = 0, depth = 0, nodes = 0;
      for (const s of positions) {
        const info = {}, t0 = performance.now();
        ai.smartMove(s, s.turn, { timeMs: ms, info });
        const t = performance.now() - t0;
        total += t; max = Math.max(max, t); depth += info.depth; nodes += info.nodes;
      }
      out.push({ budget: ms, ai: name, positions: positions.length, msPerMove: +(total / positions.length).toFixed(0), maxMs: +max.toFixed(0),
        depth: +(depth / positions.length).toFixed(1), kNodesPerMove: +(nodes / positions.length / 1000).toFixed(0), nodesPerMs: +(nodes / total).toFixed(0) });
    }
    return out;
  }, { budgets });
  console.log(`Chrome, CPU throttling ×${throttle}`);
  console.table(rows);
} finally {
  await browser.close();
  server.close();
}
