"""Model validation (PLAN.md §9, amended): results go to validation.json and METHODS.md.

- Flood WSE vs FEMA regulatory 1% WSE at NFHL cross-sections (replaces the USGS HWM backtest:
  STN has 0 high-water marks in Wake County for Matthew/Florence/Michael).
- Modeled 1% extent vs FEMA Zone AE (current-conditions SFHA): IoU, recall, precision.
- NWS impact statements at the gauge vs modeled first-impact stages.
- Modeled 1% damage by tract vs OpenFEMA NFIP claims by tract: Spearman rank correlation.
- DEM (2003 lidar) vs NC building lowest adjacent grade (newer lidar).
"""

from __future__ import annotations

import json
import re

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio import features
from scipy import stats

from .models import flood as F
from .models import hand as H

M_PER_FT = 0.3048


def _errs(e: pd.Series) -> dict:
    a = e.abs()
    return {
        "n": int(len(e)),
        "median_abs_ft": round(float(a.median()), 2),
        "p90_abs_ft": round(float(a.quantile(0.9)), 2),
        "mean_abs_ft": round(float(a.mean()), 2),
        "median_bias_ft": round(float(e.median()), 2),
    }


def xs_check(sc: F.Scenario, xs: gpd.GeoDataFrame, one_pct_stage: float, stream: str) -> dict:
    res = sc.res
    xs = xs.to_crs(res.crs)
    d_g = sc.gauge.depth_m(one_pct_stage)
    floor = H.backwater_floor(res, sc.ratio, d_g, sc.ends)
    rows = []
    for _, x in xs.iterrows():
        hits = res.reaches[res.reaches.intersects(x.geometry)]
        if hits.empty:
            continue
        rid = int(hits["totdasqkm"].idxmax())
        p = x.geometry.intersection(hits.loc[rid].geometry)
        p = p if p.geom_type == "Point" else p.centroid
        chan = H.channel_at(res, rid, p.x, p.y)
        own = chan + sc.ratio[rid] * d_g
        model = own if np.isnan(floor[rid]) else max(own, floor[rid])
        rows.append(
            {
                "stream": x["WTR_NM"].split(" (")[0],
                "station_ft": x["STREAM_STN"],
                "fema_wsel_ft": float(x["WSEL_REG"]),
                "model_wse_ft": round(model / M_PER_FT, 2),
                "dist_to_gauge_m": float(np.hypot(p.x - sc.gauge.x, p.y - sc.gauge.y)),
            }
        )
    d = pd.DataFrame(rows)
    d["error_ft"] = d["model_wse_ft"] - d["fema_wsel_ft"]
    main = d["stream"] == stream
    ref = d[main].sort_values("dist_to_gauge_m").index[0]  # used to set the 1% stage
    v = d.drop(index=ref)
    return {
        "method": "Model 1% WSE vs FEMA NFHL cross-section WSEL_REG (ft NAVD88). The cross-section nearest the gauge sets the 1% stage and is excluded.",
        "all": _errs(v["error_ft"]),
        "mainstem": _errs(v[v["stream"] == stream]["error_ft"]),
        "tributaries": _errs(v[v["stream"] != stream]["error_ft"]),
        "by_stream": {k: _errs(g["error_ft"]) for k, g in v.groupby("stream") if len(g) >= 3},
        "points": v.round(2).to_dict("records"),
    }


def extent_check(sc: F.Scenario, zones: gpd.GeoDataFrame, one_pct_stage: float, clip_utm) -> dict:
    res = sc.res
    rs, cs = F.play_window(res.transform, res.hand.shape, clip_utm)
    wet = sc.wet(one_pct_stage)[rs, cs]
    win_t = rasterio.windows.transform(
        rasterio.windows.Window(cs.start, rs.start, wet.shape[1], wet.shape[0]), res.transform
    )
    ae = zones[zones["FLD_ZONE"] == "AE"].to_crs(res.crs)
    fema = features.rasterize(
        ((g, 1) for g in ae.geometry), out_shape=wet.shape, transform=win_t, fill=0, dtype="uint8"
    ).astype(bool)
    inter, union = (wet & fema).sum(), (wet | fema).sum()
    # FEMA only studies streams with mapped cross-sections; also report agreement near them.
    return {
        "method": "Cells (3 m) in the play area: modeled wet at the 1% stage vs FEMA Zone AE (current-conditions 1% SFHA). Zone X '1 PCT FUTURE CONDITIONS' excluded.",
        "iou": round(float(inter / union), 3),
        "fema_area_captured_pct": round(100 * float(inter / fema.sum()), 1),
        "model_area_inside_fema_pct": round(100 * float(inter / wet.sum()), 1),
        "model_km2": round(float(wet.sum()) * 9 / 1e6, 3),
        "fema_ae_km2": round(float(fema.sum()) * 9 / 1e6, 3),
    }


