export const MAX_TURNS = 48;
export const MAX_TEAM = 3;
export const MAX_ENERGY = 3;
export const START_ENERGY = 1;
export const SPEED = { min: 1, max: 9, base: 5 };
const MAX_BUFF = 4;
const MAX_WEAKEN = 3;
const SKILL_KEYS = ['name', 'cost', 'power', 'pierce', 'hits', 'burn', 'heal', 'drain', 'shield', 'buff', 'weaken', 'sap', 'team', 'execute', 'recoil',
  'cleanse', 'shatter', 'purge', 'freeze', 'sleep', 'toxic', 'leech', 'charge'];
// Talents work on their own, without a move: one per rare, epic and legendary fighter.
// Immunities stay rare on purpose: with three fighters a team cannot prepare for many of them,
// so only fireproof (a few fighters) and sterile (one meme fighter) exist.
export const TRAIT_KEYS = ['armor', 'thorns', 'regen', 'rage', 'fireproof', 'steady', 'quick', 'vamp', 'laststand', 'pure', 'intimidate',
  // Passives with a clear trigger (no chances):
  //   moxie    attack +N after it knocks out an opposing fighter
  //   refresh  restores N HP when it leaves the field
  //   fresh    takes half damage while at full health
  //   parting  when knocked out by a blow, the attacker loses N HP (never knocks it out)
  //   opener   its first blow after coming onto the field is N stronger
  //   snack    once per battle, on dropping to half health or below, restores N HP
  //   breaker  plain hits go through guard
  'moxie', 'refresh', 'fresh', 'parting', 'opener', 'snack', 'breaker'];
// Transformation: once per battle, for energy, the fighter takes another form for the rest of the
// battle. The form changes stats (added to the current ones), may replace the skill, super move and
// talent, and the change itself does something at once (`effect`, like a skill without a cost).
const TRANSFORM_KEYS = ['name', 'cost', 'hp', 'attack', 'speed', 'skill', 'ultimate', 'trait', 'effect', 'look'];
const MAX_TOXIC = 4;

export function validTeam(ids, catalog) {
  return Array.isArray(ids) && ids.length >= 1 && ids.length <= MAX_TEAM &&
    new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && catalog.has(id));
}

// Only the fields the engine reads. Both duel peers compare this exact shape.
function cleanSkill(skill) {
  const out = {};
  for (const key of SKILL_KEYS) {
    if (skill?.[key] === undefined) continue;
    out[key] = key === 'burn' ? { dmg: skill.burn.dmg, turns: skill.burn.turns } : skill[key];
  }
  out.cost = Math.min(MAX_ENERGY, Math.max(1, out.cost ?? 2));
  out.name ??= 'Фирменный приём';
  return out;
}

function cleanSpeed(speed) {
  return Number.isSafeInteger(speed) ? Math.min(SPEED.max, Math.max(SPEED.min, speed)) : SPEED.base;
}

function cleanTrait(trait) {
  const out = {};
  for (const key of TRAIT_KEYS) if (trait?.[key] !== undefined) out[key] = trait[key];
  return out;
}

function cleanTransform(t) {
  if (!t || typeof t !== 'object') return null;
  const out = { name: String(t.name ?? 'Трансформация'), cost: Math.min(MAX_ENERGY, Math.max(0, t.cost ?? 2)) };
  for (const key of ['hp', 'attack', 'speed']) if (Number.isSafeInteger(t[key])) out[key] = t[key];
  if (t.skill) out.skill = cleanSkill(t.skill);
  if (t.ultimate) out.ultimate = cleanSkill(t.ultimate);
  if (t.trait) out.trait = cleanTrait(t.trait);
  if (t.effect) out.effect = { ...cleanSkill(t.effect), cost: 0 };
  if (typeof t.look === 'string') out.look = t.look;
  return out;
}

export function battleStats(card, competitive = false) {
  const stats = {
    id: card.id,
    hp: competitive ? (card.baseHp ?? card.maxHp ?? card.hp) : (card.maxHp ?? card.hp),
    attack: competitive ? (card.baseAttack ?? card.attack) : card.attack,
    speed: cleanSpeed(card.speed),
    skill: cleanSkill(card.skill),
  };
  if (card.ultimate) stats.ultimate = cleanSkill(card.ultimate);
  if (card.trait && Object.keys(cleanTrait(card.trait)).length) stats.trait = cleanTrait(card.trait);
  if (card.transform) stats.transform = cleanTransform(card.transform);
  return stats;
}

