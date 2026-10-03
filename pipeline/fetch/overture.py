"""Overture Maps buildings (heights to fill gaps), bbox extract (DATA.md §2)."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

import geopandas as gpd
from overturemaps import core

from ..areas import Area
from ..cache import CACHE_DIR
from ..sources import Source

FOLDER = CACHE_DIR / "overture"
KEEP = ["id", "height", "num_floors", "is_underground", "geometry"]


def source(release: str, fetched_at: str) -> Source:
    return Source(
        id="overture",
        dataset=f"Overture Maps Foundation buildings, release {release}",
        url="https://docs.overturemaps.org/guides/buildings/",
        date=f"release {release}; fetched {fetched_at}",
        license="ODbL 1.0 (OSM-derived) / CDLA Permissive 2.0 — see Overture attribution",
        method="overturemaps-py bbox extract (GeoParquet on S3)",
    )


def fetch_buildings(area: Area) -> tuple[gpd.GeoDataFrame, str, str]:
    FOLDER.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(json.dumps(area.bbox).encode()).hexdigest()[:16]
    pq = FOLDER / f"building_{key}.parquet"
    meta = FOLDER / f"building_{key}.meta.json"
    if pq.exists() and meta.exists():
        m = json.loads(meta.read_text())
        return gpd.read_parquet(pq), m["release"], m["fetched_at"]
    release = core.get_latest_release()
    gdf = core.geodataframe("building", bbox=area.bbox, release=release)
    gdf = gdf[[c for c in KEEP if c in gdf.columns]].set_crs(4326, allow_override=True)
    gdf.to_parquet(pq)
    fetched_at = datetime.now(UTC).isoformat(timespec="seconds")
    meta.write_text(
        json.dumps(
            {"release": release, "bbox": area.bbox, "fetched_at": fetched_at, "rows": len(gdf)},
            indent=2,
        )
    )
    return gdf, release, fetched_at