def nws_impacts_check(
    gauge_json: dict, stages: list[float], roads: dict, damage: dict, buildings: gpd.GeoDataFrame
) -> dict:
    """Compare NWS impact statements with modeled first-impact stages (only statements we can test)."""
    edges = roads["edges"]
    by_id = {b["id"]: b for b in damage["buildings"]}

    def first_closed(name_rx: str, bridge: bool | None = None):
        cand = [
            e
            for e in edges
            if e["name"]
            and re.search(name_rx, e["name"], re.I)
            and (bridge is None or e["bridge"] == bridge)
        ]
        st = [e["closure_stage"] for e in cand if e["closure_stage"] is not None]
        return (stages[min(st)] if st else None), len(cand)

    def homes_near(name_rx: str, floor: bool):
        from shapely.geometry import LineString

        lines = [
            LineString(e["coords"])
            for e in edges
            if e["name"] and re.search(name_rx, e["name"], re.I)
        ]
        if not lines:
            return None, 0
        near = gpd.GeoSeries(lines, crs=4326).to_crs(32617).buffer(75).union_all()
        b = buildings.to_crs(32617)
        ids = b[b.intersects(near) & b["occupancy"].fillna("").str.startswith("RES")]["id"]
        first = []
        for bid in ids:
            r = by_id.get(bid)
            if not r:
                continue
            if not floor:
                first.append(r["first_wet_stage"])
            else:
                pos = [i for i, d in enumerate(r["depth_ft"]) if d > 0]
                if pos:
                    first.append(r["first_wet_stage"] + pos[0])
        return (stages[min(first)] if first else None), len(ids)

    impacts = {round(i["stage"], 1): i["statement"] for i in gauge_json["flood"].get("impacts", [])}
    checks = []
    tests = [
        (
            16,
            "Water reaches lowest homes on Claremont Drive (ground)",
            lambda: homes_near(r"Claremont", floor=False),
        ),
        (
            18,
            "Water reaches the lowest sections of Claremont Drive (road closed)",
            lambda: first_closed(r"Claremont"),
        ),
        (
            20,
            "Lower homes on Claremont Drive flood (water above first floor)",
            lambda: homes_near(r"Claremont", floor=True),
        ),
        (
            24,
            "Anderson Drive bridge and adjacent roadway submerged",
            lambda: first_closed(r"Anderson Drive", bridge=True),
        ),
    ]
    for nws_stage, what, fn in tests:
        model_stage, n = fn()
        checks.append(
            {
                "nws_stage_ft": nws_stage,
                "nws_statement": impacts.get(float(nws_stage)),
                "tested": what,
                "model_first_stage_ft": model_stage,
                "difference_ft": None if model_stage is None else round(model_stage - nws_stage, 1),
                "n_features": n,
            }
        )
    diffs = [abs(c["difference_ft"]) for c in checks if c["difference_ft"] is not None]
    return {
        "method": "NWPS impact statements for the gauge; modeled stage at which the same impact first occurs",
        "checks": checks,
        "median_abs_difference_ft": round(float(np.median(diffs)), 2) if diffs else None,
    }


def claims_check(
    damage: dict, one_idx: int, buildings: gpd.GeoDataFrame, claims: pd.DataFrame
) -> dict:
    tract_of = buildings.set_index("id")["tract"]
    dmg_by_tract: dict[str, float] = {}
    for b in damage["buildings"]:
        k = one_idx - b["first_wet_stage"]
        if k >= 0 and "damage_usd" in b:
            t = tract_of.get(b["id"])
            if t:
                dmg_by_tract[t] = dmg_by_tract.get(t, 0) + b["damage_usd"][k]
    tracts = sorted(set(tract_of.dropna()))
    c = claims.set_index("censusTract").reindex(tracts).fillna(0)
    m = pd.Series(dmg_by_tract).reindex(tracts).fillna(0)
    rho_n, p_n = stats.spearmanr(m.values, c["claims"].values)
    rho_d, p_d = stats.spearmanr(m.values, c["building_paid_usd"].values)
    return {
        "method": "Modeled 1% structure damage summed by 2020 census tract (tracts with ≥1 building in the area) vs OpenFEMA NFIP claims (all years) by tract",
        "n_tracts": len(tracts),
        "spearman_vs_claim_count": round(float(rho_n), 3),
        "p_value_count": round(float(p_n), 4),
        "spearman_vs_building_paid": round(float(rho_d), 3),
        "p_value_paid": round(float(p_d), 4),
        "tracts_with_claims": int((c["claims"] > 0).sum()),
        "tracts_with_modeled_damage": int((m > 0).sum()),
    }


def dem_check(dem_path, buildings: gpd.GeoDataFrame) -> dict:
    b = buildings[buildings["lag_m"].notna()]
    p = b.geometry.representative_point().to_crs(32617)
    with rasterio.open(dem_path) as s:
        vals = np.array([v[0] for v in s.sample(list(zip(p.x, p.y, strict=True)))])
    diff = (vals - b["lag_m"].values) / M_PER_FT
    return {
        "method": "3DEP DEM (2003 lidar) at building interior point minus NC lowest adjacent grade (newer lidar), ft",
        "n": int(len(diff)),
        "median_ft": round(float(np.median(diff)), 2),
        "p10_ft": round(float(np.percentile(diff, 10)), 2),
        "p90_ft": round(float(np.percentile(diff, 90)), 2),
    }


def score_tolerance_ft(xs: dict) -> float:
    """Scoring scale for depth estimates (PLAN §5): the model's median absolute WSE error."""
    return xs["all"]["median_abs_ft"]


def as_json(obj) -> str:
    return json.dumps(obj, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o))