function newFighter(card) {
  if (!Number.isSafeInteger(card.hp) || !Number.isSafeInteger(card.attack) || card.hp < 1 || card.attack < 1) {
    throw new RangeError('Некорректные характеристики бойца');
  }
  const trait = cleanTrait(card.trait);
  return {
    id: card.id, hp: card.hp, maxHp: card.hp, attack: card.attack, baseAttack: card.attack, speed: cleanSpeed(card.speed),
    energy: Math.min(MAX_ENERGY, START_ENERGY + (trait.quick ?? 0)), guarding: false, shield: 0, burn: null,
    skill: cleanSkill(card.skill), ultimate: card.ultimate ? cleanSkill(card.ultimate) : null, trait, saved: false,
    // status: frozen or asleep, the fighter misses its turns; rested: it has just come round and
    // cannot be frozen or put to sleep again before its own next action.
    status: null, rested: false, toxic: 0, leech: 0,
    // primed: its first blow since it came onto the field is still to come. snacked: the one-time
    // snack is eaten.
    primed: true, snacked: false,
    transform: cleanTransform(card.transform), transformed: false,
  };
}

// Grim look: a fighter that comes onto the field lowers the attack of the one facing it.
function intimidate(state, side, event) {
  const fighter = currentFighter(state, side);
  const target = currentFighter(state, 1 - side);
  if (!fighter.trait.intimidate || fighter.hp <= 0 || target.hp <= 0 || target.trait.steady) return;
  const floor = Math.max(1, target.baseAttack - MAX_WEAKEN);
  const lowered = Math.max(floor, target.attack - fighter.trait.intimidate);
  if (lowered < target.attack) {
    target.attack = lowered;
    if (event) event.intimidated.push(fighter.id);
  }
}

// Who opens: the faster lead fighter. Equal speed falls back to `tie` (the player in wild fights,
// the room code in duels).
export function opener(teams, tie = 0) {
  const [a, b] = teams.map(team => cleanSpeed(team[0]?.speed));
  return a > b ? 0 : b > a ? 1 : tie;
}

// `tempo` gives the side that moves second one extra energy; duels between players use it.
export function startBattle(teams, first = 0, {tempo = true} = {}) {
  if (teams.length !== 2 || ![0, 1].includes(first) ||
      teams.some(team => team.length < 1 || team.length > MAX_TEAM || new Set(team.map(c => c.id)).size !== team.length)) {
    throw new RangeError('Для боя нужны две команды по 1–3 бойца');
  }
  const sides = teams.map(team => team.map(newFighter));
  if (tempo) {
    const second = sides[1 - first][0];
    second.energy = Math.min(MAX_ENERGY, second.energy + 1);
  }
  const state = {teams: sides, active: [0, 0], turn: first, moves: 0, winner: null, last: null};
  intimidate(state, first, null);
  intimidate(state, 1 - first, null);
  return state;
}

export function currentFighter(state, side) {
  return state.teams[side][state.active[side]];
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const fighter = currentFighter(state, state.turn);
  const moves = ['hit'];
  if (!fighter.guarding) moves.push('guard');
  if (fighter.energy >= fighter.skill.cost) moves.push('special');
  if (fighter.ultimate && fighter.energy >= fighter.ultimate.cost) moves.push('ultimate');
  if (fighter.transform && !fighter.transformed && fighter.energy >= fighter.transform.cost) moves.push('transform');
  state.teams[state.turn].forEach((reserve, index) => {
    if (index !== state.active[state.turn] && reserve.hp > 0) moves.push('switch:' + index);
  });
  return moves;
}

function timedWinner(teams) {
  const total = (team, key) => team.reduce((sum, fighter) => sum + fighter[key], 0);
  const left = total(teams[0], 'hp') * total(teams[1], 'maxHp');
  const right = total(teams[1], 'hp') * total(teams[0], 'maxHp');
  return left === right ? 'draw' : Number(right > left);
}

function heal(fighter, amount) {
  const healed = Math.min(fighter.maxHp - fighter.hp, Math.max(0, amount));
  fighter.hp += healed;
  return healed;
}

