#!/usr/bin/env python3
"""Build trails from OpenStreetMap for the areas drawn in CalTopo.

    python3 tools/sync_osm.py

Every polygon in the CalTopo exports in public/trails/ is an area. Every OSM
trail inside it (groomed nordic trails, named paths and tracks, named minor
roads) is fetched, clipped to the polygon, and joined by name.

tools/osm-trails.json refines that, keyed by the polygon's CalTopo title:

  "areas": {
    "Eldora": {
      "include": ["nordic", "paths", "roads"],   default: all three
      "exclude": ["Kinglet Trail", 206211544],   trail names or OSM way ids
      "colors":  {"Jenny Creek": "green"},       per-trail colour overrides
      "color":   "blue",                         when OSM has no difficulty
      "notes":   {"Jenny Creek": "Dogs allowed"} extra description text
      "grooming": "ungroomed",                   override OSM for the whole area
      "needs_snow": true,                        only skiable after heavy recent
                                                   snowfall: drawn dashed
      "splits": {"Pawnee Pass Trail":            colour a trail in sections, cut
        {"at": "Jean Lunning Trail",             where it last meets another trail
         "from": "east",                         counting from this end
         "colors": ["blue", "black"]}}           (or "at": [lng, lat], the point on
                                                   the trail nearest it, or a list of
                                                   cuts with one more colour; a
                                                   "drop" colour leaves that piece out)
    }
  },
  "trails": [ … ]   exact OSM way lists, optionally in coloured sections; give
                    one an "area" to file it there and inherit the area's
                    grooming / needs_snow

The result is written to public/trails/osm.geojson in the same shape CalTopo
exports, so the map treats it exactly like a hand-drawn trail. Run it by hand
and review the diff before committing: anyone can edit OSM, so upstream changes
shouldn't go live unreviewed. Standard library only.
"""

import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = ROOT / "public"
TOOLS_DIR = ROOT / "tools"
MANIFEST = TOOLS_DIR / "osm-trails.json"
TRAILS_DIR = SITE_DIR / "trails"
OUTPUT = TRAILS_DIR / "osm.geojson"

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "nordic-ski-trails/1.0 (Boulder Nordic Club trail map)"

# Difficulty names -> the colours the club uses in CalTopo.
COLORS = {"green": "#00cd00", "blue": "#0000ff", "black": "#000000"}
# OSM piste:difficulty -> difficulty colour.
PISTE_DIFFICULTY = {
    "novice": "green", "easy": "green",
    "intermediate": "blue",
    "advanced": "black", "expert": "black", "freeride": "black", "extreme": "black",
}
DEFAULT_WIDTH = 2
DEFAULT_INCLUDE = ["nordic", "paths", "roads"]
# Pieces shorter than this (usually a trail clipped at the polygon edge) are dropped.
MIN_LENGTH_M = 100

# What each `include` keyword fetches inside an area. Paths and roads must be
# named; an unnamed path can't be listed or labelled.
INCLUDE = {
    "nordic": ['way["piste:type"="nordic"]{poly};', 'relation["piste:type"="nordic"]{poly};'],
    "paths": ['way[highway~"^(path|footway|bridleway|track)$"][name]{poly};'],
    "roads": ['way[highway~"^(unclassified|service|residential|tertiary)$"][name]{poly};'],
}


# -- Overpass ---------------------------------------------------------------

def overpass(query: str) -> dict:
    """Run an Overpass query, trying each endpoint, with one retry each."""
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in OVERPASS:
        for attempt in range(2):
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(req, timeout=180) as res:
                    return json.load(res)
            except (urllib.error.URLError, TimeoutError, ValueError) as err:
                last = err
                time.sleep(3 * (attempt + 1))
    raise SystemExit(f"Overpass unavailable: {last}")


# -- geometry ---------------------------------------------------------------

def haversine(a, b) -> float:
    (lon1, lat1), (lon2, lat2) = a[:2], b[:2]
    r = math.radians
    h = (math.sin(r(lat2 - lat1) / 2) ** 2
         + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2)
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def length_m(coords) -> float:
    return sum(haversine(a, b) for a, b in zip(coords, coords[1:]))


def way_coords(el: dict) -> list[list[float]]:
    return [[round(p["lon"], 7), round(p["lat"], 7)] for p in el["geometry"]]


