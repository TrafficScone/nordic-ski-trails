// ---------------------------------------------------------------------------
// Every MapLibre layer this app adds, as plain data.
//
// Kept separate from app.js so the specs can be validated against the style
// spec without a browser (see tools/check.mjs) — a bad expression otherwise
// fails silently at runtime.
// ---------------------------------------------------------------------------

import { PLACE_TYPE, difficultyColorExpr, DIFFICULTY } from './schema.js';

export const IS_LINE = ['==', ['geometry-type'], 'LineString'];
export const IS_POINT = ['==', ['geometry-type'], 'Point'];

const LABEL_FONT = ['Roboto Medium', 'Noto Sans Regular'];
const BOLD_FONT = ['Roboto Bold', 'Noto Sans Bold'];

/** Trail stroke width, in the ballpark of a printed trail map at each zoom. */
const WIDTH = ['interpolate', ['linear'], ['zoom'], 10, 1.6, 13, 3, 16, 5.5, 19, 9];
const CASING_WIDTH = ['interpolate', ['linear'], ['zoom'], 10, 3.4, 13, 5.4, 16, 8.5, 19, 13];
// Roughly 55% of WIDTH. Written out rather than computed: MapLibre rejects a
// zoom expression nested inside arithmetic.
const DASH_WIDTH = ['interpolate', ['linear'], ['zoom'], 10, 0.9, 13, 1.7, 16, 3, 19, 5];

export const HIT_LAYERS = ['place-hit', 'trail-hit'];
export const HANDLE_LAYERS = ['draw-vertex', 'draw-mid'];

/** Layers for the trail/place data source, in draw order (bottom first). */
export function trailLayers(source) {
  return [
    // Selection glow, beneath the trail itself.
    {
      id: 'trail-selected', type: 'line', source,
      filter: ['all', IS_LINE, ['==', ['get', 'id'], '']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffb020',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 16, 19, 24],
        'line-opacity': 0.55,
        'line-blur': 1,
      },
    },
    {
      id: 'trail-casing', type: 'line', source, filter: IS_LINE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': 'rgba(255,255,255,0.9)', 'line-width': CASING_WIDTH },
    },
    {
      id: 'trail-line', type: 'line', source, filter: IS_LINE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': difficultyColorExpr,
        'line-width': WIDTH,
        'line-opacity': ['case', ['==', ['get', 'status'], 'closed'], 0.35, 1],
      },
    },
    // Closed trails get a hazard overlay, not just a faded colour.
    {
      id: 'trail-closed', type: 'line', source,
      filter: ['all', IS_LINE, ['==', ['get', 'status'], 'closed']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#c0392b', 'line-width': WIDTH, 'line-dasharray': [1.2, 1.6] },
    },
    // Ungroomed reads as a dashed line, the way printed trail maps show it.
    {
      id: 'trail-ungroomed', type: 'line', source,
      filter: ['all', IS_LINE, ['==', ['get', 'technique'], 'ungroomed'], ['!=', ['get', 'status'], 'closed']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(255,255,255,0.85)',
        'line-width': DASH_WIDTH,
        'line-dasharray': [1.5, 2],
      },
    },
    {
      id: 'trail-arrow', type: 'symbol', source, minzoom: 13,
      filter: ['all', IS_LINE, ['==', ['get', 'oneway'], true]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 90,
        'text-field': '▸', 'text-font': BOLD_FONT, 'text-size': 15,
        'text-allow-overlap': true, 'text-keep-upright': false,
        'text-rotation-alignment': 'map',
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 1 },
    },
    {
      id: 'trail-label', type: 'symbol', source, minzoom: 12.5, filter: IS_LINE,
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 260,
        'text-field': ['get', 'name'], 'text-font': LABEL_FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 13],
        'text-max-angle': 40, 'text-padding': 4,
      },
      paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    },
    // Fat invisible line so a trail is easy to hit with a finger.
    {
      id: 'trail-hit', type: 'line', source, filter: IS_LINE,
      paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 22 },
    },
    {
      id: 'place-selected', type: 'circle', source,
      filter: ['all', IS_POINT, ['==', ['get', 'id'], '']],
      paint: { 'circle-radius': 20, 'circle-color': '#ffb020', 'circle-opacity': 0.5, 'circle-blur': 0.4 },
    },
    {
      id: 'place-icon', type: 'symbol', source, filter: IS_POINT,
      layout: {
        'icon-image': ['match', ['coalesce', ['get', 'placeType'], 'other'],
          ...PLACE_TYPE.flatMap((p) => [p.value, `place-${p.value}`]), 'place-other'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.62, 18, 0.8],
        'icon-allow-overlap': true,
        'text-field': ['get', 'name'], 'text-font': LABEL_FONT,
        'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top',
        'text-optional': true, 'text-padding': 3,
      },
      paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    },
    {
      id: 'place-hit', type: 'circle', source, filter: IS_POINT,
      paint: { 'circle-radius': 18, 'circle-opacity': 0, 'circle-color': '#000000' },
    },
  ];
}

/**
 * Filters for the sidebar chips and the current selection.
 * @returns {Record<string, unknown[]>} layer id -> filter expression
 */
export function trailFilters({ hiddenDifficulties = new Set(), showPlaces = true, selectedId = '' } = {}) {
  const visible = DIFFICULTY.map((d) => d.value).filter((v) => !hiddenDifficulties.has(v));
  const byDifficulty = visible.length
    ? ['match', ['coalesce', ['get', 'difficulty'], 'unrated'], visible, true, false]
    : ['literal', false];
  const line = ['all', IS_LINE, byDifficulty];
  const point = ['all', IS_POINT, ['literal', !!showPlaces]];
  const id = selectedId ?? '';

  return {
    'trail-casing': line,
    'trail-line': line,
    'trail-label': line,
    'trail-hit': line,
    'trail-closed': [...line, ['==', ['get', 'status'], 'closed']],
    'trail-ungroomed': [...line, ['==', ['get', 'technique'], 'ungroomed'], ['!=', ['get', 'status'], 'closed']],
    'trail-arrow': [...line, ['==', ['get', 'oneway'], true]],
    'trail-selected': [...line, ['==', ['get', 'id'], id]],
    'place-icon': point,
    'place-hit': point,
    'place-selected': [...point, ['==', ['get', 'id'], id]],
  };
}

/** Layers for the in-progress line and its editing handles. */
export function drawLayers(draftSource, handleSource) {
  return [
    {
      id: 'draw-line', type: 'line', source: draftSource,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0f6fd1', 'line-width': 3,
        'line-dasharray': [2, 1.5], 'line-opacity': 0.95,
      },
    },
    {
      id: 'draw-mid', type: 'circle', source: handleSource,
      filter: ['==', ['get', 'handle'], 'mid'],
      paint: {
        'circle-radius': 4, 'circle-color': '#ffffff', 'circle-opacity': 0.85,
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#0f6fd1',
      },
    },
    {
      id: 'draw-vertex', type: 'circle', source: handleSource,
      filter: ['==', ['get', 'handle'], 'vertex'],
      paint: {
        'circle-radius': ['case', ['get', 'first'], 7, 5.5],
        'circle-color': ['case', ['get', 'first'], '#0f6fd1', '#ffffff'],
        'circle-stroke-width': 2,
        'circle-stroke-color': ['case', ['get', 'first'], '#ffffff', '#0f6fd1'],
      },
    },
  ];
}
