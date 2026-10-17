# Working in this repo

A static, no-build, display-only map of CalTopo GeoJSON exports. `public/` is
the entire website and the only folder Netlify deploys; everything else in the
repo is development scaffolding. There is no bundler, no framework, and no npm
dependency in the shipped site — MapLibre GL comes from a CDN `<script>` tag in
`public/index.html`. Keep it that way unless asked; the simplicity is the point.
There is deliberately no editing — trails are drawn in CalTopo.

Do not add a dependency manifest (`package.json`, `requirements.txt`) to the repo
root — Netlify detects those and starts installing things. Dev manifests live in
`tools/`.

Run it locally with `python3 -m http.server -d public 8000`, or any static
server. It must be served over HTTP; ES modules and `fetch` are blocked on
`file://`. Use `netlify dev --offline` (port 8888) only when you need to verify
`netlify.toml` headers/redirects.

## Trail data

CalTopo exports go in `public/trails/`. A static site can't list a folder, so
`tools/index_trails.py` writes `public/trails/index.json`; Netlify runs it as
the build command. `app.js` copies CalTopo's styling (`stroke`, `stroke-width`,
`stroke-opacity`, `pattern`, `marker-color`, `fill-opacity`, `title`) onto
`_`-prefixed properties that the layers read.

CalTopo polygons are *areas*: list sections in the app, and the regions
`tools/sync_osm.py` pulls OSM trails from. The user curates OSM results by
telling Claude what to drop or recolour; record those decisions in
`tools/osm-trails.json` (keyed by polygon title), re-run the sync, and commit —
never hand-edit `osm.geojson`.

`tools/sync_osm.py` builds `public/trails/osm.geojson` from OpenStreetMap
(Overpass) for every CalTopo polygon plus the way lists in `tools/osm-trails.json`. It writes CalTopo-shaped
properties (`title`, `stroke`, `pattern`…) so `app.js` needs no OSM-specific code.
It runs by hand, never in the Netlify build: Overpass can be down, and OSM edits
should be reviewed before they go live. `python3 tools/test_sync_osm.py` tests it
offline.

## After changing map code, run the checks

```bash
node tools/check.mjs    # MapLibre layer specs, DOM ids, index.json in sync
node tools/smoke.mjs    # headless boot: load, style, list, popup
```

Dev deps install once with `npm install --prefix tools`. A bad MapLibre
expression fails **silently** in the browser, so `check.mjs` is the fastest way
to catch one.

Layer specs live in `public/js/layers.js` (trails) and `public/js/basemap.js`
(the whole basemap style) as plain data precisely so they can be validated
without a browser. Add new layers there, not inline in `app.js`. Basemap colours
come from `PALETTE` in `basemap.js`; the design rules and their sources are in
`docs/cartography.md` — update it when a design decision changes. Slope shading
is a custom `slope://` protocol (`public/js/slope.js`) that turns terrain-RGB
tiles into a coloured raster in the browser.
Symbol layers later in the style win label collisions, so trail labels (added
last) beat basemap labels.

## Things that bite

- Python tools are standard library only. No pip installs.
- The MapTiler key is public by design; it's protected by origin restrictions
  in the MapTiler dashboard, not by hiding it.
- MapLibre rejects `zoom` expressions nested inside arithmetic — write out a
  separate `interpolate` instead.
