"""Building table: decoded NC Risk attributes + heights from OSM / Overture (BUILD.md M1).

Internal units are meters (CLAUDE.md); NC FFE/LAG are feet NAVD88 and converted here.
"""

from __future__ import annotations

import re

import geopandas as gpd
import numpy as np
import pandas as pd

M_PER_FT = 0.3048
METRIC_CRS = 32617  # UTM 17N
STORY_HEIGHT_M = 3.0  # assumption for stories -> height (METHODS.md)
MISSING_SENTINELS = (-8888, -9999, -7777)
# A footprint from OSM/Overture "matches" an NC footprint when they overlap this much (of the smaller).
MATCH_OVERLAP = 0.3


def split_label(label: str | None) -> tuple[str | None, str | None]:
    """'WOOD - HAZUS DERIVED' -> ('WOOD', 'HAZUS DERIVED'); NA/NP -> (None, None)."""
    if not isinstance(label, str) or label.startswith("NOT "):
        return None, None
    head, _, rest = label.partition(" - ")
    return head.strip(), (rest.strip() or None)


def parse_stories(value: str | None) -> float | None:
    if not isinstance(value, str):
        return None
    if value.startswith("MORE THAN"):
        return float(re.findall(r"\d+", value)[0]) + 1
    if value == "SPLIT LEVEL":
        return 1.5
    m = re.fullmatch(r"(\d+)(?: (\d)/(\d))?", value)
    if not m:
        return None
    whole = float(m.group(1))
    return whole + (int(m.group(2)) / int(m.group(3)) if m.group(2) else 0.0)


