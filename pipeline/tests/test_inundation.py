"""HAND inundation on a synthetic DEM: a V-shaped valley with a straight stream down the middle."""

import geopandas as gpd
import numpy as np
import pytest
import rasterio
from shapely.geometry import LineString

from pipeline.models import hand as H

RES = 3.0
X0, Y0 = 700000.0, 3970000.0  # UTM 17N, inside the zone


@pytest.fixture(scope="module")
def valley(tmp_path_factory):
    """60 x 61 cells. Stream along column 30, flowing south (row 0 -> 59).
    Elevation = 100 m + 0.5 m per cell away from the stream + 0.02 m per row upstream."""
    work = tmp_path_factory.mktemp("valley")
    rows, cols = 60, 61
    r, c = np.mgrid[0:rows, 0:cols]
    dem = (100.0 + 0.5 * np.abs(c - 30) + 0.02 * (rows - 1 - r)).astype("float32")
    transform = rasterio.transform.from_origin(X0, Y0, RES, RES)
    path = work / "dem.tif"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=cols,
        height=rows,
        count=1,
        dtype="float32",
        crs="EPSG:32617",
        transform=transform,
        nodata=np.nan,
    ) as dst:
        dst.write(dem, 1)
    x = X0 + 30.5 * RES
    line = LineString([(x, Y0 - 0.5 * RES), (x, Y0 - (rows - 0.5) * RES)])  # upstream -> downstream
    fl = gpd.GeoDataFrame(
        {
            "nhdplusid": [1],
            "gnis_name": ["Test Creek"],
            "totdasqkm": [10.0],
            "hydroseq": [1],
            "dnhydroseq": [0],
        },
        geometry=[line],
        crs=32617,
    )
    res = H.compute_hand(path, fl, work)
    return res, dem


def test_hand_is_height_above_stream(valley):
    res, dem = valley
    # Channel elevation = min DEM within CHANNEL_SEARCH_CELLS (2) of the mapped line, i.e. two
    # rows downstream here: 2 * 0.02 m lower. So on the stream HAND = 0.04 m, and 4 cells away
    # it is 4 * 0.5 + 0.04 m.
    slack = H.CHANNEL_SEARCH_CELLS * 0.02
    assert res.hand[30, 30] == pytest.approx(slack, abs=1e-4)
    assert res.hand[30, 34] == pytest.approx(2.0 + slack, abs=1e-3)
    assert res.hand[30, 26] == pytest.approx(2.0 + slack, abs=1e-3)
    assert (res.hand[~np.isnan(res.hand)] >= 0).all()


def test_inundation_width_matches_depth(valley):
    res, dem = valley
    ratio = H.reach_ratio(res, 1)
    for depth in (1.0, 2.5):
        wet = H.depth_grid(res, ratio, depth) > 0
        width_cells = wet[30].sum()
        # Wet where 0.5*|dx| + 0.04 < depth  ->  |dx| < 2*(depth - 0.04).
        half = int(np.ceil(2 * (depth - 0.04)) - 1)
        assert width_cells == 2 * half + 1
    # Monotone: higher water never makes a wet cell dry.
    w1 = H.depth_grid(res, ratio, 1.0) > 0
    w2 = H.depth_grid(res, ratio, 2.0) > 0
    assert not (w1 & ~w2).any()


def test_depth_scales_with_drainage_area():
    import pandas as pd

    class R:  # minimal stand-in
        reaches = pd.DataFrame({"totdasqkm": [300.0, 3.0]}, index=[1, 2])

    ratio = H.reach_ratio(R, 1)
    assert ratio[1] == pytest.approx(1.0)
    assert ratio[2] == pytest.approx((3.0 / 300.0) ** 0.3)


def test_backwater_floor_raises_tributary():
    import pandas as pd

    class R:
        reaches = pd.DataFrame(
            {"totdasqkm": [300.0, 3.0], "hydroseq": [1, 2], "dnhydroseq": [0, 1]}, index=[1, 2]
        )

    ratio = H.reach_ratio(R, 1)
    up_el = np.array([np.nan, 50.0, 60.0])
    out_el = np.array([np.nan, 49.0, 50.0])
    floor = H.backwater_floor(R, ratio, 5.0, (out_el, up_el))
    # Tributary 2 joins at the top of reach 1, whose WSE there is 50 + 1.0*5 = 55 m.
    assert floor[2] == pytest.approx(55.0)
    assert np.isnan(floor[1])


def test_backwater_floor_skips_pits_below_base_flow():
    import pandas as pd

    class R:
        reaches = pd.DataFrame({"totdasqkm": [300.0, 3.0]}, index=[1, 2])
        reach = np.array([[2, 2, 2]])
        channel = np.array([[50.0, 50.0, 50.0]])

    ratio = H.reach_ratio(R, 1)
    floor = np.array([np.nan, np.nan, 55.0])
    base = np.array([np.nan, np.nan, 50.0])
    dem = np.array([[49.0, 52.0, 56.0]])  # a pit below base flow, a bank cell, a high cell
    w = H.wse_grid(R, ratio, 0.5, floor, base, dem)
    assert w[0, 0] < 50.5  # pit: own reach only, no backwater pool
    assert w[0, 1] == pytest.approx(55.0)  # bank above base flow gets the backwater WSE
    assert w[0, 2] == pytest.approx(55.0)  # (dry: 56 > 55)
