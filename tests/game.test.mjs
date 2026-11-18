import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardFor, claimVisit, collectionCards, distanceMeters, freshProfile, levelForXp, nearestRestaurants,
  normalizeProfile, recordBattle, resolveEncounter, scoutEncounter, setTeam, teamCards, todayRoute, visitStatus, xpToNextLevel,
} from '../public/js/game.js';

const items = [
  ['bk-cheeseburger', 'bk'], ['bk-fries', 'bk'], ['bk-onion-rings', 'bk'], ['bk-whopper', 'bk'],
  ['vkusno-fries', 'vkusno'], ['vkusno-big-hit', 'vkusno'], ['dodo-cheese', 'dodo'], ['rostics-strips', 'rostics'],
].map(([id, brand]) => ({id, brand, name: id, image: `media/${id}.webp`, source: 'https://example.org/menu'}));
const first = {id: 'osm:one', brand: 'bk', lat: 55.75, lon: 37.61};
const second = {id: 'osm:two', brand: 'bk', lat: 55.75, lon: 37.63};
const pizza = {id: 'osm:pizza', brand: 'dodo', lat: 55.76, lon: 37.62};
const noon = new Date(2026, 4, 7, 12).getTime();
const hour = 3_600_000;
const fixAt = (point, now = noon) => ({lat: point.lat, lon: point.lon, accuracy: 12, timestamp: now});
const claimAt = (p, point = first, now = noon, value = 0) => claimVisit(p, point, fixAt(point, now), items, {now, rng: () => value});

test('great-circle distance matches the equatorial degree, date line and antipodal routes', () => {
  const a = {lat: 0, lon: 0};
  assert.equal(distanceMeters(a, a), 0);
  assert.ok(Math.abs(distanceMeters(a, {lat: 1, lon: 0}) - 111_195) < 2);
  assert.ok(Math.abs(distanceMeters({lat: 0, lon: 179.5}, {lat: 0, lon: -179.5}) - 111_195) < 2);
  assert.ok(Math.abs(distanceMeters(a, {lat: 0, lon: 180}) - 20_015_114) < 10);
  assert.equal(distanceMeters({lat: 91, lon: 37}, a), Infinity);
  assert.equal(distanceMeters(a, {lat: null, lon: 37}), Infinity);
});

test('nearest venues respect chain, limit, valid coordinates and native browser positions', () => {
  const points = [pizza, second, {...first, id: 'bad', lat: null}, first];
  const position = {coords: {latitude: first.lat, longitude: first.lon, accuracy: 4}, timestamp: noon};
  assert.deepEqual(nearestRestaurants(points, 'bk', position).map(p => p.id), [first.id, second.id]);
  assert.deepEqual(nearestRestaurants(points, 'all', position, 2).map(p => p.id), [first.id, second.id]);
  assert.equal(nearestRestaurants(points, null, position, Infinity).length, 3);
  assert.equal(nearestRestaurants(points, 'all', position)[0].distance, 0);
  assert.deepEqual(nearestRestaurants(points, 'all', null), []);
  assert.deepEqual(nearestRestaurants(points, 'all', position, 0), []);
  assert.deepEqual(points.map(p => p.id), [pizza.id, second.id, 'bad', first.id]);
});

test('permission denial, old samples, future fixes and kilometre-wide accuracy cannot award a visit', () => {
  const p = freshProfile();
  const here = fixAt(first);
  for (const [fix, why] of [
    [null, 'no-location'], [{...here, timestamp: noon - 120_001}, 'stale'], [{...here, timestamp: undefined}, 'stale'],
    [{...here, timestamp: noon + 10_001}, 'stale'], [{...here, accuracy: 900}, 'inaccurate'],
    [{...here, accuracy: undefined}, 'inaccurate'], [{...here, accuracy: -1}, 'inaccurate'], [fixAt(second), 'too-far'],
  ]) {
    const result = claimVisit(p, first, fix, items, {now: noon});
    assert.equal(result.reason, why);
    assert.deepEqual(result.profile, p);
  }
  assert.equal(visitStatus(p, first, {...here, timestamp: noon - 120_000}, noon).ok, true);
  assert.equal(visitStatus(p, first, {...here, accuracy: 120}, noon).ok, true);
  const offset90m = {...here, lat: here.lat + 0.00081, accuracy: 40};
  assert.equal(visitStatus(p, first, offset90m, noon).ok, true);
  assert.equal(visitStatus(p, first, {...offset90m, accuracy: 3}, noon).reason, 'too-far');
  assert.equal(visitStatus(p, first, {...here, lat: here.lat + 0.00115, accuracy: 120}, noon).reason, 'too-far');
});

