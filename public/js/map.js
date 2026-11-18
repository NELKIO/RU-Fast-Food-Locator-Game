import { brands, icon } from './ui.js';
import { GPS_RULES } from './game.js';

export const MOSCOW = Object.freeze({ lat: 55.7592, lon: 37.6123 });
const OFFLINE = [
  [55.70235509327092, 37.529296875],
  [55.80128097118045, 37.705078125],
];
const point = (p) => [p.lat, p.lon];

export function makeMap({ onPick, venues }) {
  const L = window.L;
  const map = L.map('map', {
    zoomControl: false,
    scrollWheelZoom: false,
    zoomSnap: 1,
    minZoom: 3,
    maxZoom: 19,
    attributionControl: true,
  }).setView(point(MOSCOW), 14);
  map.attributionControl.setPrefix(false);
  const bounds = L.latLngBounds(OFFLINE);
  const localPane = map.createPane('localBase');
  localPane.style.zIndex = '240';
  localPane.style.pointerEvents = 'none';
  const offline = L.imageOverlay('media/moscow-center.webp', bounds, {
    pane: 'localBase',
    interactive: false,
    alt: '',
  });
  const TileBase = L.TileLayer.extend({
    getTileUrl(coords) {
      const size = this.getTileSize(),
        nw = coords.scaleBy(size);
      const tile = L.latLngBounds(
        map.unproject(nw, coords.z),
        map.unproject(nw.add(size), coords.z),
      );
      return coords.z >= 12 && coords.z <= 16 && bounds.contains(tile)
        ? L.Util.emptyImageUrl
        : L.TileLayer.prototype.getTileUrl.call(this, coords);
    },
  });
  const tiles = new TileBase('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: 19,
    className: 'raster-tiles',
    attribution:
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
  }).addTo(map);
  const localCredit =
    '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a>';
  let baseCredit = false;
  const unavailable = document.createElement('div');
  unavailable.className = 'map-empty';
  unavailable.textContent = 'Подложка недоступна · метки работают';
  unavailable.hidden = true;
  document.getElementById('map-card').append(unavailable);
  tiles.on('tileerror', () => {
    if (!map.hasLayer(offline) || !bounds.contains(map.getCenter())) unavailable.hidden = false;
  });
  tiles.on('tileload', (e) => {
    if (e.tile.src !== L.Util.emptyImageUrl) unavailable.hidden = true;
  });
  const locations = L.layerGroup().addTo(map),
    paths = L.layerGroup().addTo(map);
  let brand = 'all',
    selected = null,
    target = null,
    fix = null;
  function refreshBase() {
    const show = map.getZoom() >= 12 && map.getZoom() <= 16 && bounds.intersects(map.getBounds());
    if (show && !map.hasLayer(offline)) offline.addTo(map);
    if (!show && map.hasLayer(offline)) offline.remove();
    if (show !== baseCredit) {
      map.attributionControl[show ? 'addAttribution' : 'removeAttribution'](localCredit);
      baseCredit = show;
    }
    if (show && bounds.contains(map.getBounds())) unavailable.hidden = true;
  }
  function drawLocations() {
    const area = map.getBounds().pad(0.12);
    locations.clearLayers();
    const center = map.getCenter();
    const candidates = venues.filter(
      (v) =>
        (brand === 'all' || v.brand === brand || v.id === target?.id) && area.contains(point(v)),
    );
    const priority = (v) =>
      v.id === selected?.id ? -2 : v.id === target?.id ? -1 : map.distance(center, point(v));
    candidates.sort((a, b) => priority(a) - priority(b));
    const placed = [];
    for (const venue of candidates) {
      const isSelected = venue.id === selected?.id,
        active = venue.id === target?.id;
      const pos = map.latLngToContainerPoint(point(venue));
      const limit = map.getZoom() < 12 ? 40 : 27;
      if (!isSelected && !active && placed.some((p) => p.distanceTo(pos) < limit)) continue;
      const markerIcon = L.divIcon({
        className: 'venue-pin' + (isSelected || active ? ' selected' : ''),
        html:
          '<span class="pin-face" style="--pin:' +
          brands[venue.brand].color +
          '">' +
          icon(venue.brand, 18) +
          '</span>',
        iconSize: [36, 38],
        iconAnchor: [18, 37],
      });
      const title = brands[venue.brand].name + ' · ' + venue.address;
      const label = document.createElement('span');
      label.textContent = title;
      L.marker(point(venue), {
        icon: markerIcon,
        title,
        alt: title,
        keyboard: true,
        zIndexOffset: isSelected ? 900 : active ? 850 : 0,
      })
        .bindTooltip(label, { direction: 'top', offset: [0, -32], className: 'venue-tooltip' })
        .on('click', () => onPick(venue))
        .addTo(locations);
      placed.push(pos);
      if (placed.length >= 60) break;
    }
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
    L.marker(origin, {
      icon: L.divIcon({ className: 'user-map-dot', iconSize: [14, 14], iconAnchor: [7, 7] }),
      title: fix ? 'Ваша позиция' : 'Центр обзора',
      interactive: false,
      keyboard: false,
      zIndexOffset: 1100,
    }).addTo(paths);
  }
  function redraw() {
    refreshBase();
    drawLocations();
  }
  map.on('moveend zoomend', redraw);
  function recenter() {
    map.setView(point(fix || MOSCOW), Math.max(14, map.getZoom()));
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
  const update = (s, options = {}) => {
    const locChanged =
      fix?.lat !== s.fix?.lat || fix?.lon !== s.fix?.lon || fix?.accuracy !== s.fix?.accuracy;
    const pathChanged = locChanged || target?.id !== s.target?.id;
    const marksChanged =
      brand !== s.brand || selected?.id !== s.selected?.id || target?.id !== s.target?.id;
    ({ brand, selected, target, fix } = s);
    if (pathChanged) drawPaths();
    if (options.center) map.setView(point(fix || MOSCOW), 14);
    else if (options.focus && selected && !map.getBounds().pad(-0.15).contains(point(selected)))
      map.panTo(point(selected));
    if (marksChanged || options.center) drawLocations();
  };
  drawPaths();
  redraw();
  return {
    update,
    resize: () => requestAnimationFrame(() => map.invalidateSize({ pan: false })),
    recenter,
  };
}
