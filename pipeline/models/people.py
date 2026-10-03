"""Synthetic residents (DATA.md §3.4). Always labeled "simulated" in the product.

1. Area population target per block group = ACS 2023 BG population × (share of the BG's
   2020 block population whose block lies in the area).
2. Each BG's target is split across its in-area blocks by 2020 block population, then across
   residential buildings in each block by heated square feet.
3. Each person gets attributes drawn independently from their BG's ACS rates (fixed seed).
"""

from __future__ import annotations

from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import pandas as pd

from ..areas import Area

# Hazus occupancy classes that house the census population. RES4 (hotels) excluded.
RESIDENTIAL = ("RES1", "RES2", "RES3", "RES5", "RES6")
METRIC_CRS = 32617
# Smallest footprint we will infer as housing (excludes sheds/garages). Approved decision.
INFER_MIN_FOOTPRINT_M2 = 60.0


@dataclass
class Residents:
    table: pd.DataFrame  # one row per simulated person
    summary: dict
    inferred: pd.DataFrame  # buildings inferred residential: id, block, housing units


def largest_remainder(weights: np.ndarray, total: int) -> np.ndarray:
    """Integer allocation of `total` proportional to `weights` (deterministic, sums exactly)."""
    weights = np.asarray(weights, dtype=float)
    if total <= 0 or weights.sum() <= 0:
        return np.zeros(len(weights), dtype=int)
    exact = weights / weights.sum() * total
    base = np.floor(exact).astype(int)
    short = total - base.sum()
    order = np.lexsort((np.arange(len(exact)), -(exact - base)))  # ties -> earlier index
    base[order[:short]] += 1
    return base


def in_area(geoms: gpd.GeoSeries, area: Area) -> np.ndarray:
    pts = geoms.representative_point()  # guaranteed inside the polygon; no projection needed
    lon_min, lat_min, lon_max, lat_max = area.bbox
    return (
        (pts.x >= lon_min) & (pts.x <= lon_max) & (pts.y >= lat_min) & (pts.y <= lat_max)
    ).values


def bg_rates(acs: pd.DataFrame) -> pd.DataFrame:
    def rate(num: str, den: str) -> pd.Series:
        return (acs[num] / acs[den]).where(acs[den] > 0).clip(0, 1)

    return pd.DataFrame(
        {
            "GEOID": acs["GEOID"],
            "p_age_65_plus": rate("age_65_plus", "age_universe"),
            "p_no_vehicle": rate("hh_no_vehicle", "hh_vehicle_universe"),
            "p_below_poverty": rate("below_poverty", "poverty_universe"),
            "p_limited_english": rate("hh_limited_english", "hh_language_universe"),
        }
    )


