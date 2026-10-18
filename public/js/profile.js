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
    out.push(samples.map(({ d, p }, i) => ({ d: offset + d, e: elevs[i], p })));
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

/** Elevation in metres at a [lng, lat], bilinear between DEM pixels. */
export async function elevationAt(p, demUrl) {
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
 * S and E badges mark the ends, matching the map's start/end markers. Moving
 * a pointer (or finger) along it calls `onHover(sample)` with the nearest
 * sample ({d, e, p: [lng, lat]}), and `onHover(null)` when it leaves.
 * @returns {SVGSVGElement}
 */
export function profileSvg(profile, { width = 260, height = 72, color = '#005daa', feet = true, onHover } = {}) {
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

  const first = profile.parts[0][0];
  const last = profile.parts.at(-1).at(-1);
  const badge = (sample, letter) => {
    const g = document.createElementNS(NS, 'g');
    const x = Math.min(width - 8, Math.max(8, sx(sample.d)));
    const y = Math.min(height - 8, Math.max(8, sy(sample.e)));
    const c = document.createElementNS(NS, 'circle');
    Object.entries({ cx: x, cy: y, r: 7, fill: '#0c3d54', stroke: '#fff', 'stroke-width': 1.5 })
      .forEach(([k, v]) => c.setAttribute(k, v));
    const t = document.createElementNS(NS, 'text');
    Object.entries({ x, y: y + 3.5, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#fff' })
      .forEach(([k, v]) => t.setAttribute(k, v));
    t.textContent = letter;
    g.append(c, t);
    return g;
  };
  svg.append(badge(first, 'S'), badge(last, 'E'));

  if (onHover) {
    const samples = profile.parts.flat();
    const guide = document.createElementNS(NS, 'line');
    guide.setAttribute('class', 'profile-guide');
    Object.entries({ y1: 0, y2: height, stroke: '#0c3d54', 'stroke-width': 1, visibility: 'hidden' })
      .forEach(([k, v]) => guide.setAttribute(k, v));
    const readout = document.createElementNS(NS, 'text');
    readout.setAttribute('class', 'profile-readout');
    Object.entries({ y: 10, 'font-size': 10, fill: '#0c3d54', visibility: 'hidden' })
      .forEach(([k, v]) => readout.setAttribute(k, v));
    svg.append(guide, readout);

    const at = (evt) => {
      const box = svg.getBoundingClientRect();
      const d = ((evt.clientX - box.left) / box.width) * profile.distance;
      let best = samples[0];
      for (const s of samples) if (Math.abs(s.d - d) < Math.abs(best.d - d)) best = s;
      return best;
    };
    const move = (evt) => {
      const s = at(evt);
      const x = sx(s.d);
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('visibility', 'visible');
      const miles = s.d / 1609.344;
      readout.textContent = `${feet ? `${miles.toFixed(1)} mi` : `${(s.d / 1000).toFixed(1)} km`} · ${Math.round(s.e * unit).toLocaleString()} ${feet ? 'ft' : 'm'}`;
      readout.setAttribute('x', x > width / 2 ? x - 4 : x + 4);
      readout.setAttribute('text-anchor', x > width / 2 ? 'end' : 'start');
      readout.setAttribute('visibility', 'visible');
      onHover(s);
    };
    const leave = () => {
      guide.setAttribute('visibility', 'hidden');
      readout.setAttribute('visibility', 'hidden');
      onHover(null);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
    svg.style.touchAction = 'none'; // let a finger scrub without scrolling the page
  }
  return svg;
}
