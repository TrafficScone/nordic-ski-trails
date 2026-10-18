// ---------------------------------------------------------------------------
// Service worker: lets the trail map load, and show maps already viewed, offline.
//
// Three caches, all versioned (bump CACHE_VERSION to drop old ones on activate):
//   bnc-shell-vN  the app itself: page, CSS, JS modules, trail data
//   bnc-cdn-vN    MapLibre (unpkg) and Inter (Google Fonts)
//   bnc-tiles-vN  whatever MapTiler returned while online: vector, contour and
//                 terrain-RGB tiles, glyphs, sprites, tiles.json
//
// Strategy per route (see routeFor):
//   shell  network-first, ~4 s timeout, then cache. Trail data must never be
//          stale online but must work offline. Offline navigations get index.html.
//   cdn    cache-first; the URLs are versioned and immutable.
//   tiles  cache-first; entries older than 30 days refresh in the background.
//          Only ok responses are stored (never opaque ones). The cache is capped
//          at MAX_TILES entries, oldest inserted dropped first, trimmed lazily.
//   null   not intercepted (Overpass, external links, non-GET).
//
// Deliberately not done: no "download an area" or bulk tile prefetch. Check
// MapTiler's terms before ever adding one. Only tiles actually viewed are saved.
//
// Classic script (not a module) so Firefox registers it. Routing and cache
// helpers are plain top-level functions so tools/test_sw.mjs can call them.
// ---------------------------------------------------------------------------

