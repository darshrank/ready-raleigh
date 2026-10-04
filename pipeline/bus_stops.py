"""GoRaleigh bus stops from the agency's public GTFS feed (semantic zoom, S3).

Run from the repository root (standard library only, any Python 3.11+):

    python3 -m pipeline.bus_stops            # uses the cached feed if there is one
    python3 -m pipeline.bus_stops --refresh  # downloads the feed again

A full rebuild (pipeline.build_all) runs it last from the cache only (pipeline/detail.py).

Writes app/public/data/bus_stops.json as `[{id, name, lat, lon}]` (boarding stops only, 5 decimals)
and records the source URL, the dated file it resolved to, the feed version and the download date in
meta.json (`sources.busStops` and `busStops`). Stops come only from the feed; none are made up.
"""
import argparse
import csv
import io
import json
import os
import ssl
import urllib.request
import zipfile
from datetime import datetime, timezone

from .config import CACHE, DATA, MAX_FILE_BYTES

FEED_URL = "https://goraleigh.org/gr_gtfs"
FEED_ZIP = "goraleigh_gtfs.zip"
FEED_INFO = "goraleigh_gtfs.json"
USER_AGENT = "ready-raleigh-pipeline/1.0 (WolfHacks 2026)"
# Wake County with room to spare: a stop outside it means a broken row, not a real stop.
BOUNDS = {"lat": (35.4, 36.2), "lon": (-79.1, -78.2)}


def write_atomic(path, data: bytes):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def tls_context():
    """Certificate-checked TLS. python.org builds on macOS ship without CA certificates; fall back to
    the system bundle then (never to an unverified connection)."""
    context = ssl.create_default_context()
    if not context.get_ca_certs() and os.path.exists("/etc/ssl/cert.pem"):
        context = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    return context


class MissingCache(RuntimeError):
    """An offline build needs a download that is not in the cache."""


def download(cache_dir=CACHE, refresh=False, offline=False):
    """The feed zip in the cache, and where and when it came from."""
    zip_path, info_path = cache_dir / FEED_ZIP, cache_dir / FEED_INFO
    if zip_path.exists() and info_path.exists() and not refresh:
        return json.loads(info_path.read_text())
    if offline:
        raise MissingCache(f"{zip_path} is not cached; run `python3 -m pipeline.bus_stops` once with network.")
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120, context=tls_context()) as response:
        body = response.read()
        info = {
            "url": FEED_URL,
            "resolvedUrl": response.geturl(),
            "lastModified": response.headers.get("Last-Modified"),
            "downloaded": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    if not zipfile.is_zipfile(io.BytesIO(body)):
        raise SystemExit(f"{FEED_URL} did not return a zip ({len(body)} bytes); no stops written.")
    cache_dir.mkdir(parents=True, exist_ok=True)
    write_atomic(zip_path, body)
    write_atomic(info_path, json.dumps(info, indent=2).encode())
    return info


def rows(feed: zipfile.ZipFile, name):
    with feed.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def read_stops(feed: zipfile.ZipFile):
    """Boarding stops (location_type empty or 0) as {id, name, lat, lon}, sorted by id."""
    stops = []
    for row in rows(feed, "stops.txt"):
        if (row.get("location_type") or "0").strip() not in ("", "0"):
            continue
        stop = {
            "id": row["stop_id"].strip(),
            "name": row["stop_name"].strip(),
            "lat": round(float(row["stop_lat"]), 5),
            "lon": round(float(row["stop_lon"]), 5),
        }
        if not stop["id"] or not stop["name"]:
            raise ValueError(f"stop without an id or a name: {row}")
        if not (BOUNDS["lat"][0] <= stop["lat"] <= BOUNDS["lat"][1] and BOUNDS["lon"][0] <= stop["lon"] <= BOUNDS["lon"][1]):
            raise ValueError(f"stop {stop['id']} is outside Wake County: {stop['lat']}, {stop['lon']}")
        stops.append(stop)
    ids = [s["id"] for s in stops]
    if len(set(ids)) != len(ids):
        raise ValueError("stops.txt repeats a stop_id")
    stops.sort(key=lambda s: (len(s["id"]), s["id"]))
    return stops


def feed_info(feed: zipfile.ZipFile):
    if "feed_info.txt" not in feed.namelist():
        return {}
    first = rows(feed, "feed_info.txt")[:1]
    return {k: v.strip() for k, v in first[0].items()} if first else {}


def build(data_dir=DATA, cache_dir=CACHE, refresh=False, offline=False):
    """Write bus_stops.json and its meta.json entries into data_dir. offline: cache only."""
    source = download(cache_dir, refresh, offline)
    with zipfile.ZipFile(cache_dir / FEED_ZIP) as feed:
        stops = read_stops(feed)
        info = feed_info(feed)
    if not stops:
        raise SystemExit("The feed has no boarding stops; no file written.")

    out = data_dir / "bus_stops.json"
    body = json.dumps(stops, separators=(",", ":"), ensure_ascii=False).encode()
    if len(body) >= MAX_FILE_BYTES:
        raise SystemExit(f"bus_stops.json would be {len(body):,} bytes, over the {MAX_FILE_BYTES:,} budget.")
    write_atomic(out, body)

    meta_path = data_dir / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta.setdefault("sources", {})["busStops"] = FEED_URL
    meta["busStops"] = {
        **source,
        "agency": "GoRaleigh (City of Raleigh)",
        "feedVersion": info.get("feed_version"),
        "feedStart": info.get("feed_start_date"),
        "feedEnd": info.get("feed_end_date"),
        "file": "bus_stops.json",
        "count": len(stops),
        "note": "Boarding stops from stops.txt (location_type empty or 0): id, name, lat, lon only.",
    }
    # Same compact form as the rest of the pipeline (sources.write_json).
    write_atomic(meta_path, json.dumps(meta, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode())
    print(f"bus_stops.json: {len(stops):,} stops, {len(body):,} bytes (feed {info.get('feed_version')}, {source['resolvedUrl']})")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="download the feed again")
    build(refresh=parser.parse_args().refresh)


if __name__ == "__main__":
    main()