// Rage adds to a hurt fighter's blows. Guard halves a blow that does not pierce, armour then
// trims it (never below 1), and a shield soaks what is left. Any blow clears guard, and a blow
// that lands wakes a sleeping fighter.
function strike(event, attacker, target, amount, pierce) {
  let damage = Math.max(0, amount);
  if (attacker.trait.rage && attacker.hp * 2 <= attacker.maxHp) {
    damage += attacker.trait.rage;
    event.rage = true;
  }
  // Opener: the first blow since the fighter came onto the field.
  if (attacker.primed && attacker.trait.opener && damage > 0) {
    damage += attacker.trait.opener;
    event.opener = true;
  }
  attacker.primed = false;
  // Fresh: a fighter at full health takes half.
  if (target.trait.fresh && target.hp === target.maxHp && damage > 0) {
    damage = Math.ceil(damage / 2);
    event.fresh = true;
  }
  if (target.guarding && !pierce) {
    damage = Math.ceil(damage / 2);
    event.blocked = true;
  }
  target.guarding = false;
  if (target.trait.armor && !pierce && damage > 0) {
    const trimmed = Math.max(1, damage - target.trait.armor);
    event.armored += damage - trimmed;
    damage = trimmed;
  }
  let soaked = 0;
  if (target.shield > 0 && damage > 0) {
    soaked = Math.min(target.shield, damage);
    target.shield -= soaked;
    damage -= soaked;
    event.absorbed += soaked;
  }
  let dealt = Math.min(target.hp, damage);
  // Last stand: the first blow that would knock the fighter out leaves it on 1 HP instead.
  if (dealt === target.hp && target.trait.laststand && !target.saved) {
    dealt -= 1;
    target.saved = true;
    event.saved = true;
  }
  target.hp -= dealt;
  if (target.status?.kind === 'sleep' && (dealt > 0 || soaked > 0)) {
    target.status = null;
    target.rested = true;
    event.effects.push('wake');
  }
  if (target.trait.thorns && (dealt > 0 || soaked > 0) && attacker.hp > 1) {
    const prick = Math.min(target.trait.thorns, attacker.hp - 1);
    attacker.hp -= prick;
    event.thorns += prick;
  }
  // Parting gift: knocked out, the fighter still bites the one who did it.
  if (target.hp <= 0 && target.trait.parting && attacker.hp > 1) {
    const bite = Math.min(target.trait.parting, attacker.hp - 1);
    attacker.hp -= bite;
    event.parting = (event.parting ?? 0) + bite;
  }
  snack(target, event, 1 - event.side);
  return dealt;
}

// Snack: once per battle, at half health or below, the fighter eats and restores some HP.
function snack(fighter, record, side) {
  if (!fighter.trait.snack || fighter.snacked || fighter.hp <= 0 || fighter.hp * 2 > fighter.maxHp) return;
  fighter.snacked = true;
  record.snack = (record.snack ?? 0) + heal(fighter, fighter.trait.snack);
  // Who ate: the side of each fighter that had its snack in this event.
  (record.snackSides ??= []).push(side);
}

// Frozen or asleep, a fighter misses its turns. A fighter that has just come round is alert
// until its own next action, so no one can keep it locked for good.
function immobilize(event, target, kind, turns) {
  if (target.hp <= 0 || target.status || target.rested) return;
  if (target.trait.pure) {
    event.effects.push('immune');
    return;
  }
  target.status = { kind, turns };
  event.effects.push(kind);
}

// Burning, heartburn and draining hurt after the fighter's own turn (or the turn it missed).
// Draining heals whoever stands on the other side.
function tick(state, side, fighter, record) {
  if (fighter.burn && fighter.hp > 0) {
    const loss = Math.min(fighter.hp, fighter.burn.dmg);
    fighter.hp -= loss;
    record.burned += loss;
    fighter.burn = fighter.burn.turns > 1 ? { ...fighter.burn, turns: fighter.burn.turns - 1 } : null;
  }
  if (fighter.toxic && fighter.hp > 0) {
    const loss = Math.min(fighter.hp, fighter.toxic);
    fighter.hp -= loss;
    record.poisoned += loss;
    fighter.toxic = Math.min(MAX_TOXIC, fighter.toxic + 1);
  }
  if (fighter.leech && fighter.hp > 0) {
    const loss = Math.min(fighter.hp, fighter.leech);
    fighter.hp -= loss;
    record.leeched += loss;
    const drinker = currentFighter(state, 1 - side);
    if (drinker.hp > 0) record.leechHeal += heal(drinker, loss);
  }
  snack(fighter, record, side);
  if (fighter.hp <= 0 && currentFighter(state, side) === fighter) settleKnockout(state, side);
}

