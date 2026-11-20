// A strong opponent for 3-on-3 battles: a trainer that looks several turns ahead.
//
// Battles are deterministic, so the trainer can play out its own moves and every answer of the
// player exactly: minimax with alpha-beta pruning and principal variation search, iterative
// deepening within a time or node budget, a transposition table with bounds, and killer and
// history move ordering. Leaves are scored by two things: the fighting strength left on each side —
// health × attack per fighter (how much damage a fighter can deal before it falls), plus energy
// that will become a skill, minus damage that statuses have already booked — and a rough play-out
// of the rest of the battle, duel by duel, in which speed, turn order and the order of the
// reserves count. Swapping, guarding against a big move, holding energy for a super move and
// finishing a weakened fighter all come out of the search; nothing is scripted.
import { applyMove, legalMoves, MAX_ENERGY, MAX_TURNS } from './duel-engine.js';

const WIN = 1e6;
// Share of a team's health already lost, 0..1 (knocked-out fighters count fully).
function dealt(state, side) {
  let hp = 0, max = 0;
  for (const f of state.teams[side]) { hp += Math.max(0, f.hp); max += f.maxHp; }
  return max ? 1 - hp / max : 0;
}

// Damage a status will still do if nothing changes.
function booked(f) {
  let loss = 0;
  if (f.burn) loss += f.burn.dmg * f.burn.turns;
  if (f.toxic) for (let k = 0, t = f.toxic; k < 3; k++, t = Math.min(4, t + 1)) loss += t;
  if (f.leech) loss += f.leech * 3;
  return loss;
}

// `race` is the share of the score that comes from playing the rest of the battle out roughly.
export const WEIGHTS = Object.freeze({ energy: 0.6, ultimate: 1.5, guard: 0.4, power: 1, tempo: 0.02, regen: 2, laststand: 6, race: 0.3 });

function fighterStrength(f, active, w) {
  if (f.hp <= 0) return 0;
  let hp = Math.max(1, f.hp - booked(f)) + f.shield;
  if (f.trait.laststand && !f.saved) hp += Math.min(w.laststand, f.attack);
  if (f.trait.regen) hp += f.trait.regen * w.regen;
  // Passives: health still to come (a snack, fresh skin) and a sting on the way out.
  if (f.trait.snack && !f.snacked) hp += f.trait.snack;
  if (f.trait.fresh && f.hp === f.maxHp) hp += f.hp * 0.3;
  if (f.trait.refresh) hp += f.trait.refresh * 0.5;
  let attack = f.attack + (f.trait.rage && f.hp * 2 <= f.maxHp ? f.trait.rage : 0);
  // Energy is a skill or a super move waiting to happen.
  attack += f.energy * w.energy + (f.ultimate && f.energy >= MAX_ENERGY ? w.ultimate : 0);
  if (active && f.guarding) hp += f.attack * w.guard;
  // A frozen or sleeping fighter gives its opponent free turns.
  if (active && f.status) attack *= f.status.kind === 'freeze' ? 0.75 : 1 - 0.18 * f.status.turns;
  return w.power === 1 ? hp * attack : (hp * attack) ** w.power;
}

// What a fighter brings per action over a long fight: damage (a plain blow plus a share of its
// skill or super move, whichever pays more) and the health it restores. Skills never change during
// a battle, so this is worked out once per team line-up.
function skillExtra(f, k) {
  if (!k) return 0;
  return ((Number.isFinite(k.power) ? k.power + (k.execute ?? 0) / 2 : -f.baseAttack) +
    (k.burn ? k.burn.dmg * k.burn.turns : 0) + (k.leech ?? 0) * 3 + (k.toxic ? 6 : 0)) / (k.cost + 1);
}
const skillMend = k => (!k ? 0 : ((k.heal ?? 0) + (k.shield ?? 0) + (k.team ?? 0)) / (k.cost + 1));
const extra = [new Float64Array(3), new Float64Array(3)], mend = [new Float64Array(3), new Float64Array(3)];
const ratesOf = [[null, null, null], [null, null, null]];
function rates(teams) {
  for (let t = 0; t < 2; t++) for (let i = 0; i < teams[t].length; i++) {
    const f = teams[t][i];
    if (ratesOf[t][i] === f.skill) continue;
    ratesOf[t][i] = f.skill;
    extra[t][i] = Math.max(0, skillExtra(f, f.skill), skillExtra(f, f.ultimate));
    mend[t][i] = Math.max(skillMend(f.skill), skillMend(f.ultimate)) / 2;
  }
}

