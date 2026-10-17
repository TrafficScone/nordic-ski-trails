#!/usr/bin/env python3
"""Write public/trails/index.json, the list of trail files the map loads.

A static site can't list a folder, so the map reads this index instead.
Drop CalTopo GeoJSON exports into public/trails/ and run:

    python3 tools/index_trails.py

Netlify runs it on every deploy too, so a forgotten run only affects local
previews. Standard library only.
"""

import json
import sys
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent / "public"
TRAILS_DIR = SITE_DIR / "trails"
INDEX = TRAILS_DIR / "index.json"


def main() -> int:
    files = []
    for path in sorted(TRAILS_DIR.iterdir()):
        if path.suffix not in (".geojson", ".json") or path == INDEX:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            print(f"  ✗ {path.name}: not valid JSON ({err})", file=sys.stderr)
            return 1
        if data.get("type") != "FeatureCollection":
            print(f"  ✗ {path.name}: not a GeoJSON FeatureCollection", file=sys.stderr)
            return 1
        files.append(path.name)
        print(f"  ✓ {path.name} ({len(data.get('features', []))} features)")

    INDEX.write_text(json.dumps(files, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {INDEX.relative_to(SITE_DIR.parent)} ({len(files)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
