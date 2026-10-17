#!/usr/bin/env python3
"""Turn GPX files into trail features.

Tracks and routes become trails, waypoints become places. Recorded tracks are
simplified on the way in, since a watch logs a point per second and a map only
needs a point every few metres.

    python3 tools/import_gpx.py recordings/*.gpx --merge
    python3 tools/import_gpx.py loop.gpx --name "Skyline Loop" --difficulty more-difficult

Without --merge it prints the FeatureCollection to stdout so you can inspect
(or pipe) it first.
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trailkit import (  # noqa: E402
    DATA_PATH, DIFFICULTIES, PLACE_DEFAULTS, REPO_ROOT, STATUSES, TECHNIQUES,
    TRAIL_DEFAULTS, length_m, load, miles, new_id, save, simplify,
)

# GPX 1.0 and 1.1 use different namespaces; strip them and match on local names.
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find_text(node, name: str) -> str:
    for child in node:
        if _local(child.tag) == name and child.text:
            return child.text.strip()
    return ""


def _children(node, name: str):
    return [c for c in node.iter() if _local(c.tag) == name]


def _points(nodes) -> list[list[float]]:
    out = []
    for pt in nodes:
        try:
            out.append([float(pt.get("lon")), float(pt.get("lat"))])
        except (TypeError, ValueError):
            continue
    return out


def parse_gpx(path: Path, tolerance_m: float, overrides: dict) -> list[dict]:
    root = ET.parse(path).getroot()
    features: list[dict] = []
    fallback_name = overrides.get("name") or path.stem.replace("_", " ").replace("-", " ").title()

    for trk in _children(root, "trk"):
        name = overrides.get("name") or _find_text(trk, "name") or fallback_name
        desc = _find_text(trk, "desc")
        for seg in _children(trk, "trkseg"):
            coords = simplify(_points(_children(seg, "trkpt")), tolerance_m)
            if len(coords) >= 2:
                features.append(_trail(coords, name, desc, overrides))

    for rte in _children(root, "rte"):
        coords = simplify(_points(_children(rte, "rtept")), tolerance_m)
        if len(coords) >= 2:
            name = overrides.get("name") or _find_text(rte, "name") or fallback_name
            features.append(_trail(coords, name, _find_text(rte, "desc"), overrides))

    for wpt in _children(root, "wpt"):
        pts = _points([wpt])
        if not pts:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": pts[0]},
            "properties": {
                **PLACE_DEFAULTS,
                "id": new_id(),
                "name": _find_text(wpt, "name"),
                "description": _find_text(wpt, "desc"),
            },
        })

    return features


def _trail(coords, name, description, overrides) -> dict:
    props = {**TRAIL_DEFAULTS, "id": new_id(), "name": name, "description": description}
    for key in ("difficulty", "technique", "status"):
        if overrides.get(key):
            props[key] = overrides[key]
    return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": props}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gpx", nargs="+", type=Path, help="one or more .gpx files")
    ap.add_argument("--merge", action="store_true", help=f"append into {DATA_PATH.relative_to(REPO_ROOT)}")
    ap.add_argument("--out", type=Path, default=DATA_PATH, help="target file for --merge")
    ap.add_argument("--tolerance", type=float, default=3.0, metavar="M",
                    help="simplification tolerance in metres (default: 3; use 0 to keep every point)")
    ap.add_argument("--name", help="override the trail name for every track in the file")
    ap.add_argument("--difficulty", choices=DIFFICULTIES)
    ap.add_argument("--technique", choices=TECHNIQUES)
    ap.add_argument("--status", choices=STATUSES)
    args = ap.parse_args()

    overrides = {k: getattr(args, k) for k in ("name", "difficulty", "technique", "status")}
    features: list[dict] = []
    for path in args.gpx:
        if not path.exists():
            print(f"! {path} not found", file=sys.stderr)
            continue
        found = parse_gpx(path, args.tolerance, overrides)
        total = sum(length_m(f) for f in found)
        print(f"{path.name}: {len(found)} feature(s), {miles(total):.2f} mi", file=sys.stderr)
        features.extend(found)

    if not features:
        print("Nothing to import.", file=sys.stderr)
        return 1

    if args.merge:
        fc = load(args.out)
        fc["features"].extend(features)
        save(fc, args.out)
        print(f"Merged {len(features)} feature(s) into {args.out}", file=sys.stderr)
    else:
        import json
        print(json.dumps({"type": "FeatureCollection", "features": features}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
