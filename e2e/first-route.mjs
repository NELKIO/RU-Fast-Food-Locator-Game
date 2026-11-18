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
  // Map tiles come from openstreetmap.org; the tests stay offline and check the fallback notice.
  async function offline(ctx) {
    await ctx.route(/^https?:/, (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
  }
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    geolocation: { latitude: 55.751, longitude: 37.626, accuracy: 15 },
    permissions: ['geolocation'],
    locale: 'ru-RU',
  });
  await offline(mobile);
  const p = await watchPage(mobile);
  await p.goto(base);
  // A new player is greeted with one common fighter already in the team.
  const welcome = p.getByRole('button', { name: 'Поехали' });
  await welcome.waitFor();
  const starter = await saved(p);
  const starterIds = Object.keys(starter.collection);
  assert.equal(starterIds.length, 1);
  assert.deepEqual(starter.team, starterIds);
  await capture(p, 'mobile-welcome');
  await welcome.click();
  // GPS starts by itself: no button, and the map tag switches to the live position.
  assert.equal(await p.getByRole('button', { name: 'Включить GPS' }).count(), 0);
  await p.waitForFunction(() => document.getElementById('map-location').textContent === 'Ты здесь · ±15 м');
  assert.ok(await p.locator('#geo-status').isHidden(), 'a working GPS shows no notice');
  await p.locator('[data-point="bk-31"]').waitFor();
  assert.equal(await p.locator('.leaflet-image-layer').count(), 0, 'no static map overlay');
  await p.locator('.map-empty:not([hidden])').waitFor();
  await checkWidth(p);
  await capture(p, 'mobile-radar');
  log('Mobile first screen: starter fighter, automatic GPS, address list at a Pages subpath');
  await p.locator('[data-brand="bk"]').click();
  assert.ok(
    (await p.locator('.venue-copy strong').allTextContents()).every((v) => v === 'Бургер Кинг'),
  );
  await p.locator('[data-point="bk-31"]').click();
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
  const toArena = p.getByRole('button', { name: 'На арену' });
  await toArena.waitFor();
  assert.equal(await p.getByRole('button', { name: 'В первый бой' }).count(), 0);
  const rewardBefore = await saved(p);
  assert.equal(rewardBefore.visits['bk-31'].count, 1);
  assert.ok(Object.keys(rewardBefore.collection).some((id) => id.startsWith('bk-')));
  assert.ok(rewardBefore.encounter, 'a wild fighter waits after the visit');
  await p.locator('#dialog-body .find-wild').waitFor();
  await p.locator('#dialog-body img').first().evaluate((img) => img.decode());
  await capture(p, 'mobile-reward');
  log('Target switch and return, poor GPS rejected, arrival, chain reward and a wild fighter nearby');
  await toArena.click();
  await checkWidth(p);
  await p.getByRole('heading', { name: 'Дикий боец', exact: true }).waitFor();
  await capture(p, 'mobile-battle');
  await battle(p);
  const afterBattle = await saved(p);
  assert.equal(
    afterBattle.battles.wins + afterBattle.battles.losses + afterBattle.battles.draws,
    1,
  );
  assert.equal(afterBattle.encounter, null);
  assert.ok(afterBattle.xp >= rewardBefore.xp);
  await p.locator('.main-nav [data-nav="collection"]').click();
  await p.getByRole('button', { name: 'У меня', exact: true }).click();
  assert.equal(await p.locator('.menu-card').count(), Object.keys(afterBattle.collection).length);
  await p.locator('.menu-card').first().click();
  assert.ok(await p.getByRole('link', { name: 'В официальном меню' }).isVisible());
  assert.equal(await p.getByRole('button', { name: 'Тренировка' }).count(), 0);
  await p.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await p.reload();
  await p.locator('#route-box .route-detail').waitFor();
  assert.match(await p.locator('#route-box').textContent(), /Следующая находка через/);
  assert.equal(await p.locator('[data-act="claim"]').count(), 0);
  assert.deepEqual((await saved(p)).collection, afterBattle.collection);
  log('Wild fight from the reward, earned fighters and six-hour location cooldown survive reload');
  await p.locator('[data-brand="vkusno"]').click();
  await p.locator('[data-point="vkusno-88"]').click();
  await p.getByRole('button', { name: 'Сменить цель' }).click();
  await mobile.setGeolocation({ latitude: 55.755557, longitude: 37.615193, accuracy: 10 });
  await p.locator('[data-act="claim"]').click();
  await p.getByRole('button', { name: 'Забрать' }).waitFor();
  const second = await saved(p);
  assert.equal(second.visits['vkusno-88'].count, 1);
  assert.equal(second.visits['bk-31'].count, 1);
  assert.equal(second.daily.claimed, true);
  assert.equal(second.daily.pointIds.length, 2);
  assert.ok(second.encounter.enemyId.startsWith('vkusno-'), 'a visit lures a wild fighter of that chain');
  await p.getByRole('button', { name: 'Забрать' }).click();
  await p.locator('#wild-card [data-wild]').click();
  await p.getByRole('heading', { name: 'Дикий боец', exact: true }).waitFor();
  await battle(p);
  const walk = await saved(p);
  assert.equal(walk.encounter, null);
  assert.equal(walk.battles.wins + walk.battles.losses + walk.battles.draws, 2);
  log('Independent second location, daily route payout and a wild fight from the radar teaser');
  await mobile.close();
  const denied = await browser.newContext({
    viewport: { width: 320, height: 640 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
  });
  await offline(denied);
  const q = await watchPage(denied);
  await q.goto(base);
  await q.getByRole('button', { name: 'Поехали' }).click();
  await q.locator('[data-point]').first().waitFor();
  await q.waitForFunction(() =>
    document.querySelector('#geo-status:not([hidden])')?.textContent.includes('Нет доступа'),
  );
  await q.locator('#geo-status [data-gps-retry]').waitFor();
  assert.equal(await q.locator('#map-location').textContent(), 'Москва · обзор');
  assert.equal(await q.locator('[data-act="claim"]').count(), 0);
  await checkWidth(q);
  await q.locator('.main-nav [data-nav="arena"]').click();
  await q.getByRole('button', { name: 'Сразиться' }).click();
  await battle(q);
  const offlinePlayer = await saved(q);
  assert.equal(Object.keys(offlinePlayer.visits).length, 0);
  assert.equal(offlinePlayer.battles.wins + offlinePlayer.battles.losses + offlinePlayer.battles.draws, 1);
  log('320 px screen, denied GPS explained with a retry, and the starter can still fight a wild fighter');
  await denied.close();
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'ru-RU',
  });
  await offline(desktop);
  const d = await watchPage(desktop);
  await d.goto(base);
  await d.getByRole('button', { name: 'Поехали' }).click();
  await d.locator('[data-point]').first().waitFor();
  // Venues of different chains in one building (ТЦ Охотный ряд) share a pin; a tap lists each of them.
  const shared = d.locator('.venue-pin.grouped[title*="Бургер Кинг"][title*="Rostic"]').first();
  for (let attempt = 0; attempt < 4 && !(await d.locator('.pin-chooser').count()); attempt++) {
    await shared.waitFor();
    await shared.click();
    await d.waitForTimeout(700);
  }
  const choice = d.locator('.pin-chooser [data-venue^="rostics-"]').first();
  const venueId = await choice.getAttribute('data-venue');
  assert.ok(await d.locator('.pin-chooser [data-venue^="bk-"]').count());
  await capture(d, 'desktop-chooser');
  await choice.click();
  await d.locator('.venue-row[data-point="' + venueId + '"][aria-pressed="true"]').waitFor();
  log('Venues in one building share a pin and a chooser');
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
