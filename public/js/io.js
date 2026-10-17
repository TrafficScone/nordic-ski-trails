// ---------------------------------------------------------------------------
// Getting data in and out of the browser: GPX parsing, file reads, downloads.
// ---------------------------------------------------------------------------

import { simplify } from './geo.js';
import { NEW_PLACE, NEW_TRAIL } from './schema.js';

/**
 * Parse a GPX file into a FeatureCollection.
 * Tracks and routes become trails; waypoints become places. Recorded tracks
 * carry a point every second or so, which is far more than a map needs, so
 * they're simplified on the way in.
 */
export function parseGpx(text, { simplifyMetres = 3 } = {}) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That GPX file could not be parsed.');

  const features = [];
  const textOf = (node, tag) => node.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const coordsOf = (nodes) =>
    Array.from(nodes)
      .map((pt) => [Number(pt.getAttribute('lon')), Number(pt.getAttribute('lat'))])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

  for (const trk of doc.getElementsByTagName('trk')) {
    const name = textOf(trk, 'name');
    const desc = textOf(trk, 'desc');
    for (const seg of trk.getElementsByTagName('trkseg')) {
      const coords = simplify(coordsOf(seg.getElementsByTagName('trkpt')), simplifyMetres);
      if (coords.length >= 2) {
        features.push(lineFeature(coords, { name, description: desc }));
      }
    }
  }

  for (const rte of doc.getElementsByTagName('rte')) {
    const coords = simplify(coordsOf(rte.getElementsByTagName('rtept')), simplifyMetres);
    if (coords.length >= 2) {
      features.push(lineFeature(coords, { name: textOf(rte, 'name'), description: textOf(rte, 'desc') }));
    }
  }

  for (const wpt of doc.getElementsByTagName('wpt')) {
    const lng = Number(wpt.getAttribute('lon'));
    const lat = Number(wpt.getAttribute('lat'));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { ...NEW_PLACE, name: textOf(wpt, 'name'), description: textOf(wpt, 'desc') },
    });
  }

  return { type: 'FeatureCollection', features };
}

const lineFeature = (coordinates, props) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { ...NEW_TRAIL, ...props },
});

/** Read a File the user picked and turn it into a FeatureCollection. */
export async function readFeatureFile(file) {
  const text = await file.text();
  if (/\.gpx$/i.test(file.name) || text.trimStart().startsWith('<')) return parseGpx(text);
  return JSON.parse(text);
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