const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'bnc-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const CDN_CACHE = `${CACHE_PREFIX}cdn-${CACHE_VERSION}`;
const TILES_CACHE = `${CACHE_PREFIX}tiles-${CACHE_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, CDN_CACHE, TILES_CACHE];

/** App shell, relative to this file. Every js/*.js module must be listed (check.mjs enforces it). */
const SHELL_FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/basemap.js',
  'js/conditions.js',
  'js/config.js',
  'js/dem.js',
  'js/filters.js',
  'js/gpx.js',
  'js/icons.js',
  'js/layers.js',
  'js/live-conditions.js',
  'js/partners.js',
  'js/profile.js',
  'js/share.js',
  'js/slope.js',
  'manifest.webmanifest',
  'icons/bnc-mark.png',
  'icons/bns-logo.png',
  'icons/bns-mark.png',
  'icons/eldora-mark.png', 'icons/dtr-mark.png', 'icons/smr-mark.png',
];

/** Trail file list; the files it names are precached too. */
const TRAIL_INDEX = 'trails/index.json';

/** Third-party URLs from index.html (check.mjs keeps these in sync). Failures don't fail install. */
const THIRD_PARTY_URLS = [
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

const NETWORK_TIMEOUT_MS = 4000;
const TILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TILES = 4000;
const TRIM_TO = 0.9;
const TRIM_DELAY_MS = 5000;
const FETCHED_AT = 'sw-fetched-at';

const CDN_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const TILE_HOSTS = ['api.maptiler.com'];

// -- routing ----------------------------------------------------------------

/** Which strategy handles this URL: 'shell', 'cdn', 'tiles', or null (don't intercept). */
function routeFor(url, selfOrigin) {
  let u;
  try {
    u = new URL(url, selfOrigin);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.origin === selfOrigin) return 'shell';
  if (CDN_HOSTS.includes(u.hostname)) return 'cdn';
  if (TILE_HOSTS.includes(u.hostname)) return 'tiles';
  return null;
}

/** Route for a fetch request: GET only. */
function routeForRequest(request, selfOrigin) {
  return request.method === 'GET' ? routeFor(request.url, selfOrigin) : null;
}

// -- helpers ----------------------------------------------------------------

/** Copy of a response with the fetch time stamped on it, so tile age is known. */
async function withFetchedAt(response) {
  const headers = new Headers(response.headers);
  headers.set(FETCHED_AT, String(Date.now()));
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Age in ms of a cached tile; Infinity if unknown. */
function ageOf(response) {
  const t = Number(response.headers.get(FETCHED_AT));
  return t ? Date.now() - t : Infinity;
}

/** Fetch, but give up waiting after `ms` (the request itself keeps going). */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (r) => { clearTimeout(timer); resolve(r); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// -- strategies -------------------------------------------------------------

/** Network first (with timeout), cache as fallback; successful responses refresh the cache. */
async function networkFirst(request, cacheName = SHELL_CACHE, timeoutMs = NETWORK_TIMEOUT_MS) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const page = (await cache.match('index.html')) || (await cache.match('./'));
      if (page) return page;
    }
    throw err;
  }
}

/** Cache first; on a miss fetch and store. `cors` re-requests no-cors loads so they can be stored. */
async function cacheFirst(request, cacheName = CDN_CACHE, { cors = false } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(cors && request.mode === 'no-cors'
    ? new Request(request.url, { mode: 'cors', credentials: 'omit' })
    : request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Cache first for map tiles; stale entries refresh in the background. */
async function tileFetch(request, event) {
  const cache = await caches.open(TILES_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    if (ageOf(hit) > TILE_MAX_AGE_MS && event) event.waitUntil(refreshTile(request).catch(() => {}));
    return hit;
  }
  const response = await fetch(request.mode === 'no-cors'
    ? new Request(request.url, { mode: 'cors', credentials: 'omit' })
    : request);
  if (response.ok) {
    await cache.put(request, await withFetchedAt(response.clone()));
    scheduleTrim();
  }
  return response;
}

async function refreshTile(request) {
  const response = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
  if (!response.ok) return;
  const cache = await caches.open(TILES_CACHE);
  await cache.put(request, await withFetchedAt(response));
}

/** Delete the oldest entries (cache.keys() is insertion order) once over `max`, down to TRIM_TO of it. */
async function trimCache(cache, max = MAX_TILES) {
  const keys = await cache.keys();
  if (keys.length <= max) return 0;
  const drop = keys.length - Math.floor(max * TRIM_TO);
  await Promise.all(keys.slice(0, drop).map((k) => cache.delete(k)));
  return drop;
}

let trimTimer = null;

/** Debounced: trims once things go quiet, not on every tile. */
function scheduleTrim() {
  if (trimTimer) clearTimeout(trimTimer);
  trimTimer = setTimeout(() => {
    trimTimer = null;
    caches.open(TILES_CACHE).then((c) => trimCache(c)).catch(() => {});
  }, TRIM_DELAY_MS);
}

// -- lifecycle --------------------------------------------------------------

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  // 'reload' skips the HTTP cache so a new version never precaches old files.
  const fresh = (url) => new Request(url, { cache: 'reload' });
  const trailFiles = await fetch(fresh(TRAIL_INDEX)).then((r) => {
    if (!r.ok) throw new Error(`${TRAIL_INDEX}: ${r.status}`);
    return shell.put(TRAIL_INDEX, r.clone()).then(() => r.json());
  });
  // Shell failures fail the install on purpose: a half-cached app is worse than none.
  await Promise.all([
    ...SHELL_FILES.map((f) => shell.add(fresh(f))),
    ...trailFiles.map((f) => shell.add(fresh(`trails/${f}`))),
  ]);

  const cdn = await caches.open(CDN_CACHE);
  await Promise.all(THIRD_PARTY_URLS.map(async (url) => {
    try {
      const response = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
      if (!response.ok) return;
      await cdn.put(url, response.clone());
      if (url.includes('fonts.googleapis.com')) await precacheFontFiles(cdn, await response.text());
    } catch {
      // Offline or blocked: the cdn route fills the cache on first use instead.
    }
  }));
}

/** Font files named by the Google Fonts CSS, so Inter works offline from the first visit. */
async function precacheFontFiles(cache, css) {
  const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map((m) => m[1]);
  await Promise.all(urls.map((u) => cache.add(new Request(u, { mode: 'cors', credentials: 'omit' })).catch(() => {})));
}

async function cleanup() {
  const names = await caches.keys();
  await Promise.all(names
    .filter((n) => n.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(n))
    .map((n) => caches.delete(n)));
  await clients.claim();
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanup());
});

self.addEventListener('fetch', (event) => {
  const route = routeForRequest(event.request, self.location.origin);
  if (route === 'shell') event.respondWith(networkFirst(event.request));
  else if (route === 'cdn') event.respondWith(cacheFirst(event.request, CDN_CACHE, { cors: true }));
  else if (route === 'tiles') event.respondWith(tileFetch(event.request, event));
});
