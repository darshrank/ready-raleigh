"""Round bank (DATA.md §6). Types A (estimate) and B (pin); C (build) arrives in M5.

Each round = one ~2 km square + one question + one input, with a precomputed truth, a
tolerance from data uncertainty, clue tags computed from features, a template explanation
(coach fallback) and provenance. Candidates are generated on a 1 km grid of 2 km squares,
scored for "interestingness" and the best are kept.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import Point, box

M_PER_FT = 0.3048
SQUARE_M = 2000.0
GRID_M = 1000.0
PIN_SCALE_M = SQUARE_M * math.sqrt(2) / 10  # PLAN §5: area diagonal / 10 (round square)
UTM = 32617

OCC_LABEL = {
    "RES1": "single-family home", "RES2": "manufactured home", "RES3": "apartment building",
    "RES4": "hotel", "RES5": "dormitory", "RES6": "nursing home", "COM1": "store",
    "COM2": "warehouse", "COM3": "service business", "COM4": "office building",
    "COM5": "bank", "COM6": "hospital", "COM7": "medical office", "COM8": "restaurant or venue",
    "COM9": "theater", "COM10": "parking garage", "EDU1": "school", "EDU2": "college building",
    "GOV1": "government building", "GOV2": "emergency services building", "REL1": "church",
    "IND1": "factory", "IND2": "factory", "IND3": "factory", "IND4": "factory",
    "IND5": "factory", "IND6": "construction yard", "AGR1": "farm building",
}  # fmt: skip

# Clue id -> Field Guide card name (PLAN §6.1). Only clues computed from data are used.
CLUE_CARD = {
    "creek_low_bowl": "Creek + low bowl",
    "culvert_within_150m": "Culvert under road",
    "one_road_out": "One road out",
    "manufactured": "Manufactured home in floodplain",
    "slab": "Slab vs raised foundation",
    "basement": "Slab vs raised foundation",
    "big_creek": "Big watershed upstream",
    "no_car_households": "No-car households",
}
CLUE_DETAIL = {
    "creek_low_bowl": "less than 5 ft above the nearest creek, within 150 m of it",
    "culvert_within_150m": "a culvert within 150 m can back water up",
    "one_road_out": "its only road out floods before the 1% stage",
    "manufactured": "manufactured homes sit low and are easily damaged",
    "slab": "a slab-on-grade floor sits close to the ground",
    "basement": "a basement takes water first",
    "big_creek": "the creek here drains more than 100 km²",
    "no_car_households": "1 in 10 or more households can't drive out",
}


@dataclass
class Ctx:
    area_bbox: tuple[float, float, float, float]
    to_utm: Transformer
    to_ll: Transformer
    stages: list[float]
    action_ft: float
    one_pct_idx: int
    hand: np.ndarray
    reach: np.ndarray
    transform: object
    reaches: gpd.GeoDataFrame  # UTM
    culverts: gpd.GeoDataFrame  # UTM
    behind_closable: set = field(default_factory=set)


def squares(bbox) -> list[tuple[float, float, float, float]]:
    """2 km squares on a 1 km grid, fully inside the area (UTM)."""
    tr = Transformer.from_crs(4326, UTM, always_xy=True)
    xs, ys = tr.transform([bbox[0], bbox[2]], [bbox[1], bbox[3]])
    out = []
    for cx in np.arange(xs[0] + SQUARE_M / 2, xs[1] - SQUARE_M / 2 + 1, GRID_M):
        for cy in np.arange(ys[0] + SQUARE_M / 2, ys[1] - SQUARE_M / 2 + 1, GRID_M):
            out.append((cx - SQUARE_M / 2, cy - SQUARE_M / 2, cx + SQUARE_M / 2, cy + SQUARE_M / 2))
    return out


def _ll(ctx: Ctx, x: float, y: float) -> list[float]:
    lon, lat = ctx.to_ll.transform(x, y)
    return [round(lon, 6), round(lat, 6)]


def _square_ll(ctx: Ctx, sq) -> list[float]:
    a = _ll(ctx, sq[0], sq[1])
    b = _ll(ctx, sq[2], sq[3])
    return [a[0], a[1], b[0], b[1]]


def hand_at(ctx: Ctx, x: float, y: float) -> tuple[float, int]:
    import rasterio

    r, c = rasterio.transform.rowcol(ctx.transform, x, y)
    return float(ctx.hand[r, c]), int(ctx.reach[r, c])


def clues_at(ctx: Ctx, x: float, y: float, building=None, node=None) -> list[str]:
    out = []
    h, rid = hand_at(ctx, x, y)
    p = Point(x, y)
    if not math.isnan(h) and h < 5 * M_PER_FT and ctx.reaches.distance(p).min() < 150:
        out.append("creek_low_bowl")
    if len(ctx.culverts) and ctx.culverts.distance(p).min() < 150:
        out.append("culvert_within_150m")
    if node is not None and node in ctx.behind_closable:
        out.append("one_road_out")
    if rid and float(ctx.reaches.loc[rid, "totdasqkm"]) > 100:
        out.append("big_creek")
    if building is not None:
        if building.get("construction") == "MANUFCHOME" or str(
            building.get("occupancy")
        ).startswith("RES2"):
            out.append("manufactured")
        if building.get("foundation") == "SLAB ON GRADE":
            out.append("slab")
        if building.get("foundation") == "BASEMENT":
            out.append("basement")
    return out


def explain(subject: str, clues: list[str], fact: str) -> str:
    """Template explanation (coach fallback): the fact, then the clues that point to it."""
    text = f"This {subject}: {fact}"
    if clues:
        text += " Clues: " + "; ".join(f"{CLUE_CARD[c]} — {CLUE_DETAIL[c]}" for c in clues) + "."
    return text


def behind_closable_bridges(g: nx.MultiDiGraph, closure: dict, limit_idx: int) -> set:
    """Nodes cut off from the rest of the network when a graph-bridge road edge that floods by
    the 1% stage closes ("one road out")."""
    ug = nx.Graph(g.to_undirected(as_view=False))
    out = set()
    for u, v in nx.bridges(ug):
        stages = [closure.get((a, b)) for a, b in ((u, v), (v, u))]
        stages = [s for s in stages if s is not None]
        if not stages or min(stages) > limit_idx:
            continue
        h = ug.copy()
        h.remove_edge(u, v)
        side = min(nx.node_connected_component(h, u), nx.node_connected_component(h, v), key=len)
        if len(side) < 0.2 * ug.number_of_nodes():
            out |= side
    return out


# ---------------------------------------------------------------- round generators
def depth_rounds(ctx, sq, bld_utm, dmg, tol_ft, src) -> list[dict]:
    """A: water depth above the first floor in the 1% flood (one building)."""
    x0, y0, x1, y1 = sq
    inside = bld_utm.cx.__getitem__((slice(x0, x1), slice(y0, y1)))
    out = []
    for _, b in inside.iterrows():
        r = dmg.get(b["id"])
        if not r or r["first_wet_stage"] > ctx.one_pct_idx:
            continue
        depth = r["depth_ft"][ctx.one_pct_idx - r["first_wet_stage"]]
        if not 0.5 <= depth <= 10:
            continue
        first_floor_wet = next(
            (ctx.stages[r["first_wet_stage"] + i] for i, d in enumerate(r["depth_ft"]) if d > 0),
            None,
        )
        if first_floor_wet is None or first_floor_wet < ctx.action_ft:
            continue
        measured = isinstance(b["ffe_src"], str) and "AERIAL" not in b["ffe_src"]
        c = b.geometry.centroid
        clues = clues_at(ctx, c.x, c.y, b, b.get("node"))
        subject = OCC_LABEL.get(
            str(b["occupancy"])[:4].rstrip("ABCDEF") if b["occupancy"] else "", "building"
        )
        interest = (
            (1.0 if measured else 0.7) * (1.0 if 1 <= depth <= 6 else 0.8) * (1 + 0.15 * len(clues))
        )
        out.append(
            {
                "type": "A",
                "kind": "depth_1pct",
                "question": "In a 1%-chance flood, how deep would water be above this building's first floor?",
                "short": "Water above the first floor (1% flood)",
                "focus": {"building_id": b["id"], "point": _ll(ctx, c.x, c.y)},
                "input": {"kind": "slider", "min": 0, "max": 12, "step": 0.5, "units": "ft"},
                "truth": {"value": round(float(depth), 1)},
                "tolerance": {
                    "s": tol_ft,
                    "units": "ft",
                    "basis": "median absolute error of modeled water surface vs FEMA cross-sections (validation.json)",
                },
                "clues": clues,
                "explanation": explain(
                    subject,
                    clues,
                    f"In the 1% flood (gauge {ctx.stages[ctx.one_pct_idx]} ft) water stands {depth:.1f} ft above its first floor; it first gets inside at {first_floor_wet} ft.",
                ),
                "facts": {
                    "first_floor_wet_stage_ft": first_floor_wet,
                    "ffe_source": b["ffe_src"],
                    "construction": b["construction"],
                    "occupancy": b["occupancy"],
                    "year": None if pd.isna(b["year"]) else int(b["year"]),
                },
                "source": {
                    **src["depth"],
                    "method": src["depth"]["method"]
                    + (
                        " FFE measured (laser/survey)."
                        if measured
                        else " FFE estimated from aerial lidar."
                    ),
                },
                "interest": round(interest, 3),
                "_xy": (c.x, c.y),
                "_key": f"bldg:{b['id']}",
            }
        )
    out.sort(key=lambda r: -r["interest"])
    return out[:2]


def first_building_rounds(ctx, sq, bld_utm, dmg, src) -> list[dict]:
    """B: which building gets water above its first floor first (at or above action stage)."""
    x0, y0, x1, y1 = sq
    inside = bld_utm.cx.__getitem__((slice(x0, x1), slice(y0, y1)))
    cands = []
    for _, b in inside.iterrows():
        r = dmg.get(b["id"])
        if not r:
            continue
        s = next(
            (ctx.stages[r["first_wet_stage"] + i] for i, d in enumerate(r["depth_ft"]) if d > 0),
            None,
        )
        if s is not None and s >= ctx.action_ft:
            c = b.geometry.centroid
            cands.append((s, b, c))
    if len(cands) < 3:
        return []
    cands.sort(key=lambda t: t[0])
    first = cands[0][0]
    ties = [t for t in cands if t[0] <= first + 0.25][:5]
    b0, c0 = ties[0][1], ties[0][2]
    clues = clues_at(ctx, c0.x, c0.y, b0, b0.get("node"))
    spread = cands[min(len(cands) - 1, 5)][0] - first
    interest = min(spread, 3.0) / 3.0 * (1 + 0.15 * len(clues)) * (1.0 if len(ties) == 1 else 0.8)
    subject = OCC_LABEL.get(
        str(b0["occupancy"])[:4].rstrip("ABCDEF") if b0["occupancy"] else "", "building"
    )
    return [
        {
            "type": "B",
            "kind": "first_building",
            "question": "As Crabtree Creek rises past action stage, which building gets water inside first? Drop a pin.",
            "short": "First building to flood",
            "input": {"kind": "pin"},
            "truth": {"points": [_ll(ctx, t[2].x, t[2].y) for t in ties], "stage_ft": first},
            "tolerance": {
                "s": round(PIN_SCALE_M),
                "units": "m",
                "basis": "round square diagonal / 10 (PLAN §5)",
            },
            "clues": clues,
            "explanation": explain(
                subject,
                clues,
                f"Water gets above its first floor when the Anderson Dr gauge reads {first} ft.",
            ),
            "source": src["depth"],
            "interest": round(interest, 3),
            "_xy": (c0.x, c0.y),
            "_key": f"firstbldg:{b0['id']}",
        }
    ]


def first_road_rounds(ctx, sq, roads_utm, src) -> list[dict]:
    """B: which road goes under first once the creek passes action stage."""
    x0, y0, x1, y1 = sq
    inside = roads_utm[roads_utm.intersects(box(x0, y0, x1, y1))]
    inside = inside[inside["closure_ft"].notna() & (inside["closure_ft"] >= ctx.action_ft)]
    if len(inside) < 3:
        return []
    first = inside["closure_ft"].min()
    ties = inside[inside["closure_ft"] <= first + 0.25]
    if ties["name"].nunique(dropna=False) > 2:
        return []  # too ambiguous
    pts = [g.interpolate(0.5, normalized=True) for g in ties.geometry][:6]
    names = [n for n in ties["name"].dropna().unique()]
    spread = sorted(inside["closure_ft"].unique())[:4]
    interest = (spread[-1] - first) / 3.0 if len(spread) > 1 else 0.2
    clues = clues_at(ctx, pts[0].x, pts[0].y)
    road = names[0] if names else "this road"
    return [
        {
            "type": "B",
            "kind": "first_road",
            "question": "As Crabtree Creek rises past action stage, which road goes under first? Drop a pin on it.",
            "short": "First road to flood",
            "input": {"kind": "pin"},
            "truth": {
                "points": [_ll(ctx, p.x, p.y) for p in pts],
                "stage_ft": float(first),
                "name": road,
            },
            "tolerance": {
                "s": round(PIN_SCALE_M),
                "units": "m",
                "basis": "round square diagonal / 10 (PLAN §5)",
            },
            "clues": clues,
            "explanation": explain(
                "road",
                clues,
                f"{road} closes when the Anderson Dr gauge reads {first} ft (more than 6 in of water over the pavement).",
            ),
            "source": src["roads"],
            "interest": round(min(interest, 1.0) * (1 + 0.15 * len(clues)), 3),
            "_xy": (pts[0].x, pts[0].y),
            "_key": f"road:{road}:{first}",
        }
    ]


def claims_rounds(ctx, sq, tracts_utm, src) -> list[dict]:
    """B: where flood insurance claims are most concentrated (tract-level truth)."""
    x0, y0, x1, y1 = sq
    sqg = box(x0, y0, x1, y1)
    t = tracts_utm[tracts_utm.intersects(sqg)].copy()
    t["frac"] = t.geometry.intersection(sqg).area / t.geometry.area
    t = t[(t["frac"] > 0.3) & (t["claims"] >= 5)]
    if len(t) < 2:
        return []
    t = t.sort_values("claims", ascending=False)
    top, second = t.iloc[0], t.iloc[1]
    if top["claims"] < 1.5 * second["claims"]:
        return []
    clipped = top.geometry.intersection(
        box(
            *ctx.to_utm.transform(ctx.area_bbox[0], ctx.area_bbox[1]),
            *ctx.to_utm.transform(ctx.area_bbox[2], ctx.area_bbox[3]),
        )
    )
    p = clipped.representative_point()
    s = max(PIN_SCALE_M, math.sqrt(top.geometry.area) / 2)
    return [
        {
            "type": "B",
            "kind": "claims_tract",
            "question": "Where have flood insurance claims been most concentrated? Drop a pin.",
            "short": "Most flood insurance claims",
            "input": {"kind": "pin"},
            "truth": {
                "points": [_ll(ctx, p.x, p.y)],
                "tract": top["censusTract"],
                "claims": int(top["claims"]),
            },
            "tolerance": {
                "s": round(s),
                "units": "m",
                "basis": "tract-level truth: tolerance widened to half the tract's width (PLAN §5)",
            },
            "clues": [],
            "explanation": f"Census tract {top['censusTract'][-6:]} has {int(top['claims'])} NFIP flood insurance claims on record — {top['claims'] / second['claims']:.1f}× the next tract nearby. Claims are only shown by tract, never by address.",
            "source": src["claims"],
            "interest": round(min(top["claims"] / max(second["claims"], 1) / 3, 1.0), 3),
            "_xy": (p.x, p.y),
            "_key": f"tract:{top['censusTract']}",
        }
    ]


def no_vehicle_rounds(ctx, sq, bgs_utm, src) -> list[dict]:
    """A: share of households with no vehicle in the block group at the square's centre."""
    cx, cy = (sq[0] + sq[2]) / 2, (sq[1] + sq[3]) / 2
    hit = bgs_utm[bgs_utm.contains(Point(cx, cy))]
    if hit.empty:
        return []
    bg = hit.iloc[0]
    if bg["hh_vehicle_universe"] < 150 or not (bg["p_no_vehicle_moe90"] < 0.12):
        return []
    pct = 100 * bg["hh_no_vehicle"] / bg["hh_vehicle_universe"]
    s = max(100 * float(bg["p_no_vehicle_moe90"]), 3.0)
    c = bg.geometry.representative_point()
    clues = ["no_car_households"] if pct >= 10 else []
    return [
        {
            "type": "A",
            "kind": "no_vehicle_pct",
            "question": "What share of households in the highlighted neighborhood have no car?",
            "short": "Households with no car",
            "focus": {"block_group": bg["GEOID"], "point": _ll(ctx, c.x, c.y)},
            "input": {"kind": "slider", "min": 0, "max": 50, "step": 1, "units": "%"},
            "truth": {"value": round(float(pct), 1)},
            "tolerance": {
                "s": round(s, 1),
                "units": "%",
                "basis": "ACS 90% margin of error for this block group (min 3 points)",
            },
            "clues": clues,
            "explanation": f"{int(bg['hh_no_vehicle'])} of {int(bg['hh_vehicle_universe'])} households here ({pct:.0f}%, ±{100 * bg['p_no_vehicle_moe90']:.0f} pts) have no vehicle — they can't drive out of a flood and need a bus pickup or a shelter within walking distance.",
            "source": src["acs"],
            "interest": round(min(pct / 15, 1.0) * 0.9 + 0.1, 3),
            "_xy": (c.x, c.y),
            "_key": f"bg:{bg['GEOID']}",
        }
    ]


