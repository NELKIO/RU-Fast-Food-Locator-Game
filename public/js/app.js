import { brands, icon, brandMark, esc, rarityNames, formatDistance, formatWait } from './ui.js';
import { makeMap, MOSCOW } from './map.js';
import { applyAppearance, normalizeTheme, themeOptions, themes } from './themes.js';
import {
  createProfileStore,
  nearestRestaurants,
  visitStatus,
  claimVisit,
  cardFor,
  collectionCards,
  setTeam,
  todayRoute,
  wildEncounter,
  wildFighter,
  grantStarter,
  resolveEncounter,
  recordBattle,
  WILD_COOLDOWN_MS,
  GPS_RULES,
} from './game.js';
import { describeSkill } from './fighters.js';
import { mountDuels } from './duels.js';
import { reelMarkup, rewardMarkup } from './rewards.js';

const $ = (id) => document.getElementById(id);
const store = createProfileStore();
const prefsKey = 'foodradar.preferences.v1';
const tabs = { radar: 'Радар заведений', collection: 'Коллекция', arena: 'Арена' };
let prefs = {};
try {
  const saved = JSON.parse(localStorage.getItem(prefsKey));
  if (saved && typeof saved === 'object') prefs = saved;
} catch {}
function savePref(key, value) {
  prefs[key] = value;
  try {
    const current = JSON.parse(localStorage.getItem(prefsKey)) || {};
    localStorage.setItem(prefsKey, JSON.stringify({ ...current, [key]: value }));
  } catch {}
}
const lastMarkup = new WeakMap();
function html(node, markup) {
  if (lastMarkup.get(node) === markup) return;
  const focused = node.contains(document.activeElement) ? document.activeElement : null;
  const key = focused?.getAttribute('data-point') ?? focused?.getAttribute('data-act');
  node.innerHTML = markup;
  lastMarkup.set(node, markup);
  if (key) {
    const next = Array.from(node.querySelectorAll('button')).find(
      (button) => button.dataset.point === key || button.dataset.act === key,
    );
    next?.focus({ preventScroll: true });
  }
}
function putIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
function text(node, value) {
  if (node.textContent !== String(value)) node.textContent = String(value);
}
function listen(id, callback) {
  $(id).addEventListener('click', callback);
}
const owned = () => Object.keys(profile.collection);
const lookup = (id) => venuesById.get(id);
let venues = [],
  menu = [],
  venuesById = new Map(),
  menuById = new Map();
let profile = store.read(),
  tab = 'radar',
  brand = Object.hasOwn(brands, prefs.brand) ? prefs.brand : 'all';
let selected = null,
  target = null,
  fix = null,
  map = null,
  geoWatch = null,
  geoMessage = '',
  geoRetry = false,
  requesting = false;
let nearby = [],
  collectionFilter = 'all',
  duelCleanup = null,
  onlineActive = false;
let soundContext = null,
  readyNotified = false,
  toastTimer = null,
  dialogRun = 0,
  claimPending = false;
let audioOn = prefs.sound !== false;
let appearance = normalizeTheme(prefs.theme);
function syncAppearance() {
  const destination = target?.brand || selected?.brand || brand;
  applyAppearance(appearance, destination);
  $('theme-btn').title = 'Оформление · ' + themes[appearance].name;
}
putIcons();
syncAppearance();

function showToast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 3800);
}
function openDialog(title, markup) {
  dialogRun++;
  $('dialog').setAttribute('aria-label', title);
  $('dialog-body').innerHTML = markup;
  if (!$('dialog').open) $('dialog').showModal();
  $('dialog').scrollTop = 0;
  return dialogRun;
}
function closeDialog() {
  if ($('dialog').open) $('dialog').close();
  dialogRun++;
}
listen('theme-btn', () => {
  openDialog(
    'Оформление',
    `<h2>Оформление</h2>
    <p>В чёрной и белой темах цвет кнопок и метки задаёт ресторан, к которому ты идёшь.</p>
    <div class="theme-choices" role="group" aria-label="Цветовая тема">${themeOptions(appearance)}</div>`,
  );
  $('dialog-body').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
});
window.addEventListener('storage', (event) => {
  if (event.key !== prefsKey) return;
  try {
    appearance = normalizeTheme(JSON.parse(event.newValue)?.theme);
    syncAppearance();
  } catch {}
});
listen('dialog-close', closeDialog);
$('dialog').addEventListener('click', (e) => {
  if (e.target === $('dialog')) closeDialog();
});
$('dialog').addEventListener('close', () => {
  dialogRun++;
});
function resumeSound() {
  if (!audioOn) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    soundContext ??= new Audio();
    if (soundContext.state === 'suspended') soundContext.resume().catch(() => {});
  } catch {}
}
function arrival() {
  showToast('Ты у цели. Можно открыть рулетку!');
  if (!audioOn) return;
  navigator.vibrate?.([90, 65, 90]);
  if (soundContext?.state !== 'running') return;
  for (const [n, hz] of [
    [0, 587],
    [1, 880],
  ]) {
    const start = soundContext.currentTime + n * 0.14,
      osc = soundContext.createOscillator(),
      gain = soundContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
    osc.connect(gain).connect(soundContext.destination);
    osc.start(start);
    osc.stop(start + 0.17);
  }
}
document.addEventListener('pointerdown', resumeSound, { once: true });
function updateSound() {
  $('sound').innerHTML =
    icon(audioOn ? 'sound' : 'muted', 16) +
    '<span>Звук ' +
    (audioOn ? 'вкл.' : 'выкл.') +
    '</span>';
  $('sound').setAttribute('aria-pressed', String(audioOn));
}
listen('sound', () => {
  audioOn = !audioOn;
  savePref('sound', audioOn);
  if (audioOn) resumeSound();
  updateSound();
});
updateSound();

