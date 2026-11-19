export const brands = {
  bk: { name: 'Бургер Кинг', color: '#ffa05b' },
  vkusno: { name: 'Вкусно — и точка', color: '#6dceb0' },
  rostics: { name: 'Rostic’s', color: '#fc7f83' },
  dodo: { name: 'Додо Пицца', color: '#ffad53' },
};

const icons = {
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.2-3.1c-.9-.8-.3-2.3.9-2.3h2.1c2.5 0 3.6-1.8 3.6-4.1C21 6.8 17.2 3 12 3Z"/><circle cx="7.3" cy="11.4" r="1" fill="currentColor"/><circle cx="10.2" cy="7.5" r="1" fill="currentColor"/><circle cx="15.5" cy="7.9" r="1" fill="currentColor"/>',
  radar:
    '<circle cx="12" cy="12" r="8.5"/><path d="M17.9 5.8 12 12"/><path d="M12 7.4a4.6 4.6 0 1 0 4.6 4.6"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  collection:
    '<rect x="7.5" y="4" width="12.5" height="15" rx="2.3"/><path d="m4.8 7.3-1.5 12a2 2 0 0 0 1.7 2l10.1 1M12 10.5l1.7-2 1.8 2-1.8 2.2z"/>',
  battle:
    '<path d="M4 3.5 8.5 5l10 11-2.5 2.4L5 8.3 4 3.5Zm16 0L15.5 5l-3 3.4M8.5 13l-3.1 3.2L8 18.7l3.3-3.1M4 17l3.2 3.3m9-4.1 4 4m-15.9 0L7 17.5m9.5 2.7 3.8-3.8"/>',
  gps: '<circle cx="12" cy="12" r="6.7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 4.2 9 5 9-5M3 16.4l9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  route:
    '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M9 6h6.5a3 3 0 0 1 0 6h-7a3 3 0 0 0 0 6H15"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.8 7.9-2.2 5.7-5.6 2.5 2.3-5.8z"/>',
  star: '<path d="m12 3 2.1 5.5L20 10l-4.1 4.1.4 5.9-4.3-3-5 3 .9-5.9L3 10l6.2-1.5z"/>',
  spark:
    '<path d="m13 3 1.9 5.2 5.3 2-5.3 2.1-1.9 5.2-2.1-5.2-5.2-2.1 5.2-2L13 3Zm-8 12 .9 2.3 2.1.8-2.1.9L5 21l-.9-2-2.1-.9 2.1-.8z"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>',
  minus: '<path d="M5 12h14"/>',
  sort: '<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sound: '<path d="M4 9h4l4-4v14l-4-4H4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M4 9h4l4-4v14l-4-4H4zM16 9l5 6m0-6-5 6"/>',
  speed: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  lock: '<rect x="5.5" y="10" width="13" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  flag: '<path d="M5 21V4c5-4 8 5 14 0v10c-6 4-9-4-14 0"/>',
  heart:
    '<path d="M20.5 6c-2.7-3.2-6-1.7-8.5.7C9.5 4.3 6 2.8 3.5 6c-2.3 3.2.3 7.6 8.5 14 8.2-6.4 10.8-10.8 8.5-14Z"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l4 2"/>',
  locate: '<path d="m3 10 17.5-7-7 17.5-2.2-8.3z"/>',
  resize: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>',
  trophy:
    '<path d="M7 3h10v5c0 4-2.5 7-5 7s-5-3-5-7zM7 5H3c0 4 1.5 6 5.2 6m8-6H21c0 4-1.5 6-5.2 6M12 15v4m-4 2h8"/>',
  bk: '<path d="M4 10.5C4.7 6 8.3 4 12 4s7.3 2 8 6.5ZM4 16.5h16c-.3 2.2-1.5 3.5-4 3.5H8c-2.5 0-3.7-1.3-4-3.5Z" fill="currentColor" stroke="none"/><path d="M4 13.6h3l2-1 3 1.4 2.6-1.3 2.7 1.1H20" stroke-width="2"/>',
  vkusno:
    '<path d="m6 4 5.5 13M11 4l5.5 13" stroke-width="3.5" stroke-linecap="square"/><circle cx="5" cy="17.6" r="2.6" fill="currentColor" stroke="none"/>',
  rostics:
    '<path d="M8.5 14.3c-1.8-3.5-.1-8.3 3.6-9.8 4.2-1.7 8.3 1.2 8.2 5.2 0 3.8-3.6 7-7.4 6.2l-3.6 3.6a2 2 0 0 1-3.5-1.3c-1.7.2-2.8-1.5-1.8-2.8.7-.9 1.7-1 2.5-.6Z"/><path d="M12.5 7.5c.8-.6 1.6-.8 2.3-.8"/>',
  dodo: '<path d="m4.5 19.7 4.3-15c4.6.5 8 2.7 10.9 6.5Z"/><path d="M8.4 8a13.2 13.2 0 0 1 8.4 5"/><circle cx="10" cy="12.6" r="1" fill="currentColor"/>',
};

export function icon(name, size = 20) {
  return (
    '<svg width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (icons[name] || '') +
    '</svg>'
  );
}
export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}
export function brandMark(key, size = 22) {
  return '<span class="brand-mark brand-' + key + '">' + icon(key, size) + '</span>';
}
const decimals = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return Math.round(meters) + ' м';
  return decimals.format(meters / 1000) + ' км';
}
export function formatWait(ms) {
  const total = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(total / 60),
    m = total % 60;
  return h ? h + ' ч' + (m ? ' ' + m + ' мин' : '') : m + ' мин';
}
// A live countdown: minutes and seconds under an hour, hours and minutes above. The app ticks
// every [data-countdown] element once a second, so the page never needs a reload.
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total >= 3600) return formatWait(ms);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}
export function countdown(ms) {
  return '<time data-countdown="' + Math.round(Date.now() + ms) + '">' + formatCountdown(ms) + '</time>';
}
export const rarityNames = {
  common: 'Обычная',
  rare: 'Редкая',
  epic: 'Эпическая',
  legendary: 'Легендарная',
};
