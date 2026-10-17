// ---------------------------------------------------------------------------
// Small geodesy helpers. No dependencies — trail-scale distances only need
// haversine, and everything here works on plain [lng, lat] pairs.
// ---------------------------------------------------------------------------

const R = 6371008.8; // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two [lng, lat] points, in metres. */
export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Total length of a coordinate array, in metres. */
export function lineLength(coords = []) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += haversine(coords[i - 1], coords[i]);
  return m;
}

export function featureLength(feature) {
  return feature?.geometry?.type === 'LineString' ? lineLength(feature.geometry.coordinates) : 0;
}

const M_PER_MI = 1609.344;

export function formatDistance(metres, units = 'mi') {
  if (!metres) return units === 'mi' ? '0 mi' : '0 km';
  if (units === 'mi') {
    const mi = metres / M_PER_MI;
    return mi < 0.1 ? `${Math.round(metres * 3.28084)} ft` : `${mi.toFixed(mi < 10 ? 2 : 1)} mi`;
  }
  const km = metres / 1000;
  return km < 0.1 ? `${Math.round(metres)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

export function formatTotal(metres, units = 'mi') {
  const v = units === 'mi' ? metres / M_PER_MI : metres / 1000;
  return v.toFixed(v < 10 ? 1 : 0);
}

/** Midpoint of two points — good enough for inserting a vertex handle. */
export const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Bounding box [w, s, e, n] over a FeatureCollection, or null when empty. */
export function bboxOf(fc) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = ([lng, lat]) => {
    if (lng < w) w = lng; if (lng > e) e = lng;
    if (lat < s) s = lat; if (lat > n) n = lat;
  };
  for (const f of fc?.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point') visit(g.coordinates);
    else if (g.type === 'LineString') g.coordinates.forEach(visit);
    else if (g.type === 'MultiLineString') g.coordinates.flat().forEach(visit);
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** Ramer–Douglas–Peucker in degree space; tolerance is ~metres at the equator. */
export function simplify(coords, toleranceMetres = 2) {
  if (coords.length < 3) return coords.slice();
  const tol = toleranceMetres / 111320;
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1, best = tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(coords[i], coords[lo], coords[hi]);
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([lo, far], [far, hi]); }
  }
  return coords.filter((_, i) => keep[i]);
}

function perpDistance(p, a, b) {
  const x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) return Math.hypot(p[0] - b[0], p[1] - b[1]);
    if (t > 0) return Math.hypot(p[0] - (x + dx * t), p[1] - (y + dy * t));
  }
  return Math.hypot(p[0] - x, p[1] - y);
}
