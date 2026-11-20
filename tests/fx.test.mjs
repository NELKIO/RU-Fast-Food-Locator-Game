import test from 'node:test';
import assert from 'node:assert/strict';
import { FIGHTERS } from '../public/js/fighters.js';
import { SHAPE_NAMES, fxTiming } from '../public/js/battle-fx.js';
import { intimidateFx, movePlan, RECIPE_IDS, RECIPES, TRANSFORM_FLASH } from '../public/js/fx-moves.js';

const STEP_TYPES = new Set(['burst', 'charge', 'projectile', 'beam', 'ring', 'flash', 'shake', 'rain', 'rise', 'bubble', 'slash', 'stamp', 'orbit', 'bolt',
  'slam', 'spot', 'dim', 'pillar', 'glide', 'chomp', 'encase']);
// Everything a skill can do to the fighters that the engine reports in `event.effects`.
const EFFECT_KEYS = ['burn', 'weaken', 'sap', 'buff', 'shield', 'team', 'cleanse', 'shatter', 'purge', 'freeze', 'sleep', 'toxic', 'leech', 'charge'];
const NEW_EFFECTS = ['purge', 'freeze', 'thaw', 'sleep', 'wake', 'toxic', 'leech', 'charge', 'immune'];
const ANCHORS = new Set(['src', 'tgt', undefined]);
const shapes = new Set(SHAPE_NAMES);

function event(id, command, extra = {}) {
  return { side: 0, command, fighter: id, target: 'x', damage: 4, heal: 0, hits: 0, blocked: false, absorbed: 0, executed: false,
    recoil: 0, burned: 0, poisoned: 0, leeched: 0, leechHeal: 0, skill: null, effects: [], ko: [], entered: [null, null], intimidated: [], skips: [], ...extra };
}

// The event the engine would report for a fighter's skill or super move, with every effect on.
function full(id, command) {
  const skill = command === 'ultimate' ? FIGHTERS[id].ultimate : FIGHTERS[id].skill;
  const effects = EFFECT_KEYS.filter(k => skill[k]);
  const kind = skill.freeze ? 'freeze' : skill.sleep ? 'sleep' : null;
  return event(id, command, { effects, hits: skill.hits ?? 0, skips: kind ? [{ side: 1, id: 'x', kind, burned: 1, poisoned: 2, leeched: 1, leechHeal: 1, recovered: true }] : [] });
}
const planOf = (id, command, ev = full(id, command)) =>
  movePlan(ev, { brand: id.split('-')[0], energyFor: command === 'ultimate' ? FIGHTERS[id].ultimate : FIGHTERS[id].skill });
