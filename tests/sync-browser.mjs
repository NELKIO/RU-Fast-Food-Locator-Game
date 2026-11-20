// Device sync in real Chrome pages: a laptop and a phone with their own progress link through the
// profile, end up with one profile, keep it in step, survive a reload and unlink cleanly; a brand
// new device joins without a stray starter fighter. Relays are emulated with Nostr storage rules;
// map tiles are blocked so the test never leaves the machine.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNC_RELAYS } from '../public/js/sync.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const profileKey = 'fast-food-locator.profile.v1';

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(resolve(publicDir) + sep)) { res.writeHead(403).end(); return; }
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
      '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});

// Each relay keeps the newest event per author, kind and d tag, like real NIP-01 relays.
function relays() {
  const stored = new Map();
  let publishes = 0;
  return {
    stored,
    get publishes() { return publishes; },
    async install(context) {
      await context.routeWebSocket(/.*/, socket => {
        const url = socket.url().replace(/\/$/, '');
        assert.ok(SYNC_RELAYS.includes(url), 'unexpected connection ' + url);
        socket.onMessage(raw => {
          const [kind, a, b] = JSON.parse(String(raw));
          if (kind === 'REQ') {
            const event = stored.get(url);
            if (event && b.authors?.includes(event.pubkey) && b.kinds?.includes(event.kind)) socket.send(JSON.stringify(['EVENT', a, event]));
            socket.send(JSON.stringify(['EOSE', a]));
          } else if (kind === 'EVENT') {
            publishes++;
            const kept = stored.get(url);
            if (!kept || a.created_at > kept.created_at || (a.created_at === kept.created_at && a.id < kept.id)) stored.set(url, a);
            socket.send(JSON.stringify(['OK', a.id, true, '']));
          }
        });
      });
    },
  };
}

