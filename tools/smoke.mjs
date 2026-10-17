// End-to-end smoke test with a stubbed MapLibre.
//
//   node tools/smoke.mjs
//
// Boots public/js/app.js against jsdom and a fake map, serving public/trails/
// from disk, then checks the trails load, get styled, list, and open a popup.
// It can't tell you the map *looks* right — only that the app wires up and
// the data flows. Run tools/check.mjs for the layer specs.

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
    this.canvas = { style: {} };
    this.fitted = null;
    this.queryResult = [];
  }
  on(type, a, b) { this.handlers.push(b ? { type, layer: a, fn: b } : { type, fn: a }); }
  addControl() {}
  addSource(id, spec) { this.sources.set(id, spec); }
  getSource(id) { return this.sources.get(id); }
  addLayer(spec) { this.layers.set(spec.id, spec); }
  getLayer(id) { return this.layers.get(id); }
  getCanvas() { return this.canvas; }
  fitBounds(bb) { this.fitted = bb; }
  queryRenderedFeatures() { return this.queryResult; }
  async fire(type, event = {}) {
    for (const h of this.handlers.filter((x) => x.type === type && !x.layer)) await h.fn(event);
  }
}

const noopCtrl = class {};
let popupContent = null;
class FakePopup {
  setLngLat() { return this; }
  setDOMContent(el) { popupContent = el; return this; }
  addTo() { return this; }
}

// -- environment ------------------------------------------------------------

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8787/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;

let created;
globalThis.maplibregl = {
  Map: class { constructor(o) { created = new FakeMap(o); return created; } },
  NavigationControl: noopCtrl, GeolocateControl: noopCtrl,
  ScaleControl: noopCtrl, FullscreenControl: noopCtrl,
  Popup: FakePopup,
};

// Serve public/ from disk instead of over HTTP.
globalThis.fetch = async (url) => {
  const file = path.join(SITE, String(url));
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

// -- boot -------------------------------------------------------------------

console.log('\nBoot');
await import(path.join(SITE, 'js/app.js'));
const map = created;
check('map constructed with the MapTiler style', String(map.opts.style).includes('api.maptiler.com'));
await map.fire('load');

const fc = map.getSource('trails')?.data;
const listed = JSON.parse(fs.readFileSync(path.join(SITE, 'trails/index.json'), 'utf8'));
check('trail source added', !!fc);
check('trail layers added', ['trail-line', 'trail-label', 'trail-hit', 'marker-dot'].every((id) => map.getLayer(id)));
check('features loaded from every listed file', fc?.features.length >= listed.length,
  `${fc?.features.length} features from ${listed.length} files`);
check('map fitted to the trails', !!map.fitted);

console.log('\nStyling');
const lines = fc.features.filter((f) => f.geometry.type.includes('LineString'));
check('every feature has a colour', fc.features.every((f) => /^#|^rgb/.test(f.properties._color)));
check('every feature has a numeric width', fc.features.every((f) => typeof f.properties._width === 'number'));
check('lines have a length', lines.every((f) => f.properties._length > 0));

console.log('\nUI');
const $ = (s) => window.document.querySelector(s);
const items = [...window.document.querySelectorAll('#list .item')];
check('trail list rendered', items.length > 0, `${items.length} items`);

const first = lines[0];
map.queryResult = [first];
await map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } });
check('clicking a trail opens its popup', popupContent?.querySelector('h3')?.textContent === first.properties._name);

$('#btn-list').click();
check('list collapses', $('#panel').classList.contains('is-collapsed'));

console.log(failures ? `\n${failures} problem(s)\n` : '\nAll smoke checks passed\n');
process.exit(failures ? 1 : 0);
