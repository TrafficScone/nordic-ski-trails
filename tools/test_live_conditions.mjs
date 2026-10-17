// Tests for public/js/live-conditions.js (fixtures in tools/fixtures/, no network).
//
//   node tools/test_live_conditions.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures', n), 'utf8'));
const lc = await import(path.join(ROOT, 'public/js/live-conditions.js'));
const { parseNwsPeriods, parseNwsPoints, parseSnotel, parseAvalancheMapLayer, liveConditions, DANGER } = lc;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

const ELDORA = [-105.583, 39.937];
const points = fixture('nws-points.json');
const forecast = fixture('nws-forecast.json');
const snotel = fixture('snotel.json');
const layer = fixture('avalanche-map-layer.json');

console.log('\nNWS');
check(/^https:\/\/api\.weather\.gov\/gridpoints\//.test(parseNwsPoints(points)), 'points -> forecast url');
const periods = parseNwsPeriods(forecast);
check(periods.length === 3, `3 periods (${periods.length})`);
check(periods.every((p) => p.name && typeof p.temp === 'number' && p.unit && p.short && typeof p.isDay === 'boolean'),
  'period fields present');
check(typeof periods[0].wind === 'string' && /mph/.test(periods[0].wind), `wind: ${periods[0].wind}`);
check(parseNwsPeriods({}).length === 0 && parseNwsPoints(null) === null, 'bad input -> empty');

console.log('\nSNOTEL');
const s = parseSnotel(snotel);
check(s && s.depthIn === 0 && s.date === '2026-10-16', `latest depth/date: ${JSON.stringify(s)}`);
check(s.sweIn === 1.2 && s.tempF === 40.8, 'SWE and temp are latest values');
check(s.depthChange24hIn === 0, '24 h change computed');
const snowy = structuredClone(snotel);
snowy[0].data.find((e) => e.stationElement.elementCode === 'SNWD').values =
  [{ date: '2026-01-14', value: 20 }, { date: '2026-01-15', value: 22 }, { date: '2026-01-16', value: 30 }];
check(parseSnotel(snowy).depthChange24hIn === 8, '24 h change = +8 in');
snowy[0].data.find((e) => e.stationElement.elementCode === 'SNWD').values =
  [{ date: '2026-01-10', value: 20 }, { date: '2026-01-16', value: 30 }];
check(parseSnotel(snowy).depthChange24hIn === undefined, 'no change when previous day missing');
check(parseSnotel([]) === null && parseSnotel(null) === null, 'bad input -> null');

console.log('\nAvalanche');
const a = parseAvalancheMapLayer(layer, ELDORA);
check(a && a.zone === 'CAIC zone' && a.danger === 0 && a.label === 'No rating', `Eldora zone: ${a && a.zone} / ${a && a.label}`);
check(a.travelAdvice && /^https:\/\/avalanche\.state\.co\.us/.test(a.url), 'travel advice and CAIC url');
check(parseAvalancheMapLayer(layer, [-100, 30]) === null, 'point outside every zone -> null');
const rated = structuredClone(layer);
const caic = rated.features.find((f) => f.properties.center_id === 'CAIC');
caic.properties.danger_level = 3;
caic.properties.name = 'Front Range';
const r = parseAvalancheMapLayer(rated, ELDORA);
check(r.danger === 3 && r.label === 'Considerable' && r.color === DANGER[3].color, 'level 3 -> Considerable/orange');
check(DANGER[1].color === '#50b848' && DANGER[2].color === '#fff200' && DANGER[4].color === '#ed1c24' &&
  DANGER[5].color === '#231f20', 'danger scale colours');

console.log('\nOrchestration (stubbed fetch)');
const realFetch = globalThis.fetch;
let calls = [];
const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
function stub(overrides = {}) {
  calls = [];
  globalThis.fetch = (url, opts) => {
    url = String(url);
    calls.push(url);
    for (const [needle, fn] of Object.entries(overrides)) if (url.includes(needle)) return fn(url, opts);
    if (url.includes('/points/')) return json(points);
    if (url.includes('/gridpoints/')) return json(forecast);
    if (url.includes('awdbRestApi')) return json(snotel);
    if (url.includes('map-layer')) return json(layer);
    return Promise.reject(new Error(`unexpected ${url}`));
  };
}

stub();
let res = await liveConditions(ELDORA);
check(res.weather && res.snow && res.avalanche, 'all three sources present');
check(res.snow.station === 'Lake Eldora' && res.snow.distanceMi < 2, `snow station ${res.snow.station} ${res.snow.distanceMi} mi`);
check(res.weather.periods.length === 3 && /weather\.gov/.test(res.weather.url), 'weather periods and url');
check(calls.some((u) => /elements=SNWD%2CWTEQ%2CTOBS|elements=SNWD,WTEQ,TOBS/.test(u)) && calls.length === 4, `4 requests (${calls.length})`);

const n = calls.length;
await liveConditions([-105.5831, 39.9371]);
check(calls.length === n, 'same rounded location: cache hit, no refetch');

lc.clearLiveConditionsCache();
stub({ 'awdbRestApi': () => Promise.reject(new Error('boom')) });
res = await liveConditions(ELDORA);
check(!('snow' in res) && res.weather && res.avalanche, 'snow fails -> others still returned');

lc.clearLiveConditionsCache();
stub({ 'map-layer': () => json({ nope: true }) });
res = await liveConditions(ELDORA);
check(!('avalanche' in res) && res.weather && res.snow, 'bad avalanche payload -> omitted');

lc.clearLiveConditionsCache();
stub({ '/points/': (url, opts) => new Promise((_, reject) => {
  opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
}) });
const t0 = Date.now();
res = await liveConditions(ELDORA);
const dt = Date.now() - t0;
check(!('weather' in res) && res.snow && res.avalanche, 'weather times out -> others still returned');
check(dt >= 5500 && dt < 8000, `timeout ~6 s (${dt} ms)`);

lc.clearLiveConditionsCache();
stub({ '': () => Promise.reject(new Error('down')) });
res = await liveConditions(ELDORA);
check(Object.keys(res).length === 0, 'everything fails -> {} without throwing');
stub();
res = await liveConditions(ELDORA);
check(res.snow, 'total failure is not cached');

lc.clearLiveConditionsCache();
stub();
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
res = await liveConditions(ELDORA);
check(Object.keys(res).length === 0 && calls.length === 0, 'offline -> {} with no requests');
delete globalThis.navigator;
check(Object.keys(await liveConditions(null)).length === 0, 'bad center -> {}');

globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
