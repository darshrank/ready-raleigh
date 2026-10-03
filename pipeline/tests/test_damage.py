import numpy as np
import pytest

from pipeline.models.damage import curve, curve_key


def test_known_curve_values():
    # Values read directly from USACE go-consequences occtypes.json.
    m, lo, hi = curve("RES1-1SNB")(4.0)
    assert m == pytest.approx(47.1, abs=0.05)
    assert lo < m < hi
    m, lo, hi = curve("RES2")(2.0)
    assert m == pytest.approx(63.0) and lo == m == hi  # deterministic
    assert curve("RES3A")(4.0)[0] == pytest.approx(36.0)
    assert curve("COM1")(4.0)[0] == pytest.approx(18.0)


def test_interpolation_and_clamping():
    c = curve("RES1-1SNB")
    m1, _, _ = c(1.0)
    m2, _, _ = c(2.0)
    mid, _, _ = c(1.5)
    assert mid == pytest.approx((m1 + m2) / 2)
    assert c(-10.0)[0] == 0.0  # below the curve: no damage
    assert c(100.0)[0] == c(16.0)[0]  # beyond: clamp to last point
    assert np.all(np.diff(c(np.arange(-2, 16, 0.5))[0]) >= 0)  # monotone


@pytest.mark.parametrize(
    "occ,stories,found,key",
    [
        ("RES1", 1.0, "SLAB ON GRADE", "RES1-1SNB"),
        ("RES1", 2.0, "BASEMENT", "RES1-2SWB"),
        ("RES1", 1.5, "CRAWL SPACE", "RES1-1SNB"),
        ("RES1", 3.0, None, "RES1-3SNB"),
        ("RES3", None, None, "RES3A"),
        ("RES3B", 3.0, None, "RES3B"),
        ("COM4", 2.0, None, "COM4"),
        (None, 1.0, None, None),
    ],
)
def test_curve_key(occ, stories, found, key):
    assert curve_key(occ, stories, found) == key


def test_curve_key_handles_missing_values():
    assert curve_key(float("nan"), 1.0, None) is None
    assert curve_key("RES1", float("nan"), float("nan")) == "RES1-1SNB"
