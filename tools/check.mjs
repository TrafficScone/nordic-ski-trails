// Static pre-flight for the map.
//
//   node tools/check.mjs
//
// Runs checks that would otherwise only fail (often silently) in the browser:
//   1. every MapLibre layer spec validates against the style spec
//   2. every element id app.js reaches for exists in index.html
//   3. trails/index.json matches the files in public/trails/, and each parses
//
// Everything it reads lives under public/ — the only folder that deploys.
//
// The style-spec validator is optional: `npm install --prefix tools` enables
// check 1, and it's skipped with a note if that isn't installed.

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
const { trailLayers, HIT_LAYERS } = await import(path.join(SITE, 'js/layers.js'));

let validate = null;
try {
  ({ validateStyleMin: validate } = await import('@maplibre/maplibre-gl-style-spec'));
} catch {
  console.log('  – skipped (npm install --prefix tools to enable)');
}

const layers = trailLayers('trails');
if (validate) {
  const style = {
    version: 8,
    name: 'check',
    glyphs: 'https://example.com/{fontstack}/{range}.pbf',
    sources: { trails: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers,
  };
  const errors = validate(style);
  errors.length ? errors.forEach((e) => bad(e.message)) : ok(`${layers.length} layers validate`);
}
const unknownHits = HIT_LAYERS.filter((id) => !layers.some((l) => l.id === id));
unknownHits.length ? unknownHits.forEach((id) => bad(`HIT_LAYERS names unknown layer "${id}"`))
                   : ok('click targets name real layers');

// -- 2. DOM ids -------------------------------------------------------------

console.log('\nDOM wiring');
const html = read('index.html');
const appJs = read('js/app.js');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const missing = [...new Set([...appJs.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]))]
  .filter((id) => !htmlIds.has(id));
missing.length ? missing.forEach((id) => bad(`app.js looks for #${id}, which index.html never defines`))
               : ok(`${htmlIds.size} element ids resolve`);

// -- 3. trail files ---------------------------------------------------------

console.log('\nTrail files');
const dir = path.join(SITE, 'trails');
const onDisk = fs.readdirSync(dir).filter((f) => /\.(geo)?json$/.test(f) && f !== 'index.json').sort();
let listed = [];
try {
  listed = JSON.parse(read('trails/index.json'));
} catch (err) {
  bad(`trails/index.json: ${err.message}`);
}
const unlisted = onDisk.filter((f) => !listed.includes(f));
const gone = listed.filter((f) => !onDisk.includes(f));
if (unlisted.length || gone.length) {
  unlisted.forEach((f) => bad(`${f} is not in index.json — run python3 tools/index_trails.py`));
  gone.forEach((f) => bad(`index.json lists ${f}, which doesn't exist`));
} else {
  ok(`index.json lists all ${onDisk.length} file(s)`);
}
for (const f of onDisk) {
  try {
    const fc = JSON.parse(read(`trails/${f}`));
    if (fc.type !== 'FeatureCollection') bad(`${f} is not a FeatureCollection`);
    else ok(`${f}: ${fc.features?.length ?? 0} feature(s)`);
  } catch (err) {
    bad(`${f}: ${err.message}`);
  }
}

console.log(failures ? `\n${failures} problem(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
