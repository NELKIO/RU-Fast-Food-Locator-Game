import { makeSfx } from './sfx.js';
import { createSiteStats } from './site-stats.js';
import { brands, icon, brandMark, esc, rarityNames, formatDistance, formatWait, formatCountdown, countdown, transformBadge } from './ui.js';
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
  suggestTeam,
  todayRoute,
  wildEncounter,
  wildFighter,
  dropChance,
  claimDaily,
  trainerOffer,
  recordTrainer,
  TRAINERS,
  dailyStatus,
  featuredFighter,
  DAILY_REWARDS,
  grantStarter,
  ensureWildSeed,
  resolveEncounter,
  recordBattle,
  WILD_COOLDOWN_MS,
  GPS_RULES,
} from './game.js';
import { describeSkill, describeTrait, describeTransform } from './fighters.js';
import { mountDuels } from './duels.js';
import { reelMarkup, rewardMarkup } from './rewards.js';
import { createSync, formatSyncKey, newSyncKey, parseSyncKey } from './sync.js';

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
// Collection orders. Ties fall back to rarity, then level, then the menu order.
const RARITY_RANK = { legendary: 4, epic: 3, rare: 2, common: 1 };
const SORTS = {
  menu: { label: 'По сетям', key: () => 0 },
  rarity: { label: 'По редкости', key: (c) => RARITY_RANK[c.rarity] ?? 0 },
  level: { label: 'По уровню', key: (c, owned) => (owned ? c.level * 1e6 + (c.xp ?? 0) : -1) },
  power: { label: 'По силе', key: (c) => c.maxHp * c.attack },
  hp: { label: 'По здоровью', key: (c) => c.maxHp },
  attack: { label: 'По атаке', key: (c) => c.attack },
  speed: { label: 'По скорости', key: (c) => c.speed ?? 5 },
  name: { label: 'По названию', key: () => 0 },
};
function sortCards(cards, sort, isOwned) {
  const order = new Map(cards.map((c, i) => [c.id, i]));
  const key = SORTS[sort]?.key ?? SORTS.menu.key;
  return [...cards].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ru');
    return (
      key(b, isOwned(b)) - key(a, isOwned(a)) ||
      (sort === 'menu' ? 0 : (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) || b.level - a.level) ||
      order.get(a.id) - order.get(b.id)
    );
  });
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
  collectionSort = Object.hasOwn(SORTS, prefs.sort) ? prefs.sort : 'menu',
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
// Every tap may wake the audio again: phones suspend it in the background.
document.addEventListener('pointerdown', resumeSound);
const sfx = makeSfx({ enabled: () => audioOn, context: () => soundContext });
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
    <span class="route-feature-copy"><small>Возможная находка · ${esc(chanceText(item.id))}</small><strong class="route-feature-name">${esc(item.name)}</strong></span>
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
  const move = (label, glyph, s) =>
    '<small>' +
    icon(glyph, 13) +
    ' ' +
    label +
    ' · ' +
    s.cost +
    ' энерг.</small><strong>«' +
    esc(s.name) +
    '»</strong><p>' +
    esc(describeSkill(s, card.attack)) +
    '</p>';
  return (
    '<div class="skill-box">' +
    move('Фирменный приём', 'spark', skill) +
    (card.ultimate ? move('Суперприём', 'trophy', card.ultimate) : '') +
    (card.trait
      ? '<small>' +
        icon('star', 13) +
        ' Талант</small><strong>«' +
        esc(card.trait.name) +
        '»</strong><p>' +
        esc(describeTrait(card.trait)) +
        '</p>'
      : '') +
    '<small>Обычный удар «' +
    esc(card.basic || 'Удар') +
    '» — ' +
    esc(card.attack) +
    ' урона и +1 энергия</small></div>'
  );
}
// The transformation: once per battle, for energy, the fighter takes its other form.
function transformBox(card) {
  if (!card.transform) return '';
  return (
    '<section class="tf-box" aria-label="Трансформация"><small>' +
    icon('transform', 14) +
    ' Трансформация · ' +
    esc(card.transform.cost) +
    ' энерг. · раз за бой</small><strong>«' +
    esc(card.transform.name) +
    '»</strong><p>' +
    esc(describeTransform(card.transform, card.attack)) +
    '</p></section>'
  );
}
function cardStats(card) {
  return (
    '<div class="stat-grid"><div><strong>' +
    esc(card.attack) +
    '</strong><small>Атака</small></div><div><strong>' +
    esc(card.maxHp || card.hp) +
    '</strong><small>Здоровье</small></div><div><strong>' +
    esc(card.speed ?? 5) +
    '</strong><small>Скорость</small></div><div><strong>' +
    esc(card.level) +
    '</strong><small>Уровень</small></div></div>'
  );
}
// The roulette: the reel spins and stops on the card already won. False if the player closed it.
async function playReel(pool, card, label) {
  const run = openDialog('Рулетка находок', reelMarkup(pool, card, label));
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
  return dialogRun === run && $('dialog').open;
}
// A linked device asks the others first: otherwise a reward taken a minute ago on the phone would
// still look free on the laptop. Resolves to true when the shared progress was checked.
async function syncedBeforeClaim() {
  if (!profile.sync?.key) return true;
  const status = await Promise.race([sync.syncNow(), new Promise((resolve) => setTimeout(() => resolve(null), 9000))]);
  return status?.state === 'ok';
}
async function spinReward() {
  if (!target || claimPending) return;
  const point = target;
  claimPending = true;
  let result;
  try {
    // At the restaurant a missing connection must not cost the find, so the check is best effort.
    if (profile.sync?.key) {
      showToast('Сверяем прогресс с другими устройствами…');
      await syncedBeforeClaim();
    }
    result = await store.update((p) => claimVisit(p, point, fix, menu));
  } finally {
    claimPending = false;
  }
  if (result.ok && profile.sync?.key) sync.syncNow();
  if (!result.ok) {
    renderRadar();
    showToast(
      result.reason === 'cooldown'
        ? 'Эту точку уже открыли недавно — возможно, на другом устройстве.'
        : 'Не удалось подтвердить посещение. Проверь расстояние и таймер точки.',
    );
    return;
  }
  const card = result.card;
  const pool = menu.filter((c) => c.brand === point.brand);
  if (!(await playReel(pool, card, brands[point.brand].name))) return;
  openDialog(
    'Награда · ' + card.name,
    rewardMarkup(result, result.encounter ? menuById.get(result.encounter.enemyId)?.name : ''),
  );
}

