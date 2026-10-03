"""Pipeline stages. `fetch` is the only stage that touches the network (via the cache);
later stages read the work/ parquet files it writes."""

from __future__ import annotations

import json
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import yaml

from .areas import Area
from .cache import FetchError
from .fetch import census, nc_buildings, osm, overture
from .models import buildings as bmodel
from .models import people as pmodel
from .pack import area_dir, write_building_tiles, write_json
from .sources import Source

CONFIG = Path(__file__).parent / "config"


def _sources_path(area: Area) -> Path:
    return area_dir(area.id) / "work" / "sources.json"


def _save_sources(area: Area, new: list[Source]) -> None:
    path = _sources_path(area)
    cur = json.loads(path.read_text()) if path.exists() else {}
    cur.update({s.id: s.to_dict() for s in new})
    path.write_text(json.dumps(cur, indent=2))


def _sources(area: Area, *ids: str) -> list[Source]:
    cur = json.loads(_sources_path(area).read_text())
    missing = [i for i in ids if i not in cur]
    if missing:
        raise FetchError(f"sources {missing} not fetched yet — run --stage fetch first")
    return [Source(**cur[i]) for i in ids]


def _work(area: Area, name: str) -> Path:
    return area_dir(area.id) / "work" / name


def stage_fetch(area: Area, refresh: bool = False) -> dict:
    """Fetch every source (HTTP-cached) and write work/ parquet files.

    Each step is skipped when its work file already exists, so reruns cost ~1 s; pass
    `--refresh` to re-derive work files from the HTTP cache (delete pipeline/cache to refetch).
    """
    report: dict = {}
    t = time.time()
    srcs: list[Source] = []

    def need(*names: str) -> bool:
        return refresh or not all(_work(area, n).exists() for n in names)

    if need("nc_raw.parquet", "nc_domains.json"):
        raw, info, fetched = nc_buildings.fetch_buildings(area)
        raw.to_parquet(_work(area, "nc_raw.parquet"))
        _work(area, "nc_domains.json").write_text(json.dumps(nc_buildings.domains(info)))
        srcs.append(nc_buildings.source(fetched[:10]))

    if need("overture.parquet"):
        ov, release, fetched = overture.fetch_buildings(area)
        ov.to_parquet(_work(area, "overture.parquet"))
        srcs.append(overture.source(release, fetched[:10]))

    osm_files = [f"osm_{n}.parquet" for n in osm.LAYERS]
    if need(*osm_files[:1]):
        feats, _ = osm.fetch_features(area)
        for name, gdf in feats.items():
            if len(gdf):
                gdf.to_parquet(_work(area, f"osm_{name}.parquet"))
        srcs.append(osm.source())
    if need("graph_drive.graphml", "graph_walk.graphml"):
        osm.fetch_graphs(area, area_dir(area.id) / "work")

    if need("blocks.parquet", "block_groups.parquet"):
        blocks, fetched = census.tiger_blocks(area)
        blocks.to_parquet(_work(area, "blocks.parquet"))
        bgs, _ = census.tiger_block_groups(area)
        bgs.to_parquet(_work(area, "block_groups.parquet"))
        srcs.append(census.blocks_source(fetched[:10]))

    if need("acs.parquet"):
        try:
            acs, fetched = census.fetch_acs(area)
            acs.to_parquet(_work(area, "acs.parquet"))
            srcs.append(census.acs_source(fetched[:10]))
        except FetchError as e:
            report["acs_error"] = str(e)
    _save_sources(area, srcs)

    for name in ("nc_raw", "overture", *[f"osm_{n}" for n in osm.LAYERS], "blocks", "acs"):
        f = _work(area, f"{name}.parquet")
        if f.exists():
            import pyarrow.parquet as pq

            report[name] = pq.ParquetFile(f).metadata.num_rows
    report["seconds"] = round(time.time() - t, 1)
    return report


