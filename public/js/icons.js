// ---------------------------------------------------------------------------
// Small line icons for the popup's conditions grid, as inline SVG so they
// work offline and take the text colour (stroke="currentColor").
// ---------------------------------------------------------------------------

const PATHS = {
  // Mountain with a slab breaking off its flank.
  avalanche: '<path d="M2 20 9 7l4 6 2-3 7 10z"/><path d="m11.5 11.5 2.5 1.5M10 14l3 1.5"/>',
  // Sun peeking over a cloud.
  weather: '<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/>'
    + '<path d="M7 19h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A3 3 0 0 0 7 19z"/>',
  // Snowflake.
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/>'
    + '<path d="m9.5 3.5 2.5 2 2.5-2M9.5 20.5l2.5-2 2.5 2M4 10.5l3-.5-1-3M20 13.5l-3 .5 1 3M4 13.5l3 .5-1 3M20 10.5l-3-.5 1-3"/>',
  // Two parallel ski tracks.
  grooming: '<path d="M6 21c0-6 3-12 6-18M12 21c0-6 3-12 6-18"/><path d="M5 15h3M7.5 10h3M10 15h3M12.5 10h3"/>',
  // Road sign on a post.
  access: '<path d="M12 22V10"/><path d="M5 3h12l3 3.5L17 10H5z"/>',
  // Cabin.
  hut: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  // Information.
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/>',
};

/**
 * @param {keyof PATHS} name
 * @returns {SVGSVGElement}
 */
export function icon(name) {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" `
    + `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? PATHS.info}</svg>`;
  return wrap.firstChild;
}

/** Pick an icon for a conditions link from its URL. */
export function iconForUrl(url) {
  const host = new URL(url).hostname;
  if (host.includes('avalanche')) return 'avalanche';
  if (host.includes('weather.gov')) return 'weather';
  if (host.includes('wcc.sc.egov.usda.gov')) return 'snow';
  if (host.includes('eldora')) return 'grooming';
  if (host.includes('cmc')) return 'hut';
  if (host.includes('fs.usda.gov')) return 'access';
  return 'info';
}
