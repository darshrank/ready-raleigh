"""Cached official NFHL and OSM downloads for P3; no synthetic fallbacks."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import os
import requests

import geopandas as gpd
import osmnx as ox
from shapely import make_valid
from shapely.geometry import box

from .config import CACHE, METRIC_CRS
from .sources import cached_json, read_json, write_json

NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28'


def configure_osm():
    ox.settings.cache_folder = str(CACHE / 'osmnx')
    ox.settings.use_cache = True
    ox.settings.requests_timeout = 180
    ox.settings.http_user_agent = "ReadyRaleigh-WolfHacks/1.0 (educational flood accessibility analysis; OpenStreetMap data attribution)"
    ox.settings.log_console = False
    ox.settings.overpass_url = os.environ.get("OSM_OVERPASS_URL", "https://overpass-api.de/api")
    ox.settings.overpass_rate_limit = False
    ox.settings.max_query_area_size = 1_000_000_000


def routing_area(area):
    return gpd.GeoSeries([area.geometry.iloc[1]], crs=4326).to_crs(METRIC_CRS).buffer(5000).to_crs(4326).iloc[0]


def download_roads(polygon):
    configure_osm()
    path = CACHE / 'drive.graphml'
    if path.exists():
        return ox.load_graphml(path)
    graph = ox.graph_from_polygon(polygon, network_type='drive', simplify=True, retain_all=True, truncate_by_edge=True)
    # OSM posted speeds take precedence. These are km/h fallbacks by road class.
    graph = ox.routing.add_edge_speeds(graph, hwy_speeds={
        'motorway': 105, 'motorway_link': 55, 'trunk': 90, 'trunk_link': 50,
        'primary': 65, 'primary_link': 40, 'secondary': 55, 'secondary_link': 35,
        'tertiary': 45, 'tertiary_link': 30, 'residential': 40, 'unclassified': 40,
        'living_street': 15, 'service': 25}, fallback=40)
    graph = ox.routing.add_edge_travel_times(graph)
    ox.save_graphml(graph, path)
    return graph


def download_amenities(polygon):
    configure_osm()
    path = CACHE / 'amenities.geojson'
    if path.exists():
        return gpd.read_file(path)
    tags = {'amenity': ['hospital', 'school', 'community_centre', 'library', 'place_of_worship']}
    # OSMnx writes each Overpass response to its cache before constructing the
    # GeoDataFrame. If a previous request was interrupted after the responses
    # arrived, recover those complete responses instead of querying again.
    cached_responses = []
    for candidate in (CACHE / 'osmnx').glob('*.json'):
        try:
            payload = read_json(candidate)
        except (OSError, ValueError):
            continue
        if isinstance(payload, dict) and any('amenity' in e.get('tags', {}) for e in payload.get('elements', [])):
            cached_responses.append(payload)
    if cached_responses:
        frame = ox.features._create_gdf(cached_responses, polygon, tags)
    else:
        frame = None
    try:
        if frame is None:
            frame = ox.features_from_polygon(polygon, tags)
    except requests.RequestException:
        print('Primary Overpass unavailable; retrying the public Kumi mirror.', flush=True)
        ox.settings.overpass_url = 'https://overpass.kumi.systems/api'
        frame = ox.features_from_polygon(polygon, tags)
    frame = frame.reset_index()
    keep = [c for c in ['element', 'id', 'amenity', 'name', 'geometry'] if c in frame]
    frame = frame[keep].copy()
    frame.to_file(path, driver='GeoJSON')
    return frame


def download_flood(polygon):
    """ID-first pagination checks completeness; query Wake/Durham FIRMs intersecting routing bounds."""
    path = CACHE / 'nfhl.geojson'
    if path.exists():
        return gpd.read_file(path)
    schema = cached_json(CACHE / 'nfhl_schema.json', NFHL, {'f': 'json'})
    assert {'FLD_ZONE', 'ZONE_SUBTY', 'DFIRM_ID'} <= {f['name'] for f in schema['fields']}
    params = {'f': 'json', 'where': "(DFIRM_ID LIKE '37183%' OR DFIRM_ID LIKE '37063%') AND (SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2 PCT%')",
              'geometry': ','.join(map(str, polygon.bounds)), 'geometryType': 'esriGeometryEnvelope',
              'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true'}
    ids = sorted(cached_json(CACHE / 'nfhl_ids.json', NFHL + '/query', params)['objectIds'])
    if not ids:
        raise ValueError('FEMA returned no Wake/Durham hazard features.')
    def page(chunk):
        return cached_json(CACHE / f'nfhl_page_{chunk[0]}.json', NFHL + '/query', {
            'f': 'geojson', 'objectIds': ','.join(map(str, chunk)), 'outFields': 'OBJECTID,DFIRM_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF',
            'returnGeometry': 'true', 'outSR': 4326, 'geometryPrecision': 7})
    chunks = [ids[i:i+100] for i in range(0, len(ids), 100)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        pages = list(pool.map(page, chunks))
    features = [f for p in pages for f in p['features']]
    actual = [f['properties']['OBJECTID'] for f in features]
    if len(actual) != len(set(actual)) or set(actual) != set(ids):
        raise ValueError('FEMA pagination missing or duplicated feature IDs.')
    write_json(path, {'type': 'FeatureCollection', 'features': features})
    write_json(CACHE / 'p3_source_dates.json', {'retrievedAt': datetime.now(timezone.utc).isoformat(), 'femaFeatures': len(ids)})
    return gpd.read_file(path)


def main():
    area = gpd.read_file(CACHE / 'study_area.geojson')
    polygon = routing_area(area)
    # OSMnx settings are shared; fetch graph and POIs sequentially.
    print('Downloading FEMA polygons', flush=True)
    flood = download_flood(polygon)
    print(f'FEMA: {len(flood)} features', flush=True)
    print('Downloading simplified OSM drive graph', flush=True)
    graph = download_roads(polygon)
    print(f'OSM: {len(graph)} nodes, {graph.number_of_edges()} edges', flush=True)
    amenities = download_amenities(polygon)
    print(f'OSM: {len(amenities)} amenities', flush=True)


if __name__ == '__main__':
    main()
