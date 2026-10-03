"""Location pack writers. Every pack file has pack_version, built_at and sources[] at the top."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import geopandas as gpd
import pandas as pd

from . import PACK_VERSION
from .sources import Source

OUT_DIR = Path(__file__).parent / "out"


def area_dir(area_id: str) -> Path:
    d = OUT_DIR / area_id
    (d / "work").mkdir(parents=True, exist_ok=True)
    return d


def header(sources: list[Source]) -> dict:
    return {
        "pack_version": PACK_VERSION,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "sources": [s.to_dict() for s in sources],
    }


def _clean(v):
    if v is None or v is pd.NA:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if hasattr(v, "item"):  # numpy scalar
        return v.item()
    return v


def write_json(path: Path, sources: list[Source], body: dict) -> Path:
    path.write_text(json.dumps({**header(sources), **body}, separators=(",", ":"), default=_clean))
    return path


def write_building_tiles(
    gdf: gpd.GeoDataFrame, props: list[str], out: Path, sources: list[Source]
) -> tuple[Path, str]:
    """buildings.pmtiles via tippecanoe; falls back to GeoJSON if tippecanoe is missing."""
    work = out.parent / "work"
    seq = work / "buildings.geojsonl"
    with seq.open("w") as f:
        for row in gdf[[*props, "geometry"]].itertuples(index=False):
            d = row._asdict()
            geom = d.pop("geometry")
            p = {k: _clean(v) for k, v in d.items()}
            p = {k: v for k, v in p.items() if v is not None}
            f.write(
                json.dumps({"type": "Feature", "properties": p, "geometry": geom.__geo_interface__})
                + "\n"
            )
    meta = out.parent / "buildings.meta.json"
    write_json(meta, sources, {"layer": "buildings", "count": len(gdf), "properties": props})
    if not shutil.which("tippecanoe"):
        target = out.with_suffix(".geojsonl")
        shutil.copy(seq, target)
        return target, "geojsonl (tippecanoe not installed)"
    attribution = " · ".join(s.dataset for s in sources)
    subprocess.run(
        [
            "tippecanoe", "-o", str(out), "--force", "--quiet",
            "-l", "buildings", "-Z", "12", "-z", "16",
            "--no-feature-limit", "--no-tile-size-limit", "--no-simplification-of-shared-nodes",
            "--detect-shared-borders", "-n", "Ready Raleigh buildings",
            "--attribution", attribution, str(seq),
        ],
        check=True,
    )  # fmt: skip
    return out, "pmtiles"
