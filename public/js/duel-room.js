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
// Version 4 changes combat rules and makes a completed match wait for both final receipts.
export const DUEL_PROTOCOL = 4;
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

export class DuelRoom {
  // `levelCard(card, level)` builds a card at a level (game.js cardFor); without it levels never count.
  constructor({ code, role, cards, send, onChange, now = Date.now, makeId = () => crypto.randomUUID(), levelCard = null }) {
    this.code = code;
    this.side = role === 'host' ? 0 : 1;
    this.catalog = new Map(cards.map(card => [card.id, card]));
    this.send = send;
    this.onChange = onChange;
    this.now = now;
    this.makeId = makeId;
    this.known = new Set();
    this.peer = null;
    this.team = null;
    this.peerTeam = null;
    this.matchId = null;
    this.state = null;
    this.history = [];
    this.confirmed = 0;
    this.peerHasState = false;
    this.lastSeen = 0;
    this.lostAt = null;
    this.reason = null;
    this.peerConfirmedFinal = false;
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

  ownLevels() {
    return this.team ? Object.fromEntries(this.team.map(id => [id, this.catalog.get(id)?.level ?? 1])) : null;
  }

  get equalized() {
    return this.fair || this.peerFair || !this.levelCard;
  }

  get confirmedFinal() {
    return !!this.state && this.state.winner !== null && this.confirmed === this.history.length;
  }

  get finished() {
    return this.confirmedFinal && this.peerConfirmedFinal;
  }

  get actionable() {
    return !!this.state && !this.reason && this.lostAt === null &&
      this.state.winner === null && this.state.turn === this.side;
  }

  packet(peer, body) {
    if (peer) this.send(peer, { v: DUEL_PROTOCOL, side: this.side, ...body });
  }

  hello(peer) {
    this.packet(peer, { kind: 'hello', revision: this.revision, team: this.team, fair: this.fair, levels: this.fair ? null : this.ownLevels() });
  }

  ready(ids) {
    if (this.team || this.reason || !validTeam(ids, this.catalog)) return false;
    this.team = [...ids];
    this.revision++;
    this.hello(this.peer);
    this.startIfHost();
    this.onChange();
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
    if (peer !== this.peer || this.lostAt !== null || this.reason || this.finished) return;
    this.lostAt = this.now();
    this.onChange();
  }

  cancel(reason = 'left', notify = true) {
    if (this.reason || this.finished) return;
    this.reason = reason;
    if (notify) this.packet(this.peer, { kind: 'stop', matchId: this.matchId, reason });
    this.onChange();
  }

  rejectVersion(peer, version) {
    this.peer ??= peer;
    this.cancel('version', false);
    // A legacy client accepts a stop only after a hello in its own protocol from the other seat.
    const header = { v: version, side: this.side };
    this.send(peer, { ...header, kind: 'hello', revision: 0, team: null, fair: true, levels: null });
    this.send(peer, { ...header, kind: 'stop', matchId: this.matchId, reason: 'version' });
  }

  acceptsTeam(team, peer) {
    if (validTeam(team, this.catalog)) return true;
    if (Array.isArray(team) && team.length >= 1 && team.length <= MAX_TEAM &&
        team.every(id => typeof id === 'string') && team.some(id => !this.catalog.has(id))) {
      this.rejectVersion(peer, DUEL_PROTOCOL);
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

  startIfHost() {
    if (this.side || this.matchId || !this.team || !this.peerTeam || this.reason) return;
    this.teams = [this.team, this.peerTeam];
    this.leveled = !this.equalized;
    this.levels = this.leveled ? [this.ownLevels(), this.peerLevels] : null;
    const setup = this.setup(this.teams, this.leveled, this.levels);
    this.matchId = this.makeId();
    this.signature = setup.signature;
    this.state = setup.state;
    this.sync();
  }

  sync() {
    if (!this.matchId || this.reason) return;
    this.packet(this.peer, {
      kind: 'state', matchId: this.matchId, teams: this.teams, signature: this.signature,
      leveled: this.leveled, levels: this.levels, history: [...this.history], finalAck: this.confirmedFinal
    });
  }

  move(command) {
    if (!this.actionable) return false;
    const next = applyMove(this.state, this.side, command);
    if (!next) return false;
    this.state = next;
    this.history.push(command);
    this.sync();
    this.onChange();
    return true;
  }

  receive(peer, data) {
    if (!peer || !data || data.side !== 1 - this.side ||
        (this.peer && peer !== this.peer)) return;
    // A hello can only bind a peer already admitted by the authenticated transport.
    if (!this.known.has(peer)) return;
    if (data.v !== DUEL_PROTOCOL) {
      if (data.kind === 'hello' && Number.isSafeInteger(data.v) && data.v > 0 &&
          (!this.reason || this.reason === 'version')) this.rejectVersion(peer, data.v);
      return;
    }
    if (peer === this.peer && this.lostAt !== null && this.now() - this.lostAt >= RECONNECT_MS) {
      this.cancel('timeout');
    }
    if (this.reason) {
      if (peer === this.peer && data.kind !== 'stop') {
        this.packet(peer, { kind: 'stop', matchId: this.matchId, reason: this.reason });
      }
      return;
    }
    if (data.kind === 'hello') {
      if (!Number.isSafeInteger(data.revision) || data.revision < 0) return;
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
      this.touch();
      if (joined) this.hello(peer);
      this.startIfHost();
      if (joined || changed) this.onChange();
      return;
    }
    if (peer !== this.peer) return;
    if (data.kind === 'stop' && (!data.matchId || !this.matchId || data.matchId === this.matchId)) {
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
    if (recovered) this.onChange();
  }

  receiveState(data) {
    if (!Array.isArray(data.history) || data.history.length > MAX_TURNS || !this.team ||
        typeof data.matchId !== 'string' || data.matchId.length > 64 || data.matchId.length < 8) return;
    let started = false;
    if (!this.matchId) {
      if (!this.side || !Array.isArray(data.teams) || data.teams.length !== 2 ||
          !this.acceptsTeam(data.teams[0], this.peer) || !sameTeam(data.teams[1], this.team) ||
          (this.peerTeam && !sameTeam(data.teams[0], this.peerTeam))) return;
      // Levels count only with both equalisers off; the guest checks its own levels went in as sent.
      const leveled = data.leveled === true;
      const levels = leveled && Array.isArray(data.levels) ?
        [cleanLevels(data.levels[0], data.teams[0]), cleanLevels(data.levels[1], this.team)] : null;
      if ((this.peerTeam && leveled === this.equalized) ||
          (leveled && (this.fair || !this.levelCard || !levels?.[0] ||
            JSON.stringify(levels[1]) !== JSON.stringify(this.ownLevels()) ||
            (this.peerTeam && JSON.stringify(levels[0]) !== JSON.stringify(this.peerLevels))))) {
        this.cancel('version');
        return;
      }
      const setup = this.setup(data.teams, leveled, levels);
      if (setup.signature !== data.signature) {
        this.cancel('version');
        return;
      }
      this.teams = data.teams.map(team => [...team]);
      this.peerTeam = this.teams[0];
      this.signature = setup.signature;
      this.state = setup.state;
      this.matchId = data.matchId;
      this.leveled = leveled;
      this.levels = levels;
      started = true;
    }
    if (data.matchId !== this.matchId || data.signature !== this.signature) return;
    const common = Math.min(this.history.length, data.history.length);
    for (let index = 0; index < common; index++) {
      if (data.history[index] !== this.history[index]) return;
    }
    const extra = data.history.length - this.history.length;
    // A faster fighter moves again after a knockout, so the peer can be a few moves ahead (one
    // per knockout plus one). Every one of them must be the peer's own turn.
    // Knockouts and frozen or sleeping fighters can give the peer several moves in a row.
    if (extra > MAX_TEAM + 3) return;
    for (const command of data.history.slice(this.history.length)) {
      if (this.state.turn === this.side) return;
      const next = applyMove(this.state, 1 - this.side, command);
      if (!next) return;
      this.state = next;
      this.history.push(command);
    }
    const oldConfirmed = this.confirmed;
    const wasFinished = this.finished;
    this.peerHasState = true;
    this.confirmed = Math.max(this.confirmed, data.history.length);
    if (this.confirmedFinal && data.history.length === this.history.length && data.finalAck === true) {
      this.peerConfirmedFinal = true;
    }
    this.touch();
    if (started || extra !== 0 || (this.confirmedFinal && oldConfirmed !== this.confirmed)) this.sync();
    if (started || extra > 0 || oldConfirmed !== this.confirmed || wasFinished !== this.finished) this.onChange();
  }

  tick() {
    if (this.reason) return;
    const now = this.now();
    if (this.peer && !this.finished && this.lostAt === null && now - this.lastSeen >= SILENT_MS) {
      this.lostAt = this.lastSeen + SILENT_MS;
      this.onChange();
    }
    if (this.lostAt !== null && now - this.lostAt >= RECONNECT_MS) {
      this.cancel('timeout');
      return;
    }
    if (!this.matchId || !this.peerHasState) {
      for (const peer of this.known) {
        if (!this.peer || peer === this.peer) this.hello(peer);
      }
    }
    this.sync();
  }
}
