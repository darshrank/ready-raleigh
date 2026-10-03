"""NC Risk Building Footprints (NCEM), FeatureServer layer 0 "All Buildings" (DATA.md §2).

Verified 2026-10-03: maxRecordCount 2000, pagination + geoJSON supported, coded-value domains
on OCCUP_TYPE/BUILD_TYPE/FOUND_TYPE/… combine class + derivation source + confidence
(e.g. "3040" -> "WOOD - HAZUS DERIVED"). Numeric fields use -8888 / -9999 as "missing".
"""

from __future__ import annotations

import json

import geopandas as gpd
import pandas as pd

from ..areas import Area
from ..cache import FetchError, fetch
from ..sources import Source

LAYER = (
    "https://services1.arcgis.com/YBWrN5qiESVpqi92/ArcGIS/rest/services/"
    "NC_Risk_Building_Footprints/FeatureServer/0"
)
ITEM = "https://www.arcgis.com/home/item.html?id=d5f0fd023d8e4025b7a4b5167add2001"
PAGE = 2000
# Never written to any output (CLAUDE.md rule 5): parcel id.
DROP_FIELDS = {"PID"}
# Fields DATA.md relies on; if any disappear, stop.
REQUIRED = {
    "BLDG_ID", "OCCUP_TYPE", "BUILD_TYPE", "FL_SCHEME", "FLD_ZONE", "STATIC_BFE", "WIND_ZONE",
    "YEAR_BUILT", "YRBUILTSRC", "BLDG_VALUE", "BLDVAL_SRC", "BLDGREPVAL", "HTD_SQ_FT", "FFE",
    "FFE_TYP",
}  # fmt: skip


def source(fetched_at: str) -> Source:
    return Source(
        id="nc_bldg",
        dataset="NC Risk Building Footprints (NCEM Risk Management)",
        url=ITEM,
        date=f"footprints 2009–2012 imagery; service last edited 2021-01-05; fetched {fetched_at}",
        license="Public data from NC Emergency Management (no license stated on item)",
        method="ArcGIS REST query by area bbox, coded domains decoded from layer metadata",
    )


def layer_info() -> dict:
    info = fetch("nc_buildings", LAYER, params={"f": "json"}, suffix=".json").json()
    names = {f["name"] for f in info["fields"]}
    missing = REQUIRED - names
    if missing:
        raise FetchError(f"NC buildings layer is missing fields from DATA.md: {sorted(missing)}")
    return info


def domains(info: dict) -> dict[str, dict[str, str]]:
    """field -> {code: label} for every coded-value domain."""
    out: dict[str, dict[str, str]] = {}
    for f in info["fields"]:
        dom = f.get("domain")
        if dom and dom.get("type") == "codedValue":
            out[f["name"]] = {str(c["code"]): c["name"] for c in dom["codedValues"]}
    return out


def fetch_buildings(area: Area) -> tuple[gpd.GeoDataFrame, dict, str]:
    """All footprints intersecting the area bbox, raw (codes not decoded), PID removed."""
    info = layer_info()
    geometry = ",".join(str(v) for v in area.bbox)
    base = {
        "where": "1=1",
        "geometry": geometry,
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "returnCountOnly": "true",
        "f": "json",
    }
    count = fetch("nc_buildings", f"{LAYER}/query", params=base, suffix=".json").json()["count"]
    fields = ",".join(f["name"] for f in info["fields"] if f["name"] not in DROP_FIELDS)
    frames = []
    fetched_at = ""
    for offset in range(0, count, PAGE):
        params = {
            **base,
            "returnCountOnly": "false",
            "outFields": fields,
            "orderByFields": "OBJECTID",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
            "f": "geojson",
        }
        page = fetch("nc_buildings", f"{LAYER}/query", params=params, suffix=".geojson")
        fetched_at = max(fetched_at, page.fetched_at)
        fc = json.loads(page.path.read_bytes())
        if "error" in fc:
            raise FetchError(f"NC buildings query error at offset {offset}: {fc['error']}")
        if fc["features"]:
            frames.append(gpd.GeoDataFrame.from_features(fc["features"], crs=4326))
    gdf = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=4326)
    gdf = gdf.drop(columns=[c for c in DROP_FIELDS if c in gdf.columns])
    gdf = gdf.drop_duplicates("OBJECTID")
    if len(gdf) != count:
        raise FetchError(f"NC buildings: expected {count} features, got {len(gdf)}")
    return gdf, info, fetched_at
