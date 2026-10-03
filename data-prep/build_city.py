#!/usr/bin/env python3
"""Build a city pack from open data.

    .venv/bin/python build_city.py raleigh|miami|new-york|san-francisco|all

Writes compact JSON into web/public/data/<city>/. Downloads are cached in
data-prep/cache/, so re-runs only redo the processing.

Shared sources
  OpenStreetMap via OSMnx/Overpass: drive network, facilities, bus stops, names
  U.S. Census Bureau ACS 5-year (tract) via Esri Living Atlas
    "ACS Context for Emergency Response"
Hazard sources
  flood (Raleigh), coastal (Miami): FEMA National Flood Hazard Layer
  heat (New York): OSM green and blue space, ACS density, NYC Heat Vulnerability Index
  quake (San Francisco): USGS/ABAG liquefaction scenario, San Andreas (all northern segments)
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import sys
import time

import geopandas as gpd
import h3
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
import requests
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, Point, box, mapping
from shapely.ops import unary_union

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path(__file__).resolve().parent / "cache"
EDGE_SAMPLE_M = 15

CITIES = {
    "raleigh": dict(place="Raleigh, North Carolina, USA", counties=["37183"], utm="EPSG:32617", hazard="flood", h3_res=11, buffer_m=150),
    "miami": dict(place="Miami, Florida, USA", counties=["12086"], utm="EPSG:32617", hazard="coastal", h3_res=11, buffer_m=150),
    "new-york": dict(bbox=(-73.962, 40.796, -73.858, 40.872), counties=["36061", "36005"], utm="EPSG:32618", hazard="heat", h3_res=10),
    "san-francisco": dict(place="San Francisco, California, USA", counties=["06075"], utm="EPSG:32610", hazard="quake", h3_res=10, buffer_m=100),
}

ACS_SERVICE = (
    "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/"
    "ACS_Context_for_Emergency_Response_View_Boundaries/FeatureServer"
)
FEMA_LAYER = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
LIQ_LAYER = "https://services3.arcgis.com/i2dkYWmb4wHvYPda/arcgis/rest/services/liq_sanandreas_allnorthern/FeatureServer/1"
FAULT_SERVICE = "https://gis.conservation.ca.gov/server/rest/services/CGS_Earthquake_Hazard_Zones/SHP_Fault_Traces/MapServer"
NYC_HVI = "https://data.cityofnewyork.us/resource/4mhf-duep.json"
ZCTA_LAYER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer"

ACS_FIELDS = {
    "GEOID": "geoid", "NAME": "tract_name",
    "B01001_001E": "pop", "B01001_calc_numGE65E": "pop65", "B01001_calc_numLT18E": "pop_u18",
    "B08201_002E": "hh_noveh", "B28001_001E": "hh",
    "B17020_001E": "pov_universe", "B17020_002E": "pov",
    "B18101_calc_numDE": "disab", "B16004_calc_numGE18LEAE": "lep", "B28002_013E": "hh_nonet",
    "B09021_023E": "pop65_alone",
}

ROAD_CLASS = {
    "motorway": 0, "motorway_link": 0, "trunk": 1, "trunk_link": 1,
    "primary": 2, "primary_link": 2, "secondary": 3, "secondary_link": 3,
    "tertiary": 4, "tertiary_link": 4,
    "residential": 5, "unclassified": 5, "living_street": 5, "road": 5,
}
RESIDENTIAL_WEIGHT = {0: 0.0, 1: 0.0, 2: 0.15, 3: 0.3, 4: 0.6, 5: 1.0, 6: 0.5}

# Provisional arrival models, only used to pick the earliest-hit cell on an edge.
# The game recomputes timing from web/src/config/game.ts.
FLOOD_T0 = {1: 5.0, 2: 9.0, 3: 16.0}
FLOOD_SPEED = {1: 110.0, 2: 80.0, 3: 60.0}
COASTAL = {  # src -> (t0 by class, spread m/h)
    1: ({1: 10.0, 2: 11.0, 3: 13.0}, 900.0),   # surge
    2: ({1: 5.0, 2: 6.0, 3: 12.0}, 40.0),      # rain ponding
    3: ({1: 8.0, 2: 8.0, 3: 12.0}, 150.0),     # canal overflow
}

ox.settings.use_cache = True
ox.settings.cache_folder = str(CACHE / "osmnx")
ox.settings.requests_timeout = 600
ox.settings.log_console = False
T_START = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T_START:6.1f}s] {msg}", flush=True)


def first(value, default=None):
    if isinstance(value, list):
        return value[0] if value else default
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return default
    return value


def r5(x: float) -> float:
    return round(float(x), 5)


def arcgis_geojson(layer_url: str, params: dict, cache_name: str, page: int = 1000) -> gpd.GeoDataFrame:
    path = CACHE / f"{cache_name}.geojson"
    if path.exists():
        return gpd.read_file(path)
    count_params = {k: v for k, v in params.items() if k in ("where", "geometry", "geometryType", "inSR", "spatialRel")}
    total = requests.get(f"{layer_url}/query", params={**count_params, "returnCountOnly": "true", "f": "json"}, timeout=120).json()["count"]
    feats: list[dict] = []
    while len(feats) < total:
        q = {**params, "f": "geojson", "resultOffset": len(feats), "resultRecordCount": page}
        for attempt in range(4):
            try:
                r = requests.get(f"{layer_url}/query", params=q, timeout=300)
                r.raise_for_status()
                batch = r.json().get("features", [])
                break
            except Exception as exc:  # noqa: BLE001
                log(f"  retry {attempt + 1} for {cache_name}: {exc}")
                time.sleep(3 * (attempt + 1))
        else:
            raise RuntimeError(f"failed to download {cache_name}")
        if not batch:
            break
        feats.extend(batch)
        log(f"  {cache_name}: {len(feats)}/{total}")
    gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326") if feats else gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(path, driver="GeoJSON")
    return gdf


def acs_vintage() -> str:
    try:
        svc = requests.get(ACS_SERVICE, params={"f": "json"}, timeout=60).json()
        item = requests.get(f"https://www.arcgis.com/sharing/rest/content/items/{svc['serviceItemId']}", params={"f": "json"}, timeout=60).json()
        m = re.search(r"(20\d\d)\s*[-–]\s*(20\d\d)", f"{item.get('snippet', '')} {item.get('description', '')}")
        if m:
            return f"{m.group(1)}-{m.group(2)}"
    except Exception as exc:  # noqa: BLE001
        log(f"  could not read ACS vintage: {exc}")
    return "latest 5-year release"


OVERPASS = ["https://overpass-api.de/api", "https://maps.mail.ru/osm/tools/overpass/api"]


def osm_features(polygon, tags: dict, name: str) -> gpd.GeoDataFrame:
    last = None
    for attempt in range(6):
        ox.settings.overpass_url = OVERPASS[attempt % len(OVERPASS)]
        try:
            gdf = ox.features_from_polygon(polygon, tags)
            ox.settings.overpass_url = OVERPASS[0]
            return gdf.reset_index()
        except ox._errors.InsufficientResponseError as exc:  # no matching features
            log(f"  no OSM features for {name}: {exc}")
            break
        except Exception as exc:  # noqa: BLE001
            last = exc
            log(f"  Overpass error for {name} via {ox.settings.overpass_url}: {str(exc)[:120]}; retrying")
            time.sleep(5 * (attempt + 1))
    ox.settings.overpass_url = OVERPASS[0]
    if last is not None:
        raise RuntimeError(f"OSM download failed for {name}") from last
    return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")


NYC_OD = "https://data.cityofnewyork.us/resource"


def socrata(url: str, params: dict | None = None) -> list[dict]:
    for attempt in range(4):
        try:
            r = requests.get(url, params={"$limit": 50000, **(params or {})}, timeout=120)
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001
            log(f"  retry {attempt + 1} for {url}: {exc}")
            time.sleep(3 * (attempt + 1))
    return []


def nyc_open_data():
    """Official NYC facility layers, so New York does not depend on Overpass."""
    def pts(rows, name_fn, lon_key="longitude", lat_key="latitude"):
        out = []
        for r in rows:
            try:
                lon, lat = float(r[lon_key]), float(r[lat_key])
            except (KeyError, TypeError, ValueError):
                continue
            nm = name_fn(r)
            if nm:
                out.append((nm, lon, lat))
        return out

    schools = pts(socrata(f"{NYC_OD}/wg9x-4ke6.json"), lambda r: r.get("location_name"))
    libs = []
    for r in socrata(f"{NYC_OD}/feuq-due4.json"):
        g = r.get("the_geom")
        if isinstance(g, dict) and g.get("coordinates"):
            libs.append((f"{r.get('name')} Library", g["coordinates"][0], g["coordinates"][1]))
    centers = pts(socrata(f"{NYC_OD}/crns-fw6u.json"), lambda r: f"{r.get('development', '').strip()} Community Center" if "Community Center" in str(r.get("program_type", "")) else None)
    fire = pts(socrata(f"{NYC_OD}/hc8x-tcnd.json"), lambda r: r.get("facilityname"))
    stops = pts(socrata(f"{NYC_OD}/t4f2-8md7.json"), lambda r: f"{str(r.get('on_street', '')).title()} & {str(r.get('cross_stre', '')).title()}")
    hosp = pts(
        socrata("https://health.data.ny.gov/resource/vn5v-hh5r.json", {"$where": "fac_desc_short='HOSP' AND (county='New York' OR county='Bronx')"}),
        lambda r: r.get("facility_name") if "Behavioral" not in str(r.get("facility_name", "")) else None,
    )
    nta = None
    try:
        nta = gpd.read_file(f"{NYC_OD}/9nt8-h7nd.geojson?$limit=500")
    except Exception as exc:  # noqa: BLE001
        log(f"  NTA boundaries unavailable: {exc}")
    log(f"  NYC Open Data: {len(schools)} schools, {len(libs)} libraries, {len(centers)} community centers, {len(fire)} firehouses, {len(stops)} bus shelters, {len(hosp)} hospitals")
    return {"schools": schools, "libraries": libs, "centers": centers, "fire": fire, "stops": stops, "hospitals": hosp, "nta": nta}


def build(city_id: str) -> None:
    cfg = CITIES[city_id]
    UTM = cfg["utm"]
    H3_RES = cfg["h3_res"]
    hazard = cfg["hazard"]
    out_dir = ROOT / "web" / "public" / "data" / city_id
    out_dir.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    retrieved = dt.date.today().isoformat()
    to_ll = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True)
    to_utm = Transformer.from_crs("EPSG:4326", UTM, always_xy=True)
    log(f"===== {city_id} ({hazard}) =====")

    # ---------------------------------------------------------- study area
    if "bbox" in cfg:
        study_poly = gpd.GeoSeries([box(*cfg["bbox"])], crs=4326).to_crs(UTM).iloc[0]
    else:
        study_poly = ox.geocode_to_gdf(cfg["place"]).to_crs(UTM).geometry.iloc[0]
    where = " OR ".join(f"GEOID LIKE '{c}%'" for c in cfg["counties"])
    tracts = arcgis_geojson(f"{ACS_SERVICE}/2", {"where": where, "outFields": ",".join(ACS_FIELDS), "outSR": 4326, "geometryPrecision": 6}, f"acs_tracts_{city_id}")
    tracts = tracts.rename(columns=ACS_FIELDS).to_crs(UTM)
    tracts["overlap"] = tracts.geometry.intersection(study_poly).area / tracts.geometry.area
    tracts = tracts[(tracts["overlap"] >= 0.5) & (tracts["pop"] > 0)].reset_index(drop=True)
    log(f"  {len(tracts)} tracts, population {int(tracts['pop'].sum()):,}")
    study = unary_union(tracts.geometry.values)
    study_buf = study.buffer(800)
    study_ll = gpd.GeoSeries([study_buf], crs=UTM).to_crs(4326).iloc[0]
    minx, miny, maxx, maxy = gpd.GeoSeries([study_buf], crs=UTM).to_crs(4326).total_bounds

    # ---------------------------------------------------------- road graph
    log("Drive network (OSMnx)")
    G = ox.graph_from_polygon(study_ll, network_type="drive", simplify=True, retain_all=False)
    G = ox.truncate.largest_component(G, strongly=True)
    G = ox.add_edge_speeds(G, hwy_speeds={"residential": 40, "unclassified": 40, "living_street": 20, "tertiary": 50, "secondary": 60, "primary": 70, "trunk": 90, "motorway": 105})
    G = ox.add_edge_travel_times(G)
    nodes_gdf, edges_gdf = ox.graph_to_gdfs(G)
    log(f"  graph: {len(nodes_gdf):,} nodes, {len(edges_gdf):,} directed edges")
    node_ids = list(nodes_gdf.index)
    node_index = {nid: i for i, nid in enumerate(node_ids)}
    node_lon = nodes_gdf["x"].to_numpy()
    node_lat = nodes_gdf["y"].to_numpy()
    nx_, ny_ = to_utm.transform(node_lon, node_lat)
    node_x, node_y = np.asarray(nx_), np.asarray(ny_)
    node_tree = shapely.STRtree(shapely.points(node_x, node_y))

    def nearest_node(lon: float, lat: float) -> int:
        x, y = to_utm.transform(lon, lat)
        return int(node_tree.query_nearest(Point(x, y))[0])

    # ---------------------------------------------------------- green / blue space (heat, fire fuel)
    green = gpd.GeoDataFrame(geometry=[], crs=UTM)
    if hazard in ("heat", "quake"):
        g = osm_features(study_ll, {"leisure": ["park", "garden", "nature_reserve", "golf_course", "pitch"], "landuse": ["grass", "forest", "recreation_ground", "cemetery", "meadow"], "natural": ["wood", "scrub", "water", "grassland", "beach"], "water": True}, "green space")
        if len(g):
            g = g[g.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].to_crs(UTM)
            green = g[["geometry"]].copy()
            green["geometry"] = green.geometry.buffer(0)
        log(f"  {len(green)} green/blue polygons")
    green_tree = shapely.STRtree(green.geometry.values) if len(green) else None

    def green_share(x: np.ndarray, y: np.ndarray, radius: float) -> np.ndarray:
        out = np.zeros(len(x))
        if green_tree is None:
            return out
        bufs = shapely.buffer(shapely.points(x, y), radius, quad_segs=4)
        pairs = green_tree.query(bufs, predicate="intersects")
        geoms = green.geometry.values
        acc = np.zeros(len(x))
        for bi, gi in zip(pairs[0], pairs[1]):
            acc[bi] += bufs[bi].intersection(geoms[gi]).area
        return np.minimum(1.0, acc / (np.pi * radius * radius))

    # ---------------------------------------------------------- hazard layers -> H3 cells
    # cell -> [cls, dist, sid, src, v, b]
    cell_info: dict[str, list] = {}
    feature_names: list[str] = []
    feature_lines = []  # (name, kind, utm geometry)
    zone_polys: list[tuple] = []  # (utm geometry, cls, src) for display
    hazard_area = None
    sources_meta = []
    shield_points = []

    if hazard in ("flood", "coastal"):
        log("FEMA flood hazard zones (NFHL)")
        fema = arcgis_geojson(
            FEMA_LAYER,
            {"where": "SFHA_TF = 'T' OR ZONE_SUBTY LIKE '0.2 PCT%'", "geometry": f"{minx},{miny},{maxx},{maxy}", "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE", "outSR": 4326, "geometryPrecision": 6},
            "fema_nfhl_raleigh" if city_id == "raleigh" else f"fema_nfhl_{city_id}", page=500,
        )

        def fema_class(row) -> int:
            zone = str(row.get("FLD_ZONE") or "").upper()
            sub = str(row.get("ZONE_SUBTY") or "").upper()
            if hazard == "coastal" and zone.startswith("V"):
                return 1
            if hazard == "flood" and "FLOODWAY" in sub:
                return 1
            if row.get("SFHA_TF") == "T":
                return 2
            if "0.2 PCT" in sub:
                return 3
            return 0

        fema["cls"] = fema.apply(fema_class, axis=1)
        fema["zone"] = fema["FLD_ZONE"].fillna("").astype(str).str.upper()
        fema = fema[fema["cls"] > 0].to_crs(UTM)
        fema["geometry"] = fema.geometry.buffer(0).intersection(study_buf)
        fema = fema[~fema.geometry.is_empty]
        by_class = {c: unary_union(fema[fema["cls"] == c].geometry.values) for c in (1, 2, 3)}
        for c, gg in by_class.items():
            log(f"  class {c}: {gg.area / 1e6:.2f} km2")
        hazard_area = unary_union([gg for gg in by_class.values() if not gg.is_empty]).buffer(cfg["buffer_m"])
        for c, gg in by_class.items():
            if not gg.is_empty:
                zone_polys.append((gg, c, 0))

        water_tags = {"waterway": ["river", "stream", "canal", "drain"]}
        water = osm_features(study_ll, water_tags, "waterways")
        water = water[water.geometry.geom_type.isin(["LineString", "MultiLineString"])].to_crs(UTM)
        water["name"] = water.get("name", pd.Series(index=water.index, dtype=object)).fillna("")
        if hazard == "coastal":
            water = water[water["waterway"].isin(["canal", "river", "drain"])]
        named = water[water["name"] != ""].copy()
        feature_names = sorted(named["name"].unique().tolist())
        fid = {n: i for i, n in enumerate(feature_names)}
        water_tree = shapely.STRtree(water.geometry.values) if len(water) else None
        named_tree = shapely.STRtree(named.geometry.values) if len(named) else None
        named_sid = np.array([fid[n] for n in named["name"]]) if len(named) else np.array([])
        log(f"  {len(water)} waterway segments, {len(feature_names)} named")

        cell_cls: dict[str, int] = {}
        for c in (3, 2, 1):
            gll = gpd.GeoSeries([by_class[c]], crs=UTM).to_crs(4326).iloc[0]
            for part in (list(gll.geoms) if gll.geom_type == "MultiPolygon" else [gll]):
                if not part.is_empty:
                    for cell in h3.geo_to_cells(mapping(part), H3_RES):
                        cell_cls[cell] = c
        cells = list(cell_cls)
        ll = np.array([h3.cell_to_latlng(c) for c in cells])
        cx, cy = to_utm.transform(ll[:, 1], ll[:, 0])
        pts = shapely.points(cx, cy)
        d_water = water_tree.query_nearest(pts, return_distance=True, all_matches=False)[1] if water_tree is not None else np.full(len(cells), 3000.0)
        sid_arr = named_sid[named_tree.query_nearest(pts, all_matches=False)[1]] if named_tree is not None else np.full(len(cells), -1)

        if hazard == "flood":
            sources_meta = [{"src": 0, "name": "Riverine flooding"}]
            for i, cell in enumerate(cells):
                cell_info[cell] = [cell_cls[cell], int(min(d_water[i], 3000)), int(sid_arr[i]), 0, 0, 0]
            for nm, grp in named[named["name"].str.contains("Creek|River|Branch", regex=True)].groupby("name"):
                feature_lines.append((nm, "stream", unary_union(grp.geometry.values)))
        else:
            sources_meta = [{"src": 1, "name": "Storm surge"}, {"src": 2, "name": "Rainfall ponding"}, {"src": 3, "name": "Canal overflow"}]
            coast = osm_features(study_ll.buffer(0.02), {"natural": "coastline"}, "coastline")
            coast = coast[coast.geometry.geom_type.isin(["LineString", "MultiLineString"])].to_crs(UTM) if len(coast) else coast
            coast_tree = shapely.STRtree(coast.geometry.values) if len(coast) else None
            d_coast = coast_tree.query_nearest(pts, return_distance=True, all_matches=False)[1] if coast_tree is not None else np.full(len(cells), 1e5)
            edge_dist = np.zeros(len(cells))
            cls_arr = np.array([cell_cls[c] for c in cells])
            for c in (1, 2, 3):
                if by_class[c].is_empty:
                    continue
                b = by_class[c].boundary
                parts = list(b.geoms) if hasattr(b, "geoms") else [b]
                seg_tree = shapely.STRtree(parts)
                sel = np.where(cls_arr == c)[0]
                if len(sel):
                    edge_dist[sel] = seg_tree.query_nearest(pts[sel], return_distance=True, all_matches=False)[1]
            for i, cell in enumerate(cells):
                c = cell_cls[cell]
                edge_d = float(edge_dist[i])
                if c == 1 or (d_coast[i] <= 1200 and c <= 2):
                    src, dist, sid = 1, d_coast[i], -1
                elif d_water[i] <= 250:
                    src, dist, sid = 3, d_water[i], int(sid_arr[i])
                else:
                    src, dist, sid = 2, max(0.0, 200.0 - edge_d), -1
                cell_info[cell] = [c, int(min(dist, 20000)), sid, src, 0, 0]
            for nm, grp in named.groupby("name"):
                feature_lines.append((nm, "canal", unary_union(grp.geometry.values)))
            log(f"  surge {sum(1 for v in cell_info.values() if v[3] == 1):,} · rain {sum(1 for v in cell_info.values() if v[3] == 2):,} · canal {sum(1 for v in cell_info.values() if v[3] == 3):,} cells")

    elif hazard == "heat":
        sources_meta = [{"src": 4, "name": "Extreme heat"}]
        cells = list(h3.geo_to_cells(mapping(gpd.GeoSeries([study], crs=UTM).to_crs(4326).iloc[0]), H3_RES))
        ll = np.array([h3.cell_to_latlng(c) for c in cells])
        cx, cy = to_utm.transform(ll[:, 1], ll[:, 0])
        cx, cy = np.asarray(cx), np.asarray(cy)
        gs = green_share(cx, cy, 300)
        dens = tracts["pop"].to_numpy() / (tracts.geometry.area.to_numpy() / 1e6)
        dens_norm = np.minimum(1.0, dens / np.percentile(dens, 95))
        hits = shapely.STRtree(tracts.geometry.values).query(shapely.points(cx, cy), predicate="within")
        cell_dens = np.full(len(cells), np.median(dens_norm))
        cell_dens[hits[0]] = dens_norm[hits[1]]
        heat = np.clip(0.6 * (1 - np.minimum(1, gs / 0.35)) + 0.4 * cell_dens, 0, 1)
        for i, cell in enumerate(cells):
            hv = float(heat[i])
            cls = 1 if hv >= 0.75 else 2 if hv >= 0.6 else 3 if hv >= 0.45 else 0
            cell_info[cell] = [cls, 0, -1, 4, int(round(hv * 1000)), 0]
        log(f"  {len(cells):,} heat cells, hot (cls 1-2): {sum(1 for v in cell_info.values() if 1 <= v[0] <= 2):,}")

    elif hazard == "quake":
        sources_meta = [{"src": 1, "name": "Liquefaction"}, {"src": 5, "name": "Fire"}]
        log("Liquefaction scenario (USGS/ABAG, San Andreas all northern segments)")
        liq = arcgis_geojson(LIQ_LAYER, {"where": "1=1", "geometry": f"{minx},{miny},{maxx},{maxy}", "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "liqhaz,liq,value", "outSR": 4326, "geometryPrecision": 6}, f"liq_sanandreas_{city_id}")
        liq = liq.to_crs(UTM)
        liq["cls"] = liq["liqhaz"].map({"High": 1, "Moderate": 2}).fillna(0).astype(int)
        liq["geometry"] = liq.geometry.buffer(0).intersection(study_buf)
        liq = liq[~liq.geometry.is_empty]
        for c in (1, 2):
            gg = unary_union(liq[liq["cls"] == c].geometry.values)
            if not gg.is_empty:
                zone_polys.append((gg, c, 1))
                log(f"  liquefaction class {c}: {gg.area / 1e6:.2f} km2")
        cells = list(h3.geo_to_cells(mapping(gpd.GeoSeries([study], crs=UTM).to_crs(4326).iloc[0]), H3_RES))
        ll = np.array([h3.cell_to_latlng(c) for c in cells])
        cx, cy = to_utm.transform(ll[:, 1], ll[:, 0])
        cx, cy = np.asarray(cx), np.asarray(cy)
        pts = shapely.points(cx, cy)
        liq_tree = shapely.STRtree(liq.geometry.values)
        hits = liq_tree.query(pts, predicate="within")
        cls_arr = np.zeros(len(cells), dtype=int)
        mmi = np.full(len(cells), 7.4)
        liq_cls = liq["cls"].to_numpy()
        liq_val = liq["value"].to_numpy()
        for pi, gi in zip(hits[0], hits[1]):
            if liq_cls[gi] and (cls_arr[pi] == 0 or liq_cls[gi] < cls_arr[pi]):
                cls_arr[pi] = liq_cls[gi]
            mmi[pi] = max(mmi[pi], liq_val[gi])
        # fire fuel: residential street density, zero in parks and water
        node_w0 = np.zeros(len(node_ids))
        for row in edges_gdf.reset_index().itertuples(index=False):
            w = float(row.length) * RESIDENTIAL_WEIGHT[ROAD_CLASS.get(first(row.highway, "road"), 6)] / 2
            node_w0[node_index[row.u]] += w
            node_w0[node_index[row.v]] += w
        cell_fuel = np.zeros(len(cells))
        cell_of_node = [h3.latlng_to_cell(la, lo, H3_RES) for lo, la in zip(node_lon, node_lat)]
        cidx = {c: i for i, c in enumerate(cells)}
        for ni, c in enumerate(cell_of_node):
            if c in cidx:
                cell_fuel[cidx[c]] += node_w0[ni]
        fuel = np.minimum(1.0, cell_fuel / max(1.0, np.percentile(cell_fuel[cell_fuel > 0], 90)))
        gs = green_share(cx, cy, 60)
        fuel = np.where(gs > 0.5, 0.0, fuel * (1 - gs))
        for i, cell in enumerate(cells):
            cell_info[cell] = [int(cls_arr[i]), 0, -1, 1 if cls_arr[i] else 0, int(round(mmi[i] * 100)), int(round(fuel[i] * 100))]
        log(f"  {len(cells):,} cells, liquefaction {int((cls_arr > 0).sum()):,}, fuel>0.5 {int((fuel > 0.5).sum()):,}")
        # residents on the ground most likely to fail (High liquefaction hazard) must leave; fire risk is resolved at runtime
        high = [p[0] for p in zone_polys if p[1] == 1]
        hazard_area = unary_union(high).buffer(cfg["buffer_m"]) if high else None
        try:
            svc = requests.get(FAULT_SERVICE, params={"f": "json"}, timeout=60).json()
            layer_id = svc["layers"][0]["id"]
            faults = arcgis_geojson(f"{FAULT_SERVICE}/{layer_id}", {"where": "1=1", "geometry": f"{minx - 0.25},{miny - 0.25},{maxx + 0.25},{maxy + 0.25}", "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326}, f"faults_{city_id}")
            for row in faults.to_crs(UTM).itertuples(index=False):
                nm = next((str(getattr(row, k)) for k in ("NAME", "Name", "FAULT_NAME", "fault_name") if hasattr(row, k) and getattr(row, k)), "Fault trace")
                feature_lines.append((nm, "fault", row.geometry))
            log(f"  {len(faults)} fault trace segments")
        except Exception as exc:  # noqa: BLE001
            log(f"  fault traces unavailable: {exc}")

    cells = list(cell_info)
    cell_index = {c: i for i, c in enumerate(cells)}

    def arrival(info) -> float:
        cls, dist, _sid, src = info[0], info[1], info[2], info[3]
        if hazard == "flood":
            return FLOOD_T0[cls] + dist / FLOOD_SPEED[cls] if cls else 1e9
        if hazard == "coastal":
            t0, sp = COASTAL[src]
            return t0[cls] + dist / sp if cls else 1e9
        if hazard == "quake":
            return 0.1 if cls else 1e9
        return 1e9

    def worst(cells_to_check):
        best, best_t = None, 1e18
        for cell in cells_to_check:
            info = cell_info.get(cell)
            if info is None:
                continue
            t = arrival(info) if hazard != "heat" else -info[4]
            if hazard == "quake":
                t = (info[0] if info[0] else 9) * 100 - info[4] / 100
            if t < best_t:
                best_t, best = t, cell
        return best

    def exposure_at(lon: float, lat: float, k: int):
        c = h3.latlng_to_cell(lat, lon, H3_RES)
        if hazard in ("heat", "quake"):
            return c if c in cell_info else None
        return worst(h3.grid_disk(c, k))

    # ---------------------------------------------------------- edges
    log("Edges: dedupe, classify, exposure")
    edges_gdf = edges_gdf.reset_index()
    edges_utm = edges_gdf.to_crs(UTM)
    names: list[str] = [""]
    name_index = {"": 0}
    seen: set[tuple] = set()
    E = {k: [] for k in ("u", "v", "len", "tt", "cls", "name", "oneway", "fcls", "fdist", "fsid", "fshare", "fsrc", "fv", "fcell", "bridge")}
    geoms: list[list[float]] = []
    edge_utm_geoms: list[LineString] = []
    for row, row_utm in zip(edges_gdf.itertuples(index=False), edges_utm.geometry.values):
        u, v = row.u, row.v
        oneway = bool(row.oneway)
        if not oneway:
            key = (min(u, v), max(u, v), round(float(row.length)))
            if key in seen:
                continue
            seen.add(key)
        cls = ROAD_CLASS.get(first(row.highway, "road"), 6)
        nm = str(first(getattr(row, "name", None), "") or "")
        if nm not in name_index:
            name_index[nm] = len(names)
            names.append(nm)
        n_samples = max(2, int(row_utm.length // EDGE_SAMPLE_M) + 1)
        pts_e = shapely.line_interpolate_point(row_utm, np.linspace(0, row_utm.length, n_samples))
        lons, lats = to_ll.transform(shapely.get_x(pts_e), shapely.get_y(pts_e))
        sample_cells = [h3.latlng_to_cell(la, lo, H3_RES) for lo, la in zip(lons, lats)]
        exposed = [c for c in sample_cells if c in cell_info and cell_info[c][0] > 0]
        best = worst(exposed) if exposed and hazard != "heat" else None
        mid = sample_cells[len(sample_cells) // 2]
        info = cell_info[best] if best else None
        bridge = first(getattr(row, "bridge", None), None)
        E["u"].append(node_index[u])
        E["v"].append(node_index[v])
        E["len"].append(round(float(row.length), 1))
        E["tt"].append(round(float(row.travel_time), 1))
        E["cls"].append(cls)
        E["name"].append(name_index[nm])
        E["oneway"].append(1 if oneway else 0)
        E["fcls"].append(info[0] if info else 0)
        E["fdist"].append(info[1] if info else 0)
        E["fsid"].append(info[2] if info else -1)
        E["fshare"].append(round(len(exposed) / len(sample_cells), 2) if hazard != "heat" else 0)
        E["fsrc"].append(info[3] if info else 0)
        E["fv"].append(cell_info[mid][4] if mid in cell_info else 0)
        E["fcell"].append(cell_index[best] if best else cell_index.get(mid, -1))
        E["bridge"].append(1 if bridge and str(bridge) not in ("no", "False") else 0)
        geoms.append([r5(c) for xy in row.geometry.simplify(0.00003, preserve_topology=False).coords for c in xy])
        edge_utm_geoms.append(row_utm)
    n_edges = len(E["u"])
    log(f"  {n_edges:,} road segments, {sum(1 for f in E['fcls'] if f):,} hazard-exposed")

    # ---------------------------------------------------------- crossings (protectable road groups)
    def group_edges(edge_set: set[int]) -> list[list[int]]:
        g = nx.Graph()
        for ei in edge_set:
            g.add_node(("e", ei))
            for n in (E["u"][ei], E["v"][ei]):
                g.add_edge(("e", ei), ("n", n))
        groups = []
        for comp in nx.connected_components(g):
            by_name: dict[int, list[int]] = {}
            for x in comp:
                if x[0] == "e":
                    by_name.setdefault(E["name"][x[1]], []).append(x[1])
            groups.extend(by_name.values())
        return groups

    crossings = []

    def add_crossing(kind: str, grp: list[int], sid: int, place: str):
        longest = max(grp, key=lambda i: E["len"][i])
        mid = edge_utm_geoms[longest].interpolate(0.5, normalized=True)
        mlon, mlat = to_ll.transform(mid.x, mid.y)
        road = names[E["name"][longest]] or "Unnamed road"
        crossings.append({"id": len(crossings), "kind": kind, "label": f"{road} {place}", "road": road, "stream": sid, "edges": sorted(grp), "cls": min(E["cls"][i] for i in grp), "len": round(sum(E["len"][i] for i in grp)), "lon": r5(mlon), "lat": r5(mlat)})

    if hazard in ("flood", "coastal"):
        culvert_hits: set[int] = set()
        culvert_sid: dict[int, int] = {}
        if len(water):
            pairs = shapely.STRtree(edge_utm_geoms).query(water.geometry.values, predicate="intersects")
            wnames = water["name"].to_numpy()
            fid = {n: i for i, n in enumerate(feature_names)}
            for wi, ei in zip(pairs[0], pairs[1]):
                if E["fcls"][ei] == 0 and E["cls"][ei] <= 5:
                    culvert_hits.add(int(ei))
                    if wnames[wi] in fid:
                        culvert_sid[int(ei)] = fid[wnames[wi]]
        for grp in group_edges({i for i in range(n_edges) if E["fcls"][i]}):
            if sum(E["len"][i] for i in grp) < 20:
                continue
            sids = [E["fsid"][i] for i in grp if E["fsid"][i] >= 0]
            srcs = [E["fsrc"][i] for i in grp]
            sid = max(set(sids), key=sids.count) if sids else -1
            src = max(set(srcs), key=srcs.count)
            if hazard == "coastal" and src == 1:
                place = "on the surge-exposed waterfront"
            elif sid >= 0:
                place = f"at {feature_names[sid]}"
            else:
                place = "in a low-lying flood zone" if hazard == "coastal" else "at an unnamed tributary"
            add_crossing("floodplain", grp, sid, place)
        for grp in group_edges(culvert_hits):
            if min(E["cls"][i] for i in grp) > 4:
                continue
            sids = [culvert_sid[i] for i in grp if i in culvert_sid]
            sid = max(set(sids), key=sids.count) if sids else -1
            add_crossing("culvert", grp, sid, f"at {feature_names[sid]}" if sid >= 0 else ("over a canal" if hazard == "coastal" else "at an unnamed tributary"))
    elif hazard == "quake":
        for grp in group_edges({i for i in range(n_edges) if E["fcls"][i] or (E["bridge"][i] and E["fcls"][i])}):
            if sum(E["len"][i] for i in grp) < 40:
                continue
            c = min(E["fcls"][i] for i in grp if E["fcls"][i])
            add_crossing("corridor", grp, -1, "through the liquefaction zone" if c == 1 else "on soft ground")
    log(f"  {len(crossings)} protectable road groups")

    # ---------------------------------------------------------- population weights
    node_w = np.zeros(len(node_ids))
    for i in range(n_edges):
        w = E["len"][i] * RESIDENTIAL_WEIGHT[E["cls"][i]] / 2
        node_w[E["u"][i]] += w
        node_w[E["v"][i]] += w
    node_cells = [h3.latlng_to_cell(la, lo, H3_RES) for lo, la in zip(node_lon, node_lat)]
    if hazard == "heat":
        in_hazard = np.array([cell_info.get(c, [0])[0] in (1, 2) for c in node_cells])
        node_heat = np.array([cell_info[c][4] / 1000 if c in cell_info else 0.5 for c in node_cells])
    elif hazard == "quake":
        in_hazard = shapely.contains_xy(hazard_area, node_x, node_y) if hazard_area is not None else np.zeros(len(node_ids), dtype=bool)
        node_heat = np.ones(len(node_ids))
    else:
        in_hazard = shapely.contains_xy(hazard_area, node_x, node_y)
        node_heat = np.ones(len(node_ids))
    tract_of_node = np.full(len(node_ids), -1)
    hits = shapely.STRtree(tracts.geometry.values).query(shapely.points(node_x, node_y), predicate="within")
    tract_of_node[hits[0]] = hits[1]

    def weighted_kmeans(idx: np.ndarray, k: int, w: np.ndarray, iters: int = 20) -> list[np.ndarray]:
        pts = np.c_[node_x[idx], node_y[idx]]
        k = min(k, len(idx))
        order = np.argsort(-w)
        centers = [pts[order[0]]]
        while len(centers) < k:
            d = np.min([np.sum((pts - c) ** 2, axis=1) for c in centers], axis=0) * (w + 1e-6)
            centers.append(pts[int(np.argmax(d))])
        centers = np.array(centers)
        for _ in range(iters):
            lab = np.argmin(((pts[:, None, :] - centers[None, :, :]) ** 2).sum(-1), axis=1)
            for j in range(k):
                m = lab == j
                if m.any() and w[m].sum() > 0:
                    centers[j] = (pts[m] * w[m, None]).sum(0) / w[m].sum()
        lab = np.argmin(((pts[:, None, :] - centers[None, :, :]) ** 2).sum(-1), axis=1)
        return [idx[lab == j] for j in range(k) if (lab == j).any()]

    def representative(cluster: np.ndarray, w: np.ndarray) -> int:
        cxw = (node_x[cluster] * w).sum() / w.sum()
        cyw = (node_y[cluster] * w).sum() / w.sum()
        return int(cluster[np.argmin((node_x[cluster] - cxw) ** 2 + (node_y[cluster] - cyw) ** 2)])

    # ---------------------------------------------------------- NYC heat vulnerability index by ZCTA
    tract_hvi = np.full(len(tracts), 3.0)
    if hazard == "heat":
        try:
            hvi = pd.DataFrame(requests.get(NYC_HVI, params={"$limit": 5000}, timeout=60).json())
            hvi["hvi"] = hvi["hvi"].astype(float)
            svc = requests.get(ZCTA_LAYER, params={"f": "json"}, timeout=60).json()
            lid = next(l["id"] for l in svc["layers"] if "zip code tabulation" in l["name"].lower() and "2020" in l["name"])
            zcta = arcgis_geojson(f"{ZCTA_LAYER}/{lid}", {"where": "1=1", "geometry": f"{minx},{miny},{maxx},{maxy}", "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "ZCTA5,GEOID", "outSR": 4326}, f"zcta_{city_id}")
            zcta = zcta.to_crs(UTM)
            key = "ZCTA5" if "ZCTA5" in zcta else "GEOID"
            zmap = dict(zip(hvi["zcta20"].astype(str), hvi["hvi"]))
            cents = tracts.geometry.representative_point()
            zh = shapely.STRtree(zcta.geometry.values).query(cents.values, predicate="within")
            for ti, zi in zip(zh[0], zh[1]):
                tract_hvi[ti] = zmap.get(str(zcta[key].values[zi]), 3.0)
            log(f"  HVI joined for {len(zh[0])} tracts (mean {tract_hvi.mean():.2f})")
        except Exception as exc:  # noqa: BLE001
            log(f"  HVI unavailable, using 3 for all tracts: {exc}")

    # ---------------------------------------------------------- names
    log("Neighbourhood names")
    nyc = nyc_open_data() if city_id == "new-york" else None
    if nyc is not None:
        place_names, place_pts = [], []
        resi = gpd.GeoDataFrame(geometry=[], crs=UTM)
    else:
        places = osm_features(study_ll, {"place": ["neighbourhood", "suburb", "quarter"]}, "places")
        places = places[places.geometry.geom_type == "Point"].to_crs(UTM) if len(places) else places
        place_names = places["name"].fillna("").tolist() if len(places) else []
        place_pts = places.geometry.values if len(places) else []
        resi = osm_features(study_ll, {"landuse": "residential"}, "residential areas")
        if len(resi) and "name" in resi:
            resi = resi[resi["name"].notna() & resi.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].to_crs(UTM)
        else:
            resi = gpd.GeoDataFrame(geometry=[], crs=UTM)
    resi_tree = shapely.STRtree(resi.geometry.values) if len(resi) else None
    centroids = tracts.geometry.representative_point()
    order = []
    for ti, row in tracts.iterrows():
        cands = []
        for nm, pt in zip(place_names, place_pts):
            if not nm:
                continue
            d = pt.distance(centroids[ti])
            if row.geometry.contains(pt):
                cands.append((0, d, nm))
            elif d < 1500:
                cands.append((2, d, nm))
        if resi_tree is not None:
            for ri in resi_tree.query(row.geometry, predicate="intersects"):
                area = resi.geometry.values[ri].intersection(row.geometry).area
                if area > 20000:
                    cands.append((1, -area, str(resi["name"].values[ri])))
        cands.sort()
        order.append((cands[0][0] * 1e7 + cands[0][1] if cands else 1e12, ti, cands))
    used: set[str] = set()
    tract_label = {}
    for _, ti, cands in sorted(order):
        label = next((nm for _, _, nm in cands if nm not in used), None)
        tract_num = str(tracts.loc[ti, "tract_name"]).split(";")[0].replace("Census Tract ", "")
        tract_label[ti] = (label or f"Tract {tract_num}", tract_num)
        if label:
            used.add(label)
    if nyc is not None and nyc["nta"] is not None and len(nyc["nta"]):
        nta = nyc["nta"].to_crs(UTM)
        hits_nta = shapely.STRtree(nta.geometry.values).query(centroids.values, predicate="within")
        names_by_tract = {ti: str(nta["ntaname"].values[ni]) for ti, ni in zip(hits_nta[0], hits_nta[1])}
        counts: dict[str, int] = {}
        order_pop = sorted(names_by_tract, key=lambda t: -float(tracts.loc[t, "pop"]))
        for ti in order_pop:
            nm = names_by_tract[ti]
            counts[nm] = counts.get(nm, 0) + 1
            tract_num = tract_label[ti][1]
            tract_label[ti] = (nm if counts[nm] == 1 else f"{nm} · {tract_num}", tract_num)

    # ---------------------------------------------------------- zones, origins, anchors
    log("Zones, at-risk origins, access anchors")

    def num(row, col):
        v = row.get(col)
        return 0 if v is None or (isinstance(v, float) and np.isnan(v)) else int(round(float(v)))

    zones, origins, anchors = [], [], []
    for ti, row in tracts.iterrows():
        mask = tract_of_node == ti
        idx_all = np.where(mask & (node_w > 0))[0]
        idx_haz = np.where(mask & in_hazard & (node_w > 0))[0]
        W = node_w[idx_all].sum()
        WH = node_w[idx_haz].sum()
        pop = float(row["pop"])
        share = float(WH / W) if W > 0 else 0.0
        if hazard == "heat":
            p65 = num(row, "pop65") / max(1, pop)
            ppov = num(row, "pov") / max(1, num(row, "pov_universe"))
            vulnerable = pop * (p65 + ppov - p65 * ppov)
            no_cooling = 0.10 + 0.05 * (tract_hvi[ti] - 1)
            at_risk = vulnerable * no_cooling * (0.5 + 0.5 * share)
            if not len(idx_haz):
                idx_haz = idx_all
                WH = W
        else:
            at_risk = pop * share
        geom = row.geometry
        hz_area = sum(geom.intersection(p[0]).area for p in zone_polys) if zone_polys else 0.0
        name, tract_num = tract_label[ti]
        zid = len(zones)
        if len(idx_all):
            for cl in weighted_kmeans(idx_all, 4, node_w[idx_all]):
                anchors.append({"z": zid, "n": representative(cl, node_w[cl]), "pop": round(pop * node_w[cl].sum() / W)})
        if at_risk >= 15 and len(idx_haz):
            wh = node_w[idx_haz] * node_heat[idx_haz]
            k = int(np.clip(round(at_risk / 350), 1, 12))
            for cl in weighted_kmeans(idx_haz, k, wh):
                wcl = node_w[cl] * node_heat[cl]
                p = at_risk * wcl.sum() / max(1e-9, wh.sum())
                if p < 15:
                    continue
                rep = representative(cl, wcl)
                cell = exposure_at(float(node_lon[rep]), float(node_lat[rep]), 1)
                info = cell_info[cell] if cell else [0, 0, -1, 0, 0, 0]
                origins.append({"id": len(origins), "z": zid, "n": rep, "lon": r5(node_lon[rep]), "lat": r5(node_lat[rep]), "pop": round(p), "fcls": info[0], "fdist": info[1], "fsid": info[2], "fsrc": info[3], "fv": info[4], "fb": info[5], "cell": cell_index[cell] if cell else -1})
        simple = gpd.GeoSeries([geom.simplify(12)], crs=UTM).to_crs(4326).iloc[0]
        rp = gpd.GeoSeries([centroids[ti]], crs=UTM).to_crs(4326).iloc[0]
        zones.append({
            "type": "Feature",
            "geometry": json.loads(json.dumps(mapping(simple), default=float)),
            "properties": {
                "id": zid, "geoid": str(row["geoid"]), "name": name, "tract": tract_num,
                "pop": num(row, "pop"), "pop65": num(row, "pop65"), "popU18": num(row, "pop_u18"),
                "hh": num(row, "hh"), "hhNoVeh": num(row, "hh_noveh"), "pov": num(row, "pov"), "povUniverse": num(row, "pov_universe"),
                "disab": num(row, "disab"), "lep": num(row, "lep"), "hhNoNet": num(row, "hh_nonet"), "pop65Alone": num(row, "pop65_alone"),
                "atRisk": round(at_risk), "hazardShare": round(share, 3), "floodShare": round(hz_area / geom.area, 3), "areaKm2": round(geom.area / 1e6, 2),
                "hvi": float(tract_hvi[ti]) if hazard == "heat" else None,
                "lon": r5(rp.x), "lat": r5(rp.y),
            },
        })
    for z in zones:
        def rnd(coords):
            if isinstance(coords[0], (int, float)):
                return [r5(coords[0]), r5(coords[1])]
            return [rnd(c) for c in coords]
        z["geometry"]["coordinates"] = rnd(z["geometry"]["coordinates"])
    log(f"  {len(zones)} zones, {len(origins)} origins ({sum(o['pop'] for o in origins):,} residents), {len(anchors)} anchors")

    # cell -> zone, for city-wide grids (blackout, retrofit)
    cell_ll = np.array([h3.cell_to_latlng(c) for c in cells])
    ccx, ccy = to_utm.transform(cell_ll[:, 1], cell_ll[:, 0])
    cz = np.full(len(cells), -1)
    zh = shapely.STRtree(tracts.geometry.values).query(shapely.points(ccx, ccy), predicate="within")
    cz[zh[0]] = zh[1]

    # ---------------------------------------------------------- facilities
    log("Facilities and bus stops")
    facilities = {"shelters": [], "hospitals": [], "fire": []}
    bus = []

    def add_site(key: str, name: str, lon: float, lat: float, kind: str | None = None):
        x, y = to_utm.transform(lon, lat)
        if not study.contains(Point(x, y)):
            return
        cell = exposure_at(lon, lat, 2)
        info = cell_info[cell] if cell else [0, 0, -1, 0, 0, 0]
        rec = {"name": name, "lon": r5(lon), "lat": r5(lat), "n": nearest_node(lon, lat), "fcls": info[0], "fdist": info[1], "fsrc": info[3], "fv": info[4], "cell": cell_index[cell] if cell else -1}
        facilities[key].append({**rec, "kind": kind} if kind else rec)

    if nyc is not None:
        for nm, lon, lat in nyc["schools"]:
            add_site("shelters", nm, lon, lat, "school")
        for nm, lon, lat in nyc["libraries"]:
            add_site("shelters", nm, lon, lat, "library")
        for nm, lon, lat in nyc["centers"]:
            add_site("shelters", nm, lon, lat, "community")
        for nm, lon, lat in nyc["fire"]:
            add_site("fire", nm, lon, lat)
        for nm, lon, lat in nyc["hospitals"]:
            add_site("hospitals", nm, lon, lat)
        for nm, lon, lat in nyc["stops"]:
            x, y = to_utm.transform(lon, lat)
            if study.contains(Point(x, y)):
                bus.append({"id": len(bus), "name": nm, "lon": r5(lon), "lat": r5(lat), "n": nearest_node(lon, lat)})
    fac = osm_features(study_ll, {"amenity": ["school", "community_centre", "hospital", "fire_station", "college", "university", "library", "social_facility"], "leisure": ["sports_centre"], "healthcare": ["hospital"]}, "facilities") if nyc is None else []
    if len(fac):
        fac = fac[fac.geometry.notna()]
        for row, g in zip(fac.itertuples(index=False), fac.to_crs(UTM).geometry.values):
            amenity = getattr(row, "amenity", None)
            leisure = getattr(row, "leisure", None)
            if getattr(row, "healthcare", None) == "hospital" and amenity not in ("school", "college", "university"):
                amenity = "hospital"
            name = str(first(getattr(row, "name", None), "") or "")
            if not name:
                continue
            p = g.representative_point()
            if not study.contains(p):
                continue
            lon, lat = to_ll.transform(p.x, p.y)
            cell = exposure_at(lon, lat, 2)
            info = cell_info[cell] if cell else [0, 0, -1, 0, 0, 0]
            rec = {"name": name, "lon": r5(lon), "lat": r5(lat), "n": nearest_node(lon, lat), "fcls": info[0], "fdist": info[1], "fsrc": info[3], "fv": info[4], "cell": cell_index[cell] if cell else -1}
            if amenity == "hospital":
                facilities["hospitals"].append(rec)
            elif amenity == "fire_station":
                facilities["fire"].append(rec)
            elif amenity in ("school", "community_centre", "college", "university", "library", "social_facility") or leisure == "sports_centre":
                kind = {"school": "school", "community_centre": "community", "college": "college", "university": "college", "library": "library", "social_facility": "community"}.get(amenity, "sports")
                facilities["shelters"].append({**rec, "kind": kind})
    for key in facilities:
        dedup = {}
        for rec in facilities[key]:
            dedup.setdefault(rec["name"] if key == "hospitals" else (rec["name"], rec["n"]), rec)
        facilities[key] = [{"id": i, **r} for i, r in enumerate(dedup.values())]
    stops = osm_features(study_ll, {"highway": "bus_stop"}, "bus stops") if nyc is None else []
    if len(stops):
        stops = stops[stops.geometry.geom_type == "Point"]
        for row in stops.itertuples(index=False):
            lon, lat = row.geometry.x, row.geometry.y
            x, y = to_utm.transform(lon, lat)
            if study.contains(Point(x, y)):
                bus.append({"id": len(bus), "name": str(first(getattr(row, "name", None), "") or ""), "lon": r5(lon), "lat": r5(lat), "n": nearest_node(lon, lat)})
    facilities["busStops"] = bus
    log(f"  {len(facilities['shelters'])} shelter sites, {len(facilities['hospitals'])} hospitals, {len(facilities['fire'])} fire stations, {len(bus)} bus stops")

    # ---------------------------------------------------------- shield candidates (Miami barriers and pumps)
    if hazard == "coastal":
        def thin(cands, spacing, limit, kind, label):
            picked = []
            for score, x, y in sorted(cands, key=lambda c: -c[0]):
                if any((x - px) ** 2 + (y - py) ** 2 < spacing ** 2 for _, px, py in picked):
                    continue
                picked.append((score, x, y))
                if len(picked) >= limit:
                    break
            for _, x, y in picked:
                lon, lat = to_ll.transform(x, y)
                n = nearest_node(lon, lat)
                road = next((names[E["name"][e]] for e in range(n_edges) if (E["u"][e] == n or E["v"][e] == n) and names[E["name"][e]]), "")
                shield_points.append({"id": len(shield_points), "kind": kind, "lon": r5(lon), "lat": r5(lat), "label": f"{label} near {road}" if road else label})

        surge = [(1.0 / (1 + cell_info[c][1]), ccx[i], ccy[i]) for i, c in enumerate(cells) if cell_info[c][3] == 1 and cell_info[c][1] < 500]
        rain_cells = [(i, ccx[i], ccy[i]) for i, c in enumerate(cells) if cell_info[c][3] in (2, 3)]
        rain = []
        if rain_cells:
            rx = np.array([r[1] for r in rain_cells])
            ry = np.array([r[2] for r in rain_cells])
            rtree = shapely.STRtree(shapely.points(rx, ry))
            counts = np.array([len(x) for x in [rtree.query(shapely.Point(x, y).buffer(400)) for x, y in zip(rx, ry)]])
            rain = [(counts[j], rx[j], ry[j]) for j in range(len(rx))]
        thin(surge, 650, 50, "surge", "Shoreline")
        thin(rain, 700, 50, "rain", "Low-lying block")
        log(f"  {sum(s['kind'] == 'surge' for s in shield_points)} barrier sites, {sum(s['kind'] == 'rain' for s in shield_points)} pump sites")

    # ---------------------------------------------------------- outputs
    def dump(name: str, obj) -> None:
        path = out_dir / name
        path.write_text(json.dumps(obj, separators=(",", ":"), default=float))
        log(f"  wrote {name} ({path.stat().st_size / 1e6:.2f} MB)")

    def to_ll_geom(gm, tol):
        return mapping(gpd.GeoSeries([gm.simplify(tol)], crs=UTM).to_crs(4326).iloc[0])

    log("Writing outputs")
    dump("roads.json", {"nodes": [v for i in range(len(node_ids)) for v in (r5(node_lon[i]), r5(node_lat[i]))], "edges": E, "geom": geoms, "names": names})
    dump("hazard_cells.json", {"res": H3_RES, "hazard": hazard, "cells": [[c, *cell_info[c], int(cz[i])] for i, c in enumerate(cells)], "features": feature_names, "sources": sources_meta})
    dump("hazard_zones.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": to_ll_geom(g, 6), "properties": {"cls": c, "src": s}} for g, c, s in zone_polys]})
    dump("features.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": to_ll_geom(g, 10), "properties": {"name": n, "kind": k}} for n, k, g in feature_lines if not g.is_empty]})
    dump("zones.geojson", {"type": "FeatureCollection", "features": zones})
    dump("origins.json", origins)
    dump("anchors.json", anchors)
    dump("crossings.json", crossings)
    dump("facilities.json", facilities)
    dump("shields.json", shield_points)

    hazard_sources = {
        "flood": {"id": "fema-nfhl", "name": "National Flood Hazard Layer", "publisher": "FEMA", "url": "https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS",
                  "role": "Floodway, 1% annual-chance (SFHA) and 0.2% annual-chance flood zones",
                  "limitations": "Regulatory flood zones, not a forecast. Water arrival timing is a scenario proxy from zone class and distance to the stream channel."},
        "coastal": {"id": "fema-nfhl", "name": "National Flood Hazard Layer", "publisher": "FEMA", "url": "https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS",
                    "role": "Coastal high-hazard (V), 1% (A/AE/AH) and 0.2% zones, split into surge, rainfall and canal sources by distance to the coastline and canals",
                    "limitations": "Regulatory zones, not a surge model. Source split and timing are scenario proxies."},
        "heat": {"id": "heat", "name": "Heat exposure proxy + NYC Heat Vulnerability Index", "publisher": "OpenStreetMap contributors; NYC DOHMH", "url": NYC_HVI,
                 "role": "Cell heat = 0.6 x lack of green/blue space within 300 m (OSM) + 0.4 x population density (ACS). HVI (1-5 by ZIP) scales the share of vulnerable residents without home cooling",
                 "limitations": "Not a measured temperature. HVI is joined to tracts by centroid."},
        "quake": {"id": "liquefaction", "name": "Earthquake liquefaction scenario: San Andreas (all northern segments)", "publisher": "USGS / ABAG (MTC open data)", "url": LIQ_LAYER,
                  "role": "Liquefaction hazard (High/Moderate) and shaking intensity (MMI) for the scenario rupture. Fire fuel = residential street density outside parks and water (OSM)",
                  "limitations": "Scenario hazard map, not a prediction. Road damage and fire ignition are seeded game events."},
    }
    meta = {
        "city": city_id, "hazard": hazard, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "bbox": [r5(minx), r5(miny), r5(maxx), r5(maxy)], "h3Res": H3_RES, "hazardBufferM": cfg.get("buffer_m", 0),
        "counts": {"tracts": len(zones), "population": int(tracts["pop"].sum()), "atRisk": int(sum(o["pop"] for o in origins)), "nodes": len(node_ids), "edges": n_edges, "floodedEdges": sum(1 for f in E["fcls"] if f), "floodCells": len(cells), "crossings": len(crossings), "shelterSites": len(facilities["shelters"]), "hospitals": len(facilities["hospitals"]), "busStops": len(bus)},
        "floodAreaKm2": {str(c): round(g.area / 1e6, 2) for g, c, _ in zone_polys},
        "sources": [
            {"id": "osm", "name": "OpenStreetMap", "publisher": "OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright", "retrieved": retrieved, "license": "ODbL",
             "role": "Drive network (OSMnx), parks and water" if nyc is not None else "Drive network (OSMnx), schools/community sites/libraries (shelter sites), hospitals, fire stations, bus stops, neighbourhood names",
             "limitations": "Completeness varies by feature. Speeds are imputed from road class where maxspeed is missing."},
            *([{"id": "nyc-open-data", "name": "NYC Open Data facility layers + NYS DOH health facilities", "publisher": "City of New York; New York State Department of Health", "url": "https://opendata.cityofnewyork.us/", "retrieved": retrieved,
                "role": "School, library and NYCHA community center locations (cooling center sites), FDNY firehouses, bus stop shelters, Neighborhood Tabulation Area names, hospitals",
                "limitations": "Bus stop shelters are a subset of all stops. Names come from NTA boundaries by tract centroid."}] if nyc is not None else []),
            {**hazard_sources[hazard], "retrieved": retrieved},
            {"id": "acs", "name": "American Community Survey 5-year estimates (tract)", "publisher": "U.S. Census Bureau, via Esri Living Atlas 'ACS Context for Emergency Response'", "url": f"{ACS_SERVICE}/2", "retrieved": retrieved, "vintage": acs_vintage(),
             "role": "Population, age 65+, households without a vehicle, poverty, disability, limited English, no internet access",
             "limitations": "Survey estimates with margins of error. Population is distributed along residential streets (dasymetric), so at-risk counts are modelled."},
        ],
    }
    dump("meta.json", meta)
    log(f"Done: {city_id}")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    for cid in (CITIES if which == "all" else [which]):
        build(cid)
