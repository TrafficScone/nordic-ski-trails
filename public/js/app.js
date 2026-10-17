// ---------------------------------------------------------------------------
// Nordic Ski Trails — a display-only map of CalTopo GeoJSON exports.
//
// Loads every file listed in trails/index.json, styles each feature the way
// CalTopo exported it, and shows a list plus a popup on click.
//
// A trail drawn in sections ("Devil's Thumb Trail_1", "…_2", usually one per
// difficulty colour) is treated as one trail: one list row, one popup.
// CalTopo polygons are areas ("Eldora"): trails inside one are listed under it,
// and tools/sync_osm.py pulls the OSM trails inside it.
// ---------------------------------------------------------------------------

import { basemapStyle } from './basemap.js';
import { DEFAULT_VIEW, DEM_TILES, FALLBACK_COLOR, MAPTILER_KEY, TRAILS_DIR, UNITS } from './config.js';
import { HIT_LAYERS, trailLayers } from './layers.js';
import { conditionLinksFor } from './conditions.js';
import { defaultFilterState, difficultyOf, lineFilter, matchesFilter, renderFilters, renderLegend } from './filters.js';
import { downloadGpx } from './gpx.js';
import { profileOf, profileSvg } from './profile.js';
import { clearHash, findGroup, parseHash, setHash, shareLink } from './share.js';
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

const popup = new maplibregl.Popup({ offset: 10, maxWidth: '300px' });
popup.on('close', () => { if (!switchingPopup) clearHash(); });
let switchingPopup = false;
const dataReady = loadTrails();

// Trail line layers the difficulty/grooming filter applies to. Places and
// areas are never filtered.
const FILTERED_LAYERS = ['trail-casing', 'trail-line', 'trail-dashed', 'trail-label', 'trail-hit'];
const filterState = defaultFilterState();

