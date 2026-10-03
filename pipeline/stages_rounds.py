"""M3 stage: round bank + lens layers."""

from __future__ import annotations

import json
import time

import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd
import rasterio
from pyproj import Transformer
from shapely.geometry import LineString, box

from . import rounds as RB
from .areas import Area
from .fetch import mapillary
from .pack import area_dir, write_json
from .stages import _sources, _work
from .stages_flood import play_bbox_utm

N_A, N_B = 15, 15


def _src(s) -> dict:
    return {"dataset": s.dataset, "date": s.date, "url": s.url, "method": s.method}


def stage_rounds(area: Area, refresh: bool = False) -> dict:
    t = time.time()
    out = area_dir(area.id)
    st = json.loads((out / "stages.json").read_text())
    stages = [r["stage_ft"] for r in st["stages"]]
    one = st["scenarios"]["1pct"]["stage_ft"]
    one_idx = stages.index(one)
    validation = json.loads((out / "validation.json").read_text())
    tol_ft = validation["depth_score_tolerance_ft"]
    to_utm = Transformer.from_crs(4326, RB.UTM, always_xy=True)
    to_ll = Transformer.from_crs(RB.UTM, 4326, always_xy=True)

    z = np.load(_work(area, "hand.npz"))
    with rasterio.open(_work(area, "dem.tif")) as s:
        transform = s.transform
    reaches = gpd.read_parquet(_work(area, "reaches.parquet"))
    cul = (
        gpd.read_parquet(_work(area, "osm_culverts.parquet")).to_crs(RB.UTM)
        if _work(area, "osm_culverts.parquet").exists()
        else gpd.GeoDataFrame(geometry=[], crs=RB.UTM)
    )

    # Road network: closures + "one road out".
    roads = json.loads((out / "roads.json").read_text())["edges"]
    g = ox.load_graphml(_work(area, "graph_drive.graphml"))
    closure = {}
    for e in roads:
        u, v, _k = e["id"].split("-")
        if e["closure_stage"] is not None:
            key = (int(u), int(v))
            closure[key] = min(closure.get(key, 10**9), e["closure_stage"])
    behind = RB.behind_closable_bridges(g, closure, one_idx)

    ctx = RB.Ctx(
        area.bbox,
        to_utm,
        to_ll,
        stages,
        st["gauge"]["categories_ft"]["action"],
        one_idx,
        z["hand"],
        z["reach"],
        transform,
        reaches,
        cul,
        behind,
    )

    bld = gpd.read_parquet(_work(area, "buildings.parquet"))
    cent = bld.geometry.representative_point()
    bld["node"] = ox.distance.nearest_nodes(g, cent.x.values, cent.y.values)
    bld_utm = bld.to_crs(RB.UTM)
    dmg = {b["id"]: b for b in json.loads((out / "damage.json").read_text())["buildings"]}
    roads_gdf = gpd.GeoDataFrame(
        {
            "name": [e["name"] for e in roads],
            "closure_ft": [
                None if e["closure_stage"] is None else stages[e["closure_stage"]] for e in roads
            ],
        },
        geometry=[LineString(e["coords"]) for e in roads],
        crs=4326,
    ).to_crs(RB.UTM)
    roads_gdf["closure_ft"] = pd.to_numeric(roads_gdf["closure_ft"])

    blocks = gpd.read_parquet(_work(area, "blocks.parquet"))
    tracts = (
        blocks.assign(censusTract=blocks["GEOID20"].str[:11])
        .dissolve("censusTract")
        .reset_index()[["censusTract", "geometry"]]
    )
    claims = pd.read_parquet(_work(area, "claims_by_tract.parquet"))
    tracts = tracts.merge(claims, on="censusTract", how="left").fillna({"claims": 0}).to_crs(RB.UTM)
    acs = pd.read_parquet(_work(area, "acs.parquet"))
    bgs = (
        gpd.read_parquet(_work(area, "block_groups.parquet")).merge(acs, on="GEOID").to_crs(RB.UTM)
    )

    S = {
        s.id: s
        for s in _sources(
            area,
            "nc_bldg",
            "dem",
            "nhd",
            f"nwps_{area.nwps_gauges[0]}",
            "nfip_claims",
            "acs",
            "osm",
            "nfhl",
        )
    }
    src = {
        "depth": {
            **_src(S["nc_bldg"]),
            "dataset": "Modeled flood depth (HAND, 3DEP DEM, NHDPlus HR, NWPS gauge) over NC Risk first-floor elevation",
            "method": "Ready Raleigh HAND model at the FEMA 1% stage; see Methods §3–4.",
        },
        "roads": {
            **_src(S["osm"]),
            "dataset": "OpenStreetMap roads × modeled flood stages",
            "method": "Road closes when > 0.5 ft of water covers it; see Methods §5.",
        },
        "claims": _src(S["nfip_claims"]),
        "acs": {
            **_src(S["acs"]),
            "method": "B25044 households with no vehicle ÷ all households; ±90% MOE.",
        },
    }

    cands = []
    for sq in RB.squares(area.bbox):
        for r in (
            RB.depth_rounds(ctx, sq, bld_utm, dmg, tol_ft, src)
            + RB.first_building_rounds(ctx, sq, bld_utm, dmg, src)
            + RB.first_road_rounds(ctx, sq, roads_gdf, src)
            + RB.claims_rounds(ctx, sq, tracts, src)
            + RB.no_vehicle_rounds(ctx, sq, bgs, src)
        ):
            r["square_utm"] = sq
            cands.append(r)
    picked = RB.select(cands, N_A, N_B)
    final = RB.finalize(ctx, picked)

    photos = 0
    for r in final:
        lon, lat = r["focus"]["point"] if "focus" in r else r["truth"]["points"][0]
        if r["kind"] in ("depth_1pct", "first_building", "first_road"):
            p = mapillary.nearest_photo(lon, lat, out / "photos")
            if p:
                r["photo"] = p
                photos += 1

    write_json(
        out / "rounds.json",
        list(S.values()),
        {"mode": "flood", "candidates": len(cands), "rounds": final},
    )
    lens = write_lenses(area, ctx, bgs, reaches, cul)
    kinds = pd.Series([r["kind"] for r in final]).value_counts().to_dict()
    return {
        "candidates": len(cands),
        "kept": len(final),
        "by_kind": kinds,
        "with_photo": photos,
        "one_road_out_nodes": len(behind),
        "lenses": lens,
        "seconds": round(time.time() - t, 1),
    }


