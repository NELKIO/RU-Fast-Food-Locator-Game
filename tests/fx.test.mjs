import test from 'node:test';
import assert from 'node:assert/strict';
import { FIGHTERS } from '../public/js/fighters.js';
import { SHAPE_NAMES, fxTiming } from '../public/js/battle-fx.js';
import { movePlan, RECIPE_IDS } from '../public/js/fx-moves.js';

const STEP_TYPES = new Set(['burst', 'charge', 'projectile', 'beam', 'ring', 'flash', 'shake', 'rain', 'rise', 'bubble', 'slash', 'stamp', 'orbit', 'bolt']);
const ANCHORS = new Set(['src', 'tgt', undefined]);
const shapes = new Set(SHAPE_NAMES);

function event(id, command, extra = {}) {
  return { side: 0, command, fighter: id, target: 'x', damage: 4, heal: 0, blocked: false, absorbed: 0, executed: false,
    recoil: 0, burned: 0, skill: null, effects: [], ko: [], entered: [null, null], ...extra };
}

function checkSteps(steps, where) {
  for (const step of steps) {
    assert.ok(STEP_TYPES.has(step.type), `${where}: unknown step ${step.type}`);
    // Rings and orbits use from/to as sizes; everywhere else they name anchors.
    const keys = ['ring', 'orbit'].includes(step.type) ? ['at'] : ['at', 'from', 'to'];
    for (const key of keys) assert.ok(ANCHORS.has(step[key]), `${where}: anchor ${step[key]}`);
    for (const shape of [].concat(step.shape ?? [])) assert.ok(shapes.has(shape), `${where}: unknown shape ${shape}`);
    for (const shape of [].concat(step.trail?.shape ?? [])) assert.ok(shapes.has(shape), `${where}: unknown trail ${shape}`);
    if (step.onHit) checkSteps([].concat(step.onHit), where + ' onHit');
    if (step.splash) checkSteps([{ type: 'burst', ...step.splash }], where + ' splash');
  }
}

test('every fighter has its own hand-made skill and basic attack animation', () => {
  for (const id of Object.keys(FIGHTERS)) {
    assert.ok(RECIPE_IDS.skill.includes(id), 'skill animation for ' + id);
    assert.ok(RECIPE_IDS.basic.includes(id), 'basic animation for ' + id);
  }
  assert.deepEqual(RECIPE_IDS.skill.filter(id => !FIGHTERS[id]), [], 'no animations for missing fighters');
  assert.deepEqual(RECIPE_IDS.basic.filter(id => !FIGHTERS[id]), [], 'no animations for missing fighters');
});

test('recipes only use known steps, anchors and shapes, and land before they end', () => {
  for (const [id, fighter] of Object.entries(FIGHTERS)) {
    for (const command of ['special', 'hit', 'guard', 'switch:1']) {
      const effects = command === 'special' ? ['burn', 'weaken', 'sap', 'buff', 'shield', 'team', 'cleanse'].filter(k => fighter.skill[k]) : [];
      const plan = movePlan(event(id, command, { effects, heal: 2, recoil: 1, executed: true, blocked: true, absorbed: 1, burned: 1, ko: ['x'] }),
        { brand: id.split('-')[0], energyFor: fighter.skill });
      checkSteps(plan.steps, `${id} ${command}`);
      assert.ok(plan.impact >= 0 && plan.impact < plan.end, `${id} ${command}: impact ${plan.impact} end ${plan.end}`);
      assert.ok(plan.end <= 2600, `${id} ${command} is too long: ${plan.end}`);
      if (command === 'hit') assert.ok(plan.impact <= 700, `${id}: a plain hit should land quickly, not at ${plan.impact}`);
    }
  }
});

test('status effects the recipe does not show itself are layered on after the blow', () => {
  const plain = movePlan(event('bk-fries', 'hit'), { brand: 'bk' });
  const burning = movePlan(event('bk-fries', 'hit', { effects: ['burn'], heal: 3 }), { brand: 'bk', energyFor: {} });
  const added = burning.steps.slice(plain.steps.length);
  assert.ok(added.some(s => s.type === 'rise' && s.shape === 'flame' && s.at === 'tgt'));
  assert.ok(added.some(s => s.type === 'rise' && s.shape === 'plus' && s.at === 'src'));
  assert.ok(added.every(s => s.t >= plain.impact));
  // Пламя гриля already sets the target on fire, so no second fire layer is added.
  const whopper = movePlan(event('bk-whopper', 'special', { effects: ['burn'] }), { brand: 'bk', energyFor: FIGHTERS['bk-whopper'].skill });
  assert.equal(whopper.steps.filter(s => s.type === 'rise' && s.shape === 'flame').length, 1);
});

test('fxTiming finds the first blow and the end', () => {
  assert.deepEqual(fxTiming([{ type: 'flash', t: 100, dur: 200 }, { type: 'projectile', t: 300, travel: 400, hit: true }]), { impact: 700, end: 1150 });
  assert.equal(fxTiming([{ type: 'slash', t: 50, hit: true }]).impact, 50);
  assert.equal(fxTiming([{ type: 'ring', t: 0, dur: 5000 }]).end, 2600);
});