def build_residents(
    area: Area,
    buildings: gpd.GeoDataFrame,
    blocks: gpd.GeoDataFrame,
    acs: pd.DataFrame,
    weights: dict[str, float],
    seed: int,
) -> Residents:
    blocks = blocks.copy()
    blocks["bg"] = blocks["GEOID20"].str[:12]
    blocks["in_area"] = in_area(blocks.geometry, area)

    # 1. Area targets per BG.
    bg = blocks.groupby("bg").agg(pop20=("POP20", "sum"))
    bg["pop20_in"] = blocks[blocks["in_area"]].groupby("bg")["POP20"].sum()
    bg = bg[bg["pop20_in"].fillna(0) > 0]
    bg = bg.join(acs.set_index("GEOID")["pop_total"].rename("acs_pop"))
    if bg["acs_pop"].isna().any():
        missing = bg.index[bg["acs_pop"].isna()].tolist()
        raise ValueError(f"ACS population missing for block groups: {missing}")
    bg["share_in"] = bg["pop20_in"] / bg["pop20"]
    bg["target"] = bg["acs_pop"] * bg["share_in"]
    target_total = float(bg["target"].sum())
    bg["target_int"] = largest_remainder(bg["target"].values, round(target_total))

    # 2. BG -> blocks -> residential buildings.
    res = buildings[buildings["occupancy"].fillna("").str.startswith(RESIDENTIAL)].copy()
    res, inferred = _infer_from_census_housing(buildings, res, blocks)
    res["sqft_w"] = res["sqft"]
    fallback = res["sqft_w"].isna()
    if fallback.any():
        area_m2 = res.loc[fallback].geometry.to_crs(METRIC_CRS).area
        res.loc[fallback, "sqft_w"] = area_m2 * 10.7639 * res.loc[fallback, "stories"].fillna(1)
    res_pts = gpd.GeoDataFrame(res[["id", "sqft_w"]], geometry=res.geometry.representative_point())
    res_pts = gpd.sjoin(res_pts, blocks[["GEOID20", "geometry"]], predicate="within")

    rows = []
    unplaced = 0
    in_blocks = blocks[blocks["in_area"] & blocks["bg"].isin(bg.index)]
    for bg_id, group in in_blocks.groupby("bg"):
        alloc = largest_remainder(group["POP20"].values, int(bg.loc[bg_id, "target_int"]))
        for block_id, n in zip(group["GEOID20"].values, alloc, strict=True):
            if n == 0:
                continue
            b = res_pts[res_pts["GEOID20"] == block_id]
            if b.empty:
                unplaced += int(n)
                continue
            per = largest_remainder(b["sqft_w"].values, int(n))
            rows.extend(
                (bid, bg_id) for bid, k in zip(b["id"].values, per, strict=True) for _ in range(k)
            )

    people = pd.DataFrame(rows, columns=["building_id", "bg"])

    # 3. Attributes from BG rates.
    rates = bg_rates(acs).set_index("GEOID")
    rng = np.random.default_rng(seed)
    for col in ("age_65_plus", "no_vehicle", "below_poverty", "limited_english"):
        p = people["bg"].map(rates[f"p_{col}"]).fillna(0).values
        people[col] = (rng.random(len(people)) < p).astype(np.int8)
    people["weight"] = (
        weights["base"]
        + weights["age_65_plus"] * people["age_65_plus"]
        + weights["no_vehicle"] * people["no_vehicle"]
        + weights["below_poverty"] * people["below_poverty"]
        + weights["limited_english"] * people["limited_english"]
    )

    placed = len(people)
    summary = {
        "acs_target_total": round(target_total, 1),
        "residents_placed": placed,
        "unplaced_no_residential_building": unplaced,
        "placed_vs_target_pct": round(100 * (placed - target_total) / target_total, 2)
        if target_total
        else None,
        "block_groups": int(len(bg)),
        "blocks_in_area": int(blocks["in_area"].sum()),
        "residential_buildings": int(len(res)),
        "residential_buildings_sqft_fallback": int(fallback.sum()),
        "rates_mean": {
            c: round(float(people[c].mean()), 4) if placed else None
            for c in ("age_65_plus", "no_vehicle", "below_poverty", "limited_english")
        },
        "seed": seed,
    }
    summary["inferred_residential_buildings"] = int(len(inferred))
    return Residents(people.drop(columns=["bg"]), summary, inferred)


def _infer_from_census_housing(
    buildings: gpd.GeoDataFrame, res: gpd.GeoDataFrame, blocks: gpd.GeoDataFrame
) -> tuple[gpd.GeoDataFrame, pd.DataFrame]:
    """In in-area blocks where the 2020 census records housing units but no residential building
    exists in our inventory, treat footprints with no use record (>= 60 m²) as residential.
    These are labeled inferred; real occupancy data always wins (only null-occupancy footprints)."""
    housing = blocks.get("HOUSING20")
    if housing is None:
        return res, pd.DataFrame(columns=["id", "block", "housing_units"])
    target = blocks[blocks["in_area"] & (housing > 0)][["GEOID20", "HOUSING20", "geometry"]]

    def block_of(gdf: gpd.GeoDataFrame) -> pd.Series:
        pts = gpd.GeoDataFrame(geometry=gdf.geometry.representative_point(), crs=4326)
        hit = gpd.sjoin(pts, target, predicate="within")
        return hit["GEOID20"].reindex(gdf.index)

    have_res = set(block_of(res).dropna())
    cand = buildings[buildings["occupancy"].isna()].copy()
    cand = cand[cand.geometry.to_crs(METRIC_CRS).area >= INFER_MIN_FOOTPRINT_M2]
    cand["block"] = block_of(cand)
    cand = cand[cand["block"].notna() & ~cand["block"].isin(have_res)]
    units = target.set_index("GEOID20")["HOUSING20"]
    cand["occupancy"] = "RES3"
    cand["occupancy_src"] = cand["block"].map(
        lambda b: f"inferred: census block has {int(units[b])} housing units, no use record"
    )
    if "sqft" not in cand or cand["sqft"].isna().any():
        floors = cand.get("stories", pd.Series(1.0, index=cand.index)).fillna(1.0)
        est = cand.geometry.to_crs(METRIC_CRS).area * 10.7639 * floors
        cand["sqft"] = cand.get("sqft", est).fillna(est) if "sqft" in cand else est
    inferred = pd.DataFrame(
        {"id": cand["id"], "block": cand["block"], "housing_units": cand["block"].map(units)}
    )
    return pd.concat([res, cand.drop(columns=["block"])]), inferred
