"""Area definitions (pipeline/areas/*.yaml, DATA.md §1)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

AREAS_DIR = Path(__file__).parent / "areas"


@dataclass(frozen=True)
class Area:
    id: str
    name: str
    bbox: tuple[float, float, float, float]  # lon_min, lat_min, lon_max, lat_max (EPSG:4326)
    county_fips: str
    nwps_gauges: list[str] = field(default_factory=list)
    usgs_sites: list[str] = field(default_factory=list)
    storm_events: list[int] = field(default_factory=list)
    seed: int = 1  # RNG seed for synthetic residents (reproducible builds)
    gauge_stream: str = ""  # NHD gnis_name of the stream the primary gauge is on

    def __post_init__(self) -> None:
        lon_min, lat_min, lon_max, lat_max = self.bbox
        if not (-180 <= lon_min < lon_max <= 180 and -90 <= lat_min < lat_max <= 90):
            raise ValueError(f"{self.id}: bbox must be [lon_min, lat_min, lon_max, lat_max]")
        if len(self.county_fips) != 5 or not self.county_fips.isdigit():
            raise ValueError(f"{self.id}: county_fips must be a 5-digit string")


def list_areas() -> list[str]:
    return sorted(p.stem for p in AREAS_DIR.glob("*.yaml"))


def load_area(area_id: str) -> Area:
    path = AREAS_DIR / f"{area_id}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Unknown area '{area_id}'. Known: {', '.join(list_areas())}")
    raw = yaml.safe_load(path.read_text())
    raw["bbox"] = tuple(float(v) for v in raw["bbox"])
    raw["county_fips"] = str(raw["county_fips"])
    return Area(**{k: (v if v is not None else []) for k, v in raw.items()})
