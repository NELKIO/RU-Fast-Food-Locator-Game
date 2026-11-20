import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publicRoot = new URL('../public/', import.meta.url);
const readCatalog = name => JSON.parse(readFileSync(new URL(`data/${name}.json`, publicRoot), 'utf8'));
const brands = ['bk', 'vkusno', 'rostics', 'dodo'];

test('saved destinations have unique stable keys, a street address and numeric coordinates', () => {
  const venues = readCatalog('venues');
  assert.deepEqual([...new Set(venues.map(v => v.brand))].sort(), [...brands].sort());
  assert.equal(new Set(venues.map(v => v.id)).size, venues.length);
  for (const v of venues) {
    assert.ok(v.id.startsWith(`${v.brand}-`), v.id);
    assert.match(v.address, /[a-zа-яё]/iu, v.id);
    assert.ok(Number.isFinite(v.lat) && v.lat >= 41 && v.lat <= 82, v.id);
    assert.ok(Number.isFinite(v.lon) && ((v.lon >= 19 && v.lon <= 180) || (v.lon >= -180 && v.lon <= -168)), v.id);
    assert.ok(v.name.length >= 3, v.id);
  }
});

test('all four networks have physical destinations in the centres of multiple Russian cities', () => {
  const venues = readCatalog('venues');
  const cities = [
    ['Москва', 55.7558, 37.6173], ['Санкт-Петербург', 59.936, 30.320],
    ['Казань', 55.796, 49.109], ['Екатеринбург', 56.84, 60.61],
    ['Новосибирск', 55.03, 82.92],
  ];
  for (const [city, lat, lon] of cities) {
    const nearby = venues.filter(v => Math.abs(v.lat - lat) < 0.05 && Math.abs(v.lon - lon) < 0.10);
    assert.deepEqual([...new Set(nearby.map(v => v.brand))].sort(), [...brands].sort(), city);
  }
});

test('each collectible has its own local image and a link to a restaurant menu', () => {
  const menu = readCatalog('menu');
  assert.equal(new Set(menu.map(item => item.id)).size, menu.length);
  assert.equal(new Set(menu.map(item => item.image)).size, menu.length);
  const domains = {bk: 'burgerkingrus.ru', vkusno: 'vkusnoitochka.ru', rostics: 'rostics.ru', dodo: 'dodopizza.ru'};
  for (const brand of brands) assert.ok(menu.filter(item => item.brand === brand).length >= 4, brand);
  for (const item of menu) {
    assert.equal(new URL(item.source).hostname, domains[item.brand]);
    assert.equal(new URL(item.imageSource).protocol, 'https:');
    assert.match(item.image, /^media\/menu\/[a-z0-9-]+\.webp$/);
    const image = readFileSync(new URL(item.image, publicRoot));
    assert.equal(image.toString('ascii', 0, 4), 'RIFF', item.id);
    assert.equal(image.toString('ascii', 8, 12), 'WEBP', item.id);
    assert.equal(image.readUInt32LE(4) + 8, image.length, item.id);
  }
});

test('every dish on the menu is a hand-made fighter, two legends per chain and commons the most frequent', async () => {
  const { FIGHTERS, RARITIES, RENAMED, describeSkill, describeTrait } = await import('../public/js/fighters.js');
  const menu = readCatalog('menu');
  assert.deepEqual(menu.map(item => item.id).sort(), Object.keys(FIGHTERS).sort());
  for (const brand of brands) {
    const tiers = menu.filter(item => item.brand === brand).map(item => FIGHTERS[item.id].rarity);
    const [common, rare, epic, legendary] = RARITIES.map(r => tiers.filter(t => t === r).length);
    assert.equal(legendary, 2, brand);
    assert.ok(epic >= 2 && rare >= 2 && common >= 4 && tiers.length >= 10, brand);
  }
  // Across the game commons are the most frequent (Burger King's meme sauces are rare on purpose).
  const count = r => Object.values(FIGHTERS).filter(f => f.rarity === r).length;
  assert.ok(count('common') > count('rare') && count('rare') >= count('epic') && count('epic') > count('legendary'));
  assert.equal(FIGHTERS['dodo-pepperoni'].rarity, 'legendary');
  assert.equal(FIGHTERS['dodo-four-cheeses'].rarity, 'epic');
  // The bigger the cup, the rarer the fighter.
  assert.deepEqual(['bk-cola-04', 'bk-cola-05', 'bk-cola-08'].map(id => RARITIES.indexOf(FIGHTERS[id].rarity)), [0, 1, 2]);
  for (const id of ['bk-cheese-medallions', 'dodo-bbq']) assert.ok(FIGHTERS[id], id);
  assert.ok(menu.some(item => item.id === 'bk-angus-parmigiano' && /Ангус Пармеджано/.test(item.name)));
  for (const [old, next] of Object.entries(RENAMED)) {
    assert.ok(!FIGHTERS[old] && FIGHTERS[next], old);
  }
  const names = new Set();
  const unique = name => {
    assert.ok(name && !names.has(name), 'duplicate or missing name ' + name);
    names.add(name);
  };
  for (const [id, fighter] of Object.entries(FIGHTERS)) {
    assert.ok(fighter.basic && fighter.skill.name, id);
    assert.ok(fighter.skill.cost >= 1 && fighter.skill.cost <= 2, id);
    assert.ok(Number.isInteger(fighter.speed) && fighter.speed >= 1 && fighter.speed <= 9, id + ' speed');
    unique(fighter.skill.name);
    assert.match(describeSkill(fighter.skill, fighter.attack), /^[А-ЯЁ0-9].+\.$/u, id);
    if (fighter.ultimate) {
      unique(fighter.ultimate.name);
      assert.equal(fighter.ultimate.cost, 3, id);
      assert.match(describeSkill(fighter.ultimate, fighter.attack), /^[А-ЯЁ0-9].+\.$/u, id);
    }
    if (fighter.trait) {
      unique(fighter.trait.name);
      assert.match(describeTrait(fighter.trait), /^[А-ЯЁ].+\.$/u, id);
    }
  }
  // Burn reads as a duration with the right plural, not «после каждого из 3 хода».
  assert.equal(describeSkill({ power: 1, burn: { dmg: 2, turns: 3 } }, 4), '5 урона, поджигает на 3 хода соперника: −2 HP за ход.');
  assert.match(describeSkill({ power: 0, burn: { dmg: 1, turns: 5 } }, 4), /на 5 ходов соперника/);
});

