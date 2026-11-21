import { applyMove, battleStats, MAX_TEAM, MAX_TURNS, opener, startBattle, validTeam } from './duel-engine.js';

const MAX_LEVEL = 10;
// Levels of a team as sent by a peer: one integer 1–10 per fighter of that team, nothing else.
function cleanLevels(levels, team) {
  if (!Array.isArray(team) || !levels || typeof levels !== 'object') return null;
  const out = {};
  for (const id of team) {
    const level = levels[id];
    if (!Number.isSafeInteger(level) || level < 1 || level > MAX_LEVEL) return null;
    out[id] = level;
  }
  return out;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Version 5 can restore a bound match and deliver its terminal journal after a long outage.
export const DUEL_PROTOCOL = 5;
export const SILENT_MS = 12_000;
export const RECONNECT_MS = 25_000;

export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map(byte => ALPHABET[byte & 31]).join('');
}

export function parseRoomCode(value) {
  const text = String(value ?? '').trim();
  const fragment = /(?:^|#)duel=([^&]+)/i.exec(text);
  const code = (fragment ? fragment[1] : text).replace(/[\s-]/g, '').toUpperCase();
  return code.length === 10 && [...code].every(letter => ALPHABET.includes(letter)) ? code : null;
}

function sameTeam(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((id, index) => id === right[index]);
}

function validMatchId(id) {
  return typeof id === 'string' && id.length >= 8 && id.length <= 64 &&
    !/[\u0000-\u001f\u007f]/u.test(id) && !Object.hasOwn(Object.prototype, id) && id !== 'prototype';
}

function validHistory(history) {
  return Array.isArray(history) && history.length <= MAX_TURNS;
}

function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// The engine is immutable. A bad command anywhere in the suffix discards the entire update.
function replay(state, commands, author = null) {
  for (const command of commands) {
    if (author !== null && author !== state.turn) return null;
    state = applyMove(state, state.turn, command);
    if (!state) return null;
  }
  return state;
}

export class DuelRoom {
  // `levelCard(card, level)` builds a card at a level (game.js cardFor); without it levels never count.
  constructor({ code, role, cards, send, onChange, now = Date.now, makeId = () => crypto.randomUUID(), levelCard = null, persistMove = null }) {
    this.code = code;
    this.side = role === 'host' ? 0 : 1;
    this.catalog = new Map(cards.map(card => [card.id, card]));
    this.send = send;
    this.onChange = onChange;
    this.persistMove = persistMove;
    this.now = now;
    this.makeId = makeId;
    this.known = new Set();
    this.peer = null;
    this.team = null;
    this.teamLevels = null;
    this.peerTeam = null;
    this.matchId = null;
    this.state = null;
    this.history = [];
    this.confirmed = 0;
    this.peerHasState = false;
    this.lastSeen = 0;
    this.lostAt = null;
    this.pending = false;
    this.reason = null;
    this.peerHasFinal = false;
    // The level equaliser: on by default. Real levels count only when both players turned it off.
    this.levelCard = levelCard;
    this.fair = true;
    this.peerFair = true;
    this.peerLevels = null;
    this.leveled = false;
    this.revision = 0;
    this.peerRevision = -1;
  }

  // Before the own team is confirmed the player may switch the equaliser; the peer is told at once.
  setFair(fair) {
    if (this.team || this.matchId || this.reason || !this.levelCard) return false;
    if (this.fair === Boolean(fair)) return true;
    this.fair = Boolean(fair);
    this.revision++;
    this.hello(this.peer);
    this.onChange();
    return true;
  }

  get equalized() {
    return this.fair || this.peerFair || !this.levelCard;
  }

  get finished() {
    return !!this.state && this.state.winner !== null;
  }

  get actionable() {
    return !!this.state && this.peerHasState && !this.reason && this.lostAt === null &&
      this.state.winner === null && this.state.turn === this.side;
  }

  packet(peer, body) {
    if (peer) this.send(peer, { v: DUEL_PROTOCOL, side: this.side, ...body });
  }

  hello(peer) {
    // Introduce the seat first. A lineup can start a match at the other end, so send it
    // only after the local ready checkpoint names the same authenticated peer.
    if (peer !== this.peer) {
      this.packet(peer, { kind: 'hello', revision: 0, team: null, fair: true, levels: null });
      return;
    }
    this.packet(peer, { kind: 'hello', revision: this.revision, team: this.team, fair: this.fair, levels: this.fair ? null : this.teamLevels });
  }

  ready(ids) {
    if (this.team || this.reason || !validTeam(ids, this.catalog)) return false;
    const levels = Object.fromEntries(ids.map(id => [id, this.catalog.get(id).level ?? 1]));
    if (!cleanLevels(levels, ids)) return false;
    this.team = [...ids];
    this.teamLevels = levels;
    this.revision++;
    this.onChange();
    this.hello(this.peer);
    this.startIfHost();
    return true;
  }

  contact(peer) {
    if (!peer || (this.peer && peer !== this.peer)) return;
    this.known.add(peer);
    this.hello(peer);
    if (peer === this.peer) this.sync();
  }

  disconnect(peer) {
    this.known.delete(peer);
    if (peer !== this.peer || this.lostAt !== null || this.reason) return;
    this.lostAt = this.now();
    this.onChange();
  }

  cancel(reason = 'left', notify = true) {
    if (this.reason || this.finished) return;
    // Our own leave or timeout with a confirmed lineup only pauses: the peer may already have
    // accepted it even if its first state never arrived. A stop from the peer pauses only a running
    // match; before it, a peer that leaves has no match to come back to.
    if (this.team && this.peer && (reason === 'left' || reason === 'timeout') && (notify || this.matchId)) {
      this.disconnect(this.peer);
      return;
    }
    this.reason = reason;
    this.onChange();
    if (notify) this.packet(this.peer, { kind: 'stop', matchId: this.matchId, reason });
  }

  rejectVersion(peer, version, matchId = this.matchId) {
    this.peer ??= peer;
    this.cancel('version', false);
    // A legacy client accepts a stop only after a hello in its own protocol from the other seat.
    const header = { v: version, side: this.side };
    this.send(peer, { ...header, kind: 'hello', revision: 0, team: null, fair: true, levels: null });
    this.send(peer, { ...header, kind: 'stop', matchId, reason: 'version' });
  }

  acceptsTeam(team, peer, matchId = this.matchId) {
    if (validTeam(team, this.catalog)) return true;
    if (Array.isArray(team) && team.length >= 1 && team.length <= MAX_TEAM &&
        team.every(id => typeof id === 'string') && team.some(id => !this.catalog.has(id))) {
      this.rejectVersion(peer, DUEL_PROTOCOL, matchId);
    }
    return false;
  }

  // Both devices build all statistics from their own catalog. Only item IDs cross the connection.
  // With the equaliser on, every fighter fights at its base (level 1) numbers; off on both sides,
  // each fighter at the level its owner sent.
  setup(teams, leveled = false, levels = null) {
    const size = Math.min(...teams.map(team => team.length));
    const stats = teams.map((team, t) => team.slice(0, size).map(id => {
      const card = this.catalog.get(id);
      return leveled ? battleStats(this.levelCard(card, levels[t][id]), false) : battleStats(card, true);
    }));
    // The faster lead fighter opens; on equal speed the room code decides.
    const first = opener(stats, ALPHABET.indexOf(this.code.at(-1)) % 2);
    return { signature: JSON.stringify(stats), state: startBattle(stats, first) };
  }

  // Rebuild the initial position using the levels locked at readiness, even if rewards have
  // since raised the level in this device's collection.
  readSetup(record) {
    if (!validMatchId(record.matchId) || !Array.isArray(record.teams) || record.teams.length !== 2 ||
        !record.teams.every(team => validTeam(team, this.catalog)) || typeof record.leveled !== 'boolean') return null;
    const teams = record.teams.map(team => [...team]);
    let levels = null;
    if (record.leveled) {
      if (!this.levelCard || !Array.isArray(record.levels) || record.levels.length !== 2) return null;
      levels = teams.map((team, side) => cleanLevels(record.levels[side], team));
      if (levels.some(level => !level)) return null;
    } else if (record.levels != null) return null;
    const setup = this.setup(teams, record.leveled, levels);
    if (setup.signature !== record.signature) return null;
    return { ...setup, teams, levels, leveled: record.leveled, matchId: record.matchId };
  }

  snapshot() {
    if (!this.peer || !this.team || (this.reason && !(this.matchId && this.reason === 'quit'))) return null;
    const common = {
      v: DUEL_PROTOCOL, code: this.code, side: this.side, peer: this.peer, matchId: this.matchId,
      fair: this.fair, peerFair: this.peerFair, revision: this.revision, peerRevision: this.peerRevision,
      ownLevels: { ...this.teamLevels }, history: [...this.history], winner: this.state?.winner ?? null,
      peerHasFinal: this.peerHasFinal, reason: this.reason,
    };
    if (!this.matchId) return {
      ...common, phase: 'ready', team: [...this.team], peerTeam: this.peerTeam && [...this.peerTeam],
      peerLevels: this.peerLevels && { ...this.peerLevels },
    };
    return {
      ...common, phase: 'battle', teams: this.teams.map(team => [...team]), leveled: this.leveled,
      levels: this.levels?.map(side => ({ ...side })) ?? null, signature: this.signature,
    };
  }

  restoreReady(saved) {
    if (saved.matchId !== null || saved.history.length || saved.winner !== null || saved.reason !== null ||
        saved.peerHasFinal !== false || !validTeam(saved.team, this.catalog) ||
        (saved.peerTeam !== null && !validTeam(saved.peerTeam, this.catalog))) return false;
    const own = cleanLevels(saved.ownLevels, saved.team);
    const expectsLevels = saved.peerTeam !== null && !saved.peerFair;
    const remote = expectsLevels ? cleanLevels(saved.peerLevels, saved.peerTeam) : null;
    if (!own || (expectsLevels ? !remote : saved.peerLevels !== null)) return false;
    this.team = [...saved.team];
    this.teamLevels = own;
    this.peerTeam = saved.peerTeam && [...saved.peerTeam];
    this.peerLevels = remote;
    return true;
  }

  restore(saved) {
    if (this.peer || this.team || this.matchId || this.reason || !saved || saved.v !== DUEL_PROTOCOL ||
        saved.code !== this.code || saved.side !== this.side || typeof saved.peer !== 'string' ||
        !saved.peer.trim() || saved.peer.length > 128 || !validHistory(saved.history) ||
        typeof saved.fair !== 'boolean' || typeof saved.peerFair !== 'boolean' || (!saved.fair && !this.levelCard) ||
        !validRevision(saved.revision) || saved.revision === 0 || !validRevision(saved.peerRevision)) return false;
    if (saved.phase === 'ready') {
      if (!this.restoreReady(saved)) return false;
    } else {
      if (saved.phase !== 'battle' || saved.leveled !== (!saved.fair && !saved.peerFair) ||
          (saved.reason != null && saved.reason !== 'quit')) return false;
      const setup = this.readSetup(saved);
      if (!setup) return false;
      const team = setup.teams[this.side];
      const own = cleanLevels(saved.ownLevels, team);
      if (!own || (setup.leveled && team.some(id => own[id] !== setup.levels[this.side][id]))) return false;
      const state = replay(setup.state, saved.history);
      if (!state) return false;
      Object.assign(this, setup, { state, team, teamLevels: own });
      this.peerTeam = this.teams[1 - this.side];
      this.peerLevels = this.levels?.[1 - this.side] ?? null;
      this.history = [...saved.history];
      this.peerHasFinal = this.finished && saved.peerHasFinal === true;
      this.reason = this.finished ? null : saved.reason ?? null;
    }
    this.peer = saved.peer;
    this.fair = saved.fair;
    this.peerFair = saved.peerFair;
    this.revision = saved.revision;
    this.peerRevision = saved.peerRevision;
    this.lostAt = this.now();
    this.onChange();
    return true;
  }

  startIfHost() {
    if (this.side || this.matchId || !this.team || !this.peerTeam || this.reason || this.lostAt !== null) return;
    const id = this.makeId();
    if (!validMatchId(id)) return;
    this.teams = [this.team, this.peerTeam];
    this.leveled = !this.equalized;
    this.levels = this.leveled ? [this.teamLevels, this.peerLevels] : null;
    const setup = this.setup(this.teams, this.leveled, this.levels);
    this.matchId = id;
    this.signature = setup.signature;
    this.state = setup.state;
    this.onChange();
    this.sync();
  }

  sync() {
    if (!this.matchId || this.reason) return;
    this.send(this.peer, this.statePacket());
  }

  statePacket() {
    return {
      v: DUEL_PROTOCOL, side: this.side, kind: 'state', matchId: this.matchId,
      teams: this.teams.map(team => [...team]), signature: this.signature, leveled: this.leveled,
      levels: this.levels?.map(side => ({ ...side })) ?? null, history: [...this.history],
    };
  }

  finalPacket() {
    return this.finished ? this.statePacket() : null;
  }

  move(command) {
    if (!this.actionable) return false;
    const next = applyMove(this.state, this.side, command);
    if (!next) return false;
    if (this.persistMove) {
      const proposed = this.snapshot();
      proposed.history.push(command);
      proposed.winner = next.winner;
      let stored = false;
      try { stored = this.persistMove(proposed) === true; } catch { /* The seat cannot safely publish this move. */ }
      if (!stored) {
        this.onChange();
        return false;
      }
    }
    this.state = next;
    this.history.push(command);
    this.onChange();
    this.sync();
    return true;
  }

  receive(peer, data) {
    if (!peer || !data || data.side !== 1 - this.side ||
        (this.peer && peer !== this.peer)) return;
    // A hello can only bind a peer already admitted by the authenticated transport.
    if (!this.known.has(peer)) return;
    if (data.v !== DUEL_PROTOCOL) {
      if (!this.matchId && data.kind === 'hello' && Number.isSafeInteger(data.v) && data.v > 0 &&
          (!this.reason || this.reason === 'version')) this.rejectVersion(peer, data.v);
      return;
    }
    if (!this.team && peer === this.peer && this.lostAt !== null && this.now() - this.lostAt >= RECONNECT_MS) {
      this.cancel('timeout');
    }
    if (this.reason) {
      if (this.matchId && this.reason === 'quit' && data.kind === 'state' && this.receiveState(data)) return;
      if (peer === this.peer && data.kind !== 'stop') {
        const id = this.matchId ?? (data.kind === 'state' && validMatchId(data.matchId) ? data.matchId : null);
        this.packet(peer, { kind: 'stop', matchId: id, reason: this.reason });
      }
      return;
    }
    if (data.kind === 'hello') {
      if (!validRevision(data.revision)) return;
      const joined = !this.peer;
      let changed = false;
      if (!this.matchId && !this.peerTeam && data.revision > this.peerRevision) {
        if (data.team !== null && !this.acceptsTeam(data.team, peer)) return;
        const peerFair = data.fair !== false;
        const levels = !peerFair && data.team ? cleanLevels(data.levels, data.team) : null;
        if (!peerFair && data.team && !levels) { this.rejectVersion(peer, DUEL_PROTOCOL); return; }
        changed = peerFair !== this.peerFair || data.team !== null;
        this.peerRevision = data.revision;
        this.peerFair = peerFair;
        this.peerLevels = levels;
        if (data.team) this.peerTeam = [...data.team];
      }
      this.peer = peer;
      const recovered = !this.matchId && this.touch();
      if (joined || changed || recovered) this.onChange();
      if (joined) this.hello(peer);
      if (this.matchId) this.sync();
      else this.startIfHost();
      return;
    }
    if (peer !== this.peer) return;
    const quitBeforeStart = data.reason === 'quit' && data.matchId === null && !this.peerHasState && !this.history.length;
    if (data.kind === 'stop' && (!this.matchId || data.matchId === this.matchId || quitBeforeStart)) {
      if (this.finished) return;
      const reason = ['version', 'timeout', 'quit'].includes(data.reason) ? data.reason : 'left';
      this.cancel(reason, false);
    } else if (data.kind === 'state') {
      this.receiveState(data);
    }
  }

  touch() {
    const recovered = this.lostAt !== null;
    this.lastSeen = this.now();
    this.lostAt = null;
    this.pending = false;
    return recovered;
  }

  // The transport verifies the archived author's signature before handing us the packet.
  // An archive can finish an existing match. It cannot create a match or mark the peer online.
  receiveArchive(peer, data) {
    if (!this.matchId || (this.reason && this.reason !== 'quit') || peer !== this.peer || !data || data.v !== DUEL_PROTOCOL ||
        data.side !== 1 - this.side || data.kind !== 'state') return false;
    return this.receiveState(data, true);
  }

  receiveState(data, archived = false) {
    if (!validHistory(data.history) || !validMatchId(data.matchId) || !this.team) return false;
    let setup;
    if (!this.matchId) {
      if (!this.side || !Array.isArray(data.teams) || data.teams.length !== 2 ||
          !this.acceptsTeam(data.teams[0], this.peer, data.matchId) || !sameTeam(data.teams[1], this.team) ||
          (this.peerTeam && !sameTeam(data.teams[0], this.peerTeam))) return false;
      setup = this.readSetup(data);
      if (!setup || (this.peerTeam && setup.leveled === this.equalized) ||
          (setup.leveled && (this.fair || JSON.stringify(setup.levels[1]) !== JSON.stringify(this.teamLevels) ||
            (this.peerTeam && JSON.stringify(setup.levels[0]) !== JSON.stringify(this.peerLevels))))) {
        this.rejectVersion(this.peer, DUEL_PROTOCOL, data.matchId);
        return false;
      }
    } else if (data.matchId !== this.matchId || data.signature !== this.signature ||
        data.leveled !== this.leveled || !Array.isArray(data.teams) || data.teams.length !== 2 ||
        !this.teams.every((team, s) => sameTeam(team, data.teams[s])) ||
        (this.leveled ? !Array.isArray(data.levels) || data.levels.length !== 2 ||
          !this.teams.every((team, s) => team.every(id => this.levels[s][id] === data.levels[s]?.[id]))
          : data.levels != null)) {
      return false;
    }
    const common = Math.min(this.history.length, data.history.length);
    for (let index = 0; index < common; index++) {
      if (data.history[index] !== this.history[index]) return false;
    }
    const extra = data.history.length - this.history.length;
    const suffix = data.history.slice(this.history.length);
    const next = replay(setup?.state ?? this.state, suffix, 1 - this.side);
    if (!next) return false;
    const terminal = extra >= 0 && next.winner !== null;
    if ((archived || this.reason === 'quit') && !terminal) return false;

    if (setup) {
      Object.assign(this, setup);
      // With our equaliser off, the agreed setup also conveys the host's final preference
      // when its ready hello arrived out of order.
      if (!this.fair) this.peerFair = !this.leveled;
      this.peerTeam = this.teams[0];
      if (this.leveled) {
        this.peerFair = false;
        this.peerLevels = this.levels[0];
      }
    }
    this.state = next;
    this.history.push(...suffix);
    const oldConfirmed = this.confirmed;
    const firstReceipt = terminal && !this.peerHasFinal;
    const firstState = !this.peerHasState;
    this.peerHasState = true;
    this.confirmed = Math.max(this.confirmed, data.history.length);
    if (terminal) {
      this.peerHasFinal = true;
      this.reason = null;
    }
    // A shorter journal can prompt a resend but cannot unlock play in a restored room.
    const recovered = !archived && extra >= 0 && this.touch();
    if (firstState || extra > 0 || firstReceipt || recovered || oldConfirmed !== this.confirmed) this.onChange();
    if (!archived && (setup || extra !== 0 || firstReceipt)) this.sync();
    return true;
  }

  tick() {
    if (this.reason) return;
    const now = this.now();
    if (this.peer && !this.peerHasFinal && this.lostAt === null && now - this.lastSeen >= SILENT_MS) {
      this.lostAt = this.lastSeen + SILENT_MS;
      this.onChange();
    }
    if (this.lostAt !== null && now - this.lostAt >= RECONNECT_MS) {
      if (!this.team) { this.cancel('timeout'); return; }
      if (!this.pending) {
        this.pending = true;
        this.onChange();
      }
    }
    if (!this.matchId || !this.peerHasState) {
      for (const peer of this.known) {
        if (!this.peer || peer === this.peer) this.hello(peer);
      }
    }
    this.sync();
  }
}
