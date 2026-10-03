import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import box

from pipeline.areas import Area
from pipeline.models.people import build_residents, largest_remainder

AREA = Area("t", "test", (-78.70, 35.80, -78.60, 35.85), "37183")


def rbox(x0, y0, x1, y1):
    """Unit-square coordinates -> a box inside the Raleigh test area (real UTM 17N areas)."""
    return box(-78.70 + x0 * 0.1, 35.80 + y0 * 0.05, -78.70 + x1 * 0.1, 35.80 + y1 * 0.05)


W = {
    "base": 1.0,
    "age_65_plus": 0.5,
    "no_vehicle": 0.5,
    "below_poverty": 0.5,
    "limited_english": 0.25,
}


def test_largest_remainder_sums_exactly_and_is_proportional():
    out = largest_remainder(np.array([1, 1, 1]), 10)
    assert out.sum() == 10 and sorted(out) == [3, 3, 4]
    assert largest_remainder(np.array([0, 0]), 5).sum() == 0
    assert list(largest_remainder(np.array([3, 1]), 4)) == [3, 1]


def _fixture():
    # One BG with two blocks: block A in the area, block B outside it.
    blocks = gpd.GeoDataFrame(
        {"GEOID20": ["371830001001000", "371830001001001"], "POP20": [80, 20]},
        geometry=[rbox(0.1, 0.1, 0.5, 0.5), rbox(2, 2, 3, 3)],
        crs=4326,
    )
    bld = gpd.GeoDataFrame(
        {
            "id": ["b1", "b2", "c1"],
            "occupancy": ["RES1", "RES3A", "COM1"],
            "sqft": [1000.0, 3000.0, 50000.0],
            "stories": [1.0, 3.0, 2.0],
        },
        geometry=[
            rbox(0.2, 0.2, 0.21, 0.21),
            rbox(0.3, 0.3, 0.31, 0.31),
            rbox(0.4, 0.4, 0.41, 0.41),
        ],
        crs=4326,
    )
    acs = pd.DataFrame(
        {
            "GEOID": ["371830001001"],
            "pop_total": [110],
            "age_universe": [110],
            "age_65_plus": [22],
            "hh_vehicle_universe": [40],
            "hh_no_vehicle": [4],
            "poverty_universe": [100],
            "below_poverty": [10],
            "hh_language_universe": [40],
            "hh_limited_english": [2],
        }  # fmt: skip
    )
    return bld, blocks, acs


def test_residents_follow_acs_target_and_sqft_shares():
    bld, blocks, acs = _fixture()
    r = build_residents(AREA, bld, blocks, acs, W, seed=7)
    # Target = ACS 110 × (80 in-area / 100 BG) = 88, all in block A, split 1:3 by sqft.
    assert r.summary["acs_target_total"] == 88.0
    assert r.summary["residents_placed"] == 88
    counts = r.table["building_id"].value_counts().to_dict()
    assert counts == {"b2": 66, "b1": 22}
    assert "c1" not in counts  # commercial buildings get no residents


def test_residents_are_reproducible_with_seed():
    bld, blocks, acs = _fixture()
    a = build_residents(AREA, bld, blocks, acs, W, seed=7).table
    b = build_residents(AREA, bld, blocks, acs, W, seed=7).table
    pd.testing.assert_frame_equal(a, b)
    w = a["weight"]
    assert (w >= 1.0).all() and (w <= 2.75).all()


def test_census_housing_inference_only_where_no_residential_building():
    bld, blocks, acs = _fixture()
    # Block A loses its residential buildings' class: only an unlabeled footprint remains there.
    bld = bld.copy()
    bld.loc[bld["id"] == "b1", "occupancy"] = None  # ~900×550 m footprint, no use record
    bld.loc[bld["id"] == "b2", "occupancy"] = "COM1"
    blocks = blocks.assign(HOUSING20=[30, 5])
    r = build_residents(AREA, bld, blocks, acs, W, seed=7)
    assert r.inferred["id"].tolist() == ["b1"]
    assert r.summary["residents_placed"] == 88
    assert set(r.table["building_id"]) == {"b1"}


def test_no_inference_when_block_already_has_housing():
    bld, blocks, acs = _fixture()
    bld = bld.copy()
    bld.loc[bld["id"] == "c1", "occupancy"] = None
    r = build_residents(AREA, bld, blocks.assign(HOUSING20=[30, 5]), acs, W, seed=7)
    assert r.inferred.empty
