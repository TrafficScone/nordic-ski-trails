"""Shared helpers for the trail data in ``public/data/trails.geojson``.

Standard library only — no pip install needed. Import this from your own
scripts when you want to do something to the trail data in Python:

    from trailkit import load, save, length_m, miles
"""

from __future__ import annotations

import json
import math
import uuid
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = REPO_ROOT / "public"          # what Netlify deploys
DATA_PATH = SITE_DIR / "data" / "trails.geojson"

EARTH_RADIUS_M = 6371008.8
M_PER_MILE = 1609.344

TRAIL_DEFAULTS: dict[str, Any] = {
    "kind": "trail",
    "name": "",
    "difficulty": "unrated",
    "technique": "both",
    "status": "open",
    "oneway": False,
    "lit": False,
    "dogs": False,
    "description": "",
}

PLACE_DEFAULTS: dict[str, Any] = {
    "kind": "place",
    "name": "",
    "placeType": "trailhead",
    "description": "",
}

DIFFICULTIES = ["easiest", "more-difficult", "most-difficult", "expert", "unrated"]
TECHNIQUES = ["both", "classic", "skate", "ungroomed"]
STATUSES = ["open", "grooming", "closed", "unknown"]
PLACE_TYPES = [
    "trailhead", "parking", "warming-hut", "lodge", "restroom",
    "water", "junction", "viewpoint", "hazard", "sign", "other",
]


# -- io ---------------------------------------------------------------------

def load(path: Path | str = DATA_PATH) -> dict[str, Any]:
    """Read a FeatureCollection, returning an empty one if the file is blank."""
    path = Path(path)
    if not path.exists() or not path.read_text().strip():
        return {"type": "FeatureCollection", "features": []}
    data = json.loads(path.read_text())
    data.setdefault("features", [])
    return data


def save(fc: dict[str, Any], path: Path | str = DATA_PATH) -> Path:
    """Write a FeatureCollection with stable, diff-friendly formatting."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fc, indent=2, ensure_ascii=False) + "\n")
    return path


def new_id() -> str:
    return str(uuid.uuid4())


def with_defaults(feature: dict[str, Any]) -> dict[str, Any]:
    """Fill in missing properties so a feature renders correctly in the app."""
    geom_type = (feature.get("geometry") or {}).get("type")
    defaults = PLACE_DEFAULTS if geom_type == "Point" else TRAIL_DEFAULTS
    props = {**defaults, **(feature.get("properties") or {})}
    props.setdefault("id", new_id())
    props["kind"] = "place" if geom_type == "Point" else "trail"
    feature["properties"] = props
    return feature


# -- geometry ---------------------------------------------------------------

def haversine(a: Iterable[float], b: Iterable[float]) -> float:
    """Distance in metres between two ``[lng, lat]`` positions."""
    lng1, lat1 = a[0], a[1]
    lng2, lat2 = b[0], b[1]
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def length_m(feature: dict[str, Any]) -> float:
    """Length of a LineString feature in metres (0 for points)."""
    geom = feature.get("geometry") or {}
    if geom.get("type") != "LineString":
        return 0.0
    coords = geom.get("coordinates") or []
    return sum(haversine(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def miles(metres: float) -> float:
    return metres / M_PER_MILE


def km(metres: float) -> float:
    return metres / 1000.0


def simplify(coords: list[list[float]], tolerance_m: float = 3.0) -> list[list[float]]:
    """Ramer-Douglas-Peucker. Recorded GPX tracks carry far more points than a
    map needs; this trims them without visibly changing the line."""
    if len(coords) < 3:
        return list(coords)
    tol = tolerance_m / 111_320.0  # degrees, near enough at trail scale
    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        lo, hi = stack.pop()
        far, best = -1, tol
        for i in range(lo + 1, hi):
            d = _perp_distance(coords[i], coords[lo], coords[hi])
            if d > best:
                far, best = i, d
        if far > 0:
            keep[far] = True
            stack.append((lo, far))
            stack.append((far, hi))
    return [c for c, k in zip(coords, keep) if k]


def _perp_distance(p, a, b) -> float:
    x, y = a[0], a[1]
    dx, dy = b[0] - x, b[1] - y
    if dx or dy:
        t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)
        if t > 1:
            return math.hypot(p[0] - b[0], p[1] - b[1])
        if t > 0:
            x, y = x + dx * t, y + dy * t
    return math.hypot(p[0] - x, p[1] - y)


def bbox(fc: dict[str, Any]) -> tuple[float, float, float, float] | None:
    """[west, south, east, north] over every feature, or None when empty."""
    xs: list[float] = []
    ys: list[float] = []

    def visit(node):
        if isinstance(node, (int, float)):
            return
        if node and isinstance(node[0], (int, float)):
            xs.append(node[0])
            ys.append(node[1])
        else:
            for child in node:
                visit(child)

    for f in fc.get("features", []):
        geom = f.get("geometry") or {}
        if geom.get("coordinates"):
            visit(geom["coordinates"])
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None
