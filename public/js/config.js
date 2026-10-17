// ---------------------------------------------------------------------------
// Everything you'd normally want to tweak lives here.
// ---------------------------------------------------------------------------

// MapTiler style. The key is public by design (it ships in the browser bundle);
// lock it to your domain in the MapTiler dashboard under "Allowed origins".
export const MAP_STYLE =
  'https://api.maptiler.com/maps/01967511-76ed-7306-9c9c-55391002f413/style.json?key=S4gR7zmBTb2rOCbaTlBy';

// Where the map opens when there's no saved view and no trail data yet.
// (Theodore Wirth Park, Minneapolis — change to your home trail system.)
export const DEFAULT_VIEW = { center: [-93.3272, 44.995], zoom: 13.5 };

// Published trail data, committed to the repo and deployed with the site.
export const DATA_URL = 'data/trails.geojson';

// Terrain exaggeration used by the ⛰ button. The MapTiler style already
// carries a `terrain-rgb` raster-dem source, so no extra request is needed.
export const TERRAIN = { source: 'terrain-rgb', exaggeration: 1.4 };

// localStorage keys — bump the suffix to invalidate everyone's local edits.
export const STORAGE_KEY = 'nordic-trails/features/v1';
export const VIEW_KEY = 'nordic-trails/view/v1';
export const PREFS_KEY = 'nordic-trails/prefs/v1';

export const DEFAULT_UNITS = 'mi'; // 'mi' | 'km'
