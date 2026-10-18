// ---------------------------------------------------------------------------
// Everything you'd normally want to tweak lives here.
// ---------------------------------------------------------------------------

// MapTiler key for the basemap tiles and fonts (style: js/basemap.js). The
// real key is never committed: it lives in .env locally and in the Netlify
// MAPTILER_KEY environment variable, and the Netlify build swaps it in for
// this placeholder (see netlify.toml). It still reaches visitors' browsers —
// tiles can't load without it — so MapTiler's allowed-origin restriction and
// usage limits are what protect it.
const BUILT_KEY = '__MAPTILER_KEY__';

// Local development only: the placeholder is never replaced on localhost, so
// open http://localhost:8000/?maptiler_key=<key from .env> once; the key is
// remembered in this browser and dropped from the address bar. (Checking for
// the leading "__" rather than the placeholder text, because the build's sed
// rewrites every copy of the placeholder in this file.)
const IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(globalThis.location?.hostname ?? '');
export const MAPTILER_KEY = BUILT_KEY.startsWith('__') && IS_LOCAL ? localKey() : BUILT_KEY;

function localKey() {
  const url = new URL(location.href);
  const given = url.searchParams.get('maptiler_key');
  try {
    if (given) {
      localStorage.setItem('maptiler-key', given);
      url.searchParams.delete('maptiler_key');
      history.replaceState(null, '', url);
    }
    return given || localStorage.getItem('maptiler-key') || '';
  } catch {
    return given || '';
  }
}

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

// Areas with their own logo, drawn beside the area's name at every zoom
// (never hidden by other labels) and smaller among the trails close in.
// `color` replaces the CalTopo colour of the area's tint and outline.
// North Boulder Park is the club's home area; Eldora uses the resort's mark.
export const AREA_MARKS = {
  'North Boulder Park': { mark: 'icons/bnc-mark.png', color: '#005daa' },
  Eldora: { mark: 'icons/eldora-mark.png', color: '#e75300' },
};