// The rest of the battle played out roughly: the fighters on the field trade blows at their
// average rates, the side to move strikes first, the loser's next fighter comes in and the faster
// fighter opens the next exchange. Returns what is left of each side as health × damage, as a
// share of all there is now.
const projHp = [new Float64Array(3), new Float64Array(3)];
function project(state, side) {
  const teams = state.teams, active = [state.active[0], state.active[1]];
  rates(teams);
  let total = 0;
  for (let t = 0; t < 2; t++) for (let i = 0; i < 3; i++) {
    const f = teams[t][i];
    projHp[t][i] = f && f.hp > 0 ? Math.max(0.5, f.hp - booked(f) + f.shield) : 0;
    if (projHp[t][i] > 0) total += projHp[t][i] * (f.attack + extra[t][i]);
  }
  let turn = state.turn;
  for (let round = 0; round < 6; round++) {
    const x = turn, y = 1 - turn, i = active[x], j = active[y];
    const a = teams[x][i], b = teams[y][j];
    const dA = Math.max(0.5, Math.max(1, a.attack + extra[x][i] - (b.trait.armor ?? 0)) - (b.trait.regen ?? 0) - mend[y][j]);
    const dB = Math.max(0.5, Math.max(1, b.attack + extra[y][j] - (a.trait.armor ?? 0)) - (a.trait.regen ?? 0) - mend[x][i]) + (b.trait.thorns ?? 0);
    const hA = projHp[x][i], hB = projHp[y][j];
    const nA = Math.ceil(hB / dA), nB = Math.ceil(hA / dB);
    let loser;
    if (nA <= nB) { projHp[x][i] = hA - (nA - 1) * dB; projHp[y][j] = 0; loser = y; }
    else { projHp[y][j] = hB - nB * dA; projHp[x][i] = 0; loser = x; }
    const hp = projHp[loser];
    const next = hp[0] > 0 ? 0 : hp[1] > 0 ? 1 : hp[2] > 0 ? 2 : -1;
    if (next === -1) break;
    active[loser] = next;
    const sa = teams[0][active[0]].speed, sb = teams[1][active[1]].speed;
    turn = sa === sb ? loser : sa > sb ? 0 : 1;
  }
  let score = 0;
  for (let t = 0; t < 2; t++) for (let i = 0; i < teams[t].length; i++) {
    if (projHp[t][i] <= 0) continue;
    const v = projHp[t][i] * (teams[t][i].attack + extra[t][i]);
    score += t === side ? v : -v;
  }
  return score / (total || 1);
}

export function evaluate(state, side, w = WEIGHTS) {
  if (state.winner !== null) {
    if (state.winner === 'draw') return 0;
    if (state.winner === side) return WIN - state.moves;
    // A lost battle is still fought: the computer takes as much of the other team with it as it can,
    // instead of stalling the end with guard after guard.
    return -WIN + 800 * dealt(state, 1 - side);
  }
  const race = w.race ?? WEIGHTS.race;
  return race ? (1 - race) * strengths(state, side, w) + race * project(state, side) : strengths(state, side, w);
}

// Fighting strength left on each side now: Σ health × attack.
function strengths(state, side, w) {
  let mine = 0, theirs = 0;
  for (let s = 0; s < 2; s++) {
    const team = state.teams[s];
    for (let i = 0; i < team.length; i++) {
      const v = fighterStrength(team[i], state.active[s] === i, w);
      if (s === side) mine += v; else theirs += v;
    }
  }
  // Normalised so the scale does not depend on levels; the side to move keeps a small edge.
  const total = mine + theirs || 1;
  return (mine - theirs) / total + (state.turn === side ? w.tempo : -w.tempo);
}

// ---- Search ---------------------------------------------------------------------------------

// Moves as small numbers, for the transposition table and the move-ordering tables.
const CODES = 7;
const code = m => (m === 'hit' ? 0 : m === 'guard' ? 1 : m === 'special' ? 2 : m === 'ultimate' ? 3 : 4 + Number(m.slice(7)));