// GPS starts by itself when the page opens. The player only sees it when something is wrong.
function askGps() {
  if (!navigator.geolocation || !window.isSecureContext) {
    geoMessage =
      'Этот браузер не даёт геолокацию. Открой игру в обычном браузере по HTTPS, чтобы отмечаться у заведений.';
    geoRetry = false;
    renderGeo();
    return;
  }
  if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch);
  requesting = true;
  geoMessage = '';
  renderGeo();
  geoWatch = navigator.geolocation.watchPosition(
    (position) => {
      const c = position.coords;
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
      const first = fix === null;
      fix = {
        lat: c.latitude,
        lon: c.longitude,
        accuracy: c.accuracy,
        timestamp: position.timestamp,
      };
      requesting = false;
      geoMessage = '';
      if (first && !target) selected = null;
      renderRadar({ center: first });
      renderGeo();
    },
    (error) => {
      requesting = false;
      // A watch keeps trying after a timeout; a known position is still better than an alarm.
      if (error.code !== 1 && fix) {
        renderGeo();
        return;
      }
      const reasons = {
        1: 'Нет доступа к геолокации — пока показываем центр Москвы. Разреши геолокацию для этого сайта в настройках браузера.',
        2: 'Не получается поймать GPS. Выйди на открытое место.',
        3: 'GPS долго ищет сигнал. Выйди на открытое место.',
      };
      geoMessage = reasons[error.code] || 'Не удалось определить местоположение.';
      geoRetry = true;
      if (error.code === 1) {
        navigator.geolocation.clearWatch(geoWatch);
        geoWatch = null;
        fix = null;
        if (!target) selected = null;
      }
      renderRadar({ center: error.code === 1 });
      renderGeo();
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 18000 },
  );
}
$('geo-status').addEventListener('click', (e) => {
  if (e.target.closest('[data-gps-retry]')) askGps();
});