function strongCards() {
  const got = new Map(collectionCards(profile, menu).map((c) => [c.id, c]));
  return menu.map((item) => got.get(item.id) ?? cardFor(item));
}
// The login week: a card on the radar and a calendar dialog.
function dailyLabel(reward) {
  if (reward.kind === 'spins') return reward.count === 1 ? '1 крутка' : reward.count + ' крутки';
  if (reward.kind === 'featured') return 'Боец недели';
  if (reward.kind === 'player-xp') return '+' + reward.amount + ' опыта';
  if (reward.kind === 'team-xp') return '+' + reward.amount + ' опыта колоде';
  return 'Легенда';
}
function renderDaily() {
  const status = dailyStatus(profile);
  const next = DAILY_REWARDS[status.today % 7];
  // The card sits at the top of the radar only while a reward is waiting.
  $('daily-card').hidden = !status.claimable;
  html(
    $('daily-card'),
    '<button type="button" class="daily-teaser' +
      (status.claimable ? ' is-ready' : '') +
      '" data-daily-open><span class="quest-icon">' +
      icon('star', 24) +
      '</span><span><h2>Награда за вход</h2><p>' +
      (status.claimable
        ? 'День ' + status.today + ' из 7 · ' + esc(dailyLabel(DAILY_REWARDS[status.today - 1]))
        : 'Получено · завтра: ' + esc(dailyLabel(next))) +
      '</p></span><span class="quest-tail round-btn">' +
      icon(status.claimable ? 'plus' : 'next', 18) +
      '</span></button>',
  );
}
function dailyDialog(result = null, note = '') {
  const status = dailyStatus(profile);
  const featured = featuredFighter(menu);
  const tiles = DAILY_REWARDS.map((reward) => {
    const done = reward.day <= status.claimed;
    const today = status.claimable && reward.day === status.today;
    const art =
      reward.kind === 'featured' && featured
        ? cardImage(featured)
        : icon(reward.kind === 'legendary' ? 'trophy' : reward.kind === 'spins' ? 'spark' : 'star', 22);
    return (
      '<li class="daily-day' +
      (done ? ' is-done' : '') +
      (today ? ' is-today' : '') +
      (reward.kind === 'legendary' ? ' is-legend' : '') +
      '"><small>День ' +
      reward.day +
      '</small><span class="daily-art">' +
      art +
      (done ? '<i class="daily-check">' + icon('check', 14) + '</i>' : '') +
      '</span><b>' +
      esc(reward.kind === 'featured' && featured ? featured.name : dailyLabel(reward)) +
      '</b>' +
      '</li>'
    );
  }).join('');
  const got = result
    ? '<div class="daily-got"><h3>Получено</h3>' +
      result.got
        .map((g) =>
          g.kind === 'card'
            ? '<div class="daily-card">' + cardImage(g.card) + '<span>' + rarityTag(g.card) + '<strong>' + esc(g.card.name) + '</strong>' +
              (g.isNew ? '<small class="daily-new">Новый боец!</small>' : '<small>Копия · опыт бойцу</small>') + '</span></div>'
            : '<p class="daily-xp">' + icon('star', 16) + (g.kind === 'player-xp' ? '+' + g.amount + ' опыта игроку' : '+' + g.amount + ' опыта каждому бойцу колоды') + '</p>',
        )
        .join('') +
      '</div>'
    : '';
  openDialog(
    'Награда за вход',
    '<div class="micro section-kicker">' + icon('star', 14) + ' Каждый день</div><h2>Награда за вход</h2><p>Заходи семь дней подряд: на седьмой день — легендарный боец. Пропуск дня начинает неделю заново.</p><ol class="daily-week">' +
      tiles +
      '</ol>' +
      got +
      (note ? '<p class="daily-note" role="status">' + esc(note) + '</p>' : '') +
      (status.claimable
        ? '<div class="dialog-actions"><button class="primary" data-daily-claim' + (note.endsWith('…') ? ' disabled' : '') + '>' + icon('plus', 16) + 'Забрать награду дня ' + status.today + '</button></div>'
        : '<p class="daily-next">Следующая награда завтра.</p>'),
  );
}
// Cards from the login reward come out of the roulette one by one: a chain's reel for a spin,
// the rares for the fighter of the week, the legends on day 7.
let dailyRun = null;
async function claimDailyReward() {
  if (profile.sync?.key) {
    dailyDialog(null, 'Сверяем прогресс с другими устройствами…');
    if (!(await syncedBeforeClaim())) {
      return dailyDialog(null, 'Нет связи с другими устройствами. Награду можно будет забрать, когда синхронизация пройдёт: так её не заберут дважды.');
    }
    if (!dailyStatus(store.read()).claimable) return dailyDialog(null, 'Награду дня уже забрали на другом устройстве.');
  }
  const result = await store.update((p) => claimDaily(p, menu));
  if (!result.ok) return dailyDialog(null, 'Награду дня уже забрали.');
  if (profile.sync?.key) sync.syncNow();
  renderDaily();
  if (tab === 'collection') renderCollection();
  dailyRun = { result, cards: result.got.filter((g) => g.kind === 'card'), index: 0 };
  if (!dailyRun.cards.length) return dailyDialog(result);
  showDailySpin();
}
async function showDailySpin() {
  const run = dailyRun;
  const g = run.cards[run.index];
  const kind = run.result.reward.kind;
  const pool =
    kind === 'legendary'
      ? menu.filter((c) => cardFor(c).rarity === 'legendary')
      : kind === 'featured'
        ? menu.filter((c) => cardFor(c).rarity === 'rare')
        : menu.filter((c) => c.brand === g.card.brand);
  const label = kind === 'legendary' ? 'Легенда седьмого дня' : kind === 'featured' ? 'Боец недели' : brands[g.card.brand].name;
  if (!(await playReel(pool, g.card, label)) || dailyRun !== run) return;
  const last = run.index === run.cards.length - 1;
  openDialog(
    'Награда · ' + g.card.name,
    rewardMarkup(
      { card: g.card, isNew: g.isNew, leveledUp: false },
      '',
      {
        note: 'Награда за вход · день ' + run.result.day + (run.cards.length > 1 ? ' · крутка ' + (run.index + 1) + ' из ' + run.cards.length : ''),
        next: last ? 'Готово' : 'Следующая крутка',
      },
    ),
  );
}
$('daily-card').addEventListener('click', (e) => {
  if (e.target.closest('[data-daily-open]')) dailyDialog();
});