def write_lenses(area: Area, ctx, bgs, reaches, culverts) -> dict:
    """Lens overlays (PLAN §6.2), clipped to the play area."""
    out = area_dir(area.id) / "lenses"
    out.mkdir(exist_ok=True)
    clip = box(*play_bbox_utm(area, "EPSG:32617"))
    sizes = {}

    def save(name: str, gdf: gpd.GeoDataFrame, srcs: list[str]):
        gdf = gdf[~gdf.geometry.is_empty].to_crs(4326)
        gdf["geometry"] = __import__("shapely").set_precision(gdf.geometry.values, 1e-6)
        fc = json.loads(gdf.to_json(drop_id=True))
        write_json(out / f"{name}.geojson", _sources(area, *srcs), fc)
        sizes[name] = round((out / f"{name}.geojson").stat().st_size / 1024)

    # Elevation: height above nearest stream, banded (ft) — the "read the bowl" lens.
    with rasterio.open(_work(area, "dem.tif")) as s:
        tr = s.transform
    from rasterio import features

    # 9 m grid (min HAND of each 3×3 block keeps low ground) — enough for a lens, ~5× smaller.
    from scipy import ndimage
    from shapely.geometry import shape

    hand_ft = ndimage.minimum_filter(np.nan_to_num(ctx.hand, nan=1e6), size=3)[1::3, 1::3] / 0.3048
    tr = tr * rasterio.Affine.scale(3)
    bands = np.digitize(
        np.nan_to_num(hand_ft, nan=999), [3, 6, 10, 20]
    )  # 0:<3 1:3-6 2:6-10 3:10-20 4:>20
    geoms, vals = [], []
    for geom, v in features.shapes(bands.astype("uint8"), mask=bands < 3, transform=tr):
        geoms.append(shape(geom))
        vals.append(int(v))
    hb = gpd.GeoDataFrame({"band": vals}, geometry=geoms, crs=32617)
    hb = hb.dissolve("band").reset_index()
    hb["geometry"] = hb.geometry.simplify(9).make_valid().intersection(clip)
    hb["label"] = hb["band"].map({0: "< 3 ft above creek", 1: "3–6 ft", 2: "6–10 ft"})
    save("elevation", hb, ["dem", "nhd"])

    # Water: streams (with drainage area), culverts, FEMA 1% (AE) and future-conditions zones.
    zones = gpd.read_parquet(_work(area, "fema_zones.parquet")).to_crs(32617)
    zones = zones[(zones["FLD_ZONE"] == "AE") | (zones["ZONE_SUBTY"] == "1 PCT FUTURE CONDITIONS")]
    zones = gpd.GeoDataFrame(
        {"kind": np.where(zones["FLD_ZONE"] == "AE", "fema_1pct", "fema_1pct_future")},
        geometry=zones.geometry.simplify(3).make_valid().intersection(clip),
        crs=32617,
    )
    streams = gpd.GeoDataFrame(
        {
            "kind": "stream",
            "name": reaches["gnis_name"].values,
            "area_km2": reaches["totdasqkm"].round(1).values,
        },
        geometry=reaches.geometry.intersection(clip).values,
        crs=32617,
    )
    culv = (
        gpd.GeoDataFrame(geometry=culverts.geometry.intersection(clip).values, crs=32617).assign(
            kind="culvert"
        )
        if len(culverts)
        else gpd.GeoDataFrame(geometry=[], crs=32617)
    )
    save("water", pd.concat([zones, streams, culv], ignore_index=True), ["nfhl", "nhd", "osm"])

    # Surface: parking lots (impervious, OSM). NLCD impervious % arrives with Heat mode (M10).
    pk = gpd.read_parquet(_work(area, "osm_parking.parquet")).to_crs(32617)
    pk = pk[pk.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
    save(
        "surface",
        gpd.GeoDataFrame(
            geometry=pk.geometry.make_valid().intersection(clip).values, crs=32617
        ).assign(kind="parking"),
        ["osm"],
    )

    # People: block-group vulnerability (ACS rates), aggregate only.
    b = bgs[bgs.intersects(clip)].copy()
    b["p65"] = (b["age_65_plus"] / b["age_universe"]).round(3)
    b["p_noveh"] = (b["hh_no_vehicle"] / b["hh_vehicle_universe"]).round(3)
    b["p_pov"] = (b["below_poverty"] / b["poverty_universe"]).round(3)
    b["p_lep"] = (b["hh_limited_english"] / b["hh_language_universe"]).round(3)
    w = {"p65": 0.5, "p_noveh": 0.5, "p_pov": 0.5, "p_lep": 0.25}  # same weights as residents
    b["vuln"] = (1 + sum(b[k].fillna(0) * v for k, v in w.items())).round(3)
    keep = ["GEOID", "pop_total", "p65", "p_noveh", "p_pov", "p_lep", "vuln"]
    save(
        "people",
        gpd.GeoDataFrame(
            b[keep],
            geometry=b.geometry.simplify(5).make_valid().intersection(clip).values,
            crs=32617,
        ),
        ["acs"],
    )
    return sizes
