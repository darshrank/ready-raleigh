"""HAND inundation (DATA.md §3.1), WhiteboxTools for hydro-conditioning.

1. Burn NHDPlus HR flowlines 5 m into the DEM (so flow follows mapped streams), breach
   depressions (least-cost, fill remainder), D8 pointer.
2. Every stream cell is a pour point; `Watershed` labels each cell with the stream cell it drains
   to. HAND = DEM(cell) − channel elevation of that stream cell, where channel elevation is the
   minimum *unburned* DEM within 2 cells of the mapped line (NHD lines are offset from the 2003
   lidar channel by a few metres).
3. Scenario depth: the gauge's stage → water-surface elevation (stage + NWPS datum, NAVD88),
   depth above channel at the gauge d_g = WSE − channel elevation there. Each reach's depth is
   d = d_g × (A_reach / A_gauge)^0.3 (hydraulic geometry: depth ∝ Q^0.4, Q ∝ A^0.75).
   A cell is wet when HAND < d of the reach it drains to.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio import features
from scipy import ndimage

BURN_M = 5.0
CHANNEL_SEARCH_CELLS = 2
DEPTH_AREA_EXP = 0.3
M_PER_FT = 0.3048


@dataclass
class HandResult:
    hand: np.ndarray  # metres, NaN outside DEM
    reach: np.ndarray  # int32 reach index (0 = none) each cell drains to
    channel: np.ndarray  # channel elevation (m) of the stream cell each cell drains to
    transform: rasterio.Affine
    crs: str
    reaches: gpd.GeoDataFrame  # index 1..N, with totdasqkm, gnis_name, nhdplusid


def _wbt(work: Path):
    import whitebox

    wbt = whitebox.WhiteboxTools()
    wbt.set_working_dir(str(work.resolve()))
    wbt.set_verbose_mode(False)
    return wbt


def _run(wbt, tool: str, *args, **kwargs) -> None:
    msgs: list[str] = []
    code = getattr(wbt, tool)(*args, callback=msgs.append, **kwargs)
    if code != 0:
        raise RuntimeError(f"WhiteboxTools {tool} failed ({code}): {' | '.join(msgs[-5:])}")


def compute_hand(dem_path: Path, flowlines: gpd.GeoDataFrame, work: Path) -> HandResult:
    with rasterio.open(dem_path) as src:
        dem = src.read(1)
        profile = src.profile
        transform, crs = src.transform, src.crs

    fl = flowlines.to_crs(crs).sort_values("totdasqkm").reset_index(drop=True)
    fl.index = fl.index + 1  # reach ids 1..N; larger streams burned last so they win at confluences
    reach_r = features.rasterize(
        ((g, i) for i, g in zip(fl.index, fl.geometry, strict=True)),
        out_shape=dem.shape, transform=transform, fill=0, dtype="int32", all_touched=True,
    )  # fmt: skip
    stream = reach_r > 0

    burned = np.where(stream, dem - BURN_M, dem).astype("float32")
    p = dict(profile, dtype="float32", nodata=-9999.0, compress="deflate")
    with rasterio.open(work / "dem_burned.tif", "w", **p) as dst:
        dst.write(np.nan_to_num(burned, nan=-9999.0), 1)

    # Pour points: every stream cell gets a unique id.
    rows, cols = np.nonzero(stream)
    ids = np.zeros(dem.shape, dtype="int32")
    ids[rows, cols] = np.arange(1, len(rows) + 1, dtype="int32")
    pi = dict(profile, dtype="int32", nodata=0, compress="deflate")
    with rasterio.open(work / "pour_ids.tif", "w", **pi) as dst:
        dst.write(ids, 1)

    wbt = _wbt(work)
    _run(
        wbt,
        "breach_depressions_least_cost",
        "dem_burned.tif",
        "dem_breached.tif",
        dist=200,
        fill=True,
    )
    _run(wbt, "d8_pointer", "dem_breached.tif", "d8.tif")
    _run(wbt, "watershed", "d8.tif", "pour_ids.tif", "drains_to.tif")
    with rasterio.open(work / "drains_to.tif") as src:
        drains = src.read(1)
        drains = np.where((drains <= 0) | (drains > len(rows)), 0, drains).astype("int64")

    # Channel elevation per stream cell: min unburned DEM within the search radius.
    size = 2 * CHANNEL_SEARCH_CELLS + 1
    local_min = ndimage.minimum_filter(np.nan_to_num(dem, nan=1e9), size=size)
    chan_by_id = np.concatenate([[np.nan], local_min[rows, cols]])
    reach_by_id = np.concatenate([[0], reach_r[rows, cols]])

    channel = chan_by_id[drains].astype("float32")
    reach = reach_by_id[drains].astype("int32")
    hand = np.where(drains > 0, np.maximum(dem - channel, 0.0), np.nan).astype("float32")
    hand = np.where(np.isnan(dem), np.nan, hand)
    return HandResult(hand, reach, channel, transform, str(crs), fl)


def gauge_reach(res: HandResult, x: float, y: float, name: str, max_dist_m: float = 300) -> int:
    """Reach id of the named stream nearest the gauge."""
    from shapely.geometry import Point

    cand = res.reaches[res.reaches["gnis_name"] == name]
    if cand.empty:
        raise ValueError(f"no NHD reach named {name!r}")
    d = cand.distance(Point(x, y))
    if d.min() > max_dist_m:
        raise ValueError(f"nearest {name} reach is {d.min():.0f} m from the gauge")
    return int(d.idxmin())


def channel_at(res: HandResult, reach_id: int, x: float, y: float) -> float:
    """Channel elevation (m) of `reach_id` nearest to (x, y)."""
    r, c = rasterio.transform.rowcol(res.transform, x, y)
    win = 30
    r0, c0 = max(r - win, 0), max(c - win, 0)
    sub_reach = res.reach[r0 : r + win, c0 : c + win]
    sub_hand = res.hand[r0 : r + win, c0 : c + win]
    sub_chan = res.channel[r0 : r + win, c0 : c + win]
    mask = (sub_reach == reach_id) & (sub_hand <= 0.01)
    if not mask.any():
        mask = sub_reach == reach_id
    if not mask.any():  # reach has no cells here (outside DEM, or overwritten at a confluence)
        return float("nan")
    rr, cc = np.nonzero(mask)
    k = np.argmin((rr + r0 - r) ** 2 + (cc + c0 - c) ** 2)
    return float(sub_chan[rr[k], cc[k]])


def reach_ratio(res: HandResult, gauge_reach_id: int) -> np.ndarray:
    """Depth multiplier per reach id (index 0 unused): (A / A_gauge)^0.3."""
    area = res.reaches["totdasqkm"].astype(float)
    a_g = float(area.loc[gauge_reach_id])
    ratio = np.zeros(len(res.reaches) + 1, dtype="float32")
    ratio[area.index.values] = (area.clip(lower=0.01).values / a_g) ** DEPTH_AREA_EXP
    return ratio


def depth_grid(res: HandResult, ratio: np.ndarray, d_gauge_m: float) -> np.ndarray:
    """Water depth (m) per cell for a gauge depth-above-channel; 0 where dry."""
    d = ratio[res.reach] * d_gauge_m
    return np.where(res.hand < d, d - res.hand, 0.0).astype("float32")


def reach_endpoints_channel(res: HandResult) -> tuple[np.ndarray, np.ndarray]:
    """Channel elevation (m) at each reach's downstream (outlet) and upstream end."""
    n = len(res.reaches) + 1
    out_el = np.full(n, np.nan, dtype="float64")
    up_el = np.full(n, np.nan, dtype="float64")
    for rid, geom in res.reaches.geometry.items():
        line = geom if geom.geom_type == "LineString" else max(geom.geoms, key=lambda g: g.length)
        # NHD flowlines are digitized upstream -> downstream.
        (x0, y0), (x1, y1) = line.coords[0], line.coords[-1]
        up_el[rid] = channel_at(res, rid, x0, y0)
        out_el[rid] = channel_at(res, rid, x1, y1)
    return out_el, up_el