function renderQuests() {
  renderDaily();
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
          (wait ? 'Следующий появится через ' + countdown(wait) + ' или сразу у заведения' : 'Появится после отметки у заведения') +
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
// A linked device first hears from the others: otherwise it would spawn its own wild fighter
// before learning that another device has one waiting or has just fought.
let syncSettled = false;
async function ensureWild() {
  if (profile.sync?.key && !syncSettled) return;
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
  const isOwned = (c) => Object.hasOwn(profile.collection, c.id);
  const visible = sortCards(
    cards.filter(
      (c) =>
        collectionFilter === 'all' ||
        (collectionFilter === 'mine' ? isOwned(c) : profile.team.includes(c.id)),
    ),
    collectionSort,
    isOwned,
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
        (c.transform ? transformBadge(11) : '') +
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
      ' из 3 · выходят по порядку</small>' +
      (count > 1 ? '<button type="button" class="soft-btn deck-auto" data-deck-auto>' + icon('spark', 15) + 'Подобрать</button>' : '') +
      '</div><div class="deck-slots">' +
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
        (c.transform ? transformBadge(14) : '') +
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
    '<label class="catalog-sort">' +
    icon('sort', 16) +
    '<select data-sort aria-label="Сортировка коллекции">' +
    Object.entries(SORTS)
      .map(
        ([k, v]) =>
          '<option value="' + k + '"' + (k === collectionSort ? ' selected' : '') + '>' + v.label + '</option>',
      )
      .join('') +
    '</select></label></div>' +
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
// From the arena the card is only for reading: the team is picked there with the round slot.
const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
function chanceText(id) {
  return percent.format(dropChance(menu, id) * 100) + '%';
}
function showCard(id, { readOnly = false } = {}) {
  const item = menuById.get(id);
  if (!item) return;
  const card = strongCards().find((c) => c.id === id),
    entry = profile.collection[id],
    inTeam = profile.team.includes(id);
  const action = readOnly
    ? ''
    : entry
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
      (card.transform ? transformBadge(16) : '') +
      '</div><h2>' +
      esc(card.name) +
      '</h2>' +
      cardStats(card) +
      skillBox(card) +
      transformBox(card) +
      (entry
        ? '<p class="card-xp">Опыт бойца · ' +
          esc(card.xp) +
          (card.xpToNext
            ? ' · до нового уровня ' + esc(card.xpToNext)
            : ' · максимальный уровень') +
          '</p>'
        : '') +
      action,
  );
}
// The three strongest owned fighters (measured strength and level), the strongest leading.
async function autoTeam() {
  const cards = strongCards().filter((c) => Object.hasOwn(profile.collection, c.id));
  const best = suggestTeam(cards);
  if (!best.length) return;
  if (best.join() === profile.team.join()) return showToast('Это уже самая сильная команда.');
  const result = await store.update((p) => setTeam(p, best));
  if (result.ok) {
    const names = best.map((id) => cards.find((c) => c.id === id)?.name).filter(Boolean);
    showToast('Команда: ' + names.join(', '));
  }
}
$('collection-view').addEventListener('click', (e) => {
  const f = e.target.closest('[data-catalog]'),
    card = e.target.closest('[data-card]'),
    open = e.target.closest('[data-open]'),
    deckEdit = e.target.closest('[data-deck-add], [data-deck-remove]'),
    auto = e.target.closest('[data-deck-auto]');
  if (auto) autoTeam();
  else if (deckEdit) toggleTeam(deckEdit.dataset.deckAdd || deckEdit.dataset.deckRemove);
  else if (f) {
    collectionFilter = f.dataset.catalog;
    renderCollection();
  } else if (card) showCard(card.dataset.card);
  else if (open) switchTab(open.dataset.open);
});
$('collection-view').addEventListener('change', (e) => {
  if (!e.target.matches('[data-sort]') || !Object.hasOwn(SORTS, e.target.value)) return;
  collectionSort = e.target.value;
  savePref('sort', collectionSort);
  renderCollection();
  $('collection-view').querySelector('[data-sort]')?.focus({ preventScroll: true });
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
      '<section class="sync-entry"><h3>Награда за вход</h3><p>' +
      esc((() => { const st = dailyStatus(profile); return st.claimable ? 'Ждёт награда дня ' + st.today + ' из 7.' : 'Неделя: день ' + st.claimed + ' из 7, следующая награда завтра.'; })()) +
      '</p><button class="outline-btn" data-daily-open>' +
      icon('star', 16) +
      'Календарь наград</button></section>' +
      '<section class="sync-entry"><h3>Синхронизация устройств</h3><p>' +
      esc(profile.sync?.key ? syncStatusText() : 'Общий прогресс на телефоне и компьютере.') +
      '</p><button class="outline-btn" data-sync-open>' +
      icon('route', 16) +
      (profile.sync?.key ? 'Настроить' : 'Связать устройства') +
      '</button></section>' +
      '<button class="outline-btn" data-open="collection">Открыть коллекцию</button>' +
      '<section class="site-stats" id="site-stats" aria-live="polite">' + siteStatsHtml(siteStats.cached(), true) + '</section>',
  );
  // The whole game: the last known total at once, the fresh one from the relays a moment later.
  const run = dialogRun;
  siteStats.total().then((total) => {
    const box = document.getElementById('site-stats');
    if (box && run === dialogRun) box.innerHTML = siteStatsHtml(total, false);
  }).catch(() => {});
}
listen('profile-btn', profileDialog);

// Every browser reports only what it played itself (see site-stats.js); only the live site reports.
const siteStats = createSiteStats({ live: location.hostname === 'nelkio.github.io' });
function siteStatsHtml(total, loading) {
  const n = (v) => Number(v ?? 0).toLocaleString('ru-RU');
  const head = '<h3>Вся игра</h3>';
  if (!total) return head + '<p class="site-stats-note">' + (loading ? 'Собираем статистику всех игроков…' : 'Статистика всех игроков пока недоступна.') + '</p>';
  const tiles = [
    ['Игроков', total.players], ['Боёв', total.games], ['Побед', total.wins], ['Поражений', total.losses],
    ['Бойцов поймано', total.cards], ['Посещений точек', total.visits],
  ];
  const favorites = (total.favorites ?? [])
    .map((f) => { const item = menuById.get(f.id); return item ? cardFor(item) : null; })
    .filter(Boolean);
  return head + '<div class="stat-grid site-stat-grid">' + tiles.map(([label, value]) => '<div><strong>' + n(value) + '</strong><small>' + label + '</small></div>').join('') + '</div>' +
    (favorites.length
      ? '<h4>Любимые бойцы</h4><ol class="site-favorites">' + favorites.map((c, i) => '<li><span class="site-rank">' + (i + 1) + '</span>' + cardImage(c) + '<span>' + esc(c.name) + '</span></li>').join('') + '</ol>'
      : '') +
    '<p class="site-stats-note">Сумма по всем игрокам. Каждое устройство сообщает только свои бои, поэтому связанные устройства не считаются дважды.' + (loading ? ' Обновляем…' : '') + '</p>';
}

// Device sync lives in the profile, out of the way of the game.
let wildFightActive = false;
const sync = createSync({
  store,
  paused: () => wildFightActive,
  onStatus: (status) => {
    refreshSyncDialog();
    if (!syncSettled && status.state !== 'syncing') {
      syncSettled = true;
      ensureWild();
    }
  },
});
let syncDialogRun = -1,
  syncKeyShown = false;
function syncLink(key) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = 'sync=' + key;
  return url.href;
}
function syncStatusText() {
  const status = sync.status;
  if (status.state === 'syncing') return 'Синхронизация…';
  if (status.state === 'offline') return 'Нет связи с узлами. Прогресс сохранён здесь и уйдёт при следующей связи.';
  if (status.state === 'outdated') return 'На другом устройстве новая версия игры. Обнови страницу.';
  if (status.state === 'error') return 'Не удалось синхронизировать. Попробуем ещё раз позже.';
  if (status.state === 'ok' && status.at) {
    const minutes = Math.floor((Date.now() - status.at) / 60_000);
    return 'Синхронизировано · ' + (minutes < 1 ? 'только что' : minutes + ' мин назад');
  }
  return 'Устройство связано. Синхронизация скоро начнётся.';
}
function syncDialog(view = 'main') {
  const key = profile.sync?.key;
  let body;
  if (view === 'unlink') {
    body =
      '<h2>Отвязать это устройство?</h2><p>Весь прогресс останется здесь, но перестанет обновляться вместе с другими устройствами. Привязать обратно можно тем же ключом, ничего не задвоится.</p>' +
      '<div class="dialog-actions"><button class="primary" data-sync-unlink-yes>Отвязать</button><button class="outline-btn" data-sync-open>Отмена</button></div>';
  } else if (view.startsWith('confirm:')) {
    const pending = view.slice(8);
    body =
      '<h2>Связать это устройство?</h2><p>Прогресс этого устройства и прогресс по ключу сложатся: бойцы, копии, опыт, победы и посещения. Ничего не пропадёт, а дальше всё будет обновляться само.</p>' +
      '<div class="dialog-actions"><button class="primary" data-sync-confirm="' +
      esc(pending) +
      '">Связать</button><button class="outline-btn" data-close>Отмена</button></div>';
  } else if (!key) {
    body =
      '<h2>Связать устройства</h2><p>Играй на телефоне и компьютере с общим прогрессом. Прогресс обоих устройств сложится, ничего не пропадёт.</p>' +
      '<ol class="about-list"><li>Создай ключ на одном устройстве.</li><li>Открой ссылку с ключом на другом или введи ключ ниже.</li></ol>' +
      '<div class="dialog-actions"><button class="primary" data-sync-create>' +
      icon('plus', 16) +
      'Создать ключ</button></div>' +
      '<form class="sync-join" data-sync-form><label for="sync-key">Уже есть ключ</label><div><input id="sync-key" name="key" placeholder="XXXX-XXXX-XXXX-…" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="400" required><button class="outline-btn" type="submit">Связать</button></div><p class="sync-error" role="status"></p></form>' +
      '<p class="sync-note">Без регистрации. Прогресс хранится зашифрованным на публичных узлах Nostr, прочитать его может только тот, у кого есть ключ.</p>';
  } else {
    const shown = syncKeyShown ? formatSyncKey(key) : formatSyncKey(key).replace(/[A-Z2-9]/g, '•');
    body =
      '<h2>Устройства связаны</h2><p class="sync-status" data-sync-status role="status">' +
      esc(syncStatusText()) +
      '</p><p>Ключ для другого устройства</p><output class="sync-key" data-sync-key>' +
      esc(shown) +
      '</output><div class="dialog-actions"><button class="primary" data-sync-copy>' +
      icon('route', 16) +
      'Скопировать ссылку</button>' +
      (navigator.share && matchMedia('(pointer: coarse)').matches ? '<button class="outline-btn" data-sync-share>Отправить</button>' : '') +
      '<button class="outline-btn" data-sync-reveal>' +
      (syncKeyShown ? 'Скрыть ключ' : 'Показать ключ') +
      '</button></div><div class="dialog-actions"><button class="outline-btn" data-sync-now>Синхронизировать сейчас</button><button class="outline-btn" data-sync-unlink>Отвязать устройство</button></div>' +
      '<p class="sync-note">Ключ — это доступ к твоему прогрессу. Отправляй его только себе.</p>';
  }
  syncDialogRun = openDialog('Синхронизация устройств', '<div class="micro section-kicker">' + icon('star', 14) + ' Профиль</div>' + body);
}
function refreshSyncDialog() {
  if (syncDialogRun !== dialogRun || !$('dialog').open) return;
  const line = $('dialog-body').querySelector('[data-sync-status]');
  if (line) line.textContent = syncStatusText();
}
async function linkDevice(key) {
  syncDialog('main');
  const line = document.createElement('p');
  line.className = 'sync-status';
  line.textContent = 'Связываем и объединяем прогресс…';
  $('dialog-body').querySelector('h2')?.after(line);
  const result = await sync.link(key);
  // A new device that had nothing gets its starter only if the shared progress is empty too.
  if (!Object.keys(store.read().collection).length) {
    const starter = await store.update((p) => grantStarter(p, menu));
    if (starter.ok) showToast('Твой первый боец — ' + starter.card.name);
  }
  syncKeyShown = false;
  syncDialog('main');
  if (result.ok) showToast(result.status?.state === 'ok' ? 'Устройства связаны, прогресс объединён.' : 'Устройство связано. Прогресс объединится, когда появится связь.');
}
$('dialog-body').addEventListener('submit', (e) => {
  if (!e.target.matches('[data-sync-form]')) return;
  e.preventDefault();
  const key = parseSyncKey(e.target.elements.key.value);
  if (key) syncDialog('confirm:' + key);
  else {
    e.target.querySelector('.sync-error').textContent = 'Нужен ключ из 32 символов или ссылка с ним.';
    e.target.elements.key.focus();
  }
});
$('dialog-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-daily-open')) {
    dailyDialog();
    return;
  }
  if (b.hasAttribute('data-daily-next')) {
    if (!dailyRun) return closeDialog();
    if (dailyRun.index < dailyRun.cards.length - 1) {
      dailyRun.index++;
      showDailySpin();
    } else {
      const { result } = dailyRun;
      dailyRun = null;
      dailyDialog(result);
    }
    return;
  }
  if (b.hasAttribute('data-daily-claim')) {
    b.disabled = true;
    await claimDailyReward();
    return;
  }
  if (b.hasAttribute('data-sync-open')) {
    syncKeyShown = false;
    syncDialog('main');
  } else if (b.hasAttribute('data-sync-create')) {
    await linkDevice(newSyncKey());
    syncKeyShown = true;
    syncDialog('main');
  } else if (b.dataset.syncConfirm) linkDevice(b.dataset.syncConfirm);
  else if (b.hasAttribute('data-sync-reveal')) {
    syncKeyShown = !syncKeyShown;
    syncDialog('main');
  } else if (b.hasAttribute('data-sync-copy')) {
    const link = syncLink(profile.sync?.key ?? store.read().sync?.key);
    try {
      await navigator.clipboard.writeText(link);
      showToast('Ссылка скопирована. Открой её на другом устройстве.');
    } catch {
      syncKeyShown = true;
      syncDialog('main');
      showToast('Скопируй ключ вручную.');
    }
  } else if (b.hasAttribute('data-sync-share')) {
    const link = syncLink(profile.sync?.key ?? store.read().sync?.key);
    navigator.share({ title: 'Фудрадар — мой прогресс', text: 'Открой на другом устройстве, чтобы связать прогресс.', url: link }).catch(() => {});
  } else if (b.hasAttribute('data-sync-now')) {
    sync.syncNow();
    refreshSyncDialog();
  } else if (b.hasAttribute('data-sync-unlink')) syncDialog('unlink');
  else if (b.hasAttribute('data-sync-unlink-yes')) {
    await sync.unlink();
    syncDialog('main');
    showToast('Устройство отвязано. Прогресс остался здесь.');
  }
});
listen('about', () => {
  openDialog(
    'Об игре',
    '<div class="micro section-kicker">' +
      icon('radar', 14) +
      ' Фудрадар</div><h2>Как играть</h2><ol class="about-list"><li>Выбери заведение на карте и дойди до него. Расстояние считается по прямой.</li><li>У цели открой рулетку и получи бойца из меню. Та же точка снова наградит через шесть часов.</li><li>После отметки рядом появляется дикий боец. Победи его на арене — и он твой. Ещё на арене можно позвать друга на дуэль по ссылке.</li></ol><p>Профиль хранится в этом браузере. GPS используется для расчётов на устройстве. При просмотре онлайн-карты её провайдер получает запросы фрагментов видимой области.</p><p>Адреса четырёх сетей — All The Places. Карта — OpenStreetMap. Фото блюд — из меню сетей.</p><p><a href="https://www.alltheplaces.xyz/" target="_blank" rel="noopener">All The Places</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>',
  );
});

