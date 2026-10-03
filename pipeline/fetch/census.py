"""Census: ACS 2023 5-year block groups, 2020 block population, TIGER geometries (DATA.md §2).

Block population comes from POP20 in the statewide TIGER 2020 block file (no API needed).

Verified 2026-10-03: api.census.gov now rejects keyless requests (302 -> missing_key.html),
so CENSUS_API_KEY is required. TIGER zips are public files on www2.census.gov.
"""

from __future__ import annotations

import os

import geopandas as gpd
import pandas as pd

from ..areas import Area
from ..cache import FetchError, fetch
from ..sources import Source

ACS_URL = "https://api.census.gov/data/2023/acs/acs5"
# Block groups: TIGER 2023 to match the ACS 2023 vintage (DATA.md listed 2024; same 2020-based BGs).
BG_ZIP = "https://www2.census.gov/geo/tiger/TIGER2023/BG/tl_2023_{state}_bg.zip"
# 2020 blocks, statewide (DATA.md). Unlike the county PL-layer file, this one carries POP20 and
# HOUSING20 (2020 P.L. 94-171 counts), so block population needs no API call.
BLOCK_ZIP = "https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_{state}_tabblock20.zip"

AGE_65_PLUS = [f"B01001_{i:03d}E" for i in [*range(20, 26), *range(44, 50)]]
ACS_VARS = {
    "pop_total": ["B01003_001E"],
    "age_universe": ["B01001_001E"],
    "age_65_plus": AGE_65_PLUS,
    "hh_vehicle_universe": ["B25044_001E"],
    "hh_no_vehicle": ["B25044_003E", "B25044_010E"],
    "poverty_universe": ["C17002_001E"],
    "below_poverty": ["C17002_002E", "C17002_003E"],  # ratio of income to poverty < 1.0
    "hh_language_universe": ["C16002_001E"],
    "hh_limited_english": ["C16002_004E", "C16002_007E", "C16002_010E", "C16002_013E"],
}


# Margins of error (90%) for the vehicle-availability proportion (round tolerance).
ACS_MOE = ["B25044_001M", "B25044_003M", "B25044_010M"]


def _key() -> str:
    key = os.environ.get("CENSUS_API_KEY", "").strip()
    if not key:
        raise FetchError(
            "CENSUS_API_KEY is not set. The Census Data API now requires a key "
            "(free: https://api.census.gov/data/key_signup.html). Add it to .env."
        )
    return key


def _state_county(area: Area) -> tuple[str, str]:
    return area.county_fips[:2], area.county_fips[2:]


def acs_source(fetched_at: str) -> Source:
    return Source(
        id="acs",
        dataset="ACS 2019–2023 5-year estimates, block groups (B01003, B01001, B25044, C17002, C16002)",
        url="https://www.census.gov/programs-surveys/acs",
        date=f"2023 5-year; fetched {fetched_at}",
        license="Public domain (U.S. Census Bureau)",
        method="Census Data API, all block groups in the area's county",
    )


def blocks_source(fetched_at: str) -> Source:
    return Source(
        id="census_blocks",
        dataset="2020 Census block population (POP20, P.L. 94-171) in TIGER/Line 2020 blocks",
        url="https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/",
        date=f"2020-04-01 census day; fetched {fetched_at}",
        license="Public domain (U.S. Census Bureau)",
        method="TIGER/Line statewide block shapefile filtered to county; used only as within-block-group weights",
    )


def fetch_acs(area: Area) -> tuple[pd.DataFrame, str]:
    state, county = _state_county(area)
    cols = sorted({v for vs in ACS_VARS.values() for v in vs}) + ACS_MOE
    res = fetch(
        "census_acs",
        ACS_URL,
        params={
            "get": ",".join(cols),
            "for": "block group:*",
            "in": f"state:{state} county:{county}",
            "key": _key(),
        },
        suffix=".json",
    )
    rows = res.json()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df["GEOID"] = df["state"] + df["county"] + df["tract"] + df["block group"]
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
        # ACS uses large negative sentinels (e.g. -666666666) for "not available".
        df.loc[df[c] < 0, c] = pd.NA
    out = pd.DataFrame({"GEOID": df["GEOID"]})
    for name, vs in ACS_VARS.items():
        out[name] = df[vs].sum(axis=1, min_count=len(vs))
    # Census proportion MOE: sqrt(MOE_num² − p²·MOE_den²) / den, where MOE_num combines the
    # owner + renter "no vehicle" MOEs in quadrature (ACS handbook ch. 8).
    num, den = out["hh_no_vehicle"], out["hh_vehicle_universe"]
    moe_num = (df["B25044_003M"] ** 2 + df["B25044_010M"] ** 2) ** 0.5
    p = num / den
    inner = moe_num**2 - p**2 * df["B25044_001M"] ** 2
    inner = inner.where(
        inner > 0, moe_num**2 + p**2 * df["B25044_001M"] ** 2
    )  # ratio form if negative
    out["p_no_vehicle_moe90"] = (inner**0.5 / den).where(den > 0)
    return out, res.fetched_at


def tiger_block_groups(area: Area) -> tuple[gpd.GeoDataFrame, str]:
    state, county = _state_county(area)
    res = fetch("tiger", BG_ZIP.format(state=state), suffix=".zip", stream=True, timeout=600)
    gdf = gpd.read_file(f"zip://{res.path}", where=f"COUNTYFP = '{county}'")
    return gdf[["GEOID", "ALAND", "geometry"]].to_crs(4326), res.fetched_at


def tiger_blocks(area: Area) -> tuple[gpd.GeoDataFrame, str]:
    state, county = _state_county(area)
    url = BLOCK_ZIP.format(state=state)
    res = fetch("tiger", url, suffix=".zip", stream=True, timeout=1200)
    gdf = gpd.read_file(f"zip://{res.path}", where=f"COUNTYFP20 = '{county}'")
    return gdf[["GEOID20", "POP20", "HOUSING20", "geometry"]].to_crs(4326), res.fetched_at