def select(cands: list[dict], n_a: int, n_b: int) -> list[dict]:
    """Best rounds per type with no duplicate truth feature and spatial spread (≥ 500 m apart)."""
    picked: list[dict] = []
    for typ, n in (("A", n_a), ("B", n_b)):
        pool = sorted([c for c in cands if c["type"] == typ], key=lambda c: -c["interest"])
        kinds_seen: dict[str, int] = {}
        for c in pool:
            if sum(1 for p in picked if p["type"] == typ) >= n:
                break
            if any(p["_key"] == c["_key"] for p in picked):
                continue
            if any(math.dist(p["_xy"], c["_xy"]) < 500 and p["kind"] == c["kind"] for p in picked):
                continue
            if kinds_seen.get(c["kind"], 0) >= max(n // 2, 3):
                continue
            kinds_seen[c["kind"]] = kinds_seen.get(c["kind"], 0) + 1
            picked.append(c)
    return picked


def camera_for(ctx: Ctx, r: dict) -> dict:
    x, y = r["_xy"]
    if r["kind"] == "depth_1pct":
        return {"center": _ll(ctx, x, y), "zoom": 17.4, "pitch": 60, "bearing": 0}
    return {
        "center": _ll(
            ctx,
            (r["square_utm"][0] + r["square_utm"][2]) / 2,
            (r["square_utm"][1] + r["square_utm"][3]) / 2,
        ),
        "zoom": 14.6,
        "pitch": 50,
        "bearing": 0,
    }


def finalize(ctx: Ctx, rounds: list[dict]) -> list[dict]:
    out = []
    for i, r in enumerate(rounds):
        r = dict(r)
        r["id"] = f"{r['kind']}-{i:02d}"
        r["square"] = _square_ll(ctx, r["square_utm"])
        r["camera"] = camera_for(ctx, r)
        for k in ("_xy", "_key", "square_utm"):
            r.pop(k, None)
        out.append(r)
    return out


def to_json(obj) -> str:
    return json.dumps(obj, default=lambda o: o.item() if hasattr(o, "item") else str(o))