def backwater_floor(
    res: HandResult,
    ratio: np.ndarray,
    d_gauge_m: float,
    ends: tuple[np.ndarray, np.ndarray],
    with_base: bool = False,
):
    """Flat-pool backwater: a reach's WSE can't drop below the receiving reach's WSE where they meet.

    floor[r] = max(WSE at the upstream end of the downstream reach, floor[downstream]),
    processed from the most downstream reach (lowest hydroseq) upward. Returns WSE floor (m)
    per reach id (NaN = none).
    """
    out_el, up_el = ends
    reaches = res.reaches
    by_hs = {hs: rid for rid, hs in reaches["hydroseq"].items()}
    floor = np.full(len(reaches) + 1, np.nan)
    base = np.full(len(reaches) + 1, np.nan)
    for rid in reaches.sort_values("hydroseq").index:
        dn = by_hs.get(reaches.at[rid, "dnhydroseq"])
        if dn is None:
            continue
        dn_wse_at_junction = up_el[dn] + ratio[dn] * d_gauge_m
        cands = [v for v in (dn_wse_at_junction, floor[dn]) if not np.isnan(v)]
        if cands:
            floor[rid] = max(cands)
            base[rid] = np.nanmax([up_el[dn], base[dn]]) if not np.isnan(base[dn]) else up_el[dn]
    return (floor, base) if with_base else floor


def wse_grid(
    res: HandResult,
    ratio: np.ndarray,
    d_gauge_m: float,
    floor: np.ndarray,
    base: np.ndarray | None = None,
    dem: np.ndarray | None = None,
) -> np.ndarray:
    """Water-surface elevation (m) per cell: max(own reach channel + depth, backwater floor).

    With `base` and `dem`: the floor applies only to cells above the junction's base-flow water
    surface. Cells below it would be underwater at normal flow, so they are pits (culvert inlets,
    bare-earth notches behind embankments) that the backwater pool cannot reach.
    """
    own = res.channel + ratio[res.reach] * d_gauge_m
    fl = floor[res.reach]
    if base is not None and dem is not None:
        b = base[res.reach]
        fl = np.where(np.isnan(b) | (dem > b), fl, np.nan)
    return np.where(np.isnan(fl), own, np.maximum(own, fl)).astype("float32")
