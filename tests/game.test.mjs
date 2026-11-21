import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardFor, claimVisit, collectionCards, distanceMeters, freshProfile, levelForXp, nearestRestaurants,
  grantStarter, normalizeProfile, recordBattle, resolveEncounter, setTeam, teamCards, todayRoute, visitStatus, wildEncounter,
  wildFighter, xpToNextLevel, WILD_COOLDOWN_MS,
} from '../public/js/game.js';

const items = [
  ['bk-chicken-parmesan', 'bk'], ['bk-fries', 'bk'], ['bk-onion-rings', 'bk'], ['bk-whopper', 'bk'],
  ['vkusno-nuggets', 'vkusno'], ['vkusno-big-hit', 'vkusno'], ['dodo-cheese', 'dodo'], ['rostics-strips', 'rostics'],
  ['bk-angus-parmigiano', 'bk'],
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

test('the first real visit returns a chain-specific fighter and lures a wild fighter of the same chain', () => {
  const before = freshProfile();
  const received = claimAt(before, first);
  assert.equal(received.ok, true);
  assert.equal(received.card.brand, 'bk');
  assert.equal(received.card.id, 'bk-fries');
  assert.equal(received.card.image, 'media/bk-fries.webp');
  assert.deepEqual(teamCards(received.profile, items).map(card => card.id), [received.card.id]);
  assert.equal(received.profile.visits[first.id].count, 1);
  assert.equal(received.encounter.kind, 'recruit');
  assert.deepEqual(received.spawned, received.encounter);
  assert.ok(received.encounter.enemyId.startsWith('bk-'));
  assert.notEqual(received.encounter.enemyId, received.card.id, 'an unseen dish is preferred');
  const won = resolveEncounter(received.profile, received.encounter.id, true, items, {now: noon + 1});
  assert.equal(won.ok, true);
  assert.equal(won.card.id, received.encounter.enemyId);
  assert.equal(won.profile.collection[received.card.id].xp, 10);
  assert.equal(won.profile.collection[won.card.id].xp, 0);
  assert.equal(won.profile.battles.wins, 1);
  assert.equal(won.profile.encounter, null);
  assert.equal(won.profile.lastScoutAt, noon + 1);
  assert.equal(resolveEncounter(won.profile, received.encounter.id, true, items).ok, false);
  assert.equal(received.profile.collection[won.card.id], undefined);
  assert.deepEqual(before, freshProfile());
  const next = claimAt(received.profile, second, noon + 1);
  assert.equal(next.spawned, null, 'a waiting wild fighter is not replaced by the next visit');
  assert.equal(next.encounter.id, received.encounter.id);
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
  // Weights 58 / 27 / 12 / 3.
  const weights = [[0, 'common'], [0.57999, 'common'], [0.5801, 'rare'], [0.84999, 'rare'], [0.8501, 'epic'], [0.96999, 'epic'], [0.9701, 'legendary'], [0.99999, 'legendary']];
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
    assert.ok(original.hp >= 14 && original.hp <= 30);
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
  const ids = ['bk-whopper', 'bk-fries', 'bk-chicken-parmesan'];
  const selected = setTeam(p, ids);
  assert.equal(selected.ok, true);
  assert.deepEqual(teamCards(selected.profile, items).map(card => card.id), ids);
  assert.deepEqual(setTeam(selected.profile, ['dodo-cheese']).profile.team, ids);
  assert.equal(setTeam(selected.profile, [ids[0], ids[0]]).ok, false);
  assert.equal(setTeam(selected.profile, [...ids, 'bk-onion-rings']).ok, false);
  assert.equal(setTeam(selected.profile, []).ok, false);
  assert.equal(setTeam(selected.profile, [ids[2]]).ok, true);
});

test('every new player gets one common starter, exactly once', () => {
  const starter = grantStarter(freshProfile(), items, {rng: () => 0.999});
  assert.equal(starter.ok, true);
  assert.equal(starter.card.rarity, 'common');
  assert.deepEqual(starter.profile.team, [starter.card.id]);
  assert.equal(grantStarter(starter.profile, items).reason, 'has-fighters');
  assert.equal(grantStarter(freshProfile(), []).reason, 'empty-menu');
});

test('a wild fighter waits until fought, then the next one appears after exactly 15 minutes', () => {
  assert.equal(wildEncounter(freshProfile(), items, {now: noon}).reason, 'no-team');
  const {profile} = grantStarter(freshProfile(), items, {rng: () => 0});
  const found = wildEncounter(profile, items, {now: noon, rng: () => 0});
  assert.equal(found.reason, 'found');
  assert.equal(found.encounter.kind, 'recruit');
  assert.equal(wildEncounter(found.profile, items, {now: noon + 5}).encounter.id, found.encounter.id);
  const lost = resolveEncounter(found.profile, found.encounter.id, false, items, {now: noon});
  assert.deepEqual([lost.card, lost.partyXp, lost.profile.battles.losses, lost.profile.encounter], [null, 3, 1, null]);
  assert.equal(lost.profile.xp, profile.xp);
  assert.equal(wildEncounter(lost.profile, items, {now: noon + WILD_COOLDOWN_MS - 1}).remainingMs, 1);
  const again = wildEncounter(lost.profile, items, {now: noon + WILD_COOLDOWN_MS});
  assert.equal(again.ok, true);
  assert.notEqual(again.encounter.id, found.encounter.id);
});

test('a wild fighter is sized to the team, so any rarity is a fair fight', () => {
  const encounter = {id: 'w', enemyId: 'bk-angus-parmigiano', kind: 'recruit', startedAt: noon};
  const base = cardFor(items.find(item => item.id === 'bk-angus-parmigiano'));
  assert.deepEqual(wildFighter(encounter, items), base);
  const one = [cardFor(items.find(item => item.id === 'bk-fries'))];
  const alone = wildFighter(encounter, items, one);
  const power = card => card.maxHp * card.attack;
  // A common team: strength 0.85 with no rarity bonus.
  assert.ok(Math.abs(power(alone) / power(one[0]) - 0.85) < 0.15, power(alone));
  assert.ok(alone.skill.power < base.skill.power && alone.skill.power >= 1);
  assert.equal(alone.hp, alone.maxHp);
  const three = ['bk-fries', 'bk-whopper', 'vkusno-big-hit'].map(id => cardFor(items.find(item => item.id === id), 5));
  const crowd = wildFighter(encounter, items, three);
  assert.ok(crowd.maxHp > alone.maxHp && crowd.attack >= alone.attack);
  assert.equal(wildFighter({...encounter, enemyId: 'ghost'}, items, one), null);
});

test('dishes that left the roster are merged into their replacements in old saves', () => {
  const saved = normalizeProfile({
    collection: {'bk-cheeseburger': {copies: 2, xp: 12}, 'bk-chicken-parmesan': {copies: 1, xp: 30}, 'vkusno-fries': {copies: 1, xp: 0}},
    team: ['bk-cheeseburger', 'vkusno-fries'],
    encounter: {id: 'e1', enemyId: 'vkusno-fries', kind: 'training', startedAt: noon},
  });
  assert.deepEqual(saved.collection, {'bk-chicken-parmesan': {copies: 3, xp: 30}, 'vkusno-nuggets': {copies: 1, xp: 0}});
  assert.deepEqual(saved.team, ['bk-chicken-parmesan', 'vkusno-nuggets']);
  assert.deepEqual(saved.encounter, {id: 'e1', enemyId: 'vkusno-nuggets', kind: 'recruit', startedAt: noon});
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
  assert.equal(result.profile.collection[start.card.id].xp, 10);
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
  const victory = resolveEncounter(start.profile, start.encounter.id, true, items, {now: noon});
  assert.equal(victory.profile.team.length, 2);
  const scout = wildEncounter(victory.profile, items, {now: noon + WILD_COOLDOWN_MS, rng: () => .9});
  const participant = victory.card.id;
  const reserved = start.card.id;
  const before = scout.profile.collection[reserved].xp;
  const win = resolveEncounter(scout.profile, scout.encounter.id, true, items, {teamIds: [participant, participant, 'unowned']});
  assert.equal(win.profile.collection[reserved].xp, before);
  assert.equal(win.profile.collection[participant].xp, 10);
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

// The login week and fewer repeated wild fighters (November 2026).
import { claimDaily, dailyStatus, featuredFighter, DAILY_REWARDS } from '../public/js/game.js';
import { docOf, mergeProfile } from '../public/js/sync-merge.js';
import { readFileSync } from 'node:fs';
const realMenu = JSON.parse(readFileSync(new URL('../public/data/menu.json', import.meta.url)));
const day = n => new Date(2026, 10, 20 + n, 10).getTime();
function seq(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

test('a synced encounter with the same sequence cannot change the fighter a player won', () => {
  const starter = grantStarter(freshProfile(), realMenu, {rng: seq(3)}).profile;
  const laptop = mergeProfile(starter, [], {now: noon - 2000, device: 'aaaaaaaaaaaaaaaa'});
  const phone = mergeProfile(freshProfile(), [docOf(laptop)], {now: noon - 1000, device: 'bbbbbbbbbbbbbbbb'});
  const visit = (profile, point, now) => claimVisit(profile, point, fixAt(point, now), realMenu, {now, rng: seq(8)});
  const remote = visit(laptop, first, noon);
  const local = visit(phone, pizza, noon + 1000);
  const fought = local.encounter;
  assert.equal(remote.encounter.id, fought.id);
  assert.notEqual(remote.encounter.enemyId, fought.enemyId);
  const remoteDoc = docOf(mergeProfile(remote.profile, [], {now: noon + 2000}));
  const synced = mergeProfile(local.profile, [remoteDoc], {now: noon + 3000});
  assert.equal(synced.encounter.enemyId, remote.encounter.enemyId);
  const options = {now: noon + 4000, fought, matchId: 'won-on-phone'};
  const reward = resolveEncounter(synced, fought.id, true, realMenu, options);
  assert.equal(reward.card.id, fought.enemyId);
  assert.equal(reward.profile.collection[fought.enemyId].copies, (synced.collection[fought.enemyId]?.copies ?? 0) + 1);
  assert.deepEqual(reward.profile.collection[remote.encounter.enemyId], synced.collection[remote.encounter.enemyId]);
  const replay = resolveEncounter(reward.profile, fought.id, true, realMenu, options);
  assert.equal(replay.reason, 'already-recorded');
  assert.deepEqual(replay.profile, reward.profile);
  assert.equal(resolveEncounter(reward.profile, fought.id, true, realMenu, {fought}).reason, 'no-encounter');
});

test('moving the local calendar back across midnight preserves the login streak and reward', () => {
  const profile = normalizeProfile({...freshProfile(), login: {day: '2026-11-20', streak: 5, v: 2}});
  const midnight = new Date(2026, 10, 21, 0, 30).getTime();
  const earned = claimDaily(profile, realMenu, {now: midnight});
  assert.equal(earned.day, 6);
  for (const localTime of [midnight - hour, midnight, day(1)]) {
    assert.deepEqual(dailyStatus(earned.profile, localTime), {claimable: false, today: 6, claimed: 6});
    const repeated = claimDaily(earned.profile, realMenu, {now: localTime});
    assert.equal(repeated.reason, 'claimed');
    assert.deepEqual(repeated.profile, earned.profile);
  }
  assert.equal(claimDaily(earned.profile, realMenu, {now: day(2)}).day, 7);
  assert.equal(dailyStatus({...earned.profile, login: {day: '2026-11-31', streak: 6, v: 2}}, day(0)).today, 1);
});

test('the login week: one reward a day, seven days in a row, a missed day starts over', () => {
  let p = grantStarter(freshProfile(), realMenu, { rng: seq(3) }).profile;
  const got = [];
  for (let d = 0; d < 7; d++) {
    const r = claimDaily(p, realMenu, { now: day(d), rng: seq(10 + d) });
    assert.equal(r.ok, true, 'day ' + (d + 1));
    assert.equal(r.day, d + 1);
    assert.equal(claimDaily(r.profile, realMenu, { now: day(d) + 3600_000 }).reason, 'claimed', 'only once a day');
    got.push(r);
    p = r.profile;
  }
  assert.deepEqual(got.map(r => r.got.filter(g => g.kind === 'card').length), [1, 2, 1, 0, 3, 0, 1]);
  assert.equal(got[2].got[0].card.id, featuredFighter(realMenu, day(2)).id, 'day 3 is the fighter of the week');
  assert.equal(got[2].got[0].card.rarity, 'rare');
  assert.equal(got[3].profile.xp - got[2].profile.xp, 100);
  assert.equal(got[6].got[0].card.rarity, 'legendary', 'day 7 is a legend');
  for (const id of got[5].got[0].ids) assert.ok(got[5].profile.collection[id].xp >= 40);
  assert.equal(claimDaily(p, realMenu, { now: day(7) }).day, 1, 'after day 7 the week starts over');
  assert.deepEqual(dailyStatus(p, day(9)), { claimable: true, today: 1, claimed: 0 }, 'a missed day starts over');
  assert.equal(DAILY_REWARDS.length, 7);
});

test('the day-7 legend is one the player does not have yet, while there is one', () => {
  const legends = realMenu.filter(item => cardFor(item).rarity === 'legendary').map(item => item.id);
  const owned = Object.fromEntries(legends.slice(1).map(id => [id, { copies: 1, xp: 0 }]));
  const p = normalizeProfile({ ...freshProfile(), collection: owned, team: [legends[1]], login: { day: '2026-11-19', streak: 6, v: 2 } });
  const r = claimDaily(p, realMenu, { now: new Date(2026, 10, 20, 9).getTime(), rng: seq(7) });
  assert.equal(r.day, 7);
  assert.equal(r.got[0].card.id, legends[0]);
  assert.equal(r.got[0].isNew, true);
});

test('wild fighters: new dishes come first and the last five do not repeat while others remain', () => {
  let p = grantStarter(freshProfile(), realMenu, { rng: seq(5) }).profile;
  const seen = [];
  let now = day(0);
  for (let i = 0; i < 40; i++) {
    const r = wildEncounter(p, realMenu, { now, rng: seq(100 + i) });
    assert.equal(r.ok, true);
    seen.push(r.encounter.enemyId);
    p = resolveEncounter(r.profile, r.encounter.id, false, realMenu, { now: now + 1000 }).profile;
    now += WILD_COOLDOWN_MS + 2000;
  }
  for (let i = 5; i < seen.length; i++) assert.ok(!seen.slice(i - 5, i).includes(seen[i]), 'no repeat within five: ' + seen[i]);
  assert.ok(new Set(seen).size >= 27, 'mostly different fighters, got ' + new Set(seen).size);
});

test('losing to the only missing fighter leaves five other encounters before it may return', () => {
  const missing = 'bk-whopper';
  let profile = normalizeProfile({...freshProfile(), wildSeed: '00000001', team: ['bk-fries'],
    collection: Object.fromEntries(realMenu.filter(item => item.id !== missing).map(item => [item.id, {copies: 1, xp: 0}]))});
  const met = [];
  let now = noon;
  for (let i = 0; i < 6; i++) {
    const found = wildEncounter(profile, realMenu, {now});
    const enemy = found.encounter.enemyId;
    assert.ok(!met.includes(enemy), enemy + ' returned too soon');
    met.push(enemy);
    profile = resolveEncounter(found.profile, found.encounter.id, false, realMenu, {now}).profile;
    now += WILD_COOLDOWN_MS;
  }
  assert.equal(met[0], missing);
});

test('a login reward claimed before the roulette version is reset once and can be claimed again', () => {
  const old = normalizeProfile({ ...freshProfile(), login: { day: '2026-11-20', streak: 1 } });
  assert.deepEqual(old.login, { day: '', streak: 0 });
  assert.equal(dailyStatus(old, new Date(2026, 10, 20, 18).getTime()).claimable, true);
  const r = claimDaily(old, realMenu, { now: new Date(2026, 10, 20, 18).getTime(), rng: seq(4) });
  assert.equal(r.profile.login.v, 2);
  assert.equal(dailyStatus(r.profile, new Date(2026, 10, 20, 19).getTime()).claimable, false, 'the new claim sticks');
});

test('login spins favour dishes the player does not have yet', () => {
  let newOnes = 0, total = 0;
  for (let k = 0; k < 60; k++) {
    let p = grantStarter(freshProfile(), realMenu, { rng: seq(900 + k) }).profile;
    // Own half of every chain's menu, so both new and old dishes can come.
    const owned = Object.fromEntries(realMenu.filter((_, i) => i % 2 === 0).map(item => [item.id, { copies: 1, xp: 0 }]));
    p = normalizeProfile({ ...p, collection: { ...p.collection, ...owned }, login: { day: '2026-11-20', streak: 4, v: 2 } });
    const r = claimDaily(p, realMenu, { now: new Date(2026, 10, 21, 10).getTime(), rng: seq(5000 + k) });
    assert.equal(r.day, 5);
    for (const g of r.got) { total++; if (g.isNew) newOnes++; }
  }
  assert.ok(newOnes / total > 0.65, `new fighters in ${newOnes} of ${total} spins`);
});

test('the suggested team: the three strongest by measured strength and level, the strongest leads', async () => {
  const { suggestTeam } = await import('../public/js/game.js');
  const { RATING } = await import('../public/js/ratings.js');
  const card = (id, level = 1) => cardFor(realMenu.find(m => m.id === id), level);
  // At level 5 only the measured strength counts.
  const owned = ['bk-fries', 'bk-big-king', 'vkusno-nuggets', 'dodo-pepperoni', 'rostics-strips'].map(id => card(id, 5));
  const team = suggestTeam(owned);
  assert.equal(team.length, 3);
  assert.deepEqual(new Set(team), new Set(['bk-big-king', 'dodo-pepperoni', [ 'bk-fries', 'vkusno-nuggets', 'rostics-strips'].sort((a, b) => RATING[b] - RATING[a])[0]]));
  assert.ok(RATING[team[0]] >= RATING[team[1]] && RATING[team[1]] >= RATING[team[2]], 'the strongest leads');
  // A well-trained common can beat an untrained rarer one.
  const trained = suggestTeam([card('bk-fries', 10), card('rostics-strips', 1)]);
  assert.equal(trained[0], 'bk-fries');
  assert.deepEqual(suggestTeam([card('vkusno-nuggets')]), ['vkusno-nuggets'], 'fewer than three: all of them');
});

test('a login day far in the future (a clock set wrong on a linked device) does not lock the reward', async () => {
  const { dailyStatus } = await import('../public/js/game.js');
  const now = Date.UTC(2026, 10, 21, 12);
  const at = day => normalizeProfile({ ...freshProfile(), login: { day, streak: 3, v: 2 } });
  assert.equal(dailyStatus(at('2026-11-21'), now).claimable, false, 'claimed today');
  assert.equal(dailyStatus(at('2026-11-22'), now).claimable, false, 'a time zone ahead: still today there');
  const far = dailyStatus(at('2027-11-21'), now);
  assert.deepEqual([far.claimable, far.today], [true, 1], 'a year ahead: claimable again, the streak starts over');
});
