# Cartography and design notes

Why the map looks the way it does, and where each rule came from. The code that
implements it: `public/js/basemap.js` (the basemap, "Corduroy"),
`public/js/layers.js` (trails and markers), `public/js/slope.js` (slope
shading), `public/css/app.css` (panel and popups).

The brief, in priority order:

1. **A useful, functional winter map first.** Members use it to choose where to
   ski and to find their way on the day, often on a phone, in the cold, in
   bright snow glare.
2. **At home on the Boulder Nordic Club website**, using the club's colours and
   type as a reference rather than a mandate.

---

## 1. Visual hierarchy: the trails are the figure

The basemap is context; the trails drawn in CalTopo are the content. A
background map should recede: low saturation, low contrast, light. The overlay
data should be the only saturated colour on the page.

- Every basemap colour is desaturated (`PALETTE` in `basemap.js`). Nothing in
  the basemap uses a hue that could be mistaken for a trail.
- Trails get a white casing (outline) so they stay distinct from roads, paths,
  and contours they cross.
- Trail widths scale with zoom from the CalTopo `stroke-width`, so a width-2
  CalTopo line isn't a hairline zoomed out or timid zoomed in.
- Symbol layers later in the style win label collisions, so trail and marker
  labels are added last and beat every basemap label.

Sources: [Ordnance Survey — effective basemaps][os-basemaps];
[Atlas — cartographic design principles][atlas-principles];
[Esri — light gray canvas basemap][esri-gray].

## 2. Ground, landcover, and treeline

- **Off-white ground (`#f7f8f8`), not pure white.** It reads as snow, and white
  trail casings and white label halos still show against it.
- **Forest is the one fill with real weight.** In winter, forest versus open
  terrain is the most decision-relevant landcover. It affects wind exposure,
  snow quality, visibility, and navigation. Treeline should be obvious at a
  glance, the way winter and ski-touring maps emphasise it.
