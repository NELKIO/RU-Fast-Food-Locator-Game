import { FIGHTERS, RARITIES, RENAMED, ROLES } from './fighters.js';

export const VISIT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const WILD_COOLDOWN_MS = 15 * 60 * 1000;
export const MAX_TEAM_SIZE = 3;
export const GPS_RULES = Object.freeze({
  baseRadius: 65,
  maxRadiusBonus: 50,
  maxAccuracy: 120,
  maxAgeMs: 120_000,
  futureToleranceMs: 10_000,
});

const BRANDS = new Set(['bk', 'vkusno', 'rostics', 'dodo']);
// Each chain has two legendaries: 1.5% each per visit.
const LOOT_WEIGHTS = [58, 27, 12, 3];
const XP_THRESHOLDS = [0, 10, 25, 45, 70, 100, 135, 175, 220, 270];
export const CARD_XP_CAP = XP_THRESHOLDS.at(-1);
// Wild fighters that already left (won, lost or replaced). Synced devices use this list to drop
// a stale wild fighter that another device has already fought. Only the newest ones are kept.
export const RETIRED_LIMIT = 60;
const DUPLICATE_XP = 10;
const ROUTE_XP = 25;
const WILD_WIN = {player: 15, party: 10};
const WILD_LOSS_PARTY_XP = 3;

function validId(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return Object.hasOwn(Object.prototype, value) || value === 'prototype' ? null : value;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : 0;
}

function timestamp(value) {
  return Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? Math.trunc(value) : null;
}

function current(id) {
  return id && Object.hasOwn(RENAMED, id) ? RENAMED[id] : id;
}

function uniqueIds(value) {
  return Array.isArray(value) ? [...new Set(value.map(validId).map(current).filter(Boolean))] : [];
}

export function freshProfile() {
  return {
    version: 1,
    xp: 0,
    collection: {},
    team: [],
    visits: {},
    daily: {day: '', pointIds: [], claimed: false},
    encounter: null,
    encounterSequence: 0,
    lastScoutAt: null,
    battles: {wins: 0, losses: 0, draws: 0},
    battleIds: {},
    retired: {},
    recentWild: [],
    login: {day: '', streak: 0},
    wildSeed: '',
  };
}

// A profile's own random stream for wild fighters, like the fixed chest order of some games: the
// n-th wild fighter of a profile is decided by its seed and n, so linked devices meet the same one
// under the same id instead of two different fighters after the same pause.
const WILD_SEED = /^[a-z0-9]{6,16}$/;
function streamRandom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let x = (h >>> 0) % 2147483646 + 1;
  return () => (x = (x * 48271) % 2147483647) / 2147483647;
}

// Version 2: spins with the roulette. Claims made before it are dropped once, so everyone can
// claim the day again the new way.
const LOGIN_VERSION = 2;
function cleanLogin(value) {
  if (!record(value) || value.v !== LOGIN_VERSION || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) {
    return {day: '', streak: 0};
  }
  return {day: value.day, streak: Math.min(DAILY_DAYS, Math.max(1, count(value.streak))), v: LOGIN_VERSION};
}

// Encounter ids look like `<time in base36>-<sequence>`; newer ones sort later.
export function encounterTime(id) {
  const time = parseInt(String(id).split('-')[0], 36);
  return Number.isSafeInteger(time) ? time : 0;
}

