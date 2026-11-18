import { brands, esc, formatWait, icon, rarityNames } from './ui.js';
import { applyMove, battleStats, botMove, currentFighter, legalMoves, MAX_ENERGY, startBattle } from './duel-engine.js';
import { describeSkill } from './fighters.js';
import { DuelRoom, newRoomCode, parseRoomCode, RECONNECT_MS } from './duel-room.js';
import { connectDuel } from './duel-transport.js';

const LABELS = { wild: 'Дикий боец', online: 'Сетевая дуэль' };
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

function artwork(card) {
  const art = card?.image ? `<img src="${esc(card.image)}" alt="" decoding="async" draggable="false">` : '';
  return `<span class="duel-art" style="--team-color:${color(card?.brand)}">${art || icon(card?.brand ?? 'battle', 36)}</span>`;
}

function pips(filled, total, label) {
  const dots = Array.from({ length: total }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('');
  return `<span class="duel-pips" role="img" aria-label="${esc(label)}">${dots}</span>`;
}

const rules = `<details class="duel-rules"><summary>Как идёт бой</summary>
  <p>Ходите по очереди. Удар и защита дают +1 энергии, максимум ${MAX_ENERGY}. Энергия тратится на фирменный приём — у каждого бойца он свой.</p>
  <p>Защита вдвое ослабляет следующий удар, если он не «сквозь защиту». Выбитого бойца сразу заменяет следующий из команды. Замена по своей воле стоит хода.</p>
  <p>Через 48 ходов побеждает команда, у которой осталось больше здоровья. В дуэли с другом у всех базовые характеристики, а команды выравниваются по меньшей.</p></details>`;

// The narrator: one short line about what just happened, from the event the engine produced.
function story(event, name) {
  if (!event) return 'Бей, чтобы копить энергию, и трать её на фирменный приём.';
  const who = name(event.fighter), target = name(event.target);
  const parts = [];
  if (event.command.startsWith('switch:')) parts.push(`${who} уходит. На арену выходит ${target}.`);
  else if (event.command === 'guard') parts.push(`${who} уходит в защиту.`);
  else {
    const opening = event.skill ? `${who}: «${event.skill}».` : `${who} бьёт.`;
    parts.push(opening);
    if (event.damage) parts.push(`${target} −${event.damage} HP${event.executed ? ', добивание' : ''}.`);
    else if (event.command === 'hit' || event.skill && event.blocked) parts.push(`${target} не получает урона.`);
    if (event.blocked) parts.push('Защита смягчила удар.');
    if (event.absorbed) parts.push(`Щит поглотил ${event.absorbed}.`);
    if (event.heal) parts.push(`+${event.heal} HP.`);
    const effects = {
      burn: `${target} горит.`, weaken: `Атака ${target} падает.`, sap: `${target} теряет энергию.`,
      buff: `Атака ${who} растёт.`, shield: `${who} под щитом.`, cleanse: 'Огонь потушен.'
    };
    for (const effect of event.effects) if (effects[effect]) parts.push(effects[effect]);
    if (event.recoil) parts.push(`Отдача −${event.recoil}.`);
  }
  if (event.burned) parts.push(`${who} обжигается: −${event.burned}.`);
  for (const id of event.ko) parts.push(`${name(id)} выбит!`);
  event.entered.forEach((id, side) => { if (id && !event.command.startsWith('switch:')) parts.push(`Выходит ${name(id)}.`); });
  return parts.join(' ');
}

function chips(fighter) {
  const out = [];
  if (fighter.guarding) out.push(['guard', icon('lock', 12) + 'Защита']);
  if (fighter.shield) out.push(['shield', 'Щит ' + fighter.shield]);
  if (fighter.burn) out.push(['burn', 'Горит −' + fighter.burn.dmg + ' × ' + fighter.burn.turns]);
  const shift = fighter.attack - fighter.baseAttack;
  if (shift) out.push([shift > 0 ? 'buff' : 'weaken', 'Атака ' + (shift > 0 ? '+' : '−') + Math.abs(shift)]);
  return out.map(([kind, text]) => `<span class="duel-chip is-${kind}">${text}</span>`).join('');
}

export function mountDuels(container, options) {
  const { read, initialMode, award, onBack, onStateChange, onTeamChange } = options;
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
  let local = null, localMatchId = null, wildId = null, room = null, transport = null, controller = null;
  let thinking = null, pulse = null, waitingHint = null, holdTimer = null;
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

  function reset(next = 'lobby') {
    room?.cancel('left');
    stopNetwork();
    clearTimeout(thinking);
    clearTimeout(holdTimer);
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
    // The player opens a wild fight, and the wild fighter gets no tempo energy for it.
    local = startBattle([selected.map(id => battleStats(catalog.get(id))), [battleStats(enemy)]], 0, { tempo: false });
    localMatchId = newRoomCode() + newRoomCode();
    wildId = wild.id;
    rewardState = 'idle';
    rewardInfo = null;
    quitPrompt = false;
    mode = 'wild';
    draw();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function botTurn() {
    if (disposed || !local || local.winner !== null || local.turn !== 1) return;
    if (hold.some(index => index !== null)) { thinking = setTimeout(botTurn, 250); return; }
    local = applyMove(local, 1, botMove(local));
    draw();
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
    if (local.winner === null) {
      clearTimeout(thinking);
      thinking = setTimeout(botTurn, reduced() ? 300 : 950);
    }
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
      return `<button type="button" class="duel-pick ${number >= 0 ? 'is-selected' : ''}" data-duel-action="pick:${esc(id)}"
        aria-pressed="${number >= 0}" ${locked || (number < 0 && selected.length === 3) ? 'disabled' : ''}>
        ${artwork(card)}<span class="duel-pick-title"><strong>${esc(card.name)}</strong>
        <small>${icon('heart', 11)} ${stats.hp} · ${icon('battle', 11)} ${stats.attack} · ${esc(stats.skill.name)}</small></span>
        <span class="duel-slot">${number < 0 ? '+' : number + 1}</span></button>`;
    }).join('');
    return `<section class="duel-team"><h3>Твоя команда <small>${selected.length} из 3 · выходят по номерам</small></h3>
      <div class="duel-roster">${items}</div></section>`;
  }

  function wildBox() {
    const wild = data.wild;
    if (!wild) {
      const wait = data.wildWaitMs > 0 ? 'Следующий появится через ' + formatWait(data.wildWaitMs) + '. ' : '';
      return `<section class="duel-wild is-empty"><span class="duel-wild-icon">${icon('compass', 24)}</span>
        <div><h3>Дикого бойца пока нет</h3><p>${esc(wait)}Отметься у любого заведения — и рядом сразу появится новый.</p></div></section>`;
    }
    const enemy = wild.opponent(selected.map(id => catalog.get(id)));
    if (!enemy) return '';
    const owns = owned.includes(enemy.id);
    return `<section class="duel-wild" style="--team-color:${color(enemy.brand)}" aria-labelledby="duel-wild-title">
      ${artwork(enemy)}
      <div class="duel-wild-copy">
        <span class="duel-label">Дикий боец · ${esc(brands[enemy.brand]?.name ?? '')}</span>
        <h3 id="duel-wild-title">${esc(enemy.name)}</h3>
        <p class="duel-wild-stats"><span class="rarity ${esc(enemy.rarity)}">${esc(rarityNames[enemy.rarity] ?? '')}</span>
          <span>${icon('heart', 13)} ${enemy.maxHp}</span><span>${icon('battle', 13)} ${enemy.attack}</span></p>
        <p class="duel-wild-skill"><strong>«${esc(enemy.skill.name)}»</strong> ${esc(describeSkill(enemy.skill, enemy.attack))}</p>
      </div>
      <p class="duel-wild-deal">${icon('trophy', 16)}<span>${owns ? 'Победа прокачает его копию в коллекции и даст опыт команде.' : 'Победи — и он перейдёт в твою коллекцию.'}</span></p>
      ${button('wild', 'Сразиться', { primary: true, icon: 'battle', disabled: !selected.length })}
    </section>`;
  }

  function empty() {
    return `<section class="duel-box"><h3>Нет бойцов</h3>
      <p>Отметься у любого заведения на карте — там выпадет первый боец.</p>
      <div class="duel-buttons">${button('map', 'К карте', { primary: true, icon: 'pin' })}</div></section>`;
  }

  function lobby() {
    if (!owned.length) return `<header class="duel-heading"><h2>Арена</h2></header>${empty()}`;
    return `<header class="duel-heading"><h2>Арена</h2></header>${wildBox()}${teamPicker()}
      <section class="duel-friend"><span>${icon('route', 20)}</span><p><strong>С другом по ссылке</strong><small>Честный бой на базовых характеристиках</small></p>
        ${button('online', 'Дуэль с другом')}</section>${rules}`;
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
      </div>${teamPicker(!!room.team, true)}
      <div class="duel-buttons">${button('ready', room.team ? 'Команда готова' : 'Подтвердить команду', { primary: true, disabled: !!room.team || !selected.length, icon: 'check' })}
      ${button('lobby', 'Закрыть комнату', { quiet: true })}</div>${rules}`;
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
    const roster = state.teams[side].map((member, index) =>
      `<i class="${member.hp <= 0 ? 'out' : index === shownIndex(state, side) ? 'here' : ''}"></i>`).join('');
    const pct = Math.round(1000 * fighter.hp / fighter.maxHp) / 10;
    return `<section class="duel-fighter is-${who}${fighter.hp <= 0 ? ' is-ko' : ''}${pct <= 30 && fighter.hp > 0 ? ' is-low' : ''}" data-side="${who}"
        data-fighter="${esc(fighter.id)}" style="--team-color:${color(card?.brand)}" aria-label="${mine ? 'Твой боец' : 'Боец соперника'}: ${esc(card?.name)}">
      <div class="duel-portrait">${artwork(card)}</div>
      <div class="duel-info">
        <div class="duel-name-row"><span class="duel-owner">${mine ? 'Ты' : data.wild && mode === 'wild' ? 'Дикий' : 'Соперник'}</span>
          <span class="duel-roster-dots" aria-label="В строю ${state.teams[side].filter(m => m.hp > 0).length} из ${state.teams[side].length}">${roster}</span></div>
        <h3>${esc(card?.name)}</h3>
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
    const swaps = state.teams[side].map((reserve, index) => index !== state.active[side] && reserve.hp > 0 ?
      `<button type="button" class="duel-swap" data-duel-action="move:switch:${index}" ${enabled ? '' : 'disabled'}>
        ${artwork(catalog.get(reserve.id))}<span>Выпустить ${esc(name(reserve.id))}<small>${reserve.hp} / ${reserve.maxHp} HP</small></span></button>` : '').join('');
    return `<div class="duel-controls">${special}${hit}${guard}</div>${swaps ? '<div class="duel-subs">' + swaps + '</div>' : ''}`;
  }

  function resultText(state, side) {
    if (rewardState === 'failed') return '<p role="status">Не удалось записать результат в профиль.</p>';
    const info = rewardInfo ?? {};
    if (mode === 'wild') {
      const enemy = name(state.teams[1][0].id);
      const xp = info.partyXp ? ` Команда +${info.partyXp} опыта${info.playerXp ? ', ты +' + info.playerXp : ''}.` : '';
      if (state.winner === side) {
        return `<p><strong>${esc(enemy)} ${info.isNew === false ? 'добавил опыта своей копии' : 'теперь в твоей коллекции'}.</strong>${esc(xp)}</p>`;
      }
      return `<p>${esc(enemy)} ушёл.${esc(xp)} Новый дикий боец появится через 15 минут — или сразу после отметки у заведения.</p>`;
    }
    const xp = state.winner === 'draw' ? ONLINE_XP.draw : state.winner === side ? ONLINE_XP.won : ONLINE_XP.lost;
    return `<p><strong>+${xp} опыта</strong> первому бойцу команды.</p>`;
  }

  function settle(state, side) {
    if (rewardState !== 'idle') return;
    rewardState = 'saving';
    const won = state.winner === side, drawn = state.winner === 'draw';
    const result = mode === 'wild'
      ? { mode: 'wild', encounterId: wildId, won, draw: drawn, teamIds: state.teams[side].map(f => f.id), matchId: localMatchId }
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
    const enabled = connected && state.winner === null && state.turn === side && !quitPrompt && !hold.some(i => i !== null);
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
        <p class="duel-log" role="status" aria-live="polite">${esc(story(state.last, name))}</p>
        ${fighterPanel(state, side, true)}</div>
      ${!connected ? '<p class="duel-alert">Ходы на паузе. Ждём повторного подключения до ' + (RECONNECT_MS / 1000) + ' секунд.</p>' : ''}
      ${final ? `<div class="duel-result">${resultText(state, side)}
          <div class="duel-buttons">${button('lobby', 'На арену', { primary: true, icon: 'arrow' })}${mode === 'wild' ? button('map', 'К карте', { icon: 'pin' }) : ''}</div></div>`
        : settled ? '<p class="duel-note" role="status">Записываем результат…</p>'
        : state.winner !== null ? ''
        : controls(state, side, enabled) + (quitPrompt ?
          '<div class="duel-exit"><span>Уйти без награды?</span>' + button('stay', 'Продолжить') + button('quit', 'Уйти') + '</div>' :
          '<div class="duel-footer">' + button('ask-quit', 'Выйти из боя', { quiet: true }) + '</div>')}`;
  }

  // Effects play on the freshly drawn panels: the actor lunges, the target shakes, numbers float up.
  function animate(state, side) {
    const event = state.last;
    const motion = !reduced();
    const panel = who => page.querySelector(`.duel-fighter[data-side="${who}"]`);
    const pop = (who, text, kind, delay = 0) => {
      const host = panel(who)?.querySelector('.duel-portrait');
      if (!host) return;
      const el = document.createElement('span');
      el.className = 'duel-pop is-' + kind;
      el.style.animationDelay = delay + 'ms';
      el.textContent = text;
      host.append(el);
      setTimeout(() => el.remove(), 1300 + delay);
    };
    const mark = (who, cls) => {
      const el = panel(who);
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    };
    if (!event) {
      if (motion) { mark('me', 'act-enter'); mark('foe', 'act-enter'); }
      return;
    }
    const actor = event.side === side ? 'me' : 'foe', other = actor === 'me' ? 'foe' : 'me';
    if (event.command.startsWith('switch:')) mark(actor, 'act-enter');
    else if (event.command === 'guard') { mark(actor, 'act-guard'); pop(actor, 'Защита', 'info'); }
    else {
      mark(actor, actor === 'me' ? 'act-lunge-up' : 'act-lunge-down');
      if (event.damage || event.blocked || event.absorbed) mark(other, 'act-hit');
      if (event.damage) pop(other, '−' + event.damage, 'damage', 160);
      else if (event.absorbed) pop(other, 'Щит', 'info', 160);
      if (event.blocked) pop(other, 'Блок', 'info', 420);
      if (event.heal) pop(actor, '+' + event.heal, 'heal', 260);
      if (event.recoil) pop(actor, '−' + event.recoil, 'damage', 420);
      if (event.effects.includes('burn')) pop(other, 'Горит', 'burn', 420);
      if (event.effects.includes('sap')) pop(other, 'Энергия 0', 'info', 420);
      if (event.effects.includes('weaken')) pop(other, 'Атака ↓', 'info', 560);
      if (event.effects.includes('buff')) pop(actor, 'Атака ↑', 'heal', 560);
      if (event.effects.includes('shield')) pop(actor, 'Щит', 'heal', 420);
    }
    if (event.burned) pop(actor, '−' + event.burned, 'burn', 600);
    if (event.skill && motion) {
      const callout = document.createElement('div');
      callout.className = 'duel-callout is-' + actor;
      callout.textContent = event.skill;
      page.querySelector('.duel-stage')?.append(callout);
      setTimeout(() => callout.remove(), 1200);
    }
  }

  // HP bars slide from the value the player last saw.
  function slideBars() {
    for (const el of page.querySelectorAll('.duel-fighter')) {
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
    if (fresh && lastDrawn?.key === key && state.moves === lastDrawn.moves + 1) {
      // A knocked-out fighter stays on screen for a moment before the next one comes in.
      for (const s of [0, 1]) {
        const before = lastDrawn.active[s];
        if (state.active[s] !== before && state.teams[s][before].hp <= 0) hold[s] = before;
      }
      if (hold.some(i => i !== null)) {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          entering = hold.map(i => i !== null);
          hold = [null, null];
          draw();
        }, reduced() ? 200 : 900);
      }
    }
    if (state) lastDrawn = { key, moves: state.moves, active: [...state.active] };
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
      if (state) slideBars();
    }
    if (state && fresh) animate(state, side);
    if (state && entering.some(Boolean) && !reduced()) {
      entering.forEach((on, s) => {
        if (on) page.querySelector(`.duel-fighter[data-side="${s === side ? 'me' : 'foe'}"]`)?.classList.add('act-enter');
      });
    }
    entering = [false, false];
    navLock(!!room && !room.reason && !room.finished);
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
    } else if (action.startsWith('move:')) play(action.slice(5));
    else if (action === 'wild') startWild();
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
    room?.cancel('left');
    clearTimeout(thinking);
    clearTimeout(holdTimer);
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
