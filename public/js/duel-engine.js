export const MAX_TURNS = 48;
export const MAX_TEAM = 3;
export const MAX_ENERGY = 3;
export const START_ENERGY = 1;
const MAX_BUFF = 4;
const MAX_WEAKEN = 3;
const SKILL_KEYS = ['name', 'cost', 'power', 'pierce', 'burn', 'heal', 'drain', 'shield', 'buff', 'weaken', 'sap', 'team', 'execute', 'recoil', 'cleanse', 'shatter'];
// Talents work on their own, without a move: one per rare, epic and legendary fighter.
export const TRAIT_KEYS = ['armor', 'thorns', 'regen', 'rage', 'fireproof', 'steady', 'quick', 'vamp', 'laststand'];

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

function cleanTrait(trait) {
  const out = {};
  for (const key of TRAIT_KEYS) if (trait?.[key] !== undefined) out[key] = trait[key];
  return out;
}

export function battleStats(card, competitive = false) {
  const stats = {
    id: card.id,
    hp: competitive ? (card.baseHp ?? card.maxHp ?? card.hp) : (card.maxHp ?? card.hp),
    attack: competitive ? (card.baseAttack ?? card.attack) : card.attack,
    skill: cleanSkill(card.skill),
  };
  if (card.ultimate) stats.ultimate = cleanSkill(card.ultimate);
  if (card.trait && Object.keys(cleanTrait(card.trait)).length) stats.trait = cleanTrait(card.trait);
  return stats;
}

function newFighter(card) {
  if (!Number.isSafeInteger(card.hp) || !Number.isSafeInteger(card.attack) || card.hp < 1 || card.attack < 1) {
    throw new RangeError('Некорректные характеристики бойца');
  }
  const trait = cleanTrait(card.trait);
  return {
    id: card.id, hp: card.hp, maxHp: card.hp, attack: card.attack, baseAttack: card.attack,
    energy: Math.min(MAX_ENERGY, START_ENERGY + (trait.quick ?? 0)), guarding: false, shield: 0, burn: null,
    skill: cleanSkill(card.skill), ultimate: card.ultimate ? cleanSkill(card.ultimate) : null, trait, saved: false,
  };
}

// `tempo` gives the side that moves second one extra energy; duels between players use it.
export function startBattle(teams, first = 0, {tempo = true} = {}) {
  if (teams.length !== 2 || ![0, 1].includes(first) ||
      teams.some(team => team.length < 1 || team.length > MAX_TEAM || new Set(team.map(c => c.id)).size !== team.length)) {
    throw new RangeError('Для боя нужны две команды по 1–3 бойца');
  }
  const sides = teams.map(team => team.map(newFighter));
  if (tempo) sides[1 - first][0].energy = START_ENERGY + 1;
  return {teams: sides, active: [0, 0], turn: first, moves: 0, winner: null, last: null};
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
// trims it (never below 1), and a shield soaks what is left. Any blow clears guard.
function strike(event, attacker, target, amount, pierce) {
  let damage = Math.max(0, amount);
  if (attacker.trait.rage && attacker.hp * 2 <= attacker.maxHp) {
    damage += attacker.trait.rage;
    event.rage = true;
  }
  if (target.guarding && !pierce) {
    damage = Math.ceil(damage / 2);
    event.blocked = true;
  }
  target.guarding = false;
  if (target.trait.armor && !pierce && damage > 0) {
    const trimmed = Math.max(1, damage - target.trait.armor);
    event.armored = damage - trimmed;
    damage = trimmed;
  }
  if (target.shield > 0 && damage > 0) {
    const soaked = Math.min(target.shield, damage);
    target.shield -= soaked;
    damage -= soaked;
    event.absorbed = soaked;
  }
  let dealt = Math.min(target.hp, damage);
  // Last stand: the first blow that would knock the fighter out leaves it on 1 HP instead.
  if (dealt === target.hp && target.trait.laststand && !target.saved) {
    dealt -= 1;
    target.saved = true;
    event.saved = true;
  }
  target.hp -= dealt;
  if (target.trait.thorns && (dealt > 0 || event.absorbed > 0) && attacker.hp > 1) {
    event.thorns = Math.min(target.trait.thorns, attacker.hp - 1);
    attacker.hp -= event.thorns;
  }
  return dealt;
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
  }
}