export function keepNewestRetired(ids) {
  return Object.fromEntries([...new Set(ids)].filter(validId)
    .sort((a, b) => encounterTime(b) - encounterTime(a) || (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, RETIRED_LIMIT).map(id => [id, true]));
}

function retire(saved, encounter) {
  if (encounter?.id) saved.retired = keepNewestRetired([encounter.id, ...Object.keys(saved.retired)]);
}

// The device ledger of a synced profile. Each device owns one entry: what it added to every
// counter. Merging takes the larger known value per device and entry, so repeated or crossed
// syncs never count anything twice. The account key never leaves the device.
const SYNC_DEVICE = /^[a-z0-9]{8,32}$/;
const SYNC_KEY = /^[A-Z2-9]{32}$/;
// 256 devices: every cleared browser counts as a new one, so the ledger must outlast years of play.
export const SYNC_LIMITS = Object.freeze({devices: 256, cards: 400, visits: 6000});

export function cleanContribution(value) {
  const entry = {xp: 0, wins: 0, losses: 0, draws: 0, cards: {}, visits: {}};
  if (!record(value)) return entry;
  for (const key of ['xp', 'wins', 'losses', 'draws']) entry[key] = count(value[key]);
  if (record(value.cards)) {
    for (const [id, pair] of Object.entries(value.cards).slice(0, SYNC_LIMITS.cards)) {
      const key = current(validId(id));
      if (!key || !Array.isArray(pair)) continue;
      const kept = entry.cards[key] ?? [0, 0];
      entry.cards[key] = [count(kept[0] + count(pair[0])), Math.max(kept[1], count(pair[1]))];
    }
  }
  if (record(value.visits)) {
    for (const [id, visits] of Object.entries(value.visits).slice(0, SYNC_LIMITS.visits)) {
      if (validId(id) && count(visits)) entry.visits[id] = count(visits);
    }
  }
  return entry;
}

function cleanSync(value) {
  if (!record(value) || typeof value.device !== 'string' || !SYNC_DEVICE.test(value.device) ||
      Object.hasOwn(Object.prototype, value.device)) return null;
  const devices = {};
  if (record(value.devices)) {
    // Beyond the limit every device keeps the same entries (sorted ids), and always its own one.
    const ids = Object.keys(value.devices).filter(id => SYNC_DEVICE.test(id) && !Object.hasOwn(Object.prototype, id)).sort();
    const kept = ids.includes(value.device) ? [value.device, ...ids.filter(id => id !== value.device)] : ids;
    for (const id of kept.slice(0, SYNC_LIMITS.devices)) devices[id] = cleanContribution(value.devices[id]);
  }
  return {
    device: value.device,
    key: typeof value.key === 'string' && SYNC_KEY.test(value.key) ? value.key : null,
    devices,
    team: uniqueIds(value.team).slice(0, MAX_TEAM_SIZE),
    teamAt: timestamp(value.teamAt) ?? 0,
  };
}

function cleanRoute(value) {
  if (!record(value) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) {
    return {day: '', pointIds: [], claimed: false};
  }
  const pointIds = uniqueIds(value.pointIds).slice(0, 2);
  return {day: value.day, pointIds, claimed: value.claimed === true && pointIds.length === 2};
}

// Build new arrays and dictionaries so actions never mutate their input or trust stored JSON.
export function normalizeProfile(value) {
  const profile = freshProfile();
  if (!record(value)) return profile;
  profile.xp = count(value.xp);
  if (record(value.collection)) {
    for (const [id, item] of Object.entries(value.collection)) {
      if (!validId(id) || !record(item) || !count(item.copies)) continue;
      // A dish that left the roster merges into its replacement instead of vanishing.
      const key = current(id);
      const kept = profile.collection[key];
      profile.collection[key] = {
        copies: count((kept?.copies ?? 0) + count(item.copies)),
        xp: Math.max(kept?.xp ?? 0, count(item.xp, XP_THRESHOLDS.at(-1))),
      };
    }
  }
  profile.team = uniqueIds(value.team).filter(id => Object.hasOwn(profile.collection, id)).slice(0, MAX_TEAM_SIZE);
  if (profile.team.length === 0) profile.team = Object.keys(profile.collection).slice(0, 1);
  if (record(value.visits)) {
    for (const [id, visit] of Object.entries(value.visits)) {
      if (!validId(id) || !record(visit) || timestamp(visit.lastAt) === null) continue;
      profile.visits[id] = {lastAt: timestamp(visit.lastAt), count: Math.max(1, count(visit.count))};
    }
  }
  profile.daily = cleanRoute(value.daily);
  const encounter = value.encounter;
  // Older saves also had a 'training' kind; every wild fighter can now be won.
  if (record(encounter) && validId(encounter.id) && validId(encounter.enemyId) &&
      ['recruit', 'training'].includes(encounter.kind) && timestamp(encounter.startedAt) !== null) {
    profile.encounter = {
      id: validId(encounter.id), enemyId: current(validId(encounter.enemyId)), kind: 'recruit',
      startedAt: timestamp(encounter.startedAt),
      // Lured by a restaurant visit (not by the pause running out).
      ...(encounter.visit === true && {visit: true}),
    };
  }
  profile.encounterSequence = count(value.encounterSequence);
  profile.lastScoutAt = timestamp(value.lastScoutAt);
  profile.battles = {wins: count(value.battles?.wins), losses: count(value.battles?.losses), draws: count(value.battles?.draws)};
  if (record(value.battleIds)) {
    for (const [id, settled] of Object.entries(value.battleIds)) {
      if (validId(id) && settled === true) profile.battleIds[id] = true;
    }
  }
  if (record(value.retired)) {
    profile.retired = keepNewestRetired(Object.entries(value.retired).filter(([, gone]) => gone === true).map(([id]) => id));
  }
  if (profile.encounter && Object.hasOwn(profile.retired, profile.encounter.id)) profile.encounter = null;
  profile.recentWild = uniqueIds(value.recentWild).slice(0, RECENT_WILD);
  profile.login = cleanLogin(value.login);
  profile.wildSeed = typeof value.wildSeed === 'string' && WILD_SEED.test(value.wildSeed) ? value.wildSeed : '';
  const sync = cleanSync(value.sync);
  if (sync) profile.sync = sync;
  return profile;
}

function coordinate(value) {
  if (!value) return null;
  const pos = value.coords ?? value;
  const lat = pos.lat ?? pos.latitude;
  const lon = pos.lon ?? pos.lng ?? pos.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {lat, lon, accuracy: pos.accuracy};
}

export function distanceMeters(from, to) {
  const a = coordinate(from);
  const b = coordinate(to);
  if (!a || !b) return Infinity;
  const radians = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * radians / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lon - a.lon) * radians / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function nearestRestaurants(points, brand, fix, limit = 10) {
  if (!Array.isArray(points) || !coordinate(fix)) return [];
  const matches = [];
  for (const point of points) {
    if (!point || !validId(point.id) || !BRANDS.has(point.brand) || (brand && brand !== 'all' && brand !== point.brand)) continue;
    const distance = distanceMeters(fix, point);
    if (Number.isFinite(distance)) matches.push({...point, distance});
  }
  matches.sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));
  return matches.slice(0, limit === Infinity ? undefined : count(limit));
}