let browser;
const errors = [];
try {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
    channel: process.env.CHROME_PATH ? undefined : 'chrome' });
  const net = relays();
  async function open(name, viewport, seed) {
    const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
    await net.install(context);
    await context.route(/^https?:/, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    if (seed) await context.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); }, { key: profileKey, value: seed });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(name + ': ' + error.message));
    page.on('console', message => { if (message.type() === 'error' && !/favicon|net::ERR_FAILED/.test(message.text())) errors.push(name + ': ' + message.text()); });
    return page;
  }
  const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), profileKey);
  const counters = p => JSON.stringify({ xp: p.xp, battles: p.battles, collection: Object.fromEntries(Object.entries(p.collection).sort()),
    visits: Object.fromEntries(Object.entries(p.visits).sort()) });
  async function openSync(page) {
    await page.locator('#dialog[open]').waitFor({ state: 'detached', timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
    await page.locator('#profile-btn').click();
    await page.locator('[data-sync-open]').click();
  }

  const laptopSeed = { version: 1, xp: 140, collection: { 'bk-whopper': { copies: 2, xp: 30 }, 'bk-fries': { copies: 1, xp: 0 } },
    team: ['bk-whopper', 'bk-fries'], visits: { 'bk-1': { lastAt: Date.now() - 86_400_000, count: 2 } }, battles: { wins: 4, losses: 1, draws: 0 } };
  const phoneSeed = { version: 1, xp: 60, collection: { 'dodo-pepperoni': { copies: 1, xp: 10 }, 'bk-whopper': { copies: 1, xp: 5 } },
    team: ['dodo-pepperoni'], visits: { 'dodo-1': { lastAt: Date.now() - 3600_000, count: 1 } }, battles: { wins: 2, losses: 2, draws: 1 } };
  const laptop = await open('laptop', { width: 1280, height: 900 }, laptopSeed);
  const phone = await open('phone', { width: 390, height: 844 }, phoneSeed);
  await laptop.goto(origin + '/');
  await phone.goto(origin + '/');
  await laptop.locator('#radar-view').waitFor();

  // Nothing talks to a relay before the player links devices.
  await laptop.waitForTimeout(500);
  assert.equal(net.publishes, 0);

  // Laptop: profile → link devices → create a key.
  await openSync(laptop);
  await laptop.getByRole('heading', { name: 'Связать устройства' }).waitFor();
  await laptop.locator('[data-sync-create]').click();
  await laptop.getByRole('heading', { name: 'Устройства связаны' }).waitFor();
  await laptop.locator('[data-sync-status]', { hasText: 'Синхронизировано' }).waitFor({ timeout: 15_000 });
  const key = (await laptop.locator('[data-sync-key]').textContent()).trim();
  assert.match(key, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/, 'the new key is shown once created');
  await laptop.locator('[data-sync-copy]').click();
  const link = await laptop.evaluate(() => navigator.clipboard.readText());
  assert.ok(link.startsWith(origin + '/#sync='), link);
  assert.ok(net.stored.size >= 3, 'stored on several relays');
  for (const event of net.stored.values()) {
    assert.ok(!event.content.includes('bk-whopper') && !event.content.includes('Воппер'), 'relays only see ciphertext');
  }
  console.log('PASS profile → create key / status / copy link / encrypted on every relay');

  // Phone: a wrong key is refused, then the link is opened and confirmed.
  await openSync(phone);
  await phone.locator('#sync-key').fill('ABCD-1234');
  await phone.getByRole('button', { name: 'Связать', exact: true }).click();
  await phone.locator('.sync-error', { hasText: '32 символов' }).waitFor();
  await phone.keyboard.press('Escape');
  await phone.goto(link);
  await phone.getByRole('heading', { name: 'Связать это устройство?' }).waitFor();
  assert.equal(await phone.evaluate(() => location.hash), '', 'the key leaves the address bar at once');
  await phone.locator('[data-sync-confirm]').click();
  await phone.locator('[data-sync-status]', { hasText: 'Синхронизировано' }).waitFor({ timeout: 15_000 });
  let p = await saved(phone);
  assert.equal(p.xp, 200, 'player XP of both devices');
  assert.deepEqual(p.battles, { wins: 6, losses: 3, draws: 1 });
  assert.deepEqual(p.collection['bk-whopper'], { copies: 3, xp: 35 });
  assert.ok(p.collection['dodo-pepperoni'] && p.collection['bk-fries']);
  assert.ok(p.visits['bk-1'] && p.visits['dodo-1']);
  await laptop.locator('[data-sync-now]').click();
  await laptop.waitForFunction(() => document.querySelector('[data-sync-status]')?.textContent.includes('Синхронизировано'));
  await laptop.waitForTimeout(300);
  assert.equal(counters(await saved(laptop)), counters(p), 'the laptop has the same progress');
  console.log('PASS link on the phone / two progresses summed / laptop catches up');

  // The login reward can be taken only once for both devices. The laptop opens the calendar while
  // the reward is still free, the phone takes it, then the laptop presses «Забрать».
  await phone.keyboard.press('Escape');
  await laptop.keyboard.press('Escape');
  await laptop.locator('#daily-card [data-daily-open]').click();
  await laptop.locator('[data-daily-claim]').waitFor();
  await phone.locator('#daily-card [data-daily-open]').click();
  await phone.locator('[data-daily-claim]').click();
  await phone.locator('[data-daily-next]').waitFor({ timeout: 15_000 });
  await phone.locator('[data-daily-next]').click();
  await phone.locator('.daily-got').waitFor();
  const phoneClaim = await saved(phone);
  assert.ok(phoneClaim.login.day, 'the phone took the reward');
  const xpBefore = (await saved(laptop)).xp;
  await laptop.locator('[data-daily-claim]').click();
  await laptop.locator('.daily-note', { hasText: 'уже забрали на другом устройстве' }).waitFor({ timeout: 15_000 });
  assert.equal(await laptop.locator('[data-daily-claim]').count(), 0, 'no second claim button');
  assert.equal(await laptop.locator('[data-daily-next]').count(), 0, 'no roulette on the laptop');
  const after = await saved(laptop);
  assert.deepEqual(after.login, phoneClaim.login);
  assert.ok(after.xp >= xpBefore);
  assert.equal(await laptop.locator('#daily-card').isHidden(), true, 'the radar card is gone too');
  await laptop.keyboard.press('Escape');
  await phone.keyboard.press('Escape');
  console.log('PASS the login reward taken on the phone is not offered again on the laptop');

  // A change on the phone reaches the laptop: the team.
  await phone.keyboard.press('Escape');
  await phone.locator('.main-nav [data-nav="collection"]').click();
  await phone.locator('[data-deck-add="bk-fries"]').click();
  await phone.waitForFunction(key => JSON.parse(localStorage.getItem(key)).team.includes('bk-fries'), profileKey);
  const team = (await saved(phone)).team;
  await phone.waitForTimeout(3500); // the debounced sync publishes by itself
  await openSync(laptop);
  await laptop.locator('[data-sync-now]').click();
  await laptop.waitForFunction(({ key, team }) => JSON.stringify(JSON.parse(localStorage.getItem(key)).team) === JSON.stringify(team), { key: profileKey, team }, { timeout: 15_000 });
  console.log('PASS a team change on the phone syncs by itself and reaches the laptop');

  // Reload: still linked, no prompt, same profile.
  const before = counters(await saved(phone));
  await phone.reload();
  await phone.locator('#radar-view').waitFor();
  await phone.waitForTimeout(1500);
  assert.equal(await phone.locator('#dialog[open]').count(), 0, 'no prompt after a reload');
  assert.equal(counters(await saved(phone)), before);
  assert.ok((await saved(phone)).sync.key);

  // A brand new device joins from the link: no stray starter, the shared progress arrives.
  const fresh = await open('fresh', { width: 390, height: 844 });
  await fresh.goto(link);
  await fresh.getByRole('heading', { name: 'Связать это устройство?' }).waitFor();
  assert.equal(await fresh.getByRole('heading', { name: /Твой первый боец/ }).count(), 0, 'no starter before linking');
  await fresh.locator('[data-sync-confirm]').click();
  await fresh.locator('[data-sync-status]', { hasText: 'Синхронизировано' }).waitFor({ timeout: 15_000 });
  assert.equal(counters(await saved(fresh)), counters(await saved(phone)), 'nothing added, nothing lost');
  console.log('PASS reload keeps the link / a new device joins without a stray starter');

  // Unlink: progress stays, syncing stops.
  await openSync(phone);
  await phone.locator('[data-sync-unlink]').click();
  await phone.locator('[data-sync-unlink-yes]').click();
  await phone.getByRole('heading', { name: 'Связать устройства' }).waitFor();
  const kept = await saved(phone);
  assert.equal(kept.sync.key, null);
  assert.equal(counters(kept), before);
  const published = net.publishes;
  await phone.keyboard.press('Escape');
  await phone.locator('[data-deck-remove="bk-fries"]').click().catch(() => {});
  await phone.waitForTimeout(3500);
  assert.equal(net.publishes, published, 'an unlinked device publishes nothing');
  assert.deepEqual(errors, []);
  console.log('PASS unlink keeps progress and stops syncing / no browser errors');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
