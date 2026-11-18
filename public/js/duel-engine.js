export const MAX_TURNS = 48;
export const MAX_TEAM = 3;

export function validTeam(ids, catalog) {
  return Array.isArray(ids) && ids.length >= 1 && ids.length <= MAX_TEAM &&
    new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && catalog.has(id));
}

export function battleStats(card, competitive = false) {
  return {
    id: card.id,
    hp: competitive ? (card.baseHp ?? card.maxHp ?? card.hp) : (card.maxHp ?? card.hp),
    attack: competitive ? (card.baseAttack ?? card.attack) : card.attack
  };
}

function newFighter(card) {
  if (!Number.isSafeInteger(card.hp) || !Number.isSafeInteger(card.attack) || card.hp < 1 || card.attack < 1) {
    throw new RangeError('Некорректные характеристики бойца');
  }
  return { id: card.id, hp: card.hp, maxHp: card.hp, attack: card.attack, charge: 0, guarding: false };
}

export function startBattle(teams, first = 0) {
  if (teams.length !== 2 || ![0, 1].includes(first) ||
      teams.some(team => team.length < 1 || team.length > MAX_TEAM || new Set(team.map(c => c.id)).size !== team.length)) {
    throw new RangeError('Для боя нужны две команды по 1–3 бойца');
  }
  return {
    teams: teams.map(team => team.map(newFighter)),
    active: [0, 0], turn: first, moves: 0, winner: null, last: null
  };
}

export function currentFighter(state, side) {
  return state.teams[side][state.active[side]];
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const fighter = currentFighter(state, state.turn);
  const moves = ['hit'];
  if (!fighter.guarding) moves.push('guard');
  if (fighter.charge >= 2) moves.push('special');
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

// A move is a command, never a damage value or a remote state snapshot.
export function applyMove(previous, side, command) {
  if (side !== previous.turn || !legalMoves(previous).includes(command)) return null;
  const other = 1 - side;
  const state = {
    ...previous, turn: other, moves: previous.moves + 1,
    teams: previous.teams.map(team => team.map(fighter => ({ ...fighter }))),
    active: [...previous.active]
  };
  const fighter = currentFighter(state, side);
  const target = currentFighter(state, other);
  state.last = { side, command, fighter: fighter.id, target: target.id, damage: 0 };
  if (command.startsWith('switch:')) {
    state.active[side] = Number(command.slice(7));
    state.last.target = currentFighter(state, side).id;
  } else if (command === 'guard') {
    fighter.guarding = true;
    fighter.charge = Math.min(2, fighter.charge + 1);
  } else {
    let damage = fighter.attack;
    if (command === 'special') {
      damage += 3;
      fighter.charge = 0;
    } else {
      if (target.guarding) damage = Math.ceil(damage / 2);
      fighter.charge = Math.min(2, fighter.charge + 1);
    }
    target.guarding = false;
    state.last.damage = Math.min(target.hp, damage);
    target.hp -= state.last.damage;
    if (target.hp === 0) {
      const next = state.teams[other].findIndex(reserve => reserve.hp > 0);
      if (next === -1) state.winner = side;
      else state.active[other] = next;
    }
  }
  if (state.moves === MAX_TURNS && state.winner === null) state.winner = timedWinner(state.teams);
  return state;
}

export function botMove(state) {
  const fighter = currentFighter(state, state.turn);
  const opponent = currentFighter(state, 1 - state.turn);
  if (fighter.charge >= 2) return 'special';
  if (!opponent.guarding && opponent.hp <= fighter.attack) return 'hit';
  if (!fighter.guarding && fighter.charge === 0 && state.moves % 4 === 1) return 'guard';
  return 'hit';
}