- Scrub, rock, and ice are kept faint; grass and farmland are not drawn at all
  (under snow they're just "open").

Sources: [Gaia GPS — Winter Map v2][gaia-winter];
[Locus Map — winter maps][locus-winter];
[Maptoolkit — winter map tiles][maptoolkit-winter].

## 3. Relief: hillshade, contours, slope

### Hillshade

A soft, cool-grey hillshade (MapLibre's `igor` method, shadow `#5e7184`) with
modest exaggeration. It's enough to read the shape of the terrain, but it never
darkens a slope so much that labels or trails lose contrast. Light comes from
the conventional upper-left (north-west).

Sources: [Terrain cartography (Wikipedia)][wiki-terrain];
[Jenny et al. — Swiss-style relief/rock design principles][jenny-swiss];
[ICA — automatic relief shading][ica-relief].

### Contours

- **One hue (warm grey-brown `#8a7a68`), not multicoloured.** Coloured
  contours lose contrast on a white map exactly where the terrain matters
  most.
- 40 ft minor lines (thin, faint) and index lines (heavier). Labels are in
  feet, matching USGS quads and what a Colorado skier expects.
- Labels thin out with zoom: only every 10th line below z14, every index line
  above it.

Sources: [Locus Map — winter maps][locus-winter];
[MapTiler — contours schema][maptiler-contours].

### Slope-angle shading (optional, off by default)

The toggle in the panel shades slopes of 27° and steeper. The classes are
CalTopo's fixed-step scheme, so they read the same as the tool the club already
plans in:

| Slope | Colour | Why it matters |
|---|---|---|
| < 27° | none | rarely steep enough to avalanche |
| 27–29° | yellow | approaching avalanche terrain |
| 30–31° | light orange | avalanche terrain begins (~30°) |
| 32–34° | dark orange | |
| 35–45° | red | where most slab avalanches start; peak frequency ~38° |
| 46–50° | purple | steep; often sluffs rather than slabs |
| 51°+ | blue | very steep; usually holds little snow |

Fixed steps are used rather than a smooth gradient on purpose: small changes
in angle matter, and a stepped scale makes the 30° and 35° thresholds visible.

How it's computed: `slope.js` fetches the same terrain-RGB elevation tiles the
hillshade uses, calculates each pixel's slope with Horn's 3×3 method, and colours
it. The DEM is a model: it smooths small, short pitches (rollovers, gully
walls, road cuts) that can still avalanche. **Slope shading is a planning aid,
not an avalanche forecast.** Check the CAIC forecast and use your training.

Sources: [CalTopo — Slope Shading Revisited][caltopo-slope];
[CalTopo — Avalanche Slope Analysis][caltopo-avy];
[CalTopo — Custom DEM Shading][caltopo-dem];
[Avalanche Canada — slope angle][avcan-slope];
[REI — recognizing avalanche terrain][rei-avy];
[MSR — recognizing avalanche terrain][msr-avy];
[swisstopo — winter map flyer (slope >30° overlay)][swisstopo-winter];
[Seznam — slope incline layer][seznam-slope];
[Colorado Avalanche Information Center][caic].

## 4. Typography

- **Inter**, the Boulder Nordic Club's web font, served as map glyphs by the
  tile provider and as a web font for the panel. Sans-serif with a large
  x-height is the most legible choice at small sizes.
- **A hierarchy you can read without a legend:**

  | Feature | Treatment |
  |---|---|
  | Towns | SemiBold, darkest ink, largest |
  | Villages, localities | Medium, secondary ink |
  | Trails (CalTopo) | SemiBold, dark, 11.5–14 px, along the line |
  | Peaks | Medium, brown-grey, with elevation in feet beneath |
  | Water | Italic, blue |
  | Contours, other OSM nordic trails | Italic, small, muted |
  | Roads | Regular, small, grey |

- **Halos on every label** (white, 1.2–2 px, slight blur). Halos keep labels
  legible over busy terrain better than outlines do.
- **Nothing below 10.5 px**, and contrast at or above WCAG's 4.5:1 for small text.
  Phones in snow glare need more than desk-screen minimums.

Sources: [Ordnance Survey — text on maps][os-text];
[Atlas — typography in maps][atlas-type];
[Penn State GEOG 486 — typographic design][psu-type];
[McGraw-Hill — map typography (PDF)][mh-type];
[ASPRS — when labels and text matter (PDF)][asprs-labels];
[Esri — labeling guide][esri-labels];
[Missouri — GIS accessibility checklist (PDF)][mo-a11y].

## 5. Reference features: what's drawn and what isn't

- **Roads**: white with a grey casing; highways a pale warm tone. Muted, but
  clear enough to find the trailhead.
- **Paths and tracks**: thin grey dashes, under the trails. They're context, not
  routes.
- **Other groomed nordic trails in OpenStreetMap**: faint blue-grey dots, so
  they can never be confused with the club's own trails.
- **Trailhead points**: parking, toilets, huts and shelters.
- **Boundaries**: wilderness and open-space edges are drawn, since the rules
  change at the line. National-forest boundaries are *not*: they don't change
  what you can do on skis, and around old mining towns (Ward, Nederland) they
  are riddled with private inholdings that turn into visual noise.
- **Buildings**: only at z14+, faint.

## 6. Trails and markers from CalTopo

- The club encodes **difficulty as colour** in CalTopo, using the North American
  ski convention (green, blue, black). The map keeps CalTopo's colours exactly
  rather than re-theming them.
- A trail drawn in **sections** ("Devil's Thumb Trail_1", "…_2", usually one per
  difficulty colour) is shown as one trail: one list row with a chip per
  colour, the combined length, and a popup listing each section's description.
- **Markers** are a disc in the CalTopo marker colour with a letter for the
  symbol (`P` for `parked-car`, `WC`, `i`, `!`, `H` for huts). The letter is
  drawn with the map font, so no icon sprite is needed.
- Dashed CalTopo patterns all render as one dash style.

## 7. Using it outdoors

- **High contrast, simple, and light.** Sunlight washes out low-contrast
  screens, so the map stays light even when the phone is in dark mode.
- **Touch targets of at least 44 px** in the list (40 px map buttons on touch
  screens) for cold or gloved hands. Capacitive screens and gloves don't mix
  well, so precision tapping is never required.
- **Don't rely on colour alone.** Trail names are always labelled, and the slope
  legend lists degree ranges as text.

Sources: [ICA Commission on Map Design — mobile maps][ica-mobile];
[KIT — maps under situational constraints][kit-mobile];
[On writing software for people who work outside][apario];
[Esri — designing mobile maps][esri-mobile];
[Interface design for situational visual impairments][situational].

## 8. Brand

From the Boulder Nordic Club site (read from the Wayback Machine, because the
live site blocks automated requests):

| Token | Value | Used for |
|---|---|---|
| Logo blue | `#005daa` | panel top rule, focus rings, checkbox |
| Navy | `#0c3d54` | panel title, popup titles |
| Text | `#222222` | body text, map label ink |
| Secondary text | `#575760` | lengths, meta |
| Font | Inter | panel, popups, map labels |

Source: [bouldernordic.org (archived)][bnc-archive].

---

[os-basemaps]: https://www.ordnancesurvey.co.uk/blog/effective-basemaps
[atlas-principles]: https://atlas.co/courses/gis-basics/cartographic-design-principles/
[esri-gray]: https://www.esri.com/news/arcwatch/1211/tips-for-using-the-light-gray-canvas-basemap.html
[gaia-winter]: https://blog.gaiagps.com/gaia-winter-map-v2/
[locus-winter]: https://www.locusmap.app/winter-has-come-time-to-switch-to-ski-maps/
[maptoolkit-winter]: https://www.maptoolkit.org/winter
[wiki-terrain]: https://en.wikipedia.org/wiki/Terrain_cartography
[jenny-swiss]: https://mail.colororacle.org/berniejenny/pdf/2014_Jenny_etal_DesignPrinciplesForSwiss-styleRockDrawing.pdf
[ica-relief]: https://icaci.org/files/documents/ICC_proceedings/ICC2015/papers/26/444.html
[maptiler-contours]: https://docs.maptiler.com/schema/contours/
[caltopo-slope]: https://blog.caltopo.com/2013/01/16/slope-shading-revisited/
[caltopo-avy]: https://blog.caltopo.com/?p=761
[caltopo-dem]: https://blog.caltopo.com/2013/02/13/custom-dem-shading/
[avcan-slope]: https://avalanche.ca/glossary/terms/slope-angle
[rei-avy]: https://www.rei.com/learn/expert-advice/avalanche-reducing-risk.html
[msr-avy]: https://www.msrgear.com/blog/backcountry-basics-recognizing-assessing-avalanche-terrain/
[swisstopo-winter]: https://www.swisstopo.admin.ch/dam/de/sd-web/9xOxcg3dR6CU/Flyer-newS50-DE.pdf
[seznam-slope]: https://napoveda.seznam.cz/en/layer-slope-incline
[caic]: https://avalanche.state.co.us/
[os-text]: https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/text-on-maps
[atlas-type]: https://atlas.co/courses/gis-basics/typography-in-maps/
[psu-type]: https://courses.ems.psu.edu/geog486/book/export/html/7
[mh-type]: https://highered.mheducation.com/sites/dl/free/0072943823/599984/Typography.pdf
[asprs-labels]: https://www.asprs.org/wp-content/uploads/2023/09/August2023_GISTT_When-Labels-and-Text-Matter.pdf
[esri-labels]: https://developers.arcgis.com/javascript/latest/labeling/index.html
[mo-a11y]: https://at.mo.gov/wp-content/uploads/GIS-accessibility-checklist.pdf
[ica-mobile]: https://mapdesign.icaci.org/?p=1670
[kit-mobile]: https://publikationen.bibliothek.kit.edu/200062650/3814740
[apario]: https://blog.apario.net/on-writing-software-for-people-who-work-outside
[esri-mobile]: https://help.arcgis.com/en/arcgismobile/10.0/help/007v/007v00000006000000.htm
[situational]: https://openaccess.cms-conferences.org/publications/book/978-1-7923-8989-4/article/978-1-7923-8989-4_64
[bnc-archive]: https://web.archive.org/web/20250807100316/https://bouldernordic.org/