function renderGeo() {
  text(
    $('map-location'),
    fix ? 'Ты здесь · ±' + Math.round(fix.accuracy) + ' м' : requesting ? 'Ищем тебя…' : 'Москва · обзор',
  );
  $('map-location').parentElement.classList.toggle('live', Boolean(fix));
  $('map-location').parentElement.classList.toggle('searching', requesting && !fix);
  text($('map-key-label'), fix ? 'Твоя позиция' : 'Центр обзора');
  let notice = geoMessage,
    retry = Boolean(geoMessage) && geoRetry;
  if (!notice && fix && Date.now() - fix.timestamp > GPS_RULES.maxAgeMs) {
    notice = 'Координаты давно не обновлялись.';
    retry = true;
  } else if (!notice && fix?.accuracy > GPS_RULES.maxAccuracy)
    notice = 'GPS пока неточен: для отметки нужна погрешность до 120 м. На открытом месте сигнал лучше.';
  if (!notice && !store.persistent)
    notice = 'Браузер ограничил хранение данных. Прогресс доступен до закрытия страницы.';
  html(
    $('geo-status'),
    notice
      ? '<span>' +
          esc(notice) +
          '</span>' +
          (retry
            ? '<button type="button" class="soft-btn" data-gps-retry>' + icon('gps', 15) + 'Повторить</button>'
            : '')
      : '',
  );
  $('geo-status').hidden = !notice;
}
function renderBrands() {
  $('brands').innerHTML = [
    ['all', 'Все сети'],
    ...Object.entries(brands).map(([k, v]) => [k, v.name]),
  ]
    .map(
      ([k, v]) =>
        '<button type="button" class="filter" data-brand="' +
        k +
        '" aria-pressed="' +
        (brand === k) +
        '">' +
        (k === 'all'
          ? '<span class="brand-mark brand-all">' + icon('grid', 16) + '</span>'
          : brandMark(k, 18)) +
        esc(v) +
        '</button>',
    )
    .join('');
}
$('brands').addEventListener('click', (e) => {
  const b = e.target.closest('[data-brand]');
  if (!b) return;
  brand = b.dataset.brand;
  savePref('brand', brand);
  selected = target && (brand === 'all' || target.brand === brand) ? target : null;
  renderBrands();
  renderRadar();
});
// A second tap on the venue the player has just picked makes it the target, so they do not
// have to scroll down to the button and back up to the map. An automatic selection (the
// nearest venue) does not count as the first tap.
let tappedId = null;
function pick(venue, fromList = false) {
  if (!venue) return;
  const again = venue.id === tappedId && venue.id === selected?.id;
  tappedId = venue.id;
  if (again && venue.id !== target?.id) {
    chooseTarget(venue);
    showToast('Цель: ' + brands[venue.brand].name + ' · ' + venue.address);
    return;
  }
  selected = venue;
  renderRadar({ focus: fromList });
  if (venue.id !== target?.id && (prefs.tapHints ?? 0) < 3) {
    savePref('tapHints', (prefs.tapHints ?? 0) + 1);
    showToast('Нажми ещё раз — и это заведение станет целью');
  }
}
function chooseTarget(venue) {
  resumeSound();
  selected = venue;
  target = venue;
  readyNotified = false;
  savePref('target', target.id);
  renderRadar();
  if (!fix && !requesting) askGps();
}
$('venue-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-point]');
  if (row) pick(lookup(row.dataset.point), true);
});
function renderNearby(options = {}) {
  if (!venues.length) return;
  const origin = fix || MOSCOW;
  nearby = nearestRestaurants(venues, brand, origin, 7);
  if (!selected) selected = nearby[0] ? lookup(nearby[0].id) : null;
  const list = [...nearby];
  if (selected && !list.some((p) => p.id === selected.id)) {
    const extra = nearestRestaurants([selected], 'all', origin, 1)[0];
    if (extra) list.unshift(extra);
  }
  const wrapper = $('venue-list');
  const rows = list
    .map(
      (p) =>
        '<button type="button" class="venue-row" data-point="' +
        esc(p.id) +
        '" aria-pressed="' +
        (p.id === selected?.id) +
        '" title="' +
        esc(p.address) +
        '">' +
        brandMark(p.brand, 22) +
        '<span class="venue-copy"><strong>' +
        esc(brands[p.brand].name) +
        '</strong><small>' +
        esc(p.address) +
        '</small></span><span class="venue-distance">' +
        formatDistance(p.distance) +
        '</span></button>',
    )
    .join('');
  html(wrapper, rows || '<p class="empty">Для этой сети пока нет точек.</p>');
  text($('near-total'), list.length);
  text($('near-origin'), fix ? 'По прямой от твоей позиции' : 'По прямой от центра Москвы');
  map?.update({ brand, selected, target, fix }, options);
}
function renderRoute() {
  const box = $('route-box');
  $('radar-view').classList.toggle('is-tracking', Boolean(target));
  if (!selected) {
    html(box, '');
    return;
  }
  const signatureItems = {
    bk: 'bk-whopper',
    vkusno: 'vkusno-big-hit',
    rostics: 'rostics-chefburger',
    dodo: 'dodo-pepperoni',
  };
  const item = menuById.get(signatureItems[selected.brand]);
  const feature = item
    ? `<button type="button" class="route-feature" data-featured="${esc(item.id)}" aria-label="Возможная находка: ${esc(item.name)}">
    <img src="${esc(item.image)}" alt="" width="58" height="43">
    <span class="route-feature-copy"><small>Возможная находка</small><strong class="route-feature-name">${esc(item.name)}</strong></span>
    ${icon('next', 15)}</button>`
    : '';
  const selectedActive = selected.id === target?.id;
  box.classList.toggle('has-target', selectedActive);
  if (!selectedActive) {
    const earlier = profile.visits[selected.id]?.lastAt;
    const state = visitStatus(profile, selected, fix);
    const note =
      earlier && state.remainingMs > 0
        ? '<p class="route-detail">Новая находка через ' + formatWait(state.remainingMs) + '</p>'
        : '';
    const current = target
      ? '<button class="return-target" type="button" data-act="current">' +
        icon('flag', 15) +
        ' Текущая цель · ' +
        esc(brands[target.brand].name) +
        (fix ? ' · ' + formatDistance(visitStatus(profile, target, fix).distance) : '') +
        ' ' +
        icon('next', 14) +
        '</button>'
      : '';
    html(
      box,
      current +
        feature +
        note +
        '<button type="button" class="primary" data-act="target"><span>' +
        icon('locate', 17) +
        (target ? 'Сменить цель' : 'Выбрать цель') +
        '</span>' +
        icon('arrow', 18) +
        '</button>',
    );
    return;
  }
  const state = visitStatus(profile, target, fix);
  const reasons = {
    ready: 'Ты в радиусе точки. Награда доступна.',
    'no-location': requesting ? 'Определяем, где ты…' : 'Нужна геолокация, чтобы подтвердить посещение.',
    stale: 'Координаты устарели. Обнови GPS.',
    inaccurate: 'Нужен более точный сигнал GPS.',
    'too-far': 'Подойди к цели на ' + Math.round(state.radius || 65) + ' м.',
    cooldown: 'Следующая находка через ' + formatWait(state.remainingMs) + '.',
  };
  const gpsAction = ['no-location', 'stale', 'inaccurate'].includes(state.reason) && !requesting;
  const searching = requesting && !fix;
  // Only a real next step gets a button; while walking there is nothing to press.
  const action =
    state.ok || gpsAction || searching
      ? '<button type="button" class="' +
        (state.ok ? 'primary' : 'outline-btn') +
        '" data-act="' +
        (state.ok ? 'claim' : 'gps') +
        '"' +
        (searching ? ' disabled' : '') +
        '>' +
        icon(state.ok ? 'spark' : 'gps', 17) +
        (state.ok ? 'Открыть рулетку' : searching ? 'Ищем GPS…' : 'Обновить GPS') +
        '</button>'
      : '';
  html(
    box,
    '<div class="micro section-kicker">' +
      icon('flag', 12) +
      ' Цель · ' +
      esc(brands[target.brand].name) +
      '</div><div class="route-stat">' +
      (fix ? formatDistance(state.distance) : 'Нужен GPS') +
      '</div><p class="route-detail">' +
      esc(target.address) +
      '<br>' +
      esc(reasons[state.reason] || 'Проверяем позицию…') +
      '</p><div class="route-row">' +
      feature +
      '<button type="button" class="route-cancel" data-act="cancel" aria-label="Отменить цель" title="Отменить цель">' +
      icon('close', 17) +
      '</button></div>' +
      action,
  );
}
function proximity() {
  if (!target) {
    readyNotified = false;
    return;
  }
  const status = visitStatus(profile, target, fix);
  if (status.ok && !readyNotified) {
    readyNotified = true;
    arrival();
  }
  if (fix && status.distance > status.radius + 25) readyNotified = false;
}
function renderRadar(options = {}) {
  renderNearby(options);
  syncAppearance();
  renderRoute();
  renderGeo();
  proximity();
}
$('route-box').addEventListener('click', (e) => {
  const featured = e.target.closest('[data-featured]');
  if (featured) {
    showCard(featured.dataset.featured);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'target' && selected) chooseTarget(selected);
  else if (act === 'current' && target) {
    if (brand !== 'all' && brand !== target.brand) {
      brand = target.brand;
      savePref('brand', brand);
      renderBrands();
    }
    pick(target, true);
  } else if (act === 'cancel') {
    target = null;
    readyNotified = false;
    savePref('target', null);
    renderRadar();
  } else if (act === 'gps') askGps();
  else if (act === 'claim') spinReward();
});

