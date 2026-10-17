// End-to-end smoke test with a stubbed MapLibre.
//
//   node tools/smoke.mjs
//
// Boots public/js/app.js against jsdom and a fake map, then drives the real user
// flow: draw a trail, name it, filter it, reshape it, drop a place, undo.
// It can't tell you the map *looks* right — only that the app wires up and
// the data flow works. Run tools/check.mjs for the layer specs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'public');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

// -- fake map ---------------------------------------------------------------

class FakeMap {
  constructor(opts) {
    this.opts = opts;
    this.handlers = [];
    this.sources = new Map();
    this.layers = new Map();
    this.filters = new Map();
    this.images = new Set();
    this.canvas = { style: {} };
    this.center = { lng: opts.center?.[0] ?? 0, lat: opts.center?.[1] ?? 0 };
    this.zoom = opts.zoom ?? 12;
    this.doubleClickZoom = { enable() {}, disable() {} };
    this.queryByLayer = new Map(); // layer id -> features it would return
    this.terrain = null;
  }
  on(type, a, b) { this.handlers.push(b ? { type, layer: a, fn: b } : { type, fn: a }); }
  once(type, a, b) { this.on(type, a, b); }
  off() {}
  addControl() {}
  addSource(id, spec) { this.sources.set(id, { spec, data: spec.data, setData(d) { this.data = d; } }); }
  getSource(id) { return this.sources.get(id); }
  addLayer(spec) { this.layers.set(spec.id, spec); this.filters.set(spec.id, spec.filter); }
  getLayer(id) { return this.layers.get(id); }
  setFilter(id, f) { this.filters.set(id, f); }
  hasImage(id) { return this.images.has(id); }
  addImage(id) { this.images.add(id); }
  getCanvas() { return this.canvas; }
  getCenter() { return this.center; }
  getZoom() { return this.zoom; }
  getBearing() { return 0; }
  getPitch() { return 0; }
  setTerrain(t) { this.terrain = t; }
  easeTo() {} flyTo() {} fitBounds() {} resize() {}
  queryRenderedFeatures(_point, opts = {}) {
    const wanted = opts.layers ?? [...this.queryByLayer.keys()];
    return wanted.flatMap((id) => this.queryByLayer.get(id) ?? []);
  }

  /** Fire every handler registered for a map-level (not layer-scoped) event. */
  fire(type, event = {}) {
    for (const h of [...this.handlers]) {
      if (h.type === type && !h.layer) h.fn({ preventDefault() {}, originalEvent: {}, ...event });
    }
  }
  fireLayer(type, layer, event = {}) {
    for (const h of [...this.handlers]) {
      if (h.type === type && h.layer === layer) h.fn({ preventDefault() {}, originalEvent: {}, ...event });
    }
  }
}

const noopCtrl = class { onAdd() { return { remove() {} }; } };
const fakePopup = () => ({ setLngLat() { return this; }, setHTML() { return this; }, addTo() { return this; }, remove() {} });

// -- environment ------------------------------------------------------------

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8787/', pretendToBeVisual: true });
const { window } = dom;

for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Option', 'Node', 'DOMParser', 'Blob', 'CustomEvent']) {
  globalThis[key] = window[key];
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.confirm = () => true;
window.confirm = globalThis.confirm;
globalThis.history = window.history;
globalThis.location = window.location;

// jsdom has no canvas backend; the place icons only need a ctx that doesn't throw.
window.HTMLCanvasElement.prototype.getContext = () => ({
  beginPath() {}, arc() {}, fill() {}, stroke() {}, fillText() {},
  getImageData: () => ({ width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) }),
  set font(_v) {}, set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
  set textAlign(_v) {}, set textBaseline(_v) {},
});

let created;
globalThis.maplibregl = {
  Map: class { constructor(o) { created = new FakeMap(o); return created; } },
  NavigationControl: noopCtrl, GeolocateControl: noopCtrl,
  ScaleControl: noopCtrl, FullscreenControl: noopCtrl,
  Popup: class { constructor() { return fakePopup(); } },
};

// Serve data/trails.geojson from disk instead of over HTTP.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(fs.readFileSync(path.join(SITE, 'data/trails.geojson'), 'utf8')),
});

localStorage.clear();

// -- boot -------------------------------------------------------------------

console.log('\nBoot');
await import(path.join(SITE, 'js/app.js'));
const map = created;
check('map constructed with the MapTiler style', String(map.opts.style).includes('api.maptiler.com'));

const loadHandler = map.handlers.find((h) => h.type === 'load');
check('a load handler was registered', !!loadHandler);
await loadHandler.fn({});

check('data source added', !!map.getSource('trails'));
check('all trail layers added', ['trail-line', 'trail-label', 'trail-hit', 'place-icon'].every((id) => map.getLayer(id)));
check('draw layers added', ['draw-line', 'draw-vertex', 'draw-mid'].every((id) => map.getLayer(id)));
check('place icons registered', map.images.size >= 10, `${map.images.size} images`);

