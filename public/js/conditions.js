// ---------------------------------------------------------------------------
// "Conditions" links for trail / place / area popups.
//
// conditionLinksFor(group, center) returns a short, ordered list of
// {label, url, note?} — avalanche forecast, NWS weather for the exact spot,
// the nearest SNOTEL snow station, then any area-specific pages the club has
// listed in AREA_LINKS below.
//
// SNOTEL stations: id, name, lat, lon and elevation come from the NRCS AWDB
// REST API (https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations
// ?stationTriplets=*:CO:SNTL), active stations between lat 39.7–40.4 and
// lon -106.0 to -105.4. Each links to the NRCS site page for that station.
// ---------------------------------------------------------------------------

/**
 * Area-specific links. Keys are exact area names as they appear in the trail
 * data. To edit: change a url/label, add an entry to a list, or add a new
 * area key. Each entry is {label, url, note?}; `note` is optional small text.
 * Shown for trails/places inside that area and for the area itself.
 */
export const AREA_LINKS = {
  'Eldora': [
    { label: 'Live grooming report (Nordic Pulse)', url: 'https://nordic-pulse.com/ski-areas/US/CO/Eldora-Nordic-Center' },
    { label: 'Eldora Nordic grooming & trail report', url: 'https://www.eldora.com/activities-amenities/nordic-center/trail-map-conditions/' },
  ],
  "Devil's Thumb Ranch": [
    { label: 'Live grooming report (Nordic Pulse)', url: 'https://nordic-pulse.com/ski-areas/US/CO/Devils-Thumb-Ranch' },
    { label: "Devil's Thumb Ranch cross-country skiing", url: 'https://www.devilsthumbranch.com/adventure/cross-country-skiing/', note: 'Trail passes, rentals, lessons' },
  ],
  'Snow Mountain Ranch (SMR)': [
    { label: 'Live grooming report (Nordic Pulse)', url: 'https://nordic-pulse.com/ski-areas/US/CO/Snow-Mountain-Ranch-Nordic' },
    { label: 'Snow Mountain Ranch Nordic Center', url: 'https://www.ymcarockies.org/things-to-do/nordic-center', note: 'YMCA of the Rockies: passes, rentals, lessons' },
  ],
  'Brainard Lake': [
    { label: 'Brainard Lake road & winter access (USFS)', url: 'https://www.fs.usda.gov/r02/arp/conditions', note: 'Arapaho & Roosevelt NF current conditions' },
    { label: 'Brainard Lake Recreation Area (USFS)', url: 'https://www.fs.usda.gov/r02/arp/recreation/brainard-lake-recreation-area' },
    { label: 'CMC Brainard Cabin', url: 'https://www.cmcboulder.org/brainard-cabin', note: 'Colorado Mountain Club, Boulder Group' },
  ],
  'West Magnolia': [
    { label: 'West Magnolia Trailhead (USFS)', url: 'https://www.fs.usda.gov/r02/arp/recreation/west-magnolia-trailhead', note: 'Boulder Ranger District' },
  ],
};

/** Colorado Avalanche Information Center forecast map (Front Range zone covers this region). */
const CAIC_URL = 'https://avalanche.state.co.us/forecasts';

/** [triplet id, name, lat, lon, elevation ft] */
export const SNOTEL_STATIONS = [
  [322, 'Bear Lake', 40.31176, -105.6467, 9490],
  [335, 'Berthoud Summit', 39.80364, -105.77786, 11300],
  [412, 'Copeland Lake', 40.20733, -105.5695, 8570],
  [1186, 'Fool Creek', 39.86866, -105.86765, 11130],
  [1187, 'High Lonesome', 40.0359, -105.75472, 10630],
  [970, 'Jones Pass', 39.7645, -105.90655, 10430],
  [564, 'Lake Eldora', 39.93659, -105.59031, 9700],
  [602, 'Loveland Basin', 39.67428, -105.90264, 11410],
  [663, 'Niwot', 40.03581, -105.5452, 9940],
  [1251, 'Sawtooth', 40.13632, -105.58486, 9640],
  [793, 'Stillwater Creek', 40.22532, -105.9198, 8760],
  [838, 'University Camp', 40.03307, -105.57562, 10330],
  [1042, 'Wild Basin', 40.201, -105.6025, 9410],
];

const EARTH_RADIUS_MI = 3958.8;

/** Great-circle (haversine) distance in miles between two [lng, lat] points. */
export function distanceMiles(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/**
 * Nearest SNOTEL station to a [lng, lat] point.
 * @returns {{id: number, name: string, miles: number}}
 */
export function nearestSnotel(center) {
  let best = null;
  for (const [id, name, lat, lon] of SNOTEL_STATIONS) {
    const miles = distanceMiles(center, [lon, lat]);
    if (!best || miles < best.miles) best = { id, name, miles };
  }
  return best;
}

/**
 * @param {{name: string, kind: 'trail'|'place'|'area', area: string}} g   the group (area = name of the area it's in, or '')
 * @param {[number, number]} center  [lng, lat] of the trail/place/area
 * @returns {{label: string, url: string, note?: string}[]}  ordered most useful first, max ~5
 */
export function conditionLinksFor(g, center) {
  const [lng, lat] = center;
  const links = [
    { label: 'Avalanche forecast (CAIC)', url: CAIC_URL, note: 'Front Range zone' },
    {
      label: 'Weather forecast (NWS)',
      url: `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
    },
  ];

  const snow = nearestSnotel(center);
  links.push({
    label: `Snow depth: ${snow.name} SNOTEL (${Math.round(snow.miles)} mi)`,
    url: `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${snow.id}`,
  });

  for (const key of Object.keys(AREA_LINKS)) {
    if (g.area === key || (g.kind === 'area' && g.name === key)) {
      links.push(...AREA_LINKS[key]);
    }
  }
  return links.slice(0, 5);
}
