// ---------------------------------------------------------------------------
// Elevation profile and climb stats for a trail, sampled from the DEM.
//
// The line is resampled every SAMPLE_M metres and each sample is read from the
// terrain-RGB tiles (bilinear). Gain and loss use a small hysteresis so DEM
// noise on flat ground doesn't add up to phantom climbing — the same idea GPS
// apps use. Numbers are estimates from a ~10–30 m elevation model.
// ---------------------------------------------------------------------------

import { loadDemTile, tileXY } from './dem.js';

const SAMPLE_M = 20;
const ZOOM = 13;          // ~10 m DEM pixels at Colorado latitudes
const HYSTERESIS_M = 3;   // ignore wiggles smaller than this
const SMOOTH = 2;         // moving-average half-width, in samples

/**
 * @param {number[][][]} parts  one or more [lng, lat] lines, in travel order
 * @returns {Promise<{parts: {d: number, e: number}[][], distance: number,
 *   gain: number, loss: number, min: number, max: number}>}  metres
 */
export async function profileOf(parts, demUrl) {
  const out = [];
  let offset = 0;
  for (const line of parts) {
    const samples = resample(line);
    const elevs = smooth(await Promise.all(samples.map(({ p }) => elevationAt(p, demUrl))));
    out.push(samples.map(({ d }, i) => ({ d: offset + d, e: elevs[i] })));
    offset += samples.at(-1).d;
  }

  let gain = 0, loss = 0, min = Infinity, max = -Infinity;
  for (const part of out) {
    let ref = part[0].e;
    for (const { e } of part) {
      min = Math.min(min, e);
      max = Math.max(max, e);
      if (e - ref >= HYSTERESIS_M) { gain += e - ref; ref = e; }
      else if (ref - e >= HYSTERESIS_M) { loss += ref - e; ref = e; }
    }
  }
  return { parts: out, distance: offset, gain, loss, min, max };
}

/** Points every SAMPLE_M metres along a line, plus both ends. */
function resample(line) {
  const out = [{ d: 0, p: line[0] }];
  let d = 0, next = SAMPLE_M;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const seg = haversine(a, b);
    while (seg > 0 && next <= d + seg) {
      const t = (next - d) / seg;
      out.push({ d: next, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] });
      next += SAMPLE_M;
    }
    d += seg;
  }
  if (d > out.at(-1).d) out.push({ d, p: line.at(-1) });
  return out;
}

async function elevationAt(p, demUrl) {
  const [fx, fy] = tileXY(p, ZOOM);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const { size, elev } = await loadDemTile(demUrl, ZOOM, tx, ty);
  // Pixel centres sit at +0.5; clamp at the tile edge.
  const x = Math.min(size - 1, Math.max(0, (fx - tx) * size - 0.5));
  const y = Math.min(size - 1, Math.max(0, (fy - ty) * size - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const at = (i, j) => elev[j * size + i];
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * (x - x0);
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * (x - x0);
  return top + (bottom - top) * (y - y0);
}

function smooth(values) {
  return values.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = Math.max(0, i - SMOOTH); k <= Math.min(values.length - 1, i + SMOOTH); k++) { sum += values[k]; n++; }
    return sum / n;
  });
}

function haversine([lng1, lat1], [lng2, lat2]) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

/**
 * An SVG elevation chart. Separate parts are drawn with a break between them.
 * @returns {SVGSVGElement}
 */
export function profileSvg(profile, { width = 260, height = 72, color = '#005daa', feet = true } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'profile');
  svg.setAttribute('role', 'img');

  const pad = 2;
  const span = Math.max(profile.max - profile.min, 60); // ≥200 ft, so flat trails look flat
  const mid = (profile.max + profile.min) / 2;
  const lo = mid - span / 2;
  const sx = (d) => (d / profile.distance) * width;
  const sy = (e) => height - pad - ((e - lo) / span) * (height - pad * 2);

  for (const part of profile.parts) {
    const line = part.map(({ d, e }, i) => `${i ? 'L' : 'M'}${sx(d).toFixed(1)},${sy(e).toFixed(1)}`).join('');
    const area = document.createElementNS(NS, 'path');
    area.setAttribute('d', `${line}L${sx(part.at(-1).d).toFixed(1)},${height}L${sx(part[0].d).toFixed(1)},${height}Z`);
    area.setAttribute('fill', color);
    area.setAttribute('fill-opacity', '0.15');
    const stroke = document.createElementNS(NS, 'path');
    stroke.setAttribute('d', line);
    stroke.setAttribute('fill', 'none');
    stroke.setAttribute('stroke', color);
    stroke.setAttribute('stroke-width', '1.5');
    stroke.setAttribute('stroke-linejoin', 'round');
    svg.append(area, stroke);
  }
  const unit = feet ? 3.28084 : 1;
  const title = document.createElementNS(NS, 'title');
  title.textContent = `Elevation ${Math.round(profile.min * unit)}–${Math.round(profile.max * unit)} ${feet ? 'ft' : 'm'}`;
  svg.prepend(title);
  return svg;
}
