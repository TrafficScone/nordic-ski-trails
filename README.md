# Nordic Ski Trails

A static map you can draw trails on, host on Netlify, and hand to anyone with a
link. Click a trail to see its details; edit them right there in the page.

- **Basemap** — MapTiler winter/outdoor style with contours and a terrain DEM
- **Draw** — click along a route to lay down a trail; drop places (trailheads,
  warming huts, parking, hazards) on the map
- **Describe** — difficulty, grooming, one-way, lit, dogs, status, free notes
- **Publish** — export the GeoJSON, commit it, push; Netlify serves it

No build step and no framework. Just HTML, CSS, and ES modules.

## Run it locally

```bash
python3 -m http.server -d public 8000    # http://localhost:8000
```

Any static server works — `npx serve public` is equally fine. What you *can't*
do is open `public/index.html` by double-clicking it: browsers block ES modules
and `fetch` on `file://`, so it has to be served over HTTP by something.

### When you want to check the real Netlify behaviour

```bash
netlify dev --offline                    # http://localhost:8888
```

This reads `netlify.toml`, serves `public/`, and applies the actual response
headers, so it's the honest preview before a deploy — worth running any time you
touch `netlify.toml` or add redirects. Note it also provisions a local Postgres
under `.netlify/` (~27 MB, git-ignored) that this site has no use for, which is
why it isn't the everyday command.

There's a virtualenv at `.venv` (git-ignored) for the Python tools. Nothing
needs installing today; `tools/requirements.txt` is a placeholder for the first
dependency you actually reach for.

## Python or JavaScript?

The map itself has to be JavaScript: it runs in the browser, and MapLibre GL is
a JS library. There's no way around that part.

Everything *around* the map is Python, and that's where the work actually is:

| Task | Tool |
|---|---|
| Turn recorded GPX into trails | `python3 tools/import_gpx.py track.gpx --merge` |
| Report + validate the trail data | `python3 tools/trail_report.py` |
| Anything else | `import trailkit` — see `tools/trailkit.py` |

`tools/trailkit.py` is standard library only, with `load()`, `save()`,
`length_m()`, `miles()`, `simplify()`, and `bbox()`. If you want to bulk-rename
trails, recompute difficulty from length, or generate a printable trail table,
write it in Python against that module and rerun `trail_report.py`.

## How data flows

Editing happens in your browser and saves to `localStorage`, so nothing is lost
on refresh and it works offline in a parking lot with no signal. That copy is
yours alone — it isn't what visitors see.

To publish:

1. Draw and edit in the app.
2. **Export** in the toolbar → downloads `trails.geojson`.
3. Move it to `public/data/trails.geojson` in this repo.
4. `python3 tools/trail_report.py` to check it.
5. Commit and push. Netlify redeploys; visitors get the new trails.

**Reset to published data** in the sidebar throws away local edits and reloads
`public/data/trails.geojson` — the escape hatch if you make a mess.

## Using the map

| | |
|---|---|
| **Trail** tool, then click along the route | draw a trail |
| `Enter` | finish the trail |
| `⌫` | remove the last point |
| `Esc` | cancel, or leave the current tool |
| click the first point again | close a loop |
| hold `Alt` while clicking | ignore snapping |
| **Place** tool | drop trailheads, huts, parking; stays armed for several |
| click any trail or place | open its details |
| **Edit shape** | drag points, click a small circle to add one, right-click to remove |
| `L` / `P` | trail tool / place tool |
| `Ctrl+Z` | undo |
| `Delete` | delete the selected feature |

New points snap to nearby existing points, so trails in a network actually meet
rather than *nearly* meeting. Hold `Alt` to place freely.

Selecting a feature puts its id in the URL, so `…/#a1b2c3` links straight to a
trail.

## Deploying to Netlify

Connect the repo in Netlify and accept the defaults — `netlify.toml` already
says "publish `public/`, don't build anything." Or drag the `public/` folder
onto [app.netlify.com/drop](https://app.netlify.com/drop) for a one-off.

Only `public/` is deployed. `tools/`, the README, and the venv are not part of
the website, and the repo root has no dependency manifest, so Netlify installs
nothing and runs no build step.

### The MapTiler key

The key in `js/config.js` ships to the browser; that's how client-side maps
work and it can't be hidden. Protect it by restricting origins instead: MapTiler
dashboard → your key → allowed origins → your Netlify domain (and
`http://localhost:*` for development).

## Making it yours

| Change | Where |
|---|---|
| Opening location, map style, terrain | `public/js/config.js` |
| Difficulty grades, colours, place types, form fields | `public/js/schema.js` |
| Line widths, labels, dashes, icons | `public/js/layers.js` |
| Panels, list, keyboard, import/export | `public/js/app.js` |
| Drawing and vertex editing | `public/js/draw.js` |
| Colours, spacing, dark mode | `public/css/app.css` |

Add a field to `TRAIL_FIELDS` in `public/js/schema.js` and it appears in the editor
form, saves to the feature, and exports — no other changes needed.

## Checks

```bash
node tools/check.mjs     # validates every map layer + filter against the MapLibre style spec
node tools/smoke.mjs     # boots the app headlessly and drives draw → edit → filter → undo
python3 tools/trail_report.py   # validates the published data
```

The first two need dev dependencies once: `npm install --prefix tools`. They're
worth running after any change to `public/js/layers.js` — a malformed map expression
fails silently in the browser, and `check.mjs` catches it in a second.

## Layout

```
public/               ← the only folder Netlify deploys
  index.html          markup and toolbar
  css/app.css         all styling
  js/config.js        style URL, default view, storage keys
  js/schema.js        what a trail and a place are
  js/layers.js        MapLibre layer specs and filters
  js/draw.js          drawing and vertex editing
  js/store.js         feature state, undo, localStorage
  js/geo.js           distance, bbox, simplification
  js/io.js            GPX parsing, file import/export
  js/app.js           wiring
  data/trails.geojson the published trails
tools/                dev only — Python data tools, JS checks, manifests
netlify.toml          static hosting config (publish = "public")
```
