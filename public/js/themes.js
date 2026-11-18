import { icon } from './ui.js';

export const DEFAULT_THEME = 'black';
export const themes = {
  chili: {
    name: 'Острый соус',
    description: 'Вишня, чили и сливки',
    colors: ['#24131C', '#FF5159', '#C998A6', '#F9EDE2'],
  },
  oven: {
    name: 'После печи',
    description: 'Эспрессо, мандарин и базилик',
    colors: ['#251B17', '#FF8B3D', '#96C486', '#FFEBCB'],
  },
  green: {
    name: 'Зелёное комбо',
    description: 'Хвойный, мята и мандарин',
    colors: ['#10372D', '#91D4AF', '#FF965C', '#F7EBCF'],
  },
  grill: {
    name: 'На гриле',
    description: 'Шоколад, чеддер и томат',
    colors: ['#301A12', '#FFAA00', '#D62300', '#F5EBDC'],
  },
  black: {
    name: 'Чёрный',
    description: 'Чёрный фон, акцент цели',
    colors: ['#000000', '#264F36', '#E4002B', '#FFAA00', '#FF6400'],
  },
  white: {
    name: 'Белый',
    description: 'Белый фон, акцент цели',
    colors: ['#FFFFFF', '#264F36', '#E4002B', '#FFAA00', '#FF6400'],
  },
};

// Preserve the network color for the solid action and provide readable text on both canvases.
const destinationAccents = {
  bk: { color: '#FFAA00', ink: '#191107', dark: '#FFAA00', light: '#785000' },
  vkusno: { color: '#264F36', ink: '#FFFFFF', dark: '#9AD4A5', light: '#264F36' },
  rostics: { color: '#E4002B', ink: '#FFFFFF', dark: '#FF7586', light: '#B70025' },
  dodo: { color: '#FF6400', ink: '#171008', dark: '#FF883C', light: '#973600' },
};

export function normalizeTheme(value) {
  return typeof value === 'string' && Object.hasOwn(themes, value) ? value : DEFAULT_THEME;
}

export function applyAppearance(value, destination) {
  const theme = normalizeTheme(value);
  const brand = Object.hasOwn(destinationAccents, destination) ? destination : 'none';
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accentBrand = brand;
  const light = theme === 'white';
  const accent =
    destinationAccents[brand] ??
    (light
      ? { color: '#141414', ink: '#FFFFFF', light: '#141414' }
      : { color: '#F4F4F4', ink: '#111111', dark: '#F4F4F4' });
  root.style.setProperty('--brand-color', accent.color);
  root.style.setProperty('--brand-ink', accent.ink);
  root.style.setProperty('--brand-readable', light ? accent.light : accent.dark);
  document.querySelector('meta[name="theme-color"]').content = themes[theme].colors[0];
}

export function themeOptions(current) {
  return Object.entries(themes)
    .map(([id, { name, description, colors }]) => {
      const samples = colors.map((color) => '<i style="background:' + color + '"></i>').join('');
      return `<button type="button" class="theme-option" data-pick-theme="${id}" aria-pressed="${id === current}" style="--preview-bg:${colors[0]};--preview-ink:${id === 'white' ? '#151515' : colors.at(-1)}">
      <span class="theme-swatches" aria-hidden="true">${samples}</span>
      <span class="theme-name">${name}</span>
      <span class="theme-description">${description}</span>
      <span class="theme-check" aria-hidden="true">${icon('check', 15)}</span>
    </button>`;
    })
    .join('');
}
