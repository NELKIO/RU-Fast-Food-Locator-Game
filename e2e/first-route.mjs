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
  const restricted = await browser.newContext();
  await offline(restricted);
  await restricted.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    get() { throw new DOMException('Storage is blocked', 'SecurityError'); },
  }));
  const restrictedPage = await watchPage(restricted);
  await restrictedPage.goto(base);
  await restrictedPage.getByRole('button', { name: 'Поехали' }).click();
  await restrictedPage.locator('[data-point]').first().waitFor();
  await restrictedPage.locator('.main-nav [data-nav="arena"]').click();
  await restrictedPage.getByRole('button', { name: 'Сразиться' }).waitFor();
  await restricted.close();
  log('Radar and arena open when reading localStorage throws a SecurityError');

  for (const useWebLocks of [true, false]) {
    const context = await browser.newContext();
    await offline(context);
    if (!useWebLocks) await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    const authors = new Set();
    await context.routeWebSocket('**/stats-test', socket => {
      socket.onMessage(data => {
        const [type, event] = JSON.parse(String(data));
        if (type === 'EVENT') {
          authors.add(event.pubkey);
          socket.send(JSON.stringify(['OK', event.id, true]));
        }
      });
    });
    const tabs = await Promise.all([watchPage(context), watchPage(context)]);
    await Promise.all(tabs.map(tab => tab.goto(base + 'data/menu.json')));
    const responses = await Promise.all(tabs.map(tab => tab.evaluate(async () => {
      const { createSiteStats } = await import('../js/site-stats.js');
      const stats = createSiteStats({ live: true, relays: ['ws://' + location.host + '/stats-test'] });
      return stats.report({ battles: { wins: 1 } });
    })));
    assert.ok(responses.some(Boolean));
    assert.equal(authors.size, 1, 'both tabs reported under the same key');
    await context.close();
  }
  log('Two tabs share one statistics identity with Web Locks and with the IndexedDB fallback');

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
  // A second tap on the selected venue makes it the target, without scrolling to the button.
  await p.locator('[data-point="bk-31"]').click();
  await p.locator('#toast:not([hidden])', { hasText: 'Нажми ещё раз' }).waitFor();
  assert.equal(await p.getByRole('button', { name: 'Выбрать цель' }).count(), 1);
  await p.locator('[data-point="bk-31"]').click();
  await p.locator('#toast:not([hidden])', { hasText: /^Цель: Бургер Кинг/ }).waitFor();
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
  // On the way there is nothing to press: no dead button, only the cancel cross beside the find.
  assert.equal(await p.locator('#route-box [data-act="gps"]').count(), 0);
  assert.doesNotMatch(await p.locator('#route-box').textContent(), /В пути/);
  const [mapBox, routeBox, listBox, featureBox, crossBox] = await Promise.all(
    ['#map-card', '#route-box', '.nearby', '#route-box .route-feature', '#route-box .route-cancel'].map((s) =>
      p.locator(s).boundingBox(),
    ),
  );
  assert.ok(routeBox.y >= mapBox.y + mapBox.height, 'the target block sits under the map');
  assert.ok(listBox.y >= routeBox.y + routeBox.height, 'nearby points follow the target block');
  assert.ok(crossBox.x >= featureBox.x + featureBox.width, 'the cross sits to the right of the find');
  assert.ok(Math.abs(crossBox.y + crossBox.height / 2 - (featureBox.y + featureBox.height / 2)) < 4);
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
  log('Double-tap targeting, target switch and return, poor GPS rejected, arrival, chain reward and a wild fighter nearby');
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
  // The deck on top mirrors the team: + adds a fighter, × takes one out, the last one stays.
  const deckIds = () => p.locator('.deck-card').evaluateAll((els) => els.map((e) => e.dataset.card));
  assert.deepEqual(await deckIds(), afterBattle.team);
  const spare = p.locator('[data-deck-add]').first();
  if (await spare.count()) {
    const id = await spare.getAttribute('data-deck-add');
    await spare.click();
    await p.waitForFunction((n) => document.querySelectorAll('.deck-card').length === n, afterBattle.team.length + 1);
    assert.deepEqual((await saved(p)).team, [...afterBattle.team, id]);
    await p.locator(`[data-deck-remove="${id}"]`).click();
    await p.waitForFunction((n) => document.querySelectorAll('.deck-card').length === n, afterBattle.team.length);
  }
  for (const id of afterBattle.team.slice(1)) await p.locator(`[data-deck-remove="${id}"]`).click();
  await p.waitForFunction(() => document.querySelectorAll('.deck-card').length === 1);
  await p.locator('[data-deck-remove]').click();
  await p.locator('#toast:not([hidden])', { hasText: 'хотя бы один' }).waitFor();
  assert.deepEqual((await saved(p)).team, afterBattle.team.slice(0, 1));
  // Sorting: by name the cards go alphabetically, and the choice survives a redraw.
  await p.getByRole('button', { name: 'Все находки', exact: true }).click();
  await p.locator('[data-sort]').selectOption('name');
  const names = await p.locator('.menu-card strong').allTextContents();
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ru')));
  await p.locator('[data-sort]').selectOption('rarity');
  assert.match(await p.locator('.menu-card .rarity').first().textContent(), /Легендарн/);
  assert.equal((await p.evaluate(() => JSON.parse(localStorage.getItem('foodradar.preferences.v1')))).sort, 'rarity');
  await p.getByRole('button', { name: 'У меня', exact: true }).click();
  await p.locator('.menu-card').first().click();
  assert.equal(await p.getByRole('link', { name: 'В официальном меню' }).count(), 0);
  assert.equal(await p.getByRole('button', { name: 'Тренировка' }).count(), 0);
  await p.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await p.reload();
  await p.locator('#route-box .route-detail').waitFor();
  assert.match(await p.locator('#route-box').textContent(), /Следующая находка через/);
  assert.equal(await p.locator('[data-act="claim"]').count(), 0);
  assert.deepEqual((await saved(p)).collection, afterBattle.collection);
  log('Wild fight from the reward, deck edits, earned fighters and six-hour location cooldown survive reload');
  // «Подобрать»: the deck becomes the strongest owned fighters (up to three).
  await p.locator('.main-nav [data-nav="collection"]').click();
  const ownedBefore = Object.keys((await saved(p)).collection).length;
  if (ownedBefore > 1) {
    await p.locator('[data-deck-auto]').click();
    await p.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).team.length > 0, profileKey);
    await p.waitForTimeout(200);
    assert.equal((await saved(p)).team.length, Math.min(3, ownedBefore), 'the suggested deck is full');
  }
  // The trainer's team follows the strength of the own team, not its order; «Новая команда» rolls a new one.
  await p.locator('.main-nav [data-nav="arena"]').click();
  await p.locator('.duel-trainer').waitFor();
  for (let i = 0; i < 5 && (await p.locator('.duel-trainer.is-lord').count()); i++) await p.getByRole('button', { name: 'Другой тренер' }).click();
  const lineup = () => p.locator('.duel-trainer-fighter').evaluateAll((els) => els.map((e) => e.title).join('|'));
  const picked = p.locator('.duel-slot[aria-pressed="true"]');
  const added = (await picked.count()) < 2 ? await p.locator('.duel-slot[aria-pressed="false"]').first().getAttribute('data-duel-action') : null;
  if (added) await p.locator(`[data-duel-action="${added}"]`).click();
  assert.ok((await picked.count()) >= 2, 'a team of two or more to rearrange');
  const trainerTeam = await lineup();
  const order = async () => (await saved(p)).team.join(',');
  const before = await order();
  // Reorder: the first fighter leaves and comes back as the last one.
  const leadPick = await picked.first().getAttribute('data-duel-action');
  await picked.first().click();
  await p.locator(`[data-duel-action="${leadPick}"]`).click();
  assert.notEqual(await order(), before, 'the own team order changed');
  assert.equal(await lineup(), trainerTeam, 'reordering the own team keeps the trainer team');
  let rolled = false;
  for (let i = 0; i < 6 && !rolled; i++) {
    await p.getByRole('button', { name: 'Новая команда' }).click();
    rolled = (await lineup()) !== trainerTeam;
  }
  assert.ok(rolled, '«Новая команда» gives the trainer another line-up');
  if (added) await p.locator(`[data-duel-action="${added}"]`).click();
  await p.locator('.main-nav [data-nav="radar"]').click();
  log('Reordering the own team keeps the trainer team; «Новая команда» rolls a new one');
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
  // The arena opened before the menu has loaded says it is loading, then shows the fighters by itself.
  const early = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await offline(early);
  const e = await watchPage(early);
  await e.goto(base);
  await e.getByRole('button', { name: 'Поехали' }).click();
  await e.locator('[data-point]').first().waitFor();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await early.route('**/data/menu.json', async (route) => { await held; await route.continue(); });
  await e.reload();
  await e.locator('.main-nav [data-nav="arena"]').click();
  await e.getByRole('heading', { name: 'Загружаем бойцов…' }).waitFor();
  assert.equal(await e.getByRole('heading', { name: 'Нет бойцов' }).count(), 0, 'a player with fighters is not told there are none');
  release();
  await e.locator('.duel-team, .duel-wild').first().waitFor({ timeout: 10_000 });
  assert.equal(await e.getByRole('heading', { name: 'Загружаем бойцов…' }).count(), 0);
  // The map, set up while hidden, still works when the player returns to the radar.
  await e.waitForTimeout(1200);
  await e.locator('.main-nav [data-nav="radar"]').click();
  await e.locator('[data-point]').first().waitFor();
  assert.deepEqual(errors, [], 'no map errors after starting on the arena');
  log('Arena opened before the menu loads shows a loading note, then the fighters without switching tabs');
  await early.close();
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'ru-RU',
  });
  await offline(desktop);
  // Counts the sounds the battle makes (Web Audio voices).
  await desktop.addInitScript(() => {
    window.__sounds = 0;
    const proto = (window.AudioContext || window.webkitAudioContext)?.prototype;
    if (!proto) return;
    for (const name of ['createOscillator', 'createBufferSource']) {
      const original = proto[name];
      proto[name] = function () { window.__sounds++; return original.call(this); };
    }
  });
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
  // A double tap on a single pin picks it and makes it the target instead of zooming the map.
  await d.keyboard.press('Escape');
  const zoom = await d.evaluate(() => document.querySelector('.leaflet-map-pane').style.transform);
  const single = d.locator('.venue-pin:not(.grouped)').first();
  const singleTitle = await single.getAttribute('title');
  await single.dblclick();
  await d.locator('#toast:not([hidden])', { hasText: 'Цель: ' + singleTitle }).waitFor();
  assert.equal(await d.evaluate(() => document.querySelector('.leaflet-map-pane').style.transform), zoom, 'double tap does not zoom');
  log('Venues in one building share a pin and a chooser; a double tap on a pin sets the target');
  // The arena tab always brings back the arena lobby, even from the friend duel screen.
  await d.locator('.main-nav [data-nav="arena"]').click();
  await d.getByRole('button', { name: 'Дуэль с другом' }).click();
  await d.getByRole('heading', { name: 'Дуэль с другом' }).waitFor();
  await d.locator('.main-nav [data-nav="arena"]').click();
  await d.getByRole('heading', { name: 'Арена', exact: true }).waitFor();
  // A tap on a team fighter opens its card for reading; the round slot is what changes the team.
  const firstPick = d.locator('.duel-pick-info').first();
  const pickName = (await firstPick.locator('strong').textContent()).trim();
  await firstPick.click();
  await d.locator('#dialog[open] h2', { hasText: pickName }).waitFor();
  assert.equal(await d.locator('#dialog [data-team]').count(), 0, 'the arena card is read-only');
  await d.getByRole('button', { name: 'Закрыть', exact: true }).click();
  // A full-motion wild fight: effects play on a canvas, the controls wait for them, nothing breaks.
  await d.getByRole('button', { name: 'Сразиться' }).click();
  await d.locator('[data-duel-action="move:hit"]:enabled').click();
  await d.locator('.duel-fx').waitFor({ state: 'attached' });
  assert.ok(await d.locator('[data-duel-action="move:hit"]').isDisabled(), 'controls wait for the animation');
  await battle(d);
  const sounds = await d.evaluate(() => window.__sounds);
  assert.ok(sounds >= 10, `the battle has sound (${sounds} voices)`);
  await d.locator('.main-nav [data-nav="radar"]').click();
  assert.equal(await d.locator('.duel-fx').count(), 0, 'the effects layer leaves with the arena');
  log('Arena tab returns to the lobby, and a full-motion wild fight runs clean, with sound');
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
