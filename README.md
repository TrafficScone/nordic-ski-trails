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
a "Groomed trails only" switch (OSM grooming tags or the area's `grooming`
setting), and a map key.

The basemap ("Corduroy", `public/js/basemap.js`) is a light winter style built
on MapTiler's vector tiles: snow-white ground, forest tinted so treeline reads
at a glance, soft relief with 40 ft contours, and Inter labels to match the
club site. Slope-angle shading (18–25° yellow, 25–30° orange, 30–40° red, 40°+ purple,
computed in the browser) is off by default; the map key in the corner toggles it. The design principles and their sources are in
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

Polygons in the CalTopo map are **areas** ("Eldora", "West Magnolia").
On the site, an area is a light outline (strongest zoomed out) and a section in
the trail list holding every trail and place inside it; its CalTopo description
shows when you click it.

Areas also drive the OpenStreetMap sync. For each one, `tools/sync_osm.py`
pulls every OSM trail inside the polygon (groomed nordic trails, named paths
and tracks, named minor roads), clips it to the polygon, and joins it by name
("Devils" and "Devil's" count as the same). Groomed trails often carry OSM
difficulty and grooming tags, which become the green/blue/black colour and the
popup text; ungroomed (`piste:grooming=backcountry`) trails get a white
centre stripe.

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
| `grooming` | `"ungroomed"` / `"groomed"` for every trail in the area, overriding OSM. Ungroomed trails get a white centre stripe. |
| `needs_snow` | `true` if the area is only skiable after heavy recent snowfall: its trails are drawn dashed. |
| `splits` | Colour one trail in sections: `{"Wild Basin Trail": {"at": "Thunder Lake Trail", "from": "east", "colors": ["blue", "black"]}}` cuts where it meets that trail, counting from its east end. `at` can also be a `[lng, lat]` point or a list of cuts (one more colour than cuts); the colour `"drop"` leaves a piece off the map. |

