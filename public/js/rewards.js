import { brands, esc, icon, rarityNames } from './ui.js';
import { describeSkill } from './fighters.js';

const REEL_SIZE = 17;
const WINNING_INDEX = 14;

function banner(brand, label) {
  const mark = Object.hasOwn(brands, brand) ? icon(brand, 20) : icon('collection', 20);
  return `<header class="find-banner"><span class="find-brand-symbol">${mark}</span>
    <span>${esc(label)}</span></header>`;
}

export function reelMarkup(pool, winningCard, brandName) {
  const items = pool.length ? pool : [winningCard];
  const pictures = Array.from({ length: REEL_SIZE }, (_, index) => {
    const card = index === WINNING_INDEX ? winningCard : items[index % items.length];
    return `<img src="${esc(card.image)}" width="82" height="80" alt="" decoding="async" draggable="false">`;
  }).join('');

  return `<section class="find-sheet find-reel" aria-labelledby="find-reel-title">
    ${banner(winningCard.brand, brandName)}
    <div class="find-reel-content">
      <h2 id="find-reel-title">Рулетка находок</h2>
      <div class="find-track" aria-hidden="true">
        <div class="roulette"><div class="reel-strip">${pictures}</div></div>
      </div>
      <p class="find-spin-status" role="status">${icon('spark', 17)} Открываем находку…</p>
    </div>
  </section>`;
}

function stat(label, value) {
  return `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
}

// `daily` turns the card into a login reward: a note instead of the visit XP, and one button that
// goes to the next spin.
export function rewardMarkup(result, wildName = '', daily = null) {
  const { card } = result;
  const brand = brands[card.brand]?.name ?? card.brand;
  const rarity = rarityNames[card.rarity] ?? card.rarity;
  const health = card.maxHp ?? card.hp;
  const outcome = result.isNew ? 'Новый боец в коллекции' : result.leveledUp ? 'Повтор — боец вырос в уровне' : 'Повтор — опыт бойцу';
  const xp = result.routeCompleted ? 'с бонусом за маршрут дня' : 'за посещение';
  const skill = card.skill;
  return `<article class="find-sheet find-card" aria-labelledby="find-card-title">
    ${banner(card.brand, brand)}
    <div class="find-stage">
      <div class="find-art"><img src="${esc(card.image)}" alt="${esc(card.name)}" decoding="async" draggable="false"></div>
      <div class="find-stage-copy">
        <span class="find-rarity">${icon('star', 14)} ${esc(rarity)}</span>
        <h2 id="find-card-title">${esc(card.name)}</h2>
      </div>
    </div>
    <div class="find-body">
      <div class="find-outcome">${icon('collection', 17)}<strong>${outcome}</strong></div>
      <dl class="find-stats" aria-label="Характеристики бойца">
        ${stat('Атака', card.attack)}${stat('Здоровье', health)}${stat('Скорость', card.speed ?? 5)}${stat('Уровень', card.level)}
      </dl>
      ${skill ? `<p class="find-effect"><strong>«${esc(skill.name)}»</strong> ${esc(describeSkill(skill, card.attack))}</p>` : ''}
      ${daily
        ? `<p class="find-xp">${icon('star', 16)}<span>${esc(daily.note)}</span></p>
      <div class="find-actions">
        <button type="button" class="primary" data-daily-next>${icon(daily.next === 'Готово' ? 'check' : 'spark', 18)} ${esc(daily.next)}</button>
      </div>`
        : `<p class="find-xp">${icon(result.routeCompleted ? 'route' : 'spark', 16)}<span><strong>+${esc(result.playerXp)} опыта</strong> ${xp}</span></p>
      ${wildName ? `<p class="find-wild">${icon('battle', 16)}<span>${result.spawned ? 'Рядом появился дикий боец' : 'Тебя ждёт дикий боец'} — <strong>${esc(wildName)}</strong>. Победи его на арене.</span></p>` : ''}
      <div class="find-actions">
        <button type="button" class="primary" data-close>${icon('check', 18)} Забрать</button>
        <button type="button" class="outline-btn" data-wild>${icon('battle', 17)} На арену</button>
      </div>`}
    </div>
  </article>`;
}
