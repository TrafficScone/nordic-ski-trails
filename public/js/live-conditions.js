// ---------------------------------------------------------------------------
// Live conditions for a trail popup: forecast, snowpack and avalanche danger.
//
// liveConditions(center) fetches three public, keyless, CORS-enabled APIs
// straight from the browser (there is no backend):
//   weather    NWS api.weather.gov  /points/{lat},{lon} -> forecast periods
//   snow       NRCS AWDB REST API   daily SNWD / WTEQ / TOBS, nearest SNOTEL
//   avalanche  avalanche.org map-layer GeoJSON (includes CAIC), point-in-polygon
// Each source has its own timeout and try/catch; one that fails is simply
// left out of the result. The function never rejects. Results are cached in
// memory per location for 15 minutes.
//
// Browsers send their own User-Agent (api.weather.gov rejects an empty one but
// accepts any browser UA), so no custom header is needed. Parsing is in small
// pure functions so tools/test_live_conditions.mjs can run them on fixtures.
// ---------------------------------------------------------------------------

import { nearestSnotel } from './conditions.js';

/** North American Public Avalanche Danger Scale colours, keyed by level 1-5. */
export const DANGER = {
  1: { label: 'Low', color: '#50b848' },
  2: { label: 'Moderate', color: '#fff200' },
  3: { label: 'Considerable', color: '#f7941e' },
  4: { label: 'High', color: '#ed1c24' },
  5: { label: 'Extreme', color: '#231f20' },
};

const NO_RATING = { label: 'No rating', color: '#888888' };

const TIMEOUT_MS = 6000;
const CACHE_MS = 15 * 60 * 1000;
const MAX_PERIODS = 3;
const SNOTEL_DAYS = 5;

const NWS_POINTS = 'https://api.weather.gov/points/';
const AWDB_DATA = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data';
const AVALANCHE_MAP_LAYER = 'https://api.avalanche.org/v2/public/products/map-layer';
const CAIC_URL = 'https://avalanche.state.co.us/forecasts';

// -- parsing (pure) ----------------------------------------------------------

/**
 * Next few forecast periods from an NWS forecast response.
 * @returns {{name: string, temp: number, unit: string, short: string, wind: string, isDay: boolean}[]}
 */
export function parseNwsPeriods(json, max = MAX_PERIODS) {
  const periods = json?.properties?.periods;
  if (!Array.isArray(periods)) return [];
  return periods.slice(0, max).map((p) => ({
    name: p.name,
    temp: p.temperature,
    unit: p.temperatureUnit,
    short: p.shortForecast,
    wind: [p.windDirection, p.windSpeed].filter(Boolean).join(' '),
    isDay: !!p.isDaytime,
  }));
}

/** Forecast URL from an NWS /points response, or null. */
export function parseNwsPoints(json) {
  const url = json?.properties?.forecast;
  return typeof url === 'string' ? url : null;
}

/**
 * Latest snow readings from an AWDB /data response (DAILY SNWD, WTEQ, TOBS).
 * Each element uses its own most recent non-null value; the 24 h change is the
 * latest depth minus the depth on the day before it (only if that day exists).
 * @returns {{depthIn: number, depthChange24hIn?: number, sweIn?: number, tempF?: number, date: string}|null}
 */
export function parseSnotel(json) {
  const elements = json?.[0]?.data;
  if (!Array.isArray(elements)) return null;
  const series = {};
  for (const e of elements) {
    const code = e?.stationElement?.elementCode;
    const values = (e?.values || []).filter((v) => v && typeof v.value === 'number');
    if (code && values.length) series[code] = values;
  }
  const depth = series.SNWD;
  if (!depth) return null;
  const last = depth[depth.length - 1];
  const out = { depthIn: last.value, date: last.date };
  const prev = depth[depth.length - 2];
  if (prev && dayDiff(prev.date, last.date) === 1) {
    out.depthChange24hIn = Math.round((last.value - prev.value) * 10) / 10;
  }
  if (series.WTEQ) out.sweIn = series.WTEQ[series.WTEQ.length - 1].value;
  if (series.TOBS) out.tempF = series.TOBS[series.TOBS.length - 1].value;
  return out;
}

function dayDiff(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Even-odd ray test: is [lng, lat] inside a GeoJSON polygon (outer ring, then holes)? */
export function pointInPolygon(pt, rings) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  return rings.length > 0 && inRing(rings[0]) && !rings.slice(1).some(inRing);
}

