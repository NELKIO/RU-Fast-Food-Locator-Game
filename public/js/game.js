export const VISIT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const SCOUT_COOLDOWN_MS = 15 * 60 * 1000;
export const MAX_TEAM_SIZE = 3;
export const GPS_RULES = Object.freeze({
  baseRadius: 65,
  maxRadiusBonus: 50,
  maxAccuracy: 120,
  maxAgeMs: 120_000,
  futureToleranceMs: 10_000,
});

const BRANDS = new Set(['bk', 'vkusno', 'rostics', 'dodo']);
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const LOOT_WEIGHTS = [60, 27, 11, 2];
const XP_THRESHOLDS = [0, 10, 25, 45, 70, 100, 135, 175, 220, 270];
const DUPLICATE_XP = 10;
const ROUTE_XP = 25;
const RECIPES = {
  'bk-cheeseburger': 'common', 'bk-fries': 'rare', 'bk-onion-rings': 'epic', 'bk-whopper': 'legendary',
  'vkusno-fries': 'common', 'vkusno-pie': 'rare', 'vkusno-chicken-premier': 'epic', 'vkusno-big-hit': 'legendary',
  'rostics-strips': 'common', 'rostics-twister': 'rare', 'rostics-wings': 'epic', 'rostics-chefburger': 'legendary',
  'dodo-cheese': 'common', 'dodo-pepperoni': 'rare', 'dodo-dodster': 'epic', 'dodo-four-cheeses': 'legendary',
};

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

