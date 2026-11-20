// Frozen copy of public/js/duel-ai.js before the strength work (commit 8b779a0): the baseline
// that tournaments and tests/ai.test.mjs compare the current AI against. Do not edit; the only
// addition is the `info` option ({ depth, nodes }) for measurements, which does not change play.
// A strong opponent for 3-on-3 battles: a trainer that looks several turns ahead.
//
// Battles are deterministic, so the trainer can play out its own moves and every answer of the
// player exactly: minimax with alpha-beta pruning, iterative deepening within a time or node budget,
// and a transposition table. Leaves are scored by the fighting strength left on each side —
// health × attack per fighter (how much damage a fighter can deal before it falls), plus energy
// that will become a skill, minus damage that statuses have already booked. Swapping, guarding
// against a big move, holding energy for a super move and finishing a weakened fighter all come
// out of the search; nothing is scripted.
import { applyMove, legalMoves, MAX_ENERGY, MAX_TURNS } from '../../../public/js/duel-engine.js';

const WIN = 1e6;

// Damage a status will still do if nothing changes.
function booked(f) {
  let loss = 0;
  if (f.burn) loss += f.burn.dmg * f.burn.turns;
  if (f.toxic) for (let k = 0, t = f.toxic; k < 3; k++, t = Math.min(4, t + 1)) loss += t;
  if (f.leech) loss += f.leech * 3;
  return loss;
}

export const WEIGHTS = Object.freeze({ energy: 0.6, ultimate: 1.5, guard: 0.4, power: 1, tempo: 0.02, regen: 2, laststand: 6 });

function fighterStrength(f, active, w) {
  if (f.hp <= 0) return 0;
  let hp = Math.max(1, f.hp - booked(f)) + f.shield;
  if (f.trait.laststand && !f.saved) hp += Math.min(w.laststand, f.attack);
  if (f.trait.regen) hp += f.trait.regen * w.regen;
  let attack = f.attack + (f.trait.rage && f.hp * 2 <= f.maxHp ? f.trait.rage : 0);
  // Energy is a skill or a super move waiting to happen.
  attack += f.energy * w.energy + (f.ultimate && f.energy >= MAX_ENERGY ? w.ultimate : 0);
  if (active && f.guarding) hp += f.attack * w.guard;
  // A frozen or sleeping fighter gives its opponent free turns.
  if (active && f.status) attack *= f.status.kind === 'freeze' ? 0.75 : 1 - 0.18 * f.status.turns;
  return (hp * attack) ** w.power;
}

export function evaluate(state, side, w = WEIGHTS) {
  if (state.winner !== null) return state.winner === 'draw' ? 0 : state.winner === side ? WIN - state.moves : -WIN + state.moves;
  let mine = 0, theirs = 0;
  state.teams.forEach((team, s) => team.forEach((f, i) => {
    const v = fighterStrength(f, state.active[s] === i, w);
    if (s === side) mine += v; else theirs += v;
  }));
  // Normalised so the scale does not depend on levels; the side to move keeps a small edge.
  const total = mine + theirs || 1;
  return (mine - theirs) / total + (state.turn === side ? w.tempo : -w.tempo);
}

function key(state) {
  let k = state.turn + '|' + state.active[0] + state.active[1] + '|' + state.moves;
  for (const team of state.teams) for (const f of team) {
    k += '|' + f.hp + ',' + f.attack + ',' + f.energy + ',' + (f.guarding ? 1 : 0) + ',' + f.shield + ',' +
      (f.burn ? f.burn.dmg + 'x' + f.burn.turns : '') + ',' + (f.status ? f.status.kind[0] + f.status.turns : '') +
      (f.rested ? 'r' : '') + f.toxic + ',' + f.leech + (f.saved ? 's' : '');
  }
  return k;
}

// Likely-good moves first, so alpha-beta cuts more.
const ORDER = { ultimate: 0, special: 1, hit: 2, guard: 3 };
function ordered(moves, best) {
  return [...moves].sort((a, b) => (a === best ? -1 : b === best ? 1 : (ORDER[a] ?? 4) - (ORDER[b] ?? 4)));
}

/**
 * Best move for `side` (whose turn it is). Options:
 *   timeMs   wall-clock budget (browser), default 120
 *   nodes    node budget (deterministic, for tests); when set, time is ignored
 *   maxDepth plies, default 12
 *   random   tie-breaker between equally good moves, default Math.random
 */
export function smartMove(state, side = state.turn, { timeMs = 120, nodes = null, maxDepth = 12, random = Math.random, weights = WEIGHTS, info = null } = {}) {
  const moves = legalMoves(state);
  if (moves.length <= 1) return moves[0];
  const table = new Map();
  const start = Date.now();
  let visited = 0, stopped = false;
  const outOfBudget = () => (nodes !== null ? visited > nodes : (visited & 255) === 0 && Date.now() - start > timeMs);

  function search(s, depth, alpha, beta) {
    visited++;
    if (stopped || outOfBudget()) { stopped = true; return evaluate(s, side, weights); }
    if (s.winner !== null || depth === 0 || s.moves >= MAX_TURNS) return evaluate(s, side, weights);
    const k = key(s);
    const hit = table.get(k);
    if (hit && hit.depth >= depth) return hit.value;
    const maximizing = s.turn === side;
    let best = maximizing ? -Infinity : Infinity, bestMove = null;
    for (const m of ordered(legalMoves(s), hit?.move)) {
      const next = applyMove(s, s.turn, m);
      // Two moves in a row (after a knockout, or a frozen opponent) do not cost a ply of the other side.
      const v = search(next, depth - 1, alpha, beta);
      if (maximizing ? v > best : v < best) { best = v; bestMove = m; }
      if (maximizing) alpha = Math.max(alpha, v); else beta = Math.min(beta, v);
      if (beta <= alpha) break;
    }
    if (!stopped) table.set(k, { depth, value: best, move: bestMove });
    return best;
  }

  let choice = moves[0], scores = null, done = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const round = [];
    for (const m of ordered(moves, choice)) {
      const v = search(applyMove(state, side, m), depth - 1, -Infinity, Infinity);
      if (stopped) break;
      round.push([m, v]);
    }
    if (stopped && round.length < moves.length) break;
    scores = round;
    done = depth;
    const top = Math.max(...round.map(([, v]) => v));
    // A sure win needs no deeper look.
    if (top >= WIN - MAX_TURNS - 1) { choice = round.find(([, v]) => v === top)[0]; break; }
    const near = round.filter(([, v]) => v >= top - 1e-9).map(([m]) => m);
    choice = near[Math.floor(random() * near.length)] ?? near[0];
    if (stopped) break;
  }
  if (info) Object.assign(info, { depth: done, nodes: visited });
  return choice;
}
