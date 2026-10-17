// ---------------------------------------------------------------------------
// Elevation tiles (terrain-RGB), decoded to metres. Shared by slope shading
// and elevation profiles so a tile is only fetched and decoded once.
// ---------------------------------------------------------------------------

const cache = new Map(); // "z/x/y" -> Promise<{ size, elev: Float32Array }>
const MAX_CACHED = 64;

/**
 * Elevations in metres for one tile, row-major, `size` × `size`.
 * @returns {Promise<{size: number, elev: Float32Array}>}
 */
export function loadDemTile(demUrl, z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!cache.has(key)) {
    // No abort signal: the result is shared, so one caller cancelling must not
    // fail it for another.
    const p = fetchTile(demUrl, z, x, y);
    p.catch(() => cache.delete(key)); // let a failed tile be retried
    cache.set(key, p);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

async function fetchTile(demUrl, z, x, y) {
  const url = demUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DEM tile ${z}/${x}/${y}: HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const size = bitmap.width;
  const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, size, size).data;
  // Mapbox terrain-RGB: height = -10000 + (R·65536 + G·256 + B) · 0.1 metres.
  const elev = new Float32Array(size * size);
  for (let p = 0, o = 0; p < elev.length; p++, o += 4) {
    elev[p] = -10000 + (data[o] * 65536 + data[o + 1] * 256 + data[o + 2]) * 0.1;
  }
  return { size, elev };
}

/** Fractional tile coordinates of a lng/lat at zoom z. */
export function tileXY([lng, lat], z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Latitude of a (fractional) tile row. */
export function tileLatitude(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
