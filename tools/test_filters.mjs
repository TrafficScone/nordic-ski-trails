// Tests for public/js/filters.js.
//
//   node tools/test_filters.mjs
//
// Covers colour classification, that lineFilter validates against the MapLibre
// style spec and agrees with matchesFilter on a grid of features x states, and
// the DOM the filter controls and legend build (via jsdom).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { validateStyleMin, featureFilter } from '@maplibre/maplibre-gl-style-spec';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'public');
const { difficultyOf, DIFFICULTIES, defaultFilterState, lineFilter, matchesFilter, renderFilters, renderLegend } =
  await import(path.join(SITE, 'js/filters.js'));

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

// -- difficultyOf -------------------------------------------------------------

console.log('\ndifficultyOf');
const cases = [
  ['#00cd00', 'easy'], ['#00ff00', 'easy'], ['#0f0', 'easy'],
  ['#0000ff', 'intermediate'], ['#009AFF', 'intermediate'],
  ['#000000', 'advanced'], ['#000', 'advanced'], ['#333333', 'advanced'],
  ['#ff0000', 'other'], ['#ffffff', 'other'], ['#888888', 'other'],
  ['nope', 'other'], ['', 'other'], [null, 'other'], [undefined, 'other'], ['#12345', 'other'],
];
for (const [input, want] of cases) {
  const got = difficultyOf(input);
  check(got === want, `${JSON.stringify(input)} -> ${got}${got === want ? '' : ` (wanted ${want})`}`);
}

// -- lineFilter ---------------------------------------------------------------

console.log('\nlineFilter');
const values = DIFFICULTIES.map((d) => d.value);
const states = {
  default: defaultFilterState(),
  groomedOnly: { ...defaultFilterState(), groomedOnly: true },
  'only easy': { difficulties: new Set(['easy']), groomedOnly: false },
  'easy + groomed': { difficulties: new Set(['easy']), groomedOnly: true },
  empty: { difficulties: new Set(), groomedOnly: false },
};
const features = [];
for (const _difficulty of [...values, undefined]) {
  for (const _grooming of ['groomed', 'ungroomed', 'unknown', undefined]) {
    features.push({ _difficulty, _grooming });
  }
}

for (const [name, state] of Object.entries(states)) {
  const filter = ['all', ['==', ['geometry-type'], 'LineString'], lineFilter(state)];
  const style = {
    version: 8,
    sources: { t: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [{ id: 'l', type: 'line', source: 't', filter }],
  };
  const errors = validateStyleMin(style);
  check(errors.length === 0, `${name}: validates${errors.length ? ' - ' + errors.map((e) => e.message).join('; ') : ''}`);

  const compiled = featureFilter(filter, 'layers[0].filter');
  const fn = compiled.filter;
  let mismatches = 0;
  for (const properties of features) {
    const viaMap = fn({ zoom: 10 }, { type: 2, properties, geometry: [] });
    if (viaMap !== matchesFilter(properties, state)) mismatches++;
    // Non-line geometry is excluded by the layer's own clause, not ours.
  }
  check(mismatches === 0, `${name}: expression agrees with matchesFilter on ${features.length} features`);
}

// -- DOM ----------------------------------------------------------------------

console.log('\nrenderFilters');
const { document } = new JSDOM('<!doctype html><div id="f"></div><div id="g"></div>').window;
const box = document.getElementById('f');
const state = defaultFilterState();
const calls = [];
renderFilters(box, state, (s) => calls.push([...s.difficulties].join(',') + '|' + s.groomedOnly));
const chips = [...box.querySelectorAll('button.flt-chip')];
check(chips.length === 4, 'one chip per difficulty');
check(chips.every((c) => c.type === 'button' && c.getAttribute('aria-pressed') === 'true'), 'chips are buttons, all pressed');
chips[0].click();
check(chips[0].getAttribute('aria-pressed') === 'false' && !state.difficulties.has('easy'), 'click turns a difficulty off');
check(calls.length === 1 && calls[0] === 'intermediate,advanced,other|false', 'onChange called with new state');
chips[0].click();
check(chips[0].getAttribute('aria-pressed') === 'true' && state.difficulties.has('easy'), 'click again turns it back on');
const cb = box.querySelector('input[type=checkbox]');
cb.checked = true;
cb.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
check(state.groomedOnly === true && calls.length === 3, 'checkbox sets groomedOnly and calls onChange');
renderFilters(box, state, () => {});
check(box.querySelectorAll('button.flt-chip').length === 4, 're-render clears the container');

console.log('\nrenderLegend');
const legend = document.getElementById('g');
renderLegend(legend);
check(legend.querySelectorAll('.lgd-row').length === 6, 'six rows');
check(legend.querySelectorAll('svg').length === 5, 'inline SVG swatches');
renderLegend(legend);
check(legend.querySelectorAll('.lgd-row').length === 6, 're-render clears the container');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
