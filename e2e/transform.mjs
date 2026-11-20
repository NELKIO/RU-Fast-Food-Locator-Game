// Transformation in the browser: the violet button in a real battle, the change of form with its
// new name and picture, and the violet badge in the collection, the deck and the card dialog.
// TRANSFORM_SCREENSHOTS=<dir> saves phone screenshots of every step (and of each theme).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIGHTERS, describeTransform } from '../public/js/fighters.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const shots = process.env.TRANSFORM_SCREENSHOTS;
const themes = ['green', 'black', 'white', 'chili', 'oven', 'grill'];
const profileKey = 'fast-food-locator.profile.v1';
// One fighter whose form has its own picture and one without: read from the data, never hard-coded.
const forms = Object.keys(FIGHTERS).filter(id => FIGHTERS[id].transform);
const withLook = forms.find(id => FIGHTERS[id].transform.look && FIGHTERS[id].transform.look !== id) ?? forms[0];
const withoutLook = forms.find(id => !FIGHTERS[id].transform.look);
const plain = Object.keys(FIGHTERS).find(id => !FIGHTERS[id].transform && FIGHTERS[id].rarity === 'common');
assert.ok(withLook && plain, 'fighters to test with');

// The arena on its own, with the real menu and fighters; the wild fighter is a sturdy punching bag,
// so the player always lives long enough to transform.
const fixture = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/main.css"><link rel="stylesheet" href="/css/duel.css"><link rel="stylesheet" href="/css/themes.css">
  <body><main id="game" style="padding:0 16px"></main><script type="module">
    import { mountDuels } from '/js/duels.js';
    import { cardFor } from '/js/game.js';
    const options = new URLSearchParams(location.search);
    document.documentElement.dataset.theme = options.get('theme') || 'green';
    const menu = await (await fetch('/data/menu.json')).json();
    const cards = menu.map(item => cardFor(item)).filter(Boolean);
    const id = options.get('id');
    const bag = { ...cards.find(c => c.id === options.get('foe')), attack: 1, hp: 80, maxHp: 80 };
    delete bag.trait; delete bag.ultimate; delete bag.transform;
    bag.skill = { name: 'Ничего', cost: 4, heal: 1 };
    mountDuels(document.querySelector('main'), {
      read: () => ({ cards, owned: [id], team: [id], wild: { id: 'wild-1', opponent: () => bag }, wildWaitMs: 0 }),
      initialMode: 'lobby', award: async () => ({ ok: true }),
    });
  </script></body></html>`;

const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
    const file = resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(resolve(publicDir) + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});

const errors = [];
let browser;
async function snap(page, name, options = {}) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: resolve(shots, name + '.png'), ...options });
}
async function fits(page, where) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), where + ': no horizontal scroll at 390 px');
}

try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined });
  async function phone(extra = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', ...extra });
    await context.route(/^https?:/, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    return page;
  }

  // ---------------------------------------------------------------- the battle
  async function battle(id, { theme = 'green', label = id, reduced = false } = {}) {
    const form = FIGHTERS[id].transform;
    const page = await phone(reduced ? { reducedMotion: 'reduce' } : {});
    await page.goto(`${origin}/fixture?id=${id}&foe=${plain}&theme=${theme}`);
    // The lobby already tells which fighter can transform.
    await page.locator(`.duel-pick [data-duel-action="card:${id}"] .tf-badge`).waitFor();
    await page.getByRole('button', { name: 'Сразиться' }).click();
    await page.getByRole('heading', { name: 'Дикий боец' }).waitFor();
    const button = page.locator('[data-duel-action="move:transform"]');
    await button.waitFor();
    assert.match(await button.innerText(), /Трансформация/);
    assert.ok((await button.innerText()).includes(form.name), 'the button names the new form');
    assert.ok(await page.locator('.duel-fighter.is-me .duel-portrait .tf-badge').count(), 'the fighter shows it can still transform');
    // Hit until there is enough energy; the button stays locked until then.
    for (let turn = 0; turn < 12 && !(await button.isEnabled()); turn++) {
      await page.waitForFunction(() => document.querySelector('[data-duel-action="move:hit"]:enabled') || document.querySelector('[data-duel-action="move:transform"]:enabled'));
      if (await button.isEnabled()) break;
      await page.locator('[data-duel-action="move:hit"]').click();
    }
    await button.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-duel-action="move:transform"]:enabled'));
    assert.match(await button.getAttribute('class'), /is-ready/);
    await fits(page, label + ' moves');
    await button.scrollIntoViewIfNeeded();
    await snap(page, `${label}-1-moves`);
    const before = await page.locator('.duel-fighter.is-me .duel-portrait img').first().getAttribute('src');
    await button.click();
    const me = page.locator('.duel-fighter.is-me');
    await me.locator('h3', { hasText: form.name }).waitFor();
    // The battle log tells it before the other side moves.
    assert.match(await page.locator('.duel-log').innerText(), /Трансформация!/);
    if (!reduced) {
      await page.locator('.duel-pop.is-form', { hasText: 'Трансформация!' }).waitFor({ state: 'attached' });
      await page.waitForTimeout(560);
      await page.evaluate(() => scrollTo(0, 0));
      await snap(page, `${label}-2-moment`);
    }
    // After the scene: the new name, the form's picture (or the violet glow), no button any more.
    await page.waitForFunction(() => document.querySelector('[data-duel-action="move:hit"]:enabled'), null, { timeout: 8000 });
    assert.equal(await button.count(), 0, 'one transformation per battle');
    assert.equal((await me.locator('h3').innerText()).trim(), form.name);
    assert.match(await me.getAttribute('class'), /is-transformed/);
    assert.equal(await me.locator('.duel-portrait .tf-badge').count(), 0, 'the badge goes once the form is taken');
    assert.ok(await me.locator('.duel-chip.is-form').count(), 'a «Форма» chip');
    const after = await me.locator('.duel-portrait img').first().getAttribute('src');
    if (form.look && form.look !== id) assert.equal(after, 'media/menu/' + form.look + '.webp', 'the form shows its own dish');
    else {
      assert.equal(after, before);
      assert.match(await me.getAttribute('class'), /is-glowing/);
    }
    await fits(page, label + ' transformed');
    await page.evaluate(() => scrollTo(0, 0));
    await snap(page, `${label}-3-transformed`, { animations: 'disabled' });
    await page.context().close();
  }
  await battle(withLook);
  if (withoutLook) await battle(withoutLook);
  await battle(withLook, { reduced: true, label: 'reduced' });
  console.log(`PASS transform button, change of form with and without its own picture (${withLook}, ${withoutLook}), reduced motion, 390 px`);

  // ---------------------------------------------------------------- the collection
  async function collection(theme) {
    const page = await phone();
    await page.addInitScript(({ key, ids, theme }) => {
      localStorage.setItem(key, JSON.stringify({ version: 1, collection: Object.fromEntries(ids.map(id => [id, { copies: 1, xp: 0 }])), team: [ids[0]], xp: 0 }));
      localStorage.setItem('foodradar.preferences.v1', JSON.stringify({ theme }));
    }, { key: profileKey, ids: [withLook, plain], theme });
    await page.goto(origin + '/');
    await page.locator('.main-nav [data-nav="collection"]').click();
    const tile = page.locator(`.menu-card[data-card="${withLook}"]`);
    await tile.locator('.tf-badge').waitFor();
    assert.equal(await page.locator(`.menu-card[data-card="${plain}"] .tf-badge`).count(), 0, 'no badge without a transformation');
    assert.ok(await page.locator(`.deck-card[data-card="${withLook}"] .tf-badge`).count(), 'badge in the deck');
    // The badge is violet and does not cover the «+» of the deck.
    const badge = await tile.locator('.tf-badge').evaluate(el => {
      const add = el.closest('.menu-cell').querySelector('.deck-add')?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return { bg: getComputedStyle(el).backgroundImage, overlap: add ? !(box.right <= add.left || box.left >= add.right) : false };
    });
    assert.match(badge.bg, /rgb\(143, 61, 255\)|rgb\(122, 34, 240\)/, 'a violet badge');
    assert.equal(badge.overlap, false);
    await fits(page, theme + ' collection');
    await page.locator('.deck').scrollIntoViewIfNeeded();
    await snap(page, `collection-${theme}`);
    await page.getByRole('button', { name: 'У меня', exact: true }).click();
    await tile.scrollIntoViewIfNeeded();
    await snap(page, `collection-mine-${theme}`, { animations: 'disabled' });
    await tile.click();
    const box = page.locator('#dialog .tf-box');
    await box.waitFor();
    const card = FIGHTERS[withLook];
    assert.ok((await box.innerText()).includes(describeTransform(card.transform, card.attack).slice(0, 40)), 'the dialog explains the transformation');
    assert.ok(await page.locator('#dialog .reward-stage .tf-badge').count(), 'badge on the dialog picture');
    await page.locator('#dialog .reward-stage').scrollIntoViewIfNeeded();
    await snap(page, `dialog-${theme}`);
    await box.scrollIntoViewIfNeeded();
    await snap(page, `dialog-section-${theme}`);
    await page.context().close();
  }
  for (const theme of shots ? themes : ['green', 'white']) await collection(theme);
  if (shots) for (const theme of ['black', 'white', 'chili']) await battle(withoutLook ?? withLook, { theme, label: 'theme-' + theme });
  assert.deepEqual(errors, []);
  console.log('PASS violet badge in the collection, the deck and the card dialog, a «Трансформация» section, no page errors');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