function uniqueIds(value) {
  return Array.isArray(value) ? [...new Set(value.map(validId).filter(Boolean))] : [];
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
      profile.collection[id] = {copies: count(item.copies), xp: count(item.xp, XP_THRESHOLDS.at(-1))};
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
  if (record(encounter) && validId(encounter.id) && validId(encounter.enemyId) &&
      ['recruit', 'training'].includes(encounter.kind) && timestamp(encounter.startedAt) !== null) {
    profile.encounter = {id: validId(encounter.id), enemyId: validId(encounter.enemyId), kind: encounter.kind, startedAt: timestamp(encounter.startedAt)};
  }
  profile.encounterSequence = count(value.encounterSequence);
  profile.lastScoutAt = timestamp(value.lastScoutAt);
  profile.battles = {wins: count(value.battles?.wins), losses: count(value.battles?.losses), draws: count(value.battles?.draws)};
  if (record(value.battleIds)) {
    for (const [id, settled] of Object.entries(value.battleIds)) {
      if (validId(id) && settled === true) profile.battleIds[id] = true;
    }
  }
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

export function cardFor(item, level = 1) {
  const id = validId(item?.id);
  if (!id || !BRANDS.has(item.brand)) return null;
  const hash = hashId(id);
  const rarity = RECIPES[id] ?? RARITIES[hash % RARITIES.length];
  const tier = RARITIES.indexOf(rarity);
  const role = (hash >>> 4) % 3;
  const baseAttack = [5, 4, 3][role] + tier;
  const baseHp = [14, 17, 20][role] + 2 * tier + (hash >>> 9) % 3;
  const rank = Math.max(1, count(level, XP_THRESHOLDS.length));
  const maxHp = baseHp + 2 * (rank - 1);
  return {
    ...item, id, rarity, level: rank, baseAttack, baseHp, maxHp, hp: maxHp,
    attack: baseAttack + Math.floor((rank - 1) / 2),
    role: ['Штурмовик', 'Универсал', 'Защитник'][role],
    element: ['Жар', 'Хруст', 'Свежесть', 'Сладость'][(hash >>> 12) % 4],
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

function newEncounter(saved, items, now, rng, firstVisit = false) {
  const kind = firstVisit || unit(rng) < 0.6 ? 'recruit' : 'training';
  const unseen = kind === 'recruit' ? items.filter(item => !Object.hasOwn(saved.collection, item.id)) : [];
  const enemy = choose(unseen.length ? unseen : items, rng);
  saved.encounterSequence += 1;
  saved.encounter = {
    id: `${now.toString(36)}-${saved.encounterSequence.toString(36)}`,
    enemyId: String(enemy.id), kind, startedAt: now,
  };
  return saved.encounter;
}

function hasCurrentEncounter(saved, items) {
  return Boolean(saved.encounter && items.some(item => String(item.id) === saved.encounter.enemyId));
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
  const firstEver = Object.keys(saved.visits).length === 0;
  saved.visits[id] = {count: count(visits + 1), lastAt: now};
  const reward = giveCard(saved, item);
  const route = todayRoute(saved, now);
  if (route.pointIds.length < 2 && !route.pointIds.includes(id)) route.pointIds.push(id);
  const routeCompleted = !route.claimed && route.pointIds.length === 2;
  if (routeCompleted) route.claimed = true;
  saved.daily = route;
  const playerXp = (visits === 0 ? 12 : 8) + (routeCompleted ? ROUTE_XP : 0);
  saved.xp = count(saved.xp + playerXp);

  if (!hasCurrentEncounter(saved, items)) {
    saved.encounter = null;
    if (firstEver || unit(rng) < 0.45) newEncounter(saved, items, now, rng, firstEver);
  }
  return {
    ...status, ...reward, reason: 'claimed', profile: saved, firstVisit: visits === 0,
    card: ownedCard(item, saved.collection[item.id]), playerXp, routeCompleted, routeXp: routeCompleted ? ROUTE_XP : 0,
    encounter: saved.encounter,
  };
}

export function scoutEncounter(profile, menu, {now = Date.now(), rng = Math.random} = {}) {
  const saved = normalizeProfile(profile);
  const items = menuItems(menu);
  if (!items.length) return {ok: false, reason: 'empty-menu', profile: saved};
  if (timestamp(now) === null) return {ok: false, reason: 'invalid-time', profile: saved};
  if (hasCurrentEncounter(saved, items)) return {ok: true, reason: 'active', profile: saved, encounter: saved.encounter};
  if (!saved.team.some(id => items.some(item => String(item.id) === id))) return {ok: false, reason: 'no-team', profile: saved};
  const remainingMs = saved.lastScoutAt === null ? 0 : Math.max(0, saved.lastScoutAt + SCOUT_COOLDOWN_MS - now);
  if (remainingMs > 0) return {ok: false, reason: 'cooldown', profile: saved, remainingMs};
  saved.lastScoutAt = now;
  const encounter = newEncounter(saved, items, now, rng);
  return {ok: true, reason: 'found', profile: saved, encounter, remainingMs: 0};
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

export function resolveEncounter(profile, encounterId, won, menu, {teamIds, draw = false} = {}) {
  const saved = normalizeProfile(profile);
  const encounter = saved.encounter;
  if (!encounter || encounter.id !== encounterId) return {ok: false, reason: 'no-encounter', profile: saved};
  const outcome = battleOutcome(won, draw);
  if (!outcome) return {ok: false, reason: 'invalid-result', profile: saved};
  const enemy = menuItems(menu).find(item => String(item.id) === encounter.enemyId);
  if (won && encounter.kind === 'recruit' && !enemy) return {ok: false, reason: 'missing-card', profile: saved};

  const party = teamIds ? uniqueIds(teamIds).filter(id => Object.hasOwn(saved.collection, id)).slice(0, MAX_TEAM_SIZE) : [...saved.team];
  const recruits = won && encounter.kind === 'recruit';
  const reward = recruits ? giveCard(saved, enemy) : {isNew: false, leveledUp: false};
  const partyXp = won ? (recruits ? 5 : 14) : 0;
  const playerXp = won ? (recruits ? 15 : 18) : 0;
  const leveledIds = finishBattle(saved, outcome, playerXp, party, partyXp);
  saved.encounter = null;
  return {
    ok: true, reason: outcome, profile: saved, encounter, card: recruits ? ownedCard(enemy, saved.collection[enemy.id]) : null,
    playerXp, partyXp, isNew: reward.isNew, leveledUp: reward.leveledUp || leveledIds.length > 0, leveledIds,
  };
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