export function visitStatus(profile, point, fix, now = Date.now()) {
  const id = validId(point?.id);
  const position = coordinate(fix);
  const distance = distanceMeters(point, position);
  const accuracy = position?.accuracy;
  const reliable = Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= GPS_RULES.maxAccuracy;
  const radius = GPS_RULES.baseRadius + (reliable ? Math.min(accuracy, GPS_RULES.maxRadiusBonus) : 0);
  const last = id ? timestamp(profile?.visits?.[id]?.lastAt) : null;
  const remainingMs = last === null ? 0 : Math.max(0, last + VISIT_COOLDOWN_MS - now);
  const sample = timestamp(fix?.timestamp);
  let reason = 'ready';
  if (!id || !coordinate(point) || !BRANDS.has(point.brand)) reason = 'invalid-point';
  else if (remainingMs > 0) reason = 'cooldown';
  else if (!position) reason = 'no-location';
  else if (sample === null || timestamp(now) === null || now - sample > GPS_RULES.maxAgeMs || sample - now > GPS_RULES.futureToleranceMs) reason = 'stale';
  else if (!reliable) reason = 'inaccurate';
  else if (distance > radius) reason = 'too-far';
  return {ok: reason === 'ready', reason, distance, radius, remainingMs};
}

function localDay(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayRoute(profile, now = Date.now()) {
  const day = localDay(now);
  const saved = cleanRoute(profile?.daily);
  return saved.day === day ? saved : {day, pointIds: [], claimed: false};
}

export function levelForXp(xp) {
  const total = count(xp);
  return XP_THRESHOLDS.filter(threshold => total >= threshold).length;
}

export function xpToNextLevel(xp) {
  const total = count(xp);
  const threshold = XP_THRESHOLDS.find(value => value > total);
  return threshold === undefined ? 0 : threshold - total;
}

function hashId(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

// A dish without a hand-made entry still fights, with stats derived from its id.
function fallbackFighter(id) {
  const hash = hashId(id);
  const tier = hash % RARITIES.length;
  const role = ['striker', 'allround', 'guard'][(hash >>> 4) % 3];
  const attack = {striker: 5, allround: 4, guard: 3}[role] + tier;
  return {
    rarity: RARITIES[tier], role, hp: {striker: 15, allround: 18, guard: 21}[role] + 2 * tier, attack,
    basic: 'Удар', skill: {name: 'Фирменный удар', cost: 2, power: 3},
  };
}

export function fighterFor(id) {
  const key = validId(id);
  if (!key) return null;
  return Object.hasOwn(FIGHTERS, key) ? FIGHTERS[key] : fallbackFighter(key);
}

export function cardFor(item, level = 1) {
  const id = validId(item?.id);
  if (!id || !BRANDS.has(item.brand)) return null;
  const fighter = fighterFor(id);
  const rank = Math.max(1, count(level, XP_THRESHOLDS.length));
  const maxHp = fighter.hp + 2 * (rank - 1);
  return {
    ...item, id, rarity: fighter.rarity, level: rank, baseAttack: fighter.attack, baseHp: fighter.hp, maxHp, hp: maxHp,
    attack: fighter.attack + Math.floor((rank - 1) / 2),
    speed: fighter.speed, role: ROLES[fighter.role], basic: fighter.basic, skill: {...fighter.skill},
    ...(fighter.ultimate && {ultimate: {...fighter.ultimate}}), ...(fighter.trait && {trait: {...fighter.trait}}),
    ...(fighter.transform && {transform: structuredClone(fighter.transform)}),
  };
}

function menuItems(menu) {
  if (!Array.isArray(menu)) return [];
  return menu.filter(item => item && validId(item.id) && BRANDS.has(item.brand));
}

function ownedCard(item, entry) {
  return {...cardFor(item, levelForXp(entry.xp)), copies: entry.copies, xp: entry.xp, xpToNext: xpToNextLevel(entry.xp)};
}

export function collectionCards(profile, menu) {
  const {collection} = normalizeProfile(profile);
  return menuItems(menu).filter(item => Object.hasOwn(collection, item.id)).map(item => ownedCard(item, collection[item.id]));
}

export function teamCards(profile, menu) {
  const saved = normalizeProfile(profile);
  const catalogue = new Map(menuItems(menu).map(item => [String(item.id), item]));
  return saved.team.filter(id => catalogue.has(id)).map(id => ownedCard(catalogue.get(id), saved.collection[id]));
}

export function setTeam(profile, ids) {
  const saved = normalizeProfile(profile);
  if (!Array.isArray(ids) || ids.length > MAX_TEAM_SIZE || (!ids.length && Object.keys(saved.collection).length)) {
    return {ok: false, reason: 'team-size', profile: saved};
  }
  const team = ids.map(validId);
  if (team.some(id => !id || !Object.hasOwn(saved.collection, id))) return {ok: false, reason: 'not-owned', profile: saved};
  if (new Set(team).size !== team.length) return {ok: false, reason: 'duplicate', profile: saved};
  saved.team = team;
  return {ok: true, reason: 'saved', profile: saved};
}

function unit(rng) {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
}

function choose(items, rng) {
  return items.length < 2 ? items[0] : items[Math.floor(unit(rng) * items.length)];
}

function visitReward(menu, brand, rng) {
  const groups = RARITIES.map(() => []);
  for (const item of menu) {
    if (item.brand === brand) groups[RARITIES.indexOf(cardFor(item).rarity)].push(item);
  }
  const total = groups.reduce((sum, group, i) => sum + (group.length ? LOOT_WEIGHTS[i] : 0), 0);
  if (!total) return null;
  let draw = unit(rng) * total;
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].length) continue;
    if (draw < LOOT_WEIGHTS[i]) return choose(groups[i], rng);
    draw -= LOOT_WEIGHTS[i];
  }
  return null;
}