// A knocked-out fighter is replaced by the first living reserve; with none left the other side wins.
function settleKnockout(state, side) {
  if (currentFighter(state, side).hp > 0) return;
  state.last.ko.push(currentFighter(state, side).id);
  const next = state.teams[side].findIndex(reserve => reserve.hp > 0);
  if (next === -1) state.winner = 1 - side;
  else {
    state.active[side] = next;
    state.last.entered[side] = state.teams[side][next].id;
    state.teams[side][next].primed = true;
    intimidate(state, side, state.last);
  }
}

// Total base damage shown on the card, before each strike's talents, armour and shield.
export function skillDamage(skill, attack) {
  return Math.max(0, Math.round(attack + skill.power));
}

function useSkill(state, event, fighter, target, skill) {
  fighter.energy -= skill.cost;
  event.skill = skill.name;
  if (skill.shatter && (target.shield > 0 || target.guarding)) {
    target.shield = 0;
    target.guarding = false;
    event.effects.push('shatter');
  }
  // A clean wipe: the target loses its attack boosts, shield and guard before the blow.
  if (skill.purge && (target.shield > 0 || target.guarding || target.attack > target.baseAttack)) {
    target.shield = 0;
    target.guarding = false;
    target.attack = Math.min(target.attack, target.baseAttack);
    event.effects.push('purge');
  }
  if (Number.isFinite(skill.power)) {
    const execute = target.hp * 2 <= target.maxHp ? skill.execute ?? 0 : 0;
    if (execute) event.executed = true;
    const amount = skillDamage(skill, fighter.attack + execute);
    // A flurry splits the blow into separate strikes: guard softens only the first, armour every
    // one, and a second strike gets through a last stand.
    const hits = Math.min(4, Math.max(1, skill.hits ?? 1));
    if (hits === 1) event.damage = strike(event, fighter, target, amount, skill.pierce);
    else {
      const each = Math.floor(amount / hits), remainder = amount % hits;
      for (let i = 0; i < hits && target.hp > 0; i++) {
        event.damage += strike(event, fighter, target, each + (i < remainder ? 1 : 0), skill.pierce);
        event.hits++;
      }
    }
    if (skill.drain) event.heal += heal(fighter, Math.ceil(event.damage / 2));
  }
  // Fire thaws a frozen fighter, whether it catches fire or not.
  if (skill.burn && target.status?.kind === 'freeze') {
    target.status = null;
    target.rested = true;
    event.effects.push('thaw');
  }
  if (skill.burn && target.hp > 0 && !target.trait.fireproof && !target.trait.pure) {
    target.burn = { dmg: skill.burn.dmg, turns: skill.burn.turns };
    event.effects.push('burn');
  }
  if (skill.toxic && target.hp > 0 && !target.toxic) {
    if (target.trait.pure) event.effects.push('immune');
    else { target.toxic = 1; event.effects.push('toxic'); }
  }
  if (skill.leech && target.hp > 0) {
    if (target.trait.pure) event.effects.push('immune');
    else { target.leech = Math.max(target.leech, skill.leech); event.effects.push('leech'); }
  }
  if (skill.freeze) immobilize(event, target, 'freeze', 1);
  if (skill.sleep) immobilize(event, target, 'sleep', Math.min(2, Math.max(1, skill.sleep)));
  if (skill.weaken && target.hp > 0 && !target.trait.steady) {
    const floor = Math.max(1, target.baseAttack - MAX_WEAKEN);
    const lowered = Math.max(floor, target.attack - skill.weaken);
    if (lowered < target.attack) event.effects.push('weaken');
    target.attack = lowered;
  }
  if (skill.sap && target.energy > 0 && !target.trait.steady) {
    target.energy = 0;
    event.effects.push('sap');
  }
  if (skill.heal) event.heal += heal(fighter, skill.heal);
  if (skill.team) {
    for (const ally of state.teams[event.side]) {
      if (ally.hp > 0) event.heal += heal(ally, skill.team);
    }
    event.effects.push('team');
  }
  if (skill.shield) {
    fighter.shield = Math.max(fighter.shield, skill.shield);
    event.effects.push('shield');
  }
  if (skill.buff) {
    fighter.attack = Math.min(fighter.baseAttack + MAX_BUFF, fighter.attack + skill.buff);
    event.effects.push('buff');
  }
  if (skill.cleanse && (fighter.burn || fighter.toxic || fighter.leech)) {
    fighter.burn = null;
    fighter.toxic = 0;
    fighter.leech = 0;
    event.effects.push('cleanse');
  }
  if (skill.charge && fighter.energy < MAX_ENERGY) {
    fighter.energy = Math.min(MAX_ENERGY, fighter.energy + skill.charge);
    event.effects.push('charge');
  }
  if (skill.recoil) {
    const taken = Math.min(skill.recoil, fighter.hp - 1);
    fighter.hp -= taken;
    event.recoil = taken;
  }
}