// Two independent 32-bit hashes of everything that shapes the rest of the battle; the first picks
// the table slot, the second confirms it (a false match needs both to collide).
let h1 = 0, h2 = 0;
function hash(s) {
  let a = 0x811c9dc5 ^ (s.turn + 2 * s.active[0] + 8 * s.active[1] + 32 * s.moves), b = 0x3c6ef372 ^ Math.imul(a, 0x2545f491);
  for (let t = 0; t < 2; t++) {
    const team = s.teams[t];
    for (let i = 0; i < team.length; i++) {
      const f = team[i];
      const w1 = f.hp | f.attack << 10 | f.energy << 18 | (f.guarding ? 1 << 20 : 0) | (f.saved ? 1 << 21 : 0) |
        (f.rested ? 1 << 22 : 0) | f.toxic << 23 | f.leech << 26 | (f.transformed ? 1 << 29 : 0) | (f.primed ? 1 << 31 : 0);
      const w2 = f.shield | (f.burn ? f.burn.dmg << 8 | f.burn.turns << 14 : 0) |
        (f.status ? (f.status.kind === 'freeze' ? 1 : 2) << 18 | f.status.turns << 20 : 0) | (t * 3 + i) << 24 | (f.snacked ? 1 << 27 : 0);
      a = Math.imul(a ^ w1, 0x9e3779b1); a ^= a >>> 15; a = Math.imul(a ^ w2, 0x85ebca77); a ^= a >>> 13;
      b = Math.imul(b + w2, 0xc2b2ae3d); b ^= b >>> 16; b = Math.imul(b + w1, 0x27d4eb2f); b ^= b >>> 15;
    }
  }
  h1 = a; h2 = b;
}

// The transposition table lives in typed arrays shared by all searches; a generation stamp makes
// every call start from an empty table, so a node budget gives the same answer every time.
const TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const EXACT = 0, LOWER = 1, UPPER = 2;
let tt = null, generation = 0;
function table() {
  tt ??= { gen: new Int32Array(TT_SIZE), check: new Int32Array(TT_SIZE), value: new Float64Array(TT_SIZE),
    depth: new Int8Array(TT_SIZE), flag: new Uint8Array(TT_SIZE), move: new Int8Array(TT_SIZE) };
  generation = (generation + 1) | 0 || 1;
  return tt;
}

/**
 * Best move for `side` (whose turn it is). Options:
 *   timeMs   wall-clock budget (browser), default 120
 *   nodes    node budget (deterministic, for tests); when set, time is ignored
 *   maxDepth plies, default 48 (the whole battle)
 *   random   tie-breaker between equally good moves, default Math.random
 *   weights  evaluation weights, default WEIGHTS
 *   info     an object that receives { depth, nodes, score, ms } of the finished search
 */
