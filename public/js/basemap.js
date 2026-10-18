// ---------------------------------------------------------------------------
// "Corduroy" — a light winter basemap, as a plain MapLibre style object.
//
// Built from MapTiler's vector tiles so every colour and label is ours. The
// design rules it follows:
//
//  • The basemap recedes; the trails (styled from CalTopo) are the figure.
//    So: low saturation everywhere, no colour that competes with a trail.
//  • Snow-white ground, not pure white — a white trail casing and white label
//    halos still read against it.
//  • Forest vs. open terrain is the most useful landcover in winter (shelter,
//    snow quality, visibility, navigation), so forest is the one fill that
//    gets real weight; treeline should be obvious at a glance.
//  • Relief from a soft, cool hillshade plus a single-hue contour set: thin
//    40 ft lines, heavier labelled index lines. One hue, because multicolour
//    contours lose contrast on a white map.
//  • Type: Inter (the Boulder Nordic Club's web font), with a clear hierarchy —
//    places upright and dark, water italic blue, terrain italic brown-grey,
//    roads small and grey. Halos everywhere, sized for phones in glare.
//  • Feet and miles: the audience is American, and USGS quads are in feet.
//  • Slope-angle shading is on by default (toggle in the map key) and sits above the
//    relief but under everything else, half-transparent, so contours and
//    forest still read through it.
//
// Sources and the reasoning behind each rule: docs/cartography.md.
// ---------------------------------------------------------------------------

/** Every colour in the basemap. Change the palette here, not in the layers. */
export const PALETTE = {
  snow: '#f7f8f8',
  forest: '#d3dfd3',
  forestEdge: '#b7c9b8',
  scrub: '#e3e9e0',
  rock: '#e9e6e1',
  ice: '#eef5fa',
  water: '#bcd3e6',
  waterLine: '#8fb4d3',
  waterText: '#2f5f88',
  shadow: '#5e7184',
  highlight: '#ffffff',
  contour: '#8a7a68',
  contourText: '#76685a',
  road: '#ffffff',
  roadCasing: '#b9bcbf',
  majorRoad: '#fdf3e1',
  majorCasing: '#c9b28e',
  path: '#7a8086',
  otherNordic: '#5f7d96',
  alpine: '#c4c9ce',     // downhill runs: present but recessive
  lift: '#8d949b',
  building: '#dcdcdc',
  protected: '#6f9a7c',
  ink: '#222222',        // BNC --contrast
  ink2: '#4c5560',
  ink3: '#6b737c',
  halo: '#ffffff',
};

const P = PALETTE;
const REGULAR = ['Inter Regular', 'Noto Sans Regular'];
const MEDIUM = ['Inter Medium', 'Noto Sans Regular'];
const SEMIBOLD = ['Inter SemiBold', 'Noto Sans Bold'];
const ITALIC = ['Inter Italic', 'Noto Sans Italic'];

const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name']];
const z = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const halo = (width = 1.5) => ({ 'text-halo-color': P.halo, 'text-halo-width': width, 'text-halo-blur': 0.5 });

/**
 * The complete style. `key` is the public MapTiler key.
 * @returns {object} a MapLibre style specification
 */
export function basemapStyle(key) {
  const tiles = (id) => `https://api.maptiler.com/tiles/${id}/tiles.json?key=${key}`;
  return {
    version: 8,
    name: 'Corduroy',
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
    sprite: `https://api.maptiler.com/maps/outdoor-v2/sprite?key=${key}`,
    sources: {
      planet: { type: 'vector', url: tiles('v3') },
      outdoor: { type: 'vector', url: tiles('outdoor') },
      contours: { type: 'vector', url: tiles('contours-v2') },
      dem: { type: 'raster-dem', url: tiles('terrain-rgb-v2') },
      // Computed in the browser from the same DEM — see js/slope.js.
      slope: { type: 'raster', tiles: ['slope://{z}/{x}/{y}'], tileSize: 512, minzoom: 9, maxzoom: 14 },
    },
    layers: basemapLayers(),
  };
}

