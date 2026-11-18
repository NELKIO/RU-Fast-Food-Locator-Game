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