test('rarer fighters have more: a talent from rare up, a super move from epic up, a double talent for legends', async () => {
  const { FIGHTERS } = await import('../public/js/fighters.js');
  const { TRAIT_KEYS } = await import('../public/js/duel-engine.js');
  const ladder = { common: [false, false], rare: [true, false], epic: [true, true], legendary: [true, true] };
  for (const [id, f] of Object.entries(FIGHTERS)) {
    assert.deepEqual([Boolean(f.trait), Boolean(f.ultimate)], ladder[f.rarity], id);
    const keys = Object.keys(f.trait ?? {}).filter(k => k !== 'name');
    if (f.trait) assert.ok(keys.length >= 1 && keys.every(k => TRAIT_KEYS.includes(k)), id);
    // A legend's talent does two things at once, and last stand belongs to legends alone.
    if (f.trait) assert.equal(keys.length, f.rarity === 'legendary' ? 2 : 1, id);
    if (keys.includes('laststand')) assert.equal(f.rarity, 'legendary', id);
  }
  // Base stats climb with rarity: the weakest rare outlasts or outhits an average common, and so on.
  const avg = (r, k) => { const g = Object.values(FIGHTERS).filter(f => f.rarity === r); return g.reduce((n, f) => n + f[k], 0) / g.length; };
  for (const k of ['hp', 'attack']) {
    assert.ok(avg('common', k) < avg('rare', k) && avg('rare', k) < avg('epic', k) && avg('epic', k) < avg('legendary', k), k);
  }
});

test('every dish can drop from its chain roulette; each of the eight legendaries drops with 1.5% per visit', async () => {
  const { dropChance } = await import('../public/js/game.js');
  const menu = readCatalog('menu');
  for (const brand of brands) {
    const items = menu.filter(item => item.brand === brand);
    const sum = items.reduce((total, item) => total + dropChance(menu, item.id), 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, brand);
    for (const item of items) assert.ok(dropChance(menu, item.id) > 0, item.id);
  }
  for (const id of ['bk-angus-parmigiano', 'bk-burger-box', 'dodo-cheesy-chicken']) assert.ok(Math.abs(dropChance(menu, id) - 0.015) < 1e-12, id);
  assert.equal(dropChance(menu, 'missing'), 0);
});

test('a super move is never weaker on paper than the cheaper signature move', async () => {
  const { FIGHTERS } = await import('../public/js/fighters.js');
  // Damage dealt over the fight: hit, burn over its turns, the bonus on a hurt target, heartburn
  // over four turns (1 + 2 + 3 + 4) and draining over three.
  const dealt = (f, s) => (Number.isFinite(s.power) ? f.attack + s.power : 0) + (s.burn ? s.burn.dmg * s.burn.turns : 0) + (s.execute ?? 0) +
    (s.toxic ? 10 : 0) + (s.leech ? 3 * s.leech : 0);
  for (const [id, f] of Object.entries(FIGHTERS)) {
    if (!f.ultimate) continue;
    assert.ok(dealt(f, f.ultimate) >= dealt(f, f.skill), `${id}: ${dealt(f, f.ultimate)} < ${dealt(f, f.skill)}`);
  }
});

test('the live countdown shows minutes and seconds under an hour', async () => {
  const { formatCountdown } = await import('../public/js/ui.js');
  assert.equal(formatCountdown(14 * 60_000 + 5_000), '14:05');
  assert.equal(formatCountdown(999), '0:01');
  assert.equal(formatCountdown(-5), '0:00');
  assert.equal(formatCountdown(90 * 60_000), '1 ч 30 мин');
});
