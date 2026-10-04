"""Existing bus stops for the bus pickup demand report (python -m pipeline.transit).

Downloads the official GTFS feeds linked from GoRaleigh's developer page, keeps the boardable stops
inside the study area, and writes transit_stops.json next to the other game data. Standard library
only, so it runs without the pipeline's virtual environment.

The study area box comes from sites.json (one candidate site per H3 resolution 8 cell across the
study area), padded about 2 km, so it needs no H3 library.
"""
from __future__ import annotations

import csv
import io
import json
import urllib.request
import zipfile
from datetime import date, datetime, timezone

from .config import CACHE, DATA

# Official feeds, as linked from https://www.goraleigh.org/developer-resources (checked 2026-10-03).
# GoRaleigh's link (Trillium, "capital-area-transit") is its January 2024 feed, valid to 2024-03-31;
# no newer static GoRaleigh feed is published there, so the report says how old it is.
FEEDS = [
    ("GoRaleigh", "http://data.trilliumtransit.com/gtfs/capital-area-transit-nc-us/capital-area-transit-nc-us.zip"),
    ("GoTriangle", "https://gotriangle.org/gtfs"),
]
PAD_DEG = 0.02
USER_AGENT = "ReadyRaleigh/0.1 (WolfHacks 2026; github.com/darshrank/ready-raleigh)"


def download(agency: str, url: str) -> bytes:
    path = CACHE / "transit" / f"{agency.lower()}.zip"
    if path.exists():
        return path.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return body


def read_csv(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    if name not in archive.namelist():
        return []
    with archive.open(name) as raw:
        return list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")))


def gtfs_date(value: str | None) -> str | None:
    return f"{value[:4]}-{value[4:6]}-{value[6:8]}" if value and len(value) == 8 else None


def study_box() -> tuple[float, float, float, float]:
    sites = json.loads((DATA / "sites.json").read_text(encoding="utf-8"))
    lons = [s["lon"] for s in sites]
    lats = [s["lat"] for s in sites]
    return min(lons) - PAD_DEG, min(lats) - PAD_DEG, max(lons) + PAD_DEG, max(lats) + PAD_DEG


def main() -> None:
    west, south, east, north = study_box()
    sources, stops = [], []
    for k, (agency, url) in enumerate(FEEDS):
        archive = zipfile.ZipFile(io.BytesIO(download(agency, url)))
        info = (read_csv(archive, "feed_info.txt") or [{}])[0]
        end = gtfs_date(info.get("feed_end_date"))
        kept = 0
        for row in read_csv(archive, "stops.txt"):
            if row.get("location_type", "") not in ("", "0"):
                continue  # stations, entrances and nodes are not places to board
            lon, lat = float(row["stop_lon"]), float(row["stop_lat"])
            if not (west <= lon <= east and south <= lat <= north):
                continue
            stops.append([round(lon, 5), round(lat, 5), row["stop_name"].strip(), k])
            kept += 1
        sources.append({
            "agency": agency,
            "url": url,
            "feedStart": gtfs_date(info.get("feed_start_date")),
            "feedEnd": end,
            "expired": bool(end and end < date.today().isoformat()),
            "stops": kept,
        })
        print(f"{agency}: {kept} stops in the study area, feed {sources[-1]['feedStart']} to {end}")
    out = {
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "bbox": [round(v, 5) for v in (west, south, east, north)],
        "sources": sources,
        "stops": stops,
    }
    path = DATA / "transit_stops.json"
    path.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
