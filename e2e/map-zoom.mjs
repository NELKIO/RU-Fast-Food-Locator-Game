import assert from 'node:assert/strict';

// Observe public Leaflet events and coordinates without replacing any gesture handler.
function observeMap() {
  if (this.getContainer().id !== 'map') return;
  const probe = window.zoomProbe = { map: this, moving: false, zooms: 0, wheels: 0 };
  this.on('movestart', () => { probe.moving = true; });
  this.on('moveend', () => { probe.moving = false; });
  this.on('zoomend', () => { probe.zooms++; });
  document.addEventListener('wheel', event => {
    const inside = this.getContainer().contains(event.target);
    // Read defaultPrevented after all application listeners have run.
    setTimeout(() => {
      probe.wheels++;
      probe.wheel = { inside, ctrl: event.ctrlKey, prevented: event.defaultPrevented, trusted: event.isTrusted };
    }, 0);
  }, { capture: true, passive: true });
}

// Add a test-only observer after the real library. The game's map and controls are untouched.
export async function observeMapZoom(page) {
  await page.route('**/vendor/leaflet/leaflet.js', async route => {
    const leaflet = await (await route.fetch()).text();
    await route.fulfill({ contentType: 'text/javascript', body: leaflet + '\n;L.Map.addInitHook(' + observeMap.toString() + ');' });
  });
}

async function prepareMap(page) {
  await page.locator('#radar-view').evaluate(async el => {
    await document.fonts.ready;
    await Promise.all(el.getAnimations().map(animation => animation.finished));
  });
  await page.waitForFunction(() => window.zoomProbe && !zoomProbe.moving);
  await page.locator('#map').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  // Previous user flows may have ended on either zoom limit.
  await page.evaluate(() => { zoomProbe.map.setZoom(15, { animate: false }); });
}

async function pointOn(locator, x = 0.34, y = 0.45) {
  const box = await locator.boundingBox();
  return { x: Math.round(box.x + box.width * x), y: Math.round(box.y + box.height * y) };
}

async function expectAnchoredZoom(page, cursor, direction, gesture) {
  const before = await page.evaluate(({ x, y }) => {
    const map = zoomProbe.map, rect = map.getContainer().getBoundingClientRect();
    const location = map.containerPointToLatLng([x - rect.left, y - rect.top]);
    return { location: [location.lat, location.lng], zoom: map.getZoom(), ends: zoomProbe.zooms,
      scale: visualViewport.scale, dpr: devicePixelRatio, scroll: scrollY };
  }, cursor);
  await gesture();
  await page.waitForFunction(ends => zoomProbe.zooms > ends && !zoomProbe.moving, before.ends, { timeout: 3500 });
  const after = await page.evaluate(({ cursor, location }) => {
    const map = zoomProbe.map, rect = map.getContainer().getBoundingClientRect();
    const point = map.latLngToContainerPoint(location);
    return { zoom: map.getZoom(), scale: visualViewport.scale, dpr: devicePixelRatio, scroll: scrollY,
      drift: Math.hypot(rect.left + point.x - cursor.x, rect.top + point.y - cursor.y) };
  }, { cursor, location: before.location });
  const change = after.zoom - before.zoom;
  assert.equal(Math.sign(change), direction, 'map zoom direction');
  assert.ok(after.drift <= 4, 'map point moved ' + after.drift.toFixed(1) + ' CSS pixels away from the gesture');
  assert.ok(Math.abs(after.scale - before.scale) < 0.01, 'visual viewport zoom changed');
  assert.equal(after.dpr, before.dpr, 'desktop page zoom changed');
  assert.ok(Math.abs(after.scroll - before.scroll) <= 1, 'the document scrolled under the map');
  return change;
}

async function wheel(page, cursor, deltaY, ctrl, inside) {
  const previous = await page.evaluate(() => zoomProbe.wheels);
  await page.mouse.move(cursor.x, cursor.y);
  if (ctrl) await page.keyboard.down('Control');
  try { await page.mouse.wheel(0, deltaY); }
  finally { if (ctrl) await page.keyboard.up('Control'); }
  await page.waitForFunction(n => zoomProbe.wheels > n, previous);
  assert.deepEqual(await page.evaluate(() => zoomProbe.wheel), { inside, ctrl, prevented: inside, trusted: true });
}

export async function checkDesktopZoom(page) {
  await prepareMap(page);
  const map = page.locator('#map'), centre = await pointOn(map, 0.5, 0.5);
  for (const direction of [1, -1]) {
    const button = page.locator(direction > 0 ? '#zoom-in' : '#zoom-out');
    assert.equal(await expectAnchoredZoom(page, centre, direction, () => button.click()), direction);
  }
  for (const ctrl of [false, true]) {
    // A wheel gesture should also reach the map when the pointer is over a control.
    const cursor = ctrl ? await pointOn(page.locator('#zoom-in'), 0.5, 0.5) : await pointOn(map);
    for (const direction of [1, -1]) {
      await expectAnchoredZoom(page, cursor, direction,
        () => wheel(page, cursor, -direction * (ctrl ? 16 : 80), ctrl, true));
    }
  }
  const heading = page.getByRole('heading', { name: 'Радар заведений' });
  const zooms = await page.evaluate(() => zoomProbe.zooms);
  const canScroll = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 5);
  for (const ctrl of [false, true]) {
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await wheel(page, await pointOn(heading, 0.5, 0.5), 140, ctrl, false);
    if (!ctrl && canScroll) await page.waitForFunction(() => scrollY > 5);
  }
  // Give a debounced map handler a chance to finish before checking this negative case.
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => zoomProbe.zooms), zooms);
}

export async function checkMobilePinch(page) {
  await prepareMap(page);
  const anchor = await pointOn(page.locator('#map'), 0.40, 0.5);
  const input = await page.context().newCDPSession(page);
  for (const direction of [1, -1]) {
    await expectAnchoredZoom(page, anchor, direction, async () => {
      const steps = direction > 0 ? [28, 35, 42, 49, 56] : [56, 49, 42, 35, 28];
      for (const [index, gap] of steps.entries()) {
        const touchPoints = [-1, 1].map((side, id) => ({ id, x: anchor.x + side * gap, y: anchor.y }));
        await input.send('Input.dispatchTouchEvent', { type: index ? 'touchMove' : 'touchStart', touchPoints });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    });
  }
}
