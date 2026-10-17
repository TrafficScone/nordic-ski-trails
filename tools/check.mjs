// Static pre-flight for the map app.
//
//   node tools/check.mjs
//
// Runs three checks that would otherwise only fail (often silently) in the
// browser:
//   1. every MapLibre layer spec and filter validates against the style spec
//   2. every element id app.js reaches for exists in index.html
//   3. the published data file parses and has the properties the layers read
//
// Everything it reads lives under public/ — the only folder that deploys.
//
// The style-spec validator is optional: `npm i @maplibre/maplibre-gl-style-spec`
// enables check 1, and it's skipped with a note if that isn't installed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'public'); // the folder Netlify deploys
const read = (p) => fs.readFileSync(path.join(SITE, p), 'utf8');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

// -- 1. layer specs ---------------------------------------------------------

console.log('\nMapLibre layer specs');
const { trailLayers, trailFilters, drawLayers } = await import(path.join(SITE, 'js/layers.js'));

let validate = null;
try {
  ({ validateStyleMin: validate } = await import('@maplibre/maplibre-gl-style-spec'));
} catch {
  console.log('  – skipped (npm i @maplibre/maplibre-gl-style-spec to enable)');
}

if (validate) {
  const layers = [...trailLayers('trails'), ...drawLayers('draw-draft', 'draw-handles')];
  const style = {
    version: 8,
    name: 'check',
    glyphs: 'https://example.com/{fontstack}/{range}.pbf',
    sources: Object.fromEntries(
      ['trails', 'draw-draft', 'draw-handles'].map((id) => [
        id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      ]),
    ),
    layers,
  };

  const errors = validate(style);
  errors.length ? errors.forEach((e) => bad(`${e.message}`)) : ok(`${layers.length} layers validate`);

  // Filters are swapped in at runtime, so validate them the same way.
  const cases = [
    trailFilters(),
    trailFilters({ hiddenDifficulties: new Set(['easiest']), showPlaces: false, selectedId: 'abc' }),
    trailFilters({ hiddenDifficulties: new Set(['easiest', 'more-difficult', 'most-difficult', 'expert', 'unrated']) }),
  ];
  let filterErrors = 0;
  for (const set of cases) {
    for (const [id, filter] of Object.entries(set)) {
      const spec = layers.find((l) => l.id === id);
      if (!spec) { bad(`filter targets unknown layer "${id}"`); continue; }
      const probe = { ...style, layers: [{ ...spec, filter }] };
      for (const e of validate(probe)) { filterErrors++; bad(`${id}: ${e.message}`); }
    }
  }
  if (!filterErrors) ok(`${cases.length * Object.keys(cases[0]).length} filter combinations validate`);
}

// -- 2. DOM ids -------------------------------------------------------------

console.log('\nDOM wiring');
const html = read('index.html');
const appJs = read('js/app.js');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
// ids created at runtime by the details form and the hint bar
const runtimeIds = new Set(['det-readout', 'hint-finish', 'hint-done',
  ...[...read('js/schema.js').matchAll(/key: '(\w+)'/g)].map((m) => `f-${m[1]}`)]);

const missing = [...new Set([...appJs.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]))]
  .filter((id) => !htmlIds.has(id) && !runtimeIds.has(id));
missing.length ? missing.forEach((id) => bad(`app.js looks for #${id}, which index.html never defines`))
               : ok(`${htmlIds.size} element ids resolve`);

for (const asset of ['css/app.css', 'js/app.js', 'data/trails.geojson']) {
  fs.existsSync(path.join(SITE, asset)) ? ok(`${asset} present`) : bad(`${asset} is missing`);
}

// -- 3. published data ------------------------------------------------------

console.log('\nPublished data');
try {
  const fc = JSON.parse(read('data/trails.geojson'));
  if (fc.type !== 'FeatureCollection') bad('data/trails.geojson is not a FeatureCollection');
  const ids = new Set();
  let dupes = 0;
  let badGeom = 0;
  for (const f of fc.features ?? []) {
    const t = f.geometry?.type;
    if (t !== 'LineString' && t !== 'Point') badGeom++;
    if (ids.has(f.properties?.id)) dupes++;
    ids.add(f.properties?.id);
  }
  if (badGeom) bad(`${badGeom} feature(s) are neither LineString nor Point`);
  if (dupes) bad(`${dupes} duplicate feature id(s)`);
  if (!badGeom && !dupes) ok(`${fc.features.length} feature(s) look well-formed`);
} catch (err) {
  bad(`data/trails.geojson: ${err.message}`);
}

console.log(failures ? `\n${failures} problem(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
