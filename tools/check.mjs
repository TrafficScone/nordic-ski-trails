// Static pre-flight for the map.
//
//   node tools/check.mjs
//
// Runs checks that would otherwise only fail (often silently) in the browser:
//   1. the basemap style plus the trail layers validate against the style spec
//   2. every element id app.js reaches for exists in index.html
//   3. trails/index.json matches the files in public/trails/, and each parses
//   4. the service worker's precache list covers the shell and matches index.html
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
const { trailLayers, HIT_LAYERS, selectionGlowLayers, selectionMarkerLayers, trailOpacity } =
  await import(path.join(SITE, 'js/layers.js'));
const { basemapStyle } = await import(path.join(SITE, 'js/basemap.js'));

let validate = null;
try {
  ({ validateStyleMin: validate } = await import('@maplibre/maplibre-gl-style-spec'));
} catch {
  console.log('  – skipped (npm install --prefix tools to enable)');
}

const layers = trailLayers('trails');
if (validate) {
  // The full style exactly as the browser builds it: basemap, then trails.
  const style = basemapStyle('KEY');
  const empty = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  style.sources.trails = empty;
  style.sources.selection = empty;
  style.layers = [...style.layers, ...selectionGlowLayers('selection'), ...layers, ...selectionMarkerLayers('selection')];
  // The dimming swapped in at runtime when a trail is selected.
  for (const id of ['trail-line', 'trail-dashed']) {
    const l = style.layers.find((x) => x.id === id);
    style.layers.push({ ...l, id: `${id}-dim-check`, paint: { ...l.paint, 'line-opacity': trailOpacity('trail:X') } });
  }
  const errors = validate(style);
  errors.length ? errors.forEach((e) => bad(e.message)) : ok(`${style.layers.length} layers validate (basemap + trails)`);
  const ids = style.layers.map((l) => l.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  dupes.length ? bad(`duplicate layer ids: ${dupes.join(', ')}`) : ok('layer ids are unique');
}
const unknownHits = HIT_LAYERS.filter((id) => !layers.some((l) => l.id === id));
unknownHits.length ? unknownHits.forEach((id) => bad(`HIT_LAYERS names unknown layer "${id}"`))
                   : ok('click targets name real layers');

// The MapTiler key comes from .env / the Netlify MAPTILER_KEY env var and is
// swapped in at build time; the committed config must keep the placeholder.
console.log('\nSecrets');
/__MAPTILER_KEY__/.test(read('js/config.js'))
  ? ok('js/config.js holds the __MAPTILER_KEY__ placeholder, not a key')
  : bad('js/config.js has a real MapTiler key in it — restore the __MAPTILER_KEY__ placeholder before committing');

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

// -- 4. offline -------------------------------------------------------------

console.log('\nOffline');
{
  const vm = await import('node:vm');
  const ctx = vm.createContext({ self: { addEventListener() {}, location: { origin: 'http://localhost' } }, URL, console });
  vm.runInContext(read('sw.js'), ctx);
  const shell = vm.runInContext('SHELL_FILES', ctx);
  const thirdParty = vm.runInContext('THIRD_PARTY_URLS', ctx);

  const absent = shell.filter((f) => f !== './' && !fs.existsSync(path.join(SITE, f)));
  absent.length ? absent.forEach((f) => bad(`sw.js precaches ${f}, which doesn't exist`))
                : ok(`${shell.length} precached shell paths exist`);

  const modules = fs.readdirSync(path.join(SITE, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);
  const forgotten = modules.filter((m) => !shell.includes(m));
  forgotten.length ? forgotten.forEach((m) => bad(`${m} is not in sw.js SHELL_FILES`))
                   : ok(`all ${modules.length} js modules are precached`);

  const used = [...html.matchAll(/(?:href|src)="(https:\/\/(?:unpkg\.com|fonts\.googleapis\.com)[^"]+)"/g)]
    .map((m) => m[1].replaceAll('&amp;', '&'));
  const mismatch = [...used.filter((u) => !thirdParty.includes(u)), ...thirdParty.filter((u) => !used.includes(u))];
  mismatch.length ? mismatch.forEach((u) => bad(`sw.js and index.html disagree on ${u}`))
                  : ok(`${used.length} third-party URLs match index.html`);
}

console.log(failures ? `\n${failures} problem(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
