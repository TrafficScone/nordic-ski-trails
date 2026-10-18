// ---------------------------------------------------------------------------
// Businesses that support the club, shown on the map with their own mark.
//
// Details are copied by hand from each business's website (a static site
// can't read another site's pages: no CORS), so check them each season.
// Last checked 2026-10-17 against bouldernordic.com.
// ---------------------------------------------------------------------------

export const PARTNERS = [
  {
    id: 'boulder-nordic-sport',
    name: 'Boulder Nordic Sport',
    tagline: 'Supports the Boulder Nordic Club',
    about: 'Cross-country ski gear, waxing and boot, ski and pole fitting.',
    address: '3280 Valmont Road, Boulder, CO 80301',
    hours: ['Mon–Fri 10–6', 'Sat–Sun 10–4'],
    phones: [['303-444-2453 ext. 1', '+13034442453,1'], ['720-227-9400', '+17202279400']],
    url: 'https://www.bouldernordic.com/',
    logo: 'icons/bns-logo.png',
    mark: 'icons/bns-mark.png',
    lngLat: [-105.2501147, 40.0287555],
  },
];

/** The partners as a GeoJSON source; `mark` is the map image id. */
export function partnersGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: PARTNERS.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p.lngLat },
      properties: { id: p.id, name: p.name, mark: `partner-${p.id}` },
    })),
  };
}

/** Popup content: logo, what they do, address, hours, phone, website. */
export function partnerPopup(doc, p) {
  const el = doc.createElement('div');
  el.className = 'pop pop-partner';
  const logo = doc.createElement('img');
  logo.src = p.logo;
  logo.alt = p.name;
  logo.className = 'partner-logo';
  const tag = doc.createElement('p');
  tag.className = 'partner-tag';
  tag.textContent = p.tagline;
  const about = doc.createElement('p');
  about.textContent = p.about;

  const dl = doc.createElement('dl');
  dl.className = 'partner-info';
  const row = (label, ...nodes) => {
    const dt = doc.createElement('dt');
    dt.textContent = label;
    const dd = doc.createElement('dd');
    dd.append(...nodes);
    dl.append(dt, dd);
  };
  const link = (href, text) => {
    const a = doc.createElement('a');
    a.href = href;
    a.textContent = text;
    if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  };
  const lines = (items) => items.flatMap((x, i) => (i ? [doc.createElement('br'), x] : [x]));
  row('Address', link(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`, p.address));
  row('Hours', ...lines(p.hours));
  row('Phone', ...lines(p.phones.map(([text, tel]) => link(`tel:${tel}`, text))));
  row('Web', link(p.url, new URL(p.url).hostname.replace(/^www\./, '')));

  el.append(logo, tag, about, dl);
  return el;
}
