// ---------------------------------------------------------------------------
// Nordic Ski Trails — a display-only map of CalTopo GeoJSON exports.
//
// Loads every file listed in trails/index.json, styles each feature the way
// CalTopo exported it, and shows a list plus a popup on click.
// ---------------------------------------------------------------------------

import { basemapStyle } from './basemap.js';
import { DEFAULT_VIEW, FALLBACK_COLOR, MAPTILER_KEY, TRAILS_DIR, UNITS } from './config.js';
import { HIT_LAYERS, trailLayers } from './layers.js';

const SRC = 'trails';
const $ = (sel) => document.querySelector(sel);

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

  renderList(fc.features);

  map.on('click', (e) => {
    const [hit] = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS });
    if (hit) showPopup(hit.properties, e.lngLat);
  });
  for (const id of HIT_LAYERS) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
});

$('#btn-list').onclick = () => $('#panel').classList.toggle('is-collapsed');

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
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : fallback);
  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      ...p,
      _name: p.title || p.name || '',
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

function renderList(features) {
  const named = features
    .filter((f) => f.properties._name)
    .sort((a, b) => a.properties._name.localeCompare(b.properties._name));
  const list = $('#list');
  list.replaceChildren();
  if (!named.length) { list.textContent = 'No trails yet.'; return; }

  for (const f of named) {
    const btn = document.createElement('button');
    btn.className = 'item';
    btn.innerHTML = `<span class="swatch"></span><span class="name"></span><span class="len"></span>`;
    btn.querySelector('.swatch').style.background = f.properties._color;
    btn.querySelector('.name').textContent = f.properties._name;
    btn.querySelector('.len').textContent = f.properties._length ? formatDistance(f.properties._length) : '';
    btn.onclick = () => {
      const bb = bboxOf([f]);
      map.fitBounds(bb, { padding: 80, maxZoom: 15 });
      showPopup(f.properties, centerOf(f.geometry));
      if (window.matchMedia('(max-width: 640px)').matches) $('#panel').classList.add('is-collapsed');
    };
    list.append(btn);
  }
}

function showPopup(p, lngLat) {
  const el = document.createElement('div');
  el.className = 'pop';
  const h = document.createElement('h3');
  h.textContent = p._name || 'Untitled';
  el.append(h);
  const len = Number(p._length);
  if (len) {
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = formatDistance(len);
    el.append(m);
  }
  if (p.description) {
    const d = document.createElement('p');
    d.textContent = p.description;
    el.append(d);
  }
  popup.setLngLat(lngLat).setDOMContent(el).addTo(map);
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
