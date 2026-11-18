import { brands, esc, icon } from './ui.js';
import { applyMove, battleStats, botMove, currentFighter, legalMoves, startBattle } from './duel-engine.js';
import { DuelRoom, newRoomCode, parseRoomCode, RECONNECT_MS } from './duel-room.js';
import { connectDuel } from './duel-transport.js';

const LABELS = { training: 'Тренировка', encounter: 'Дикая встреча', online: 'Сетевая дуэль' };
const movePlural = new Intl.PluralRules('ru');
const moveForms = { one: 'ход', few: 'хода', many: 'ходов', other: 'хода' };

function button(action, title, options = {}) {
  const variant = options.primary ? ' duel-primary' : '';
  return `<button type="button" class="duel-btn${variant}" data-duel-action="${esc(action)}" ${options.disabled ? 'disabled' : ''}>
    ${options.icon ? icon(options.icon, 18) : ''}<span>${esc(title)}</span></button>`;
}

function artwork(card) {
  const art = card.image ? `<img src="${esc(card.image)}" alt="" decoding="async">` : '';
  return `<span class="duel-art" style="--team-color:${brands[card.brand]?.color ?? '#b6c97d'}">
    ${art || icon(card.brand, 36)}</span>`;
}

function lastMove(state, catalog) {
  const event = state.last;
  if (!event) return 'Выведи всех бойцов соперника из игры.';
  const name = catalog.get(event.fighter)?.name;
  const target = catalog.get(event.target)?.name;
  if (event.command === 'guard') return `${name} включает защиту.`;
  if (event.command.startsWith('switch:')) return `На арену выходит ${target}.`;
  if (event.command === 'special') return `${name} пробивает защиту. Урон −${event.damage}.`;
  return `${name} атакует. ${target} теряет ${event.damage} HP.`;
}

function fighterPanel(state, side, mine, catalog) {
  const fighter = currentFighter(state, side);
  const card = catalog.get(fighter.id);
  const remaining = state.teams[side].filter(item => item.hp > 0).length;
  return `<section class="duel-fighter ${mine ? 'is-mine' : 'is-opponent'}" aria-label="${mine ? 'Твоя команда' : 'Команда соперника'}">
    <div class="duel-fighter-head"><span>${mine ? 'Твоя команда' : 'Соперник'}</span><span>${remaining}/${state.teams[side].length}</span></div>
    ${artwork(card)}
    <span class="duel-brand">${esc(brands[card.brand]?.name ?? card.brand)}</span>
    <h3>${esc(card.name)}</h3>
    <div class="duel-hp"><span style="width:${100 * fighter.hp / fighter.maxHp}%"></span></div>
    <div class="duel-vitals"><span>${fighter.hp} / ${fighter.maxHp} HP</span><span title="Энергия">${icon('spark', 13)} ${fighter.charge}/2</span></div>
    ${fighter.guarding ? '<div class="duel-shield">Защита активна</div>' : ''}
  </section>`;
}

function controls(state, side, enabled, catalog) {
  const allowed = new Set(legalMoves(state));
  const fighter = currentFighter(state, side);
  const moves = [
    ['hit', 'Атака', `${fighter.attack} урона · +1 к энергии`, 'battle'],
    ['guard', 'Защита', '½ входящего удара · +1 к энергии', 'lock'],
    ['special', 'Фирменный удар', `${fighter.attack + 3} урона сквозь защиту · 2 энергии`, 'spark']
  ];
  const actions = moves.map(([command, name, hint, glyph]) =>
    `<button type="button" class="duel-move" data-duel-action="move:${command}" ${enabled && allowed.has(command) ? '' : 'disabled'}>
      <span class="duel-glyph">${icon(glyph, 20)}</span><span><strong>${name}</strong><small>${hint}</small></span>
    </button>`).join('');
  const swaps = state.teams[side].map((reserve, index) => index !== state.active[side] && reserve.hp > 0 ?
    button('move:switch:' + index, 'Замена — ' + catalog.get(reserve.id).name, { disabled: !enabled, icon: 'route' }) : '').join('');
  return `<div class="duel-controls">${actions}</div>${swaps ? '<div class="duel-subs">' + swaps + '</div>' : ''}`;
}

