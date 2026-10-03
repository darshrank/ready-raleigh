"""M2 stages: flood (HAND + stages), damage, roads (+coverage), validate."""

from __future__ import annotations

import json
import time

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer

from .areas import Area
from .fetch import dem as demf
from .fetch import hydro
from .models import damage as dmg
from .models import flood as F
from .models import hand as H
from .models import roads as R
from .pack import area_dir, write_json
from .stages import _save_sources, _sources, _work

M_PER_FT = 0.3048
EVENTS = {135: "Matthew 2016", 283: "Florence 2018", 287: "Michael 2018"}


# ---------------------------------------------------------------- fetch (M2 sources)
def fetch_m2(area: Area, refresh: bool = False) -> dict:
    rep: dict = {}
    srcs = []
    need = lambda *n: refresh or not all(_work(area, x).exists() for x in n)  # noqa: E731
    if need("dem.tif"):
        srcs.append(demf.source(demf.fetch_dem(area, _work(area, "dem.tif"))[:10]))
    if need("flowlines.parquet"):
        xmin, ymin, xmax, ymax, _, _ = demf.grid(area)
        lon, lat = Transformer.from_crs(demf.UTM, 4326, always_xy=True).transform(
            [xmin, xmax], [ymin, ymax]
        )
        hydro.fetch_flowlines((lon[0], lat[0], lon[1], lat[1])).to_parquet(
            _work(area, "flowlines.parquet")
        )
        srcs.append(hydro.nhd_source())
    if need("fema_zones.parquet", "fema_xs.parquet"):
        z, t = hydro.fetch_fema_zones(area)
        z.to_parquet(_work(area, "fema_zones.parquet"))
        x, _ = hydro.fetch_fema_xs(area)
        x.to_parquet(_work(area, "fema_xs.parquet"))
        srcs.append(hydro.fema_source(t[:10]))
    if need("claims_by_tract.parquet"):
        c, t, ev = hydro.fetch_claims_by_tract(area)
        c.to_parquet(_work(area, "claims_by_tract.parquet"))
        ev.to_parquet(_work(area, "claims_by_tract_event.parquet"))
        srcs.append(hydro.claims_source(t[:10]))
    if need("gauge.json", "hwm_counts.json"):
        lid = area.nwps_gauges[0]
        g, t = hydro.fetch_gauge(lid)
        hydro.save_json(_work(area, "gauge.json"), g)
        hydro.save_json(_work(area, "hwm_counts.json"), hydro.count_hwms(area, EVENTS))
        srcs.append(hydro.gauge_source(lid, t[:10]))
    if srcs:
        _save_sources(area, srcs)
    rep["m2_sources"] = [s.id for s in srcs] or "cached"
    return rep


# ---------------------------------------------------------------- HAND / scenario loading
def _gauge(area: Area, res: H.HandResult) -> F.Gauge:
    g = json.loads(_work(area, "gauge.json").read_text())
    datum = next(v["value"] for v in g["datums"]["vertical"]["value"] if v["abbrev"] == "NAVD88")
    x, y = Transformer.from_crs(4326, res.crs, always_xy=True).transform(
        g["longitude"], g["latitude"]
    )
    rid = H.gauge_reach(res, x, y, area.gauge_stream)
    cats = {k: v["stage"] for k, v in g["flood"]["categories"].items() if v["stage"] > 0}
    record = max(c["stage"] for c in g["flood"]["crests"]["historic"])
    return F.Gauge(g["lid"], float(datum), x, y, rid, H.channel_at(res, rid, x, y), cats, record)


def load_scenario(area: Area) -> F.Scenario:
    res_path = _work(area, "hand.npz")
    with rasterio.open(_work(area, "dem.tif")) as src:
        dem = src.read(1)
        transform, crs = src.transform, str(src.crs)
    if res_path.exists():
        z = np.load(res_path)
        reaches = gpd.read_parquet(_work(area, "reaches.parquet"))
        res = H.HandResult(z["hand"], z["reach"], z["channel"], transform, crs, reaches)
    else:
        fl = gpd.read_parquet(_work(area, "flowlines.parquet"))
        res = H.compute_hand(_work(area, "dem.tif"), fl, area_dir(area.id) / "work")
        np.savez_compressed(res_path, hand=res.hand, reach=res.reach, channel=res.channel)
        res.reaches.to_parquet(_work(area, "reaches.parquet"))
    return F.Scenario(res, dem, _gauge(area, res))


