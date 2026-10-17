#!/usr/bin/env python3
"""Summarise and sanity-check the published trail data.

    python3 tools/trail_report.py
    python3 tools/trail_report.py --km --file data/trails.geojson

Exits non-zero if it finds problems, so it also works as a pre-deploy check.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trailkit import (  # noqa: E402
    DATA_PATH, DIFFICULTIES, PLACE_TYPES, STATUSES, TECHNIQUES,
    bbox, km, length_m, load, miles,
)

LABELS = {
    "easiest": "Easiest",
    "more-difficult": "More difficult",
    "most-difficult": "Most difficult",
    "expert": "Expert",
    "unrated": "Unrated",
}


def validate(fc: dict) -> list[str]:
    problems: list[str] = []
    seen_ids: Counter[str] = Counter()

    for i, f in enumerate(fc.get("features", [])):
        where = f.get("properties", {}).get("name") or f"feature #{i}"
        props = f.get("properties") or {}
        geom = f.get("geometry") or {}

        seen_ids[props.get("id", "")] += 1
        if not props.get("id"):
            problems.append(f"{where}: missing id")
        if not props.get("name"):
            problems.append(f"{where}: no name — it will show as 'Untitled'")

        if geom.get("type") == "LineString":
            if len(geom.get("coordinates") or []) < 2:
                problems.append(f"{where}: line has fewer than 2 points")
            for field, allowed in (("difficulty", DIFFICULTIES), ("technique", TECHNIQUES), ("status", STATUSES)):
                value = props.get(field)
                if value and value not in allowed:
                    problems.append(f"{where}: {field}={value!r} is not one of {allowed}")
        elif geom.get("type") == "Point":
            if props.get("placeType") and props["placeType"] not in PLACE_TYPES:
                problems.append(f"{where}: placeType={props['placeType']!r} is not one of {PLACE_TYPES}")
        else:
            problems.append(f"{where}: unsupported geometry {geom.get('type')!r}")

    for fid, count in seen_ids.items():
        if fid and count > 1:
            problems.append(f"id {fid} used by {count} features")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", type=Path, default=DATA_PATH)
    ap.add_argument("--km", action="store_true", help="report in kilometres instead of miles")
    args = ap.parse_args()

    fc = load(args.file)
    features = fc.get("features", [])
    trails = [f for f in features if (f.get("geometry") or {}).get("type") == "LineString"]
    places = [f for f in features if (f.get("geometry") or {}).get("type") == "Point"]

    unit = "km" if args.km else "mi"
    convert = km if args.km else miles

    print(f"{args.file}")
    print(f"  {len(trails)} trails · {len(places)} places")
    if not features:
        print("  (empty — draw some trails in the app and export)")
        return 0

    total = sum(length_m(f) for f in trails)
    print(f"  {convert(total):.1f} {unit} total")

    by_difficulty: dict[str, float] = defaultdict(float)
    counts: Counter[str] = Counter()
    for f in trails:
        d = f["properties"].get("difficulty", "unrated")
        by_difficulty[d] += length_m(f)
        counts[d] += 1

    print("\n  By difficulty")
    for d in DIFFICULTIES:
        if counts[d]:
            print(f"    {LABELS.get(d, d):<16} {counts[d]:>3} trails  {convert(by_difficulty[d]):>7.1f} {unit}")

    by_status = Counter(f["properties"].get("status", "unknown") for f in trails)
    if set(by_status) - {"open"}:
        print("\n  By status")
        for status, n in by_status.most_common():
            print(f"    {status:<16} {n:>3}")

    if places:
        print("\n  Places")
        for kind, n in Counter(f["properties"].get("placeType", "other") for f in places).most_common():
            print(f"    {kind:<16} {n:>3}")

    longest = sorted(trails, key=length_m, reverse=True)[:5]
    if longest:
        print("\n  Longest")
        for f in longest:
            print(f"    {convert(length_m(f)):>6.2f} {unit}  {f['properties'].get('name') or '(untitled)'}")

    box = bbox(fc)
    if box:
        print(f"\n  Extent  W {box[0]:.4f}  S {box[1]:.4f}  E {box[2]:.4f}  N {box[3]:.4f}")
        print(f"  Centre  [{(box[0] + box[2]) / 2:.4f}, {(box[1] + box[3]) / 2:.4f}]  "
              f"← paste into DEFAULT_VIEW in js/config.js")

    problems = validate(fc)
    if problems:
        print(f"\n  {len(problems)} problem(s):")
        for p in problems:
            print(f"    ! {p}")
        return 1

    print("\n  No problems found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
