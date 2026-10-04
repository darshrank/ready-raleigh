"""Nursing homes and assisted living from OpenStreetMap (semantic zoom, F3).

The map's places come from the vector tiles, but OpenMapTiles drops `amenity=social_facility`, so
the tiles hold one care home in all of Raleigh. This reads them from OSM instead.

Run from the repository root (standard library only, any Python 3.11+):

    python3 -m pipeline.care_homes            # uses the cached Overpass answer if there is one
    python3 -m pipeline.care_homes --refresh  # asks Overpass again

A full rebuild (pipeline.build_all) runs it last from the cache only (pipeline/detail.py).
Writes app/public/data/care_homes.json as `[{id, name, kind, lat, lon}]` (kind `nursing_home` or
`assisted_living`, name null when OSM has none, 5 decimals) and records the source in meta.json.
"""
import argparse
import json
import math
import os
from datetime import datetime, timezone

from .config import CACHE, DATA, MAX_FILE_BYTES
from .site_buildings import overpass

CARE_CACHE = "care_homes_overpass.json"
# The study area's extent (every cell's corners in cells.json), rounded outward.
BBOX = (35.69, -78.84, 35.99, -78.45)  # south, west, north, east
QUERY = (
    "[out:json][timeout:120][bbox:{},{},{},{}];(".format(*BBOX)
    + 'nwr["amenity"="social_facility"]["social_facility"~"^(nursing_home|assisted_living)$"];'
    + 'nwr["amenity"="nursing_home"];'
    + ");out tags center;"
)
# The same name this close (meters) is one place mapped twice (a node and a building, say).
SAME_PLACE_M = 150


def read_homes(elements):
    """Care homes from Overpass elements: kind, name, a point; repeats of one place dropped."""
    homes = []
    for e in elements:
        tags = e.get("tags", {})
        kind = tags.get("social_facility") if tags.get("amenity") == "social_facility" else "nursing_home"
        if kind not in ("nursing_home", "assisted_living"):
            continue
        lat, lon = (e["lat"], e["lon"]) if e["type"] == "node" else (e["center"]["lat"], e["center"]["lon"])
        homes.append({"id": f"osm-{e['type']}-{e['id']}", "name": tags.get("name") or None, "kind": kind, "lat": round(lat, 5), "lon": round(lon, 5)})
    homes.sort(key=lambda h: (h["id"].split("-")[1] != "way", h["id"]))  # keep a building over a node

    def near(a, b):
        kx = 111_320 * math.cos(math.radians(a["lat"]))
        return math.hypot((a["lon"] - b["lon"]) * kx, (a["lat"] - b["lat"]) * 111_320) < SAME_PLACE_M

    kept = []
    for h in homes:
        if not any(h["name"] and h["name"] == k["name"] and near(h, k) for k in kept):
            kept.append(h)
    return sorted(kept, key=lambda h: h["id"])


def build(data_dir=DATA, cache_dir=CACHE, refresh=False, offline=False):
    """Write care_homes.json and its meta.json entries into data_dir. offline: cache only."""
    cache = cache_dir / CARE_CACHE
    homes = read_homes(overpass(QUERY, cache, refresh, offline, script="pipeline.care_homes")["elements"])
    body = json.dumps(homes, separators=(",", ":"), ensure_ascii=False).encode()
    if len(body) >= MAX_FILE_BYTES:
        raise SystemExit(f"care_homes.json would be {len(body):,} bytes, over the {MAX_FILE_BYTES:,} budget.")
    out = data_dir / "care_homes.json"
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(body)
    os.replace(tmp, out)

    by_kind = {}
    for h in homes:
        by_kind[h["kind"]] = by_kind.get(h["kind"], 0) + 1
    meta_path = data_dir / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta.setdefault("sources", {})["careHomes"] = "https://www.openstreetmap.org/copyright"
    meta["careHomes"] = {
        "source": "OpenStreetMap via the Overpass API: amenity=social_facility with social_facility=nursing_home|assisted_living, and amenity=nursing_home",
        "osmFetched": datetime.fromtimestamp(cache.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
        "bbox": list(BBOX),
        "file": "care_homes.json",
        "count": len(homes),
        "byKind": by_kind,
    }
    tmp = meta_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    os.replace(tmp, meta_path)
    print(f"care_homes.json: {len(homes)} places ({', '.join(f'{k} {v}' for k, v in sorted(by_kind.items()))}), {len(body):,} bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="ask Overpass again")
    build(refresh=parser.parse_args().refresh)


if __name__ == "__main__":
    main()
