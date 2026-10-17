// ---------------------------------------------------------------------------
// Every MapLibre layer this app adds, as plain data.
//
// Kept separate from app.js so the specs can be validated against the style
// spec without a browser (see tools/check.mjs) — a bad expression otherwise
// fails silently at runtime.
//
// Layers read the `_color`, `_width`, `_opacity`, `_dashed`, `_fillOpacity`
// and `_name` properties that app.js derives from CalTopo's own styling.
// ---------------------------------------------------------------------------

const LABEL_FONT = ['Inter SemiBold', 'Noto Sans Bold'];

const IS_LINE = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];
const IS_AREA = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
const IS_POINT = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];

export const HIT_LAYERS = ['marker-dot', 'trail-hit', 'area-fill'];

/** Layers for the trail source, in draw order (bottom first). */
export function trailLayers(source) {
  return [
    {
      id: 'area-fill', type: 'fill', source, filter: IS_AREA,
      paint: { 'fill-color': ['get', '_color'], 'fill-opacity': ['get', '_fillOpacity'] },
    },
    {
      id: 'area-outline', type: 'line', source, filter: IS_AREA,
      paint: { 'line-color': ['get', '_color'], 'line-width': ['get', '_width'], 'line-opacity': ['get', '_opacity'] },
    },
    // White casing so trails stand out against the basemap.
    {
      id: 'trail-casing', type: 'line', source, filter: IS_LINE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': 'rgba(255,255,255,0.85)', 'line-width': ['+', ['get', '_width'], 3] },
    },
    {
      id: 'trail-line', type: 'line', source,
      filter: ['all', IS_LINE, ['!=', ['get', '_dashed'], true]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', '_color'], 'line-width': ['get', '_width'], 'line-opacity': ['get', '_opacity'] },
    },
    // CalTopo's non-solid patterns all render as one dash style.
    {
      id: 'trail-dashed', type: 'line', source,
      filter: ['all', IS_LINE, ['==', ['get', '_dashed'], true]],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', '_color'], 'line-width': ['get', '_width'], 'line-opacity': ['get', '_opacity'],
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'trail-label', type: 'symbol', source, minzoom: 12, filter: IS_LINE,
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 300,
        'text-field': ['get', '_name'], 'text-font': LABEL_FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11.5, 17, 14],
        // CalTopo lines are hand-drawn and jagged; a strict bend limit means
        // MapLibre finds nowhere to place the name at all.
        'text-max-angle': 80, 'text-padding': 4,
      },
      paint: { 'text-color': '#222222', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    },
    // Fat invisible line so a trail is easy to hit with a finger.
    {
      id: 'trail-hit', type: 'line', source, filter: IS_LINE,
      paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 22 },
    },
    {
      id: 'marker-dot', type: 'circle', source, filter: IS_POINT,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 7],
        'circle-color': ['get', '_color'],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
      },
    },
    {
      id: 'marker-label', type: 'symbol', source, minzoom: 11, filter: IS_POINT,
      layout: {
        'text-field': ['get', '_name'], 'text-font': LABEL_FONT,
        'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-padding': 3,
      },
      paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    },
  ];
}
