// ---------------------------------------------------------------------------
// Nordic Ski Trails — a display-only map of CalTopo GeoJSON exports.
//
// Loads every file listed in trails/index.json, styles each feature the way
// CalTopo exported it, and shows a list plus a popup on click.
//
// A trail drawn in sections ("Devil's Thumb Trail_1", "…_2", usually one per
// difficulty colour) is treated as one trail: one list row, one popup.
// ---------------------------------------------------------------------------

import { basemapStyle } from './basemap.js';
import { DEFAULT_VIEW, DEM_TILES, FALLBACK_COLOR, MAPTILER_KEY, TRAILS_DIR, UNITS } from './config.js';
import { HIT_LAYERS, trailLayers } from './layers.js';
import { SLOPE_CLASSES, registerSlopeProtocol } from './slope.js';

const SRC = 'trails';
const $ = (sel) => document.querySelector(sel);

// CalTopo marker symbols -> the letter drawn on the marker disc.
const MARKER_GLYPHS = {
  'parked-car': 'P', parking: 'P', car: 'P',
  toilet: 'WC', restroom: 'WC',
  info: 'i', information: 'i',
  danger: '!', caution: '!', warning: '!', hazard: '!',
  cabin: 'H', hut: 'H', shelter: 'H', building: 'H', yurt: 'H',
};

registerSlopeProtocol(DEM_TILES);

const map = new maplibregl.Map({
  container: 'map',
  style: basemapStyle(MAPTILER_KEY),
  ...DEFAULT_VIEW,
  attributionControl: { compact: true },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: UNITS === 'mi' ? 'imperial' : 'metric' }), 'bottom-right');

const popup = new maplibregl.Popup({ offset: 10, maxWidth: '280px' });
const dataReady = loadTrails();

map.on('load', async () => {
  const fc = await dataReady;
  map.addSource(SRC, { type: 'geojson', data: fc });
  for (const layer of trailLayers(SRC)) map.addLayer(layer);

  const bb = bboxOf(fc.features);
  if (bb) map.fitBounds(bb, { padding: 60, maxZoom: 15, duration: 0 });

  groups = groupFeatures(fc.features);
  renderList();
  renderSlopeLegend();

  map.on('click', (e) => {
    const [hit] = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS });
    if (hit) showPopup(groups.get(hit.properties._group), e.lngLat);
  });
  for (const id of HIT_LAYERS) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
});

$('#btn-list').onclick = () => $('#panel').classList.toggle('is-collapsed');
$('#slope-toggle').onchange = (e) => {
  map.setLayoutProperty('slope', 'visibility', e.target.checked ? 'visible' : 'none');
  $('#slope-legend').hidden = !e.target.checked;
};

/** @type {Map<string, {name: string, kind: 'trail'|'place', features: object[], length: number}>} */
let groups = new Map();

// ===========================================================================
// Data
// ===========================================================================

/** Fetch every listed file and merge them into one styled FeatureCollection. */
async function loadTrails() {
  const features = [];
  try {
    const files = await getJSON(`${TRAILS_DIR}index.json`);
    const collections = await Promise.all(files.map((f) => getJSON(TRAILS_DIR + f).catch((err) => {
      console.error(`Skipping ${f}:`, err);
      return { features: [] };
    })));
    for (const fc of collections) {
      for (const f of fc.features ?? []) if (f.geometry) features.push(styled(f));
    }
  } catch (err) {
    console.error('Could not load trails/index.json:', err);
    $('#list').textContent = 'Trails failed to load.';
  }
  features.forEach((f, i) => { f.id = i; });
  return { type: 'FeatureCollection', features };
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Copy CalTopo's styling onto plain properties the layers can read directly. */
function styled(f) {
  const p = f.properties ?? {};
  const isPoint = f.geometry.type.endsWith('Point');
  const title = String(p.title || p.name || '').trim();
  // "Devil's Thumb Trail_2" is section 2 of "Devil's Thumb Trail".
  const name = title.replace(/[\s_-]+\d+$/, '') || title;
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : fallback);
  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      ...p,
      _name: name,
      _section: title,
      _group: `${isPoint ? 'place' : 'trail'}:${name || Math.random()}`,
      _glyph: MARKER_GLYPHS[p['marker-symbol']] ?? '',
      _color: color(isPoint ? p['marker-color'] : p.stroke),
      _width: num(p['stroke-width'], 3),
      _opacity: num(p['stroke-opacity'], 1),
      _fillOpacity: num(p['fill-opacity'], 0.1),
      _dashed: !!p.pattern && p.pattern !== 'solid',
      _length: lengthOf(f.geometry),
    },
  };
}