export function smartMove(state, side = state.turn, { timeMs = 120, nodes = null, maxDepth = 48, random = Math.random, weights = WEIGHTS, info = null, slack = 0 } = {}) {
  const moves = legalMoves(state);
  if (moves.length <= 1) return moves[0];
  const T = table(), gen = generation;
  maxDepth = Math.min(maxDepth, 60);
  const killers = new Int8Array(128 * 2).fill(-1);
  const history = new Int32Array(2 * CODES);
  const start = Date.now();
  let visited = 0, stopped = false;
  const outOfBudget = () => (nodes !== null ? visited > nodes : (visited & 255) === 0 && Date.now() - start > timeMs);

  // Moves of this node, best first: the table's move, the two killers of this ply, then history.
  function order(list, turn, ttMove, ply) {
    const n = list.length, scores = new Array(n);
    const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const c = code(list[i]);
      scores[i] = c === ttMove ? 1e9 : c === k1 ? 1e8 : c === k2 ? 1e8 - 1 : history[turn * CODES + c] + (c < 4 ? 4 - c : 0);
    }
    for (let i = 1; i < n; i++) {
      const m = list[i], v = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < v) { scores[j + 1] = scores[j]; list[j + 1] = list[j]; j--; }
      scores[j + 1] = v; list[j + 1] = m;
    }
    return list;
  }

  function search(s, depth, alpha, beta, ply) {
    visited++;
    if (stopped || outOfBudget()) { stopped = true; return evaluate(s, side, weights); }
    if (s.winner !== null || depth <= 0 || s.moves >= MAX_TURNS) return evaluate(s, side, weights);
    hash(s);
    const slot = h1 & TT_MASK, check = h2;
    let ttMove = -1;
    if (T.gen[slot] === gen && T.check[slot] === check) {
      ttMove = T.move[slot];
      if (T.depth[slot] >= depth) {
        const v = T.value[slot], f = T.flag[slot];
        if (f === EXACT || (f === LOWER && v >= beta) || (f === UPPER && v <= alpha)) return v;
      }
    }
    const alpha0 = alpha, beta0 = beta;
    const maximizing = s.turn === side;
    const list = order(legalMoves(s), s.turn, ttMove, ply);
    let best = maximizing ? -Infinity : Infinity, bestCode = -1;
    for (let i = 0; i < list.length; i++) {
      const next = applyMove(s, s.turn, list[i]), d = depth - 1;
      let v;
      // Principal variation search: after the first move, prove the rest worse with a null window.
      if (i === 0) v = search(next, d, alpha, beta, ply + 1);
      else if (maximizing) {
        v = search(next, d, alpha, alpha + 1e-9, ply + 1);
        if (v > alpha && v < beta && !stopped) v = search(next, d, alpha, beta, ply + 1);
      } else {
        v = search(next, d, beta - 1e-9, beta, ply + 1);
        if (v < beta && v > alpha && !stopped) v = search(next, d, alpha, beta, ply + 1);
      }
      if (maximizing ? v > best : v < best) { best = v; bestCode = code(list[i]); }
      if (maximizing) { if (v > alpha) alpha = v; } else if (v < beta) beta = v;
      if (beta <= alpha) {
        if (killers[ply * 2] !== bestCode) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = bestCode; }
        history[s.turn * CODES + bestCode] += depth * depth;
        break;
      }
    }
    if (!stopped) {
      T.gen[slot] = gen; T.check[slot] = check; T.value[slot] = best; T.depth[slot] = depth; T.move[slot] = bestCode;
      T.flag[slot] = best <= alpha0 ? UPPER : best >= beta0 ? LOWER : EXACT;
    }
    return best;
  }

  let choice = moves[0], done = 0, score = 0;
  let rootOrder = [...moves];
  for (let depth = 1; depth <= maxDepth; depth++) {
    // Every move that ties the best one is searched exactly, so the tie-break can pick among them.
    // With `slack`, a move at most that much worse than the best is good enough too, and the choice
    // falls on any of them: a human-like spread among close options, never a move that clearly loses.
    let best = -Infinity, ties = [], complete = 0;
    const scored = [], near = [];
    for (const m of rootOrder) {
      const next = applyMove(state, side, m);
      let v;
      if (best === -Infinity) v = search(next, depth - 1, -Infinity, Infinity, 1);
      else {
        v = search(next, depth - 1, best - 1e-9, best + 1e-9, 1);
        if (v >= best + 1e-9 && !stopped) v = search(next, depth - 1, best, Infinity, 1);
        else if (slack > 0 && v > best - slack && !stopped) {
          // Is it within the slack? A null window at the threshold answers that cheaply.
          const t = best - slack, w = search(next, depth - 1, t - 1e-9, t + 1e-9, 1);
          if (w >= t + 1e-9 && !stopped) near.push([m, Math.min(w, v)]);
        }
      }
      if (stopped) break;
      complete++;
      scored.push([m, v]);
      if (v > best + 1e-10) { best = v; ties = [m]; } else if (v > best - 1e-10) ties.push(m);
    }
    // A cut-short depth still counts when the previous best move has been searched in it.
    if (complete > 0) {
      const pool = slack > 0 ? [...ties, ...near.filter(([m, v]) => !ties.includes(m) && v >= best - slack).map(([m]) => m)] : ties;
      choice = pool[Math.floor(random() * pool.length)] ?? ties[0];
      score = best;
      if (complete === rootOrder.length) done = depth;
    }
    if (stopped) break;
    rootOrder = [choice, ...scored.filter(([m]) => m !== choice).sort((x, y) => y[1] - x[1]).map(([m]) => m)];
    // A sure win needs no deeper look; a sure loss keeps looking for the most damage on the way.
    if (best >= WIN - MAX_TURNS - 1) break;
  }
  if (info) Object.assign(info, { depth: done, nodes: visited, score, ms: Date.now() - start });
  return choice;
}
