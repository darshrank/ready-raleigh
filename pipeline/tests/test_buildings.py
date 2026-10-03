import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from shapely.geometry import box

from pipeline.models.buildings import (
    M_PER_FT,
    add_heights,
    decode,
    parse_stories,
    split_label,
)

DOMAINS = {
    "OCCUP_TYPE": {"2245": "RES1 - HAZUS DERIVED"},
    "BUILD_TYPE": {"3040": "WOOD - HAZUS DERIVED", "NP": "NOT PROVIDED"},
    "FOUND_TYPE": {"3050": "SLAB ON GRADE - HAZUS DERIVED"},
    "NUM_STORY": {"1001": "1 1/2 - FIELD DERIVED - HIGH CONFIDENCE"},
    "FLD_ZONE": {"4002": "X"},
    "YRBUILTSRC": {"3000": "HAZUS DERIVED"},
    "BLDVAL_SRC": {"2000": "PARCEL DERIVED - HIGH CONFIDENCE"},
    "FFE_TYP": {"1060": "AERIAL LIDAR DERIVED"},
}


def raw_frame(**overrides):
    row = {
        "BLDG_ID": "37183000001", "OCCUP_TYPE": "2245", "BUILD_TYPE": "3040",
        "FOUND_TYPE": "3050", "NUM_STORY": "1001", "FLD_ZONE": "4002", "YEAR_BUILT": "1955",
        "YRBUILTSRC": "3000", "BLDGREPVAL": 140392.56, "BLDVAL_SRC": "2000", "HTD_SQ_FT": 1848,
        "FFE": 355.0, "FFE_TYP": "1060", "LIDAR_LAG": 345.0,
    }  # fmt: skip
    row.update(overrides)
    return gpd.GeoDataFrame([row], geometry=[box(-78.65, 35.82, -78.6499, 35.8201)], crs=4326)


def test_split_label():
    assert split_label("WOOD - HAZUS DERIVED") == ("WOOD", "HAZUS DERIVED")
    assert split_label("RES3A - FIELD DERIVED - HIGH CONFIDENCE") == (
        "RES3A",
        "FIELD DERIVED - HIGH CONFIDENCE",
    )
    assert split_label("NOT PROVIDED") == (None, None)
    assert split_label(None) == (None, None)
    assert split_label(float("nan")) == (None, None)


@pytest.mark.parametrize(
    "label,expected",
    [
        ("1", 1.0),
        ("1 1/2", 1.5),
        ("2", 2.0),
        ("MORE THAN 5", 6.0),
        ("SPLIT LEVEL", 1.5),
        (None, None),
    ],
)
def test_parse_stories(label, expected):
    assert parse_stories(label) == expected


def test_decode_units_and_codes():
    b = decode(raw_frame(), DOMAINS).iloc[0]
    assert b["construction"] == "WOOD" and b["construction_src"] == "HAZUS DERIVED"
    assert b["occupancy"] == "RES1"
    assert b["foundation"] == "SLAB ON GRADE"
    assert b["stories"] == 1.5
    assert b["ffe_m"] == pytest.approx(355.0 * M_PER_FT)  # feet -> meters internally
    assert b["year"] == 1955
    assert b["ffe_src"] == "AERIAL LIDAR DERIVED"


def test_decode_missing_values_are_null_not_filled():
    b = decode(
        raw_frame(BUILD_TYPE="NP", BLDGREPVAL=-8888, YEAR_BUILT=None, HTD_SQ_FT=None), DOMAINS
    ).iloc[0]
    assert b["construction"] is None
    assert pd.isna(b["value_rep_usd"])
    assert pd.isna(b["year"])
    assert pd.isna(b["sqft"])


def test_height_priority():
    nc = decode(raw_frame(), DOMAINS)
    fp = nc.geometry.iloc[0]
    osm = gpd.GeoDataFrame(
        {"osm_id": ["way/1"], "height": ["30 ft"], "building:levels": ["9"]},
        geometry=[fp],
        crs=4326,
    )
    ov = gpd.GeoDataFrame(
        {"id": ["x"], "height": [12.0], "num_floors": [3]}, geometry=[fp], crs=4326
    )
    h = add_heights(nc, osm, ov).iloc[0]
    assert h["height_src"] == "osm:height" and h["height_m"] == pytest.approx(
        round(30 * M_PER_FT, 1)
    )
    h2 = add_heights(nc, osm.drop(columns=["height"]), ov).iloc[0]
    assert h2["height_src"] == "overture:height" and h2["height_m"] == 12.0
    empty = gpd.GeoDataFrame({"id": [], "height": [], "num_floors": []}, geometry=[], crs=4326)
    h3 = add_heights(nc, osm.iloc[0:0], empty).iloc[0]
    assert h3["height_src"] == "nc:stories×3m" and h3["height_m"] == 4.5
    assert np.isnan(
        add_heights(decode(raw_frame(NUM_STORY=None), DOMAINS), osm.iloc[0:0], empty).iloc[0][
            "height_m"
        ]
    )


def test_classify_extras_uses_osm_tag_only():
    from pipeline.models.buildings import classify_extras

    fp1, fp2 = box(-78.65, 35.82, -78.6498, 35.8202), box(-78.64, 35.82, -78.6398, 35.8202)
    extra = gpd.GeoDataFrame(
        {"id": ["a", "b"], "height": [12.0, 6.0], "num_floors": [None, None]},
        geometry=[fp1, fp2],
        crs=4326,
    )
    osm = gpd.GeoDataFrame(
        {
            "osm_id": ["way/1", "way/2"],
            "building": ["apartments", "yes"],
            "building:levels": ["4", None],
        },
        geometry=[fp1, fp2],
        crs=4326,
    )
    out = classify_extras(extra, osm).set_index("id")
    assert out.loc["a", "occupancy"] == "RES3"
    assert out.loc["a", "occupancy_src"] == "OSM building=apartments"
    assert out.loc["a", "stories"] == 4
    assert pd.isna(out.loc["b", "occupancy"])  # building=yes says nothing: no class invented
    assert out["sqft_estimated"].all()
