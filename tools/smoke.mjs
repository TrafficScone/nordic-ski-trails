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
    for (const layer of opts.style?.layers ?? []) this.addLayer(structuredClone(layer));
  }
  on(type, a, b) { this.handlers.push(b ? { type, layer: a, fn: b } : { type, fn: a }); }
  addControl() {}
  addSource(id, spec) { this.sources.set(id, { ...spec, setData(d) { this.data = d; } }); }
  getSource(id) { return this.sources.get(id); }
  addLayer(spec) { this.layers.set(spec.id, spec); }
  getLayer(id) { return this.layers.get(id); }
  getCanvas() { return this.canvas; }
  setFilter(id, filter) { this.layers.get(id).filter = filter; }
  setPaintProperty(id, key, value) { (this.layers.get(id).paint ??= {})[key] = value; }
  setLayoutProperty(id, key, value) { (this.layers.get(id).layout ??= {})[key] = value; }
  flyTo() {}
  fitBounds(bb) { this.fitted = bb; }
  cameraForBounds(bb) { return { center: [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2], zoom: 10 }; }
  easeTo(cam) { this.eased = cam; this.fitted = this.fitted ?? cam.center; }
  queryRenderedFeatures() { return this.queryResult; }
  async fire(type, event = {}) {
    for (const h of this.handlers.filter((x) => x.type === type && !x.layer)) await h.fn(event);
  }
}

const noopCtrl = class {};
let popupContent = null;
class FakePopup {
  on() { return this; }
  setLngLat() { return this; }
  setDOMContent(el) { popupContent = el; return this; }
  addTo() { return this; }
}

// -- environment ------------------------------------------------------------

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
// Boot from a shared link, as someone clicking it in an email would.
const dom = new JSDOM(html, { url: "http://localhost:8787/#trail/devils-thumb-trail", pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
window.matchMedia = () => ({ matches: false });
globalThis.location = window.location;
globalThis.history = window.history;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

globalThis.createImageBitmap = async () => ({ width: 4 });
globalThis.OffscreenCanvas = class {
  getContext() {
    const v = (DEM_METRES + 10000) * 10; // terrain-RGB encoding
    const data = new Uint8ClampedArray(4 * 4 * 4).map((_, i) => [v >> 16, (v >> 8) & 255, v & 255, 255][i % 4]);
    return { drawImage() {}, getImageData: () => ({ data }) };
  }
};

let created;
const protocols = new Map();
globalThis.maplibregl = {
  addProtocol: (name, fn) => protocols.set(name, fn),
  Map: class { constructor(o) { created = new FakeMap(o); return created; } },
  NavigationControl: noopCtrl, GeolocateControl: noopCtrl,
  ScaleControl: noopCtrl, FullscreenControl: noopCtrl,
  Popup: FakePopup,
};

// Serve public/ from disk instead of over HTTP. Elevation tiles are faked as a
// flat 3000 m plateau, decoded through stubbed canvas APIs.
const DEM_METRES = 3000;
globalThis.fetch = async (url) => {
  if (/^https?:/.test(String(url))) return { ok: true, blob: async () => ({}) };
  const file = path.join(SITE, String(url));
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

// -- boot -------------------------------------------------------------------

console.log('\nBoot');
await import(path.join(SITE, 'js/app.js'));
const map = created;
check('slope protocol registered', protocols.has('slope'));
check('map constructed with the basemap style', map.opts.style?.layers?.length > 0 && map.opts.style.glyphs.includes('api.maptiler.com'));
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
const names = items.map((el) => el.querySelector('.name').textContent);
check('trail list rendered', items.length > 0, `${items.length} items`);
check('sections of one trail share a row', names.filter((n) => n === "Devil's Thumb Trail").length === 1, names.join(', '));
const areaNames = [...window.document.querySelectorAll('#list details.area .area-name')].map((el) => el.textContent);
check('CalTopo polygons become list sections', areaNames.includes('Eldora'), areaNames.join(', '));
const eldora = [...window.document.querySelectorAll('#list details.area')].find((d) => d.querySelector('.area-name').textContent === 'Eldora');
check('OSM trails list under their area', eldora?.querySelectorAll('.item').length > 5);
const parking = fc.features.find((f) => f.properties['marker-symbol'] === 'parked-car');
check('parking marker gets a P', parking?.properties._glyph === 'P');

const first = lines[0];
map.queryResult = [first];
await map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } });
check('clicking a trail opens its popup', popupContent?.querySelector('h3')?.textContent === first.properties._name);

const devil = fc.features.find((f) => f.properties._section === "Devil's Thumb Trail_2");
map.queryResult = [devil];
await map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } });
check('a section opens the whole trail', popupContent?.querySelector('h3')?.textContent === "Devil's Thumb Trail"
  && popupContent.querySelectorAll('p').length === 2);