// Transformation: the fighter takes its other form for the rest of the battle. Stats are added
// to the current ones (the extra health heals too), a new skill, super move or talent replaces the
// old one, and the change itself acts at once like a free skill.
function transform(state, event, fighter, target) {
  const form = fighter.transform;
  fighter.energy -= form.cost;
  fighter.transformed = true;
  event.transformed = form.name;
  event.effects.push('transform');
  if (form.hp) {
    fighter.maxHp = Math.max(1, fighter.maxHp + form.hp);
    fighter.hp = Math.max(1, Math.min(fighter.maxHp, fighter.hp + Math.max(0, form.hp)));
  }
  if (form.attack) {
    fighter.baseAttack = Math.max(1, fighter.baseAttack + form.attack);
    fighter.attack = Math.max(1, fighter.attack + form.attack);
  }
  if (form.speed) fighter.speed = cleanSpeed(fighter.speed + form.speed);
  // New objects even when unchanged: the computer player caches per skill object.
  fighter.skill = { ...(form.skill ?? fighter.skill) };
  if (form.ultimate) fighter.ultimate = { ...form.ultimate };
  if (form.trait) fighter.trait = { ...form.trait };
  if (form.effect) {
    useSkill(state, event, fighter, target, form.effect);
    event.skill = form.name;
  }
}