test('the first real visit returns a usable chain-specific fighter and an immediately playable encounter', () => {
  const before = freshProfile();
  const received = claimAt(before, pizza);
  assert.equal(received.ok, true);
  assert.equal(received.card.brand, 'dodo');
  assert.equal(received.card.id, 'dodo-cheese');
  assert.equal(received.card.image, 'media/dodo-cheese.webp');
  assert.deepEqual(teamCards(received.profile, items).map(card => card.id), [received.card.id]);
  assert.equal(received.profile.visits[pizza.id].count, 1);
  assert.equal(received.encounter.kind, 'recruit');
  assert.ok(items.some(item => item.id === received.encounter.enemyId));
  assert.notEqual(received.encounter.enemyId, received.card.id);
  const won = resolveEncounter(received.profile, received.encounter.id, true, items);
  assert.equal(won.ok, true);
  assert.equal(won.card.id, received.encounter.enemyId);
  assert.equal(won.profile.collection[received.card.id].xp, 5);
  assert.equal(won.profile.collection[won.card.id].xp, 0);
  assert.equal(won.profile.battles.wins, 1);
  assert.equal(won.profile.encounter, null);
  assert.equal(resolveEncounter(won.profile, received.encounter.id, true, items).ok, false);
  assert.equal(received.profile.collection[won.card.id], undefined);
  assert.deepEqual(before, freshProfile());
});

test('a cooldown is exactly six hours and applies only to the claimed location', () => {
  const initial = claimAt(freshProfile());
  assert.equal(claimAt(initial.profile, first, noon + 6 * hour - 1).remainingMs, 1);
  assert.equal(visitStatus(initial.profile, first, null, noon).reason, 'cooldown');
  const beside = claimAt(initial.profile, second, noon + 1);
  assert.equal(beside.ok, true);
  assert.equal(beside.profile.visits[second.id].count, 1);
  assert.equal(beside.profile.visits[first.id].lastAt, noon);
  const back = claimAt(beside.profile, first, noon + 6 * hour);
  assert.equal(back.ok, true);
  assert.equal(back.firstVisit, false);
  assert.equal(back.profile.visits[first.id].count, 2);
  assert.equal(claimAt(back.profile, second, noon + 6 * hour).remainingMs, 1);
});

test('a local-day route requires two distinct locations, pays once and rolls over at local midnight', () => {
  const midnight = new Date(2026, 4, 8, 0, 0, 0).getTime();
  const a = claimAt(freshProfile(), first, midnight - 12 * hour);
  const repeat = claimAt(a.profile, first, midnight - 6 * hour);
  assert.equal(repeat.routeCompleted, false);
  assert.equal(todayRoute(repeat.profile, midnight - 1).pointIds.length, 1);
  const b = claimAt(repeat.profile, second, midnight - 10);
  assert.equal(b.routeCompleted, true);
  assert.equal(b.routeXp, 25);
  const c = claimAt(b.profile, pizza, midnight - 1);
  assert.equal(c.routeCompleted, false);
  assert.equal(c.routeXp, 0);
  assert.equal(c.profile.daily.pointIds.length, 2);
  assert.deepEqual(todayRoute(c.profile, midnight), {day: '2026-05-08', pointIds: [], claimed: false});
  const tomorrowA = claimAt(c.profile, first, midnight);
  const tomorrowB = claimAt(tomorrowA.profile, pizza, midnight + 6 * hour);
  assert.equal(tomorrowB.routeCompleted, true);
});

