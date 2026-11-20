import { brands, countdown, esc, icon, rarityNames, transformBadge } from './ui.js';
import { applyMove, battleStats, currentFighter, legalMoves, MAX_ENERGY, opener, startBattle } from './duel-engine.js';
import { smartMove } from './duel-ai.js';
import { describeSkill, describeTrait, describeTransform } from './fighters.js';
import { DuelRoom, newRoomCode, parseRoomCode, RECONNECT_MS } from './duel-room.js';
import { connectDuel } from './duel-transport.js';
import { createFx } from './battle-fx.js';
import { intimidateFx, movePlan, TRANSFORM_FLASH } from './fx-moves.js';

const LABELS = { wild: 'Дикий боец', trainer: 'Бой с тренером', online: 'Сетевая дуэль' };
// How long the computer thinks per move: the trainer plays at full strength, a wild fighter a little lighter.
// A trainer goes by a funny job and a name: «Курьер Андрей».
const fullName = coach => (coach.role ? `${coach.role} ${coach.name}` : coach.name);
const THINK_MS = { wild: 90, easy: 60, normal: 350, hard: 900, lord: 1200 };
// Noise: the computer picks among moves at most this much worse than its best (duel-ai.js, slack).
// Tuned on battles against a casual and a thinking player (docs/balance/tools/trainer-noise.mjs) so
// that each level is a little easier than the first trainers: Всерьёз a fair fight, Без пощады hard,
// Лука the strongest. The wild fighter keeps the balance it had with the earlier computer player.
const SLACK = { wild: 0.2, easy: 0, normal: 0.1, hard: 0.03, lord: 0 };
const LEVELS = [['easy', 'Разминка'], ['normal', 'Всерьёз'], ['hard', 'Без пощады']];
const plural = new Intl.PluralRules('ru');
const MOVES = { one: 'ход', few: 'хода', many: 'ходов', other: 'хода' };
const ONLINE_XP = { won: 24, draw: 6, lost: 4 };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function color(brand) {
  return brands[brand]?.color ?? '#b6c97d';
}

function button(action, title, options = {}) {
  const variant = options.primary ? ' duel-primary' : options.quiet ? ' duel-quiet' : '';
  return `<button type="button" class="duel-btn${variant}" data-duel-action="${esc(action)}" ${options.disabled ? 'disabled' : ''}>
    ${options.icon ? icon(options.icon, 18) : ''}<span>${esc(title)}</span></button>`;
}

// `badge`: the purple corner mark of a fighter that can still transform.
function artwork(card, badge = false) {
  const art = card?.image ? `<img src="${esc(card.image)}" alt="" decoding="async" draggable="false">` : '';
  return `<span class="duel-art" style="--team-color:${color(card?.brand)}">${art || icon(card?.brand ?? 'battle', 36)}${badge ? transformBadge() : ''}</span>`;
}

// The name a fighter goes by on the arena: the form's name once it has transformed.
function shownName(state, id, name, side) {
  for (const s of side === undefined ? [0, 1] : [side]) {
    const fighter = state?.teams[s].find(member => member.id === id && member.transformed);
    if (fighter) return fighter.transform.name;
  }
  return name(id);
}

