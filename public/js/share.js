// ---------------------------------------------------------------------------
// Shareable links for trails, places and areas.
//
// A link is the page URL plus a hash like `#trail/devils-thumb-trail`. The
// slug is derived from the group name, so it is stable across reloads and
// matches the filename used for GPX downloads. Nothing here touches the map;
// the app reads the hash on load and calls setHash/clearHash as the selection
// changes.
// ---------------------------------------------------------------------------

/**
 * Lowercase, apostrophes dropped, runs of non-alphanumerics become one dash.
 * @param {string} name
 * @returns {string}
 */
export function slug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {{kind: string, name: string}} g
 * @returns {string}  e.g. "#trail/devils-thumb-trail"
 */
export function hashFor(g) {
  return `#${g.kind}/${slug(g.name)}`;
}

/**
 * @param {string} [hash]
 * @returns {{kind: string|null, slug: string}|null}  null if empty or invalid
 */
export function parseHash(hash = location.hash) {
  let h = String(hash ?? '').replace(/^#/, '');
  try { h = decodeURIComponent(h); } catch { return null; }
  const parts = h.split('/').filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  if (parts.length === 1) return { kind: null, slug: parts[0] };
  const [kind, s] = parts;
  if (!['trail', 'area', 'place'].includes(kind)) return null;
  return { kind, slug: s };
}

/**
 * @param {Map<string, object>|object[]} groups
 * @param {{kind: string|null, slug: string}|null} parsed
 * @returns {object|undefined}
 */
export function findGroup(groups, parsed) {
  if (!parsed) return undefined;
  const list = groups instanceof Map ? groups.values() : groups;
  for (const g of list) {
    if ((!parsed.kind || g.kind === parsed.kind) && slug(g.name) === parsed.slug) return g;
  }
  return undefined;
}

/** @returns {string}  absolute URL that reopens this group */
export function linkFor(g) {
  return location.origin + location.pathname + location.search + hashFor(g);
}

/**
 * Native share sheet if there is one, else clipboard, else a prompt.
 * Never throws.
 * @returns {Promise<'shared'|'cancelled'|'copied'|'shown'>}
 */
export async function shareLink(g) {
  const url = linkFor(g);
  try {
    if (navigator.share && (navigator.canShare?.({ url }) ?? true)) {
      try {
        await navigator.share({ title: g.name, url });
        return 'shared';
      } catch (err) {
        if (err?.name === 'AbortError') return 'cancelled';
        // any other failure: fall through to the clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    try { window.prompt('Copy this link', url); } catch { /* nothing left to try */ }
    return 'shown';
  }
}

/** Reflect the selection in the address bar without a new history entry. */
export function setHash(g) {
  history.replaceState(null, '', hashFor(g));
}

/** Drop the hash, keeping path and query. */
export function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
}