map.on('load', async () => {
  const fc = await dataReady;
  map.addSource(SRC, { type: 'geojson', data: fc });
  for (const layer of trailLayers(SRC)) map.addLayer(layer);

  assignAreas(fc.features);
  groups = groupFeatures(fc.features);
  renderList();
  renderSlopeLegend();
  renderFilters($('#filters'), filterState, applyFilters);
  renderLegend($('#legend'));

  // A shared link (#trail/devils-thumb-trail) opens that trail; otherwise
  // show everything.
  const linked = findGroup(groups, parseHash());
  if (linked) focus(linked, { animate: false });
  else {
    const bb = bboxOf(fc.features);
    if (bb) map.fitBounds(bb, { padding: 60, maxZoom: 15, duration: 0 });
  }
  window.addEventListener('hashchange', () => {
    const g = findGroup(groups, parseHash());
    if (g) focus(g);
  });

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

/** @type {Map<string, {name: string, kind: 'trail'|'place'|'area', area: string, features: object[], length: number}>} */
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
  const kind = isPoint ? 'place' : f.geometry.type.endsWith('Polygon') ? 'area' : 'trail';
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
      _group: `${kind}:${kind === 'area' ? title : name || Math.random()}`,
      _area: kind === 'area' ? title : p.area ?? '',
      _glyph: MARKER_GLYPHS[p['marker-symbol']] ?? '',
      _color: color(isPoint ? p['marker-color'] : p.stroke),
      _width: num(p['stroke-width'], 3),
      _opacity: num(p['stroke-opacity'], 1),
      _fillOpacity: num(p['fill-opacity'], 0.1),
      _dashed: !!p.pattern && p.pattern !== 'solid',
      _difficulty: kind === 'trail' ? difficultyOf(color(p.stroke)) : '',
      // OSM trails say; a dashed CalTopo line is drawn as ungroomed.
      _grooming: p.grooming ?? (p.pattern && p.pattern !== 'solid' ? 'ungroomed' : 'unknown'),
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

/**
 * Give each CalTopo trail and place the area whose polygon contains it (OSM
 * trails already carry theirs from the sync).
 */
function assignAreas(features) {
  const areas = features.filter((f) => f.geometry.type.endsWith('Polygon'));
  for (const f of features) {
    if (f.properties._area || !areas.length) continue;
    const probe = centerOf(f.geometry);
    const home = areas.find((a) => inPolygon(probe, a.geometry));
    if (home) f.properties._area = home.properties._area;
  }
}

/** Collect sections that share a name into one trail (or place, or area). */
function groupFeatures(features) {
  const out = new Map();
  for (const f of features) {
    const p = f.properties;
    const kind = p._group.slice(0, p._group.indexOf(':'));
    const g = out.get(p._group) ?? { name: kind === 'area' ? p._section : p._name, kind, area: p._area, features: [], length: 0 };
    g.features.push(f);
    g.length += p._length;
    out.set(p._group, g);
  }
  return out;
}

/**
 * The list: one collapsible section per area (its trails, then its places),
 * then anything outside every area.
 */
function renderList() {
  const list = $('#list');
  list.replaceChildren();
  const all = [...groups.values()].filter((g) => g.name).sort((a, b) => a.name.localeCompare(b.name));
  if (!all.length) { list.textContent = 'No trails yet.'; return; }

  const byKind = (items) => [...items.filter((g) => g.kind === 'trail'), ...items.filter((g) => g.kind === 'place')];
  for (const area of all.filter((g) => g.kind === 'area')) {
    const items = byKind(all.filter((g) => g.kind !== 'area' && g.area === area.name));
    const section = document.createElement('details');
    section.className = 'area';
    const summary = document.createElement('summary');
    summary.append(span('area-name', area.name), span('len', `${items.length}`));
    section.append(summary);
    const show = document.createElement('button');
    show.className = 'area-show';
    show.textContent = 'Show area on map';
    show.onclick = () => focus(area);
    section.append(show);
    for (const g of items) section.append(listItem(g));
    list.append(section);
  }

  const loose = byKind(all.filter((g) => g.kind !== 'area' && !groups.has(`area:${g.area}`)));
  if (loose.length) {
    const h = document.createElement('h2');
    h.className = 'list-head';
    h.textContent = all.some((g) => g.kind === 'area') ? 'Other trails & places' : 'Trails & places';
    list.append(h);
    for (const g of loose) list.append(listItem(g));
  }
}

/** Fly to a trail, place or area and open its popup. */
function focus(g, { animate = true } = {}) {
  const bb = bboxOf(g.features);
  const duration = animate ? undefined : 0;
  if (g.kind === 'place') map.flyTo({ center: bb[0], zoom: Math.max(map.getZoom(), 14), duration });
  else map.fitBounds(bb, { padding: 80, maxZoom: 15, duration });
  showPopup(g, g.kind === 'area' ? [(bb[0][0] + bb[1][0]) / 2, bb[1][1]] : centerOf(g.features[0].geometry));
  if (window.matchMedia('(max-width: 640px)').matches) $('#panel').classList.add('is-collapsed');
}

function listItem(g) {
  const btn = document.createElement('button');
  btn.className = 'item';
  btn.dataset.group = `${g.kind}:${g.name}`;
  btn.append(swatches(g), span('name', g.name), span('len', g.length ? formatDistance(g.length) : ''));
  btn.onclick = () => focus(g);
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
  const stats = span('meta', g.length ? formatDistance(g.length) : '');
  el.append(stats);
  if (g.kind === 'trail') addProfile(g, el, stats);

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
  el.append(conditionsBlock(g), popupActions(g));

  switchingPopup = true; // replacing one popup with another isn't a "close"
  popup.setLngLat(lngLat).setDOMContent(el).addTo(map);
  switchingPopup = false;
  setHash(g);
}

/** "Conditions" links: avalanche, weather, nearest snow station, area pages. */
function conditionsBlock(g) {
  const bb = bboxOf(g.features);
  const center = g.kind === 'area'
    ? [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2]
    : centerOf(g.features[0].geometry);
  const links = conditionLinksFor(g, center);
  const box = document.createElement('details');
  box.className = 'pop-conditions';
  const summary = document.createElement('summary');
  summary.textContent = 'Conditions';
  const list = document.createElement('ul');
  for (const { label, url, note } of links) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    li.append(a);
    if (note) li.append(span('note', ` · ${note}`));
    list.append(li);
  }
  box.append(summary, list);
  return box;
}

/** GPX download and share buttons. An area's GPX holds all its trails and places. */
function popupActions(g) {
  const row = span('pop-actions', '');
  const members = g.kind === 'area'
    ? [...groups.values()].filter((m) => m.kind !== 'area' && m.area === g.name)
    : [g];
  if (members.length) {
    const gpx = document.createElement('button');
    gpx.type = 'button';
    gpx.textContent = g.kind === 'area' ? 'GPX (all trails)' : 'Download GPX';
    gpx.onclick = () => downloadGpx(members, { name: g.name, link: location.href });
    row.append(gpx);
  }
  const share = document.createElement('button');
  share.type = 'button';
  share.textContent = 'Share link';
  share.onclick = async () => {
    const result = await shareLink(g);
    const said = { copied: 'Link copied ✓', shared: 'Shared ✓' }[result];
    if (said) {
      share.textContent = said;
      setTimeout(() => { share.textContent = 'Share link'; }, 2000);
    }
  };
  row.append(share);
  return row;
}

/** Apply the filter chips to the trail layers and the list. */
function applyFilters() {
  const extra = lineFilter(filterState);
  const specs = new Map(trailLayers(SRC).map((l) => [l.id, l.filter]));
  for (const id of FILTERED_LAYERS) map.setFilter(id, ['all', specs.get(id), extra]);

  for (const btn of document.querySelectorAll('#list .item')) {
    const g = groups.get(btn.dataset.group);
    if (g?.kind !== 'trail') continue;
    btn.hidden = !g.features.some((f) => matchesFilter(f.properties, filterState));
  }
  for (const section of document.querySelectorAll('#list details.area')) {
    section.querySelector('summary .len').textContent =
      String(section.querySelectorAll('.item:not([hidden])').length);
  }
}

/** Fill in climb stats and the elevation chart once the DEM has been read. */
async function addProfile(g, el, stats) {
  const chart = span('profile-slot', 'Loading elevation…');
  stats.after(chart);
  try {
    const profile = await profileOf(travelOrder(g), DEM_TILES);
    const ft = (m) => `${Math.round(m * 3.28084).toLocaleString()} ft`;
    stats.textContent = `${formatDistance(g.length)} · ↑ ${ft(profile.gain)} · ↓ ${ft(profile.loss)}`;
    const range = span('meta', `Elevation ${ft(profile.min)} – ${ft(profile.max)}`);
    chart.replaceWith(profileSvg(profile), range);
  } catch (err) {
    console.error('Elevation profile failed:', err);
    chart.remove();
  }
}

/**
 * A trail's lines in the order you'd ski them: sections by number, each
 * section's parts as drawn, joining parts that meet end to start.
 */
function travelOrder(g) {
  const sectionNo = (f) => Number(f.properties._section.match(/(\d+)$/)?.[1] ?? 0);
  const parts = [...g.features]
    .sort((a, b) => sectionNo(a) - sectionNo(b))
    .flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates));
  const joined = [parts[0]];
  for (const part of parts.slice(1)) {
    const prev = joined.at(-1);
    if (haversine(prev.at(-1), part[0]) < 30) joined[joined.length - 1] = prev.concat(part.slice(1));
    else joined.push(part);
  }
  return joined;
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

/** Ray-casting point-in-polygon, holes included. */
function inPolygon([x, y], geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const inRing = (ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  return polys.some(([outer, ...holes]) => inRing(outer) && !holes.some(inRing));
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
