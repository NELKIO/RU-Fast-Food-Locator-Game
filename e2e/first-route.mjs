import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Serve at the real Pages-style subpath so root-relative assets break this test.
const root = fileURLToPath(new URL('../public/', import.meta.url));
const basePath = '/RU-Fast-Food-Locator-Game/';
const types = {
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.json': 'application/json',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith(basePath)) {
    res.writeHead(404).end();
    return;
  }
  const file = resolve(root, decodeURIComponent(path.slice(basePath.length)) || 'index.html');
  if (!file.startsWith(resolve(root) + sep)) {
    res.writeHead(400).end();
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port,
  base = origin + basePath;
const shouldCapture = process.env.GAME_SCREENSHOTS;
const profileKey = 'fast-food-locator.profile.v1';
const errors = [];
const missing = [];
let browser;
function log(s) {
  console.log('PASS ' + s);
}
async function watchPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().startsWith(base) && r.status() >= 400) missing.push(r.url() + ' ' + r.status());
  });
  return page;
}
async function capture(page, name) {
  if (!shouldCapture) return;
  await mkdir(shouldCapture, { recursive: true });
  await page.screenshot({
    path: resolve(shouldCapture, name + '.png'),
    fullPage: true,
    animations: 'disabled',
  });
}
async function checkWidth(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'No page-level horizontal overflow',
  );
}
async function saved(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), profileKey);
}
async function battle(page) {
  const final = page.getByRole('heading', { name: /^(Победа!|Поражение|Ничья)$/ });
  for (let turn = 0; turn < 50; turn++) {
    if (await final.count()) break;
    const hit = page.locator('[data-duel-action="move:hit"]'),
      special = page.locator('[data-duel-action="move:special"]');
    await page.waitForFunction(() =>
      Boolean(
        document.querySelector('.duel-result') ||
          document.querySelector('[data-duel-action="move:hit"]:enabled'),
      ),
    );
    if (await final.count()) break;
    await ((await special.isEnabled()) ? special : hit).click();
  }
  await final.waitFor();
  return final.textContent();
}
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CHROME_CHANNEL || 'chrome',
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    geolocation: { latitude: 55.751, longitude: 37.626, accuracy: 15 },
    locale: 'ru-RU',
  });
  const p = await watchPage(mobile);
  await p.goto(base);
  await p.locator('[data-point="bk-31"]').waitFor();
  assert.equal(await p.locator('#map-location').textContent(), 'Москва · обзор');
  await p.locator('.leaflet-image-layer').evaluate((img) => img.decode());
  await checkWidth(p);
  await capture(p, 'mobile-radar');
  log('Mobile first screen, local Moscow map and address list at a Pages subpath');
  await p.locator('[data-brand="bk"]').click();
  assert.ok(
    (await p.locator('.venue-copy strong').allTextContents()).every((v) => v === 'Бургер Кинг'),
  );
  await p.locator('[data-point="bk-31"]').click();
  await mobile.grantPermissions(['geolocation'], { origin });
  await p.getByRole('button', { name: 'Выбрать цель' }).click();
  await p.waitForFunction(
    () =>
      document.querySelector('.route-stat')?.textContent.includes('км') ||
      /\d+ м/.test(document.querySelector('.route-stat')?.textContent),
  );
  const far = await p.locator('.route-stat').textContent();
  assert.ok(
    /^(8\d\d м|9\d\d м|1(?:[,.]\d)? км)$/.test(far),
    'Expected roughly 900 m from the chosen street; saw ' + far,
  );
  assert.equal(await p.locator('[data-act="claim"]').count(), 0);
  await p.locator('[data-point]').nth(1).click();
  await p.getByRole('button', { name: /Текущая цель/ }).click();
  assert.match(await p.locator('.route-detail').textContent(), /Манежная/);
  await mobile.setGeolocation({ latitude: 55.7561, longitude: 37.6149, accuracy: 750 });
  await p.waitForFunction(() =>
    document.getElementById('geo-status').textContent.includes('неточен'),
  );
  assert.equal(await p.locator('[data-act="claim"]').count(), 0);
  await mobile.setGeolocation({ latitude: 55.7561, longitude: 37.6149, accuracy: 12 });
  await p.locator('[data-act="claim"]').waitFor();
  assert.equal(await p.locator('.route-stat').textContent(), '0 м');
  await p.locator('[data-act="claim"]').click();
  const training = p.getByRole('button', { name: 'В первый бой' });
  await training.waitFor();
  const rewardBefore = await saved(p);
  assert.equal(rewardBefore.visits['bk-31'].count, 1);
  const unlocked = Object.keys(rewardBefore.collection);
  assert.equal(unlocked.length, 1);
  assert.ok(unlocked[0].startsWith('bk-'));
  await p.locator('#dialog-body img').evaluate((img) => img.decode());
  await capture(p, 'mobile-reward');
  log(
    'Target switch and return, poor GPS rejected, arrival, roulette and restaurant-specific reward',
  );
  await training.click();
  await checkWidth(p);
  await p.getByRole('heading', { name: 'Тренировка', exact: true }).waitFor();
  await battle(p);
  const afterBattle = await saved(p);
  assert.equal(
    afterBattle.battles.wins + afterBattle.battles.losses + afterBattle.battles.draws,
    1,
  );
  assert.ok(afterBattle.xp > rewardBefore.xp);
  await p.locator('.main-nav [data-nav="collection"]').click();
  await p.getByRole('button', { name: 'У меня', exact: true }).click();
  assert.equal(await p.locator('.menu-card').count(), 1);
  await p.locator('.menu-card').click();
  assert.ok(await p.getByRole('link', { name: 'В официальном меню' }).isVisible());
  await p.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await p.reload();
  await p.locator('#route-box .route-detail').waitFor();
  assert.match(await p.locator('#route-box').textContent(), /Следующая находка через/);
  assert.equal(await p.locator('[data-act="claim"]').count(), 0);
  assert.deepEqual((await saved(p)).collection, afterBattle.collection);
  log('First battle completes, earned fighter and six-hour location cooldown survive reload');
  await p.locator('[data-brand="vkusno"]').click();
  await p.locator('[data-point="vkusno-88"]').click();
  await p.getByRole('button', { name: 'Сменить цель' }).click();
  await mobile.setGeolocation({ latitude: 55.755557, longitude: 37.615193, accuracy: 10 });
  await p.locator('[data-act="claim"]').click();
  await p.getByRole('button', { name: 'В первый бой' }).waitFor();
  const second = await saved(p);
  assert.equal(second.visits['vkusno-88'].count, 1);
  assert.equal(second.visits['bk-31'].count, 1);
  assert.equal(second.daily.claimed, true);
  assert.equal(second.daily.pointIds.length, 2);
  await p.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await p.locator('[data-scout]').click();
  await p.getByRole('button', { name: 'Вступить в бой' }).click();
  await battle(p);
  const walk = await saved(p);
  assert.equal(walk.encounter, null);
  assert.equal(walk.battles.wins + walk.battles.losses + walk.battles.draws, 2);
  log('Independent second location, daily route payout and a playable encounter');
  await mobile.close();
  const denied = await browser.newContext({
    viewport: { width: 320, height: 640 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
  });
  await denied.grantPermissions([], { origin });
  const q = await watchPage(denied);
  await q.goto(base);
  await q.locator('[data-point]').first().waitFor();
  await q.getByRole('button', { name: 'Включить GPS' }).click();
  await q.waitForFunction(() =>
    document.querySelector('#geo-status:not([hidden])')?.textContent.includes('Доступ'),
  );
  assert.equal(await q.locator('[data-act="claim"]').count(), 0);
  await checkWidth(q);
  await q.locator('.main-nav [data-nav="arena"]').click();
  await q.getByRole('button', { name: 'Пробный бой' }).click();
  await battle(q);
  assert.equal(await saved(q), null);
  log('320 px screen, denied GPS and a practice match without writing unearned rewards');
  await denied.close();
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'ru-RU',
  });
  const d = await watchPage(desktop);
  await d.goto(base);
  await d.locator('[data-point]').first().waitFor();
  await d.locator('#map-size').click();
  assert.equal(await d.locator('#map-size').getAttribute('aria-pressed'), 'true');
  await d.keyboard.press('Escape');
  assert.equal(await d.locator('#map-size').getAttribute('aria-pressed'), 'false');
  await d.locator('#zoom-in').click();
  await d.locator('#zoom-out').click();
  await d.locator('#sound').click();
  assert.equal(await d.locator('#sound').getAttribute('aria-pressed'), 'false');
  await checkWidth(d);
  await capture(d, 'desktop-radar');
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  log('Desktop map controls, sound toggle, clean runtime and all local resources present');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
