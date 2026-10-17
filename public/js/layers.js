// ---------------------------------------------------------------------------
// Every MapLibre layer this app adds, as plain data.
//
// Kept separate from app.js so the specs can be validated against the style
// spec without a browser (see tools/check.mjs) — a bad expression otherwise
// fails silently at runtime.
//
// Layers read the `_color`, `_width`, `_opacity`, `_dashed`, `_fillOpacity`, `_glyph`
// and `_name` properties that app.js derives from CalTopo's own styling.
// ---------------------------------------------------------------------------

const LABEL_FONT = ['Inter SemiBold', 'Noto Sans Bold'];
const GLYPH_FONT = ['Inter Bold', 'Noto Sans Bold'];

// CalTopo widths are in its own pixels (2 is typical) and look hairline-thin
// here at low zoom and timid up close, so scale them with zoom. Each stop is
// written out: MapLibre rejects a zoom expression nested inside arithmetic.
const w = (k, add) => ['+', ['*', ['get', '_width'], k], add];
const WIDTH = ['interpolate', ['linear'], ['zoom'], 10, w(0.6, 0.6), 14, w(1, 1), 17, w(1.5, 2)];
const CASING = ['interpolate', ['linear'], ['zoom'], 10, w(0.6, 2.6), 14, w(1, 4), 17, w(1.5, 5.5)];

const IS_LINE = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];
const IS_AREA = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
const IS_POINT = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];

export const HIT_LAYERS = ['marker-dot', 'trail-hit', 'area-fill'];

/** Layers for the trail source, in draw order (bottom first). */
export function trailLayers(source) {
  return [
    // Areas (CalTopo polygons) say "here's a place to ski": a tint that's
    // strongest zoomed out and fades as the trails take over.
    {
      id: 'area-fill', type: 'fill', source, filter: IS_AREA,
      paint: {
        'fill-color': ['get', '_color'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.18, 12, 0.08, 14, 0.03],
      },
    },
    {
      id: 'area-outline', type: 'line', source, filter: IS_AREA,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', '_color'], 'line-dasharray': [3, 2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.9, 14, 0.5],
      },
    },
    // White casing so trails stand out against the basemap.
    {
      id: 'trail-casing', type: 'line', source, filter: IS_LINE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': 'rgba(255,255,255,0.9)', 'line-width': CASING },
    },
    {
      id: 'trail-line', type: 'line', source,
      filter: ['all', IS_LINE, ['!=', ['get', '_dashed'], true]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', '_color'], 'line-width': WIDTH, 'line-opacity': ['get', '_opacity'] },
    },
    // CalTopo's non-solid patterns all render as one dash style.
    {
      id: 'trail-dashed', type: 'line', source,
      filter: ['all', IS_LINE, ['==', ['get', '_dashed'], true]],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', '_color'], 'line-width': WIDTH, 'line-opacity': ['get', '_opacity'],
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
      id: 'area-label', type: 'symbol', source, maxzoom: 12.5, filter: IS_AREA,
      layout: {
        'text-field': ['get', '_section'], 'text-font': LABEL_FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 12, 15],
        'text-max-width': 8, 'text-letter-spacing': 0.02,
      },
      paint: { 'text-color': '#0c3d54', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    },
    // Markers: a disc in the CalTopo marker colour with a one-letter glyph
    // for its symbol (P for parking…) — drawn with the map font, so no icon
    // sprite is needed.
    {
      id: 'marker-dot', type: 'circle', source, filter: IS_POINT,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 13, 10, 16, 12],
        'circle-color': ['get', '_color'],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
      },
    },
    {
      id: 'marker-glyph', type: 'symbol', source, minzoom: 12, filter: IS_POINT,
      layout: {
        'text-field': ['get', '_glyph'], 'text-font': GLYPH_FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    },
    {
      id: 'marker-label', type: 'symbol', source, minzoom: 11, filter: IS_POINT,
      layout: {
        'text-field': ['get', '_name'], 'text-font': LABEL_FONT,
        'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-padding': 3,
        'text-max-width': 9,
      },
      paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    },
  ];
}

// ---------------------------------------------------------------------------
// The selected trail: a glow under it, the other trails dimmed, start/end
// markers, and a dot that follows the pointer along the elevation profile.
// The `selection` source holds features with a `role`: 'line' (the trail),
// 'start', 'end', 'loop' (start and end together) or 'cursor'.
// ---------------------------------------------------------------------------

const SELECT_INK = '#0c3d54';
const ROLE = (r) => ['==', ['get', 'role'], r];

/**
 * Halo beneath the selected trail: a white band with a navy edge. Not yellow
 * or any warm colour — those belong to slope shading — and not green/blue/
 * black, which are trail difficulties. Add it before 'trail-casing'.
 */
export function selectionGlowLayers(source) {
  const width = (k) => ['interpolate', ['linear'], ['zoom'], 10, 9 + k, 14, 14 + k, 17, 20 + k];
  return [
    {
      id: 'sel-edge', type: 'line', source, filter: ROLE('line'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': SELECT_INK, 'line-width': width(3), 'line-opacity': 0.55 },
    },
    {
      id: 'sel-glow', type: 'line', source, filter: ROLE('line'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': width(0) },
    },
  ];
}

/** Start/end markers and the profile cursor, drawn above everything. */
export function selectionMarkerLayers(source) {
  const isEnd = ['in', ['get', 'role'], ['literal', ['start', 'end', 'loop']]];
  return [
    {
      id: 'sel-end-disc', type: 'circle', source, filter: isEnd,
      paint: {
        'circle-radius': 11, 'circle-color': SELECT_INK,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
      },
    },
    {
      id: 'sel-end-glyph', type: 'symbol', source, filter: isEnd,
      layout: {
        'text-field': ['match', ['get', 'role'], 'start', 'S', 'end', 'E', 'S/E'],
        'text-font': ['Inter Bold', 'Noto Sans Bold'],
        'text-size': ['match', ['get', 'role'], 'loop', 9, 12],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    },
    {
      id: 'sel-end-label', type: 'symbol', source, filter: isEnd, minzoom: 12,
      layout: {
        'text-field': ['match', ['get', 'role'], 'start', 'Start', 'end', 'End', 'Start · End'],
        'text-font': ['Inter SemiBold', 'Noto Sans Bold'], 'text-size': 12,
        'text-anchor': 'left', 'text-offset': [1.3, 0], 'text-allow-overlap': true,
      },
      paint: { 'text-color': SELECT_INK, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    },
    {
      id: 'sel-cursor', type: 'circle', source, filter: ROLE('cursor'),
      paint: {
        'circle-radius': 7, 'circle-color': '#ffffff',
        'circle-stroke-color': SELECT_INK, 'circle-stroke-width': 3.5,
      },
    },
  ];
}

/**
 * line-opacity for the trail layers while a trail is selected: the selected
 * one keeps its CalTopo opacity, the rest fade back. '' = nothing selected.
 */
export function trailOpacity(selectedGroup = '') {
  if (!selectedGroup) return ['get', '_opacity'];
  return ['case', ['==', ['get', '_group'], selectedGroup], ['get', '_opacity'], 0.3];
}