def stitch(ways: list[dict]) -> list[list[list[float]]]:
    """Join ways that share end nodes into as few continuous lines as possible.

    Each way is {"nodes": [ids…], "coords": [[lon, lat]…]}. Returns coordinate
    lists, longest first; more than one means a gap or a branch.
    """
    pending = [{"nodes": list(w["nodes"]), "coords": [list(c) for c in w["coords"]]} for w in ways]
    chains = []
    while pending:
        chain = pending.pop(0)
        grown = True
        while grown:
            grown = False
            for i, w in enumerate(pending):
                head, tail = chain["nodes"][0], chain["nodes"][-1]
                if w["nodes"][0] == tail:
                    add, at_end = w, True
                elif w["nodes"][-1] == tail:
                    add, at_end = _reversed(w), True
                elif w["nodes"][-1] == head:
                    add, at_end = w, False
                elif w["nodes"][0] == head:
                    add, at_end = _reversed(w), False
                else:
                    continue
                if at_end:
                    chain["nodes"] += add["nodes"][1:]
                    chain["coords"] += add["coords"][1:]
                else:
                    chain["nodes"] = add["nodes"][:-1] + chain["nodes"]
                    chain["coords"] = add["coords"][:-1] + chain["coords"]
                pending.pop(i)
                grown = True
                break
        chains.append(chain["coords"])
    return sorted(chains, key=length_m, reverse=True)


def _reversed(w):
    return {"nodes": w["nodes"][::-1], "coords": w["coords"][::-1]}


def inside(pt, ring) -> bool:
    """Ray-casting point-in-polygon on [lon, lat] rings."""
    x, y = pt[0], pt[1]
    hit = False
    for (x1, y1, *_), (x2, y2, *_) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def in_polygon(pt, polygon) -> bool:
    """polygon = [outer ring, *holes]."""
    return inside(pt, polygon[0]) and not any(inside(pt, h) for h in polygon[1:])


def clip_way(way: dict, polygons: list) -> list[dict]:
    """Cut a way to the parts inside any of the polygons.

    Vertices outside are dropped and each run inside becomes its own piece;
    the edge is approximated by the last vertex inside, which at trail vertex
    spacing is a few metres. Node ids are kept so pieces still stitch.
    """
    pieces, run = [], None
    for node, c in zip(way["nodes"], way["coords"]):
        if any(in_polygon(c, p) for p in polygons):
            if run is None:
                run = {"nodes": [], "coords": []}
            run["nodes"].append(node)
            run["coords"].append(c)
        elif run is not None:
            pieces.append(run)
            run = None
    if run is not None:
        pieces.append(run)
    return [p for p in pieces if len(p["coords"]) > 1]


def caltopo_files() -> list[Path]:
    return [p for p in sorted(TRAILS_DIR.glob("*.*json")) if p.name not in (OUTPUT.name, "index.json")]


def find_areas() -> dict[str, list]:
    """{polygon title: [polygon, …]} from every CalTopo export in public/trails/."""
    areas: dict[str, list] = {}
    for path in caltopo_files():
        for f in json.loads(path.read_text(encoding="utf-8")).get("features", []):
            g = f.get("geometry") or {}
            title = ((f.get("properties") or {}).get("title") or "").strip()
            polys = ([g["coordinates"]] if g.get("type") == "Polygon"
                     else g["coordinates"] if g.get("type") == "MultiPolygon" else [])
            if polys and title:
                areas.setdefault(title, []).extend(
                    [[[c[:2] for c in ring] for ring in poly] for poly in polys])
    return areas


def poly_filter(polygon) -> str:
    """Overpass (poly:"lat lon …") for a polygon's outer ring."""
    return '(poly:"' + " ".join(f"{c[1]:.6f} {c[0]:.6f}" for c in polygon[0]) + '")'


# -- naming and styling -----------------------------------------------------

def name_key(name: str) -> str:
    """'Devils Thumb Trail' and "Devil's Thumb Trail" are the same trail."""
    return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("'", "").replace("’", "")).strip()


def color_of(value) -> str:
    if not value:
        return COLORS["blue"]
    return COLORS.get(str(value).lower(), value)


GROOMING = {"classic": "classic", "skating": "skate", "scooter": "snowmobile track", "mogul": "moguls"}


def ungroomed(tags: dict) -> bool:
    return tags.get("piste:grooming") == "backcountry"


