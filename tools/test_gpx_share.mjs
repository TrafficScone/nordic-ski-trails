// Tests for public/js/gpx.js and public/js/share.js.
//
//   node tools/test_gpx_share.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'public');
const { gpxFor, gpxFilename } = await import(path.join(SITE, 'js/gpx.js'));
const { slug, hashFor, parseHash, findGroup } = await import(path.join(SITE, 'js/share.js'));

let failures = 0;
const test = (msg, cond) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg}`); }
};
const eq = (msg, a, b) => test(`${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`,
  JSON.stringify(a) === JSON.stringify(b));

const parser = new (new JSDOM('').window.DOMParser)();
const parse = (xml) => parser.parseFromString(xml, 'application/xml');
const line = (...c) => ({ type: 'LineString', coordinates: c });
const feat = (section, geometry, description) =>
  ({ type: 'Feature', properties: { _section: section, description }, geometry });

console.log('\nslug');
eq("apostrophe", slug("Devil's Thumb Trail"), 'devils-thumb-trail');
eq('unicode quote', slug('Devil’s Thumb'), 'devils-thumb');
eq('repeated punctuation', slug('  --A & B!!  C--'), 'a-b-c');
eq('filename', gpxFilename("Devil's Thumb Trail"), 'devils-thumb-trail.gpx');

console.log('\nhash');
const groups = [
  { name: 'Eldora', kind: 'area', features: [] },
  { name: 'Eldora', kind: 'trail', features: [] },
  { name: "Devil's Thumb Trail", kind: 'trail', features: [] },
];
eq('hashFor', hashFor(groups[2]), '#trail/devils-thumb-trail');
eq('round trip', findGroup(groups, parseHash(hashFor(groups[2]))), groups[2]);
eq('parse', parseHash('#area/eldora'), { kind: 'area', slug: 'eldora' });
eq('encoded', parseHash('#trail/devils%2Dthumb'), { kind: 'trail', slug: 'devils-thumb' });
eq('bare slug', parseHash('#eldora'), { kind: null, slug: 'eldora' });
eq('empty', parseHash(''), null);
eq('hash only', parseHash('#'), null);
eq('bad kind', parseHash('#mountain/x'), null);
eq('bad encoding', parseHash('#%E0%A4%A'), null);
eq('find with kind', findGroup(groups, { kind: 'area', slug: 'eldora' }), groups[0]);
eq('find without kind', findGroup(groups, { kind: null, slug: 'eldora' }), groups[0]);
eq('find from Map', findGroup(new Map(groups.map((g) => [g.kind + g.name, g])), { kind: 'trail', slug: 'eldora' }), groups[1]);
eq('find miss', findGroup(groups, { kind: 'place', slug: 'eldora' }), undefined);

console.log('\ngpx');
const trail = {
  name: 'Fish & "Chips" <Loop>', kind: 'trail',
  features: [
    feat('Fish_2', line([-105.5, 39.9, 0, 0], [-105.51, 39.91]), "B's & <b>"),
    feat('Fish_1', { type: 'MultiLineString', coordinates: [[[-105.1, 39.1], [-105.2, 39.2]], [[-105.3, 39.3], [-105.4, 39.4]]] }, 'A part'),
  ],
};
const xml = gpxFor(trail, { link: 'https://example.com/?a=1&b=2' });
const doc = parse(xml);
test('well-formed XML', !doc.querySelector('parsererror'));
test('gpx root', doc.documentElement.getAttribute('version') === '1.1');
eq('three trkseg', doc.getElementsByTagName('trkseg').length, 3);
const firstPts = [...doc.getElementsByTagName('trkseg')].map((s) => s.firstElementChild.getAttribute('lat'));
eq('section order', firstPts, ['39.1000000', '39.3000000', '39.9000000']);
eq('extra coordinate values ignored', doc.getElementsByTagName('trkpt').length, 6);
eq('name unescaped', doc.querySelector('trk > name').textContent, 'Fish & "Chips" <Loop>');
eq('desc joined', doc.querySelector('trk > desc').textContent, "A part\n\nB's & <b>");
eq('metadata name', doc.querySelector('metadata > name').textContent, 'Fish & "Chips" <Loop>');
eq('link', doc.querySelector('metadata > link').getAttribute('href'), 'https://example.com/?a=1&b=2');
test('time', !Number.isNaN(Date.parse(doc.querySelector('metadata > time').textContent)));

const place = { name: "Ranger's <Hut>", kind: 'place', features: [feat('x', { type: 'Point', coordinates: [-105.2, 39.5, 0] }, 'Warm & dry')] };
const pdoc = parse(gpxFor([place, groups[0]], { name: 'Mixed' }));
test('place well-formed', !pdoc.querySelector('parsererror'));
eq('wpt count', pdoc.getElementsByTagName('wpt').length, 1);
eq('wpt name', pdoc.querySelector('wpt > name').textContent, "Ranger's <Hut>");
eq('wpt desc', pdoc.querySelector('wpt > desc').textContent, 'Warm & dry');
eq('multi-group metadata name', pdoc.querySelector('metadata > name').textContent, 'Mixed');
eq('area emits no trk', pdoc.getElementsByTagName('trk').length, 0);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