// The chance that one roulette spin at a venue of the dish's chain gives exactly this dish.
export function dropChance(menu, id) {
  const items = menuItems(menu);
  const item = items.find(entry => String(entry.id) === String(id));
  if (!item) return 0;
  const sizes = RARITIES.map(() => 0);
  for (const entry of items) if (entry.brand === item.brand) sizes[RARITIES.indexOf(cardFor(entry).rarity)] += 1;
  const total = sizes.reduce((sum, n, i) => sum + (n ? LOOT_WEIGHTS[i] : 0), 0);
  const tier = RARITIES.indexOf(cardFor(item).rarity);
  return total ? LOOT_WEIGHTS[tier] / total / sizes[tier] : 0;
}

function giveCard(saved, item) {
  const id = String(item.id);
  const entry = saved.collection[id];
  if (!entry) {
    saved.collection[id] = {copies: 1, xp: 0};
    if (saved.team.length < MAX_TEAM_SIZE) saved.team.push(id);
    return {isNew: true, leveledUp: false};
  }
  const oldLevel = levelForXp(entry.xp);
  entry.copies = count(entry.copies + 1);
  entry.xp = count(entry.xp + DUPLICATE_XP, XP_THRESHOLDS.at(-1));
  return {isNew: false, leveledUp: levelForXp(entry.xp) > oldLevel};
}

// Wild fighters prefer dishes the player has not found yet (9 times out of 10), and the last few
// dishes met do not come back while there is anything else to meet.
const NEW_WILD_ODDS = 0.9;
const RECENT_WILD = 5;
function spawnWild(saved, items, now, rng, brand = null, visit = false) {
  const pool = brand ? items.filter(item => item.brand === brand) : items;
  if (!pool.length) return null;
  ensureWildSeed(saved, rng);
  const sequence = saved.encounterSequence + 1;
  rng = streamRandom(saved.wildSeed + ':' + sequence + ':' + (brand ?? ''));
  const fresh = list => {
    const left = list.filter(item => !saved.recentWild.includes(String(item.id)));
    return left.length ? left : list;
  };
  const unseen = pool.filter(item => !Object.hasOwn(saved.collection, item.id));
  const enemy = choose(fresh(unseen.length && unit(rng) < NEW_WILD_ODDS ? unseen : pool), rng);
  saved.recentWild = [String(enemy.id), ...saved.recentWild.filter(id => id !== String(enemy.id))].slice(0, RECENT_WILD);
  retire(saved, saved.encounter);
  saved.encounterSequence = sequence;
  saved.encounter = {
    id: `${saved.wildSeed}-${sequence.toString(36)}`,
    enemyId: String(enemy.id), kind: 'recruit', startedAt: now, ...(visit && {visit: true}),
  };
  return saved.encounter;
}

function hasCurrentEncounter(saved, items) {
  return Boolean(saved.encounter && items.some(item => String(item.id) === saved.encounter.enemyId));
}

// Every new player starts with one random common fighter, so the arena is never empty.
// The account's own wild stream: every device of a linked profile spawns the same fighters in the
// same order (like chests in a fixed cycle), so one encounter cannot be rolled twice.
export function ensureWildSeed(profile, rng = Math.random) {
  if (!profile.wildSeed) profile.wildSeed = Math.floor(unit(rng) * 36 ** 8).toString(36).padStart(8, '0');
  return profile;
}

export function grantStarter(profile, menu, {rng = Math.random} = {}) {
  const saved = normalizeProfile(profile);
  if (Object.keys(saved.collection).length) return {ok: false, reason: 'has-fighters', profile: saved};
  const commons = menuItems(menu).filter(item => fighterFor(item.id).rarity === 'common');
  const item = choose(commons.length ? commons : menuItems(menu), rng);
  if (!item) return {ok: false, reason: 'empty-menu', profile: saved};
  giveCard(saved, item);
  ensureWildSeed(saved, rng);
  return {ok: true, reason: 'starter', profile: saved, card: ownedCard(item, saved.collection[item.id])};
}