`trails` takes exact way lists for when an area isn't the right tool:
`{"name": "…", "area": "Brainard Lake", "sections": [{"ways": [123, 456], "color": "blue", "description": "…"}]}`
(`area` files it under that area and applies the area's `grooming` / `needs_snow`).

On the map, **solid** = groomed or unknown, **white centre stripe** = ungroomed,
**dashed** = needs heavy recent snowfall (a dashed CalTopo line means the same).
Zoomed out (below zoom 10.5, `TRAIL_MINZOOM` in `layers.js`) only the areas show;
trails, places and their labels appear as you zoom in.

An OSM trail with the same name as a CalTopo line is skipped automatically —
the hand-drawn version wins. Differently spelled duplicates ("4th of July Road")
still need an `exclude` entry. Re-run it
whenever you want OSM's latest, and review before committing, since anyone can
edit OSM. Trail data from OSM is © OpenStreetMap contributors (ODbL), credited
in the map's attribution.

## Contributing a region

You can't edit the club's CalTopo map, but you don't need to: the site loads
every GeoJSON file in `public/trails/`. To add your own area, send a pull
request with:

1. **Your CalTopo export** as a new file, e.g. `public/trails/lyons.geojson`.
   Draw a **polygon** around each area (its title becomes the area's name in
   the list; keep it short, no "Area" or "Zone" suffix) and any hand-drawn
   **lines** for trails OSM doesn't have. Use the club's conventions so it
   reads like the rest of the map: line colour green `#00cd00` / blue
   `#0000ff` / black `#000000` for difficulty, and a dashed line only for
   "skiable after heavy recent snowfall". Markers with CalTopo's symbols
   become discs (`P` for parking, and so on).
2. **Your curation** in `tools/osm-trails.json` (optional), keyed by your
   polygon titles: trails to drop, recolour, or mark ungroomed (see the table
   above). Polygon titles must be unique across all the files.
3. Run `python3 tools/index_trails.py` and the [checks](#checks).

Don't commit a regenerated `osm.geojson` in the PR; the maintainer runs
`tools/sync_osm.py` after merging (it never runs in the Netlify build) and
reviews what OSM returns for the new area.

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

### Branches: `dev` for work, `main` for the live site

Netlify's free plan charges 15 credits per production deploy (every push to
`main`) out of 300 a month, and pauses the site when they run out. Branch
deploys are free. So:

- Work lands on **`dev`**. Each push to it updates the preview at
  https://dev--bncmap.netlify.app (free). The MapTiler key must allow that
  origin too.
- **`main` is production.** Merge `dev` into it only to release
  (`git checkout main && git merge --ff-only dev && git push`), batching changes.
- A commit message containing `[skip netlify]` doesn't build at all.

### The MapTiler key

The key is never committed. `public/js/config.js` holds the placeholder
`__MAPTILER_KEY__`; the Netlify build replaces it with the `MAPTILER_KEY`
environment variable (Site configuration → Environment variables), and fails
if that isn't set. Locally the key lives in `.env` (git-ignored):

```
MAPTILER_KEY=your-key
```

For local development, open the site once with the key in the URL; it's
remembered in that browser and removed from the address bar:

```bash
echo "http://localhost:8000/?maptiler_key=$(sed -n 's/^MAPTILER_KEY=//p' .env)"
```

(This only works on `localhost`/`127.0.0.1`, and only while the key allows
`localhost` in the MapTiler dashboard — remove that before launch.)

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
  js/partners.js        club supporters on the map (Boulder Nordic & Cycle Sport), and
                        nordic centres' contact details (NORDIC_CENTERS) for their area popups
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

## Make it your own (forking)

The whole app is reusable for any club or region. What a fork has to change:

**Accounts and keys** (none are shared with forks):

- A **MapTiler** account and key (the free tier is enough for a club site),
  restricted to your own domain. It's both the basemap and the elevation data
  behind slope shading, profiles and the elevation readout. See
  [The MapTiler key](#the-maptiler-key).
- **Hosting**: on Netlify, set the `MAPTILER_KEY` environment variable and
  the included `netlify.toml` does the rest. Any static host works if its
  build runs the same `sed` substitution (see `netlify.toml`) and serves
  `public/`.
- **Overpass**: change `USER_AGENT` in `tools/sync_osm.py` so OSM's servers
  see who is querying. Overpass is a shared, volunteer-run service: run the
  sync by hand and occasionally, as this repo does.

**Your trails**: replace `public/trails/bnc-places-to-ski.geojson` with your
own CalTopo export, empty the `areas` and `trails` in `tools/osm-trails.json`,
and run the sync.

**Club-specific files** to edit or empty:

| File | What's specific |
|---|---|
| `public/js/config.js` | `DEFAULT_VIEW` (opening map position), `UNITS`, `AREA_MARKS` (area logos; empty it to have none) |
| `public/js/partners.js` | Club supporters on the map; set `PARTNERS` to `[]` |
| `public/js/conditions.js` | `AREA_LINKS` (per-area condition pages), `SNOTEL_STATIONS` (Colorado stations), the CAIC avalanche link |
| `public/index.html` | Page title and panel heading |
| `public/manifest.webmanifest` | Home-screen app name and colours |
| `public/css/app.css` | Brand colours (`--brand`, `--brand-ink`) |
| `public/icons/` | App icons (`tools/make_icons.py`) and the logos below |
| `tools/bnc-mark.svg` | Source of the BNC logo |

**Regional data sources.** The live conditions in each popup use US services:
the National Weather Service (US only), NRCS SNOTEL snow stations (western
US), and avalanche.org (US avalanche centres; CAIC in Colorado). Outside their
coverage each card fails on its own and is left out, but the SNOTEL list has
no distance limit, so a fork elsewhere in the US should replace
`SNOTEL_STATIONS` with its nearby stations, and one outside the US should
remove the snow card.

## Licence

The code is [MIT](LICENSE). Two things in the repo are **not** covered by it:

- **Logos and trademarks.** The Boulder Nordic Club logo (`icons/bnc-mark.png`,
  `tools/bnc-mark.svg`), the Eldora logo (`icons/eldora-mark.png`), the
  Devil's Thumb Ranch logos (`icons/dtr-mark.png`, `icons/dtr-logo.png`), the YMCA of the Rockies
  logos for Snow Mountain Ranch (`icons/smr-mark.png`, `icons/smr-logo.png`) and the
  Boulder Nordic & Cycle Sport logos (`icons/bns-logo.png`, `icons/bns-mark.png`)
  belong to their owners and aren't licensed for reuse. A fork must remove or
  replace them.
- **Trail data from OpenStreetMap** (`public/trails/osm.geojson`) is
  © OpenStreetMap contributors under the
  [ODbL](https://opendatacommons.org/licenses/odbl/): keep the attribution
  (the map shows it) and share changes to the data under the same licence.

Basemap tiles and elevation data come from MapTiler under their own
[terms](https://www.maptiler.com/terms/), with your own key.
