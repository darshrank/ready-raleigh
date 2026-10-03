"""Mapillary API v4 street photos (DATA.md §2). Verified 2026-10-03: small bbox queries work
(fields id, thumb_1024_url, computed_geometry, captured_at, creator); a bbox the size of the whole
area returns HTTP 500, so we query ~300 m boxes per round. Thumbnails are downloaded into the
pack so no live call can block a round (thumb URLs are signed and expire)."""

from __future__ import annotations

import math
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

from ..cache import FetchError, fetch

API = "https://graph.mapillary.com/images"
LICENSE = "CC BY-SA 4.0"


def nearest_photo(lon: float, lat: float, out_dir: Path, radius_deg: float = 0.0015) -> dict | None:
    token = os.environ.get("MAPILLARY_TOKEN", "").strip()
    if not token:
        return None
    bbox = f"{lon - radius_deg},{lat - radius_deg},{lon + radius_deg},{lat + radius_deg}"
    try:
        res = fetch(
            "mapillary",
            API,
            params={
                "bbox": bbox,
                "fields": "id,thumb_1024_url,computed_geometry,captured_at,creator,is_pano",
                "limit": 50,
                "access_token": token,
            },
            suffix=".json",
        )
    except FetchError:
        return None
    imgs = [
        i for i in res.json().get("data", []) if i.get("computed_geometry") and not i.get("is_pano")
    ]
    if not imgs:
        return None

    def dist(i):
        x, y = i["computed_geometry"]["coordinates"]
        return math.hypot((x - lon) * 90000, (y - lat) * 111000)

    best = min(imgs, key=lambda i: (dist(i) // 40, -i["captured_at"]))  # near first, then newest
    try:  # signed URL (expires); cached by full URL, so reruns work offline
        img = fetch("mapillary_img", best["thumb_1024_url"], suffix=".jpg")
    except FetchError:
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"{best['id']}.jpg"
    shutil.copy(img.path, dst)
    x, y = best["computed_geometry"]["coordinates"]
    return {
        "id": best["id"],
        "file": f"photos/{best['id']}.jpg",
        "lon": round(x, 6),
        "lat": round(y, 6),
        "distance_m": round(dist(best)),
        "captured_at": datetime.fromtimestamp(best["captured_at"] / 1000, UTC).date().isoformat(),
        "creator": (best.get("creator") or {}).get("username"),
        "license": LICENSE,
        "url": f"https://www.mapillary.com/app/?pKey={best['id']}",
    }
