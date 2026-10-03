"""Stage scenarios on top of HAND (DATA.md §3.1): gauge stage -> WSE grid, wet polygons,
per-building water elevation."""

from __future__ import annotations

from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import rasterio
import shapely
from rasterio import features
from shapely.geometry import box, shape

from . import hand as H

M_PER_FT = 0.3048
STAGE_STEP_FT = 0.5
MIN_POLY_M2 = 50.0


@dataclass
class Gauge:
    lid: str
    datum_ft: float  # NAVD88 elevation of gauge zero
    x: float
    y: float
    reach: int
    channel_m: float  # HAND channel elevation at the gauge
    categories: dict[str, float]  # action/minor/moderate/major stage ft
    record_stage_ft: float

    def depth_m(self, stage_ft: float) -> float:
        """Depth above the HAND channel at the gauge for a gauge stage."""
        return max((self.datum_ft + stage_ft) * M_PER_FT - self.channel_m, 0.0)

    def category(self, stage_ft: float) -> str:
        cat = "none"
        for name in ("action", "minor", "moderate", "major"):
            if stage_ft >= self.categories.get(name, np.inf):
                cat = name
        return cat


def stage_list(gauge: Gauge, extra: tuple[float, ...] = ()) -> list[float]:
    """0.5 ft steps up to record + 2 ft, plus exact scenario stages (1%, historic crests)."""
    top = gauge.record_stage_ft + 2.0
    n = int(np.floor(top / STAGE_STEP_FT)) + 1
    return sorted({round(i * STAGE_STEP_FT, 2) for i in range(n)} | {round(e, 2) for e in extra})


class Scenario:
    """Precomputed HAND state; evaluate any gauge stage cheaply."""

    def __init__(self, res: H.HandResult, dem: np.ndarray, gauge: Gauge):
        self.res, self.dem, self.gauge = res, dem, gauge
        # Effective ground: cells below the channel they drain to (storm-drain inlets, breached
        # pits) sit at channel level, consistent with HAND being clamped at 0.
        self.ground = np.fmax(dem, res.channel).astype("float32")
        self.ratio = H.reach_ratio(res, gauge.reach)
        self.ends = H.reach_endpoints_channel(res)

    def wse(self, stage_ft: float) -> np.ndarray:
        d = self.gauge.depth_m(stage_ft)
        floor, base = H.backwater_floor(self.res, self.ratio, d, self.ends, with_base=True)
        return H.wse_grid(self.res, self.ratio, d, floor, base, self.dem)

    def wet(self, stage_ft: float) -> np.ndarray:
        if self.gauge.depth_m(stage_ft) <= 0:
            return np.zeros(self.dem.shape, bool)
        return (self.wse(stage_ft) > self.ground) & ~np.isnan(self.dem)


def play_window(transform, shape_, bbox_utm) -> tuple[slice, slice]:
    xmin, ymin, xmax, ymax = bbox_utm
    r0, c0 = rasterio.transform.rowcol(transform, xmin, ymax)
    r1, c1 = rasterio.transform.rowcol(transform, xmax, ymin)
    return slice(max(r0, 0), min(r1 + 1, shape_[0])), slice(max(c0, 0), min(c1 + 1, shape_[1]))


def polygons(wet: np.ndarray, transform, crs, clip_utm) -> gpd.GeoDataFrame:
    geoms = [
        shape(g)
        for g, v in features.shapes(wet.astype("uint8"), mask=wet, transform=transform)
        if v == 1
    ]
    if not geoms:
        return gpd.GeoDataFrame(geometry=[], crs=crs).to_crs(4326)
    gdf = gpd.GeoDataFrame(geometry=geoms, crs=crs)
    gdf = gdf[gdf.area >= MIN_POLY_M2]
    gdf["geometry"] = gdf.geometry.simplify(3.0).buffer(0)  # 3 m = one DEM cell
    gdf = gdf.clip(box(*clip_utm))
    merged = gdf.union_all()
    out = gpd.GeoDataFrame(geometry=[merged], crs=crs).to_crs(4326)
    out["geometry"] = shapely.set_precision(out.geometry.values, 1e-6)  # ~0.1 m; halves file size
    return out


def building_cells(buildings: gpd.GeoDataFrame, res: H.HandResult) -> np.ndarray:
    """Flat raster index of each building's lowest-HAND cell (water reaches it first)."""
    utm = buildings.to_crs(res.crs)
    shp = res.hand.shape
    ids = features.rasterize(
        ((g, i + 1) for i, g in enumerate(utm.geometry)),
        out_shape=shp, transform=res.transform, fill=0, dtype="int32",
    )  # fmt: skip
    flat_ids = ids.ravel()
    hand = np.nan_to_num(res.hand.ravel(), nan=1e9)
    order = np.lexsort((hand, flat_ids))  # by building, then HAND ascending
    sorted_ids = flat_ids[order]
    first = np.unique(sorted_ids, return_index=True)
    best = np.full(len(utm), -1, dtype=np.int64)
    for bid, pos in zip(*first, strict=True):
        if bid > 0:
            best[bid - 1] = order[pos]
    # Footprints smaller than a cell: use the representative point's cell.
    miss = np.nonzero(best < 0)[0]
    if len(miss):
        pts = utm.geometry.iloc[miss].representative_point()
        rr, cc = rasterio.transform.rowcol(res.transform, pts.x.values, pts.y.values)
        rr, cc = np.clip(rr, 0, shp[0] - 1), np.clip(cc, 0, shp[1] - 1)
        best[miss] = np.ravel_multi_index((rr, cc), shp)
    return best
