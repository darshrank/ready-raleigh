"""Hydrography + flood hazard + history (DATA.md §2). Verified 2026-10-03:
- NHDPlus HR flowlines (pynhd): 352 in the buffered area, with total drainage area `totdasqkm`.
- FEMA NFHL MapServer layer 28 "Flood Hazard Zones" (654 in bbox) and 14 "Cross-Sections"
  (125 in bbox, all with WSEL_REG = regulatory 1%-annual-chance WSE, ft NAVD88).
- OpenFEMA FimaNfipClaims v2 (countyCode, censusTract, yearOfLoss, dateOfLoss,
  amountPaidOnBuildingClaim, floodEvent …) — aggregated to tract only, never stored per claim.
- NOAA NWPS gauge (datum NAVD88 offset, flood categories, historic crests, impact statements).
- USGS STN high-water marks: 0 in Wake County for Matthew (2016), Florence (2018), Michael (2018).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd

from ..areas import Area
from ..cache import CACHE_DIR, FetchError, fetch
from ..sources import Source

os.environ.setdefault("HYRIVER_CACHE_NAME", str(CACHE_DIR / "hyriver.sqlite"))

NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"
OPENFEMA = "https://www.fema.gov/api/open/v2/FimaNfipClaims"
NWPS = "https://api.water.noaa.gov/nwps/v1/gauges"
STN = "https://stn.wim.usgs.gov/STNServices/HWMs/FilteredHWMs.json"
KEEP_NHD = [
    "nhdplusid", "gnis_name", "ftype", "fcode", "streamorde", "totdasqkm", "lengthkm",
    "hydroseq", "dnhydroseq", "levelpathi", "geometry",
]  # fmt: skip


def nhd_source() -> Source:
    return Source(
        id="nhd",
        dataset="USGS NHDPlus High Resolution flowlines",
        url="https://www.usgs.gov/national-hydrography/nhdplus-high-resolution",
        date="NHDPlus HR (current service)",
        license="Public domain (USGS)",
        method="pynhd NHDPlusHR('flowline').bygeom over the buffered area",
    )


def fema_source(fetched_at: str) -> Source:
    return Source(
        id="nfhl",
        dataset="FEMA National Flood Hazard Layer: Flood Hazard Zones (S_FLD_HAZ_AR) + Cross-Sections (S_XS)",
        url="https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
        date=f"effective NFHL; fetched {fetched_at}",
        license="Public domain (FEMA)",
        method="ArcGIS REST query layers 28 and 14 by area bbox",
    )


def claims_source(fetched_at: str) -> Source:
    return Source(
        id="nfip_claims",
        dataset="OpenFEMA FIMA NFIP Redacted Claims v2",
        url="https://www.fema.gov/openfema-data-page/fima-nfip-redacted-claims-v2",
        date=f"fetched {fetched_at}",
        license="Public (OpenFEMA terms; not FEMA-endorsed)",
        method="All Wake County claims, aggregated to census tract (count, building $ paid)",
    )


def gauge_source(lid: str, fetched_at: str) -> Source:
    return Source(
        id=f"nwps_{lid}",
        dataset=f"NOAA National Water Prediction Service gauge {lid}",
        url=f"https://water.noaa.gov/gauges/{lid}",
        date=f"fetched {fetched_at}",
        license="Public domain (NOAA)",
        method="NWPS API gauge metadata: datum, flood categories, historic crests, impacts",
    )


def fetch_flowlines(buffered_bbox: tuple[float, float, float, float]) -> gpd.GeoDataFrame:
    import pynhd

    fl = pynhd.NHDPlusHR("flowline").bygeom(buffered_bbox, 4326)
    fl = fl[fl["ftype"].isin([460, 558, 334])]  # stream/river, artificial path, connector
    return fl[[c for c in KEEP_NHD if c in fl.columns]].to_crs(4326)


PAGE = 200


def _arcgis_all(layer: int, area: Area, fields: str) -> tuple[gpd.GeoDataFrame, str]:
    base = {
        "where": "1=1",
        "geometry": ",".join(str(v) for v in area.bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": fields,
        "orderByFields": "OBJECTID",
        "f": "geojson",
        # Without these the NFHL server returns HTTP 500 for this bbox (verified 2026-10-03).
        "geometryPrecision": 6,
        "maxAllowableOffset": 0.00001,  # ~1 m generalization
    }
    frames, offset, fetched = [], 0, ""
    while True:
        page = fetch(
            "nfhl",
            f"{NFHL}/{layer}/query",
            params={**base, "resultOffset": offset, "resultRecordCount": PAGE},
            suffix=".geojson",
        )
        fetched = max(fetched, page.fetched_at)
        fc = json.loads(page.path.read_bytes())
        if "error" in fc:
            raise FetchError(f"NFHL layer {layer}: {fc['error']}")
        if fc["features"]:
            frames.append(gpd.GeoDataFrame.from_features(fc["features"], crs=4326))
        if not (fc.get("properties") or {}).get("exceededTransferLimit"):
            break
        offset += PAGE
    gdf = (
        gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=4326)
        if frames
        else gpd.GeoDataFrame(geometry=[], crs=4326)
    )
    return gdf, fetched


def fetch_fema_zones(area: Area):
    return _arcgis_all(28, area, "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH")


def fetch_fema_xs(area: Area):
    return _arcgis_all(14, area, "WTR_NM,STREAM_STN,WSEL_REG,STRMBED_EL,V_DATUM,LEN_UNIT,XS_LN_TYP")


def fetch_claims_by_tract(area: Area) -> tuple[pd.DataFrame, str]:
    rows, skip, fetched = [], 0, ""
    fields = "censusTract,yearOfLoss,dateOfLoss,amountPaidOnBuildingClaim,floodEvent"
    while True:
        page = fetch(
            "openfema",
            OPENFEMA,
            params={
                "$filter": f"countyCode eq '{area.county_fips}'",
                "$select": fields,
                "$top": 10000,
                "$skip": skip,
                "$orderby": "id",
            },
            suffix=".json",
        )
        fetched = max(fetched, page.fetched_at)
        batch = page.json()["FimaNfipClaims"]
        rows.extend(batch)
        if len(batch) < 10000:
            break
        skip += 10000
    df = pd.DataFrame(rows)
    df["amountPaidOnBuildingClaim"] = pd.to_numeric(df["amountPaidOnBuildingClaim"]).fillna(0)
    agg = (
        df.groupby("censusTract")
        .agg(claims=("yearOfLoss", "size"), building_paid_usd=("amountPaidOnBuildingClaim", "sum"))
        .reset_index()
    )
    by_event = df.groupby(["censusTract", "floodEvent"]).size().rename("claims").reset_index()
    return agg.assign(total_county_claims=len(df)), fetched, by_event


def fetch_gauge(lid: str) -> tuple[dict, str]:
    res = fetch("nwps", f"{NWPS}/{lid}", suffix=".json")
    return res.json(), res.fetched_at


def count_hwms(area: Area, events: dict[int, str]) -> dict:
    """USGS STN high-water marks inside the area per event (documents why there's no HWM backtest)."""
    lon0, lat0, lon1, lat1 = area.bbox
    out = {}
    for ev, name in events.items():
        hw = fetch("stn", STN, params={"Event": ev, "States": "NC"}, suffix=".json").json()
        inside = [
            h
            for h in hw
            if h.get("latitude")
            and lon0 <= h["longitude"] <= lon1
            and lat0 <= h["latitude"] <= lat1
        ]
        county = [h for h in hw if (h.get("countyName") or "").lower().startswith("wake")]
        out[name] = {"nc_total": len(hw), "in_area": len(inside), "wake_county": len(county)}
    return out


def save_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, default=str))
