// ---------------------------------------------------------------------------
// Slope-angle shading, computed in the browser from elevation tiles.
//
// MapLibre has no slope layer, so this registers a `slope://z/x/y` protocol:
// each request fetches the matching terrain-RGB tile, works out the slope of
// every pixel (Horn's method, the same one GIS tools use), and returns a PNG
// coloured by the classes below. The basemap shows it as a plain raster layer.
//
// Classes follow CalTopo's fixed-step "slope angle shading" so they read the
// same as the tool the club already plans in. Below 27° is left clear.
// See docs/cartography.md for why these breaks.
// ---------------------------------------------------------------------------

import { loadDemTile, tileLatitude } from './dem.js';

/** [min degrees, colour] — each class runs up to the next one's minimum. */
export const SLOPE_CLASSES = [
  [27, '#f2e200'], // 27–29  yellow
  [30, '#f7b500'], // 30–31  light orange
  [32, '#f07d00'], // 32–34  dark orange
  [35, '#e3000f'], // 35–45  red: where most avalanches start (peak ~38°)
  [46, '#a01fb0'], // 46–50  purple
  [51, '#1f4fd8'], // 51+    blue
];

export const SLOPE_PROTOCOL = 'slope';

const EARTH_CIRCUMFERENCE = 40075016.686;

/**
 * Register the protocol. `demUrl` is a tile template like
 * 'https://…/{z}/{x}/{y}.webp' for Mapbox-style terrain-RGB tiles.
 */
export function registerSlopeProtocol(demUrl) {
  const palette = SLOPE_CLASSES.map(([deg, hex]) => [deg, hexToRgb(hex)]);

  maplibregl.addProtocol(SLOPE_PROTOCOL, async (params) => {
    const [z, x, y] = params.url.replace(`${SLOPE_PROTOCOL}://`, '').split('/').map(Number);
    const { size, elev } = await loadDemTile(demUrl, z, x, y);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const px = ctx.createImageData(size, size);

    // Ground size of one pixel at this tile's latitude.
    const lat = tileLatitude(y + 0.5, z);
    const cell = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (2 ** z * size);

    const out = px.data;
    const at = (i, j) => elev[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))];
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        // Horn (1981): weighted 3×3 gradient.
        const a = at(i - 1, j - 1), b = at(i, j - 1), c = at(i + 1, j - 1);
        const d = at(i - 1, j), f = at(i + 1, j);
        const g = at(i - 1, j + 1), h = at(i, j + 1), k = at(i + 1, j + 1);
        const dzdx = ((c + 2 * f + k) - (a + 2 * d + g)) / (8 * cell);
        const dzdy = ((g + 2 * h + k) - (a + 2 * b + c)) / (8 * cell);
        const deg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;

        const o = (j * size + i) * 4;
        const rgb = classify(deg, palette);
        if (rgb) { out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = 255; }
        else out[o + 3] = 0;
      }
    }
    ctx.putImageData(px, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { data: await blob.arrayBuffer() };
  });
}

function classify(deg, palette) {
  let hit = null;
  for (const [min, rgb] of palette) if (deg >= min) hit = rgb;
  return hit;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