def play_bbox_utm(area: Area, crs: str) -> tuple[float, float, float, float]:
    tr = Transformer.from_crs(4326, crs, always_xy=True)
    lon0, lat0, lon1, lat1 = area.bbox
    xs, ys = tr.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
    return min(xs), min(ys), max(xs), max(ys)


def fema_1pct_stage(area: Area, sc: F.Scenario) -> tuple[float, dict]:
    """1%-annual-chance gauge stage from the FEMA cross-section nearest the gauge."""
    xs = gpd.read_parquet(_work(area, "fema_xs.parquet")).to_crs(sc.res.crs)
    on = xs[xs["WTR_NM"].str.startswith(area.gauge_stream)]
    from shapely.geometry import Point

    d = on.distance(Point(sc.gauge.x, sc.gauge.y))
    ref = on.loc[d.idxmin()]
    stage = round(float(ref["WSEL_REG"]) - sc.gauge.datum_ft, 2)
    return stage, {
        "xs_wsel_ft": float(ref["WSEL_REG"]),
        "distance_m": round(float(d.min()), 1),
        "stream_station": ref["STREAM_STN"],
    }


# ---------------------------------------------------------------- flood stage
def stage_flood(area: Area, refresh: bool = False) -> dict:
    t = time.time()
    rep = fetch_m2(area, refresh)
    sc = load_scenario(area)
    res, g = sc.res, sc.gauge
    one_pct, one_meta = fema_1pct_stage(area, sc)
    matthew = next(
        c["stage"]
        for c in json.loads(_work(area, "gauge.json").read_text())["flood"]["crests"]["historic"]
        if c["occurredTime"].startswith("2016-10")
    )
    stages = F.stage_list(g, (one_pct, matthew, g.record_stage_ft))
    clip = play_bbox_utm(area, res.crs)
    rs, cs = F.play_window(res.transform, res.hand.shape, clip)
    out = area_dir(area.id)
    (out / "stages").mkdir(exist_ok=True)
    for old in (out / "stages").glob("*.geojson"):
        old.unlink()

    bld = gpd.read_parquet(_work(area, "buildings.parquet"))
    cells = F.building_cells(bld, res)
    b_wse = np.full((len(bld), len(stages)), np.nan, dtype="float32")

    one_pct, one_meta = fema_1pct_stage(area, sc)
    matthew = next(
        c["stage"]
        for c in json.loads(_work(area, "gauge.json").read_text())["flood"]["crests"]["historic"]
        if c["occurredTime"].startswith("2016-10")
    )
    srcs = _sources(area, "dem", "nhd", f"nwps_{g.lid}", "nfhl")
    stage_rows = []
    cell_area_km2 = abs(res.transform.a * res.transform.e) / 1e6
    for i, s in enumerate(stages):
        wse = sc.wse(s)
        wet = (
            (wse > sc.dem) & ~np.isnan(sc.dem) if g.depth_m(s) > 0 else np.zeros(sc.dem.shape, bool)
        )
        b_wse[:, i] = np.where(wet.ravel()[cells], wse.ravel()[cells], np.nan)
        sub = wet[rs, cs]
        win_t = rasterio.windows.transform(
            rasterio.windows.Window(cs.start, rs.start, sub.shape[1], sub.shape[0]), res.transform
        )
        poly = F.polygons(sub, win_t, res.crs, clip)
        write_json(
            out / "stages" / f"{i}.geojson",
            srcs,
            {
                "type": "FeatureCollection",
                "stage_index": i,
                "stage_ft": s,
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"stage_ft": s},
                        "geometry": geom.__geo_interface__,
                    }
                    for geom in poly.geometry
                    if not geom.is_empty
                ],
            },
        )
        stage_rows.append(
            {
                "i": i,
                "stage_ft": s,
                "wse_gauge_ft": round(g.datum_ft + s, 2),
                "depth_above_channel_ft": round(g.depth_m(s) / M_PER_FT, 2),
                "category": g.category(s),
                "wet_area_km2": round(float(sub.sum()) * cell_area_km2, 3),
                "buildings_reached": int(np.isfinite(b_wse[:, i]).sum()),
            }
        )
    np.savez_compressed(
        _work(area, "building_wse.npz"),
        wse=b_wse,
        ids=np.array(bld["id"].tolist(), dtype="U64"),
        ground=sc.ground.ravel()[cells],
    )
    scenarios = {
        "1pct": {
            "stage_ft": one_pct,
            "label": "1%-annual-chance flood (FEMA regulatory)",
            "method": "FEMA cross-section WSEL nearest the gauge minus gauge datum",
            **one_meta,
        },
        "matthew_2016": {
            "stage_ft": matthew,
            "label": "Hurricane Matthew crest, 2016-10-08",
            "method": "NWPS historic crest at gauge",
        },
        "record": {
            "stage_ft": g.record_stage_ft,
            "label": "Record crest, 1996-09-06 (Hurricane Fran)",
            "method": "NWPS historic crest at gauge",
        },
    }
    write_json(
        out / "stages.json",
        srcs,
        {
            "gauge": {
                "lid": g.lid,
                "datum_navd88_ft": g.datum_ft,
                "categories_ft": g.categories,
                "record_stage_ft": g.record_stage_ft,
                "channel_elev_ft": round(g.channel_m / M_PER_FT, 2),
            },
            "scenarios": scenarios,
            "stages": stage_rows,
        },
    )
    rep.update(
        stages=len(stages),
        one_pct_stage_ft=one_pct,
        matthew_stage_ft=matthew,
        wet_km2_at_1pct=next(r["wet_area_km2"] for r in stage_rows if r["stage_ft"] >= one_pct),
        seconds=round(time.time() - t, 1),
    )
    return rep


