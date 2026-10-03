import json
from pathlib import Path

import pytest

from pipeline.rounds import CLUE_CARD, PIN_SCALE_M, explain, select

OUT = Path(__file__).resolve().parents[1] / "out" / "crabtree" / "rounds.json"


def _c(kind, typ, key, xy, interest):
    return {"kind": kind, "type": typ, "_key": key, "_xy": xy, "interest": interest}


def test_pin_scale_is_square_diagonal_over_10():
    assert PIN_SCALE_M == pytest.approx(2000 * 2**0.5 / 10)


def test_select_dedupes_and_spreads():
    cands = [
        _c("depth_1pct", "A", "b1", (0, 0), 0.9),
        _c("depth_1pct", "A", "b1", (0, 0), 0.8),  # same truth feature
        _c("depth_1pct", "A", "b2", (100, 0), 0.7),  # same kind, too close
        _c("depth_1pct", "A", "b3", (2000, 0), 0.6),
        _c("first_road", "B", "r1", (0, 0), 0.5),
    ]
    picked = select(cands, 5, 5)
    assert [p["_key"] for p in picked] == ["b1", "b3", "r1"]


def test_explain_names_field_guide_cards():
    t = explain("store", ["culvert_within_150m"], "Water gets inside at 18.0 ft.")
    assert t.startswith("This store: Water gets inside at 18.0 ft.")
    assert CLUE_CARD["culvert_within_150m"] in t


@pytest.mark.skipif(not OUT.exists(), reason="pack not built")
def test_built_round_bank_is_well_formed():
    d = json.loads(OUT.read_text())
    assert {"pack_version", "built_at", "sources"} <= d.keys()
    rounds = d["rounds"]
    assert len(rounds) >= 20
    assert {r["type"] for r in rounds} == {"A", "B"}
    for r in rounds:
        assert r["source"]["dataset"] and r["source"]["method"]
        assert r["tolerance"]["s"] > 0
        assert r["explanation"]
        if r["input"]["kind"] == "slider":
            assert r["input"]["min"] <= r["truth"]["value"] <= r["input"]["max"]
        else:
            assert r["truth"]["points"]
            lo0, la0, lo1, la1 = r["square"]
            assert any(
                lo0 - 0.01 <= x <= lo1 + 0.01 and la0 - 0.01 <= y <= la1 + 0.01
                for x, y in r["truth"]["points"]
            )
