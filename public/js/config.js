// ---------------------------------------------------------------------------
// Everything you'd normally want to tweak lives here.
// ---------------------------------------------------------------------------

// MapTiler key for the basemap tiles and fonts (style: js/basemap.js). The
// real key is never committed: it lives in .env locally and in the Netlify
// MAPTILER_KEY environment variable, and the Netlify build swaps it in for
// this placeholder (see netlify.toml). It still reaches visitors' browsers —
// tiles can't load without it — so MapTiler's allowed-origin restriction and
// usage limits are what protect it.
export const MAPTILER_KEY = '__MAPTILER_KEY__';

// Terrain-RGB elevation tiles, used to compute slope-angle shading.
export const DEM_TILES = `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${MAPTILER_KEY}`;

// Where the map opens before the trails load (Nederland, CO). Once they load,
// the map fits itself to all of them.
export const DEFAULT_VIEW = { center: [-105.51, 39.96], zoom: 11 };

// CalTopo GeoJSON exports live here; index.json lists them
// (written by tools/index_trails.py).
export const TRAILS_DIR = 'trails/';

// Used when a CalTopo feature carries no style of its own.
export const FALLBACK_COLOR = '#0f6fd1';

export const UNITS = 'mi'; // 'mi' | 'km'
