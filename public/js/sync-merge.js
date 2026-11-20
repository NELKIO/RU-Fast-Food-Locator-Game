// Merging one player's progress across devices, without a server.
//
// Every device keeps a ledger inside the profile: for each device it has heard of, what that
// device added to each counter (player XP, wins, copies and XP of every fighter, visits to every
// venue). Only the device itself grows its own entry. A merge takes, per device and per counter,
// the larger of the two known values, and the profile shows the sum over all devices. That is a
// grow-only counter CRDT: merging is commutative, associative and idempotent, so the order of
// syncs, repeated syncs and a stale copy on a relay never count anything twice or lose it.
//
// Fields that are not counters merge by their meaning:
//   collection, visits     union; visit time is the latest one
//   team                   the most recent change wins (its time travels with it)
//   wild fighter           the first one still waiting that appeared after the latest fight
//   lastScoutAt, sequence  the latest / largest
//   daily route            the later day; on the same day the visited points are united
//   login week             the latest claimed day
//   battleIds              stay on the device that played the match
import {
  CARD_XP_CAP, MAX_TEAM_SIZE, WILD_COOLDOWN_MS, cleanContribution, encounterTime, keepNewestRetired, normalizeProfile,
} from './game.js';

export const DOC_VERSION = 1;

export function newDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map(byte => (byte % 36).toString(36)).join('');
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameList(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

// What the profile shows for each counter.
function totalsOf(profile) {
  const cards = {}, visits = {};
  for (const [id, entry] of Object.entries(profile.collection)) cards[id] = [entry.copies, entry.xp];
  for (const [id, visit] of Object.entries(profile.visits)) visits[id] = visit.count;
  return {xp: profile.xp, wins: profile.battles.wins, losses: profile.battles.losses, draws: profile.battles.draws, cards, visits};
}

function sumEntries(entries) {
  const sum = cleanContribution(null);
  for (const entry of entries) {
    for (const key of ['xp', 'wins', 'losses', 'draws']) sum[key] += entry[key];
    for (const [id, [copies, xp]] of Object.entries(entry.cards)) {
      const kept = sum.cards[id] ?? [0, 0];
      sum.cards[id] = [kept[0] + copies, kept[1] + xp];
    }
    for (const [id, visits] of Object.entries(entry.visits)) sum.visits[id] = (sum.visits[id] ?? 0) + visits;
  }
  return sum;
}

// Zero entries carry nothing; dropping them keeps every device's ledger byte-for-byte the same.
function compact(entry) {
  for (const [id, [copies, xp]] of Object.entries(entry.cards)) if (!copies && !xp) delete entry.cards[id];
  for (const [id, visits] of Object.entries(entry.visits)) if (!visits) delete entry.visits[id];
  return entry;
}

// True when `a` is ahead of `b` in at least one counter.
function exceeds(a, b) {
  if (['xp', 'wins', 'losses', 'draws'].some(key => a[key] > b[key])) return true;
  if (Object.entries(a.cards).some(([id, [copies, xp]]) => copies > (b.cards[id]?.[0] ?? 0) || xp > (b.cards[id]?.[1] ?? 0))) return true;
  return Object.entries(a.visits).some(([id, visits]) => visits > (b.visits[id] ?? 0));
}

function minus(a, b) {
  const out = cleanContribution(null);
  for (const key of ['xp', 'wins', 'losses', 'draws']) out[key] = Math.max(0, a[key] - b[key]);
  for (const [id, [copies, xp]] of Object.entries(a.cards)) {
    out.cards[id] = [Math.max(0, copies - (b.cards[id]?.[0] ?? 0)), Math.max(0, xp - (b.cards[id]?.[1] ?? 0))];
  }
  for (const [id, visits] of Object.entries(a.visits)) out.visits[id] = Math.max(0, visits - (b.visits[id] ?? 0));
  return compact(out);
}

function larger(a, b) {
  const out = cleanContribution(null);
  for (const key of ['xp', 'wins', 'losses', 'draws']) out[key] = Math.max(a[key], b[key]);
  for (const id of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) {
    const x = a.cards[id] ?? [0, 0], y = b.cards[id] ?? [0, 0];
    out.cards[id] = [Math.max(x[0], y[0]), Math.max(x[1], y[1])];
  }
  for (const id of new Set([...Object.keys(a.visits), ...Object.keys(b.visits)])) {
    out.visits[id] = Math.max(a.visits[id] ?? 0, b.visits[id] ?? 0);
  }
  return compact(out);
}

// The device's own entry: everything the profile shows beyond what the other devices brought.
// It never shrinks: a capped fighter XP can make the difference smaller, the entry stays.
function ownEntry(profile, device, devices) {
  const others = sumEntries(Object.entries(devices).filter(([id]) => id !== device).map(([, entry]) => entry));
  const totals = totalsOf(profile);
  const own = cleanContribution(null);
  for (const key of ['xp', 'wins', 'losses', 'draws']) own[key] = Math.max(0, totals[key] - others[key]);
  for (const [id, [copies, xp]] of Object.entries(totals.cards)) {
    const theirs = others.cards[id] ?? [0, 0];
    own.cards[id] = [Math.max(0, copies - theirs[0]), Math.max(0, xp - theirs[1])];
  }
  for (const [id, visits] of Object.entries(totals.visits)) own.visits[id] = Math.max(0, visits - (others.visits[id] ?? 0));
  return larger(Object.hasOwn(devices, device) ? devices[device] : cleanContribution(null), own);
}

// What this browser itself has added to the profile: the whole profile when it never synced,
// otherwise its own ledger entries (the current device id and any earlier ids it had before a
// rollback). Linked devices each report only their own part, so nothing is counted twice.
export function ownContribution(profile, earlierIds = []) {
  const saved = normalizeProfile(profile);
  if (!saved.sync) return totalsOf(saved);
  const devices = saved.sync.devices;
  const earlier = [...new Set(earlierIds)].filter(id => id !== saved.sync.device && Object.hasOwn(devices, id)).map(id => devices[id]);
  return sumEntries([ownEntry(saved, saved.sync.device, devices), ...earlier]);
}

// The shared document: the ledger plus the fields that are not counters.
export function cleanDoc(value) {
  if (!record(value) || !Number.isSafeInteger(value.v) || value.v < 1) return null;
  // A document from a newer version is read for what this version knows, but never rewritten.
  const profile = normalizeProfile({
    sync: {device: 'documentreader', devices: value.devices, team: value.team, teamAt: value.teamAt},
    daily: value.daily, encounter: value.encounter,
    retired: Array.isArray(value.retired) ? Object.fromEntries(value.retired.slice(0, 500).map(id => [String(id), true])) : {},
    lastScoutAt: value.lastScoutAt, encounterSequence: value.encounterSequence, login: value.login, wildSeed: value.wildSeed,
    visits: record(value.visitsAt)
      ? Object.fromEntries(Object.entries(value.visitsAt).map(([id, lastAt]) => [id, {lastAt, count: 1}])) : {},
  });
  return {
    v: value.v,
    devices: profile.sync.devices,
    team: profile.sync.team,
    teamAt: profile.sync.teamAt,
    daily: profile.daily,
    encounter: profile.encounter,
    retired: Object.keys(profile.retired),
    lastScoutAt: profile.lastScoutAt,
    encounterSequence: profile.encounterSequence,
    login: profile.login,
    wildSeed: profile.wildSeed,
    visitsAt: Object.fromEntries(Object.entries(profile.visits).map(([id, visit]) => [id, visit.lastAt])),
  };
}

function laterRoute(a, b) {
  if (a.day !== b.day) return a.day > b.day ? a : b;
  // Sorted, so every device keeps the same two points whatever the merge order.
  const pointIds = [...new Set([...a.pointIds, ...b.pointIds])].sort().slice(0, 2);
  return {day: a.day, pointIds, claimed: (a.claimed || b.claimed) && pointIds.length === 2};
}

// Merge shared documents into the local profile. Pure: returns a new normalized profile.
export function mergeProfile(local, docs = [], {now = Date.now(), device} = {}) {
  const base = normalizeProfile(local);
  const sync = base.sync ?? {device: device ?? newDeviceId(), key: null, devices: {}, team: [...base.team], teamAt: 0};
  let me = sync.device;
  const clean = docs.map(cleanDoc).filter(Boolean);

  // 1. The ledger: my entry from my own play, every device at its largest known value.
  const devices = {...sync.devices};
  const stored = Object.hasOwn(devices, me) ? devices[me] : cleanContribution(null);
  const ownNow = ownEntry(base, me, devices);
  const published = clean.filter(doc => Object.hasOwn(doc.devices, me)).map(doc => doc.devices[me]);
  const remoteMine = published.length ? published.reduce(larger) : null;
  if (remoteMine && exceeds(remoteMine, stored)) {
    // The relays know more of this device than the device itself: it was rolled back (restored from
    // an old backup, or a profile write was lost). Its old entry stays at the larger known value and
    // what it played since the rollback goes under a new id, so neither part can hide the other.
    devices[me] = larger(stored, remoteMine);
    me = newDeviceId();
    devices[me] = minus(ownNow, stored);
  } else {
    devices[me] = ownNow;
  }
  for (const doc of clean) {
    for (const [id, entry] of Object.entries(doc.devices)) devices[id] = Object.hasOwn(devices, id) ? larger(devices[id], entry) : entry;
  }
  const totals = sumEntries(Object.values(devices));

  // 2. Counters are the sums.
  const merged = normalizeProfile(base);
  merged.xp = totals.xp;
  merged.battles = {wins: totals.wins, losses: totals.losses, draws: totals.draws};
  merged.collection = {};
  for (const [id, [copies, xp]] of Object.entries(totals.cards)) {
    if (copies > 0) merged.collection[id] = {copies, xp: Math.min(CARD_XP_CAP, xp)};
  }
  const lastAt = Object.fromEntries(Object.entries(base.visits).map(([id, visit]) => [id, visit.lastAt]));
  for (const doc of clean) {
    for (const [id, time] of Object.entries(doc.visitsAt)) lastAt[id] = Math.max(lastAt[id] ?? 0, time);
  }
  merged.visits = {};
  for (const [id, visits] of Object.entries(totals.visits)) {
    if (visits > 0 && lastAt[id] !== undefined) merged.visits[id] = {count: visits, lastAt: lastAt[id]};
  }

  // 3. The rest by meaning.
  merged.daily = clean.reduce((route, doc) => laterRoute(route, doc.daily), {...base.daily, pointIds: [...base.daily.pointIds].sort()});
  // One wild-fighter stream for the account: every device ends up with the same (smallest) seed.
  merged.wildSeed = [base.wildSeed, ...clean.map(doc => doc.wildSeed)].filter(Boolean).sort()[0] ?? '';
  // The login week: the latest claimed day wins, so a reward taken on one device is taken everywhere.
  merged.login = clean.reduce((a, doc) => (doc.login.day > a.day || (doc.login.day === a.day && doc.login.streak > a.streak) ? doc.login : a), base.login);
  merged.lastScoutAt = Math.max(base.lastScoutAt ?? -1, ...clean.map(doc => doc.lastScoutAt ?? -1));
  if (merged.lastScoutAt < 0) merged.lastScoutAt = null;
  merged.encounterSequence = Math.max(base.encounterSequence, ...clean.map(doc => doc.encounterSequence));
  const retired = new Set([...Object.keys(base.retired), ...clean.flatMap(doc => doc.retired)]);
  // After a fight on any device the next wild fighter comes only after the pause, so one that
  // appeared before that fight, or by itself during the pause on a device that did not know about
  // the fight yet, is stale. A fighter lured by a restaurant visit is a reward and stays. Of two
  // that are both waiting, the one that came first stays (a player may already be fighting it);
  // the other is a duplicate of a device that had not synced yet.
  const fought = merged.lastScoutAt ?? -Infinity;
  const stale = e => e.startedAt < fought || (!e.visit && e.startedAt < fought + WILD_COOLDOWN_MS);
  // The same wild fighter met on two devices has the same id: keep one copy of it.
  const all = [...new Map([base.encounter, ...clean.map(doc => doc.encounter)].filter(e => e && !retired.has(e.id))
    .sort((a, b) => a.startedAt - b.startedAt || (a.enemyId < b.enemyId ? -1 : 1)).reverse().map(e => [e.id, e])).values()];
  for (const e of all.filter(stale)) retired.add(e.id);
  const candidates = all.filter(e => !stale(e));
  candidates.sort((a, b) => a.startedAt - b.startedAt || encounterTime(a.id) - encounterTime(b.id) || (a.id < b.id ? -1 : 1));
  merged.encounter = candidates[0] ? {...candidates[0]} : null;
  // An encounter that lost the merge is gone for good, so no device brings it back later.
  for (const loser of candidates.slice(1)) if (loser.id !== merged.encounter.id) retired.add(loser.id);
  merged.retired = keepNewestRetired([...retired]);

  // The team: a local change since the last sync gets a time later than any seen so far (a logical
  // clock), so it wins even when another device's clock runs far ahead.
  const localTeamAt = sameList(base.team, sync.team) ? sync.teamAt : Math.max(now, sync.teamAt + 1);
  let team = base.team, teamAt = localTeamAt;
  // Equal times fall back to comparing the line-ups, so every device makes the same choice.
  for (const doc of clean) {
    if (!doc.team.length) continue;
    if (doc.teamAt > teamAt || (doc.teamAt === teamAt && JSON.stringify(doc.team) > JSON.stringify(team))) {
      team = doc.team; teamAt = doc.teamAt;
    }
  }
  merged.team = team.filter(id => Object.hasOwn(merged.collection, id)).slice(0, MAX_TEAM_SIZE);

  merged.sync = {device: me, key: sync.key, devices, team: [], teamAt};
  const result = normalizeProfile(merged);
  result.sync.team = [...result.team];
  return result;
}

// The document this device publishes after a merge.
export function docOf(profile) {
  const saved = normalizeProfile(profile);
  if (!saved.sync) return null;
  return {
    v: DOC_VERSION,
    devices: saved.sync.devices,
    team: saved.team,
    teamAt: saved.sync.teamAt,
    daily: saved.daily,
    encounter: saved.encounter,
    retired: Object.keys(saved.retired),
    lastScoutAt: saved.lastScoutAt,
    encounterSequence: saved.encounterSequence,
    login: saved.login,
    wildSeed: saved.wildSeed,
    visitsAt: Object.fromEntries(Object.entries(saved.visits).map(([id, visit]) => [id, visit.lastAt])),
  };
}

// Key order does not matter for equality.
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