function useSkill(state, event, fighter, target, skill) {
  fighter.energy -= skill.cost;
  event.skill = skill.name;
  if (skill.shatter && (target.shield > 0 || target.guarding)) {
    target.shield = 0;
    target.guarding = false;
    event.effects.push('shatter');
  }
  if (Number.isFinite(skill.power)) {
    let amount = fighter.attack + skill.power;
    if (skill.execute && target.hp * 2 <= target.maxHp) {
      amount += skill.execute;
      event.executed = true;
    }
    event.damage = strike(event, fighter, target, amount, skill.pierce);
    if (skill.drain) event.heal += heal(fighter, Math.ceil(event.damage / 2));
  }
  if (skill.burn && target.hp > 0 && !target.trait.fireproof) {
    target.burn = { dmg: skill.burn.dmg, turns: skill.burn.turns };
    event.effects.push('burn');
  }
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
  if (skill.cleanse && fighter.burn) {
    fighter.burn = null;
    event.effects.push('cleanse');
  }
  if (skill.recoil) {
    const taken = Math.min(skill.recoil, fighter.hp - 1);
    fighter.hp -= taken;
    event.recoil = taken;
  }
}

// A move is a command, never a damage value or a remote state snapshot.
export function applyMove(previous, side, command) {
  if (side !== previous.turn || !legalMoves(previous).includes(command)) return null;
  const other = 1 - side;
  const state = {
    ...previous, turn: other, moves: previous.moves + 1,
    teams: previous.teams.map(team => team.map(fighter => ({ ...fighter, burn: fighter.burn && { ...fighter.burn } }))),
    active: [...previous.active],
  };
  const fighter = currentFighter(state, side);
  const target = currentFighter(state, other);
  const event = {
    side, command, fighter: fighter.id, target: target.id, damage: 0, heal: 0,
    blocked: false, absorbed: 0, armored: 0, thorns: 0, rage: false, saved: false, regen: 0, executed: false, recoil: 0, burned: 0,
    skill: null, effects: [], ko: [], entered: [null, null],
  };
  state.last = event;
  if (command.startsWith('switch:')) {
    state.active[side] = Number(command.slice(7));
    event.target = currentFighter(state, side).id;
    event.entered[side] = event.target;
  } else if (command === 'guard') {
    fighter.guarding = true;
    fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 1);
  } else if (command === 'special' || command === 'ultimate') {
    useSkill(state, event, fighter, target, command === 'special' ? fighter.skill : fighter.ultimate);
  } else {
    event.damage = strike(event, fighter, target, fighter.attack, false);
    if (fighter.trait.vamp && event.damage > 0) event.heal += heal(fighter, fighter.trait.vamp);
    fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 1);
  }
  settleKnockout(state, other);
  // Regeneration follows the fighter's own action; a burning fighter does not regenerate.
  if (fighter.trait.regen && fighter.hp > 0 && !fighter.burn && !command.startsWith('switch:') && state.winner === null) {
    event.regen = heal(fighter, fighter.trait.regen);
    event.heal += event.regen;
  }
  // Burning hurts after the burning fighter's own action. Switching out pauses it.
  if (state.winner === null && !command.startsWith('switch:') && fighter.burn && fighter.hp > 0) {
    const loss = Math.min(fighter.hp, fighter.burn.dmg);
    fighter.hp -= loss;
    event.burned = loss;
    fighter.burn = fighter.burn.turns > 1 ? { ...fighter.burn, turns: fighter.burn.turns - 1 } : null;
    settleKnockout(state, side);
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
    if (Number.isFinite(skill.power)) return 'special';
    if ((skill.heal || skill.team) && (hurt || fighter.energy >= MAX_ENERGY)) return 'special';
    if (skill.shield && fighter.shield === 0) return 'special';
  }
  if (moves.includes('guard') && opponent.energy >= opponent.skill.cost && random() < 0.35) return 'guard';
  return 'hit';
}
