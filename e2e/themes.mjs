import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

// Run npm start in another terminal, or point this test at a Pages-style preview.
const url = new URL(process.env.THEME_TEST_URL || 'http://127.0.0.1:4173/');
const themes = ['chili', 'oven', 'green', 'grill', 'black', 'white'];
const brandColors = {
  bk: '#ffaa00',
  vkusno: '#264f36',
  rostics: '#e4002b',
  dodo: '#ff6400',
};
const phone = { width: Number(process.env.THEME_TEST_WIDTH || 320), height: 740 };

function luminance(rgb) {
  const linear = rgb.map((byte) => {
    const s = byte / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function checkPhoneWidth(page, description) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    dialog: document.querySelector('dialog[open]')?.scrollWidth,
  }));
  assert.equal(dimensions.viewport, phone.width, description + ': viewport');
  assert.ok(dimensions.page <= phone.width + 1, description + ': page overflows the phone');
  if (dimensions.dialog) {
    assert.ok(dimensions.dialog <= phone.width + 1, description + ': dialog overflows the phone');
  }
}

// Sample painted controls. Reading the theme name alone also passes for unused CSS.
async function renderedColors(page) {
  return page.evaluate(async () => {
    // A CSS transition can still expose the previous frame immediately after a tap.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.documentElement;
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    function rgba(color) {
      if (!CSS.supports('color', color)) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    }
    function backdrop(element) {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const layer = rgba(getComputedStyle(node).backgroundColor);
        if (layer[3]) layers.push(layer);
        if (layer[3] === 255) break;
      }
      // Composite any translucent layers against their ancestors in paint order.
      return layers.reverse().reduce((base, layer) => base.map((channel, index) =>
        Math.round((layer[index] * layer[3] + channel * (255 - layer[3])) / 255)
      ), [255, 255, 255]);
    }
    const heading = document.querySelector('#radar-title');
    const action = document.querySelector('#route-box button.primary[data-act]');
    const color = getComputedStyle(root).getPropertyValue('--brand-color').trim();
    const hex = (channels) => channels?.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
    return {
      surface: backdrop(heading),
      text: rgba(getComputedStyle(heading).color).slice(0, 3),
      panel: backdrop(document.querySelector('.nearby')),
      brandColor: color ? '#' + hex(rgba(color)) : null,
      button: action ? backdrop(action) : null,
      buttonText: action ? rgba(getComputedStyle(action).color).slice(0, 3) : null,
    };
  });
}

async function chooseTheme(page, theme) {
  await page.waitForFunction(() => window.geolocationCalls.watchPosition > 0);
  const watchesBefore = await page.evaluate(() => window.geolocationCalls.watchPosition);
  await page.locator('#theme-btn').click();
  const dialog = page.getByRole('dialog');
  const choices = dialog.locator('button[data-pick-theme]');
  await choices.first().waitFor();
  assert.deepEqual(
    (await choices.evaluateAll(buttons => buttons.map(b => b.dataset.pickTheme))).sort(),
    [...themes].sort(),
    'All six available themes appear exactly once',
  );
  await checkPhoneWidth(page, theme + ' picker');
  await dialog.locator(`button[data-pick-theme="${theme}"]`).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  assert.equal(await page.evaluate(() => window.geolocationCalls.watchPosition), watchesBefore,
    'Theme selection must not restart location tracking');
}

async function assertBrand(page, brand) {
  assert.equal(await page.locator('html').getAttribute('data-accent-brand'), brand);
  const colors = await renderedColors(page);
  assert.equal(colors.brandColor, brandColors[brand], 'Wrong restaurant accent for ' + brand);
  if (colors.button) {
    const painted = '#' + colors.button.map(byte => byte.toString(16).padStart(2, '0')).join('');
    assert.equal(painted, brandColors[brand], 'The visible target button uses the restaurant accent');
    const ratio = contrast(colors.buttonText, colors.button);
    assert.ok(ratio >= 4.5, 'Restaurant button text is legible for ' + brand + ': ' + ratio.toFixed(2));
    return ratio;
  }
}