function pips(filled, total, label) {
  const dots = Array.from({ length: total }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('');
  return `<span class="duel-pips" role="img" aria-label="${esc(label)}">${dots}</span>`;
}

const rules = `<details class="duel-rules"><summary>Как идёт бой</summary>
  <p>Первым ходит тот, чей боец быстрее. При равной скорости в бою с диким бойцом начинаешь ты, а в дуэли решает код комнаты; второй в дуэли получает +1 энергии. Когда на арену выходит новый боец после нокаута, первым снова ходит самый быстрый, даже если он только что ходил.</p>
  <p>Дальше ходите по очереди. Удар и защита дают +1 энергии, максимум ${MAX_ENERGY}. Энергия тратится на фирменный приём — у каждого бойца он свой.</p>
  <p>Чем реже боец, тем больше он умеет: у редкого есть талант, который работает сам, у эпического и легендарного — ещё и суперприём за ${MAX_ENERGY} энергии. Талант легенды делает сразу две вещи.</p>
  <p>Защита вдвое ослабляет следующий удар, если он не «сквозь защиту». Выбитого бойца сразу заменяет следующий из команды. Замена по своей воле стоит хода.</p>
  <p>Через 48 ходов побеждает команда, у которой осталось больше здоровья. В дуэли с другом у всех базовые характеристики, а команды выравниваются по меньшей.</p></details>`;

// The narrator: one short line about what just happened, from the event the engine produced.
// `snackers`: the sides whose fighter ate its snack in this event (the engine only gives the sum).
function story(event, plainName, state, snackers = []) {
  const name = (id, side) => shownName(state, id, plainName, side);
  if (!event) {
    const [a, b] = [0, 1].map(side => currentFighter(state, side));
    const lead = currentFighter(state, state.turn);
    if (a.speed === b.speed) return `Скорость равна, первым ходит ${name(lead.id)}. Бей, чтобы копить энергию, и трать её на приёмы.`;
    return `${name(lead.id)} быстрее (скорость ${lead.speed} против ${Math.min(a.speed, b.speed)}) и ходит первым.`;
  }
  const switched = event.command.startsWith('switch:');
  const who = name(event.fighter, event.side), target = name(event.target, switched ? event.side : 1 - event.side);
  const parts = [];
  if (switched) {
    parts.push(`${who} уходит. На арену выходит ${target}.`);
    if (event.refresh) parts.push(`${plainName(event.fighter)} переводит дух: +${event.refresh} HP.`);
  }
  else if (event.command === 'guard') parts.push(`${who} уходит в защиту.`);
  else {
    const form = event.command === 'transform' ? state.teams[event.side].find(f => f.id === event.fighter && f.transformed)?.transform : null;
    const opening = event.command === 'transform'
      ? `Трансформация! ${plainName(event.fighter)} → «${event.transformed}».`
      : event.command === 'ultimate' ? `${who}: суперприём «${event.skill}»!` : event.skill ? `${who}: «${event.skill}».` : `${who} бьёт.`;
    parts.push(opening);
    if (form) {
      const stats = [['hp', 'здоровье'], ['attack', 'атака'], ['speed', 'скорость']].filter(([key]) => form[key])
        .map(([key, label]) => `${label} ${form[key] > 0 ? '+' : '−'}${Math.abs(form[key])}`);
      if (stats.length) parts.push(stats.join(', ').replace(/^./, c => c.toUpperCase()) + '.');
      if (form.effect) parts.push(`«${form.effect.name}»!`);
    }
    if (event.opener) parts.push('Первый удар на арене сильнее.');
    if (event.fresh) parts.push(`${target} свеж: урон вдвое меньше.`);
    if (event.damage) parts.push(`${target} −${event.damage} HP${event.hits > 1 ? ` за ${event.hits} удара` : ''}${event.executed ? ', добивание' : ''}.`);
    else if (event.command === 'hit' || event.skill && event.blocked) parts.push(`${target} не получает урона.`);
    if (event.blocked) parts.push('Защита смягчила удар.');
    if (event.absorbed) parts.push(`Щит поглотил ${event.absorbed}.`);
    if (event.heal) parts.push(`+${event.heal} HP.`);
    const effects = {
      burn: `${target} горит.`, weaken: `Атака ${target} падает.`, sap: `${target} теряет энергию.`,
      buff: `Атака ${who} растёт.`, shield: `${who} под щитом.`, cleanse: `${who} снова в порядке.`, shatter: 'Защита сбита.',
      purge: `С ${target} стёрты щит и усиления.`, freeze: `${target} заморожен!`, thaw: `${target} оттаял.`,
      sleep: `${target} засыпает.`, wake: `${target} просыпается от удара.`, toxic: `У ${target} изжога.`,
      leech: `${who} вытягивает силы из ${target}.`, charge: `${who} заряжается.`, immune: `На ${target} это не действует.`
    };
    for (const effect of event.effects) if (effects[effect]) parts.push(effects[effect]);
    if (event.recoil) parts.push(`Отдача −${event.recoil}.`);
    if (event.thorns) parts.push(`${who} укололся: −${event.thorns}.`);
    if (event.saved) parts.push(`${target} выстоял на 1 HP!`);
    if (event.parting) parts.push(`Прощальный укус: ${who} −${event.parting}.`);
    if (event.moxie) parts.push(`Нокаут раззадорил: атака ${who} растёт.`);
  }
  if (event.snack) {
    const eaters = snackers.length ? snackers : [1 - event.side];
    for (const side of eaters) parts.push(`${name(currentFighter(state, side).id, side)} перекусывает${eaters.length === 1 ? ': +' + event.snack + ' HP' : ''}.`);
  }
  if (event.regen) parts.push(`${who} восстанавливается: +${event.regen}.`);
  if (event.burned) parts.push(`${who} обжигается: −${event.burned}.`);
  if (event.poisoned) parts.push(`${who} мучает изжога: −${event.poisoned}.`);
  if (event.leeched) parts.push(`Из ${who} вытянуто ${event.leeched}${event.leechHeal ? `, соперник +${event.leechHeal}` : ''}.`);
  for (const id of event.intimidated) parts.push(`${name(id)} смотрит грозно: атака соперника падает.`);
  for (const skip of event.skips) {
    parts.push(skip.kind === 'freeze' ? `${name(skip.id)} заморожен и пропускает ход.` : `${name(skip.id)} спит и пропускает ход.`);
    if (skip.burned) parts.push(`Ожог −${skip.burned}.`);
    if (skip.poisoned) parts.push(`Изжога −${skip.poisoned}.`);
    if (skip.leeched) parts.push(`Вытянуто ${skip.leeched}.`);
    if (skip.recovered) parts.push(skip.kind === 'freeze' ? `${name(skip.id)} оттаял.` : `${name(skip.id)} просыпается.`);
    if (skip.snack) parts.push(`Перекус +${skip.snack}.`);
  }
  for (const id of event.ko) parts.push(`${name(id)} выбит!`);
  event.entered.forEach((id, side) => { if (id && !event.command.startsWith('switch:')) parts.push(`Выходит ${name(id)}.`); });
  // After a knockout the faster fighter on the arena moves first, even twice in a row.
  if (event.ko.length && state.winner === null && state.turn === event.side) parts.push(`${name(currentFighter(state, event.side).id)} быстрее и ходит снова.`);
  return parts.join(' ');
}

function chips(fighter) {
  const out = [];
  if (fighter.transformed) out.push(['form', icon('transform', 12) + 'Форма']);
  if (fighter.guarding) out.push(['guard', icon('lock', 12) + 'Защита']);
  if (fighter.shield) out.push(['shield', 'Щит ' + fighter.shield]);
  if (fighter.burn) out.push(['burn', 'Горит −' + fighter.burn.dmg + ' × ' + fighter.burn.turns]);
  if (fighter.status?.kind === 'freeze') out.push(['freeze', 'Заморожен']);
  if (fighter.status?.kind === 'sleep') out.push(['sleep', 'Спит' + (fighter.status.turns > 1 ? ' × ' + fighter.status.turns : '')]);
  if (fighter.toxic) out.push(['toxic', 'Изжога −' + fighter.toxic]);
  if (fighter.leech) out.push(['leech', 'Вытягивают −' + fighter.leech]);
  const shift = fighter.attack - fighter.baseAttack;
  if (shift) out.push([shift > 0 ? 'buff' : 'weaken', 'Атака ' + (shift > 0 ? '+' : '−') + Math.abs(shift)]);
  return out.map(([kind, text]) => `<span class="duel-chip is-${kind}">${text}</span>`).join('');
}

export function mountDuels(container, options) {
  const { read, initialMode, award, onBack, onStateChange, onTeamChange, onShowCard, onFightChange, sound } = options;
  let wildFighting = false;
  let data, catalog, owned;
  let selected = [];
  function sync() {
    data = read();
    catalog = new Map(data.cards.map(card => [card.id, card]));
    owned = [...new Set(data.owned)].filter(id => catalog.has(id));
    selected = selected.filter(id => owned.includes(id));
    if (!selected.length) selected = [...new Set(data.team ?? [])].filter(id => owned.includes(id)).slice(0, 3);
    if (!selected.length) selected = owned.slice(0, 1);
  }
  sync();
  let mode = initialMode === 'online' ? 'online' : 'lobby';
  let local = null, localMatchId = null, wildId = null, wildFought = null, room = null, transport = null, controller = null;
  let thinking = null, pulse = null, waitingHint = null, holdTimer = null, fxTimer = null, fx = null, fxUntil = 0;
  let disposed = false, rewardState = 'idle', rewardInfo = null, quitPrompt = false, slow = false;
  let inviteVisible = false, copyStatus = '', connectionError = '', feedback = '', currentPath = '';
  let guardedNav = false, draftCode = '', lastHtml = '', lastDrawn = null, hold = [null, null], entering = [false, false];
  const shownHp = new Map();
  const page = document.createElement('div');
  page.className = 'duel-page';
  container.replaceChildren(page);
  const name = id => catalog.get(id)?.name ?? 'Боец';

  function navLock(value) {
    if (guardedNav === value) return;
    guardedNav = value;
    onStateChange?.(value);
  }

  function stopNetwork() {
    clearInterval(pulse);
    clearTimeout(waitingHint);
    controller?.abort();
    controller = null;
    room = null;
    transport = null;
    navLock(false);
  }

  // An invite link only opens the room once: after the match, or when the player leaves the room,
  // a reload brings back the arena lobby instead of the finished room.
  function forgetInvite() {
    if (/^#duel=/i.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
  }

  function reset(next = 'lobby') {
    if (next !== 'online') forgetInvite();
    room?.cancel('left');
    stopNetwork();
    clearTimeout(thinking);
    clearTimeout(holdTimer);
    clearTimeout(fxTimer);
    fx?.clear();
    fxUntil = 0;
    local = localMatchId = wildId = rewardInfo = lastDrawn = null;
    hold = [null, null];
    mode = next;
    rewardState = 'idle';
    quitPrompt = slow = inviteVisible = false;
    copyStatus = connectionError = feedback = currentPath = '';
    sync();
    draw();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function saveTeam() {
    if (selected.length) onTeamChange?.([...selected]);
  }

  function startWild() {
    const wild = data.wild;
    if (!wild || !selected.length) { draw(); return; }
    const enemy = wild.opponent(selected.map(id => catalog.get(id)));
    if (!enemy) { draw(); return; }
    // The faster lead fighter opens; on equal speed the player does. Nobody gets tempo energy.
    const teams = [selected.map(id => battleStats(catalog.get(id))), [battleStats(enemy)]];
    local = startBattle(teams, opener(teams, 0), { tempo: false });
    localMatchId = newRoomCode() + newRoomCode();
    wildId = wild.id;
    wildFought = wild.encounter ?? null;
    rewardState = 'idle';
    rewardInfo = null;
    quitPrompt = false;
    mode = 'wild';
    draw();
    window.scrollTo({ top: 0, behavior: 'instant' });
    queueBot();
  }

  // The wild fighter moves whenever the turn is its own: after the player, at the start when it
  // is faster, and again when it is faster than a fighter that just came in.
  function queueBot() {
    if (!local || local.winner !== null || local.turn !== 1) return;
    clearTimeout(thinking);
    thinking = setTimeout(botTurn, reduced() ? 300 : Math.max(950, fxUntil - performance.now() + 350));
  }

  function botTurn() {
    if (disposed || !local || local.winner !== null || local.turn !== 1) return;
    if (hold.some(index => index !== null) || busy()) { thinking = setTimeout(botTurn, Math.max(120, fxUntil - performance.now() + 250)); return; }
    const level = mode === 'trainer' ? trainer?.difficulty ?? 'normal' : 'wild';
    const moves = legalMoves(local);
    // At the warm-up level the trainer sometimes slips; everywhere else it plays its best.
    const slip = level === 'easy' && Math.random() < 0.25;
    local = applyMove(local, 1, slip ? moves[Math.floor(Math.random() * moves.length)] : smartMove(local, 1, { timeMs: THINK_MS[level] ?? 90, slack: SLACK[level] ?? 0 }));
    draw();
    queueBot();
  }

  // The trainer on offer matches the current team; a new one only when asked or when the team changes.
  // The trainer's line-up follows the rarities and levels of the player's team only: reordering it
  // or swapping a fighter for an equal one keeps the line-up. «Новая команда» rolls another one.
  let trainer = null, trainerKey = '', trainerRoll = 0;
  function trainerFor(fresh = false) {
    if (!data.trainer || !selected.length) return null;
    if (fresh) { data.nextTrainer?.(); trainerRoll = 0; }
    const cards = selected.map(id => catalog.get(id));
    const strength = cards.map(c => c.rarity + ':' + c.level).sort().join(',');
    const key = strength + '|' + data.trainerLevel?.() + '|' + data.trainerId?.() + '|' + trainerRoll;
    if (fresh || !trainer || trainerKey !== key) {
      trainer = data.trainer(cards, trainerRoll);
      trainerKey = key;
    }
    return trainer;
  }

  function startTrainer() {
    const offer = trainerFor();
    if (!offer) { draw(); return; }
    const teams = [selected.map(id => battleStats(catalog.get(id))), offer.team.map(card => battleStats(card))];
    local = startBattle(teams, opener(teams, 0), { tempo: false });
    localMatchId = newRoomCode() + newRoomCode();
    rewardState = 'idle';
    rewardInfo = null;
    quitPrompt = false;
    mode = 'trainer';
    draw();
    window.scrollTo({ top: 0, behavior: 'instant' });
    queueBot();
  }

  function play(command) {
    if (room) {
      room.move(command);
      return;
    }
    if (!local || local.turn !== 0) return;
    const next = applyMove(local, 0, command);
    if (!next) return;
    local = next;
    draw();
    queueBot();
  }

  function openRoom(role, code) {
    if (!owned.length || room) return;
    if (!window.isSecureContext || !window.crypto?.subtle || !window.WebSocket) {
      feedback = 'Для сетевого боя открой игру в современном браузере по HTTPS или на localhost.';
      draw();
      return;
    }
    mode = 'online';
    rewardState = 'idle';
    rewardInfo = null;
    quitPrompt = slow = false;
    feedback = connectionError = '';
    controller = new AbortController();
    const current = new DuelRoom({
      code, role, cards: data.cards, send: (peer, packet) => transport?.send(peer, packet),
      onChange: draw
    });
    room = current;
    navLock(true);
    draw();
    pulse = setInterval(() => current.tick(), 2500);
    waitingHint = setTimeout(() => { if (room === current && !room.peer) { slow = true; draw(); } }, 18_000);
    connectDuel(code, {
      up: peer => { if (room === current) current.contact(peer); },
      down: peer => { if (room === current) current.disconnect(peer); },
      message: (peer, packet) => { if (room === current) current.receive(peer, packet); },
      path: (peer, path) => {
        if (room !== current || (current.peer && current.peer !== peer) || currentPath === path) return;
        currentPath = path;
        draw();
      },
      error: error => {
        if (room !== current || current.peer) return;
        connectionError = error === 'full' ? 'В комнате уже два игрока.' : 'Нет связи с узлами поиска. Проверь интернет.';
        draw();
      }
    }, controller.signal).then(result => {
      if (room === current) transport = result;
    }).catch(() => {
      if (room !== current || disposed) return;
      connectionError = 'Не удалось подключиться. Закрой комнату и попробуй ещё раз.';
      draw();
    });
  }

  function teamPicker(locked = false, online = false) {
    const items = owned.map(id => {
      const card = catalog.get(id);
      const number = selected.indexOf(id);
      const stats = battleStats(card, online);
      // The fighter itself opens its card; the round slot adds it to the team or takes it out.
      const label = number < 0 ? `Добавить в команду: ${card.name}` : `Убрать из команды: ${card.name}, выходит ${number + 1}-м`;
      return `<div class="duel-pick ${number >= 0 ? 'is-selected' : ''}">
        <button type="button" class="duel-pick-info" data-duel-action="card:${esc(id)}" aria-label="Карточка бойца: ${esc(card.name)}">
        ${artwork(card, Boolean(card.transform))}<span class="duel-pick-title"><strong>${esc(card.name)}</strong>
        <small><span>${icon('heart', 11)}&nbsp;${stats.hp}</span> · <span>${icon('battle', 11)}&nbsp;${stats.attack}</span> · <span>${icon('speed', 11)}&nbsp;${stats.speed}</span> · <span>${esc(stats.skill.name)}</span></small></span></button>
        <button type="button" class="duel-slot" data-duel-action="pick:${esc(id)}" aria-pressed="${number >= 0}" aria-label="${esc(label)}"
          ${locked || (number < 0 && selected.length === 3) ? 'disabled' : ''}>${number < 0 ? '+' : number + 1}</button></div>`;
    }).join('');
    return `<section class="duel-team"><h3>Твоя команда <small>${selected.length} из 3 · выходят по номерам · нажми на бойца, чтобы открыть карточку</small></h3>
      <div class="duel-roster">${items}</div></section>`;
  }

  function trainerBox() {
    const offer = trainerFor();
    if (!offer) return '';
    const faces = offer.team.map(card => `<span class="duel-trainer-fighter" style="--team-color:${color(card.brand)}" title="${esc(card.name)}">${artwork(card, Boolean(card.transform))}
      <small><span class="rarity ${esc(card.rarity)}">${esc((rarityNames[card.rarity] ?? '').slice(0, 1))}</span> ур. ${card.level}</small></span>`).join('');
    const coach = offer.trainer;
    const level = data.trainerLevel?.() ?? 'normal';
    const levels = coach.lord
      ? '<p class="duel-trainer-lord">Лука всегда играет в полную силу: три сильнейшие легенды на уровень выше твоего лучшего бойца. Опыт за бой ×2.</p>'
      : `<div class="duel-trainer-levels" role="group" aria-label="Сложность">${LEVELS.map(([id, label]) =>
          `<button type="button" class="duel-level" data-duel-action="trainer-level:${id}" aria-pressed="${id === level}">${label}</button>`).join('')}</div>`;
    return `<section class="duel-trainer${coach.lord ? ' is-lord' : ''}" style="--team-color:${coach.brand ? color(coach.brand) : coach.lord ? '#ffd76a' : '#c7b1f5'}" aria-labelledby="duel-trainer-title">
      <div class="duel-trainer-head"><span class="duel-label">Тренер · ${esc(coach.title ?? brands[coach.brand]?.name ?? '')}</span>
        <h3 id="duel-trainer-title">${coach.lord ? icon('trophy', 18) + ' ' : ''}${esc(fullName(coach))}</h3>
        <p>Бой 3 на 3 в любое время. Тренер просчитывает ходы вперёд, меняет бойцов и бережёт энергию на суперприём.${coach.lord ? '' : ' Его команда подобрана под редкости и уровни твоей: перестановки и замена бойца на равного её не меняют.'}</p></div>
      ${levels}
      <div class="duel-trainer-team">${faces}</div>
      <div class="duel-buttons duel-trainer-actions">${button('trainer', 'Вызвать на бой', { primary: true, icon: 'battle', disabled: !selected.length })}${button('trainer-new', 'Другой тренер', { quiet: true })}${coach.lord ? '' : button('trainer-roll', 'Новая команда', { quiet: true })}</div>
    </section>`;
  }

  function wildBox() {
    const wild = data.wild;
    if (!wild) {
      const wait = data.wildWaitMs > 0 ? 'Следующий появится через ' + countdown(data.wildWaitMs) + '. ' : '';
      return `<section class="duel-wild is-empty"><span class="duel-wild-icon">${icon('compass', 24)}</span>
        <div><h3>Дикого бойца пока нет</h3><p>${wait}Отметься у любого заведения — и рядом сразу появится новый.</p></div></section>`;
    }
    const enemy = wild.opponent(selected.map(id => catalog.get(id)));
    if (!enemy) return '';
    const owns = owned.includes(enemy.id);
    return `<section class="duel-wild" style="--team-color:${color(enemy.brand)}" aria-labelledby="duel-wild-title">
      ${artwork(enemy, Boolean(enemy.transform))}
      <div class="duel-wild-copy">
        <span class="duel-label">Дикий боец · ${esc(brands[enemy.brand]?.name ?? '')}</span>
        <h3 id="duel-wild-title">${esc(enemy.name)}</h3>
        <p class="duel-wild-stats"><span class="rarity ${esc(enemy.rarity)}">${esc(rarityNames[enemy.rarity] ?? '')}</span>
          <span>${icon('heart', 13)} ${enemy.maxHp}</span><span>${icon('battle', 13)} ${enemy.attack}</span><span title="Скорость">${icon('speed', 13)} ${enemy.speed ?? 5}</span></p>
        <p class="duel-wild-skill"><strong>«${esc(enemy.skill.name)}»</strong> ${esc(describeSkill(enemy.skill, enemy.attack))}</p>
        ${enemy.ultimate ? `<p class="duel-wild-skill"><strong>Суперприём «${esc(enemy.ultimate.name)}»</strong> ${esc(describeSkill(enemy.ultimate, enemy.attack))}</p>` : ''}
        ${enemy.trait ? `<p class="duel-wild-skill"><strong>Талант «${esc(enemy.trait.name)}»</strong> ${esc(describeTrait(enemy.trait))}</p>` : ''}
        ${enemy.transform ? `<p class="duel-wild-skill is-transform"><strong>Трансформация «${esc(enemy.transform.name)}»</strong> ${esc(describeTransform(enemy.transform, enemy.attack))}</p>` : ''}
      </div>
      <p class="duel-wild-deal">${icon('trophy', 16)}<span>${owns ? 'Победа прокачает его копию в коллекции и даст опыт команде.' : 'Победи — и он перейдёт в твою коллекцию.'}</span></p>
      ${button('wild', 'Сразиться', { primary: true, icon: 'battle', disabled: !selected.length })}
    </section>`;
  }

  function empty() {
    // Opened before the menu has loaded: the fighters are on their way, not missing.
    if (data.loading) return `<section class="duel-box" aria-busy="true"><h3>Загружаем бойцов…</h3><p>Ещё секунда — подтягиваем меню и твою коллекцию.</p></section>`;
    return `<section class="duel-box"><h3>Нет бойцов</h3>
      <p>Отметься у любого заведения на карте — там выпадет первый боец.</p>
      <div class="duel-buttons">${button('map', 'К карте', { primary: true, icon: 'pin' })}</div></section>`;
  }

  function lobby() {
    if (!owned.length) return `<header class="duel-heading"><h2>Арена</h2></header>${empty()}`;
    // The friend duel sits right under the wild fighter: with a big collection the team list is long.
    return `<header class="duel-heading"><h2>Арена</h2></header>${wildBox()}${feedback && mode === 'lobby' ? '<p class="duel-alert" role="status">' + esc(feedback) + '</p>' : ''}${trainerBox()}
      <section class="duel-friend"><span>${icon('route', 20)}</span><p><strong>С другом по ссылке</strong><small>Честный бой на базовых характеристиках</small></p>
        ${button('online', 'Дуэль с другом')}</section>${teamPicker()}${rules}`;
  }

  function finder() {
    return `<header class="duel-heading"><h2>Дуэль с другом</h2><p>Создай комнату и отправь ссылку — или введи код друга.</p></header>
      ${owned.length ? `<div class="duel-box"><div class="duel-buttons">${button('create', 'Создать комнату', { primary: true, icon: 'plus' })}</div>
        <form class="duel-join"><label for="duel-code">Код или ссылка</label><div><input id="duel-code" name="code" autocapitalize="characters" autocomplete="off"
        spellcheck="false" placeholder="XXXXX-XXXXX" maxlength="512" value="${esc(draftCode)}" required><button class="duel-btn" type="submit">Войти</button></div></form></div>` : empty()}
      ${feedback ? '<p class="duel-alert" role="status">' + esc(feedback) + '</p>' : ''}${button('lobby', 'Назад к арене', { quiet: true })}`;
  }

  function inviteUrl() {
    const url = new URL(location.href);
    url.hash = 'duel=' + room.code;
    return url.href;
  }

  function roomView() {
    const peerStatus = room.lostAt !== null ? 'Восстанавливаем связь с соперником…'
      : room.peerTeam ? 'Соперник готов к бою' : room.peer ? 'Соперник выбирает команду' : 'Ждём второго игрока';
    return `<header class="duel-heading"><h2>Комната дуэли</h2><p role="status" class="duel-waiting${room.peer ? '' : ' is-waiting'}">${esc(peerStatus)}</p></header>
      <div class="duel-box"><span class="duel-label">Код приглашения</span>
        <output class="duel-room-code" data-room-code="${room.code}">${room.code.slice(0, 5)}-${room.code.slice(5)}</output>
        <div class="duel-buttons">${button('copy', 'Скопировать ссылку', { icon: 'route' })}</div>
        ${inviteVisible ? '<input class="duel-share" aria-label="Ссылка на комнату" readonly value="' + esc(inviteUrl()) + '">' : ''}
        ${copyStatus ? '<p class="duel-note" role="status">' + esc(copyStatus) + '</p>' : ''}
        ${connectionError && !room.peer ? '<p class="duel-alert" role="status">' + esc(connectionError) + '</p>' : ''}
        ${slow && !room.peer ? '<p class="duel-note">Проверь, что друг открыл тот же код. Если соединение долго не появляется, попробуй другую сеть.</p>' : ''}
      </div>${readyPanel()}${teamPicker(!!room.team, true)}
      <div class="duel-buttons">${button('lobby', 'Закрыть комнату', { quiet: true })}</div>${rules}`;
  }

  function readyButton() {
    return button('ready', room.team ? 'Команда готова' : 'Подтвердить команду', { primary: true, disabled: !!room.team || !selected.length, icon: 'check' });
  }

  // The start button lives right under the invite code, next to the line-up it confirms: three
  // slots fill as fighters are picked below, so nobody has to hunt for it under a long list.
  function readyPanel() {
    const slots = [0, 1, 2].map(i => {
      const card = catalog.get(selected[i]);
      return card
        ? `<span class="duel-ready-slot is-filled" style="--team-color:${color(card.brand)}" title="${esc(card.name)}">${artwork(card, Boolean(card.transform))}<b>${i + 1}</b></span>`
        : `<span class="duel-ready-slot"><b>${i + 1}</b></span>`;
    }).join('');
    const hint = room.team
      ? (room.peerTeam ? 'Обе команды готовы — начинаем!' : 'Команда подтверждена. Ждём соперника…')
      : selected.length === 3 ? 'Команда собрана. Подтверди — и в бой!'
      : selected.length
        ? `Выбрано ${selected.length} из 3. Можно начинать или добавить ещё ниже.`
        : 'Выбери бойцов ниже: от одного до трёх.';
    return `<section class="duel-ready${room.team ? ' is-done' : selected.length ? ' is-set' : ''}" aria-label="Готовность к бою">
      <div class="duel-ready-row"><div class="duel-ready-slots">${slots}</div><p>${esc(hint)}</p></div>
      ${readyButton()}</section>`;
  }

  function ended() {
    const detail = {
      timeout: 'Связь с соперником не восстановилась за 25 секунд.',
      left: 'Соперник закрыл комнату.',
      quit: 'Один из игроков покинул бой.',
      version: 'На устройствах разные версии игры. Обновите страницу у обоих.'
    };
    return `<section class="duel-box" role="status"><h2>Матч отменён</h2><p>${esc(detail[room.reason] ?? detail.left)} Матч завершён без награды.</p>
      ${button('lobby', 'Вернуться на арену', { primary: true })}</section>`;
  }

  function shownIndex(state, side) {
    return hold[side] ?? state.active[side];
  }

  function fighterPanel(state, side, mine) {
    const fighter = state.teams[side][shownIndex(state, side)];
    const card = catalog.get(fighter.id);
    const who = mine ? 'me' : 'foe';
    // A transformed fighter shows its form: the form's own picture when it has one, else a violet glow.
    const form = fighter.transformed ? fighter.transform : null;
    const look = form?.look && catalog.get(form.look)?.image ? { ...card, image: catalog.get(form.look).image } : card;
    const title = form ? form.name : card?.name;
    const roster = state.teams[side].map((member, index) =>
      `<i class="${member.hp <= 0 ? 'out' : index === shownIndex(state, side) ? 'here' : ''}"></i>`).join('');
    const pct = Math.round(1000 * fighter.hp / fighter.maxHp) / 10;
    const formClass = form ? ' is-transformed' + (look?.image === card?.image ? ' is-glowing' : '') : '';
    return `<section class="duel-fighter is-${who}${fighter.hp <= 0 ? ' is-ko' : ''}${pct <= 30 && fighter.hp > 0 ? ' is-low' : ''}${formClass}" data-side="${who}"
        data-fighter="${esc(fighter.id)}" style="--team-color:${color(card?.brand)}" aria-label="${mine ? 'Твой боец' : 'Боец соперника'}: ${esc(title)}">
      <div class="duel-portrait">${artwork(look, Boolean(fighter.transform && !fighter.transformed && fighter.hp > 0))}</div>
      <div class="duel-info">
        <div class="duel-name-row"><span class="duel-owner">${mine ? 'Ты' : mode === 'wild' ? 'Дикий' : mode === 'trainer' ? 'Тренер' : 'Соперник'}</span>
          <span class="duel-roster-dots" aria-label="В строю ${state.teams[side].filter(m => m.hp > 0).length} из ${state.teams[side].length}">${roster}</span></div>
        <h3>${esc(title)}</h3>
        <div class="duel-hp"><span style="width:${pct}%"></span></div>
        <div class="duel-vitals"><span class="duel-hp-text">${fighter.hp} / ${fighter.maxHp}</span>
          ${pips(fighter.energy, MAX_ENERGY, 'Энергия ' + fighter.energy + ' из ' + MAX_ENERGY)}</div>
        <div class="duel-chips">${chips(fighter)}</div>
      </div>
    </section>`;
  }

  function controls(state, side, enabled) {
    const allowed = new Set(legalMoves(state));
    const fighter = currentFighter(state, side);
    const card = catalog.get(fighter.id);
    const skill = fighter.skill;
    const ready = fighter.energy >= skill.cost;
    const hit = `<button type="button" class="duel-move" data-duel-action="move:hit" ${enabled && allowed.has('hit') ? '' : 'disabled'}>
      <span class="duel-glyph">${icon('battle', 20)}</span><span><strong>${esc(card?.basic ?? 'Удар')}</strong><small>${fighter.attack} урона · +1 энергия</small></span></button>`;
    const guard = `<button type="button" class="duel-move" data-duel-action="move:guard" ${enabled && allowed.has('guard') ? '' : 'disabled'}>
      <span class="duel-glyph">${icon('lock', 20)}</span><span><strong>Защита</strong><small>${fighter.guarding ? 'Уже стоит' : 'Следующий удар ×½ · +1 энергия'}</small></span></button>`;
    const special = `<button type="button" class="duel-move duel-skill${ready ? ' is-ready' : ''}" data-duel-action="move:special" ${enabled && allowed.has('special') ? '' : 'disabled'}>
      <span class="duel-glyph">${icon('spark', 20)}</span>
      <span><strong>${esc(skill.name)} ${pips(Math.min(fighter.energy, skill.cost), skill.cost, 'Стоит ' + skill.cost + ' энергии')}</strong>
      <small>${esc(describeSkill(skill, fighter.attack))}${ready ? '' : ' Нужно энергии: ' + skill.cost + '.'}</small></span></button>`;
    const swaps = state.teams[side].map((reserve, index) => {
      if (index === state.active[side] || reserve.hp <= 0) return '';
      const look = reserve.transformed && catalog.get(reserve.transform.look)?.image ? catalog.get(reserve.transform.look) : catalog.get(reserve.id);
      return `<button type="button" class="duel-swap" data-duel-action="move:switch:${index}" ${enabled ? '' : 'disabled'}>
        ${artwork({ ...catalog.get(reserve.id), image: look?.image }, Boolean(reserve.transform && !reserve.transformed))}<span>Выпустить ${esc(reserve.transformed ? reserve.transform.name : name(reserve.id))}<small>${reserve.hp} / ${reserve.maxHp} HP</small></span></button>`;
    }).join('');
    // The transformation: once per battle, its own violet button with the price and what it does.
    const tf = fighter.transform && !fighter.transformed ? fighter.transform : null;
    const tfReady = tf && fighter.energy >= tf.cost;
    const transform = tf ? `<button type="button" class="duel-move duel-transform${tfReady ? ' is-ready' : ''}" data-duel-action="move:transform" ${enabled && allowed.has('transform') ? '' : 'disabled'}>
      <span class="duel-glyph">${icon('transform', 22)}</span>
      <span><strong>Трансформация ${pips(Math.min(fighter.energy, tf.cost), tf.cost, 'Стоит ' + tf.cost + ' энергии')}</strong>
      <em>→ ${esc(tf.name)}</em>
      <small>${esc(describeTransform(tf, fighter.attack))}${tfReady ? '' : ' Нужно энергии: ' + tf.cost + '.'}</small></span></button>` : '';
    const ult = fighter.ultimate;
    const ultReady = ult && fighter.energy >= ult.cost;
    const ultimate = ult ? `<button type="button" class="duel-move duel-skill duel-ultimate${ultReady ? ' is-ready' : ''}" data-duel-action="move:ultimate" ${enabled && allowed.has('ultimate') ? '' : 'disabled'}>
      <span class="duel-glyph">${icon('trophy', 20)}</span>
      <span><strong>${esc(ult.name)} ${pips(Math.min(fighter.energy, ult.cost), ult.cost, 'Стоит ' + ult.cost + ' энергии')}</strong>
      <small>${esc(describeSkill(ult, fighter.attack))}</small></span></button>` : '';
    return `<div class="duel-controls${ult ? ' has-ultimate' : ''}">${special}${ultimate}${transform}${hit}${guard}</div>${swaps ? '<div class="duel-subs">' + swaps + '</div>' : ''}`;
  }

  function resultText(state, side) {
    if (rewardState === 'failed') {
      return rewardInfo?.reason === 'no-encounter'
        ? '<p role="status">Этого дикого бойца уже победили на другом устройстве, поэтому бой не засчитан.</p>'
        : '<p role="status">Не удалось записать результат в профиль.</p>';
    }
    const info = rewardInfo ?? {};
    if (mode === 'wild') {
      const enemy = name(state.teams[1][0].id);
      const xp = info.partyXp ? ` Команда +${info.partyXp} опыта${info.playerXp ? ', ты +' + info.playerXp : ''}.` : '';
      if (state.winner === side) {
        return `<p><strong>${esc(enemy)} ${info.isNew === false ? 'добавил опыта своей копии' : 'теперь в твоей коллекции'}.</strong>${esc(xp)}</p>`;
      }
      return `<p>${esc(enemy)} ушёл.${esc(xp)} Новый дикий боец появится через 15 минут — или сразу после отметки у заведения.</p>`;
    }
    if (mode === 'trainer') {
      const coach = trainer?.trainer;
      const who = coach ? fullName(coach) : 'Тренер', she = coach?.she;
      const xp = info.playerXp ? ` Ты +${info.playerXp} опыта, каждый боец команды +${info.partyXp}.` : '';
      const line = state.winner === side ? (coach?.lord ? 'Лорд тренеров повержен!' : `${who} ${she ? 'побеждена' : 'побеждён'}!`)
        : state.winner === 'draw' ? 'Ничья с тренером.' : `${who} ${she ? 'оказалась' : 'оказался'} сильнее.`;
      return `<p><strong>${esc(line)}</strong>${esc(xp)}</p>`;
    }
    const xp = state.winner === 'draw' ? ONLINE_XP.draw : state.winner === side ? ONLINE_XP.won : ONLINE_XP.lost;
    return `<p><strong>+${xp} опыта</strong> первому бойцу команды.</p>`;
  }

  function settle(state, side) {
    if (rewardState !== 'idle') return;
    rewardState = 'saving';
    if (mode === 'online') forgetInvite();
    const won = state.winner === side, drawn = state.winner === 'draw';
    // The fanfare once the last blow has played out.
    sfx(drawn ? 'draw' : won ? 'win' : 'lose', Math.max(0, fxUntil - performance.now()) + 250);
    const result = mode === 'wild'
      ? { mode: 'wild', encounterId: wildId, fought: wildFought, won, draw: drawn, teamIds: state.teams[side].map(f => f.id), matchId: localMatchId }
      : mode === 'trainer'
      ? { mode: 'trainer', won, draw: drawn, teamIds: state.teams[side].map(f => f.id), matchId: localMatchId, difficulty: trainer?.difficulty ?? 'normal' }
      : { mode: 'online', won, draw: drawn, xp: drawn ? ONLINE_XP.draw : won ? ONLINE_XP.won : ONLINE_XP.lost,
          cardId: state.teams[side][0].id, teamIds: state.teams[side].map(f => f.id), matchId: room?.matchId };
    Promise.resolve().then(() => award?.(result)).then(saved => {
      if (disposed || (room?.matchId ?? localMatchId) !== result.matchId) return;
      rewardState = saved?.ok === false && saved.reason !== 'already-recorded' ? 'failed' : 'saved';
      rewardInfo = saved ?? null;
      draw();
    }).catch(() => {
      if (disposed || (room?.matchId ?? localMatchId) !== result.matchId) return;
      rewardState = 'failed';
      draw();
    });
  }

  function battleView(state) {
    const side = room?.side ?? 0;
    const settled = state.winner !== null && (!room || room.finished);
    const final = settled && ['saved', 'failed'].includes(rewardState);
    const connected = !room || room.lostAt === null;
    const enabled = connected && state.winner === null && state.turn === side && !quitPrompt && !hold.some(i => i !== null) && !busy();
    const status = !connected ? 'Восстанавливаем связь…' : settled && !final ? 'Сохраняем результат…' : state.winner !== null && !final ? 'Подтверждаем результат…'
      : final ? 'Бой окончен' : state.turn === side ? 'Твой ход' : room ? 'Ход соперника' : 'Соперник думает…';
    const outcome = state.winner === 'draw' ? 'Ничья' : state.winner === side ? 'Победа!' : 'Поражение';
    const title = final ? outcome : LABELS[mode] ?? LABELS.online;
    if (settled) settle(state, side);
    const turnClass = state.winner === null ? (state.turn === side ? ' is-my-turn' : ' is-their-turn') : '';
    return `<header class="duel-bar"><div><span class="duel-label" data-completed-moves="${state.moves}">${esc(status)} · ${state.moves} ${MOVES[plural.select(state.moves)]}</span>
        <h2 class="${final ? 'duel-outcome is-' + (state.winner === side ? 'win' : state.winner === 'draw' ? 'draw' : 'loss') : ''}">${esc(title)}</h2></div>
      ${room && currentPath ? '<small class="duel-note" data-connection="' + currentPath + '">' + (currentPath === 'direct' ? 'Напрямую' : 'Через ретранслятор') + '</small>' : ''}</header>
      <div class="duel-stage${turnClass}">${fighterPanel(state, 1 - side, false)}
        <p class="duel-log" role="status" aria-live="polite">${esc(story(state.last, name, state, snackers(state)))}</p>
        ${fighterPanel(state, side, true)}</div>
      ${!connected ? '<p class="duel-alert">Ходы на паузе. Ждём повторного подключения до ' + (RECONNECT_MS / 1000) + ' секунд.</p>' : ''}
      ${final ? `<div class="duel-result">${resultText(state, side)}
          <div class="duel-buttons">${mode === 'trainer' ? button('trainer-again', 'Новый тренер', { primary: true, icon: 'battle' }) + button('lobby', 'На арену', { icon: 'arrow' }) : button('lobby', 'На арену', { primary: true, icon: 'arrow' })}${mode === 'wild' ? button('map', 'К карте', { icon: 'pin' }) : ''}</div></div>`
        : settled ? '<p class="duel-note" role="status">Записываем результат…</p>'
        : state.winner !== null ? ''
        : controls(state, side, enabled) + (quitPrompt ?
          '<div class="duel-exit"><span>Уйти без награды?</span>' + button('stay', 'Продолжить') + button('quit', 'Уйти') + '</div>' :
          '<div class="duel-footer">' + button('ask-quit', 'Выйти из боя', { quiet: true }) + '</div>')}`;
  }

  const busy = () => fxUntil > performance.now();

  // Whose snack the latest event reports: the engine gives only the sum, so compare with the state
  // before the move (the fighters that had not eaten and now have). Without it: a blow feeds the
  // target, burning and heartburn after the own move feed the mover.
  let previousState = null, snackMemo = null;
  function snackers(state) {
    const event = state.last;
    if (!event?.snack) return [];
    // The engine names the sides that ate in the move itself; snacks on skipped turns come apart.
    if (event.snackSides) return [...new Set(event.snackSides)];
    if (snackMemo?.state === state) return snackMemo.sides;
    const before = previousState?.moves === state.moves - 1 ? previousState : null;
    const fromSkips = new Set(event.skips.filter(skip => skip.snack).map(skip => skip.side));
    let sides = before ? [0, 1].filter(s => !fromSkips.has(s) && state.teams[s].some((f, i) => f.snacked && !before.teams[s][i]?.snacked)) : [];
    if (!sides.length) sides = [(event.burned || event.poisoned || event.leeched) && !event.damage ? event.side : 1 - event.side];
    snackMemo = { state, sides };
    return sides;
  }
  const panel = who => page.querySelector(`.duel-fighter[data-side="${who}"]`);

  // The effects layer is created on the first fight and lives until the arena is closed.
  function effects() {
    fx ??= createFx({
      anchor: who => {
        const rect = panel(who)?.querySelector('.duel-portrait')?.getBoundingClientRect();
        return rect && { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: Math.min(rect.width, rect.height) / 2 };
      },
      shakeTarget: () => page.querySelector('.duel-stage'),
    });
    return fx;
  }

  // Works out the animation for the latest event before the screen is drawn, so the controls
  // stay locked and the bot waits until the move has finished playing.
  function planFor(state, side) {
    const event = state.last;
    if (!event || reduced()) return null;
    const actor = event.side === side ? 'me' : 'foe';
    const card = catalog.get(event.fighter);
    const fighter = state.teams[event.side].find(f => f.id === event.fighter);
    const energyFor = event.command === 'ultimate' ? fighter?.ultimate : event.command === 'transform' ? fighter?.transform?.effect : fighter?.skill;
    const eaters = snackers(state);
    const snack = eaters.length === 1 ? (eaters[0] === event.side ? 'src' : 'tgt') : undefined;
    const plan = movePlan(event, { brand: card?.brand, energyFor, snack });
    plan.alias = { src: actor, tgt: actor === 'me' ? 'foe' : 'me' };
    fxUntil = performance.now() + plan.end;
    clearTimeout(fxTimer);
    fxTimer = setTimeout(draw, plan.end + 20);
    return plan;
  }

  // Sounds on the beats of the animation: the swing, every strike, the effect, the losses after.
  const sfx = (name, delay = 0, strength) => { try { sound?.(name, delay, strength); } catch {} };
  const EFFECT_SOUNDS = [['freeze', 'freeze'], ['sleep', 'sleep'], ['burn', 'burn'], ['toxic', 'toxic'], ['leech', 'leech'],
    ['shield', 'shield'], ['buff', 'buff'], ['charge', 'buff'], ['cleanse', 'heal'], ['sap', 'debuff'], ['weaken', 'debuff'], ['purge', 'debuff']];
  function moveSounds(event, { hit, after, strikes, landed }) {
    if (event.command.startsWith('switch:')) {
      sfx('switch');
      if (event.intimidated?.includes(event.target)) sfx('growl', 300);
    } else if (event.command === 'guard') sfx('guard', 120);
    else {
      if (event.command === 'ultimate') sfx('ultimate');
      else if (event.command === 'special') sfx('whoosh', Math.max(0, hit - 220));
      else if (event.command === 'transform') sfx('transform');
      if (event.effects.includes('shatter')) sfx('shatter', Math.max(0, hit - 120));
      const strength = Math.min(1, (event.damage ?? 0) / 14);
      if (event.damage) {
        for (const t of strikes.slice(0, -1)) sfx('strike', t);
        sfx('hit', landed, strength);
      }
      if (event.blocked || (event.absorbed && !event.damage)) sfx('blocked', hit);
      // At most two effect sounds, so a busy move does not turn into noise.
      EFFECT_SOUNDS.filter(([effect]) => event.effects.includes(effect)).slice(0, 2).forEach(([, name], i) => sfx(name, after + i * 160));
      if (event.heal || event.saved) sfx('heal', after + 120);
      if (event.parting) sfx('strike', hit + 470);
      if (event.moxie) sfx('buff', hit + 560);
    }
    if (event.refresh) sfx('heal', 200);
    if (event.snack) sfx('snack', after + 380);
    if (event.burned || event.poisoned || event.leeched) sfx('tick', after + 340);
  }

  // The actor lunges, the canvas plays the move, and the target flinches when the blow lands.
  function animate(state, side, plan) {
    const event = state.last;
    const motion = !reduced();
    const pop = (who, text, kind, delay = 0, low = false) => {
      const host = panel(who)?.querySelector('.duel-portrait');
      if (!host) return;
      const el = document.createElement('span');
      // Words use the page font: the monospace stack has no Cyrillic on some systems.
      el.className = 'duel-pop is-' + kind + (/\p{L}/u.test(text) ? ' is-word' : '') + (low ? ' is-under' : '');
      el.style.animationDelay = delay + 'ms';
      el.textContent = text;
      host.append(el);
      setTimeout(() => el.remove(), 1300 + delay);
    };
    const later = (fn, delay) => setTimeout(() => { if (!disposed) fn(); }, delay);
    const mark = (who, cls, delay = 0) => {
      const el = panel(who);
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth;
      el.style.setProperty('--act-delay', delay + 'ms');
      el.classList.add(cls);
    };
    if (!event) {
      if (motion) { mark('me', 'act-enter'); mark('foe', 'act-enter'); }
      sfx('start');
      return;
    }
    const actor = event.side === side ? 'me' : 'foe', other = actor === 'me' ? 'foe' : 'me';
    const hit = plan?.impact ?? 160, after = hit + 260;
    // A flurry: the target flinches at every strike and the total shows after the last one.
    const strikes = plan?.strikes ?? [hit];
    const landed = strikes.at(-1);
    if (plan) effects().play(plan.steps, plan.alias);
    moveSounds(event, { hit, after, strikes, landed });
    if (event.command.startsWith('switch:')) {
      mark(actor, 'act-enter');
      if (event.intimidated?.includes(event.target)) { pop(actor, 'Грозный вид', 'info', 300, true); pop(other, 'Атака ↓', 'info', 640); }
    }
    else if (event.command === 'guard') { mark(actor, 'act-guard'); pop(actor, 'Защита', 'info', 120); }
    else {
      if (event.command === 'transform') {
        // The old picture bursts in the flash and the new form pops out of it.
        const host = panel(actor)?.querySelector('.duel-portrait');
        if (motion && host) {
          const old = document.createElement('span');
          old.className = 'duel-morph-old';
          old.setAttribute('aria-hidden', 'true');
          old.innerHTML = artwork(catalog.get(event.fighter));
          host.append(old);
          later(() => old.remove(), TRANSFORM_FLASH + 120);
        }
        mark(actor, 'act-transform');
        pop(actor, 'Трансформация!', 'form', 0);
      } else mark(actor, actor === 'me' ? 'act-lunge-up' : 'act-lunge-down', plan?.lungeAt ?? 0);
      if (event.damage || event.blocked || event.absorbed) {
        mark(other, 'act-hit', hit);
        for (const t of strikes.slice(1)) later(() => mark(other, 'act-hit'), t);
      }
      if (event.hits > 1) pop(other, 'Серия ×' + event.hits, 'info', Math.max(0, hit - 220));
      if (event.damage) pop(other, '−' + event.damage, 'damage', landed);
      else if (event.absorbed) pop(other, 'Щит', 'info', landed);
      if (event.blocked) pop(other, 'Блок', 'info', hit + 260);
      if (event.heal) pop(actor, '+' + event.heal, 'heal', after);
      if (event.recoil) pop(actor, '−' + event.recoil, 'damage', after);
      if (event.effects.includes('burn')) pop(other, 'Горит', 'burn', after);
      if (event.effects.includes('sap')) pop(other, 'Энергия 0', 'info', after);
      if (event.effects.includes('weaken')) pop(other, 'Атака ↓', 'info', after + 140);
      if (event.effects.includes('buff')) pop(actor, 'Атака ↑', 'heal', after + 140);
      if (event.effects.includes('shield')) pop(actor, 'Щит', 'heal', after);
      if (event.effects.includes('cleanse')) pop(actor, 'Очищен', 'heal', after + 140);
      if (event.effects.includes('shatter')) pop(other, 'Щит сбит', 'info', hit - 120);
      if (event.effects.includes('purge')) pop(other, 'Стёрто', 'info', after + 120);
      if (event.effects.includes('freeze')) pop(other, 'Заморожен', 'freeze', after);
      if (event.effects.includes('thaw')) pop(other, 'Оттаял', 'freeze', after);
      if (event.effects.includes('sleep')) pop(other, 'Zzz', 'sleep', after);
      if (event.effects.includes('wake')) pop(other, 'Проснулся!', 'info', landed + 160);
      if (event.effects.includes('toxic')) pop(other, 'Изжога', 'toxic', after + 80);
      if (event.effects.includes('leech')) pop(actor, 'Вытягивает', 'leech', after + 200);
      if (event.effects.includes('charge')) pop(actor, 'Энергия ↑', 'heal', after + 200);
      if (event.effects.includes('immune')) pop(other, 'Иммунитет', 'info', after);
      if (event.thorns) pop(actor, '−' + event.thorns, 'damage', after + 200);
      if (event.saved) pop(other, 'Выстоял!', 'heal', after);
      // The new talents.
      if (event.opener) {
        const bonus = currentFighter(state, event.side).trait?.opener;
        pop(actor, 'Первый удар' + (bonus ? ' +' + bonus : '!'), 'info', Math.max(0, hit - 260), true);
      }
      if (event.fresh) pop(other, 'Свежий: урон ½', 'info', landed + 140, true);
      if (event.parting) { pop(actor, '−' + event.parting, 'damage', hit + 470); pop(actor, 'Прощальный укус', 'info', hit + 520, true); }
      if (event.moxie) pop(actor, 'Атака ↑', 'heal', hit + 600);
    }
    if (event.refresh) { pop(actor, '+' + event.refresh, 'heal', 200); pop(actor, 'Передышка', 'info', 260, true); }
    if (event.snack) {
      const eaters = snackers(state);
      for (const s of eaters) {
        const who = s === side ? 'me' : 'foe', at = who === actor ? after + 420 : hit + 420;
        if (eaters.length === 1) pop(who, '+' + event.snack, 'heal', at);
        pop(who, 'Перекус', 'info', at + 60, true);
      }
    }
    // Losses after the mover's own turn: burning, heartburn, draining (the other side drinks it).
    if (event.burned) pop(actor, '−' + event.burned, 'burn', after + 340);
    if (event.poisoned) pop(actor, '−' + event.poisoned, 'toxic', after + 420);
    if (event.leeched) pop(actor, '−' + event.leeched, 'leech', after + 500);
    if (event.leechHeal) pop(other, '+' + event.leechHeal, 'heal', after + 900);
    // Turns the engine skipped: who misses it, what it still costs, and the moment it is over.
    // A status put on by this very move already has its label, so its skip only gets the ending.
    (plan?.skips ?? []).forEach((shown, i) => {
      const skip = event.skips[i], who = shown.at === 'src' ? actor : other, drinker = who === 'me' ? 'foe' : 'me';
      sfx('skip', shown.start);
      if (!(i === 0 && who === other && event.effects.includes(shown.kind))) pop(who, 'Пропуск хода', shown.kind, shown.start);
      if (skip.burned) pop(who, '−' + skip.burned, 'burn', shown.start + 300, true);
      if (skip.poisoned) pop(who, '−' + skip.poisoned, 'toxic', shown.start + 380, true);
      if (skip.leeched) pop(who, '−' + skip.leeched, 'leech', shown.start + 460, true);
      if (skip.leechHeal) pop(drinker, '+' + skip.leechHeal, 'heal', shown.start + 860);
      if (shown.recovered) pop(who, shown.kind === 'freeze' ? 'Оттаял' : 'Проснулся', shown.kind === 'freeze' ? 'freeze' : 'heal', shown.end, true);
      if (skip.snack) { pop(who, '+' + skip.snack, 'heal', shown.start + 560); sfx('snack', shown.start + 520); }
    });
    const named = event.command === 'transform' ? event.transformed : event.skill;
    if (named && motion) {
      // A transformation names the new form at the flash, when the picture changes.
      const delay = event.command === 'transform' ? TRANSFORM_FLASH : 0;
      const callout = document.createElement('div');
      callout.className = 'duel-callout is-' + actor + (event.command === 'ultimate' ? ' is-ultimate' : event.command === 'transform' ? ' is-transform' : '');
      callout.textContent = named;
      callout.style.animationDelay = delay + 'ms';
      page.querySelector('.duel-stage')?.append(callout);
      setTimeout(() => callout.remove(), 1200 + delay);
    }
  }

  // HP bars slide from the value the player last saw, once the blow of the move has landed.
  function slideBars(state, side, plan) {
    const actor = state.last && (state.last.side === side ? 'me' : 'foe');
    for (const el of page.querySelectorAll('.duel-fighter')) {
      // A flurry takes the health off once its last strike has landed.
      const delay = !plan ? 120 : el.dataset.side === actor ? plan.impact + 260 : plan.strikes?.at(-1) ?? plan.impact;
      el.style.setProperty('--hp-delay', delay + 'ms');
      const bar = el.querySelector('.duel-hp span');
      const key = el.dataset.side + ':' + el.dataset.fighter;
      const to = bar.style.width;
      const from = shownHp.get(key);
      shownHp.set(key, to);
      if (from === undefined || from === to || reduced()) continue;
      bar.style.transition = 'none';
      bar.style.width = from;
      void bar.offsetWidth;
      bar.style.transition = '';
      bar.style.transitionDelay = delay + 'ms';
      bar.style.width = to;
    }
  }

  function draw() {
    if (disposed) return;
    if (room && room.lostAt !== null && !room.reason) transport?.recover(room.peer);
    const state = room?.state ?? local;
    const key = room?.matchId ?? localMatchId;
    const side = room?.side ?? 0;
    const fresh = Boolean(state) && (!lastDrawn || lastDrawn.key !== key || lastDrawn.moves !== state.moves);
    if (fresh) previousState = lastDrawn?.key === key ? lastDrawn.state : null;
    const plan = state && fresh ? planFor(state, side) : null;
    if (fresh && lastDrawn?.key === key && state.moves === lastDrawn.moves + 1) {
      // A knocked-out fighter stays on screen for a moment before the next one comes in.
      for (const s of [0, 1]) {
        const before = lastDrawn.active[s];
        if (state.active[s] !== before && state.teams[s][before].hp <= 0) {
          hold[s] = before;
          sfx('faint', (plan?.strikes?.at(-1) ?? plan?.impact ?? 0) + 250);
        }
      }
      if (hold.some(i => i !== null)) {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          entering = hold.map(i => i !== null);
          hold = [null, null];
          draw();
        }, reduced() ? 200 : Math.max(900, (plan?.end ?? 0) + 250));
      }
    }
    if (state) lastDrawn = { key, moves: state.moves, active: [...state.active], state };
    const previous = document.activeElement;
    const action = page.contains(previous) ? previous?.dataset?.duelAction : null;
    const detailsOpen = page.querySelector('details')?.open;
    let markup;
    if (room?.reason) markup = ended();
    else if (state) markup = battleView(state);
    else if (room) markup = roomView();
    else if (mode === 'online') markup = finder();
    else markup = lobby();
    if (markup !== lastHtml) {
      page.innerHTML = markup;
      lastHtml = markup;
      if (detailsOpen && page.querySelector('details')) page.querySelector('details').open = true;
      if (action) [...page.querySelectorAll('[data-duel-action]')].find(el =>
        el.dataset.duelAction === action && !el.disabled)?.focus({ preventScroll: true });
      if (state) slideBars(state, side, plan);
    }
    if (state && fresh) animate(state, side, plan);
    if (state && entering.some(Boolean) && !reduced()) {
      entering.forEach((on, s) => {
        if (!on) return;
        const who = s === side ? 'me' : 'foe';
        page.querySelector(`.duel-fighter[data-side="${who}"]`)?.classList.add('act-enter');
        // A newcomer with a grim look lowers the other side's attack the moment it arrives.
        if (state.last?.intimidated?.includes(currentFighter(state, s).id) && state.last.entered[s]) {
          effects().play(intimidateFx(260), { src: who, tgt: who === 'me' ? 'foe' : 'me' });
        }
      });
    }
    entering = [false, false];
    navLock(!!room && !room.reason && !room.finished);
    // A wild fight is in progress until its result is saved; device sync waits for it.
    const fighting = !!local && !['saved', 'failed'].includes(rewardState);
    if (fighting !== wildFighting) { wildFighting = fighting; onFightChange?.(fighting); }
  }

  async function copyInvite() {
    const current = room;
    try {
      await navigator.clipboard.writeText(inviteUrl());
      if (room === current) copyStatus = 'Ссылка скопирована. Отправь её другу.';
    } catch {
      if (room !== current) return;
      inviteVisible = true;
      copyStatus = 'Выдели и скопируй ссылку.';
    }
    draw();
    page.querySelector('.duel-share')?.select();
  }

  function click(event) {
    const action = event.target.closest('[data-duel-action]')?.dataset.duelAction;
    if (!action) return;
    if (action.startsWith('pick:')) {
      const id = action.slice(5);
      if (!owned.includes(id) || room?.team) return;
      if (selected.includes(id)) {
        if (selected.length === 1 && !room) return;
        selected = selected.filter(item => item !== id);
      } else if (selected.length < 3) selected.push(id);
      if (!room) saveTeam();
      draw();
    } else if (action.startsWith('card:')) onShowCard?.(action.slice(5));
    else if (action.startsWith('move:')) play(action.slice(5));
    else if (action === 'wild') startWild();
    else if (action === 'trainer') startTrainer();
    else if (action === 'trainer-new') { trainerFor(true); draw(); }
    else if (action === 'trainer-roll') { trainerRoll++; trainerFor(); draw(); }
    else if (action.startsWith('trainer-level:')) { data.setTrainerLevel?.(action.slice(14)); trainerFor(); draw(); }
    else if (action === 'trainer-again') { trainerFor(true); startTrainer(); }
    else if (action === 'online') reset('online');
    else if (action === 'create') openRoom('host', newRoomCode());
    else if (action === 'ready') room?.ready(selected);
    else if (action === 'copy' && room) void copyInvite();
    else if (action === 'ask-quit' || action === 'stay') { quitPrompt = action === 'ask-quit'; draw(); }
    else if (action === 'quit') { room?.cancel('quit'); reset(); }
    else if (action === 'lobby') reset();
    else if (action === 'map') onBack?.();
  }

  page.addEventListener('click', click);
  page.addEventListener('input', event => {
    if (event.target.name === 'code') draftCode = event.target.value;
  });
  page.addEventListener('submit', event => {
    event.preventDefault();
    const code = parseRoomCode(draftCode);
    if (code) openRoom('guest', code);
    else { feedback = 'Введи десять символов кода или полную ссылку приглашения.'; draw(); page.querySelector('#duel-code')?.focus(); }
  });
  const invited = parseRoomCode(location.hash);
  if (initialMode === 'wild') startWild();
  else if (invited && mode === 'online' && owned.length) openRoom('guest', invited);
  else draw();

  const cleanup = () => {
    disposed = true;
    if (wildFighting) { wildFighting = false; onFightChange?.(false); }
    if (room) forgetInvite();
    room?.cancel('left');
    clearTimeout(thinking);
    clearTimeout(holdTimer);
    clearTimeout(fxTimer);
    fx?.destroy();
    stopNetwork();
    page.remove();
  };
  // The shell calls this when the profile changes; only the lobby redraws, never a live fight.
  cleanup.refresh = () => {
    if (disposed || local || room) return;
    sync();
    draw();
  };
  return cleanup;
}