export function claimVisit(profile, point, fix, menu, {now = Date.now(), rng = Math.random} = {}) {
  const saved = normalizeProfile(profile);
  const status = visitStatus(saved, point, fix, now);
  if (!status.ok) return {...status, profile: saved};
  const items = menuItems(menu);
  const item = visitReward(items, point.brand, rng);
  if (!item) return {ok: false, reason: 'empty-menu', profile: saved};

  const id = String(point.id);
  const visits = saved.visits[id]?.count ?? 0;
  saved.visits[id] = {count: count(visits + 1), lastAt: now};
  const reward = giveCard(saved, item);
  const route = todayRoute(saved, now);
  if (route.pointIds.length < 2 && !route.pointIds.includes(id)) route.pointIds.push(id);
  const routeCompleted = !route.claimed && route.pointIds.length === 2;
  if (routeCompleted) route.claimed = true;
  saved.daily = route;
  const playerXp = (visits === 0 ? 12 : 8) + (routeCompleted ? ROUTE_XP : 0);
  saved.xp = count(saved.xp + playerXp);

  // A visit lures a wild fighter of the same chain, unless one is already waiting.
  let spawned = null;
  if (!hasCurrentEncounter(saved, items)) {
    retire(saved, saved.encounter);
    saved.encounter = null;
    spawned = spawnWild(saved, items, now, rng, point.brand, true);
  }
  return {
    ...status, ...reward, reason: 'claimed', profile: saved, firstVisit: visits === 0,
    card: ownedCard(item, saved.collection[item.id]), playerXp, routeCompleted, routeXp: routeCompleted ? ROUTE_XP : 0,
    encounter: saved.encounter, spawned,
  };
}

// Returns the waiting wild fighter, spawning a new one once the 15-minute pause has passed.
export function wildEncounter(profile, menu, {now = Date.now(), rng = Math.random} = {}) {
  const saved = normalizeProfile(profile);
  const items = menuItems(menu);
  if (!items.length) return {ok: false, reason: 'empty-menu', profile: saved};
  if (timestamp(now) === null) return {ok: false, reason: 'invalid-time', profile: saved};
  if (hasCurrentEncounter(saved, items)) return {ok: true, reason: 'active', profile: saved, encounter: saved.encounter};
  if (!saved.team.some(id => items.some(item => String(item.id) === id))) return {ok: false, reason: 'no-team', profile: saved};
  const remainingMs = saved.lastScoutAt === null ? 0 : Math.max(0, saved.lastScoutAt + WILD_COOLDOWN_MS - now);
  if (remainingMs > 0) return {ok: false, reason: 'cooldown', profile: saved, remainingMs};
  const encounter = spawnWild(saved, items, now, rng);
  return {ok: true, reason: 'found', profile: saved, encounter, remainingMs: 0};
}

// The wild fighter fights alone against the whole team, so its size is fitted to that team:
// it keeps its own move set, and its health × attack lands at WILD_STRENGTH of the team's
// (total health × average attack). Rarer teams bring super moves, last stands and regeneration
// that health × attack does not see, so each step of the team's average rarity adds
// WILD_RARITY_BONUS. Its moves scale with it, up as well as down. Tuned with simulations where the
// player is the strong computer opponent (duel-ai.js): a good player wins about two fights in three
// whatever the team.
export const WILD_TUNING = Object.freeze({strength: 0.8, rarityBonus: 0.1, skillUp: 0});
// Moves follow the size: fully when the wild fighter is smaller than usual, by `skillUp` of the
// growth when it is bigger.
function fitSkill(skill, size, skillUp) {
  const scale = size < 1 ? size : 1 + (size - 1) * skillUp;
  if (scale === 1) return {...skill};
  const fit = value => Math.max(1, Math.round(value * scale));
  const out = {...skill};
  for (const key of ['power', 'heal', 'shield', 'team', 'execute']) if (Number.isFinite(out[key]) && out[key] > 0) out[key] = fit(out[key]);
  if (out.burn) out.burn = {...out.burn, dmg: fit(out.burn.dmg)};
  if (out.leech) out.leech = fit(out.leech);
  return out;
}

export function wildFighter(encounter, menu, team = [], tuning = WILD_TUNING) {
  const item = menuItems(menu).find(entry => String(entry.id) === encounter?.enemyId);
  if (!item) return null;
  const card = cardFor(item, 1);
  const members = (Array.isArray(team) ? team : []).filter(c => Number.isFinite(c?.attack) && Number.isFinite(c?.maxHp ?? c?.hp)).slice(0, MAX_TEAM_SIZE);
  if (!members.length) return card;
  const health = members.reduce((sum, c) => sum + (c.maxHp ?? c.hp), 0);
  const attack = members.reduce((sum, c) => sum + c.attack, 0) / members.length;
  const rank = members.reduce((sum, c) => sum + Math.max(0, RARITIES.indexOf(c.rarity)), 0) / members.length;
  const strength = tuning.strength * (1 + tuning.rarityBonus * rank);
  const scale = Math.sqrt(strength * health * attack / (card.maxHp * card.attack));
  const maxHp = Math.max(8, Math.round(card.maxHp * scale));
  return {...card, maxHp, hp: maxHp, attack: Math.max(2, Math.round(card.attack * scale)), skill: fitSkill(card.skill, scale, tuning.skillUp ?? 0),
    ...(card.ultimate && {ultimate: fitSkill(card.ultimate, scale, tuning.skillUp ?? 0)})};
}

function battleOutcome(won, draw) {
  if (typeof won !== 'boolean' || typeof draw !== 'boolean' || (draw && won)) return null;
  if (draw) return 'draw';
  return won ? 'won' : 'lost';
}

function finishBattle(saved, outcome, playerXp, cardIds, cardXp) {
  saved.xp = count(saved.xp + playerXp);
  const tally = {won: 'wins', lost: 'losses', draw: 'draws'}[outcome];
  saved.battles[tally] = count(saved.battles[tally] + 1);
  const leveledIds = [];
  for (const id of cardIds) {
    const entry = saved.collection[id];
    if (!entry) continue;
    const level = levelForXp(entry.xp);
    entry.xp = count(entry.xp + cardXp, XP_THRESHOLDS.at(-1));
    if (levelForXp(entry.xp) > level) leveledIds.push(id);
  }
  return leveledIds;
}

