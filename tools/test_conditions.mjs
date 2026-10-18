// Tests for public/js/conditions.js.
//
//   node tools/test_conditions.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { conditionLinksFor, nearestSnotel, AREA_LINKS } =
  await import(path.join(ROOT, 'public/js/conditions.js'));

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

console.log('\nNearest SNOTEL');
const cases = [
  ['Eldora Nordic', [-105.583, 39.937], 'Lake Eldora'],
  ['Brainard', [-105.57, 40.075], ['University Camp', 'Niwot']],
  ['West Magnolia', [-105.53, 39.94], 'Lake Eldora'],
];
for (const [label, pt, want] of cases) {
  const s = nearestSnotel(pt);
  const wants = [].concat(want);
  check(wants.includes(s.name) && s.miles < 10, `${label}: ${s.name} (${s.miles.toFixed(1)} mi)`);
}

console.log('\nLinks');
const eldoraCenter = [-105.583, 39.937];
const trail = conditionLinksFor({ name: 'Sundown', kind: 'trail', area: 'Eldora' }, eldoraCenter);
const area = conditionLinksFor({ name: 'Eldora', kind: 'area', area: '' }, eldoraCenter);
const none = conditionLinksFor({ name: 'Solo', kind: 'trail', area: '' }, eldoraCenter);
const eldoraUrl = AREA_LINKS['Eldora'][0].url;
check(trail.some((l) => l.url === eldoraUrl), 'Eldora trail gets Eldora links');
check(area.some((l) => l.url === eldoraUrl), 'Eldora area group gets Eldora links');
check(!none.some((l) => l.url === eldoraUrl) && none.length === 3, 'trail with no area gets only the 3 generic links');

const nws = trail.find((l) => l.label.includes('NWS'));
check(nws && nws.url.endsWith('lat=39.9370&lon=-105.5830'), `NWS url has 4-decimal lat/lon (${nws && nws.url})`);

console.log('\nShape');
for (const [area, label] of [['Eldora', 'Eldora'], ['Brainard Lake', 'Brainard'], ['West Magnolia', 'West Mag']]) {
  const ls = conditionLinksFor({ name: 'x', kind: 'trail', area }, [-105.55, 39.99]);
  check(ls.length <= 5, `${label}: at most 5 links (${ls.length})`);
  check(ls.every((l) => l.label && /^https:\/\//.test(l.url)), `${label}: every link has label and https url`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