def _clean_num(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    return s.mask(s.isin(MISSING_SENTINELS) | (s < 0))


def decode(raw: gpd.GeoDataFrame, domains: dict[str, dict[str, str]]) -> gpd.GeoDataFrame:
    def coded(field: str) -> tuple[pd.Series, pd.Series]:
        labels = raw[field].map(lambda c: domains[field].get(c) if isinstance(c, str) else None)
        parts = labels.map(split_label)
        return parts.map(lambda p: p[0]), parts.map(lambda p: p[1])

    out = gpd.GeoDataFrame(geometry=raw.geometry, crs=raw.crs)
    out["id"] = raw["BLDG_ID"].astype(str)
    out["occupancy"], out["occupancy_src"] = coded("OCCUP_TYPE")
    out["construction"], out["construction_src"] = coded("BUILD_TYPE")
    out["foundation"], out["foundation_src"] = coded("FOUND_TYPE")
    stories_label, out["stories_src"] = coded("NUM_STORY")
    out["stories"] = stories_label.map(parse_stories)
    out["flood_zone"] = raw["FLD_ZONE"].map(lambda c: domains["FLD_ZONE"].get(str(c)))
    year = _clean_num(raw["YEAR_BUILT"])
    out["year"] = year.where((year >= 1700) & (year <= 2030)).astype("Int64")
    out["year_src"] = raw["YRBUILTSRC"].map(lambda c: domains["YRBUILTSRC"].get(str(c)))
    out["value_rep_usd"] = _clean_num(raw["BLDGREPVAL"])
    out["value_src"] = raw["BLDVAL_SRC"].map(lambda c: domains["BLDVAL_SRC"].get(str(c)))
    out["sqft"] = _clean_num(raw["HTD_SQ_FT"])
    out["ffe_m"] = _clean_num(raw["FFE"]) * M_PER_FT
    out["ffe_src"] = raw["FFE_TYP"].map(lambda c: domains["FFE_TYP"].get(str(c)))
    out["lag_m"] = _clean_num(raw["LIDAR_LAG"]) * M_PER_FT
    for col in ("year_src", "value_src", "ffe_src", "flood_zone"):
        out[col] = out[col].where(
            ~out[col].isin(["NOT APPLICABLE", "NOT PROVIDED", "NOT  PROVIDED"])
        )
    return out


def _best_match(nc: gpd.GeoDataFrame, other: gpd.GeoDataFrame, prefix: str) -> pd.DataFrame:
    """For each NC footprint, the overlapping `other` footprint with the largest overlap."""
    if other.empty:
        return pd.DataFrame(index=nc.index)
    a = nc[["geometry"]].to_crs(METRIC_CRS).reset_index(names="nc_idx")
    b = other.to_crs(METRIC_CRS).reset_index(drop=True).reset_index(names="o_idx")
    pairs = gpd.sjoin(a, b[["o_idx", "geometry"]], predicate="intersects")
    if pairs.empty:
        return pd.DataFrame(index=nc.index)
    ga = a.geometry.values[pairs.index.values]
    gb = b.geometry.values[pairs["o_idx"].values]
    inter = ga.intersection(gb).area
    smaller = np.minimum(ga.area, gb.area)
    pairs = pairs.assign(overlap=np.where(smaller > 0, inter / smaller, 0.0))
    pairs = pairs[pairs["overlap"] >= MATCH_OVERLAP].sort_values("overlap", ascending=False)
    best = pairs.drop_duplicates("nc_idx").set_index("nc_idx")
    cols = [c for c in b.columns if c not in ("geometry", "o_idx")]
    joined = b.loc[best["o_idx"].values, cols].set_index(best.index)
    return joined.add_prefix(prefix)


def unmatched(nc: gpd.GeoDataFrame, other: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """`other` footprints that overlap no NC footprint (likely built after the 2009–2012 imagery)."""
    if other.empty:
        return other
    a = nc[["geometry"]].to_crs(METRIC_CRS)
    b = other.to_crs(METRIC_CRS).reset_index(drop=True)
    hit = gpd.sjoin(b[["geometry"]], a, predicate="intersects").index.unique()
    return other.reset_index(drop=True).drop(index=hit)


def _osm_height_m(v) -> float | None:
    if not isinstance(v, str):
        return None
    m = re.match(r"^\s*([\d.]+)\s*(m|ft|')?\s*$", str(v))
    if not m:
        return None
    h = float(m.group(1))
    return h * M_PER_FT if m.group(2) in ("ft", "'") else h


def add_heights(
    nc: gpd.GeoDataFrame, osm: gpd.GeoDataFrame, overture: gpd.GeoDataFrame
) -> gpd.GeoDataFrame:
    """Height priority: OSM height tag > Overture height > OSM levels > NC stories (×3 m)."""
    osm_b = osm[osm.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
    keep = [
        c
        for c in ["osm_id", "height", "building:levels", "roof:material", "roof:colour"]
        if c in osm_b.columns
    ]
    o = _best_match(nc, osm_b[[*keep, "geometry"]], "osm_")
    v = _best_match(nc, overture[["id", "height", "num_floors", "geometry"]], "ov_")
    df = nc.join(o).join(v)

    h = pd.Series(np.nan, index=df.index)
    src = pd.Series(None, index=df.index, dtype=object)

    def fill(values: pd.Series, label: str) -> None:
        m = h.isna() & values.notna() & (values > 0)
        h[m] = values[m]
        src[m] = label

    if "osm_height" in df:
        fill(df["osm_height"].map(_osm_height_m).astype(float), "osm:height")
    if "ov_height" in df:
        fill(pd.to_numeric(df["ov_height"], errors="coerce"), "overture:height")
    if "osm_building:levels" in df:
        levels = pd.to_numeric(df["osm_building:levels"], errors="coerce")
        fill(levels * STORY_HEIGHT_M, "osm:levels×3m")
    fill(df["stories"] * STORY_HEIGHT_M, "nc:stories×3m")

    out = nc.copy()
    out["height_m"] = h.round(1)
    out["height_src"] = src
    out["roof_material"] = df.get("osm_roof:material")
    out["roof_colour"] = df.get("osm_roof:colour")
    out["osm_id"] = df.get("osm_osm_id")
    out["overture_id"] = df.get("ov_id")
    return out


# OSM building=* values that tell us a footprint is residential, mapped to Hazus classes.
OSM_RESIDENTIAL = {
    "house": "RES1", "detached": "RES1", "semidetached_house": "RES1", "bungalow": "RES1",
    "terrace": "RES3", "apartments": "RES3", "residential": "RES3", "dormitory": "RES5",
}  # fmt: skip


def classify_extras(extra: gpd.GeoDataFrame, osm: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Footprints missing from the NC inventory: occupancy from a matching OSM building=* tag
    (real data, labeled with its source); floor area estimated from footprint × floors."""
    out = extra.copy()
    osm_b = osm[osm.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
    keep = [c for c in ("osm_id", "building", "building:levels") if c in osm_b.columns]
    m = _best_match(out, osm_b[[*keep, "geometry"]], "osm_")
    out = out.join(m)
    tag = out.get("osm_building")
    out["occupancy"] = tag.map(OSM_RESIDENTIAL) if tag is not None else None
    out["occupancy_src"] = tag.map(lambda t: f"OSM building={t}" if t in OSM_RESIDENTIAL else None)
    floors = pd.to_numeric(out.get("osm_building:levels"), errors="coerce")
    floors = floors.fillna(pd.to_numeric(out.get("num_floors"), errors="coerce"))
    floors = floors.fillna((out["height"] / STORY_HEIGHT_M).round().clip(lower=1)).fillna(1)
    out["stories"] = floors
    out["sqft"] = out.geometry.to_crs(METRIC_CRS).area * 10.7639 * floors
    out["sqft_estimated"] = True
    return out