test('roulette boundaries, rarity, stats and card mastery are stable regardless of menu order', () => {
  const weights = [[0, 'common'], [0.59999, 'common'], [0.60, 'rare'], [0.86999, 'rare'], [0.87, 'epic'], [0.97999, 'epic'], [0.98, 'legendary'], [0.99999, 'legendary']];
  for (const [value, tier] of weights) {
    const reward = claimAt(freshProfile(), first, noon, value);
    assert.equal(reward.card.rarity, tier);
    assert.equal(reward.card.brand, 'bk');
  }
  const common = claimAt(freshProfile());
  const duplicate = claimAt(common.profile, second);
  assert.equal(duplicate.isNew, false);
  assert.equal(duplicate.leveledUp, true);
  assert.equal(duplicate.card.copies, 2);
  assert.equal(duplicate.card.level, 2);
  assert.equal(duplicate.card.xpToNext, 15);
  assert.ok(duplicate.card.maxHp > common.card.maxHp);
  assert.deepEqual(collectionCards(duplicate.profile, items), collectionCards(duplicate.profile, [...items].reverse()));
  for (const item of items) {
    const original = cardFor(item);
    const rank10 = cardFor({...item}, 100);
    assert.equal(rank10.level, 10);
    assert.equal(original.attack, rank10.baseAttack);
    assert.equal(original.maxHp, rank10.baseHp);
    assert.ok(original.attack >= 3 && original.attack <= 8);
    assert.ok(original.hp >= 14 && original.hp <= 28);
    assert.equal(original.rarity, rank10.rarity);
    assert.ok(rank10.attack > original.attack);
  }
  assert.equal(levelForXp(1e6), 10);
  assert.equal(xpToNextLevel(1e6), 0);
  assert.equal(claimVisit(freshProfile(), first, fixAt(first), [], {now: noon}).reason, 'empty-menu');
});

test('teams support owned characters in chosen order and reject unowned, duplicate and fourth entries', () => {
  const p = freshProfile();
  assert.deepEqual(teamCards(p, items), []);
  for (const item of items.slice(0, 4)) p.collection[item.id] = {copies: 1, xp: 10};
  const ids = ['bk-whopper', 'bk-fries', 'bk-cheeseburger'];
  const selected = setTeam(p, ids);
  assert.equal(selected.ok, true);
  assert.deepEqual(teamCards(selected.profile, items).map(card => card.id), ids);
  assert.deepEqual(setTeam(selected.profile, ['dodo-cheese']).profile.team, ids);
  assert.equal(setTeam(selected.profile, [ids[0], ids[0]]).ok, false);
  assert.equal(setTeam(selected.profile, [...ids, 'bk-onion-rings']).ok, false);
  assert.equal(setTeam(selected.profile, []).ok, false);
  assert.equal(setTeam(selected.profile, [ids[2]]).ok, true);
});

test('scouting keeps a pending encounter, respects 15 minutes and pays a training party once', () => {
  assert.equal(scoutEncounter(freshProfile(), items, {now: noon}).reason, 'no-team');
  const start = claimAt(freshProfile());
  assert.equal(scoutEncounter(start.profile, items, {now: noon}).encounter.id, start.encounter.id);
  const lost = resolveEncounter(start.profile, start.encounter.id, false, items);
  assert.equal(lost.card, null);
  assert.equal(lost.profile.battles.losses, 1);
  assert.equal(lost.profile.xp, start.profile.xp);
  const found = scoutEncounter(lost.profile, items, {now: noon, rng: () => 0.9});
  assert.equal(found.encounter.kind, 'training');
  assert.equal(resolveEncounter(found.profile, start.encounter.id, true, items).ok, false);
  const success = resolveEncounter(found.profile, found.encounter.id, true, items);
  assert.equal(success.card, null);
  assert.equal(success.partyXp, 14);
  assert.equal(success.profile.collection[start.card.id].xp, 14);
  assert.equal(success.profile.battles.wins, 1);
  assert.equal(scoutEncounter(success.profile, items, {now: noon + 899_999}).remainingMs, 1);
  assert.equal(scoutEncounter(success.profile, items, {now: noon + 900_000}).ok, true);
});

