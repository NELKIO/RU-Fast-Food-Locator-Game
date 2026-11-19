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
const LOOT_WEIGHTS = [60, 27, 11, 2];
const XP_THRESHOLDS = [0, 10, 25, 45, 70, 100, 135, 175, 220, 270];
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
    role: ROLES[fighter.role], basic: fighter.basic, skill: {...fighter.skill},
    ...(fighter.ultimate && {ultimate: {...fighter.ultimate}}), ...(fighter.trait && {trait: {...fighter.trait}}),
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

// Wild fighters prefer dishes the player has not found yet.
function spawnWild(saved, items, now, rng, brand = null) {
  const pool = brand ? items.filter(item => item.brand === brand) : items;
  if (!pool.length) return null;
  const unseen = pool.filter(item => !Object.hasOwn(saved.collection, item.id));
  const enemy = choose(unseen.length && unit(rng) < 0.75 ? unseen : pool, rng);
  saved.encounterSequence += 1;
  saved.encounter = {
    id: `${now.toString(36)}-${saved.encounterSequence.toString(36)}`,
    enemyId: String(enemy.id), kind: 'recruit', startedAt: now,
  };
  return saved.encounter;
}

function hasCurrentEncounter(saved, items) {
  return Boolean(saved.encounter && items.some(item => String(item.id) === saved.encounter.enemyId));
}

// Every new player starts with one random common fighter, so the arena is never empty.
export function grantStarter(profile, menu, {rng = Math.random} = {}) {
  const saved = normalizeProfile(profile);
  if (Object.keys(saved.collection).length) return {ok: false, reason: 'has-fighters', profile: saved};
  const commons = menuItems(menu).filter(item => fighterFor(item.id).rarity === 'common');
  const item = choose(commons.length ? commons : menuItems(menu), rng);
  if (!item) return {ok: false, reason: 'empty-menu', profile: saved};
  giveCard(saved, item);
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
    saved.encounter = null;
    spawned = spawnWild(saved, items, now, rng, point.brand);
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
// (total health × average attack), which leaves the player a fair edge whatever the rarity.
const WILD_STRENGTH = 0.95;
// A scaled-down wild fighter also gets a proportionally weaker signature move.
function shrinkSkill(skill, scale) {
  if (scale >= 1) return {...skill};
  const fit = value => Math.max(1, Math.round(value * scale));
  const out = {...skill};
  for (const key of ['power', 'heal', 'shield', 'team', 'execute']) if (Number.isFinite(out[key]) && out[key] > 0) out[key] = fit(out[key]);
  if (out.burn) out.burn = {...out.burn, dmg: fit(out.burn.dmg)};
  return out;
}

export function wildFighter(encounter, menu, team = []) {
  const item = menuItems(menu).find(entry => String(entry.id) === encounter?.enemyId);
  if (!item) return null;
  const card = cardFor(item, 1);
  const members = (Array.isArray(team) ? team : []).filter(c => Number.isFinite(c?.attack) && Number.isFinite(c?.maxHp ?? c?.hp)).slice(0, MAX_TEAM_SIZE);
  if (!members.length) return card;
  const health = members.reduce((sum, c) => sum + (c.maxHp ?? c.hp), 0);
  const attack = members.reduce((sum, c) => sum + c.attack, 0) / members.length;
  const scale = Math.sqrt(WILD_STRENGTH * health * attack / (card.maxHp * card.attack));
  const maxHp = Math.max(8, Math.round(card.maxHp * scale));
  return {...card, maxHp, hp: maxHp, attack: Math.max(2, Math.round(card.attack * scale)), skill: shrinkSkill(card.skill, scale),
    ...(card.ultimate && {ultimate: shrinkSkill(card.ultimate, scale)})};
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

export function resolveEncounter(profile, encounterId, won, menu, {teamIds, draw = false, now = Date.now()} = {}) {
  const saved = normalizeProfile(profile);
  const encounter = saved.encounter;
  if (!encounter || encounter.id !== encounterId) return {ok: false, reason: 'no-encounter', profile: saved};
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
  saved.encounter = null;
  if (timestamp(now) !== null) saved.lastScoutAt = timestamp(now);
  return {
    ok: true, reason: outcome, profile: saved, encounter, card: won ? ownedCard(enemy, saved.collection[enemy.id]) : null,
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
