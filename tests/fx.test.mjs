import test from 'node:test';
import assert from 'node:assert/strict';
import { FIGHTERS } from '../public/js/fighters.js';
import { SHAPE_NAMES, fxTiming } from '../public/js/battle-fx.js';
import { movePlan, RECIPE_IDS, RECIPES } from '../public/js/fx-moves.js';

const STEP_TYPES = new Set(['burst', 'charge', 'projectile', 'beam', 'ring', 'flash', 'shake', 'rain', 'rise', 'bubble', 'slash', 'stamp', 'orbit', 'bolt',
  'slam', 'spot', 'dim', 'pillar']);
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

test('every super move has its own scene, not a replay of the skill', () => {
  const withUlt = Object.keys(FIGHTERS).filter(id => FIGHTERS[id].ultimate);
  assert.deepEqual([...RECIPE_IDS.ult].sort(), withUlt.sort(), 'a super move recipe for exactly the fighters that have one');
  const seen = new Set();
  for (const id of withUlt) {
    const ult = JSON.stringify(RECIPES.ult[id]().steps), skill = JSON.stringify(RECIPES.skill[id]().steps);
    assert.notEqual(ult, skill, id + ': super move equals the skill');
    assert.ok(!seen.has(ult), id + ': super move copies another fighter');
    seen.add(ult);
    // Same golden signature for every super move, and a bigger scene than the skill.
    const plan = movePlan(event(id, 'ultimate'), { brand: id.split('-')[0], energyFor: FIGHTERS[id].ultimate });
    assert.ok(plan.steps.some(s => s.type === 'dim' && s.t === 0), id + ': super moves dim the arena');
    assert.ok(plan.steps.some(s => s.type === 'ring' && s.at === 'src' && s.color === '#ffd76a' && s.t === 0), id + ': golden wind-up');
    assert.ok(plan.impact >= 600 && plan.impact <= 1300, `${id}: super move lands at ${plan.impact}`);
    // `covers` only lists effects the super move really has.
    for (const key of RECIPES.ult[id]().covers ?? []) assert.ok(FIGHTERS[id].ultimate[key], `${id} covers ${key} it does not have`);
  }
});

test('talents show up on the move: armour, rage, regeneration, vampirism, thorns, last stand', () => {
  const plain = movePlan(event('bk-fries', 'hit'), { brand: 'bk' });
  const added = (extra) => movePlan(event('bk-fries', 'hit', extra), { brand: 'bk' }).steps.slice(plain.steps.length);
  assert.ok(added({ armored: 1 }).some(s => s.type === 'ring' && s.shape === 'hex' && s.at === 'tgt'));
  assert.ok(added({ rage: true }).some(s => s.type === 'stamp' && s.shape === 'anger' && s.at === 'src'));
  const regen = added({ regen: 2, heal: 2 });
  assert.ok(regen.some(s => s.type === 'orbit' && s.at === 'src'), 'regeneration spiral');
  assert.ok(!regen.some(s => s.type === 'rise' && s.shape === 'plus'), 'regeneration alone is not shown as the move healing');
  assert.ok(added({ heal: 2 }).some(s => s.type === 'projectile' && s.from === 'tgt' && s.shape === 'drop'), 'vampiric bite');
  assert.ok(added({ thorns: 1 }).some(s => s.type === 'projectile' && s.from === 'tgt' && s.shape === 'thorn'));
  assert.ok(added({ saved: true }).some(s => s.type === 'stamp' && s.shape === 'heart' && s.at === 'tgt'));
  // Regeneration also follows a guard.
  const guard = movePlan(event('rostics-chefburger', 'guard', { regen: 2, heal: 2 }), { brand: 'rostics' });
  assert.ok(guard.steps.some(s => s.type === 'orbit' && s.at === 'src'));
});

test('recipes only use known steps, anchors and shapes, and land before they end', () => {
  for (const [id, fighter] of Object.entries(FIGHTERS)) {
    for (const command of ['special', 'hit', 'guard', 'switch:1', ...(fighter.ultimate ? ['ultimate'] : [])]) {
      const skill = command === 'ultimate' ? fighter.ultimate : fighter.skill;
      const effects = ['special', 'ultimate'].includes(command) ? ['burn', 'weaken', 'sap', 'buff', 'shield', 'team', 'cleanse', 'shatter'].filter(k => skill[k]) : [];
      const plan = movePlan(event(id, command, { effects, heal: 2, recoil: 1, executed: true, blocked: true, absorbed: 1, burned: 1, ko: ['x'], thorns: 1, saved: true,
        armored: 1, rage: true, regen: 1 }),
        { brand: id.split('-')[0], energyFor: skill });
      checkSteps(plan.steps, `${id} ${command}`);
      assert.ok(plan.impact >= 0 && plan.impact < plan.end, `${id} ${command}: impact ${plan.impact} end ${plan.end}`);
      assert.ok(plan.end <= (command === 'ultimate' ? 2950 : 2600), `${id} ${command} is too long: ${plan.end}`);
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
  assert.deepEqual(fxTiming([{ type: 'slam', t: 100, fall: 300, hold: 100, hit: true }]), { impact: 400, end: 740 });
  assert.equal(fxTiming([{ type: 'pillar', t: 0 }]).end, 700);
});
