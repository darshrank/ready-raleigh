"""Names from actual OSM place features; Census tract names are the fallback."""
import geopandas as gpd
from shapely.geometry import Point

from .config import CACHE, METRIC_CRS
from .sources import cached_json

ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def fetch_places(area):
    # Convert the expanded geometry back to geographic coordinates for Overpass.
    expanded = gpd.GeoSeries([area.to_crs(METRIC_CRS).geometry.iloc[1].buffer(10_000)], crs=METRIC_CRS).to_crs(4326)
    west, south, east, north = expanded.total_bounds
    query = f'[out:json][timeout:90];nwr["place"~"^(neighbourhood|suburb)$"]["name"]({south},{west},{north},{east});out center tags;'
    path = CACHE / "osm_places.json"
    errors = []
    for endpoint in ENDPOINTS:
        try:
            payload = cached_json(path, endpoint, {"data": query})
            if "elements" not in payload:
                raise ValueError("Overpass response has no elements array.")
            return payload
        except (RuntimeError, ValueError) as exc:
            errors.append(str(exc))
    raise RuntimeError("OSM neighborhood download failed at both endpoints. " + "; ".join(errors))


def name_cells(cells, payload):
    records = []
    for element in payload["elements"]:
        tags = element.get("tags", {})
        name = tags.get("name", "").strip()
        center = element.get("center", element)
        if name and tags.get("place") in {"neighbourhood", "suburb"} and "lat" in center and "lon" in center:
            records.append({"name": name, "osm_id": f"{element['type']}/{element['id']}",
                            "geometry": Point(center["lon"], center["lat"])})
    if not records:
        return {c["h3"]: c["tract"] for c in cells}, {"place_count": 0, "fallback_cells": len(cells)}
    import h3
    places = gpd.GeoDataFrame(records, crs=4326).to_crs(METRIC_CRS)
    points = [Point(*reversed(h3.cell_to_latlng(c["h3"]))) for c in cells]
    centers = gpd.GeoDataFrame({"h3": [c["h3"] for c in cells]}, geometry=points, crs=4326).to_crs(METRIC_CRS)
    nearest = gpd.sjoin_nearest(centers, places, how="left", distance_col="distance_m")
    # Stable tie-breaking when OSM node and polygon features share a center.
    nearest = nearest.sort_values(["h3", "distance_m", "osm_id"]).drop_duplicates("h3")
    names = dict(zip(nearest.h3, nearest["name"]))
    return names, {"place_count": len(records), "fallback_cells": 0,
                   "max_nearest_distance_m": round(float(nearest.distance_m.max())),
                   "note": "Nearest named place in a 10 km expanded search area; not official neighborhood boundaries."}