function cardImage(card, cls = '') {
  return (
    '<img class="' +
    cls +
    '" src="' +
    esc(card.image) +
    '" alt="' +
    esc(card.name) +
    '" loading="lazy">'
  );
}
function rarityTag(card) {
  return (
    '<span class="rarity ' +
    esc(card.rarity) +
    '">' +
    esc(rarityNames[card.rarity] || card.rarity) +
    '</span>'
  );
}
// What the fighter does in a fight, in the same words the arena uses.
function skillBox(card) {
  const skill = card.skill;
  if (!skill) return '';
  return (
    '<div class="skill-box"><small>' +
    icon('spark', 13) +
    ' Фирменный приём · ' +
    skill.cost +
    ' энерг.</small><strong>«' +
    esc(skill.name) +
    '»</strong><p>' +
    esc(describeSkill(skill, card.attack)) +
    '</p><small>Обычный удар «' +
    esc(card.basic || 'Удар') +
    '» — ' +
    esc(card.attack) +
    ' урона и +1 энергия</small></div>'
  );
}
function cardStats(card) {
  return (
    '<div class="stat-grid"><div><strong>' +
    esc(card.attack) +
    '</strong><small>Атака</small></div><div><strong>' +
    esc(card.maxHp || card.hp) +
    '</strong><small>Здоровье</small></div><div><strong>' +
    esc(card.level) +
    '</strong><small>Уровень</small></div></div>'
  );
}
async function spinReward() {
  if (!target || claimPending) return;
  const point = target;
  claimPending = true;
  let result;
  try {
    result = await store.update((p) => claimVisit(p, point, fix, menu));
  } finally {
    claimPending = false;
  }
  if (!result.ok) {
    renderRadar();
    showToast('Не удалось подтвердить посещение. Проверь расстояние и таймер точки.');
    return;
  }
  const card = result.card;
  const pool = menu.filter((c) => c.brand === point.brand);
  const run = openDialog('Рулетка находок', reelMarkup(pool, card, brands[point.brand].name));
  const strip = $('dialog-body').querySelector('.reel-strip');
  const final = 'translateX(-' + (14 * 82 + 41) + 'px)';
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1500;
  if (duration && strip.animate) {
    const a = strip.animate([{ transform: 'translateX(-41px)' }, { transform: final }], {
      duration,
      easing: 'cubic-bezier(.15,.7,.15,1)',
      fill: 'forwards',
    });
    try {
      await a.finished;
    } catch {}
  } else strip.style.transform = final;
  if (dialogRun !== run || !$('dialog').open) return;
  openDialog(
    'Награда · ' + card.name,
    rewardMarkup(result, result.encounter ? menuById.get(result.encounter.enemyId)?.name : ''),
  );
}