const added = (base, extra) => {
  const plain = movePlan(event(base.id, base.command), base.options);
  return movePlan(event(base.id, base.command, extra), base.options).steps.slice(plain.steps.length);
};

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
      const move = ['special', 'ultimate'].includes(command) ? full(id, command) : event(id, command);
      // The busiest turn possible: every talent fires, the mover burns, has heartburn and is
      // drained, and the target misses its turn frozen or asleep and suffers the same.
      const plan = movePlan({ ...move, heal: 2, recoil: 1, executed: true, blocked: true, absorbed: 1, burned: 1, poisoned: 2, leeched: 1, leechHeal: 1,
        ko: ['x'], thorns: 1, saved: true, armored: 1, rage: true, regen: 1, intimidated: [move.target],
        skips: move.skips.length ? move.skips : [{ side: 1, id: 'x', kind: 'sleep', burned: 1, poisoned: 1, leeched: 1, leechHeal: 1, recovered: true }] },
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

test('every new effect has its own layer when the recipe does not show it', () => {
  const base = { id: 'bk-fries', command: 'hit', options: { brand: 'bk', energyFor: {} } };
  const plain = movePlan(event('bk-fries', 'hit'), base.options);
  const seen = new Set();
  for (const effect of NEW_EFFECTS) {
    const steps = added(base, { effects: [effect] });
    assert.ok(steps.length >= 2, effect + ' has a layer');
    assert.ok(steps.every(s => s.t >= plain.impact - 80), effect + ' plays around the blow, not before it');
    checkSteps(steps, effect);
    const key = JSON.stringify(steps.map(s => [s.type, s.shape, s.color, s.colors]));
    assert.ok(!seen.has(key), effect + ' looks like another effect');
    seen.add(key);
  }
  // The shapes that make each status readable.
  const has = (effect, test) => assert.ok(added(base, { effects: [effect] }).some(test), effect);
  has('freeze', s => s.type === 'encase' && s.at === 'tgt');
  has('sleep', s => s.type === 'stamp' && s.shape === 'moon');
  has('sleep', s => s.type === 'rise' && s.shape === 'zz');
  has('wake', s => s.type === 'stamp' && s.shape === 'bang');
  has('toxic', s => s.type === 'rise' && s.shape === 'flame' && s.colors.includes('#b6e84a'));
  has('leech', s => s.type === 'projectile' && s.from === 'tgt' && s.to === 'src');
  has('charge', s => s.type === 'rise' && s.shape === 'bolt' && s.at === 'src');
  has('immune', s => s.type === 'ring' && s.shape === 'hex' && s.at === 'tgt');
  has('purge', s => s.type === 'burst' && [].concat(s.shape).includes('bubble'));
  // End-of-turn losses of the mover and the grim look of a fighter coming in.
  assert.ok(added(base, { poisoned: 2 }).some(s => s.at === 'src' && s.shape === 'flame'), 'heartburn tick');
  const drained = added(base, { leeched: 2, leechHeal: 2 });
  assert.ok(drained.some(s => s.type === 'projectile' && s.from === 'src' && s.to === 'tgt'), 'drained towards the other side');
  const entering = movePlan(event('bk-big-king', 'switch:1', { target: 'bk-big-king', intimidated: ['bk-big-king'] }), { brand: 'bk' });
  assert.ok(entering.steps.some(s => s.type === 'stamp' && s.shape === 'glare' && s.at === 'src'), 'grim look on a switch');
  assert.ok(intimidateFx(0).some(s => s.at === 'tgt' && s.shape === 'arrowDown'), 'grim look for a fighter entering after a knockout');
  // A recipe that covers an effect is not doubled by the layer.
  const xxl = planOf('bk-sauce-xxl-chili-cheese', 'special');
  assert.equal(xxl.steps.filter(s => s.type === 'projectile' && s.shape === 'drop' && s.from === 'tgt').length, 1);
});

test('a skipped turn is shown: ice that rattles and breaks, sleep that ends in waking up', () => {
  // Frozen by this very move: one ice block from the blow until the skipped turn is over.
  const frozen = planOf('bk-fish-burger', 'special');
  const ice = frozen.steps.filter(s => s.type === 'encase');
  assert.equal(ice.length, 1, 'one continuous ice block');
  assert.equal(frozen.skips.length, 1);
  const [skip] = frozen.skips;
  assert.ok(skip.start > frozen.impact && skip.at === 'tgt' && skip.kind === 'freeze');
  assert.ok(ice[0].crack && ice[0].t + ice[0].shake === skip.start && ice[0].t + ice[0].dur === skip.end, 'rattles during the skip and breaks at its end');
  // Its losses during the skipped turn.
  assert.ok(frozen.steps.some(s => s.t >= skip.start && s.at === 'tgt' && s.shape === 'flame' && s.colors.includes('#b6e84a')), 'heartburn while frozen');
  assert.ok(frozen.steps.some(s => s.t >= skip.start && s.type === 'projectile' && s.from === 'tgt' && s.to === 'src'), 'drained while frozen');
  // Asleep: the moon stays until the fighter wakes up.
  const sleepy = planOf('vkusno-macarons', 'special');
  const moon = sleepy.steps.find(s => s.shape === 'moon');
  assert.ok(moon.t + moon.dur >= sleepy.skips[0].end - 1, 'the moon lasts through the skipped turn');
  assert.ok(sleepy.steps.some(s => s.shape === 'bang' && s.t >= sleepy.skips[0].start), 'wakes up at the end');
  // A skip on its own (asleep from earlier, the mover just guarded): sleep and z's of its own.
  const later = movePlan(event('bk-fries', 'guard', { skips: [{ side: 1, id: 'x', kind: 'sleep', burned: 0, poisoned: 0, leeched: 0, leechHeal: 0, recovered: false }] }), { brand: 'bk' });
  assert.ok(later.steps.some(s => s.shape === 'zz' && s.at === 'tgt'));
  assert.ok(!later.steps.some(s => s.shape === 'bang'), 'still asleep');
  const thawing = movePlan(event('bk-fries', 'hit', { skips: [{ side: 1, id: 'x', kind: 'freeze', burned: 0, poisoned: 0, leeched: 0, leechHeal: 0, recovered: true }] }), { brand: 'bk' });
  assert.ok(thawing.steps.some(s => s.type === 'encase' && s.instant && s.crack));
  // Two skips in a row (the other side too) play one after the other, inside the time limit.
  const two = movePlan(event('bk-fries', 'hit', { skips: [{ side: 1, kind: 'sleep' }, { side: 0, kind: 'freeze', recovered: true }] }), { brand: 'bk' });
  assert.ok(two.skips[1].start >= two.skips[0].end && two.skips[1].at === 'src');
  assert.ok(two.end <= 2600);
});

test('a flurry lands as one impact per strike', () => {
  const flurries = Object.entries(FIGHTERS).flatMap(([id, f]) => [['special', f.skill], ['ultimate', f.ultimate]]
    .filter(([, skill]) => skill?.hits > 1).map(([command, skill]) => [id, command, skill.hits]));
  assert.ok(flurries.length >= 10);
  for (const [id, command, hits] of flurries) {
    const plan = planOf(id, command);
    assert.equal(plan.strikes?.length, hits, `${id} ${command}: ${hits} strikes`);
    assert.equal(plan.strikes[0], plan.impact, `${id} ${command}: the first strike is the blow`);
    plan.strikes.slice(1).forEach((t, i) => assert.ok(t - plan.strikes[i] >= 100, `${id} ${command}: strikes ${plan.strikes} are too close to tell apart`));
    // The recipe itself throws every strike: no generic sparks needed.
    const recipe = RECIPES[command === 'ultimate' ? 'ult' : 'skill'][id]();
    assert.ok(recipe.steps.filter(s => s.strike).length, `${id} ${command} marks its strikes`);
    assert.ok(plan.strikes.at(-1) < plan.end);
    // A flurry cut short by a knockout shows only the strikes that happened.
    assert.equal(planOf(id, command, { ...full(id, command), hits: 2 }).strikes.length, 2);
  }
  // A recipe that shows one blow still gets a separate impact for every extra strike.
  const generic = movePlan(event('bk-fries', 'special', { hits: 3 }), { brand: 'bk', energyFor: FIGHTERS['bk-fries'].skill });
  assert.equal(generic.strikes.length, 3);
  for (const t of generic.strikes.slice(1)) assert.ok(generic.steps.some(s => s.t === t && s.type === 'burst' && s.at === 'tgt'));
  assert.equal(movePlan(event('bk-fries', 'hit'), { brand: 'bk' }).strikes, undefined, 'a single blow is not a flurry');
});

test('recipes match what the moves do', () => {
  for (const [id, fighter] of Object.entries(FIGHTERS)) {
    // `covers` only lists effects the move really has (heal covers the healing of drain and team).
    const skill = fighter.skill;
    for (const key of RECIPES.skill[id]().covers ?? []) assert.ok(skill[key] || (key === 'heal' && (skill.drain || skill.team)), `${id} skill covers ${key} it does not have`);
    // A move that deals damage has a blow that lands on the target.
    for (const [kind, move] of [['skill', skill], ['ult', fighter.ultimate]]) {
      if (!move || !Number.isFinite(move.power)) continue;
      assert.ok(RECIPES[kind][id]().steps.some(s => s.hit), `${id} ${kind} deals damage but has no blow`);
    }
  }
  // Every basic attack and every skill is its own scene.
  for (const kind of ['basic', 'skill']) {
    const seen = new Map();
    for (const id of Object.keys(FIGHTERS)) {
      const recipe = RECIPES[kind][id]();
      const key = JSON.stringify(recipe.steps ?? recipe);
      assert.ok(!seen.has(key), `${id} ${kind} copies ${seen.get(key)}`);
      seen.set(key, id);
    }
  }
});

test('fxTiming finds the first blow and the end', () => {
  assert.deepEqual(fxTiming([{ type: 'flash', t: 100, dur: 200 }, { type: 'projectile', t: 300, travel: 400, hit: true }]), { impact: 700, end: 1150 });
  assert.equal(fxTiming([{ type: 'slash', t: 50, hit: true }]).impact, 50);
  assert.equal(fxTiming([{ type: 'ring', t: 0, dur: 5000 }]).end, 2600);
  assert.deepEqual(fxTiming([{ type: 'slam', t: 100, fall: 300, hold: 100, hit: true }]), { impact: 400, end: 740 });
  assert.equal(fxTiming([{ type: 'pillar', t: 0 }]).end, 700);
  assert.equal(fxTiming([{ type: 'chomp', t: 100, dur: 400, close: 0.5, hit: true }]).impact, 300);
  assert.equal(fxTiming([{ type: 'glide', t: 100, dur: 1000, path: [[0, 0], [1, 0], [2, 0]], contact: [1], hit: true }]).impact, 600);
  assert.equal(fxTiming([{ type: 'encase', t: 0, dur: 800, crack: true }]).end, 1520);
});

// The event the engine reports for a transformation, with the form's effect on.
function transformEvent(id) {
  const form = FIGHTERS[id].transform, effect = form.effect ?? {};
  const effects = ['transform', ...EFFECT_KEYS.filter(k => effect[k])];
  const kind = effect.freeze ? 'freeze' : effect.sleep ? 'sleep' : null;
  return event(id, 'transform', { transformed: form.name, skill: form.effect ? form.name : null, effects,
    damage: Number.isFinite(effect.power) ? 3 : 0, heal: effect.heal || effect.team ? 3 : 0, hits: effect.hits ?? 0,
    skips: kind ? [{ side: 1, id: 'x', kind, burned: 0, poisoned: 0, leeched: 0, leechHeal: 0, recovered: true }] : [] });
}

test('a transformation has its violet scene, then the form\'s effect plays like a skill', () => {
  const forms = Object.keys(FIGHTERS).filter(id => FIGHTERS[id].transform);
  assert.ok(forms.length >= 5, 'fighters with a transformation');
  for (const id of forms) {
    const effect = FIGHTERS[id].transform.effect;
    const plan = movePlan(transformEvent(id), { brand: id.split('-')[0], energyFor: effect });
    checkSteps(plan.steps, id + ' transform');
    // The flash on the fighter itself is the moment its picture changes.
    assert.ok(plan.steps.some(s => s.type === 'flash' && s.at === 'src' && s.t === TRANSFORM_FLASH), id + ': flash at the change');
    assert.ok(plan.steps.some(s => s.type === 'burst' && s.at === 'src' && [].concat(s.shape).includes('star')), id + ': stars burst out');
    assert.ok(plan.impact > TRANSFORM_FLASH, `${id}: the effect comes after the change, not at ${plan.impact}`);
    assert.ok(plan.end <= 2600 && plan.impact < plan.end, `${id}: ${plan.impact} / ${plan.end}`);
    if (Number.isFinite(effect?.power)) assert.ok(plan.steps.some(s => s.hit && s.type === 'projectile' && s.t >= TRANSFORM_FLASH), id + ': the blow flies after the change');
    if (effect?.hits > 1) assert.equal(plan.strikes.length, effect.hits, id + ': one impact per strike');
    // The effect's statuses use the usual layers: ice, sleep, healing…
    if (effect?.freeze) assert.ok(plan.steps.some(s => s.type === 'encase' && s.at === 'tgt'), id + ': freeze');
    if (effect?.heal) assert.ok(plan.steps.some(s => s.type === 'rise' && s.shape === 'plus' && s.at === 'src' && s.t >= plan.impact), id + ': heal');
  }
  // Without an effect it is the scene alone, and it does not lunge at the other side.
  const bare = movePlan(event('bk-fries', 'transform', { transformed: 'Форма', damage: 0, effects: ['transform'] }), { brand: 'bk' });
  checkSteps(bare.steps, 'bare transform');
  assert.ok(!bare.steps.some(s => s.at === 'tgt' || s.to === 'tgt'), 'nothing reaches the target');
  assert.ok(bare.impact > TRANSFORM_FLASH && bare.end <= 2600);
});

test('the new talents show up on the move', () => {
  const base = { id: 'bk-fries', command: 'hit', options: { brand: 'bk' } };
  assert.ok(added(base, { opener: true }).some(s => s.type === 'charge' && s.at === 'src'), 'opener');
  assert.ok(added(base, { fresh: true }).some(s => s.type === 'bubble' && s.at === 'tgt'), 'fresh');
  assert.ok(added(base, { parting: 2, ko: ['x'] }).some(s => s.type === 'chomp' && s.at === 'src'), 'parting gift bites the attacker');
  assert.ok(added(base, { moxie: true }).some(s => s.type === 'rise' && s.shape === 'arrowUp' && s.at === 'src'), 'moxie');
  const snackAt = (at) => movePlan(event('bk-fries', 'hit', { snack: 3 }), { brand: 'bk', snack: at }).steps.filter(s => s.shape === 'crumb');
  assert.equal(snackAt('tgt')[0]?.at, 'tgt');
  assert.equal(snackAt('src')[0]?.at, 'src');
  const refresh = movePlan(event('bk-fries', 'switch:1', { refresh: 2 }), { brand: 'bk' });
  assert.ok(refresh.steps.some(s => s.type === 'rise' && s.shape === 'plus' && s.at === 'src'), 'refresh');
  const skipSnack = movePlan(event('bk-fries', 'hit', { skips: [{ side: 1, kind: 'sleep', snack: 3 }] }), { brand: 'bk' });
  assert.ok(skipSnack.steps.some(s => s.type === 'rise' && s.shape === 'plus' && s.at === 'tgt' && s.t >= skipSnack.skips[0].start), 'snack while asleep');
  for (const extra of [{ opener: true }, { fresh: true }, { parting: 2 }, { moxie: true }, { snack: 2 }]) checkSteps(added(base, extra), JSON.stringify(extra));
});
