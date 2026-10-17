// ---------------------------------------------------------------------------
// GPX 1.1 export for trail groups.
//
// A trail becomes one <trk> with one <trkseg> per line part; trails drawn in
// sections are written in section-number order (a trailing _N, -N or " N" on
// the section title). Places become <wpt>. Areas contribute nothing of their
// own — pass the area's trails and places as separate groups. Elevation is
// left out; GPS apps and Strava add it from their own terrain models.
// ---------------------------------------------------------------------------

import { slug } from './share.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// Trailing section number of a title, or Infinity when there isn't one.
const sectionNo = (f) => {
  const m = /(?:[_\-\s])(\d+)\s*$/.exec(f.properties?._section ?? '');
  return m ? Number(m[1]) : Infinity;
};

const pt = (tag, [lng, lat]) => `<${tag} lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}">`;

// Stable sort so un-numbered sections keep their original order.
const inOrder = (features) => features
  .map((f, i) => ({ f, i, n: sectionNo(f) }))
  .sort((a, b) => (a.n - b.n) || (a.i - b.i) || 0)
  .map(({ f }) => f);

function lineParts(f) {
  const g = f.geometry;
  if (g?.type === 'LineString') return [g.coordinates];
  if (g?.type === 'MultiLineString') return g.coordinates;
  return [];
}

function describe(features) {
  return features.map((f) => (f.properties?.description ?? '').trim()).filter(Boolean).join('\n\n');
}

function trackXml(g) {
  const feats = inOrder(g.features);
  const desc = describe(feats);
  const segs = feats.flatMap(lineParts).filter((l) => l.length)
    .map((l) => `    <trkseg>\n${l.map((c) => `      ${pt('trkpt', c)}</trkpt>`).join('\n')}\n    </trkseg>`);
  if (!segs.length) return '';
  return `  <trk>\n    <name>${esc(g.name)}</name>\n${desc ? `    <desc>${esc(desc)}</desc>\n` : ''}${segs.join('\n')}\n  </trk>`;
}

function waypointXml(g) {
  return g.features.filter((f) => f.geometry?.type === 'Point').map((f) => {
    const desc = (f.properties?.description ?? '').trim();
    return `  ${pt('wpt', f.geometry.coordinates)}\n    <name>${esc(g.name)}</name>\n${desc ? `    <desc>${esc(desc)}</desc>\n` : ''}  </wpt>`;
  });
}

/**
 * @param {object|object[]} groups  one group or several
 * @param {{name?: string, link?: string}} [options]
 * @returns {string}  GPX 1.1 document
 */
export function gpxFor(groups, options = {}) {
  const list = Array.isArray(groups) ? groups : [groups];
  const name = list.length === 1 ? list[0].name : options.name;
  const meta = [
    name ? `    <name>${esc(name)}</name>` : '',
    options.link ? `    <link href="${esc(options.link)}"/>` : '',
    `    <time>${new Date().toISOString()}</time>`,
  ].filter(Boolean).join('\n');
  // Waypoints must precede tracks in GPX.
  const wpts = list.filter((g) => g.kind === 'place').flatMap(waypointXml);
  const trks = list.filter((g) => g.kind === 'trail').map(trackXml).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<gpx version="1.1" creator="Boulder Nordic Club trail map" xmlns="http://www.topografix.com/GPX/1/1">\n`
    + `  <metadata>\n${meta}\n  </metadata>\n`
    + [...wpts, ...trks].join('\n') + `\n</gpx>\n`;
}

/**
 * @param {string} name
 * @returns {string}  e.g. "devils-thumb-trail.gpx"
 */
export function gpxFilename(name) {
  return `${slug(name) || 'trail'}.gpx`;
}

/** Build the GPX and hand it to the browser as a file download. */
export function downloadGpx(groups, options = {}) {
  const list = Array.isArray(groups) ? groups : [groups];
  const name = list.length === 1 ? list[0].name : options.name || 'trails';
  const blob = new Blob([gpxFor(groups, options)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = gpxFilename(name);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
