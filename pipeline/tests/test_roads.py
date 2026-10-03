import numpy as np

from pipeline.models.roads import CLOSE_DEPTH_M, closure_stage


def _sample(idx, bridge=False):
    idx = np.asarray(idx)
    return {"idx": idx, "ends": idx[[0, -1]], "bridge": bridge}


def test_road_closes_when_water_exceeds_half_foot():
    dem = np.array([10.0, 9.0, 10.0])
    stages = [
        np.full(3, 8.0),
        np.full(3, 9.0 + CLOSE_DEPTH_M / 2),
        np.full(3, 9.0 + 2 * CLOSE_DEPTH_M),
    ]
    assert closure_stage(_sample([0, 1, 2]), dem, stages) == 2


def test_bridge_uses_deck_not_creek_bed():
    # Bare-earth DEM: abutments at 12 m, creek bed 5 m under the deck.
    dem = np.array([12.0, 5.0, 12.0])
    stages = [np.full(3, 8.0), np.full(3, 11.0), np.full(3, 12.5)]
    assert closure_stage(_sample([0, 1, 2]), dem, stages) == 0  # as a road it would "close" at once
    assert closure_stage(_sample([0, 1, 2], bridge=True), dem, stages) == 2


def test_never_closed():
    assert closure_stage(_sample([0, 1]), np.array([10.0, 10.0]), [np.full(2, 5.0)]) is None


def test_notch_at_stream_crossing_becomes_deck():
    from pipeline.models.roads import notch_deck

    d = np.arange(0, 121, 6.0)  # samples every 6 m, crossing at 60 m
    ground = np.full(len(d), 70.0)
    ground[np.abs(d - 60) <= 12] = 64.0  # bare-earth notch where a bridge deck was removed
    deck = notch_deck(d, ground, [60.0])
    assert np.isfinite(deck[np.abs(d - 60) <= 30]).all()
    assert np.nanmax(deck) == 70.0
    assert np.isnan(deck[d < 25]).all()


def test_embankment_culvert_has_no_notch():
    from pipeline.models.roads import notch_deck

    d = np.arange(0, 121, 6.0)
    ground = 70.0 - 0.01 * d  # smooth embankment profile over a culvert
    assert np.isnan(notch_deck(d, ground, [60.0])).all()


def test_untagged_structure_closes_like_a_bridge():
    dem = np.array([70.0, 64.0, 70.0])
    smp = {
        "idx": np.array([0, 1, 2]),
        "ends": np.array([0, 2]),
        "bridge": False,
        "deck": np.array([np.nan, 70.0, np.nan]),
    }
    stages = [np.full(3, 66.0), np.full(3, 70.5)]
    assert closure_stage(smp, dem, stages) == 1  # not at 66 m (creek bed is 64 m)