function strongCards() {
  const got = new Map(collectionCards(profile, menu).map((c) => [c.id, c]));
  return menu.map((item) => got.get(item.id) ?? cardFor(item));
}
function renderQuests() {
  const daily = todayRoute(profile),
    n = daily.pointIds.length;
  html(
    $('day-card'),
    '<div class="quest-icon">' +
      icon('route', 26) +
      '</div><div><h2>Маршрут дня</h2><p>' +
      (daily.claimed
        ? 'Маршрут пройден. Получено 25 опыта.'
        : 'Посети две разные точки за день · +25 опыта') +
      '</p></div><div class="quest-tail route-meter" aria-label="' +
      n +
      ' из 2">' +
      n +
      ' / 2<div><b class="' +
      (n > 0 ? 'done' : '') +
      '"></b><b class="' +
      (n > 1 ? 'done' : '') +
      '"></b></div></div>',
  );
  const e = currentWild(),
    item = e && menuById.get(e.enemyId),
    wait = wildWait();
  html(
    $('wild-card'),
    item
      ? '<button type="button" class="wild-teaser" data-wild aria-label="Сразиться с диким бойцом: ' +
          esc(item.name) +
          '"><span class="quest-icon wild-portrait">' +
          cardImage(item) +
          '</span><span class="wild-copy"><h2>Дикий боец рядом</h2><p>' +
          esc(item.name) +
          ' · победи — и он твой</p></span><span class="quest-tail round-btn">' +
          icon('battle', 19) +
          '</span></button>'
      : '<div class="quest-icon">' +
          icon('compass', 27) +
          '</div><div><h2>Дикий боец</h2><p>' +
          (wait ? 'Следующий появится через ' + formatWait(wait) + ' или сразу у заведения' : 'Появится после отметки у заведения') +
          '</p></div>',
  );
}
function currentWild() {
  const e = profile.encounter;
  return e && menuById.has(e.enemyId) ? e : null;
}
function wildWait() {
  return profile.lastScoutAt === null
    ? 0
    : Math.max(0, profile.lastScoutAt + WILD_COOLDOWN_MS - Date.now());
}
// A new wild fighter shows up by itself once the pause after the last one is over.
let wildPending = false;
async function ensureWild() {
  if (wildPending || !menu.length || currentWild() || wildWait() > 0 || !profile.team.length) return;
  wildPending = true;
  try {
    await store.update((p) => wildEncounter(p, menu));
  } finally {
    wildPending = false;
  }
}
$('wild-card').addEventListener('click', (e) => {
  if (e.target.closest('[data-wild]')) switchTab('arena', { initialMode: 'wild' });
});