def describe(tags: dict) -> str:
    """A short description from the OSM tags that matter on skis."""
    bits = []
    grooming = tags.get("piste:grooming")
    if ungroomed(tags):
        bits.append("Not groomed")
    elif grooming:
        kinds = [GROOMING.get(k.strip(), k.strip()) for k in re.split(r"[;+]", grooming) if k.strip()]
        bits.append("Groomed: " + " and ".join(kinds))
    if tags.get("piste:difficulty"):
        bits.append(f"Difficulty: {tags['piste:difficulty']}")
    return "\n".join(bits)


def grooming_of(tags: dict, area: dict | None = None) -> str:
    """'groomed', 'ungroomed', or 'unknown' — what the map's filter reads.
    An area's "grooming" setting overrides OSM."""
    if area and area.get("grooming"):
        return area["grooming"]
    if ungroomed(tags):
        return "ungroomed"
    return "groomed" if tags.get("piste:grooming") else "unknown"


def feature(title, lines, *, color, description, ways, width=DEFAULT_WIDTH, pattern="solid", grooming="unknown",
            ref=""):
    geometry = ({"type": "LineString", "coordinates": lines[0]} if len(lines) == 1
                else {"type": "MultiLineString", "coordinates": lines})
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "title": title,
            "description": description,
            "class": "Shape",
            "stroke": color_of(color),
            "stroke-width": width,
            "stroke-opacity": 1,
            "pattern": pattern,
            "grooming": grooming,
            # Agency trail/road number(s) — shown small at the foot of the popup.
            "ref": ref.replace(";", ", "),
            "source": "OpenStreetMap",
            "osm_ways": sorted(set(ways)),
        },
    }


# -- areas ------------------------------------------------------------------

def nearest_vertex(lines, point) -> set:
    """The vertex of a single line closest to [lng, lat], as a `points` set."""
    if len(lines) != 1:
        return set()
    return {tuple(min(lines[0], key=lambda c: haversine(c, point)))}


def bridge(lines, max_gap_m=100):
    """Join pieces whose ends are within `max_gap_m` (a short way lost in
    clipping, a tunnel) into one line, so a split can run along all of it."""
    lines = [list(l) for l in lines]
    while len(lines) > 1:
        best = None
        for i, a in enumerate(lines):
            for j, b in enumerate(lines):
                if i == j:
                    continue
                for ra, rb in ((False, False), (False, True), (True, False), (True, True)):
                    aa, bb = (a[::-1] if ra else a), (b[::-1] if rb else b)
                    gap = haversine(aa[-1], bb[0])
                    if gap <= max_gap_m and (best is None or gap < best[0]):
                        best = (gap, i, j, aa + bb)
        if not best:
            break
        _, i, j, joined = best
        lines = [l for k, l in enumerate(lines) if k not in (i, j)] + [joined]
    return lines


def split_line(lines, points, start: str):
    """Cut a single line where it last touches each set in `points` (shared
    OSM nodes; one set, or a list of them for several cuts), counting from
    its `start` end ("north", "south", "east", "west"). Returns the pieces in
    order from `start`, or None if it isn't one line or misses a cut."""
    if len(lines) != 1:
        return None
    cuts = points if isinstance(points, list) else [points]
    line = lines[0]
    axis, sign = {"east": (0, 1), "west": (0, -1), "north": (1, 1), "south": (1, -1)}[start]
    if (line[0][axis] - line[-1][axis]) * sign < 0:
        line = line[::-1]
    at = []
    for cut in cuts:
        hits = [i for i, c in enumerate(line) if tuple(c) in cut and 0 < i < len(line) - 1]
        if not hits:
            return None
        at.append(hits[-1])
    bounds = [0, *sorted(set(at)), len(line) - 1]
    return [line[a:b + 1] for a, b in zip(bounds, bounds[1:])]