# ---------------------------------------------------------------- damage stage
def stage_damage(area: Area, refresh: bool = False) -> dict:
    t = time.time()
    st = json.loads((area_dir(area.id) / "stages.json").read_text())
    stages = [r["stage_ft"] for r in st["stages"]]
    z = np.load(_work(area, "building_wse.npz"), allow_pickle=False)
    bld = gpd.read_parquet(_work(area, "buildings.parquet")).set_index("id")
    wse = z["wse"]
    rows = []
    totals = np.zeros(len(stages))
    for j, bid in enumerate(z["ids"]):
        w = wse[j]
        wet = np.isfinite(w)
        if not wet.any():
            continue
        b = bld.loc[bid]
        first = int(np.argmax(wet))
        depth_ft = (w[first:] - b["ffe_m"]) / M_PER_FT
        key = dmg.curve_key(b["occupancy"], b["stories"], b["foundation"])
        row = {
            "id": bid,
            "first_wet_stage": first,
            "depth_ft": np.round(depth_ft, 2).tolist(),
            "curve": key,
            "ffe_src": b["ffe_src"],
        }
        if key:
            m, lo, hi = dmg.curve(key)(depth_ft)
            row.update(
                damage_pct=np.round(m, 1).tolist(),
                damage_pct_lo=np.round(lo, 1).tolist(),
                damage_pct_hi=np.round(hi, 1).tolist(),
            )
            val = b["value_rep_usd"]
            if pd.notna(val):
                usd = m / 100 * val
                row["damage_usd"] = np.round(usd).astype(int).tolist()
                totals[first:] += usd
        rows.append(row)
    srcs = _sources(area, "nc_bldg", "dem", "nhd", f"nwps_{st['gauge']['lid']}")
    write_json(
        area_dir(area.id) / "damage.json",
        srcs,
        {
            "units": {
                "depth_ft": "feet of water above first floor (negative = below floor)",
                "damage_pct": "% of structure replacement value",
                "damage_usd": "USD, structure only",
            },
            "curves": "USACE go-consequences occtypes.json (MIT): EGM 04-01 (RES1, ±1 sd range), USACE Galveston/HEC-FIA (others)",
            "stages_ft": stages,
            "total_damage_usd_by_stage": np.round(totals).astype(int).tolist(),
            "buildings": rows,
        },
    )
    one = st["scenarios"]["1pct"]["stage_ft"]
    i1 = next(i for i, s in enumerate(stages) if s >= one)
    return {
        "buildings_ever_wet": len(rows),
        "damage_usd_at_1pct": int(totals[i1]),
        "buildings_with_floor_wet_at_1pct": int(
            sum(
                1
                for r in rows
                if r["first_wet_stage"] <= i1 and r["depth_ft"][i1 - r["first_wet_stage"]] > 0
            )
        ),
        "seconds": round(time.time() - t, 1),
    }