await new Promise((r) => setTimeout(r, 50)); // let the elevation profile resolve
check('trail popup gets an elevation profile', !!popupContent.querySelector('svg.profile'));
check('climb stats shown (flat DEM: no gain)', /↑ 0 ft · ↓ 0 ft/.test(popupContent.querySelector('.meta')?.textContent),
  popupContent.querySelector('.meta')?.textContent);

console.log('\nShare, GPX, conditions');
// The boot URL was #trail/devils-thumb-trail; the load handler should have opened it.
check('a shared link opens its trail on load', !!map.fitted && popupContent !== null);
check('opening a trail never lands below the trail zoom', map.eased?.zoom >= 10.5, String(map.eased?.zoom));
check('opening a trail puts it in the URL', window.location.hash === '#trail/devils-thumb-trail', window.location.hash);
const actions = [...popupContent.querySelectorAll('.pop-actions button')].map((b) => b.textContent);
check('popup offers GPX download and share', actions.includes('Download GPX') && actions.includes('Share link'), actions.join(', '));
const links = [...popupContent.querySelectorAll('.pop-conditions a')];
check('popup lists condition links', links.length >= 3 && links.every((a) => a.href.startsWith('https://') && a.target === '_blank'),
  links.map((a) => a.textContent).join(' | '));

const sel = map.getSource('selection').data.features.map((f) => f.properties.role);
check('selected trail is highlighted with start and end markers', sel.includes('line') && sel.includes('start') && sel.includes('end'),
  sel.join(', '));
check('other trails fade while one is selected',
  JSON.stringify(map.getLayer('trail-line').paint['line-opacity']).includes("trail:Devil's Thumb Trail"));
check('conditions are always shown as cards, not a dropdown',
  !popupContent.querySelector('details') && popupContent.querySelectorAll('.cond-card svg').length >= 3);
const withRef = fc.features.find((f) => f.properties.ref);
map.queryResult = [withRef];
await map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } });
check('agency ref sits at the very bottom of the popup',
  popupContent.lastElementChild?.className === 'pop-ref' && popupContent.lastElementChild.textContent.includes(withRef.properties.ref));
// Trails outside every area go in a collapsible "Other trails & places"
// section like the areas — so no list row should sit loose in the list.
check('every list row is inside a collapsible section',
  window.document.querySelectorAll('#list > .item').length === 0
  && window.document.querySelectorAll('#list details.area .item').length > 0);

console.log('\nFilters');
const chips = [...window.document.querySelectorAll('#filters .flt-chip')];
check('difficulty chips rendered', chips.length === 4);
check('legend rendered', window.document.querySelectorAll('#legend .lgd-row').length === 7);
const greenTrail = fc.features.find((f) => f.properties._difficulty === 'easy');
const greenRow = [...window.document.querySelectorAll('#list .item')]
  .find((b) => b.querySelector('.name').textContent === greenTrail.properties._name);
chips.find((c) => c.dataset.difficulty === 'easy').click();
check('turning off Easier filters the trail layers', JSON.stringify(map.getLayer('trail-line').filter).includes('"in"')
  && !JSON.stringify(map.getLayer('trail-line').filter).includes('"easy"'));
check('…and hides easy trails in the list', greenRow?.hidden === true);
check('…but never the places', map.getLayer('marker-dot').filter === undefined
  || !JSON.stringify(map.getLayer('marker-dot').filter).includes('_difficulty'));
chips.find((c) => c.dataset.difficulty === 'easy').click();
check('turning it back on restores them', greenRow?.hidden === false);

console.log('\nMap key and slope');
const toggle = $('#slope-toggle');
check('slope shading is on by default', toggle.checked && map.getLayer('slope').layout.visibility === 'visible'
  && !$('#slope-legend').hidden);
check('slope legend uses the club classes', /18–25°/.test($('#slope-legend').textContent)
  && /40°\+/.test($('#slope-legend').textContent), $('#slope-legend').textContent);
toggle.checked = false;
toggle.dispatchEvent(new window.Event('change'));
check('unticking hides slope shading and its legend',
  map.getLayer('slope').layout.visibility === 'none' && $('#slope-legend').hidden);
check('map key is visible by default', !$('#key').hidden && $('#key-show').hidden);
$('#key-hide').click();
check('Hide collapses the key to a button', $('#key').hidden && !$('#key-show').hidden);
$('#key-show').click();
check('…which brings it back', !$('#key').hidden);

$('#btn-list').click();
check('list collapses', $('#panel').classList.contains('is-collapsed'));

console.log(failures ? `\n${failures} problem(s)\n` : '\nAll smoke checks passed\n');
process.exit(failures ? 1 : 0);
