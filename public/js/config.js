// ---------------------------------------------------------------------------
// Everything you'd normally want to tweak lives here.
// ---------------------------------------------------------------------------

// MapTiler style. The key is public by design (it ships in the browser bundle);
// lock it to your domain in the MapTiler dashboard under "Allowed origins".
export const MAP_STYLE =
  'https://api.maptiler.com/maps/01967511-76ed-7306-9c9c-55391002f413/style.json?key=S4gR7zmBTb2rOCbaTlBy';

// Where the map opens before the trails load (Nederland, CO). Once they load,
// the map fits itself to all of them.
export const DEFAULT_VIEW = { center: [-105.51, 39.96], zoom: 11 };

// CalTopo GeoJSON exports live here; index.json lists them
// (written by tools/index_trails.py).
export const TRAILS_DIR = 'trails/';

// Used when a CalTopo feature carries no style of its own.
export const FALLBACK_COLOR = '#0f6fd1';

export const UNITS = 'mi'; // 'mi' | 'km'
