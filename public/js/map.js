import { brands, esc, icon } from './ui.js';
import { GPS_RULES } from './game.js';

export const MOSCOW = Object.freeze({ lat: 55.7592, lon: 37.6123 });
const point = (p) => [p.lat, p.lon];
// Venues closer than this on screen share one pin; tapping it lists every venue inside.
const GROUP_PX = 30;
const MAX_PINS = 80;
// Within this spread a group is one building, so a tap lists venues instead of zooming.
const SAME_PLACE_M = 90;

// OpenStreetMap tiles everywhere. The theme tints the whole tile pane with one CSS filter,
// which the browser composites once, instead of filtering each of dozens of tiles.
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CREDIT =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

export function makeMap({ onPick, venues }) {
  const L = window.L;
  const map = L.map('map', {
    zoomControl: false,
    scrollWheelZoom: true,
    touchZoom: true,
    zoomSnap: 0.25,
    bounceAtZoomLimits: false,
    minZoom: 3,
    maxZoom: 19,
    attributionControl: true,
  }).setView(point(MOSCOW), 14);
  map.attributionControl.setPrefix(false);
  let loaded = 0,
    failed = 0;
  const tiles = L.tileLayer(OSM, {
    maxNativeZoom: 19,
    maxZoom: 19,
    keepBuffer: 3,
    updateWhenZooming: false,
    attribution: CREDIT,
  }).addTo(map);
  const unavailable = document.createElement('div');
  unavailable.className = 'map-empty';
  unavailable.textContent = 'Подложка недоступна · метки работают';
  unavailable.hidden = true;
  document.getElementById('map-card').append(unavailable);
  tiles.on('tileerror', () => {
    failed++;
    if (!loaded && failed >= 4) unavailable.hidden = false;
  });
  tiles.on('tileload', () => {
    loaded++;
    unavailable.hidden = true;
  });

  const paths = L.layerGroup().addTo(map);
  const pins = new Map();
  let brand = 'all',
    selected = null,
    target = null,
    fix = null;
  let playerMarker;

  function pinIcon(group, isSelected, active) {
    const lead = group[0];
    const others = [...new Set(group.map((v) => v.brand))].filter((b) => b !== lead.brand).slice(0, 2);
    const back = others
      .map(
        (b, i) =>
          '<span class="pin-face pin-back" style="--pin:' +
          brands[b].color +
          ';--n:' +
          (i + 1) +
          '">' +
          icon(b, 12) +
          '</span>',
      )
      .join('');
    return L.divIcon({
      className:
        'venue-pin' + (isSelected || active ? ' selected' : '') + (group.length > 1 ? ' grouped' : ''),
      html:
        back +
        '<span class="pin-face" style="--pin:' +
        brands[lead.brand].color +
        '">' +
        icon(lead.brand, 18) +
        '</span>' +
        (group.length > 1 ? '<b class="pin-count">' + group.length + '</b>' : ''),
      iconSize: [36, 38],
      iconAnchor: [18, 37],
    });
  }

  function choose(group, latlng, marker) {
    const spread = Math.max(...group.map((v) => map.distance(point(group[0]), point(v))));
    if (spread > SAME_PLACE_M && map.getZoom() < map.getMaxZoom()) {
      map.flyToBounds(L.latLngBounds(group.map(point)).pad(0.4), { maxZoom: 18, duration: 0.45 });
      return;
    }
    const list = document.createElement('div');
    list.className = 'pin-chooser';
    list.innerHTML =
      '<strong>' +
      group.length +
      ' ' +
      (group.length < 5 ? 'заведения' : 'заведений') +
      ' рядом</strong>' +
      group
        .slice(0, 8)
        .map(
          (v) =>
            '<button type="button" data-venue="' +
            esc(v.id) +
            '"><span class="brand-mark brand-' +
            v.brand +
            '">' +
            icon(v.brand, 16) +
            '</span><span><b>' +
            esc(brands[v.brand].name) +
            '</b><small>' +
            esc(v.address) +
            '</small></span></button>',
        )
        .join('');
    list.addEventListener('click', (e) => {
      const id = e.target.closest('[data-venue]')?.dataset.venue;
      const venue = group.find((v) => v.id === id);
      if (!venue) return;
      map.closePopup();
      onPick(venue);
    });
    marker.closeTooltip();
    L.popup({ className: 'pin-popup', offset: [0, -30], maxWidth: 280, autoPanPadding: [16, 16] })
      .setLatLng(latlng)
      .setContent(list)
      .openOn(map);
  }

  // Group nearby venues on screen, then add, update or remove only the pins that changed.
  function drawLocations() {
    const area = map.getBounds().pad(0.15);
    const center = map.getCenter();
    const candidates = venues.filter(
      (v) => (brand === 'all' || v.brand === brand || v.id === target?.id) && area.contains(point(v)),
    );
    const priority = (v) =>
      v.id === selected?.id ? -2 : v.id === target?.id ? -1 : map.distance(center, point(v));
    candidates.sort((a, b) => priority(a) - priority(b));
    const groups = [];
    for (const venue of candidates) {
      const pos = map.latLngToContainerPoint(point(venue));
      const home = groups.find((g) => g.pos.distanceTo(pos) < GROUP_PX);
      if (home) home.items.push(venue);
      else if (groups.length < MAX_PINS) groups.push({ pos, items: [venue] });
    }
    const keep = new Set();
    for (const { items } of groups) {
      const lead = items[0];
      const isSelected = items.some((v) => v.id === selected?.id),
        active = items.some((v) => v.id === target?.id);
      const key = lead.id;
      const look = items.map((v) => v.id).join(',') + (isSelected ? '|s' : '') + (active ? '|t' : '');
      keep.add(key);
      const existing = pins.get(key);
      if (existing) {
        existing.items = items;
        if (existing.look !== look) {
          existing.look = look;
          existing.marker.setIcon(pinIcon(items, isSelected, active));
          existing.marker.setZIndexOffset(isSelected ? 900 : active ? 850 : 0);
          existing.marker.setTooltipContent(title(items));
        }
        continue;
      }
      const entry = { items, look };
      entry.marker = L.marker(point(lead), {
        icon: pinIcon(items, isSelected, active),
        title: title(items),
        alt: title(items),
        keyboard: true,
        zIndexOffset: isSelected ? 900 : active ? 850 : 0,
      })
        .bindTooltip(title(items), { direction: 'top', offset: [0, -32], className: 'venue-tooltip' })
        .on('click', (e) => {
          if (entry.items.length === 1) onPick(entry.items[0]);
          else choose(entry.items, e.latlng, entry.marker);
        })
        // A double tap on a pin picks the venue twice (making it the target) instead of zooming.
        .on('dblclick', (e) => L.DomEvent.stopPropagation(e))
        .addTo(map);
      pins.set(key, entry);
    }
    for (const [key, entry] of pins) {
      if (keep.has(key)) continue;
      entry.marker.remove();
      pins.delete(key);
    }
  }
  function title(items) {
    if (items.length === 1) return brands[items[0].brand].name + ' · ' + items[0].address;
    const names = [...new Set(items.map((v) => brands[v.brand].name))];
    return items.length + ' рядом: ' + names.join(', ');
  }

  function drawPaths() {
    paths.clearLayers();
    const origin = point(fix || MOSCOW);
    for (const radius of [330, 660])
      L.circle(origin, {
        radius,
        className: 'radar-range',
        color: '#8bd1c0',
        weight: 1,
        dashArray: '3 7',
        opacity: 0.31,
        fill: false,
        interactive: false,
      }).addTo(paths);
    if (target && fix) {
      L.polyline([origin, point(target)], {
        className: 'target-line',
        color: '#c2fa70',
        weight: 2.8,
        dashArray: '6 8',
        opacity: 0.86,
        interactive: false,
      }).addTo(paths);
      L.circle(point(target), {
        radius:
          GPS_RULES.baseRadius +
          (fix.accuracy <= GPS_RULES.maxAccuracy
            ? Math.min(fix.accuracy || 0, GPS_RULES.maxRadiusBonus)
            : 0),
        className: 'target-range',
        color: '#bbef77',
        weight: 1,
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(paths);
    }
    playerMarker = L.marker(origin, {
      icon: L.divIcon({ className: 'user-map-dot' + (fix ? ' live' : ''), iconSize: [14, 14], iconAnchor: [7, 7] }),
      title: fix ? 'Твоя позиция' : 'Центр обзора',
      interactive: false,
      keyboard: false,
      zIndexOffset: 1100,
    }).addTo(paths);
  }

  let frame = 0;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawLocations();
    });
  }
  map.on('moveend', schedule);
  map.on('zoomstart', () => map.closePopup());
  function recenter() {
    map.flyTo(point(fix || MOSCOW), Math.max(14, map.getZoom()), { duration: 0.5 });
  }
  // Wheel events on the toolbar still reach Leaflet. A button tap should only run its own action.
  for (const button of map.getContainer().querySelectorAll('.map-top button, .map-tools button')) {
    L.DomEvent.disableClickPropagation(button);
  }
  document.getElementById('zoom-in').onclick = () => map.zoomIn();
  document.getElementById('zoom-out').onclick = () => map.zoomOut();
  document.getElementById('recenter').onclick = recenter;
  const card = document.getElementById('map-card'),
    expand = document.getElementById('map-size');
  function expanded(value) {
    card.classList.toggle('expanded', value);
    document.body.classList.toggle('map-open', value);
    expand.setAttribute('aria-pressed', String(value));
    expand.setAttribute('aria-label', value ? 'Свернуть карту' : 'Развернуть карту');
    requestAnimationFrame(() => map.invalidateSize());
  }
  expand.onclick = () => expanded(!card.classList.contains('expanded'));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && card.classList.contains('expanded')) expanded(false);
  });
  new ResizeObserver(() => {
    if (card.offsetWidth) map.invalidateSize({ pan: false });
  }).observe(card);
  let centered = false;
  const update = (s, options = {}) => {
    // Follow a confirmed relocation only if the player was looking at the previous position.
    const bounds = map.getBounds();
    const follow = options.follow && fix && s.fix && bounds.contains(point(fix)) && !bounds.contains(point(s.fix));
    const locChanged =
      fix?.lat !== s.fix?.lat || fix?.lon !== s.fix?.lon || fix?.accuracy !== s.fix?.accuracy;
    const pathChanged = locChanged || target?.id !== s.target?.id;
    const marksChanged =
      brand !== s.brand || selected?.id !== s.selected?.id || target?.id !== s.target?.id;
    ({ brand, selected, target, fix } = s);
    if (pathChanged) drawPaths();
    if (options.center || follow) {
      // A hidden map (e.g. the arena was opened first) has no size to animate in.
      if (centered || !card.offsetWidth) map.setView(point(fix || MOSCOW), centered ? Math.max(14, map.getZoom()) : 15);
      else map.flyTo(point(fix || MOSCOW), 15, { duration: 0.8 });
      centered = true;
    } else if (options.focus && selected && !map.getBounds().pad(-0.15).contains(point(selected)))
      map.panTo(point(selected));
    if (marksChanged) schedule();
  };
  drawPaths();
  drawLocations();
  return {
    update,
    setPositionLabel(label, live) {
      const element = playerMarker.getElement();
      element.title = label;
      element.classList.toggle('live', live);
    },
    resize: () => requestAnimationFrame(() => map.invalidateSize({ pan: false })),
    recenter,
  };
}
