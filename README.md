# Nordic Ski Trails

A static map of nordic ski trails, drawn in [CalTopo](https://caltopo.com) and
hosted on Netlify for the Boulder Nordic Club. Trails keep the colours and line
styles you gave them in CalTopo; click one for its name, length, and
description, along with distance, climb (↑ gain / ↓ loss) and an elevation
profile computed from the elevation model. Each popup also has:

- **Conditions** cards: avalanche danger (avalanche.org / CAIC), the NWS
  forecast for that spot, and snow depth at the nearest SNOTEL station, filled
  in live from those services; plus area pages (Eldora's grooming report,
  Brainard road status…). Edit the area links in `AREA_LINKS` in
  `public/js/conditions.js`.
- The selected trail is highlighted with **S** / **E** markers at its ends;
  scrubbing the elevation chart moves a dot along it.
- **Download GPX**, for a watch or phone app. An area's popup downloads all of
  its trails and places in one file.
- **Share link**: `…/#trail/devils-thumb-trail` opens the map on that trail.
  Opening anything updates the address bar, so copying the URL works too.

**Offline:** a service worker (`public/sw.js`) saves the app, the trail data,
and every map tile you've looked at, so an area browsed at home still works at
a trailhead with no signal. GPS works offline too. There's no "download an
area" button (check MapTiler's terms before adding one); for serious offline
navigation, use **Download GPX** in Gaia, CalTopo or onX. The site can also be
installed to a phone's home screen, which on iPhones keeps its saved data from
being cleared after a week of disuse.

The panel has difficulty filter chips (green/blue/black by the trail colour),
a "Groomed trails only" switch (OSM grooming tags; a dashed CalTopo line
counts as ungroomed), and a map key.

The basemap ("Corduroy", `public/js/basemap.js`) is a light winter style built
on MapTiler's vector tiles: snow-white ground, forest tinted so treeline reads
at a glance, soft relief with 40 ft contours, and Inter labels to match the
club site. Slope-angle shading (18–25° yellow, 25–30° orange, 30–40° red, 40°+ purple,
computed in the browser) is on by default; the map key in the corner toggles it. The design principles and their sources are in
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

## Areas and OpenStreetMap trails

Polygons in the CalTopo map are **areas** ("Eldora", "West Magnolia Trails").
On the site, an area is a light outline (strongest zoomed out) and a section in
the trail list holding every trail and place inside it; its CalTopo description
shows when you click it.

Areas also drive the OpenStreetMap sync. For each one, `tools/sync_osm.py`
pulls every OSM trail inside the polygon (groomed nordic trails, named paths
and tracks, named minor roads), clips it to the polygon, and joins it by name
("Devils" and "Devil's" count as the same). Groomed trails often carry OSM
difficulty and grooming tags, which become the green/blue/black colour and the
popup text; ungroomed (`piste:grooming=backcountry`) trails are drawn dashed.

```bash
python3 tools/sync_osm.py        # writes public/trails/osm.geojson
python3 tools/index_trails.py    # then review the diff and commit
```

What to keep, drop, or recolour lives in `tools/osm-trails.json`, keyed by the
polygon's CalTopo title, so it survives every re-export:

```json
{
  "areas": {
    "Eldora": {
      "include": ["nordic", "paths", "roads"],
      "exclude": ["Kinglet Trail", 206211544],
      "colors": { "Jenny Creek": "green" },
      "color": "blue",
      "notes": { "Jenny Creek": "Dogs allowed on this one." }
    }
  },
  "trails": []
}
```

| Key | Meaning |
|---|---|
| `include` | `nordic`, `paths`, `roads`. Default: all three. |
| `exclude` | Trail names or OSM way ids to leave out. |
| `colors` | Per-trail colour: `green`, `blue`, `black`, or a hex colour. |
| `color` | Colour for trails OSM gives no difficulty for (default blue). |
| `notes` | Extra description text per trail, shown above OSM's grooming info. |
| `min_length_m` | Drop pieces shorter than this (default 100 m; edge slivers). |

`trails` takes exact way lists for when an area isn't the right tool:
`{"name": "…", "sections": [{"ways": [123, 456], "color": "blue", "description": "…"}]}`.

An OSM trail with the same name as a CalTopo line is skipped automatically —
the hand-drawn version wins. Differently spelled duplicates ("4th of July Road")
still need an `exclude` entry. Re-run it
whenever you want OSM's latest, and review before committing, since anyone can
edit OSM. Trail data from OSM is © OpenStreetMap contributors (ODbL), credited
in the map's attribution.

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
python3 tools/test_sync_osm.py   # OSM sync: stitching, clipping, naming
node tools/test_filters.mjs      # filter expressions validate and match the list logic
node tools/test_gpx_share.mjs    # GPX output, link slugs and hashes
node tools/test_conditions.mjs   # condition links, nearest SNOTEL
node tools/test_sw.mjs           # service worker routing and caching
node tools/test_live_conditions.mjs  # live conditions parsing (fixtures in tools/fixtures/)
```

Dev dependencies install once with `npm install --prefix tools`.

## Deploying to Netlify

Connect the repo and accept the defaults — `netlify.toml` publishes `public/`
and runs the index script. Only `public/` is deployed.

### The MapTiler key

The key is never committed. `public/js/config.js` holds the placeholder
`__MAPTILER_KEY__`; the Netlify build replaces it with the `MAPTILER_KEY`
environment variable (Site configuration → Environment variables), and fails
if that isn't set. Locally the key lives in `.env` (git-ignored):

```
MAPTILER_KEY=your-key
```

The key still reaches visitors' browsers — map tiles can't load without it —
so restrict it in the MapTiler dashboard (Allowed HTTP origins:
`bnc.worthgentry.com`, `bncmap.netlify.app`, `localhost`), keep an eye on
usage, and rotate it every few months (new key → update the Netlify variable
and `.env` → redeploy).

## Layout

```
public/                 ← the only folder Netlify deploys
  index.html            map + trail list
  css/app.css           styling
  js/config.js          MapTiler key, opening view, units
  js/basemap.js         the winter basemap style (palette + layers)
  js/dem.js             elevation tile loading (shared)
  js/slope.js           slope-angle shading, computed from elevation tiles
  js/profile.js         elevation profiles and climb stats
  js/filters.js         difficulty/grooming filters and the map key
  js/conditions.js      condition links per trail and area (edit AREA_LINKS)
  js/gpx.js             GPX export
  js/share.js           shareable #kind/slug links
  js/live-conditions.js live avalanche / weather / snow readings
  js/icons.js           conditions card icons
  sw.js                 service worker: offline app + saved map tiles
  manifest.webmanifest  home-screen install (icons/ from tools/make_icons.py)
  js/layers.js          trail layer specs
  js/app.js             loads trails, list, popups
  trails/*.geojson      CalTopo exports
  trails/index.json     generated list of the above
docs/cartography.md     design principles and sources
tools/                  dev only — index script, OSM sync, checks
  osm-trails.json       per-area OSM keep/drop/recolour decisions
netlify.toml            static hosting config
```