test('completed duels credit the chosen fighter and never pay a repeated match identifier', () => {
  const start = claimAt(freshProfile());
  const two = resolveEncounter(start.profile, start.encounter.id, true, items);
  const fighter = two.card.id;
  const beforeXp = two.profile.xp;
  const payload = {xp: 12, won: true, cardId: fighter, mode: 'pvp', matchId: 'pvp:42'};
  const result = recordBattle(two.profile, payload);
  assert.equal(result.ok, true);
  assert.equal(result.profile.xp, beforeXp + 12);
  assert.equal(result.profile.collection[fighter].xp, 12);
  assert.equal(result.profile.collection[start.card.id].xp, 5);
  const replayed = recordBattle(JSON.parse(JSON.stringify(result.profile)), payload);
  assert.equal(replayed.reason, 'already-recorded');
  assert.deepEqual(replayed.profile, result.profile);
  assert.equal(recordBattle(result.profile, {...payload, mode: 'encounter'}).ok, false);
});

test('draws are counted separately in encounters and online matches, including profiles saved before draw support', () => {
  const start = claimAt(freshProfile());
  start.profile.battles = {wins: 2, losses: 3};
  const tied = resolveEncounter(start.profile, start.encounter.id, false, items, {draw: true});
  assert.equal(tied.reason, 'draw');
  assert.deepEqual(tied.profile.battles, {wins: 2, losses: 3, draws: 1});
  assert.equal(tied.partyXp, 0);
  assert.equal(tied.card, null);
  assert.equal(tied.profile.encounter, null);
  assert.equal(tied.profile.xp, start.profile.xp);
  const online = {mode: 'online', won: false, draw: true, xp: 6, matchId: 'online:draw'};
  const replay = recordBattle(tied.profile, online);
  assert.deepEqual(replay.profile.battles, {wins: 2, losses: 3, draws: 2});
  assert.equal(replay.profile.xp, tied.profile.xp + 6);
  assert.deepEqual(recordBattle(replay.profile, online).profile, replay.profile);
  assert.equal(recordBattle(tied.profile, {...online, won: true}).ok, false);
});

test('only the fighters who actually participated receive encounter experience', () => {
  const start = claimAt(freshProfile());
  const victory = resolveEncounter(start.profile, start.encounter.id, true, items);
  assert.equal(victory.profile.team.length, 2);
  const scout = scoutEncounter(victory.profile, items, {now: noon, rng: () => .9});
  const participant = victory.card.id;
  const reserved = start.card.id;
  const before = scout.profile.collection[reserved].xp;
  const win = resolveEncounter(scout.profile, scout.encounter.id, true, items, {teamIds: [participant, participant, 'unowned']});
  assert.equal(win.profile.collection[reserved].xp, before);
  assert.equal(win.profile.collection[participant].xp, 14);
});

test('untrusted saved data is repaired without accepting prototype keys, invalid coordinates or non-owned teams', () => {
  const corrupt = JSON.parse('{"collection":{"__proto__":{"copies":5},"a":{"copies":2,"xp":-4},"b":{"copies":0}},"team":["b","b"],"visits":{"x":{"lastAt":null}},"battleIds":{"__proto__":true},"xp":-6}');
  const saved = normalizeProfile(corrupt);
  assert.deepEqual(saved.collection, {a: {copies: 2, xp: 0}});
  assert.deepEqual(saved.team, ['a']);
  assert.deepEqual(saved.visits, {});
  assert.deepEqual(saved.battleIds, {});
  assert.equal(saved.xp, 0);
});
