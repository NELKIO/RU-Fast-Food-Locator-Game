// Run independently of the unit suite with Playwright and Chromium installed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNAL_RELAYS } from '../public/js/duel-transport.js';
import { cardFor, suggestTeam } from '../public/js/game.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const sample = [
  { id: 'burger', name: 'Воппер', brand: 'bk', rarity: 'epic', attack: 6, hp: 19, maxHp: 19,
    skill: { name: 'Пламя гриля', cost: 2, power: 1, burn: { dmg: 3, turns: 3 } } },
  { id: 'fries', name: 'Картофель фри', brand: 'rostics', rarity: 'common', attack: 3, hp: 12, maxHp: 12,
    skill: { name: 'Соль на рану', cost: 1, power: 2 } }
];
const wildCard = { id: 'wild-pie', name: 'Пирожок', brand: 'vkusno', rarity: 'common', attack: 1, hp: 4, maxHp: 4,
  skill: { name: 'Осторожно, горячо', cost: 2, power: 1 } };
const fixture = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/duel.css"><style>body{background:#171917;color:#fff;font:16px system-ui;margin:12px}</style>
  <main id="game"></main><script type="module">
    import {mountDuels} from '/js/duels.js';
    const options = new URLSearchParams(location.search);
    // Chromium exposes numeric loopback ICE candidates after capture permission. Only the fixture
    // uses a fake audio source (the launched Chrome has a synthetic media device).
    window.testMedia = await navigator.mediaDevices.getUserMedia({audio:true});
    window.results = [];
    window.attempts = 0;
    const id = options.get('side') === 'guest' ? 'fries' : 'burger';
    const cards = ${JSON.stringify(sample)};
    const wild = ${JSON.stringify(wildCard)};
    let owned = [id], team = [id];
    const arena = mountDuels(document.querySelector('main'),{
      read: () => ({cards, owned, team, wild: {id: 'wild-1', opponent: () => wild}, wildWaitMs: 0}),
      onTeamChange: ids => { window.saveTeam = () => { team = ids; arena.refresh(); }; },
      initialMode:options.get('mode')||'online',award:async result=>{
        window.attempts++;
        await new Promise(done=>setTimeout(done,45));
        if (options.has('fail')) throw Error('local test write error');
        if (result.mode === 'wild' && result.won) { owned = [id, 'fries']; team = [...owned]; }
        window.results.push(result); return {ok:true};
      }});
    window.refreshArena = () => arena.refresh();
  </script></html>`;
const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/fixture') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(resolve(publicDir) + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
      '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp',
      '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', contentTypes[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});

function localRelays() {
  const blocked = new URL(SIGNAL_RELAYS[0]).hostname;
  const sites = new Map();
  const attempts = new Set();
  let outage = false, rejects = 0, publications = 0;
  return {
    async install(context) {
      await context.routeWebSocket(/.*/, socket => {
        const host = new URL(socket.url()).hostname;
        assert.ok(SIGNAL_RELAYS.includes('wss://' + host), 'unexpected external connection ' + host);
        attempts.add(host);
        if (host === blocked || outage) {
          rejects++;
          socket.close({ code: 1011, reason: 'local relay offline' });
          return;
        }
        if (!sites.has(host)) sites.set(host, new Map());
        const subscribers = sites.get(host);
        const filters = new Map();
        subscribers.set(socket, filters);
        socket.onClose(() => subscribers.delete(socket));
        socket.onMessage(raw => {
          const [kind, value, ...rest] = JSON.parse(String(raw));
          if (kind === 'REQ') {
            filters.set(value, rest);
            socket.send(JSON.stringify(['EOSE', value]));
          } else if (kind === 'CLOSE') {
            filters.delete(value);
          } else if (kind === 'EVENT') {
            publications++;
            socket.send(JSON.stringify(['OK', value.id, true, '']));
            const topic = value.tags.find(tag => tag[0] === 'x')?.[1];
            for (const [client, subs] of subscribers) {
              for (const [id, request] of subs) {
                if (request.some(f => f['#x']?.includes(topic) && f.kinds?.includes(value.kind))) {
                  client.send(JSON.stringify(['EVENT', id, value]));
                }
              }
            }
          }
        });
      });
      // Use native WebRTC/DTLS/SCTP on loopback; the test requires no Internet STUN traffic.
      await context.addInitScript(() => {
        window.testConnections = [];
        const Original = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Original {
          constructor(config, constraints) {
            const restricted = window.testBlockRtc || new URLSearchParams(location.search).has('restricted');
            super({ ...config, iceServers: [], iceTransportPolicy: restricted ? 'relay' : 'all' }, constraints);
            window.testConnections.push(this);
            this.addEventListener('connectionstatechange', () => console.debug('test WebRTC', this.connectionState));
          }
        };
      });
    },
    blackout() {
      outage = true;
      for (const clients of sites.values()) {
        for (const socket of clients.keys()) socket.close({ code: 1011, reason: 'all signaling offline' });
      }
    },
    check() {
      assert.ok(rejects >= 2 && attempts.size >= 2 && publications > 0, 'an independent signaling path handled setup');
    },
    snapshot() {
      return { attempts: [...attempts], rejects, publications,
        subscribers: Object.fromEntries([...sites].map(([host, clients]) => [host, [...clients.values()].map(set => set.size)])) };
    },
    restore() { outage = false; }
  };
}

let browser;
const errors = [];
try {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    args: ['--allow-loopback-in-peer-connection', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const relays = localRelays();
  async function newPage() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      permissions: ['microphone'] });
    await relays.install(context);
    await context.route(/^https?:/, route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.DUEL_DEBUG) page.on('console', message => console.log('browser', message.type(), message.text()));
    return page;
  }
  async function match(invite, restricted = false, leveled = false) {
    const host = await newPage();
    await host.goto(origin + '/fixture' + (restricted ? '?restricted=1' : ''));
    await host.getByRole('button', { name: 'Создать комнату' }).click();
    const code = await host.locator('[data-room-code]').getAttribute('data-room-code');
    const guest = await newPage();
    await guest.goto(origin + '/fixture?side=guest' + (restricted ? '&restricted=1' : '') + (invite ? '#duel=' + code : ''));
    if (!invite) {
      await guest.getByLabel('Код или ссылка').fill(code);
      await guest.getByRole('button', { name: 'Войти' }).click();
    }
    if (leveled) {
      // Both switch the level equaliser off; each sees the other's choice over the real connection.
      await host.locator('.duel-waiting', { hasText: 'Соперник выбирает команду' }).waitFor({ timeout: 50_000 });
      await host.locator('[data-duel-action="fair"]').click();
      await guest.locator('[data-duel-action="fair"]').click();
      for (const page of [host, guest]) await page.locator('.duel-equalizer small', { hasText: 'Оба выключили уравнитель' }).waitFor({ timeout: 50_000 });
    }
    await host.getByRole('button', { name: 'Подтвердить команду' }).click();
    await guest.getByRole('button', { name: 'Подтвердить команду' }).click();
    try {
      await Promise.all([host, guest].map(page => page.getByRole('heading', { name: 'Сетевая дуэль' }).waitFor({ timeout: 50_000 })));
    } catch (error) {
      console.error('Room diagnostics', relays.snapshot(), errors,
        JSON.stringify(await Promise.all([host, guest].map(page => page.evaluate(() => ({
          text: document.querySelector('main').innerText,
          connections: testConnections.map(pc => ({ signal: pc.signalingState, ice: pc.iceConnectionState, state: pc.connectionState,
            local: pc.localDescription?.sdp?.split('\r\n').filter(line => line.startsWith('a=candidate:')).map(line => line.split(' ')[7]),
            remote: pc.remoteDescription?.sdp?.split('\r\n').filter(line => line.startsWith('a=candidate:')).map(line => line.split(' ')[7]) }))
        }))))));
      throw error;
    }
    for (const page of [host, guest]) {
      await page.locator('[data-connection="' + (restricted ? 'relay' : 'direct') + '"]').waitFor({ timeout: 15_000 });
      assert.equal(await page.evaluate(() => testConnections.some(pc => pc.connectionState === 'connected' && !!pc.sctp)), !restricted);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'must fit a phone screen');
    }
    return [host, guest];
  }
  async function playToEnd(pages) {
    for (let round = 0; round <= 48; round++) {
      const actor = await Promise.race(pages.map(async page => {
        await page.waitForFunction(() => document.querySelector('[data-duel-action="move:hit"]:enabled, .duel-result'));
        return page;
      }));
      if (await actor.locator('.duel-result').count()) return;
      await actor.locator('[data-duel-action="move:hit"]').click();
    }
    throw Error('A match exceeded the maximum turn count');
  }
  const [host, guest] = await match(true);
  relays.check();
  relays.blackout();
  await playToEnd([host, guest]);
  await host.getByRole('heading', { name: 'Победа!' }).waitFor();
  await guest.getByRole('heading', { name: 'Поражение' }).waitFor();
  const [h, g] = await Promise.all([host, guest].map(page => page.evaluate(() => window.results)));
  assert.equal(h.length, 1); assert.equal(g.length, 1);
  assert.equal(h[0].matchId, g[0].matchId); assert.equal(h[0].won, true); assert.equal(g[0].won, false);
  console.log('PASS 390px / two browser contexts / one unavailable signaling relay at discovery / actual WebRTC / all relays stopped after discovery / identical outcome and one reward per player');
  await host.context().close(); await guest.context().close();
  relays.restore();
  const [remaining, leaving] = await match(false, true, true);
  const mover = await remaining.locator('[data-duel-action="move:hit"]').isEnabled() ? remaining : leaving;
  await mover.locator('[data-duel-action="move:hit"]').click();
  await Promise.all([remaining, leaving].map(page => page.locator('[data-completed-moves="1"]').waitFor()));
  await leaving.context().close();
  await remaining.getByText('Восстанавливаем связь…', { exact: false }).first().waitFor({ timeout: 22_000 });
  await remaining.getByRole('heading', { name: 'Матч отменён' }).waitFor({ timeout: 34_000 });
  assert.deepEqual(await remaining.evaluate(() => window.results), []);
  console.log('PASS manual invite code / WebRTC blocked at both ends / encrypted relay turn / disappeared browser mid-match / grace period / cancellation without a reward');
  await remaining.context().close();
  const migrated = await match(false);
  const starting = await migrated[0].locator('[data-duel-action="move:hit"]').isEnabled() ? migrated[0] : migrated[1];
  await starting.locator('[data-duel-action="move:hit"]').click();
  await Promise.all(migrated.map(page => page.locator('[data-completed-moves="1"]').waitFor()));
  await Promise.all(migrated.map(page => page.evaluate(() => { window.testBlockRtc = true; })));
  await Promise.all(migrated.map(page => page.evaluate(() => testConnections.forEach(pc => pc.close()))));
  await Promise.all(migrated.map(page => page.locator('[data-connection="relay"]').waitFor({ timeout: 32_000 })));
  await playToEnd(migrated);
  await Promise.all(migrated.map(page => page.locator('.duel-result').waitFor()));
  const recovered = await Promise.all(migrated.map(page => page.evaluate(() => window.results)));
  assert.equal(recovered[0].length, 1); assert.equal(recovered[1].length, 1);
  assert.equal(recovered[0][0].matchId, recovered[1][0].matchId);
  assert.notEqual(recovered[0][0].won, recovered[1][0].won);
  await Promise.all(migrated.map(page => page.context().close()));
  console.log('PASS direct connection cut after a confirmed turn / live handover to encrypted fallback / same completed match');
  const local = await newPage();
  await local.goto(origin + '/fixture?mode=lobby');
  await local.getByRole('heading', { name: 'Пирожок' }).waitFor();
  await local.getByRole('button', { name: 'Сразиться' }).click();
  await local.getByRole('heading', { name: 'Дикий боец' }).waitFor();
  await playToEnd([local]);
  await local.getByRole('heading', { name: 'Победа!' }).waitFor();
  assert.deepEqual(await local.evaluate(() => window.results.map(r => [r.mode, r.encounterId, r.won, r.teamIds])),
    [['wild', 'wild-1', true, ['burger']]]);
  await local.getByRole('button', { name: 'На арену' }).click();
  const allySlot = local.locator('[data-duel-action="pick:fries"]');
  assert.equal(await allySlot.getAttribute('aria-pressed'), 'true', 'the captured ally is selected for the next fight');
  await allySlot.click();
  await local.evaluate(() => window.refreshArena());
  assert.equal(await allySlot.getAttribute('aria-pressed'), 'false', 'an unrelated refresh preserves a pending manual choice');
  await local.evaluate(() => window.saveTeam());
  assert.equal(await allySlot.getAttribute('aria-pressed'), 'false');
  console.log('PASS wild fight from the arena lobby / one result for the encounter / no browser errors');
  await local.context().close();
  const failed = await newPage();
  await failed.goto(origin + '/fixture?mode=wild&fail=1');
  await playToEnd([failed]);
  assert.match(await failed.locator('.duel-result').innerText(), /Не удалось записать/);
  assert.deepEqual(await failed.evaluate(() => [window.attempts, window.results.length]), [1, 0]);
  await failed.context().close();
  console.log('PASS failed profile write / result shown without claiming XP / no duplicate reward attempt');

  // The production shell owns the URL router and the persisted profile. Bootstrap two earned
  // cards and then use only the site's public UI, including the real asynchronous award callback.
  const profileKey = 'fast-food-locator.profile.v1';
  const owner = await newPage(), visitor = await newPage();
  async function seed(page, id, xp = { [id]: 0 }) {
    await page.addInitScript(({ key, id, xp }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
        version: 1, collection: Object.fromEntries(Object.entries(xp).map(([card, value]) => [card, { copies: 1, xp: value }])), team: [id], xp: 0
      }));
    }, { key: profileKey, id, xp });
  }
  const xp = { 'vkusno-hamburger': 270, 'bk-angus-parmigiano': 0, 'bk-whopper': 0, 'bk-double-whopper': 0 };
  await Promise.all([seed(owner, 'bk-whopper', xp), seed(visitor, 'dodo-pepperoni')]);
  await owner.goto(origin + '/');
  await owner.locator('.main-nav [data-nav="arena"]').click();
  await owner.getByRole('button', { name: 'Дуэль с другом' }).click();
  await owner.getByRole('button', { name: 'Создать комнату' }).click();
  const inviteCode = await owner.locator('[data-room-code]').getAttribute('data-room-code');
  await visitor.goto(origin + '/#duel=' + inviteCode);
  // On a phone the start button sits right under the invite code, above the long team list.
  const [readyTop, teamTop] = await owner.evaluate(() => [
    document.querySelector('.duel-ready [data-duel-action="ready"]').getBoundingClientRect().top,
    document.querySelector('.duel-team').getBoundingClientRect().top,
  ]);
  assert.ok(readyTop < teamTop, 'the ready button comes before the team list on a phone');
  const menu = JSON.parse(await readFile(resolve(publicDir, 'data/menu.json'), 'utf8'));
  const picks = menu.filter(card => Object.hasOwn(xp, card.id));
  async function verifyPicker(leveled) {
    const cards = picks.map(item => cardFor(item, leveled && xp[item.id] ? 10 : 1));
    const hamburger = cards.find(card => card.id === 'vkusno-hamburger');
    const stats = owner.locator('[data-duel-action="card:vkusno-hamburger"] .duel-pick-title small > span');
    assert.equal((await stats.nth(0).innerText()).trim(), String(hamburger.maxHp));
    assert.equal((await stats.nth(1).innerText()).trim(), String(hamburger.attack));
    await owner.getByRole('button', { name: 'Подобрать команду' }).click();
    const selected = await owner.locator('.duel-slot[aria-pressed="true"]').evaluateAll(slots =>
      slots.sort((a, b) => Number(a.textContent) - Number(b.textContent)).map(el => el.dataset.duelAction.slice(5)));
    assert.deepEqual(selected, suggestTeam(cards));
  }
  await verifyPicker(false);
  await Promise.all([owner, visitor].map(page => page.getByRole('switch').click()));
  await Promise.all([owner, visitor].map(page => page.locator('.duel-equalizer small', { hasText: 'Оба выключили уравнитель' }).waitFor()));
  await verifyPicker(true);
  await Promise.all([owner, visitor].map(page => page.getByRole('button', { name: 'Подтвердить команду' }).click()));
  await Promise.all([owner, visitor].map(page => page.getByRole('heading', { name: 'Сетевая дуэль' }).waitFor({ timeout: 45_000 })));
  await playToEnd([owner, visitor]);
  await Promise.all([owner, visitor].map(page => page.locator('.duel-result').waitFor()));
  const profiles = await Promise.all([owner, visitor].map(page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), profileKey)));
  const ids = profiles.map(p => Object.keys(p.battleIds));
  assert.equal(ids[0].length, 1); assert.deepEqual(ids[0], ids[1]);
  assert.deepEqual(profiles.map(p => p.battles.wins).sort(), [0, 1]);
  assert.deepEqual(profiles.map(p => p.battles.losses).sort(), [0, 1]);
  assert.deepEqual(profiles.map(p => p.xp).sort((a,b) => a-b), [4, 24]);
  // The invite opens the room once: after the match a reload brings back the lobby, not the room.
  assert.equal(await visitor.evaluate(() => location.hash), '');
  await visitor.reload();
  await visitor.locator('#radar-view').waitFor({ state: 'visible' });
  assert.equal(await visitor.locator('[data-room-code]').count(), 0);
  assert.equal(await visitor.locator('#arena-view').isVisible(), false);
  const nextInvite = inviteCode === 'BBBBBBBBBB' ? 'CCCCCCCCCC' : 'BBBBBBBBBB';
  await owner.evaluate(code => { location.hash = 'duel=' + code; }, nextInvite);
  await owner.locator('[data-room-code="' + nextInvite + '"]').waitFor();
  assert.equal(await owner.evaluate(() => location.hash), '#duel=' + nextInvite);
  assert.deepEqual(errors, []);
  console.log('PASS production index / real menu / #duel deep link / identical match id / exactly one settlement in each saved profile / reload after the match leaves the room');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