def stage_buildings(area: Area, refresh: bool = False) -> dict:
    t = time.time()
    raw = gpd.read_parquet(_work(area, "nc_raw.parquet"))
    domains = json.loads(_work(area, "nc_domains.json").read_text())
    nc = bmodel.decode(raw, domains)
    osm_b = gpd.read_parquet(_work(area, "osm_buildings.parquet"))
    ov = gpd.read_parquet(_work(area, "overture.parquet"))
    bld = bmodel.add_heights(nc, osm_b, ov)
    missing_from_nc = bmodel.classify_extras(bmodel.unmatched(nc, ov), osm_b)
    bld.to_parquet(_work(area, "buildings.parquet"))
    missing_from_nc.to_parquet(_work(area, "buildings_not_in_nc.parquet"))

    n = len(bld)
    pct = lambda m: round(100 * float(m.sum()) / n, 1)  # noqa: E731
    surveyed = bld["ffe_src"].fillna("").str.contains("CERTIFICATE|SURVEY|INCLINOMETER|TERRESTRIAL")
    report = {
        "building_count": n,
        "pct_with_ffe": pct(bld["ffe_m"].notna()),
        "pct_ffe_by_method": (bld["ffe_src"].fillna("none").value_counts(normalize=True) * 100)
        .round(1)
        .to_dict(),
        "pct_ffe_surveyed": pct(surveyed),
        "pct_by_construction": (
            bld["construction"].fillna("no data").value_counts(normalize=True) * 100
        )
        .round(1)
        .to_dict(),
        "pct_with_attributes": pct(bld["occupancy"].notna()),
        "pct_with_height_by_source": (
            bld["height_src"].fillna("none").value_counts(normalize=True) * 100
        )
        .round(1)
        .to_dict(),
        "pct_with_roof_data": pct(bld["roof_material"].notna() | bld["roof_colour"].notna()),
        "overture_footprints_not_in_nc": len(missing_from_nc),
        "of_which_residential_by_osm_tag": int(missing_from_nc["occupancy"].notna().sum()),
    }

    props = [
        "id", "height_m", "height_src", "construction", "construction_src", "occupancy",
        "occupancy_src", "foundation", "stories", "year", "year_src", "ffe_m", "ffe_src",
        "value_rep_usd", "value_src", "roof_material", "roof_colour", "flood_zone",
    ]  # fmt: skip
    # Footprints missing from the 2009–2012 NC inventory still render, flagged "no NC record";
    # they carry only a height (Overture) and no attributes.
    extra = missing_from_nc.rename(columns={"height": "height_m"})[
        ["id", "height_m", "geometry"]
    ].copy()
    extra["id"] = "ov:" + extra["id"].astype(str)
    extra["height_m"] = extra["height_m"].round(1)
    extra["height_src"] = extra["height_m"].map(lambda h: "overture:height" if h == h else None)
    extra["nc_record"] = False
    tiles = pd.concat([bld.assign(nc_record=True), extra], ignore_index=True)
    srcs = _sources(area, "nc_bldg", "osm", "overture")
    path, kind = write_building_tiles(
        gpd.GeoDataFrame(tiles, crs=4326),
        [*props, "nc_record"],
        area_dir(area.id) / "buildings.pmtiles",
        srcs,
    )
    report["tiles"] = f"{path.name} ({kind}, {path.stat().st_size / 1e6:.1f} MB)"
    report["seconds"] = round(time.time() - t, 1)
    return report


def stage_people(area: Area, refresh: bool = False) -> dict:
    t = time.time()
    if not _work(area, "acs.parquet").exists():
        raise FetchError("ACS data not fetched. Set CENSUS_API_KEY in .env and run --stage fetch.")
    bld = gpd.read_parquet(_work(area, "buildings.parquet"))
    # Footprints missing from the NC inventory but tagged residential in OSM (approved decision).
    extra = gpd.read_parquet(_work(area, "buildings_not_in_nc.parquet"))
    # Unclassified ones stay null-occupancy and may be inferred residential from census housing.
    extra = extra.assign(id=lambda d: "ov:" + d["id"].astype(str))
    bld = pd.concat(
        [bld, extra[["id", "occupancy", "sqft", "stories", "geometry"]]], ignore_index=True
    )
    blocks = gpd.read_parquet(_work(area, "blocks.parquet"))
    acs = pd.read_parquet(_work(area, "acs.parquet"))
    weights = yaml.safe_load((CONFIG / "vulnerability.yaml").read_text())
    res = pmodel.build_residents(area, bld, blocks, acs, weights, area.seed)
    tab = res.table
    srcs = _sources(area, "acs", "census_blocks", "nc_bldg")
    write_json(
        area_dir(area.id) / "residents.json",
        srcs,
        {
            "label": "simulated residents",
            "note": "Synthetic people placed by census totals; no real person is represented.",
            "weights": weights,
            "summary": res.summary,
            "inferred_residential_buildings": {
                "note": "No use record; census block reports housing units and our inventory "
                "has no residential building there. Treat as estimated.",
                "ids": res.inferred["id"].tolist(),
                "housing_units_by_block": res.inferred.groupby("block")["housing_units"]
                .first()
                .astype(int)
                .to_dict(),
            },
            "count": len(tab),
            "columns": {c: tab[c].tolist() for c in tab.columns},
        },
    )
    return {**res.summary, "seconds": round(time.time() - t, 1)}


def _m2(name: str):
    def run(area: Area, refresh: bool = False) -> dict:
        from . import stages_flood, stages_rounds

        mod = stages_rounds if name == "rounds" else stages_flood
        return getattr(mod, f"stage_{name}")(area, refresh)

    return run


STAGES = {
    "fetch": stage_fetch,
    "buildings": stage_buildings,
    "people": stage_people,
    "flood": _m2("flood"),
    "damage": _m2("damage"),
    "roads": _m2("roads"),
    "validate": _m2("validate"),
    "rounds": _m2("rounds"),
}