def sync_area(area_name: str, polygons: list, area: dict, curated: set[str] = frozenset()) -> list[dict]:
    include = area.get("include", DEFAULT_INCLUDE)
    unknown = [k for k in include if k not in INCLUDE]
    if unknown:
        raise SystemExit(f"{area_name}: unknown include {unknown}; use {sorted(INCLUDE)}")

    parts = [q.replace("{poly}", poly_filter(p)) for p in polygons for k in include for q in INCLUDE[k]]
    # Fetch the matches, then the member ways of any matching relations.
    data = overpass(f"[out:json][timeout:120];({''.join(parts)})->.hits;"
                    ".hits out body geom;way(r.hits);out body geom;")
    ways = {e["id"]: e for e in data["elements"] if e["type"] == "way"}
    relations = [e for e in data["elements"] if e["type"] == "relation"]

    # A nordic route relation names its member ways ("Upper Loop"…).
    named_by = {}
    for r in relations:
        tags = r.get("tags", {})
        rname = tags.get("name") or tags.get("piste:name")
        for m in r.get("members", []):
            if m["type"] == "way" and rname:
                named_by.setdefault(m["ref"], (rname, tags))

    exclude = {name_key(n) for n in area.get("exclude", []) if isinstance(n, str)}
    exclude_ids = {n for n in area.get("exclude", []) if isinstance(n, int)}
    colors = {name_key(k): v for k, v in area.get("colors", {}).items()}
    notes = {name_key(k): v for k, v in area.get("notes", {}).items()}
    splits = {name_key(k): v for k, v in area.get("splits", {}).items()}

    groups: dict[str, dict] = {}
    skipped = skipped_short = 0
    seen = set()
    replaced = set()
    for wid, w in ways.items():
        if wid in exclude_ids or "geometry" not in w:
            continue
        tags = w.get("tags", {})
        name, rtags = named_by.get(wid, (None, {}))
        name = name or tags.get("piste:name") or tags.get("name")
        if not name:
            skipped += 1
            continue
        key = name_key(name)
        seen.add(key)
        if key in exclude:
            continue
        if key in curated:  # drawn in CalTopo: the hand-drawn version wins
            replaced.add(name)
            continue
        pieces = clip_way({"nodes": w["nodes"], "coords": way_coords(w)}, polygons)
        if not pieces:
            continue
        g = groups.setdefault(key, {"names": {}, "pieces": [], "ways": [], "tags": {}})
        g["names"][name] = g["names"].get(name, 0) + 1
        g["pieces"] += pieces
        g["ways"].append(wid)
        for k, v in {**tags, **rtags}.items():
            g["tags"].setdefault(k, v)

    features = []
    min_m = area.get("min_length_m", MIN_LENGTH_M)
    for key, g in sorted(groups.items()):
        # Most common spelling; on a tie, the one with an apostrophe.
        title = max(g["names"], key=lambda n: (g["names"][n], "'" in n))
        difficulty = PISTE_DIFFICULTY.get(g["tags"].get("piste:difficulty", ""))
        color = colors.get(key) or difficulty or area.get("color")
        lines = [c for c in stitch(g["pieces"]) if length_m(c) >= min_m]
        if not lines:
            skipped_short += 1
            continue
        description = "\n\n".join(t for t in (notes.get(key, ""), describe(g["tags"])) if t)
        sections = [(title, lines, color)]
        split = splits.get(key)
        if split:
            lines = bridge(lines)
            ats = split["at"] if isinstance(split["at"], list) and not isinstance(split["at"][0], (int, float)) \
                else [split["at"]]
            points = []
            for at in ats:
                if isinstance(at, list):
                    points.append(nearest_vertex(lines, at))
                else:
                    other = groups.get(name_key(at))
                    points.append({tuple(c) for p in (other or {}).get("pieces", []) for c in p["coords"]})
            cut = split_line(lines, points, split.get("from", "east")) if all(points) else None
            if cut:
                sections = [(f"{title}_{n}", [part], c) for n, (part, c) in enumerate(zip(cut, split["colors"]), 1)
                            if c != "drop"]
            else:
                print(f"  ! {area_name}: can't split {title} at {split['at']} — they don't meet")
        for section_title, section_lines, section_color in sections:
            f = feature(section_title, section_lines, color=section_color, description=description, ways=g["ways"],
                        # Dashed is reserved for "needs heavy recent snowfall".
                        pattern="dash" if area.get("needs_snow") else "solid",
                        grooming=grooming_of(g["tags"], area), ref=g["tags"].get("ref", ""))
            f["properties"]["area"] = area_name
            features.append(f)
        miles = sum(length_m(c) for c in lines) / 1609.344
        print(f"    {title}: {miles:.1f} mi ({len(g['ways'])} ways)")
    note = f", {skipped} unnamed ways skipped" if skipped else ""
    note += f", {skipped_short} slivers under {min_m} m dropped" if skipped_short else ""
    note += f", left to CalTopo: {', '.join(sorted(replaced))}" if replaced else ""
    unused = [n for n in area.get("exclude", []) if isinstance(n, str) and name_key(n) not in seen]
    if unused:
        print(f"  ! {area_name}: exclude entries matched nothing: {unused}")
    print(f"  ✓ {area_name}: {len(features)} trails{note}")
    return features