# ---------------------------------------------------------------- roads + coverage
def _residential_buildings(area: Area) -> pd.Series:
    r = json.loads((area_dir(area.id) / "residents.json").read_text())
    cols = r["columns"]
    return pd.Series(cols["weight"], index=cols["building_id"]).groupby(level=0).sum()


def stage_roads(area: Area, refresh: bool = False) -> dict:
    import networkx as nx
    import osmnx as ox

    t = time.time()
    sc = load_scenario(area)
    res = sc.res
    out = area_dir(area.id)
    st = json.loads((out / "stages.json").read_text())
    stages = [r["stage_ft"] for r in st["stages"]]
    g = R.load_drive(_work(area, "graph_drive.graphml"))
    dem_flat = sc.ground.ravel()  # effective ground (see Scenario.ground)
    samples = R.edge_samples(
        g, res.crs, res.transform, res.hand.shape, streams=res.reaches, dem_flat=dem_flat
    )

    # Candidate sites (OSM amenities) and residential buildings -> nearest drive node.
    am = gpd.read_parquet(_work(area, "osm_amenities.parquet"))
    am_pts = am.to_crs(res.crs).representative_point()
    am_ll = gpd.GeoSeries(am_pts, crs=res.crs).to_crs(4326)
    site_nodes = ox.distance.nearest_nodes(g, am_ll.x.values, am_ll.y.values)
    sr, sc_ = rasterio.transform.rowcol(res.transform, am_pts.x.values, am_pts.y.values)
    site_cells = np.ravel_multi_index(
        (np.clip(sr, 0, res.hand.shape[0] - 1), np.clip(sc_, 0, res.hand.shape[1] - 1)),
        res.hand.shape,
    )
    bld = gpd.read_parquet(_work(area, "buildings.parquet"))
    extra = gpd.read_parquet(_work(area, "buildings_not_in_nc.parquet")).assign(
        id=lambda d: "ov:" + d["id"].astype(str)
    )
    allb = pd.concat(
        [bld[["id", "geometry"]], extra[["id", "geometry"]]], ignore_index=True
    ).set_index("id")
    res_w = _residential_buildings(area)
    rb = gpd.GeoSeries(allb.loc[res_w.index, "geometry"], crs=4326).representative_point()
    b_nodes = ox.distance.nearest_nodes(g, rb.x.values, rb.y.values)

    closure = [None] * len(samples)
    site_flooded = [None] * len(site_nodes)
    rev = g.reverse(copy=False)  # residents drive TO the site
    nodes = list(g.nodes)
    node_idx = {n: i for i, n in enumerate(nodes)}
    reach_by_stage: list[list[dict]] = []
    prev_closed: frozenset | None = None
    for i, s in enumerate(stages):
        wse = (
            sc.wse(s).ravel()
            if sc.gauge.depth_m(s) > 0
            else np.full(dem_flat.shape, -np.inf, dtype="float32")
        )
        for e, smp in enumerate(samples):
            if closure[e] is None and R.closure_stage(smp, dem_flat, [wse]) == 0:
                closure[e] = i
        for k, cell in enumerate(site_cells):
            if site_flooded[k] is None and wse[cell] > dem_flat[cell]:
                site_flooded[k] = i
        closed = frozenset(samples[e]["key"] for e in range(len(samples)) if closure[e] is not None)
        if closed != prev_closed:
            view = (
                nx.restricted_view(rev, [], [])
                if not closed
                else rev.edge_subgraph(
                    [(v, u, k) for (u, v, k) in rev.edges(keys=True) if (v, u, k) not in closed]
                )
            )
            cur = []
            for sn in site_nodes:
                cur.append(
                    nx.single_source_dijkstra_path_length(
                        view, sn, cutoff=R.SHELTER_DRIVE_S, weight="travel_time"
                    )
                    if sn in view
                    else {}
                )
            prev_closed = closed
        reach_by_stage.append(cur)

    sites = []
    for k, sn in enumerate(site_nodes):
        base = reach_by_stage[0][k]
        lost = {}
        for n in base:
            stage_lost = next(
                (i for i in range(len(stages)) if n not in reach_by_stage[i][k]), None
            )
            if site_flooded[k] is not None:
                stage_lost = min(stage_lost if stage_lost is not None else 10**9, site_flooded[k])
            lost[n] = -1 if stage_lost in (None, 10**9) else stage_lost
        row = am.iloc[k]
        sites.append(
            {
                "id": row["osm_id"],
                "name": row.get("name") if isinstance(row.get("name"), str) else None,
                "kind": row.get("amenity"),
                "lon": round(float(am_ll.x.iloc[k]), 6),
                "lat": round(float(am_ll.y.iloc[k]), 6),
                "node": node_idx[sn],
                "flooded_stage": site_flooded[k],
                "nodes": [node_idx[n] for n in base],
                "travel_s": [round(base[n]) for n in base],
                "lost_stage": [lost[n] for n in base],
            }
        )
    srcs = _sources(area, "osm", "dem", "nhd", f"nwps_{st['gauge']['lid']}")
    gl = {n: (round(d["x"], 6), round(d["y"], 6)) for n, d in g.nodes(data=True)}
    write_json(
        out / "coverage.json",
        srcs + _sources(area, "acs"),
        {
            "cutoff_s": R.SHELTER_DRIVE_S,
            "mode": "drive, residents to site (OSMnx speeds; closed edges removed per stage)",
            "nodes": [gl[n] for n in nodes],
            "building_node": {
                bid: node_idx[n] for bid, n in zip(res_w.index, b_nodes, strict=True)
            },
            "sites": sites,
        },
    )
    edges = []
    for e, smp in enumerate(samples):
        u, v, k = smp["key"]
        d = g.edges[u, v, k]
        geom = d.get("geometry")
        coords = list(geom.coords) if geom is not None else [gl[u], gl[v]]
        name = d.get("name")
        edges.append(
            {
                "id": f"{u}-{v}-{k}",
                "name": name
                if isinstance(name, str)
                else (name[0] if isinstance(name, list) else None),
                "highway": d.get("highway")
                if isinstance(d.get("highway"), str)
                else d.get("highway", [None])[0],
                "bridge": smp["bridge"],
                "untagged_structure": smp["untagged_structure"],
                "length_m": round(smp["length_m"], 1),
                "closure_stage": closure[e],
                "coords": [[round(x, 6), round(y, 6)] for x, y in coords],
            }
        )
    write_json(
        out / "roads.json",
        srcs,
        {
            "closure_rule": "water > 0.5 ft over any sampled point; bridges: over the higher approach elevation",
            "edges": edges,
        },
    )
    for i, row in enumerate(st["stages"]):
        row["closed_edges_new"] = [edges[e]["id"] for e in range(len(edges)) if closure[e] == i]
        row["closed_edges_total"] = sum(1 for c in closure if c is not None and c <= i)
    write_json(
        out / "stages.json",
        _sources(area, "dem", "nhd", f"nwps_{st['gauge']['lid']}", "nfhl"),
        {k: v for k, v in st.items() if k not in ("pack_version", "built_at", "sources")},
    )
    one = st["scenarios"]["1pct"]["stage_ft"]
    i1 = next(i for i, s in enumerate(stages) if s >= one)
    return {
        "edges": len(edges),
        "closed_at_1pct": st["stages"][i1]["closed_edges_total"],
        "bridges": sum(e["bridge"] for e in edges),
        "untagged_structures": sum(e["untagged_structure"] for e in edges),
        "sites": len(sites),
        "sites_flooded_at_1pct": sum(
            1 for s in sites if s["flooded_stage"] is not None and s["flooded_stage"] <= i1
        ),
        "seconds": round(time.time() - t, 1),
    }