// A move is a command, never a damage value or a remote state snapshot.
export function applyMove(previous, side, command) {
  if (side !== previous.turn || !legalMoves(previous).includes(command)) return null;
  const other = 1 - side;
  const state = {
    ...previous, turn: other, moves: previous.moves + 1,
    teams: previous.teams.map(team => team.map(fighter => ({
      ...fighter, burn: fighter.burn && { ...fighter.burn }, status: fighter.status && { ...fighter.status },
    }))),
    active: [...previous.active],
  };
  const fighter = currentFighter(state, side);
  const target = currentFighter(state, other);
  const event = {
    side, command, fighter: fighter.id, target: target.id, damage: 0, heal: 0, hits: 0,
    blocked: false, absorbed: 0, armored: 0, thorns: 0, rage: false, saved: false, regen: 0, executed: false, recoil: 0,
    burned: 0, poisoned: 0, leeched: 0, leechHeal: 0,
    skill: null, effects: [], ko: [], entered: [null, null], intimidated: [], skips: [],
  };
  state.last = event;
  fighter.rested = false;
  if (command.startsWith('switch:')) {
    // Heartburn and draining stay behind with the fighter who leaves.
    fighter.toxic = 0;
    fighter.leech = 0;
    // Refresh: a fighter that leaves the field catches its breath.
    if (fighter.trait.refresh && fighter.hp > 0) event.refresh = heal(fighter, fighter.trait.refresh);
    state.active[side] = Number(command.slice(7));
    const incoming = currentFighter(state, side);
    incoming.primed = true;
    event.target = incoming.id;
    event.entered[side] = event.target;
    intimidate(state, side, event);
  } else if (command === 'guard') {
    fighter.guarding = true;
    fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 1);
  } else if (command === 'special' || command === 'ultimate') {
    useSkill(state, event, fighter, target, command === 'special' ? fighter.skill : fighter.ultimate);
  } else if (command === 'transform') {
    transform(state, event, fighter, target);
  } else {
    // Breaker: plain hits go through guard.
    event.damage = strike(event, fighter, target, fighter.attack, Boolean(fighter.trait.breaker));
    if (fighter.trait.vamp && event.damage > 0) event.heal += heal(fighter, fighter.trait.vamp);
    fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 1);
  }
  const before = event.ko.length;
  settleKnockout(state, other);
  // Moxie: knocking out an opposing fighter raises the fighter's attack.
  if (fighter.trait.moxie && event.ko.length > before && fighter.hp > 0) {
    const raised = Math.min(fighter.baseAttack + MAX_BUFF, fighter.attack + fighter.trait.moxie);
    if (raised > fighter.attack) { fighter.attack = raised; event.moxie = true; }
  }
  // Regeneration follows the fighter's own action; a burning fighter does not regenerate.
  if (fighter.trait.regen && fighter.hp > 0 && !fighter.burn && !command.startsWith('switch:') && state.winner === null) {
    event.regen = heal(fighter, fighter.trait.regen);
    event.heal += event.regen;
  }
  // Burning, heartburn and draining hurt after the fighter's own action. Switching out pauses them.
  if (state.winner === null && !command.startsWith('switch:') && fighter.hp > 0) tick(state, side, fighter, event);
  // A fresh fighter after a knockout starts a new exchange: the faster of the two moves first.
  const fresh = () => {
    if (state.winner === null && event.ko.length) {
      const [a, b] = [currentFighter(state, 0).speed, currentFighter(state, 1).speed];
      if (a !== b) state.turn = a > b ? 0 : 1;
    }
  };
  fresh();
  // A frozen or sleeping fighter misses its turn right away: the engine plays the skip itself, so
  // both duel peers see the same thing and the player never has to press a dead button.
  for (let guard = 0; guard < 4 && state.winner === null; guard++) {
    const idle = currentFighter(state, state.turn);
    if (!idle.status) break;
    const skip = { side: state.turn, id: idle.id, kind: idle.status.kind, burned: 0, poisoned: 0, leeched: 0, leechHeal: 0, recovered: false };
    event.skips.push(skip);
    idle.status = idle.status.turns > 1 ? { ...idle.status, turns: idle.status.turns - 1 } : null;
    skip.recovered = !idle.status;
    idle.rested = true;
    const knocked = event.ko.length;
    tick(state, state.turn, idle, skip);
    state.turn = 1 - state.turn;
    if (event.ko.length > knocked) fresh();
  }
  if (state.moves === MAX_TURNS && state.winner === null) state.winner = timedWinner(state.teams);
  return state;
}

// The computer opponent: finishes when it can, saves itself when hurt, otherwise presses.
export function botMove(state, random = Math.random) {
  const fighter = currentFighter(state, state.turn);
  const opponent = currentFighter(state, 1 - state.turn);
  const moves = legalMoves(state);
  const skill = fighter.skill;
  const canSkill = moves.includes('special');
  if (moves.includes('ultimate')) return 'ultimate';
  // A fighter with a super move sometimes holds its energy to reach it.
  const saving = fighter.ultimate && random() < 0.5;
  const hitDamage = opponent.guarding ? Math.ceil(fighter.attack / 2) : fighter.attack;
  if (hitDamage >= opponent.hp + opponent.shield) return 'hit';
  if (canSkill && !saving) {
    const hurt = fighter.hp * 2 <= fighter.maxHp;
    // Statuses first: they pay off over several turns.
    if ((skill.freeze || skill.sleep) && !opponent.status && !opponent.rested) return 'special';
    if ((skill.toxic && !opponent.toxic) || (skill.leech && !opponent.leech)) return 'special';
    // A sleeping opponent is not worth waking with a weak blow when the move heals or builds up.
    if (opponent.status?.kind === 'sleep' && !Number.isFinite(skill.power) && (skill.heal || skill.shield || skill.buff || skill.charge)) return 'special';
    if (Number.isFinite(skill.power)) return 'special';
    if ((skill.heal || skill.team) && (hurt || fighter.energy >= MAX_ENERGY)) return 'special';
    if (skill.shield && fighter.shield === 0) return 'special';
  }
  if (moves.includes('guard') && opponent.energy >= opponent.skill.cost && random() < 0.35) return 'guard';
  return 'hit';
}