const $ = (s) => window.document.querySelector(s);
const clickEl = (sel) => $(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const mapClick = (lng, lat) => map.fire('click', { lngLat: { lng, lat }, point: { x: 100, y: 100 } });
const stored = () => JSON.parse(localStorage.getItem('nordic-trails/features/v1') ?? '{"features":[]}');

// -- draw a trail -----------------------------------------------------------

console.log('\nDrawing a trail');
clickEl('#tool-line');
check('line tool is active', $('#tool-line').classList.contains('is-active'));

mapClick(-93.330, 44.995);
mapClick(-93.325, 44.997);
mapClick(-93.320, 44.996);
check('hint shows the running point count', /3\s*points/.test($('#hint').textContent), $('#hint').textContent);
check('draft geometry is on the map', map.getSource('draw-draft').data.features.length === 1);

key('Enter');
const trails = stored().features;
check('trail saved to localStorage', trails.length === 1, `${trails.length} features`);
check('trail has default properties', trails[0]?.properties.difficulty === 'unrated' && trails[0]?.properties.kind === 'trail');
check('tool returned to select', $('#tool-pan').classList.contains('is-active'));
check('details panel opened', $('#details').hidden === false);
check('length readout rendered', /mi|ft/.test($('#det-readout')?.textContent ?? ''), $('#det-readout')?.textContent);

// -- edit its properties ----------------------------------------------------

console.log('\nEditing properties');
const nameInput = $('#f-name');
nameInput.value = 'Skyline Loop';
nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));
check('name written through to the store', stored().features[0].properties.name === 'Skyline Loop');

const diff = $('#f-difficulty');
diff.value = 'most-difficult';
diff.dispatchEvent(new window.Event('change', { bubbles: true }));
check('difficulty written through', stored().features[0].properties.difficulty === 'most-difficult');
check('sidebar row shows the name', $('#list').textContent.includes('Skyline Loop'));
const statsText = $('#stats').textContent.replace(/\s+/g, '');
check('stats counted the trail', statsText.includes('1Trails') && statsText.includes('1Places') === false, statsText);

const oneway = [...window.document.querySelectorAll('.toggle')].find((l) => l.textContent.includes('One-way'));
oneway.querySelector('input').checked = true;
oneway.querySelector('input').dispatchEvent(new window.Event('change', { bubbles: true }));
check('one-way toggle written through', stored().features[0].properties.oneway === true);

// -- filters ----------------------------------------------------------------

console.log('\nFilters');
const chip = window.document.querySelector('.chip[data-difficulty="most-difficult"]');
clickEl('.chip[data-difficulty="most-difficult"]');
check('chip turns off', chip.classList.contains('off'));
check('trail-line filter excludes the hidden grade',
  !JSON.stringify(map.filters.get('trail-line')).includes('most-difficult'));
check('hidden trail leaves the list', !$('#list').textContent.includes('Skyline Loop'));
clickEl('.chip[data-difficulty="most-difficult"]');
check('chip turns back on', !chip.classList.contains('off') && $('#list').textContent.includes('Skyline Loop'));

$('#search').value = 'nothing-matches-this';
$('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
check('search narrows the list', $('#list').textContent.includes('Nothing matches'));
$('#search').value = '';
$('#search').dispatchEvent(new window.Event('input', { bubbles: true }));

// -- reshape ----------------------------------------------------------------

console.log('\nReshaping');
clickEl('#det-editgeom');
const handles = map.getSource('draw-handles').data.features;
check('vertex + midpoint handles rendered', handles.filter((f) => f.properties.handle === 'vertex').length === 3
  && handles.filter((f) => f.properties.handle === 'mid').length === 2, JSON.stringify(handles.map((f) => f.properties.handle)));

map.fireLayer('mousedown', 'draw-vertex', { features: [{ properties: { index: 0 } }] });
map.fire('mousemove', { lngLat: { lng: -93.340, lat: 44.990 } });
map.fire('mouseup', {});
const moved = stored().features[0].geometry.coordinates[0];
check('dragging a vertex moved the geometry', Math.abs(moved[0] + 93.340) < 1e-9, JSON.stringify(moved));

// -- places -----------------------------------------------------------------

console.log('\nPlaces');
clickEl('#tool-point');
mapClick(-93.327, 44.994);
const places = stored().features.filter((f) => f.geometry.type === 'Point');
check('place saved', places.length === 1);
check('place defaults to a trailhead', places[0]?.properties.placeType === 'trailhead');
check('place tool stays armed for the next drop', $('#tool-point').classList.contains('is-active'));
key('Escape');
check('Escape returns to select', $('#tool-pan').classList.contains('is-active'));

// -- selection --------------------------------------------------------------

console.log('\nSelection & deletion');
map.queryByLayer.set('trail-hit', [{ properties: { id: stored().features[0].properties.id } }]);
mapClick(-93.330, 44.995);
check('clicking a trail opens its details', $('#f-name')?.value === 'Skyline Loop', $('#f-name')?.value);
check('URL hash carries the feature id', window.location.hash.slice(1) === stored().features[0].properties.id);

clickEl('#det-delete');
check('delete removes the feature', stored().features.filter((f) => f.geometry.type === 'LineString').length === 0);
check('details panel closed', $('#details').hidden === true);

clickEl('#btn-undo');
check('undo restores it', stored().features.filter((f) => f.geometry.type === 'LineString').length === 1);

// -- units ------------------------------------------------------------------

console.log('\nUnits & terrain');
clickEl('#btn-units');
check('units toggle to km', $('#units-label').textContent === 'km' && /Km/.test($('#stats').textContent));
clickEl('#btn-terrain');
check('terrain enabled', map.terrain?.source === 'terrain-rgb');
clickEl('#btn-terrain');
check('terrain disabled', map.terrain === null);

console.log(failures ? `\n${failures} failure(s)\n` : '\nAll smoke tests passed\n');
process.exit(failures ? 1 : 0);