export function resolveEncounter(profile, encounterId, won, menu, {teamIds, draw = false, now = Date.now(), fought = null, matchId = null} = {}) {
  const saved = normalizeProfile(profile);
  if (matchId && Object.hasOwn(saved.battleIds, matchId)) return {ok: false, reason: 'already-recorded', profile: saved};
  const current = saved.encounter?.id === encounterId ? saved.encounter : null;
  // A finished fight is never lost. If a sync took this wild fighter away meanwhile (another device
  // caught it), the fight still counts against the fighter that was fought: a rare double reward is
  // fine, a lost one is not. The fight's own ID keeps it from counting twice on this device.
  const encounter = current ?? (fought && fought.id === encounterId && typeof fought.enemyId === 'string' ? fought : null);
  if (!encounter) return {ok: false, reason: 'no-encounter', profile: saved};
  const outcome = battleOutcome(won, draw);
  if (!outcome) return {ok: false, reason: 'invalid-result', profile: saved};
  const enemy = menuItems(menu).find(item => String(item.id) === encounter.enemyId);
  if (won && !enemy) return {ok: false, reason: 'missing-card', profile: saved};

  const party = teamIds ? uniqueIds(teamIds).filter(id => Object.hasOwn(saved.collection, id)).slice(0, MAX_TEAM_SIZE) : [...saved.team];
  const reward = won ? giveCard(saved, enemy) : {isNew: false, leveledUp: false};
  const partyXp = won ? WILD_WIN.party : outcome === 'lost' ? WILD_LOSS_PARTY_XP : 0;
  const playerXp = won ? WILD_WIN.player : 0;
  const leveledIds = finishBattle(saved, outcome, playerXp, party, partyXp);
  // Win or lose, the wild fighter leaves and the next one appears after the pause.
  retire(saved, encounter);
  if (current) saved.encounter = null;
  if (matchId) saved.battleIds[matchId] = true;
  if (timestamp(now) !== null) saved.lastScoutAt = Math.max(saved.lastScoutAt ?? 0, timestamp(now));
  return {
    ok: true, reason: outcome, profile: saved, encounter, card: won ? ownedCard(enemy, saved.collection[enemy.id]) : null,
    playerXp, partyXp, isNew: reward.isNew, leveledUp: reward.leveledUp || leveledIds.length > 0, leveledIds,
  };
}

// Trainers: a 3-on-3 battle against the strong computer opponent, any time, no cooldown. A trainer
// works for one chain and brings fighters of the same rarities and levels as the player's team,
// from that chain when it has them. Only experience is at stake, and modestly so.
export const TRAINERS = Object.freeze([
  {id: 'artem', name: 'Артём', role: 'Мастер гриля', brand: 'bk'},
  {id: 'misha', name: 'Миша', role: 'Хранитель короны', brand: 'bk'},
  {id: 'andrey', name: 'Андрей', role: 'Курьер', brand: 'vkusno'},
  {id: 'sasha', name: 'Саша', role: 'Бариста', brand: 'vkusno', she: true},
  {id: 'danya', name: 'Даня', role: 'Повелитель крылышек', brand: 'rostics'},
  {id: 'yaroslav', name: 'Ярослав', role: 'Кассир-ниндзя', brand: 'rostics'},
  {id: 'mark', name: 'Марк', role: 'Пиццамейкер', brand: 'dodo'},
  {id: 'lev-s', name: 'Лев С', role: 'Укротитель теста', brand: 'dodo'},
  {id: 'lev-b', name: 'Лев Б', role: 'Дегустатор', brand: null, title: 'Сборная солянка'},
  // The lord of trainers: the three strongest legends, a level above the player's best, full strength.
  {id: 'luka', name: 'Лука', brand: null, title: 'Лорд тренеров', lord: true},
]);
export const LORD_TEAM = Object.freeze(['vkusno-big-hit', 'dodo-cheesy-chicken', 'bk-burger-box']);
// Difficulty: how the trainer picks and levels its team, and what a battle pays.
export const TRAINER_LEVELS = Object.freeze({
  easy: {name: 'Разминка', levels: -1, xp: 0.6},
  normal: {name: 'Всерьёз', levels: 0, xp: 1},
  hard: {name: 'Без пощады', levels: 0, xp: 1.5, strongest: true},
});
export const TRAINER_XP = Object.freeze({won: {player: 12, party: 8}, draw: {player: 4, party: 3}, lost: {player: 3, party: 2}});
const LORD_XP = 2;

const levelCap = level => Math.min(XP_THRESHOLDS.length, Math.max(1, level));