# -- explicit trails --------------------------------------------------------

def sync_trails(trails: list[dict], areas: dict | None = None) -> tuple[list[dict], int]:
    areas = areas or {}
    for t in trails:
        if not t.get("sections"):
            t["sections"] = [{k: t[k] for k in ("ways", "color", "description") if k in t}]
    ids = sorted({w for t in trails for s in t["sections"] for w in s.get("ways", [])})
    if not ids:
        return [], 0
    data = overpass(f"[out:json][timeout:90];way(id:{','.join(map(str, ids))});out body geom;")
    found = {e["id"]: e for e in data["elements"]}

    features, problems = [], 0
    for t in trails:
        total = 0.0
        for n, s in enumerate(t["sections"], 1):
            wanted = s.get("ways", [])
            missing = [w for w in wanted if w not in found]
            if missing:
                problems += 1
                print(f"  ✗ {t['name']}: way(s) not in OSM: {missing}")
            pieces = [{"nodes": found[w]["nodes"], "coords": way_coords(found[w])} for w in wanted if w in found]
            if not pieces:
                continue
            lines = stitch(pieces)
            if len(lines) > 1:
                print(f"  ! {t['name']} section {n}: {len(lines)} disconnected pieces — a way may be missing")
            total += sum(length_m(c) for c in lines)
            title = t["name"] if len(t["sections"]) == 1 else f"{t['name']}_{n}"
            area = areas.get(t.get("area"), {})
            tags = found[wanted[0]].get("tags", {}) if wanted and wanted[0] in found else {}
            f = feature(title, lines, color=s.get("color", t.get("color")),
                        description=s.get("description", t.get("description", "")), ways=wanted,
                        pattern="dash" if area.get("needs_snow") else "solid",
                        grooming=t.get("grooming") or grooming_of(tags, area), ref=tags.get("ref", ""))
            if t.get("area"):
                f["properties"]["area"] = t["area"]
            features.append(f)
        print(f"  ✓ {t['name']}: {len(t['sections'])} section(s), {total / 1609.344:.1f} mi")
    return features, problems


# -- main -------------------------------------------------------------------

def base_key(title: str) -> str:
    return name_key(re.sub(r"[\s_-]+\d+$", "", title))


def other_trail_names() -> set[str]:
    """Names already used by CalTopo lines, to warn about accidental merges."""
    names = set()
    for path in caltopo_files():
        for f in json.loads(path.read_text(encoding="utf-8")).get("features", []):
            if not (f.get("geometry") or {}).get("type", "").endswith("LineString"):
                continue
            names.add(base_key((f.get("properties") or {}).get("title") or ""))
    return names


def area_settings(config: dict) -> dict:
    return {name: {k: a[k] for k in ("grooming", "needs_snow") if k in a}
            for name, a in sorted(config.items()) if "grooming" in a or "needs_snow" in a}


def main() -> int:
    try:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise SystemExit(f"{MANIFEST.relative_to(ROOT)}: {err}")

    config = manifest.get("areas", {})
    areas = find_areas()
    for name in config:
        if name not in areas:
            print(f"! tools/osm-trails.json configures \"{name}\", but no CalTopo polygon has that title")
    curated = other_trail_names()
    features = []
    for name, polygons in areas.items():
        print(f"area: {name}")
        features += sync_area(name, polygons, config.get(name, {}), curated)
    trail_features, problems = sync_trails(manifest.get("trails", []), config)
    features += trail_features

    for f in trail_features:
        if base_key(f["properties"]["title"]) in curated:
            print(f"  ! \"{f['properties']['title']}\" is also a CalTopo trail — the map will show them as one.")

    OUTPUT.write_text(json.dumps({
        "type": "FeatureCollection",
        "attribution": "© OpenStreetMap contributors, ODbL",
        # Area-wide settings, so the app can apply them to CalTopo lines too.
        "areas": area_settings(config),
        "features": features,
    }, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(features)} trails)")
    print("next: python3 tools/index_trails.py, then review the diff and commit")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