# ---------------------------------------------------------------- validate
def stage_validate(area: Area, refresh: bool = False) -> dict:
    from . import validate as V

    t = time.time()
    out = area_dir(area.id)
    sc = load_scenario(area)
    st = json.loads((out / "stages.json").read_text())
    stages = [r["stage_ft"] for r in st["stages"]]
    one = st["scenarios"]["1pct"]["stage_ft"]
    one_idx = next(i for i, s in enumerate(stages) if s >= one)
    bld = gpd.read_parquet(_work(area, "buildings.parquet"))
    blocks = gpd.read_parquet(_work(area, "blocks.parquet"))
    pts = gpd.GeoDataFrame(bld[["id"]], geometry=bld.geometry.representative_point(), crs=4326)
    bld["tract"] = (
        gpd.sjoin(pts, blocks[["GEOID20", "geometry"]], predicate="within")["GEOID20"]
        .str[:11]
        .reindex(bld.index)
    )
    damage = json.loads((out / "damage.json").read_text())
    roads = json.loads((out / "roads.json").read_text())
    gauge = json.loads(_work(area, "gauge.json").read_text())

    xs = V.xs_check(sc, gpd.read_parquet(_work(area, "fema_xs.parquet")), one, area.gauge_stream)
    result = {
        "scenario_1pct_stage_ft": one,
        "flood_wse_vs_fema_xs": xs,
        "extent_vs_fema_ae": V.extent_check(
            sc,
            gpd.read_parquet(_work(area, "fema_zones.parquet")),
            one,
            play_bbox_utm(area, sc.res.crs),
        ),
        "nws_impacts": V.nws_impacts_check(gauge, stages, roads, damage, bld),
        "damage_vs_nfip_claims": V.claims_check(
            damage, one_idx, bld, pd.read_parquet(_work(area, "claims_by_tract.parquet"))
        ),
        "usgs_hwm_availability": json.loads(_work(area, "hwm_counts.json").read_text()),
        "dem_vs_building_ground": V.dem_check(_work(area, "dem.tif"), bld),
        "road_closures_below_action_stage": {
            "method": "Directed road edges closed below the NWS action stage — at near-normal flow these are model artifacts (crossings where the bare-earth DEM has no deck and the notch rule did not fire).",
            "action_stage_ft": sc.gauge.categories.get("action"),
            "by_stage": {
                str(r["stage_ft"]): r.get("closed_edges_total", 0)
                for r in st["stages"]
                if r["stage_ft"] in (4.0, 6.0, 8.0, 10.0, 12.0, 14.0)
            },
            "total_edges": len(roads["edges"]),
        },
        "depth_score_tolerance_ft": V.score_tolerance_ft(xs),
    }
    write_json(
        out / "validation.json",
        _sources(area, "dem", "nhd", "nfhl", "nfip_claims", f"nwps_{gauge['lid']}", "nc_bldg"),
        result,
    )
    summary = {
        "xs_all": xs["all"],
        "xs_mainstem": xs["mainstem"],
        "xs_tributaries": xs["tributaries"],
        "extent": result["extent_vs_fema_ae"],
        "nws": [
            (c["nws_stage_ft"], c["model_first_stage_ft"]) for c in result["nws_impacts"]["checks"]
        ],
        "claims": {k: v for k, v in result["damage_vs_nfip_claims"].items() if k != "method"},
        "dem_vs_lag": {k: v for k, v in result["dem_vs_building_ground"].items() if k != "method"},
        "seconds": round(time.time() - t, 1),
    }
    return summary
