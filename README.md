# Nordic Ski Trails

A static map of nordic ski trails, drawn in [CalTopo](https://caltopo.com) and
hosted on Netlify for the Boulder Nordic Club. Trails keep the colours and line
styles you gave them in CalTopo; click one for its name, length, and
description.

The basemap ("Corduroy", `public/js/basemap.js`) is a light winter style built
on MapTiler's vector tiles: snow-white ground, forest tinted so treeline reads
at a glance, soft relief with 40 ft contours, and Inter labels to match the
club site. A panel toggle adds slope-angle shading (CalTopo's classes, computed
in the browser). The design principles and their sources are in
[docs/cartography.md](docs/cartography.md); every basemap colour lives in
`PALETTE` in `basemap.js`.

No build step and no framework. Just HTML, CSS, and ES modules.

## Adding or updating a trail

1. In CalTopo, export the map (or the line) as **GeoJSON**.
2. Drop the file into `public/trails/`. Replacing an existing file updates it.
3. `python3 tools/index_trails.py` — refreshes `public/trails/index.json`, the
   list of files the map loads. (Netlify runs this on every deploy too, so it
   only matters for previewing locally.)
4. Commit and push. Netlify redeploys.

What comes across from CalTopo: line colour, width, opacity, solid vs. dashed
(every non-solid pattern shows as one dash style), titles, descriptions,
markers (a coloured disc with a letter for the symbol, such as `P` for
parking), and polygons (as tinted areas). Sections named `Trail_1`, `Trail_2`…
are shown as one trail with a combined length.

## Run it locally

```bash
python3 -m http.server -d public 8000    # http://localhost:8000
```

It has to be served over HTTP — browsers block ES modules and `fetch` on
`file://`. Use `netlify dev --offline` (port 8888) when you want to check
`netlify.toml` headers exactly as deployed.

## Checks

```bash
node tools/check.mjs     # layer specs, DOM ids, index.json in sync with the files
node tools/smoke.mjs     # boots the app headlessly: load, style, list, popup
```

Dev dependencies install once with `npm install --prefix tools`.

## Deploying to Netlify

Connect the repo and accept the defaults — `netlify.toml` publishes `public/`
and runs the index script. Only `public/` is deployed.

### The MapTiler key

The key in `public/js/config.js` (used for basemap tiles and fonts) ships to the browser and can't be hidden.
Protect it by restricting origins: MapTiler dashboard → your key → allowed
origins → your Netlify domain (and `http://localhost:*` for development).

## Layout

```
public/                 ← the only folder Netlify deploys
  index.html            map + trail list
  css/app.css           styling
  js/config.js          MapTiler key, opening view, units
  js/basemap.js         the winter basemap style (palette + layers)
  js/slope.js           slope-angle shading, computed from elevation tiles
  js/layers.js          trail layer specs
  js/app.js             loads trails, list, popups
  trails/*.geojson      CalTopo exports
  trails/index.json     generated list of the above
docs/cartography.md     design principles and sources
tools/                  dev only — index script, checks
netlify.toml            static hosting config
```
