import { applyMove, battleStats, MAX_TURNS, startBattle, validTeam } from './duel-engine.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Version 2: fighters carry signature skills, so version-1 clients must not join.
const PROTOCOL = 2;
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
  constructor({ code, role, cards, send, onChange, now = Date.now, makeId = () => crypto.randomUUID() }) {
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
    this.settledAlone = false;
  }

  // The outcome is fixed once the last move is played. If the peer's acknowledgment never
  // arrives before the reconnect window closes, the result still stands on this device.
  get finished() {
    return !!this.state && this.state.winner !== null &&
      (this.confirmed === this.history.length || this.settledAlone);
  }

  expire() {
    if (this.state && this.state.winner !== null) {
      this.settledAlone = true;
      this.lostAt = null;
      this.onChange();
    } else this.cancel('timeout');
  }

  get actionable() {
    return !!this.state && !this.reason && this.lostAt === null &&
      this.state.winner === null && this.state.turn === this.side;
  }

  packet(peer, body) {
    if (peer) this.send(peer, { v: PROTOCOL, side: this.side, ...body });
  }

  hello(peer) {
    this.packet(peer, { kind: 'hello', team: this.team });
  }

  ready(ids) {
    if (this.team || this.reason || !validTeam(ids, this.catalog)) return false;
    this.team = [...ids];
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

  // Both devices build all statistics from their own catalog. Only item IDs cross the connection.
  setup(teams) {
    const size = Math.min(...teams.map(team => team.length));
    const stats = teams.map(team => team.slice(0, size).map(id => battleStats(this.catalog.get(id), true)));
    const first = ALPHABET.indexOf(this.code.at(-1)) % 2;
    return { signature: JSON.stringify(stats), state: startBattle(stats, first) };
  }

  startIfHost() {
    if (this.side || this.matchId || !this.team || !this.peerTeam || this.reason) return;
    this.teams = [this.team, this.peerTeam];
    const setup = this.setup(this.teams);
    this.matchId = this.makeId();
    this.signature = setup.signature;
    this.state = setup.state;
    this.sync();
  }

  sync() {
    if (!this.matchId || this.reason) return;
    this.packet(this.peer, {
      kind: 'state', matchId: this.matchId, teams: this.teams, signature: this.signature,
      history: [...this.history]
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
    if (!peer || !data || data.v !== PROTOCOL || data.side !== 1 - this.side ||
        (this.peer && peer !== this.peer)) return;
    // A hello can only bind a peer already admitted by the authenticated transport.
    if (!this.known.has(peer)) return;
    if (peer === this.peer && this.lostAt !== null && this.now() - this.lostAt >= RECONNECT_MS) {
      this.expire();
    }
    if (this.reason) {
      if (peer === this.peer && data.kind !== 'stop') {
        this.packet(peer, { kind: 'stop', matchId: this.matchId, reason: this.reason });
      }
      return;
    }
    if (data.kind === 'hello') {
      if (data.team !== null && !validTeam(data.team, this.catalog)) return;
      const joined = !this.peer;
      const newlyReady = !this.peerTeam && data.team !== null;
      this.peer = peer;
      if (newlyReady) this.peerTeam = [...data.team];
      this.touch();
      if (joined) this.hello(peer);
      this.startIfHost();
      if (joined || newlyReady) this.onChange();
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
          !validTeam(data.teams[0], this.catalog) || !sameTeam(data.teams[1], this.team) ||
          (this.peerTeam && !sameTeam(data.teams[0], this.peerTeam))) return;
      const setup = this.setup(data.teams);
      if (setup.signature !== data.signature) {
        this.cancel('version');
        return;
      }
      this.teams = data.teams.map(team => [...team]);
      this.peerTeam = this.teams[0];
      this.signature = setup.signature;
      this.state = setup.state;
      this.matchId = data.matchId;
      started = true;
    }
    if (data.matchId !== this.matchId || data.signature !== this.signature) return;
    const common = Math.min(this.history.length, data.history.length);
    for (let index = 0; index < common; index++) {
      if (data.history[index] !== this.history[index]) return;
    }
    const extra = data.history.length - this.history.length;
    if (extra > 1) return;
    if (extra === 1) {
      const command = data.history.at(-1);
      const next = applyMove(this.state, 1 - this.side, command);
      if (!next) return;
      this.state = next;
      this.history.push(command);
    }
    const oldConfirmed = this.confirmed;
    this.peerHasState = true;
    this.confirmed = Math.max(this.confirmed, data.history.length);
    this.touch();
    if (started || extra !== 0) this.sync();
    if (started || extra > 0 || oldConfirmed !== this.confirmed) this.onChange();
  }

  tick() {
    if (this.reason) return;
    const now = this.now();
    if (this.peer && !this.finished && this.lostAt === null && now - this.lastSeen >= SILENT_MS) {
      this.lostAt = this.lastSeen + SILENT_MS;
      this.onChange();
    }
    if (this.lostAt !== null && now - this.lostAt >= RECONNECT_MS) {
      this.expire();
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