function renderCollection() {
  const view = $('collection-view'),
    cards = strongCards(),
    count = owned().length;
  const visible = cards.filter(
    (c) =>
      collectionFilter === 'all' ||
      (collectionFilter === 'mine'
        ? Object.hasOwn(profile.collection, c.id)
        : profile.team.includes(c.id)),
  );
  const switches = [
    ['all', 'Все находки'],
    ['mine', 'У меня'],
    ['team', 'Колода'],
  ];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const deck = profile.team.map((id) => byId.get(id)).filter(Boolean);
  const slots = [0, 1, 2]
    .map((n) => {
      const c = deck[n];
      if (!c)
        return (
          '<div class="deck-slot is-empty"><span class="deck-num">' +
          (n + 1) +
          '</span>' +
          icon('plus', 18) +
          '<small>' +
          (count > deck.length ? 'Нажми «+» на бойце' : 'Пусто') +
          '</small></div>'
        );
      return (
        '<div class="deck-slot" style="--deck-color:' +
        esc(brands[c.brand].color) +
        '"><button type="button" class="deck-card" data-card="' +
        esc(c.id) +
        '"><span class="deck-num">' +
        (n + 1) +
        '</span>' +
        cardImage(c) +
        '<strong>' +
        esc(c.name) +
        '</strong><small>Ур. ' +
        c.level +
        '</small></button><button type="button" class="deck-remove" data-deck-remove="' +
        esc(c.id) +
        '" aria-label="Убрать из колоды: ' +
        esc(c.name) +
        '" title="Убрать из колоды">' +
        icon('close', 14) +
        '</button></div>'
      );
    })
    .join('');
  const deckBox = count
    ? '<section class="deck panel" aria-labelledby="deck-title"><div class="deck-head"><h2 id="deck-title">Колода</h2><small>' +
      deck.length +
      ' из 3 · выходят по порядку</small></div><div class="deck-slots">' +
      slots +
      '</div></section>'
    : '';
  const canAdd = deck.length < 3;
  const tiles = visible
    .map((c, i) => {
      const entry = profile.collection[c.id];
      const add =
        entry && canAdd && !profile.team.includes(c.id)
          ? '<button type="button" class="deck-add" data-deck-add="' +
            esc(c.id) +
            '" aria-label="В колоду: ' +
            esc(c.name) +
            '" title="В колоду">' +
            icon('plus', 15) +
            '</button>'
          : '';
      return (
        '<div class="menu-cell">' +
        add +
        '<button type="button" class="menu-card ' +
        (entry ? 'owned' : 'locked') +
        '" style="--i:' +
        Math.min(i, 24) +
        '" data-card="' +
        esc(c.id) +
        '">' +
        rarityTag(c) +
        cardImage(c) +
        '<small>' +
        esc(brands[c.brand].name) +
        '</small><strong>' +
        esc(c.name) +
        '</strong><small>' +
        (entry
          ? 'Ур. ' +
            c.level +
            ' · ' +
            (profile.team.includes(c.id) ? 'В команде' : entry.copies + ' экз.')
          : 'Ещё не найдено') +
        '</small></button></div>'
      );
    })
    .join('');
  view.innerHTML =
    '<div class="page-head"><div><h1>Коллекция</h1><p>Открыто ' +
    count +
    ' из ' +
    menu.length +
    ' бойцов. Дубликаты и бои повышают уровень бойца.</p></div></div>' +
    deckBox +
    '<div class="catalog-bar" role="group" aria-label="Фильтр коллекции">' +
    switches
      .map(
        ([k, v]) =>
          '<button data-catalog="' +
          k +
          '" aria-pressed="' +
          (collectionFilter === k) +
          '">' +
          v +
          '</button>',
      )
      .join('') +
    '</div>' +
    (tiles
      ? '<div class="menu-grid">' + tiles + '</div>'
      : '<div class="panel empty"><h3>Здесь появится первый боец</h3><p>Выбери ресторан на радаре и открой рулетку у цели.</p><button class="soft-btn" data-open="radar">К радару ' +
        icon('arrow', 16) +
        '</button></div>');
}
// Adds a fighter to the end of the deck or takes it out; the deck keeps one to three fighters.
async function toggleTeam(id) {
  const res = await store.update((p) =>
    setTeam(p, p.team.includes(id) ? p.team.filter((k) => k !== id) : [...p.team, id]),
  );
  if (res.ok) showToast('Колода сохранена.');
  else
    showToast(
      profile.team.includes(id)
        ? 'В колоде должен остаться хотя бы один боец.'
        : 'В колоде уже три бойца. Сначала убери одного.',
    );
  return res.ok;
}
function showCard(id) {
  const item = menuById.get(id);
  if (!item) return;
  const card = strongCards().find((c) => c.id === id),
    entry = profile.collection[id],
    inTeam = profile.team.includes(id);
  const action = entry
    ? '<div class="dialog-actions"><button class="' +
      (inTeam ? 'outline-btn' : 'primary') +
      '" data-team="' +
      esc(id) +
      '">' +
      icon(inTeam ? 'minus' : 'plus', 16) +
      (inTeam ? 'Убрать из команды' : 'В команду') +
      '</button></div>'
    : '<button class="primary" data-visit-brand="' +
      esc(card.brand) +
      '">Найти заведение ' +
      icon('arrow', 16) +
      '</button>';
  openDialog(
    card.name,
    '<div class="micro section-kicker">' +
      esc(brands[card.brand].name) +
      '</div><div class="reward-stage">' +
      cardImage(card, 'reward-img') +
      rarityTag(card) +
      '</div><h2>' +
      esc(card.name) +
      '</h2><p>' +
      esc(card.role) +
      ' · ' +
      (entry ? 'В коллекции, ' + entry.copies + ' экз.' : 'Можно получить в рулетке этой сети.') +
      '</p>' +
      cardStats(card) +
      skillBox(card) +
      (entry
        ? '<p class="card-xp">Опыт бойца · ' +
          esc(card.xp) +
          (card.xpToNext
            ? ' · до нового уровня ' + esc(card.xpToNext)
            : ' · максимальный уровень') +
          '</p>'
        : '') +
      action +
      '<p><a href="' +
      esc(card.source) +
      '" target="_blank" rel="noopener">В официальном меню</a></p>',
  );
}
$('collection-view').addEventListener('click', (e) => {
  const f = e.target.closest('[data-catalog]'),
    card = e.target.closest('[data-card]'),
    open = e.target.closest('[data-open]'),
    deckEdit = e.target.closest('[data-deck-add], [data-deck-remove]');
  if (deckEdit) toggleTeam(deckEdit.dataset.deckAdd || deckEdit.dataset.deckRemove);
  else if (f) {
    collectionFilter = f.dataset.catalog;
    renderCollection();
  } else if (card) showCard(card.dataset.card);
  else if (open) switchTab(open.dataset.open);
});