const rules = `<details class="duel-rules"><summary>Правила боя</summary><p>Игроки ходят по очереди. В команде от одного до трёх бойцов. В дуэли размер обеих команд равен размеру меньшей. Бойцы выходят в выбранном порядке.</p>
  <p>Атака и защита дают по единице энергии. Защита вдвое уменьшает урон следующей обычной атаки. Фирменный удар расходует две единицы энергии и пробивает защиту. Замена стоит один ход.</p>
  <p>Побеждает команда, которая вывела всех соперников. После 48 ходов сравнивается доля оставшегося здоровья команд. Равенство даёт ничью. В сетевой игре характеристики соответствуют первому уровню.</p></details>`;

export function mountDuels(container, options) {
  const { cards, ownedIds, initialCardId, encounterCardId, initialMode, award, onBack, onStateChange } = options;
  const catalog = new Map(cards.map(card => [card.id, card]));
  const owned = [...new Set(ownedIds)].filter(id => catalog.has(id));
  const preferred = [initialCardId, ...(options.initialTeamIds ?? [])].filter(id => owned.includes(id));
  let selected = preferred.length ? [...new Set(preferred)].slice(0, 3) : owned.slice(0, 1);
  let mode = initialMode || 'lobby';
  let local = null, localMatchId = null, room = null, transport = null, controller = null;
  let thinking = null, pulse = null, waitingHint = null;
  let disposed = false, rewardState = 'idle', quitPrompt = false, slow = false;
  let inviteVisible = false, copyStatus = '', connectionError = '', feedback = '', currentPath = '';
  let guardedNav = false, demo = false, draftCode = '';
  const page = document.createElement('div');
  page.className = 'duel-page';
  container.replaceChildren(page);

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
    local = null;
    localMatchId = null;
    mode = next;
    rewardState = 'idle';
    demo = quitPrompt = slow = inviteVisible = false;
    copyStatus = connectionError = feedback = currentPath = '';
    draw();
  }

  function startLocal(kind) {
    if (!cards.length || (kind === 'encounter' && !owned.length)) { draw(); return; }
    demo = owned.length === 0;
    const ids = selected.length ? selected : [demo ? cards[0].id : owned[0]];
    const squad = kind === 'encounter' ? [ids[0]] : ids;
    const opponents = cards.filter(card => !squad.includes(card.id));
    const guest = catalog.get(encounterCardId) ?? opponents[0] ?? cards[0];
    const enemyCards = kind === 'encounter' ? [guest] : (opponents.length ? opponents : cards).slice(0, squad.length);
    const enemies = enemyCards.map(card => {
      const stats = battleStats(card, true);
      if (kind === 'training') return { ...stats, hp: Math.max(6, Math.ceil(stats.hp * .7)), attack: Math.max(1, stats.attack - 1) };
      return stats;
    });
    local = startBattle([squad.map(id => battleStats(catalog.get(id))), enemies]);
    localMatchId = newRoomCode() + newRoomCode();
    rewardState = 'idle';
    quitPrompt = false;
    mode = kind;
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
      thinking = setTimeout(() => {
        if (disposed || !local || local.winner !== null || local.turn !== 1) return;
        local = applyMove(local, 1, botMove(local));
        draw();
      }, 480);
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
    quitPrompt = slow = false;
    feedback = connectionError = '';
    controller = new AbortController();
    const current = new DuelRoom({
      code, role, cards, send: (peer, packet) => transport?.send(peer, packet),
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
        ${artwork(card)}<span class="duel-pick-title"><strong>${esc(card.name)}</strong><small>${stats.attack} атаки · ${stats.hp} HP</small></span>
        <span class="duel-slot">${number < 0 ? '+' : number + 1}</span></button>`;
    }).join('');
    return `<section class="duel-team"><h3>Твоя команда <small>${selected.length}/3</small></h3>
      <p class="duel-note">Первым выходит боец под номером 1.</p><div class="duel-roster">${items}</div></section>`;
  }

  function empty() {
    return `<section class="duel-box"><h3>Собери первую карту</h3>
      <p>Выбери ресторан на карте и забери находку на месте. Она попадёт в твою команду.</p>
      <div class="duel-buttons">${button('map', 'К локатору', { primary: true, icon: 'pin' })}
      ${cards.length && mode !== 'encounter' ? button('practice', 'Пробный бой', { icon: 'battle' }) : ''}</div></section>`;
  }

  function lobby() {
    return `<header class="duel-heading"><h2>Арена</h2><p>Собери команду и выбери соперника.</p></header>
      ${owned.length ? teamPicker() + '<div class="duel-buttons">' + button('practice', 'Тренировка', { primary: true, icon: 'battle', disabled: !selected.length }) + button('online', 'Дуэль с другом', { icon: 'route' }) + '</div>' : empty()}${rules}`;
  }

  function finder() {
    return `<header class="duel-heading"><h2>Дуэль с другом</h2><p>Открой комнату или введи код приглашения.</p></header>
      ${owned.length ? `<div class="duel-box"><div class="duel-buttons">${button('create', 'Создать комнату', { primary: true, icon: 'plus' })}</div>
        <form class="duel-join"><label for="duel-code">Код или ссылка</label><div><input id="duel-code" name="code" autocapitalize="characters" autocomplete="off"
        spellcheck="false" placeholder="XXXXX-XXXXX" maxlength="512" value="${esc(draftCode)}" required><button class="duel-btn" type="submit">Войти</button></div></form></div>` : empty()}
      ${feedback ? '<p class="duel-alert" role="status">' + esc(feedback) + '</p>' : ''}${button('lobby', 'Назад к арене')}`;
  }

  function inviteUrl() {
    const url = new URL(location.href);
    url.hash = 'duel=' + room.code;
    return url.href;
  }

  function roomView() {
    if (room.reason) return ended();
    const peerStatus = room.lostAt !== null ? 'Восстанавливаем связь с соперником…'
      : room.peerTeam ? 'Соперник готов к бою' : room.peer ? 'Соперник выбирает команду' : 'Ждём второго игрока';
    return `<header class="duel-heading"><h2>Комната дуэли</h2><p role="status">${esc(peerStatus)}</p></header>
      <div class="duel-box"><span class="duel-label">Код приглашения</span>
        <output class="duel-room-code" data-room-code="${room.code}">${room.code.slice(0,5)}-${room.code.slice(5)}</output>
        <div class="duel-buttons">${button('copy', 'Скопировать ссылку', { icon: 'route' })}</div>
        ${inviteVisible ? '<input class="duel-share" aria-label="Ссылка на комнату" readonly value="' + esc(inviteUrl()) + '">' : ''}
        ${copyStatus ? '<p class="duel-note" role="status">' + esc(copyStatus) + '</p>' : ''}
        ${connectionError && !room.peer ? '<p class="duel-alert" role="status">' + esc(connectionError) + '</p>' : ''}
        ${slow && !room.peer ? '<p class="duel-note">Проверь, что друг открыл тот же код. Если соединение долго не появляется, попробуй другую сеть.</p>' : ''}
      </div>${teamPicker(!!room.team, true)}
      <div class="duel-buttons">${button('ready', room.team ? 'Команда готова' : 'Подтвердить команду', { primary: true, disabled: !!room.team || !selected.length, icon: 'check' })}
      ${button('lobby', 'Закрыть комнату')}</div>${rules}`;
  }

  function ended() {
    const detail = {
      timeout: 'Связь с соперником не восстановилась за 25 секунд.',
      left: 'Соперник закрыл комнату.',
      quit: 'Один из игроков покинул бой.',
      version: 'На устройствах разные версии каталога. Обнови игру и попроси друга сделать то же самое.'
    };
    return `<section class="duel-box" role="status"><h2>Матч отменён</h2><p>${esc(detail[room.reason] ?? detail.left)} Матч завершён без награды.</p>
      ${button('lobby', 'Вернуться на арену', { primary: true })}</section>`;
  }

  function battleView(state) {
    const side = room?.side ?? 0;
    const settled = state.winner !== null && (!room || room.finished);
    const final = settled && (demo || ['saved', 'failed'].includes(rewardState));
    const connected = !room || room.lostAt === null;
    const enabled = connected && state.winner === null && state.turn === side && !quitPrompt;
    const status = !connected ? 'Восстанавливаем связь…' : settled && !final ? 'Сохраняем результат…' : state.winner !== null && !final ? 'Подтверждаем результат…'
      : final ? 'Матч завершён' : state.turn === side ? 'Твой ход' : 'Ход соперника';
    const title = final ? state.winner === 'draw' ? 'Ничья' : state.winner === side ? 'Победа!' : 'Поражение' : LABELS[mode];
    const xp = mode === 'encounter' || demo ? 0 : state.winner === 'draw' ? 6 : state.winner === side ? (room ? 24 : 16) : 4;
    if (settled && !demo && rewardState === 'idle') {
      rewardState = 'saving';
      const result = {
        mode, xp, won: state.winner === side, draw: state.winner === 'draw',
        cardId: state.teams[side][0].id, teamIds: state.teams[side].map(card => card.id), matchId: room?.matchId ?? localMatchId
      };
      Promise.resolve().then(() => award?.(result)).then(saved => {
        if (disposed || (room?.matchId ?? localMatchId) !== result.matchId) return;
        rewardState = saved?.ok === false && saved.reason !== 'already-recorded' ? 'failed' : 'saved';
        draw();
      }).catch(() => {
        if (disposed || (room?.matchId ?? localMatchId) !== result.matchId) return;
        rewardState = 'failed';
        draw();
      });
    }
    return `<header class="duel-heading"><span class="duel-label" data-completed-moves="${state.moves}">${esc(status)} · ${state.moves} ${moveForms[movePlural.select(state.moves)]}</span><h2>${esc(title)}</h2>
      ${room && currentPath ? '<small class="duel-note" data-connection="' + currentPath + '">' + (currentPath === 'direct' ? 'Прямое соединение' : 'Связь через ретранслятор') + '</small>' : ''}</header>
      <div class="duel-field">${fighterPanel(state, side, true, catalog)}${fighterPanel(state, 1 - side, false, catalog)}</div>
      <p class="duel-log" role="status">${esc(lastMove(state, catalog))}</p>
      ${!connected ? '<p class="duel-alert">Ходы приостановлены. Ждём повторного подключения до ' + (RECONNECT_MS / 1000) + ' секунд.</p>' : ''}
      ${final ? `<div class="duel-result">${rewardState === 'failed' ? '<p role="status">Не удалось подтвердить запись результата в профиль.</p>' : xp ? '<strong>+' + xp + ' опыта</strong>' : ''}${demo ? '<p>Пробный бой завершён. Получи свою карту в ресторане.</p>' : ''}
          ${button('lobby', 'Вернуться на арену', { primary: true, icon: 'arrow' })}</div>`
        : settled ? '<p class="duel-note" role="status">Записываем результат боя в профиль…</p>'
        : controls(state, side, enabled, catalog) + (quitPrompt ?
          '<div class="duel-exit"><span>Завершить бой без награды?</span>' + button('stay', 'Продолжить') + button('quit', 'Покинуть бой') + '</div>' :
          '<div class="duel-footer">' + button('ask-quit', 'Выйти из боя') + '</div>')}
      ${rules}`;
  }

  function draw() {
    if (disposed) return;
    if (room && room.lostAt !== null && !room.reason) transport?.recover(room.peer);
    const previous = document.activeElement;
    const action = page.contains(previous) ? previous?.dataset?.duelAction : null;
    const detailsOpen = page.querySelector('details')?.open;
    const state = room?.state ?? local;
    let markup;
    if (room?.reason) markup = ended();
    else if (state) markup = battleView(state);
    else if (room) markup = roomView();
    else if (mode === 'online') markup = finder();
    else markup = lobby();
    page.innerHTML = markup;
    if (detailsOpen && page.querySelector('details')) page.querySelector('details').open = true;
    if (action) [...page.querySelectorAll('[data-duel-action]')].find(el =>
      el.dataset.duelAction === action && !el.disabled)?.focus({ preventScroll: true });
    navLock(!!room && !room.reason && !room.finished);
  }

  async function copyInvite() {
    const current = room;
    try {
      await navigator.clipboard.writeText(inviteUrl());
      if (room === current) copyStatus = 'Ссылка скопирована.';
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
      if (selected.includes(id)) selected = selected.filter(item => item !== id);
      else if (selected.length < 3) selected.push(id);
      draw();
    } else if (action.startsWith('move:')) play(action.slice(5));
    else if (action === 'practice') startLocal('training');
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
  if (initialMode === 'training' || initialMode === 'encounter') startLocal(initialMode);
  else if (invited && mode === 'online' && owned.length) openRoom('guest', invited);
  else draw();

  return () => {
    disposed = true;
    room?.cancel('left');
    clearTimeout(thinking);
    stopNetwork();
    page.remove();
  };
}
