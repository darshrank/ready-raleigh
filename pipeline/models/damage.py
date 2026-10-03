"""Depth–damage lookup (DATA.md §3.2). Curves: USACE go-consequences occtypes.json (MIT).

Depth is feet of water above the first floor. RES1 curves are Normal distributions (we return
mean and mean ± 1 sd); others are deterministic. Depths beyond a curve's range clamp to its ends;
below its first point damage is 0.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

DDF_PATH = Path(__file__).resolve().parents[1] / "config" / "ddf" / "occtypes.json"


@dataclass(frozen=True)
class Curve:
    key: str
    source: str
    x: np.ndarray  # depth ft above first floor
    mean: np.ndarray  # % damage
    sd: np.ndarray  # % (0 for deterministic)

    def __call__(self, depth_ft):
        d = np.asarray(depth_ft, dtype=float)
        m = np.interp(d, self.x, self.mean, left=0.0, right=self.mean[-1])
        s = np.interp(d, self.x, self.sd, left=0.0, right=self.sd[-1])
        lo = np.clip(m - s, 0, 100)
        hi = np.clip(m + s, 0, 100)
        return np.clip(m, 0, 100), lo, hi


@lru_cache(maxsize=1)
def _occtypes() -> dict:
    return json.loads(DDF_PATH.read_text())["occupancytypes"]


@lru_cache(maxsize=128)
def curve(key: str) -> Curve:
    o = _occtypes()[key]
    fns = o["componentdamagefunctions"]["structure"]["damagefunctions"]
    f = fns.get("depth") or fns["default"]
    df = f["damagefunction"]
    means, sds = [], []
    for y in df["ydistributions"]:
        p = y.get("parameters", {})
        if y["type"] == "NormalDistribution":
            means.append(p["mean"])
            sds.append(p.get("standarddeviation", 0.0))
        elif y["type"] == "DeterministicDistribution":
            means.append(p["value"])
            sds.append(0.0)
        else:
            raise ValueError(f"{key}: unsupported distribution {y['type']}")
    return Curve(
        key,
        f["source"],
        np.array(df["xvalues"], float),
        np.array(means, float),
        np.array(sds, float),
    )


def curve_key(occupancy: str | None, stories: float | None, foundation: str | None) -> str | None:
    """Map an NC building to a go-consequences occupancy type. None = no curve (no class)."""
    if not isinstance(occupancy, str) or not occupancy:
        return None
    occ = occupancy.upper()
    foundation = foundation if isinstance(foundation, str) else None
    stories = float(stories) if stories is not None and stories == stories else None
    if occ.startswith("RES1"):
        basement = "WB" if (foundation or "").upper() == "BASEMENT" else "NB"
        if stories is None:
            return f"RES1-1S{basement}"
        n = 1 if stories < 1.75 else 2 if stories < 2.75 else 3
        return f"RES1-{n}S{basement}"
    if occ == "RES3":
        return "RES3A"
    types = _occtypes()
    return occ if occ in types else None