/** Does a Polygon / MultiPolygon geometry contain [lng, lat]? */
export function geometryContains(geometry, pt) {
  if (geometry?.type === 'Polygon') return pointInPolygon(pt, geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some((p) => pointInPolygon(pt, p));
  return false;
}

/**
 * Danger rating for the zone containing the point, from the avalanche.org
 * map-layer GeoJSON. Zones outside the season come back as level -1 ("no rating").
 * @returns {{zone: string, danger: number, label: string, color: string, travelAdvice?: string, url: string}|null}
 */
export function parseAvalancheMapLayer(geojson, center) {
  const features = geojson?.features;
  if (!Array.isArray(features)) return null;
  const hit = features.find((f) => geometryContains(f.geometry, center));
  if (!hit) return null;
  const p = hit.properties || {};
  const level = DANGER[p.danger_level] ? p.danger_level : 0;
  const d = DANGER[level] || NO_RATING;
  return {
    zone: p.name || p.center || 'Avalanche zone',
    danger: level,
    label: d.label,
    color: d.color,
    ...(p.travel_advice ? { travelAdvice: p.travel_advice } : {}),
    url: p.center_id === 'CAIC' ? CAIC_URL : p.link || CAIC_URL,
  };
}

// -- fetching -----------------------------------------------------------------

async function getJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const cache = new Map(); // key -> {at, promise}
const forecastUrls = new Map(); // key -> NWS forecast URL (stable, so kept for the session)

const keyFor = (center) => `${center[0].toFixed(3)},${center[1].toFixed(3)}`;

async function fetchWeather(center) {
  const key = keyFor(center);
  let forecast = forecastUrls.get(key);
  if (!forecast) {
    const points = await getJson(`${NWS_POINTS}${center[1].toFixed(3)},${center[0].toFixed(3)}`);
    forecast = parseNwsPoints(points);
    if (!forecast) throw new Error('no forecast url');
    forecastUrls.set(key, forecast);
  }
  const periods = parseNwsPeriods(await getJson(forecast));
  if (!periods.length) throw new Error('no periods');
  return {
    periods,
    url: `https://forecast.weather.gov/MapClick.php?lat=${center[1].toFixed(4)}&lon=${center[0].toFixed(4)}`,
  };
}

async function fetchSnow(center) {
  const station = nearestSnotel(center);
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    stationTriplets: `${station.id}:CO:SNTL`,
    elements: 'SNWD,WTEQ,TOBS',
    duration: 'DAILY',
    beginDate: day(SNOTEL_DAYS),
    endDate: day(0),
  });
  const snow = parseSnotel(await getJson(`${AWDB_DATA}?${qs}`));
  if (!snow) throw new Error('no snow data');
  return {
    station: station.name,
    distanceMi: Math.round(station.miles * 10) / 10,
    ...snow,
    url: `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${station.id}`,
  };
}

async function fetchAvalanche(center) {
  const zone = parseAvalancheMapLayer(await getJson(AVALANCHE_MAP_LAYER), center);
  if (!zone) throw new Error('no avalanche zone');
  return zone;
}

/**
 * Live forecast, snowpack and avalanche danger for a point. Each key is present
 * only if that source answered; never rejects.
 * @param {[number, number]} center [lng, lat]
 * @returns {Promise<{
 *   weather?: {periods: {name, temp, unit, short, wind, isDay}[], url: string},
 *   snow?: {station: string, distanceMi: number, depthIn: number, depthChange24hIn?: number,
 *           sweIn?: number, tempF?: number, date: string, url: string},
 *   avalanche?: {zone: string, danger: number, label: string, color: string,
 *                travelAdvice?: string, url: string},
 * }>}
 */
export async function liveConditions(center) {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return {};
    if (!Array.isArray(center) || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return {};
    const key = keyFor(center);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return await hit.promise;

    const promise = (async () => {
      const [weather, snow, avalanche] = await Promise.all(
        [fetchWeather, fetchSnow, fetchAvalanche].map((f) => f(center).catch(() => undefined)),
      );
      const out = {};
      if (weather) out.weather = weather;
      if (snow) out.snow = snow;
      if (avalanche) out.avalanche = avalanche;
      // Don't hold on to a total failure: the next popup should retry.
      if (!Object.keys(out).length) cache.delete(key);
      return out;
    })();
    cache.set(key, { at: Date.now(), promise });
    return await promise;
  } catch {
    return {};
  }
}

/** Forget cached results (for tests). */
export function clearLiveConditionsCache() {
  cache.clear();
  forecastUrls.clear();
}