// A small seeded random generator, so a seed string always gives the same choices.
function seededRandom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let x = h >>> 0 || 1;
  return () => ((x = (Math.imul(x, 48271) % 2147483647 + 2147483647) % 2147483647) || 1) / 2147483647;
}
const trainerSeed = Math.random().toString(36).slice(2);
let trainerId = TRAINERS[Math.floor(Math.random() * TRAINERS.length)].id;
let trainerLevel = ['easy', 'normal', 'hard'].includes(prefs.trainerLevel) ? prefs.trainerLevel : 'normal';
function arenaData() {
  const e = currentWild();
  return {
    cards: strongCards(),
    owned: owned(),
    loading: !menu.length,
    team: [...profile.team],
    wild: e && { id: e.id, encounter: { ...e }, opponent: (team) => wildFighter(e, menu, team) },
    wildWaitMs: wildWait(),
    // The trainer of this visit, picked once when the page opens; its team is stable for the
    // visit too (the same team and level give the same line-up).
    trainer: (cards, roll = 0) => {
      const seed = trainerSeed + '|' + trainerId + '|' + trainerLevel + '|' + roll + '|' + cards.map((c) => c.rarity + ':' + c.level).sort().join(',');
      return trainerOffer(menu, cards, { trainer: trainerId, difficulty: trainerLevel, rng: seededRandom(seed) });
    },
    trainerId: () => trainerId,
    nextTrainer: () => {
      const others = TRAINERS.filter((t) => t.id !== trainerId);
      trainerId = others[Math.floor(Math.random() * others.length)].id;
    },
    trainerLevel: () => trainerLevel,
    setTrainerLevel: (level) => {
      if (!['easy', 'normal', 'hard'].includes(level)) return;
      trainerLevel = level;
      savePref('trainerLevel', level);
    },
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
    // Fresh news from other devices in the background: a wild fighter already caught there leaves the
    // lobby. Nothing waits for it: a fight never depends on the connection.
    if (profile.sync?.key) sync.syncNow();
    duelCleanup = mountDuels($('arena-view'), {
      read: arenaData,
      initialMode: options.initialMode || 'lobby',
      onBack: () => switchTab('radar'),
      sound: sfx.play,
      onFightChange: (active) => {
        const ended = wildFightActive && !active;
        wildFightActive = active;
        // The result of a wild fight is shared at once, so another device cannot fight the same one.
        if (ended && profile.sync?.key) sync.syncNow();
      },
      onStateChange: (active) => {
        onlineActive = active;
      },
      onTeamChange: (ids) => store.update((p) => setTeam(p, ids)),
      onShowCard: (id) => showCard(id, { readOnly: true }),
      award: async (result) => {
        const saved =
          result.mode === 'wild'
            ? await store.update((p) =>
                resolveEncounter(p, result.encounterId, result.won, menu, {
                  teamIds: result.teamIds,
                  draw: result.draw,
                  now: Date.now(),
                  fought: result.fought,
                  matchId: result.matchId,
                }),
              )
            : result.mode === 'trainer'
              ? await store.update((p) => recordTrainer(p, result))
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
  siteStats.schedule(next);
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
  // The arena may have been opened while the menu was loading: show the fighters now.
  if (tab === 'arena') duelCleanup?.refresh?.();
  target = lookup(prefs.target) || null;
  selected = target;
  map = makeMap({ venues, onPick: (p) => pick(p) });
  renderHeader();
  renderBrands();
  renderRadar();
  renderQuests();
  // A link with a sync key: the device joins the shared progress instead of starting over.
  const linkHash = /(?:^|#|&)sync=/i.test(location.hash);
  const invitedKey = linkHash ? parseSyncKey(location.hash) : null;
  if (linkHash) history.replaceState(history.state, '', location.pathname + location.search);
  const starter = invitedKey && !Object.keys(store.read().collection).length
    ? { ok: false }
    : await store.update((p) => grantStarter(p, menu));
  // Older profiles get their wild stream now, so linked devices agree on it at the first sync.
  await store.update((p) => (p.wildSeed ? { ok: false, profile: p } : { ok: true, profile: ensureWildSeed(p) }));
  await ensureWild();
  siteStats.schedule(store.read(), 5000);
  if (/^#duel=/i.test(location.hash)) switchTab('arena', { initialMode: 'online' });
  else if (starter.ok) welcome(starter.card);
  sync.start();
  if (invitedKey) {
    if (store.read().sync?.key === invitedKey) showToast('Это устройство уже связано этим ключом.');
    else syncDialog('confirm:' + invitedKey);
  }
  askGps();
  window.addEventListener('hashchange', () => {
    if (/^#duel=/i.test(location.hash) && !onlineActive)
      switchTab('arena', { initialMode: 'online' });
    const key = /(?:^|#|&)sync=/i.test(location.hash) ? parseSyncKey(location.hash) : null;
    if (key) {
      history.replaceState(history.state, '', location.pathname + location.search);
      if (store.read().sync?.key !== key) syncDialog('confirm:' + key);
    }
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
  // Countdowns tick every second; when one runs out the wild fighter arrives without a reload.
  window.setInterval(() => {
    if (document.hidden) return;
    let due = false;
    for (const el of document.querySelectorAll('[data-countdown]')) {
      const left = +el.dataset.countdown - Date.now();
      el.textContent = formatCountdown(left);
      if (left <= 0) due = true;
    }
    if (due) ensureWild();
    refreshSyncDialog();
  }, 1000);
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