export function basemapLayers() {
  return [
    { id: 'snow', type: 'background', paint: { 'background-color': P.snow } },

    // -- landcover ----------------------------------------------------------
    // Global landcover covers low zooms; OSM landcover takes over at z9.
    {
      id: 'forest-global', type: 'fill', source: 'planet', 'source-layer': 'globallandcover', maxzoom: 9,
      filter: ['==', ['get', 'class'], 'forest'],
      paint: { 'fill-color': P.forest, 'fill-opacity': 0.8 },
    },
    {
      id: 'rock', type: 'fill', source: 'planet', 'source-layer': 'landcover', minzoom: 9,
      filter: ['in', ['get', 'class'], ['literal', ['rock', 'sand']]],
      paint: { 'fill-color': P.rock },
    },
    {
      id: 'ice', type: 'fill', source: 'planet', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'ice'],
      paint: { 'fill-color': P.ice },
    },
    {
      id: 'scrub', type: 'fill', source: 'planet', 'source-layer': 'landcover', minzoom: 9,
      filter: ['==', ['get', 'subclass'], 'scrub'],
      paint: { 'fill-color': P.scrub },
    },
    {
      id: 'forest', type: 'fill', source: 'planet', 'source-layer': 'landcover', minzoom: 9,
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': P.forest, 'fill-outline-color': P.forestEdge },
    },

    // -- relief -------------------------------------------------------------
    {
      id: 'hillshade', type: 'hillshade', source: 'dem',
      paint: {
        'hillshade-method': 'igor',
        'hillshade-shadow-color': P.shadow,
        'hillshade-highlight-color': P.highlight,
        'hillshade-exaggeration': z(6, 0.25, 11, 0.32, 15, 0.25),
      },
    },
    {
      id: 'slope', type: 'raster', source: 'slope', minzoom: 10,
      layout: { visibility: 'none' }, // off by default; the map key toggles it
      // Lighter than CalTopo's: it starts at 18°, so it covers a lot of
      // ground and mustn't drown the basemap.
      paint: { 'raster-opacity': z(10, 0.28, 14, 0.36) },
    },
    {
      id: 'contour', type: 'line', source: 'contours', 'source-layer': 'contour_ft', minzoom: 12,
      filter: ['<', ['get', 'nth_line'], 5],
      paint: { 'line-color': P.contour, 'line-opacity': z(12, 0.18, 15, 0.3), 'line-width': 0.6 },
    },
    {
      id: 'contour-index', type: 'line', source: 'contours', 'source-layer': 'contour_ft', minzoom: 10,
      filter: ['>=', ['get', 'nth_line'], 5],
      paint: { 'line-color': P.contour, 'line-opacity': z(10, 0.25, 14, 0.45), 'line-width': z(10, 0.6, 14, 1.1) },
    },

    // -- water --------------------------------------------------------------
    {
      id: 'stream', type: 'line', source: 'planet', 'source-layer': 'waterway', minzoom: 9,
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': P.waterLine,
        'line-width': z(9, ['match', ['get', 'class'], 'river', 0.8, 0.2], 14, ['match', ['get', 'class'], 'river', 2, 1]),
      },
    },
    {
      id: 'water', type: 'fill', source: 'planet', 'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': P.water, 'fill-outline-color': P.waterLine },
    },

    // -- protected areas ----------------------------------------------------
    // Wilderness and open-space edges matter to skiers (rules change at the
    // line); national forest edges don't, and are riddled with private
    // inholdings around old mining towns, so they're left out.
    {
      id: 'protected-edge', type: 'line', source: 'planet', 'source-layer': 'park', minzoom: 8,
      filter: ['!=', ['get', 'class'], 'national_forest'],
      paint: {
        'line-color': P.protected, 'line-opacity': 0.5,
        'line-width': z(8, 1, 13, 2.5), 'line-dasharray': [3, 2],
      },
    },

    // -- built --------------------------------------------------------------
    {
      id: 'building', type: 'fill', source: 'planet', 'source-layer': 'building', minzoom: 13,
      paint: { 'fill-color': P.building, 'fill-outline-color': P.roadCasing },
    },

    // -- roads & paths ------------------------------------------------------
    // Paths and tracks sit under the roads and well under the CalTopo trails:
    // thin, grey, dashed — context, not routes.
    {
      id: 'path', type: 'line', source: 'planet', 'source-layer': 'transportation', minzoom: 13,
      filter: ['all', ['in', ['get', 'class'], ['literal', ['path', 'track']]], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': P.path, 'line-width': z(13, 0.8, 16, 1.4), 'line-dasharray': [3, 2] },
    },
    // Other groomed nordic trails in OpenStreetMap: faint dots, so the club's
    // own trails stay unambiguous.
    {
      id: 'osm-nordic', type: 'line', source: 'outdoor', 'source-layer': 'ski', minzoom: 12,
      filter: ['==', ['get', 'class'], 'nordic'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': P.otherNordic, 'line-width': z(12, 1.4, 16, 2.6), 'line-dasharray': [0.1, 2] },
    },
    // Downhill runs and lifts (Eldora): light grey context, so they don't read
    // as nordic trails or compete with difficulty colours.
    {
      id: 'alpine-run', type: 'line', source: 'outdoor', 'source-layer': 'ski', minzoom: 12,
      filter: ['all', ['==', ['get', 'class'], 'downhill'], ['==', ['geometry-type'], 'LineString']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': P.alpine, 'line-width': z(12, 1.2, 16, 3) },
    },
    {
      id: 'lift', type: 'line', source: 'outdoor', 'source-layer': 'ski', minzoom: 12,
      filter: ['==', ['get', 'class'], 'lift'],
      paint: { 'line-color': P.lift, 'line-width': z(12, 0.8, 16, 1.5) },
    },
    roadLine('minor-casing', ['minor', 'service'], 12, P.roadCasing, z(12, 1.6, 14, 3, 17, 9)),
    roadLine('major-casing', ['primary', 'secondary', 'tertiary', 'trunk', 'motorway'], 7, P.majorCasing,
      z(7, 1, 10, 2.2, 14, 5, 17, 13)),
    roadLine('minor', ['minor', 'service'], 12, P.road, z(12, 0.8, 14, 2, 17, 7)),
    roadLine('major', ['primary', 'secondary', 'tertiary', 'trunk', 'motorway'], 7, P.majorRoad,
      z(7, 0.5, 10, 1.4, 14, 3.6, 17, 11)),

    // -- labels, least important first so the important ones win collisions --
    {
      // Every 10th line until z14, then every index line.
      id: 'contour-label', type: 'symbol', source: 'contours', 'source-layer': 'contour_ft', minzoom: 12,
      filter: ['>=', ['get', 'nth_line'], ['step', ['zoom'], 10, 14, 5]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 350,
        'text-field': ['concat', ['number-format', ['get', 'height'], {}], ' ft'],
        'text-font': ITALIC, 'text-size': 10.5, 'text-padding': 8,
      },
      paint: { 'text-color': P.contourText, ...halo(1.2) },
    },
    {
      id: 'stream-label', type: 'symbol', source: 'planet', 'source-layer': 'waterway', minzoom: 13,
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 400,
        'text-field': NAME, 'text-font': ITALIC, 'text-size': 11,
      },
      paint: { 'text-color': P.waterText, ...halo(1.2) },
    },
    {
      id: 'road-label', type: 'symbol', source: 'planet', 'source-layer': 'transportation_name', minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'primary', 'secondary', 'tertiary', 'trunk', 'motorway']]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 350,
        'text-field': NAME, 'text-font': REGULAR, 'text-size': z(12, 10.5, 16, 12.5),
      },
      paint: { 'text-color': P.ink3, ...halo(1.5) },
    },
    {
      id: 'osm-nordic-label', type: 'symbol', source: 'outdoor', 'source-layer': 'ski', minzoom: 14,
      filter: ['==', ['get', 'class'], 'nordic'],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 400,
        'text-field': ['get', 'name'], 'text-font': ITALIC, 'text-size': 10.5,
      },
      paint: { 'text-color': P.otherNordic, ...halo(1.2) },
    },
    {
      id: 'alpine-label', type: 'symbol', source: 'outdoor', 'source-layer': 'ski', minzoom: 14,
      filter: ['in', ['get', 'class'], ['literal', ['downhill', 'lift']]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 400,
        'text-field': ['get', 'name'], 'text-font': ITALIC, 'text-size': 10,
      },
      paint: { 'text-color': P.lift, ...halo(1.2) },
    },
    {
      id: 'water-label', type: 'symbol', source: 'planet', 'source-layer': 'water_name', minzoom: 11,
      layout: { 'text-field': NAME, 'text-font': ITALIC, 'text-size': z(11, 11, 15, 13), 'text-max-width': 7 },
      paint: { 'text-color': P.waterText, ...halo(1.5) },
    },
    {
      id: 'protected-label', type: 'symbol', source: 'planet', 'source-layer': 'park', minzoom: 9,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'class'], 'national_forest']],
      layout: {
        'text-field': NAME, 'text-font': MEDIUM, 'text-size': z(9, 10.5, 13, 12.5),
        'text-letter-spacing': 0.04, 'text-max-width': 8,
      },
      paint: { 'text-color': '#4e7a5c', ...halo(1.5) },
    },
    // Trailhead-relevant points: parking, huts and shelters, toilets.
    {
      id: 'poi', type: 'symbol', source: 'planet', 'source-layer': 'poi', minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['parking', 'toilets', 'shelter', 'lodging']]],
      layout: {
        'icon-image': ['match', ['get', 'class'], 'lodging', 'hut', ['get', 'class']],
        'icon-size': 0.9,
        'text-field': ['step', ['zoom'], '', 13, NAME], 'text-font': MEDIUM, 'text-size': 11,
        'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-optional': true, 'text-max-width': 8,
      },
      paint: { 'icon-color': P.ink2, 'icon-halo-color': P.halo, 'icon-halo-width': 1.5, 'text-color': P.ink2, ...halo(1.5) },
    },
    {
      id: 'hut', type: 'symbol', source: 'outdoor', 'source-layer': 'outdoor_poi', minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['hut', 'shelter']]],
      layout: {
        'icon-image': ['get', 'class'], 'icon-size': 0.9,
        'text-field': NAME, 'text-font': MEDIUM, 'text-size': 11.5,
        'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-optional': true, 'text-max-width': 8,
      },
      paint: { 'icon-color': P.ink, 'icon-halo-color': P.halo, 'icon-halo-width': 1.5, 'text-color': P.ink, ...halo(1.5) },
    },
    {
      id: 'peak', type: 'symbol', source: 'planet', 'source-layer': 'mountain_peak', minzoom: 10,
      filter: ['all', ['==', ['get', 'class'], 'peak'], ['has', 'name']],
      layout: {
        'icon-image': 'triangle', 'icon-size': 0.6,
        'text-field': ['format',
          NAME, { 'text-font': ['literal', MEDIUM] },
          '\n', {},
          ['concat', ['number-format', ['get', 'ele_ft'], {}], ' ft'], { 'font-scale': 0.85, 'text-font': ['literal', REGULAR] }],
        'text-font': MEDIUM, 'text-size': z(10, 11, 14, 12.5),
        'text-anchor': 'top', 'text-offset': [0, 0.6], 'text-max-width': 8,
        'symbol-sort-key': ['to-number', ['get', 'rank']],
      },
      paint: { 'icon-color': '#5d5246', 'text-color': '#4a4036', ...halo(1.6) },
    },
    {
      id: 'place-minor', type: 'symbol', source: 'planet', 'source-layer': 'place', minzoom: 11,
      filter: ['in', ['get', 'class'], ['literal', ['village', 'hamlet', 'suburb', 'neighbourhood', 'locality']]],
      layout: {
        'text-field': NAME, 'text-font': MEDIUM, 'text-size': z(11, 11.5, 15, 14), 'text-max-width': 8,
        'symbol-sort-key': ['to-number', ['get', 'rank']],
      },
      paint: { 'text-color': P.ink2, ...halo(1.6) },
    },
    {
      id: 'place-town', type: 'symbol', source: 'planet', 'source-layer': 'place', minzoom: 6,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      layout: {
        'text-field': NAME, 'text-font': SEMIBOLD,
        'text-size': z(6, ['match', ['get', 'class'], 'city', 13, 11], 12, ['match', ['get', 'class'], 'city', 18, 15]),
        'text-max-width': 8, 'symbol-sort-key': ['to-number', ['get', 'rank']],
      },
      paint: { 'text-color': P.ink, ...halo(1.8) },
    },
  ];
}

function roadFilter(classes) {
  return ['all',
    ['in', ['get', 'class'], ['literal', classes]],
    ['!=', ['get', 'brunnel'], 'tunnel'],
    ['==', ['geometry-type'], 'LineString']];
}

function roadLine(id, classes, minzoom, color, width) {
  return {
    id, type: 'line', source: 'planet', 'source-layer': 'transportation', minzoom,
    filter: roadFilter(classes),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width },
  };
}
