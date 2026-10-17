# Working in this repo

A static, no-build map site. `public/` is the entire website and the only folder
Netlify deploys; everything else in the repo is development scaffolding. There is
no bundler, no framework, and no npm dependency in the shipped site — MapLibre GL
comes from a CDN `<script>` tag in `public/index.html`. Keep it that way unless
asked; the lack of a build step is a feature here.

Do not add a dependency manifest (`package.json`, `requirements.txt`) to the repo
root — Netlify detects those and starts installing things. Dev manifests live in
`tools/`.

Run it locally with `python3 -m http.server -d public 8000`, or any static
server. It must be served over HTTP; ES modules and `fetch` are blocked on
`file://`. Use `netlify dev --offline` (port 8888) only when you need to verify
`netlify.toml` headers/redirects — it also provisions an unused local Postgres
under `.netlify/`.

## After changing map code, run the checks

```bash
node tools/check.mjs    # MapLibre layer specs + filters, DOM ids, data file
node tools/smoke.mjs    # headless boot: draw, edit, filter, reshape, undo
```

Dev deps install once with `npm install --prefix tools` (they live in `tools/`
so the site root stays buildless). A bad MapLibre expression fails **silently**
in the browser, so `check.mjs` is the fastest way to catch one — it already
caught a `['*', <zoom interpolate>, 0.55]` that MapLibre rejects.

Layer specs live in `public/js/layers.js` as plain data precisely so they can be
validated without a browser. Add new layers there, not inline in
`public/js/app.js`.

## Conventions

- `public/js/schema.js` is the single definition of trail/place fields. Adding a field
  there flows through the editor form, the store defaults, and the export.
  Mirror it in `TRAIL_DEFAULTS` / `PLACE_DEFAULTS` in `tools/trailkit.py`.
- All feature mutations go through `Store` (`public/js/store.js`) so undo and
  `localStorage` stay correct. The one exception is the mid-drag geometry
  preview in `app.js`, which deliberately bypasses the undo checkpoint.
- Python tools are standard library only. No pip installs.
- `public/data/trails.geojson` is the published data. Browser edits live in
  `localStorage` until exported — don't hand-edit both and expect a merge.

## Things that bite

- Paths moved once already: the site lives under `public/`. `tools/trailkit.py`
  and both checkers derive their paths from a `SITE_DIR`/`SITE` constant.
- The MapTiler key is public by design; it's protected by origin restrictions
  in the MapTiler dashboard, not by hiding it.
- MapLibre rejects `zoom` expressions nested inside arithmetic — write out a
  separate `interpolate` instead.
