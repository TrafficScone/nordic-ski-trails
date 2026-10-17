// Unit tests for public/sw.js, run in a node:vm sandbox with a fake worker scope.
//
//   node tools/test_sw.mjs
//
// Covers routing, the tiles cache trim, network-first fallback and cache-first.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'public');
const ORIGIN = 'http://localhost:8000';

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

/** Map-backed stand-in for a Cache; keys() is insertion order, like the real one. */
class FakeCache {
  constructor() { this.map = new Map(); }
  keyOf(req) { return typeof req === 'string' ? new URL(req, ORIGIN).href : req.url; }
  async match(req) { return this.map.get(this.keyOf(req))?.clone(); }
  async put(req, res) { this.map.delete(this.keyOf(req)); this.map.set(this.keyOf(req), res); }
  async add(req) { await this.put(req, await fetch(req)); }
  async delete(req) { return this.map.delete(this.keyOf(req)); }
  async keys() { return [...this.map.keys()].map((url) => ({ url })); }
}

const stores = new Map();
const handlers = {};
let fetchImpl = async () => new Response('net', { status: 200 });
let fetchCalls = 0;

const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, location: { origin: ORIGIN } };
const ctx = vm.createContext({
  self, URL, Request, Response, Headers, Promise, setTimeout, clearTimeout, console,
  caches: {
    open: async (n) => { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n); },
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
  },
  clients: { claim: async () => {} },
  fetch: (...a) => { fetchCalls++; return fetchImpl(...a); },
});
vm.runInContext(fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const routeFor = (u) => ctx.routeFor(u, ORIGIN);

// -- routing ----------------------------------------------------------------

console.log('\nrouteFor');
const cases = [
  [`${ORIGIN}/js/app.js`, 'shell'],
  [`${ORIGIN}/trails/osm.geojson`, 'shell'],
  [`${ORIGIN}/`, 'shell'],
  ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js', 'cdn'],
  ['https://fonts.googleapis.com/css2?family=Inter', 'cdn'],
  ['https://fonts.gstatic.com/s/inter/v13/x.woff2', 'cdn'],
  ['https://api.maptiler.com/tiles/v3/5/6/12.pbf?key=K', 'tiles'],
  ['https://api.maptiler.com/tiles/terrain-rgb-v2/12/849/1556.webp?key=K', 'tiles'],
  ['https://api.maptiler.com/fonts/Inter%20Regular/0-255.pbf?key=K', 'tiles'],
  ['https://api.maptiler.com/tiles/v3/tiles.json?key=K', 'tiles'],
  ['https://api.maptiler.com/maps/winter/sprite@2x.png?key=K', 'tiles'],
  ['https://overpass-api.de/api/interpreter', null],
  ['https://www.caic.org/', null],
  ['chrome-extension://abc/x.js', null],
];
for (const [url, want] of cases) check(routeFor(url) === want, `${url} -> ${want}`);
check(ctx.routeForRequest({ method: 'POST', url: `${ORIGIN}/js/app.js` }, ORIGIN) === null, 'POST is not handled');
check(ctx.routeForRequest({ method: 'GET', url: `${ORIGIN}/js/app.js` }, ORIGIN) === 'shell', 'GET is handled');

// -- tiles trim ---------------------------------------------------------------

console.log('\nTiles trim');
{
  const max = run('MAX_TILES');
  const cache = new FakeCache();
  for (let i = 0; i < max + 10; i++) await cache.put(`https://api.maptiler.com/t/${i}`, new Response('x'));
  const dropped = await ctx.trimCache(cache);
  const left = (await cache.keys()).map((k) => Number(k.url.split('/').pop()));
  check(left.length <= max, `trimmed ${max + 10} -> ${left.length} (<= ${max})`);
  check(left.length === Math.floor(max * 0.9), 'trims down to ~90 %');
  check(left[0] === dropped && left.at(-1) === max + 9, 'oldest entries went first, newest kept');
  const small = new FakeCache();
  await small.put('https://api.maptiler.com/t/1', new Response('x'));
  check((await ctx.trimCache(small)) === 0, 'no trim under the cap');
}

// -- network-first ------------------------------------------------------------

console.log('\nnetworkFirst');
{
  const req = new Request(`${ORIGIN}/trails/osm.geojson`);
  fetchImpl = async () => new Response('fresh', { status: 200 });
  const online = await ctx.networkFirst(req);
  check((await online.text()) === 'fresh', 'online: serves the network response');
  const cached = await (await ctx.caches.open('bnc-shell-v1')).match(req);
  check(cached && (await cached.text()) === 'fresh', 'online: updates the cache');

  fetchImpl = async () => { throw new TypeError('offline'); };
  const off = await ctx.networkFirst(req);
  check((await off.text()) === 'fresh', 'offline: falls back to cache');

  const shell = await ctx.caches.open('bnc-shell-v1');
  await shell.put('index.html', new Response('<html>'));
  const nav = { url: `${ORIGIN}/somewhere`, mode: 'navigate' };
  const page = await ctx.networkFirst(nav);
  check((await page.text()) === '<html>', 'offline navigation falls back to index.html');

  let threw = false;
  try { await ctx.networkFirst(new Request(`${ORIGIN}/nope.js`)); } catch { threw = true; }
  check(threw, 'offline with nothing cached rejects');

  fetchImpl = () => new Promise(() => {});
  const slow = await ctx.networkFirst(req, 'bnc-shell-v1', 20);
  check((await slow.text()) === 'fresh', 'slow network times out to cache');

  fetchImpl = async () => new Response('err', { status: 500 });
  await ctx.networkFirst(req);
  check((await (await shell.match(req)).text()) === 'fresh', 'error responses are not cached');
}

// -- cache-first --------------------------------------------------------------

console.log('\ncacheFirst');
{
  const cdnReq = new Request('https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js');
  const cdn = await ctx.caches.open('bnc-cdn-v1');
  await cdn.put(cdnReq, new Response('cached'));
  fetchCalls = 0;
  const hit = await ctx.cacheFirst(cdnReq);
  check((await hit.text()) === 'cached' && fetchCalls === 0, 'hit: no fetch');

  const miss = new Request('https://fonts.gstatic.com/a.woff2');
  fetchImpl = async () => new Response('font', { status: 200 });
  await ctx.cacheFirst(miss);
  check(fetchCalls === 1 && !!(await cdn.match(miss)), 'miss: fetches once and stores');

  fetchImpl = async () => new Response('', { status: 404 });
  const notFound = new Request('https://unpkg.com/missing.js');
  await ctx.cacheFirst(notFound);
  check(!(await cdn.match(notFound)), 'non-ok responses are not stored');
}

// -- tiles: freshness stamp ---------------------------------------------------

console.log('\nTile freshness');
{
  const tile = new Request('https://api.maptiler.com/tiles/v3/1/1/1.pbf?key=K');
  fetchImpl = async () => new Response('tile', { status: 200 });
  await ctx.tileFetch(tile, null);
  const stored = await (await ctx.caches.open('bnc-tiles-v1')).match(tile);
  check(stored && Number(stored.headers.get('sw-fetched-at')) > 0, 'stored tile carries sw-fetched-at');

  const old = new Response('old', { headers: { 'sw-fetched-at': String(Date.now() - 31 * 864e5) } });
  await (await ctx.caches.open('bnc-tiles-v1')).put(tile, old);
  let waited = 0;
  fetchCalls = 0;
  const got = await ctx.tileFetch(tile, { waitUntil: (p) => { waited++; return p; } });
  check((await got.text()) === 'old' && waited === 1, 'stale tile is served and refreshed in the background');
}

// -- lifecycle ----------------------------------------------------------------

console.log('\nLifecycle');
{
  stores.set('bnc-shell-v0', new FakeCache());
  stores.set('other-app', new FakeCache());
  let pending;
  handlers.activate({ waitUntil: (p) => { pending = p; } });
  await pending;
  check(!stores.has('bnc-shell-v0'), 'activate deletes old bnc- caches');
  check(stores.has('other-app'), 'activate leaves foreign caches alone');
  check(typeof handlers.install === 'function' && typeof handlers.fetch === 'function', 'install and fetch handlers registered');
}

console.log(failures ? `\n${failures} failed\n` : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
