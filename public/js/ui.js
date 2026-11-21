export const brands = {
  bk: { name: 'Бургер Кинг', color: '#ffa05b' },
  vkusno: { name: 'Вкусно — и точка', color: '#6dceb0' },
  rostics: { name: 'Rostic’s', color: '#fc7f83' },
  dodo: { name: 'Додо Пицца', color: '#ffad53' },
};

// The filled signs remain distinct on the smallest map pins and fighter stats.
const icons = {
  logo: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M12 1.5a8.5 8.5 0 0 0-8.5 8.5c0 4.4 3.8 8.5 8.5 12.5 4.7-4 8.5-8.1 8.5-12.5A8.5 8.5 0 0 0 12 1.5Zm-4.3 4h1.8V9h1.6V5.5h1.8V9h1.6V5.5h1.8v3.3c0 2-1.2 3.5-3.2 4v4.5h-2.2v-4.5c-2-.5-3.2-2-3.2-4Z"/>',
  palette: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><path d="m12 12 7-7"/><circle cx="9" cy="15" r="1.6" fill="currentColor" stroke="none"/>',
  collection: '<path d="M20 4H8v13h12ZM4 8v13h12"/><path d="m14 7-3 3.5 3 3.5 3-3.5Z" fill="currentColor" stroke="none"/>',
  battle: '<path d="m8.5 13.5 9-10H21v3.7l-10 9.3Z" fill="currentColor" stroke="none"/><path d="m6.5 11.5 6 6m-3-3-6 6"/>',
  gps: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>',
  pin: '<path d="M19 9.5c0 4.5-4 8.7-7 11.5-3-2.8-7-7-7-11.5a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9.5" r="2.4" fill="currentColor" stroke="none"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5Zm0 5 9 5 9-5M3 17.5l9 5 9-5"/>',
  grid: '<path d="M4 4h6.5v6.5H4Zm9.5 0H20v6.5h-6.5ZM4 13.5h6.5V20H4Zm9.5 0H20V20h-6.5Z" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  route: '<path d="M6 8v5a4 4 0 0 0 4 4h8"/><circle cx="6" cy="5.5" r="2.5"/><path d="m15 12 5 5-5 5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m16.8 7.2-3 6.6-6.6 3 3-6.6Z" fill="currentColor" stroke="none"/>',
  star: '<path d="m12 2.4 2.9 6.1 6.7.9-4.9 4.7 1.2 6.7-5.9-3.2-5.9 3.2 1.2-6.7-4.9-4.7 6.7-.9Z" fill="currentColor" stroke="none"/>',
  spark: '<path d="m14.3 2-8.7 12h5.8l-1.5 8 9.4-13.3h-6.1Z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  sort: '<path d="M4 5h9M4 10h6M4 15h3M17 5v14m-4-4 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sound: '<path d="M3 9h4l5-4v14l-5-4H3Z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7m2.8-10a9 9 0 0 1 0 13"/>',
  muted: '<path d="M3 9h4l5-4v14l-5-4H3Z" fill="currentColor" stroke="none"/><path d="m16 9.5 5 5m0-5-5 5"/>',
  speed: '<path d="M4 18a9 9 0 1 1 16 0M12 15l4-5"/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/>',
  transform: '<path d="M4 10a8 8 0 0 1 13-4l2 2m0-5v5h-5M20 14a8 8 0 0 1-13 4l-2-2m0 5v-5h5"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/>',
  check: '<path d="m4.5 12.5 5 5L20 7"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="8" r="1.25" fill="currentColor" stroke="none"/><path d="M12 11.5v5"/>',
  flag: '<path d="M5 21V3m0 1h14l-4 4 4 4H5Z"/>',
  heart: '<path d="M12 20.5 4.3 13a5.9 5.9 0 0 1 7.7-8.7 5.9 5.9 0 0 1 7.7 8.7Z" fill="currentColor" stroke="none"/>',
  time: '<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5V12l4 2.5"/>',
  locate: '<path d="m20.5 3.5-6.7 18-2.5-8.8-8.8-2.5Z" fill="currentColor" stroke="none"/>',
  resize: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0ZM7 5H3v2a5 5 0 0 0 5 5m9-7h4v2a5 5 0 0 1-5 5m-4 2v5m-4 1h8"/>',
  bk: '<path d="M3 10a9.2 9.2 0 0 1 18 0Zm0 3h18v2H3Zm1 4h16a4 4 0 0 1-4 3.5H8A4 4 0 0 1 4 17Z" fill="currentColor" stroke="none"/>',
  vkusno: '<path d="m7 3 6.5 14.5M13 3l6.5 14.5" stroke-width="3.5"/><circle cx="5.4" cy="17.5" r="3" fill="currentColor" stroke="none"/>',
  rostics: '<path d="M10.4 6.3a6.5 6.5 0 0 1 11 5.1c-.3 3.5-3.7 5.7-7.3 5.4l-2.7-2.7c-2.5-2.7-3.1-5.2-1-7.8ZM10 13.5 6.8 16a2.4 2.4 0 1 0-2.3 4.1 2.4 2.4 0 0 0 4.6-.9l3.2-3"/>',
  dodo: '<path d="m4 20 4-17a18 18 0 0 1 13 9ZM7 7.5a14.5 14.5 0 0 1 10.2 6.5"/><circle cx="10.2" cy="12.6" r="1.4" fill="currentColor" stroke="none"/>',
};

export function icon(name, size = 20) {
  return (
    '<svg width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="round" aria-hidden="true">' +
    (icons[name] || '') +
    '</svg>'
  );
}
// The violet corner mark of a fighter that can transform (collection, deck, arena, dialogs).
export function transformBadge(size = 12) {
  return '<span class="tf-badge" role="img" aria-label="Есть трансформация" title="Есть трансформация">' + icon('transform', size) + '</span>';
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