/** CalTopo writes colours with and without the leading '#'. */
function color(c) {
  if (typeof c !== 'string' || !c) return FALLBACK_COLOR;
  return /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? `#${c}` : c;
}

// ===========================================================================
// UI
// ===========================================================================

/** Collect sections that share a name into one trail (or place). */
function groupFeatures(features) {
  const out = new Map();
  for (const f of features) {
    const p = f.properties;
    const g = out.get(p._group) ?? { name: p._name, kind: p._group.startsWith('place') ? 'place' : 'trail', features: [], length: 0 };
    g.features.push(f);
    g.length += p._length;
    out.set(p._group, g);
  }
  return out;
}

function renderList() {
  const list = $('#list');
  list.replaceChildren();
  const named = [...groups.values()].filter((g) => g.name).sort((a, b) => a.name.localeCompare(b.name));
  if (!named.length) { list.textContent = 'No trails yet.'; return; }

  for (const kind of ['trail', 'place']) {
    const items = named.filter((g) => g.kind === kind);
    if (!items.length) continue;
    const h = document.createElement('h2');
    h.className = 'list-head';
    h.textContent = kind === 'trail' ? 'Trails' : 'Places';
    list.append(h);
    for (const g of items) list.append(listItem(g));
  }
}

function listItem(g) {
  const btn = document.createElement('button');
  btn.className = 'item';
  btn.append(swatches(g), span('name', g.name), span('len', g.length ? formatDistance(g.length) : ''));
  btn.onclick = () => {
    const bb = bboxOf(g.features);
    if (g.kind === 'place') map.flyTo({ center: bb[0], zoom: Math.max(map.getZoom(), 14) });
    else map.fitBounds(bb, { padding: 80, maxZoom: 15 });
    showPopup(g, centerOf(g.features[0].geometry));
    if (window.matchMedia('(max-width: 640px)').matches) $('#panel').classList.add('is-collapsed');
  };
  return btn;
}

/** One colour chip per distinct section colour — e.g. green, blue, black. */
function swatches(g) {
  const box = span(g.kind === 'place' ? 'swatches is-place' : 'swatches', '');
  for (const c of new Set(g.features.map((f) => f.properties._color))) {
    const chip = span('swatch', g.kind === 'place' ? g.features[0].properties._glyph : '');
    chip.style.background = c;
    box.append(chip);
  }
  return box;
}

function showPopup(g, lngLat) {
  if (!g) return;
  const el = document.createElement('div');
  el.className = 'pop';
  const h = document.createElement('h3');
  h.textContent = g.name || 'Untitled';
  el.append(h);
  if (g.length) el.append(span('meta', formatDistance(g.length)));

  // One line per section that has something to say, keyed by its colour.
  for (const f of g.features) {
    const p = f.properties;
    if (!p.description) continue;
    const row = document.createElement('p');
    if (g.features.length > 1) {
      const chip = span('swatch', '');
      chip.style.background = p._color;
      row.append(chip);
    }
    row.append(document.createTextNode(p.description));
    el.append(row);
  }
  popup.setLngLat(lngLat).setDOMContent(el).addTo(map);
}

function renderSlopeLegend() {
  const legend = $('#slope-legend');
  legend.replaceChildren();
  SLOPE_CLASSES.forEach(([deg, hex], i) => {
    const next = SLOPE_CLASSES[i + 1]?.[0];
    const row = span('legend-row', '');
    const chip = span('swatch', '');
    chip.style.background = hex;
    row.append(chip, document.createTextNode(next ? `${deg}–${next - 1}°` : `${deg}°+`));
    legend.append(row);
  });
}

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

// ===========================================================================
// Geometry
// ===========================================================================

/** All [lng, lat] positions in a geometry, whatever its type. */
function positions(g) {
  const out = [];
  const walk = (c) => (typeof c[0] === 'number' ? out.push(c) : c.forEach(walk));
  walk(g.coordinates);
  return out;
}

function bboxOf(features) {
  const pts = features.flatMap((f) => positions(f.geometry));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

function centerOf(g) {
  if (g.type === 'Point') return g.coordinates;
  const pts = positions(g);
  return pts[Math.floor(pts.length / 2)];
}

/** Length in metres for lines (summing each part); 0 for anything else. */
function lengthOf(g) {
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  let m = 0;
  for (const line of lines) for (let i = 1; i < line.length; i++) m += haversine(line[i - 1], line[i]);
  return m;
}

function haversine([lng1, lat1], [lng2, lat2]) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

function formatDistance(m) {
  return UNITS === 'mi' ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
}