function renderHeader() {
  const level = Math.floor(profile.xp / 100) + 1;
  text($('level-label'), 'Ур. ' + level);
  $('profile-btn').setAttribute('aria-label', 'Открыть профиль. Уровень ' + level);
}
function profileDialog() {
  const visited = Object.keys(profile.visits).length;
  const visits = Object.values(profile.visits).reduce((n, v) => n + v.count, 0);
  const team = strongCards()
    .filter((c) => profile.team.includes(c.id))
    .map((c) => c.name);
  const points = Object.entries(profile.visits)
    .sort((a, b) => b[1].lastAt - a[1].lastAt)
    .slice(0, 8);
  openDialog(
    'Профиль игрока',
    '<div class="micro section-kicker">' +
      icon('star', 14) +
      ' Профиль игрока</div><h2>Уровень ' +
      (Math.floor(profile.xp / 100) + 1) +
      '</h2><p>' +
      profile.xp +
      ' опыта · ещё ' +
      (100 - (profile.xp % 100)) +
      ' до следующего уровня.</p><div class="stat-grid"><div><strong>' +
      visited +
      '</strong><small>Разных точек</small></div><div><strong>' +
      visits +
      '</strong><small>Посещений</small></div><div><strong>' +
      owned().length +
      '</strong><small>Бойцов</small></div></div><h3>Команда</h3><p>' +
      esc(team.length ? team.join(' · ') : 'Первый боец присоединится после посещения ресторана.') +
      '</p><p>Побед · ' +
      profile.battles.wins +
      ' &nbsp; Поражений · ' +
      profile.battles.losses +
      ' &nbsp; Ничьих · ' +
      profile.battles.draws +
      '</p>' +
      (points.length
        ? '<h3>Последние посещения</h3><ul class="about-list">' +
          points
            .map(([id, v]) => {
              const point = lookup(id);
              return (
                '<li>' +
                esc(point ? brands[point.brand].name + ' · ' + point.address : id) +
                '<br>' +
                esc(
                  new Date(v.lastAt).toLocaleString('ru-RU', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
                ) +
                '</li>'
              );
            })
            .join('') +
          '</ul>'
        : '') +
      '<button class="outline-btn" data-open="collection">Открыть коллекцию</button>',
  );
}
listen('profile-btn', profileDialog);
listen('about', () => {
  openDialog(
    'Об игре',
    '<div class="micro section-kicker">' +
      icon('radar', 14) +
      ' Фудрадар</div><h2>Как играть</h2><ol class="about-list"><li>Выбери заведение на карте и дойди до него. Расстояние считается по прямой.</li><li>У цели открой рулетку и получи бойца из меню. Та же точка снова наградит через шесть часов.</li><li>После отметки рядом появляется дикий боец. Победи его на арене — и он твой. Ещё на арене можно позвать друга на дуэль по ссылке.</li></ol><p>Профиль хранится в этом браузере. GPS используется для расчётов на устройстве. При просмотре онлайн-карты её провайдер получает запросы фрагментов видимой области.</p><p>Адреса четырёх сетей — All The Places. Карта — OpenStreetMap. Фото блюд — из официальных меню, ссылка есть на карточке.</p><p><a href="https://www.alltheplaces.xyz/" target="_blank" rel="noopener">All The Places</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>',
  );
});

function arenaData() {
  const e = currentWild();
  return {
    cards: strongCards(),
    owned: owned(),
    team: [...profile.team],
    wild: e && { id: e.id, opponent: (team) => wildFighter(e, menu, team) },
    wildWaitMs: wildWait(),
  };
}
function switchTab(next, options = {}) {
  if (!Object.hasOwn(tabs, next)) return;
  // Inside the arena its own tab returns to the lobby; leaving a live room still asks first.
  if (tab === 'arena' && onlineActive && !options.confirmed && !options.initialMode) {
    openDialog(
      'Покинуть сетевую комнату',
      '<h2>Выйти из комнаты?</h2><p>Соперник увидит, что ты вышел. Незавершённый матч закончится без награды.</p><div class="dialog-actions"><button class="primary" data-stay>Остаться</button><button class="outline-btn" data-leave="' +
        esc(next) +
        '">Выйти</button></div>',
    );
    return;
  }
  closeDialog();
  if (duelCleanup) {
    duelCleanup();
    duelCleanup = null;
    onlineActive = false;
  }
  tab = next;
  for (const key of Object.keys(tabs)) $(key + '-view').hidden = key !== next;
  document.querySelectorAll('.main-nav [data-nav]').forEach((el) => {
    if (el.dataset.nav === next) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.title = 'Фудрадар · ' + tabs[next];
  if (next === 'radar') {
    map?.resize();
    renderRadar();
    renderQuests();
  } else if (next === 'collection') renderCollection();
  else {
    ensureWild();
    duelCleanup = mountDuels($('arena-view'), {
      read: arenaData,
      initialMode: options.initialMode || 'lobby',
      onBack: () => switchTab('radar'),
      onStateChange: (active) => {
        onlineActive = active;
      },
      onTeamChange: (ids) => store.update((p) => setTeam(p, ids)),
      award: async (result) => {
        const saved =
          result.mode === 'wild'
            ? await store.update((p) =>
                resolveEncounter(p, result.encounterId, result.won, menu, {
                  teamIds: result.teamIds,
                  draw: result.draw,
                  now: Date.now(),
                }),
              )
            : await store.update((p) => recordBattle(p, result));
        if (saved.ok && saved.leveledUp) showToast('Боец получил новый уровень!');
        return saved;
      },
    });
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
document
  .querySelectorAll('[data-nav]')
  .forEach((el) => el.addEventListener('click', () => switchTab(el.dataset.nav)));
$('dialog-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pickTheme) {
    appearance = normalizeTheme(b.dataset.pickTheme);
    savePref('theme', appearance);
    syncAppearance();
    closeDialog();
    $('theme-btn').focus({ preventScroll: true });
    showToast('Оформление · ' + themes[appearance].name);
  } else if (b.hasAttribute('data-stay')) closeDialog();
  else if (b.dataset.leave) switchTab(b.dataset.leave, { confirmed: true });
  else if (b.hasAttribute('data-close')) closeDialog();
  else if (b.hasAttribute('data-wild')) switchTab('arena', { initialMode: currentWild() ? 'wild' : 'lobby' });
  else if (b.dataset.open) switchTab(b.dataset.open);
  else if (b.dataset.visitBrand) {
    brand = b.dataset.visitBrand;
    savePref('brand', brand);
    selected = null;
    renderBrands();
    switchTab('radar');
  } else if (b.dataset.team) {
    const id = b.dataset.team;
    if (await toggleTeam(id)) showCard(id);
    else {
      const p = document.createElement('p');
      p.setAttribute('role', 'status');
      p.textContent = 'В команде должно быть от одного до трёх бойцов.';
      $('dialog-body').append(p);
    }
  }
});
store.subscribe((next) => {
  profile = next;
  renderHeader();
  renderQuests();
  if (tab === 'radar') {
    renderRoute();
    renderGeo();
  }
  if (tab === 'collection') renderCollection();
  if (tab === 'arena') duelCleanup?.refresh?.();
});
function welcome(card) {
  openDialog(
    'Твой первый боец',
    '<div class="micro section-kicker">' +
      icon('star', 14) +
      ' Добро пожаловать</div><div class="reward-stage">' +
      cardImage(card, 'reward-img') +
      rarityTag(card) +
      '</div><h2>Твой первый боец — ' +
      esc(card.name) +
      '</h2><p>Он уже в команде. Подходи к заведениям на карте: там выпадают новые бойцы и появляются дикие соперники. Победишь дикого — заберёшь себе.</p>' +
      skillBox(card) +
      '<button class="primary" data-close>Поехали ' +
      icon('arrow', 16) +
      '</button>',
  );
}
async function loadCatalog(name) {
  const r = await fetch('data/' + name + '.json');
  if (!r.ok) throw Error(name + ': ' + r.status);
  const data = await r.json();
  if (!Array.isArray(data) || !data.length) throw Error('Пустой каталог ' + name);
  return data;
}
async function init() {
  [venues, menu] = await Promise.all([loadCatalog('venues'), loadCatalog('menu')]);
  venuesById = new Map(venues.map((x) => [x.id, x]));
  menuById = new Map(menu.map((x) => [x.id, x]));
  target = lookup(prefs.target) || null;
  selected = target;
  map = makeMap({ venues, onPick: (p) => pick(p) });
  renderHeader();
  renderBrands();
  renderRadar();
  renderQuests();
  const starter = await store.update((p) => grantStarter(p, menu));
  await ensureWild();
  if (/^#duel=/i.test(location.hash)) switchTab('arena', { initialMode: 'online' });
  else if (starter.ok) welcome(starter.card);
  askGps();
  window.addEventListener('hashchange', () => {
    if (/^#duel=/i.test(location.hash) && !onlineActive)
      switchTab('arena', { initialMode: 'online' });
  });
  function refreshTime() {
    if (document.hidden || tab !== 'radar') return;
    renderRoute();
    renderGeo();
    renderQuests();
    proximity();
    ensureWild();
  }
  window.setInterval(refreshTime, 15000);
  document.addEventListener('visibilitychange', refreshTime);
  window.addEventListener('pageshow', () => {
    profile = store.read();
    renderHeader();
    refreshTime();
  });
}
init().catch((error) => {
  console.error('Не удалось открыть игру', error);
  $('load-error').hidden = false;
  $('radar-view').hidden = true;
});