export function trainerOffer(menu, playerCards, {rng = Math.random, trainer = null, difficulty = 'normal'} = {}) {
  const items = menuItems(menu);
  const members = (Array.isArray(playerCards) ? playerCards : []).filter(Boolean).slice(0, MAX_TEAM_SIZE);
  if (!items.length || !members.length) return null;
  const coach = (trainer && TRAINERS.find(t => t.id === trainer)) || choose(TRAINERS, rng);
  const level = TRAINER_LEVELS[difficulty] ?? TRAINER_LEVELS.normal;
  if (coach.lord) {
    const top = Math.max(...members.map(c => c.level ?? 1));
    const team = LORD_TEAM.map(id => items.find(item => String(item.id) === id)).filter(Boolean)
      .map(item => cardFor(item, levelCap(top + 1)));
    return {trainer: coach, team, difficulty: 'lord'};
  }
  // Only the rarities and levels of the player's team count, not which fighters or in what order:
  // reordering the team or swapping a fighter for one of the same rarity and level leaves the
  // trainer's line-up as it is, so the player can build counters against it.
  const RANK = {legendary: 0, epic: 1, rare: 2, common: 3};
  const slots = members.map(c => ({rarity: c.rarity ?? 'common', level: c.level ?? 1}))
    .sort((a, b) => (RANK[a.rarity] ?? 4) - (RANK[b.rarity] ?? 4) || b.level - a.level);
  const taken = new Set();
  const power = card => card.maxHp * card.attack;
  const team = slots.map(card => {
    const rarity = card.rarity;
    const lvl = levelCap(card.level + level.levels);
    const fits = items.filter(item => !taken.has(String(item.id)) && fighterFor(item.id).rarity === rarity);
    const home = coach.brand ? fits.filter(item => item.brand === coach.brand) : fits;
    let pool = home.length ? home : fits.length ? fits : items.filter(i => !taken.has(String(i.id)));
    // Without mercy the trainer takes the strongest of the rarity (one of the top two).
    if (level.strongest) pool = [...pool].sort((x, y) => power(cardFor(y, lvl)) - power(cardFor(x, lvl))).slice(0, 2);
    const item = choose(pool, rng);
    taken.add(String(item.id));
    return cardFor(item, lvl);
  });
  return {trainer: coach, team, difficulty: TRAINER_LEVELS[difficulty] ? difficulty : 'normal'};
}

export function recordTrainer(profile, {won, draw = false, teamIds, matchId, difficulty = 'normal'} = {}) {
  const saved = normalizeProfile(profile);
  const outcome = battleOutcome(won, draw);
  const id = validId(matchId);
  if (!outcome || !id) return {ok: false, reason: 'invalid-battle', profile: saved};
  if (Object.hasOwn(saved.battleIds, id)) return {ok: false, reason: 'already-recorded', profile: saved};
  saved.battleIds[id] = true;
  const factor = difficulty === 'lord' ? LORD_XP : (TRAINER_LEVELS[difficulty] ?? TRAINER_LEVELS.normal).xp;
  const playerXp = Math.max(1, Math.round(TRAINER_XP[outcome].player * factor));
  const partyXp = Math.max(1, Math.round(TRAINER_XP[outcome].party * factor));
  const party = uniqueIds(teamIds).filter(card => Object.hasOwn(saved.collection, card)).slice(0, MAX_TEAM_SIZE);
  const leveledIds = finishBattle(saved, outcome, playerXp, party, partyXp);
  return {ok: true, reason: outcome, profile: saved, playerXp, partyXp, leveledUp: leveledIds.length > 0, leveledIds};
}

export function recordBattle(profile, {xp, won, draw = false, cardId, mode, matchId} = {}) {
  const saved = normalizeProfile(profile);
  const id = matchId == null ? null : validId(matchId);
  const outcome = battleOutcome(won, draw);
  if (!outcome || !Number.isFinite(xp) || xp < 0 || mode === 'encounter' || (matchId != null && !id)) {
    return {ok: false, reason: 'invalid-battle', profile: saved};
  }
  if (id && Object.hasOwn(saved.battleIds, id)) return {ok: false, reason: 'already-recorded', profile: saved};
  if (id) saved.battleIds[id] = true;
  const fighter = validId(cardId);
  const selected = fighter && Object.hasOwn(saved.collection, fighter) ? fighter : saved.team[0];
  const playerXp = count(xp);
  const leveledIds = finishBattle(saved, outcome, playerXp, selected ? [selected] : [], playerXp);
  return {ok: true, reason: 'recorded', profile: saved, cardId: selected ?? null, playerXp, partyXp: selected ? playerXp : 0, leveledUp: leveledIds.length > 0, leveledIds};
}

// Daily login: seven days in a row, then the week starts over. Missing a day starts it over too.
// Spins use the roulette of a random chain; day 3 is a fighter announced for the whole week.
export const DAILY_DAYS = 7;
export const DAILY_REWARDS = Object.freeze([
  {day: 1, kind: 'spins', count: 1},
  {day: 2, kind: 'spins', count: 2},
  {day: 3, kind: 'featured'},
  {day: 4, kind: 'player-xp', amount: 100},
  {day: 5, kind: 'spins', count: 3},
  {day: 6, kind: 'team-xp', amount: 40},
  {day: 7, kind: 'legendary'},
]);

function dayBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1, 12).getTime());
}

// A login spin: a random chain's roulette with the usual rarity odds, but within the rarity a dish
// the player does not have yet comes 3 times out of 4.
const DAILY_NEW_ODDS = 0.75;
function dailySpin(saved, items, rng) {
  const brand = choose([...BRANDS], rng);
  const groups = RARITIES.map(() => []);
  for (const item of items) if (item.brand === brand) groups[RARITIES.indexOf(cardFor(item).rarity)].push(item);
  const total = groups.reduce((sum, group, i) => sum + (group.length ? LOOT_WEIGHTS[i] : 0), 0);
  if (!total) return null;
  let draw = unit(rng) * total;
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].length) continue;
    if (draw < LOOT_WEIGHTS[i]) {
      const missing = groups[i].filter(item => !Object.hasOwn(saved.collection, String(item.id)));
      return choose(missing.length && unit(rng) < DAILY_NEW_ODDS ? missing : groups[i], rng);
    }
    draw -= LOOT_WEIGHTS[i];
  }
  return null;
}