async function chooseRestaurant(page, brand) {
  await page.locator(`#brands button[data-brand="${brand}"]`).click();
  const first = page.locator(`#venue-list button[data-point^="${brand}-"]`).first();
  await first.click();
  return first.getAttribute('data-point');
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CHROME_CHANNEL || 'chrome',
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const context = await browser.newContext({
    viewport: phone, isMobile: true, hasTouch: true, locale: 'ru-RU', reducedMotion: 'reduce',
  });
  await context.grantPermissions([], { origin: url.origin });
  await context.addInitScript(() => {
    const calls = { watchPosition: 0, getCurrentPosition: 0 };
    window.geolocationCalls = calls;
    for (const method of ['getCurrentPosition', 'watchPosition']) {
      const actual = navigator.geolocation[method].bind(navigator.geolocation);
      Object.defineProperty(navigator.geolocation, method, {
        value(...args) { calls[method]++; return actual(...args); },
      });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = page.locator('html');
  // Check what a player sees while the game module is still loading.
  await page.route('**/js/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  assert.equal(await root.getAttribute('data-theme'), 'black', 'First visit opens in black');
  assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(0, 0, 0)');
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#000000');
  for (const [stored, expected] of [['green', 'green'], ['retired-theme', 'black']]) {
    await page.evaluate(theme => localStorage.setItem('foodradar.preferences.v1', JSON.stringify({ theme })), stored);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await root.getAttribute('data-theme'), expected, 'Opening frame for saved theme ' + stored);
  }
  await page.unroute('**/js/app.js');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const firstRow = page.locator('#venue-list [data-point]').first();
  await firstRow.waitFor();
  assert.equal(await root.getAttribute('data-theme'), 'black', 'Unknown preferences use black in the running game');
  await page.evaluate(() => localStorage.removeItem('foodradar.preferences.v1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await firstRow.waitFor();
  assert.equal(await root.getAttribute('data-theme'), 'black', 'A player with no saved choice starts in black');
  console.log('PASS Black first frame, saved green preference and black fallback for unknown themes');
  const themeButton = page.locator('#theme-btn');
  assert.ok(await themeButton.isVisible(), 'Theme selector is visible on a phone');
  const bounds = await themeButton.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= phone.width + 1 && bounds.y >= 0 &&
    bounds.y + bounds.height <= phone.height, 'Theme selector is within the opening phone viewport: ' + JSON.stringify(bounds));
  const signatures = new Set();
  for (const theme of themes) {
    await chooseTheme(page, theme);
    const colors = await renderedColors(page);
    assert.ok(contrast(colors.text, colors.surface) >= 4.5, theme + ' heading contrast');
    assert.ok(contrast(colors.buttonText, colors.button) >= 4.5, theme + ' primary button contrast');
    if (theme === 'black') assert.ok(luminance(colors.surface) < 0.08, 'Black uses a dark page');
    if (theme === 'white') assert.ok(luminance(colors.surface) > 0.65, 'White uses a light page');
    signatures.add(JSON.stringify([colors.surface, colors.panel, colors.button, colors.text]));
    await checkPhoneWidth(page, theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await firstRow.waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'Theme survives reload');
    await page.waitForFunction(() => window.geolocationCalls.watchPosition > 0);
    assert.deepEqual(await page.evaluate(() => window.geolocationCalls), { watchPosition: 1, getCurrentPosition: 0 },
      'Every fresh page starts one location watch without asking for a second reading');
  }
  assert.equal(signatures.size, themes.length, 'Six themes produce six different rendered palettes');
  console.log('PASS Six distinct mobile palettes, contrast, width, one automatic location request per load and persistence');

  const directory = await context.request.get(new URL('data/venues.json', url).href);
  assert.equal(directory.status(), 200, 'Restaurant fixtures available at the tested site');
  const byId = new Map((await directory.json()).map(point => [point.id, point]));
  await context.grantPermissions(['geolocation'], { origin: url.origin });
  for (const theme of ['black', 'white']) {
    await chooseTheme(page, theme);
    let active = null;
    for (const brand of Object.keys(brandColors)) {
      const selectedId = await chooseRestaurant(page, brand);
      await assertBrand(page, active || brand);
      const destination = byId.get(selectedId);
      await context.setGeolocation({ latitude: destination.lat + 0.000025, longitude: destination.lon, accuracy: 9 });
      await page.locator('#route-box button[data-act="target"]').click();
      // Moving between restaurants needs two independent readings a few metres apart.
      await delay(1200);
      await context.setGeolocation({ latitude: destination.lat, longitude: destination.lon, accuracy: 8 });
      await page.locator('#route-box button[data-act="claim"]').waitFor();
      const ratio = await assertBrand(page, brand);
      assert.ok(ratio, 'Measured the active restaurant’s ready-to-claim button');
      console.log(`PASS ${theme}/${brand} active award button ${brandColors[brand]} · text contrast ${ratio.toFixed(2)}:1`);
      active = brand;
    }
    // Changing the appearance while a route is active must keep the route and its accent.
    await chooseTheme(page, theme === 'white' ? 'black' : 'white');
    await assertBrand(page, active);
    await chooseTheme(page, theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#route-box button[data-act="cancel"]').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await assertBrand(page, active);
    await page.getByRole('button', { name: 'Отменить цель' }).click();
    await chooseRestaurant(page, 'vkusno');
    await assertBrand(page, 'vkusno');
    assert.match(await page.locator('#route-box button[data-act="target"]').innerText(), /Выбрать цель/);
    await checkPhoneWidth(page, theme + ' restaurant selection');
    console.log('PASS ' + theme + ': four restaurant accents, active route priority, cancellation and reload');
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser?.close();
}