// The rare fighter of the week, the same for everyone: rares in a fixed order, one per calendar week.
export function featuredFighter(menu, now = Date.now()) {
  const rares = menuItems(menu).filter(item => fighterFor(item.id).rarity === 'rare').sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  if (!rares.length) return null;
  const date = new Date(now);
  const week = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000 + 3) / 7);
  return rares[week % rares.length];
}

// Where the player stands this week: which day can be claimed now (or was claimed today).
export function dailyStatus(profile, now = Date.now()) {
  const saved = normalizeProfile(profile);
  const today = localDay(now);
  const {day, streak} = saved.login;
  if (day === today) return {claimable: false, today: streak, claimed: streak};
  const next = day && day === dayBefore(today) ? streak % DAILY_DAYS + 1 : 1;
  return {claimable: true, today: next, claimed: next - 1};
}

export function claimDaily(profile, menu, {now = Date.now(), rng = Math.random} = {}) {
  const saved = normalizeProfile(profile);
  const items = menuItems(menu);
  if (!items.length) return {ok: false, reason: 'empty-menu', profile: saved};
  const status = dailyStatus(saved, now);
  if (!status.claimable) return {ok: false, reason: 'claimed', profile: saved};
  const reward = DAILY_REWARDS[status.today - 1];
  const got = [];
  const giveItem = item => {
    const result = giveCard(saved, item);
    got.push({kind: 'card', card: ownedCard(item, saved.collection[String(item.id)]), isNew: result.isNew});
  };
  if (reward.kind === 'spins') {
    for (let i = 0; i < reward.count; i++) {
      const item = dailySpin(saved, items, rng);
      if (item) giveItem(item);
    }
  } else if (reward.kind === 'featured') {
    const item = featuredFighter(items, now);
    if (item) giveItem(item);
  } else if (reward.kind === 'player-xp') {
    saved.xp = count(saved.xp + reward.amount);
    got.push({kind: 'player-xp', amount: reward.amount});
  } else if (reward.kind === 'team-xp') {
    const ids = saved.team.filter(id => saved.collection[id]);
    for (const id of ids) saved.collection[id].xp = count(saved.collection[id].xp + reward.amount, CARD_XP_CAP);
    got.push({kind: 'team-xp', amount: reward.amount, ids});
  } else if (reward.kind === 'legendary') {
    const legends = items.filter(item => fighterFor(item.id).rarity === 'legendary');
    const missing = legends.filter(item => !Object.hasOwn(saved.collection, String(item.id)));
    const item = choose(missing.length ? missing : legends, rng);
    if (item) giveItem(item);
  }
  saved.login = {day: localDay(now), streak: status.today, v: LOGIN_VERSION};
  return {ok: true, reason: 'claimed', profile: saved, day: status.today, reward, got};
}

export function createProfileStore({storage, key = 'fast-food-locator.profile.v1', locks} = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  if (locks === undefined) {
    try { locks = globalThis.navigator?.locks; } catch { locks = null; }
  }
  let persistent = Boolean(storage);
  let cached = freshProfile();
  const listeners = new Set();

  function read() {
    if (persistent) {
      let raw;
      try { raw = storage.getItem(key); } catch { persistent = false; }
      if (persistent) {
        try { cached = normalizeProfile(raw === null ? null : JSON.parse(raw)); } catch { cached = freshProfile(); }
      }
    }
    return normalizeProfile(cached);
  }

  function notify() {
    for (const listener of listeners) {
      try { listener(normalizeProfile(cached)); } catch (error) { globalThis.reportError?.(error); }
    }
  }

  function apply(change) {
    const result = change(read());
    if (!record(result) || !record(result.profile)) throw new TypeError('Изменение должно вернуть профиль синхронно');
    const next = normalizeProfile(result.profile);
    if (result.ok !== false) {
      if (persistent) {
        try { storage.setItem(key, JSON.stringify(next)); } catch { persistent = false; }
      }
      cached = next;
      notify();
    }
    return {...result, profile: normalizeProfile(next), persistent};
  }

  async function update(change) {
    if (!persistent || !locks?.request) return apply(change);
    let acquired = false;
    try {
      return await locks.request(key, {mode: 'exclusive'}, () => {
        acquired = true;
        return apply(change);
      });
    } catch (error) {
      // An embedded browser can expose the Web Locks API and deny its use.
      if (acquired || !['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error?.name)) throw error;
      locks = null;
      return apply(change);
    }
  }

  function externalChange(event) {
    if ((event.key === key || event.key === null) && (!event.storageArea || event.storageArea === storage)) {
      read();
      notify();
    }
  }

  function subscribe(listener) {
    if (!listeners.size) globalThis.addEventListener?.('storage', externalChange);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) globalThis.removeEventListener?.('storage', externalChange);
    };
  }

  return {read, update, subscribe, get persistent() { return persistent; }};
}
