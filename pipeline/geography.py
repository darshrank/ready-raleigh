"""Study-area construction, centroid joins, and uniform block-group allocation."""
from collections import Counter

import geopandas as gpd
import h3
from shapely.geometry import Point, mapping

from .config import BUFFER_METERS, CACHE, COUNTIES, METRIC_CRS, PLACE, RESOLUTION
from .sources import VARIABLES, census_data, read_json, tiger_zip, write_json


def study_area(releases):
    path = CACHE / "study_area.geojson"
    if path.exists():
        print("  cached: study_area.geojson", flush=True)
        return gpd.read_file(path)
    places = gpd.read_file(tiger_zip(releases["tiger_year"], "place"))
    city = places.loc[places.PLACEFP == PLACE].to_crs(METRIC_CRS)
    if len(city) != 1 or city.iloc[0]["NAME"] != "Raleigh":
        raise ValueError("TIGER lookup did not uniquely identify Raleigh.")
    boundary = city.geometry.iloc[0]
    result = gpd.GeoDataFrame({"kind": ["city", "buffer"]},
                             geometry=[boundary, boundary.buffer(BUFFER_METERS)], crs=METRIC_CRS).to_crs(4326)
    write_json(path, result.__geo_interface__)
    return result


def block_groups(releases, area):
    path = CACHE / "block_groups.geojson"
    if path.exists():
        print("  cached: block_groups.geojson", flush=True)
        return gpd.read_file(path)
    frame = gpd.read_file(tiger_zip(releases["block_group_year"], "bg")).to_crs(4326)
    # Keep entire intersecting geometries, not clipped polygons: denominators must
    # include all cells in each source block group, including outside Raleigh.
    frame = frame.loc[frame.geometry.intersects(area.geometry.iloc[1])].copy()
    frame = frame[["GEOID", "COUNTYFP", "TRACTCE", "geometry"]].sort_values("GEOID")
    write_json(path, frame.__geo_interface__)
    return frame


def parse_counts(row):
    result = {}
    for field, variables in VARIABLES.items():
        values = [int(row[v]) for v in variables]
        if any(v < 0 for v in values):
            # Census negative sentinel values mean missing, never negative people.
            raise ValueError(f"Missing/suppressed Census estimate: {row.get('NAME')} {field}")
        result[field] = sum(values)
    return result


def split_counts(counts, full_cell_count):
    if full_cell_count <= 0:
        raise ValueError("A block group must have at least one cell to allocate counts.")
    return {key: round(value / full_cell_count, 6) for key, value in counts.items()}


def tract_name(code):
    whole, fraction = int(code[:4]), code[4:]
    return f"Census Tract {whole}" + (f".{fraction}" if fraction != "00" else "")


def allocate_cells(releases, area, groups):
    path = CACHE / "allocated_cells.json"
    if path.exists():
        print("  cached: allocated_cells.json", flush=True)
        cached = read_json(path)
        if all(c["acs_available"] for c in cached if c["geoid"][2:5] in COUNTIES):
            return cached
    ids = sorted(h3.geo_to_cells(mapping(area.geometry.iloc[1]), RESOLUTION))
    coordinates = [h3.cell_to_latlng(cell) for cell in ids]
    centers = gpd.GeoDataFrame({"h3": ids}, geometry=[Point(lon, lat) for lat, lon in coordinates], crs=4326)
    joined = gpd.sjoin(centers, groups, how="left", predicate="within")
    if len(joined) != len(ids) or joined.GEOID.isna().any():
        raise ValueError("Every study cell center must belong to exactly one TIGER block group.")
    estimates = census_data(releases["acs_year"])
    estimates = {row["state"] + row["county"] + row["tract"] + row["block group"]: row for row in estimates}
    denominators = {row.GEOID: len(h3.geo_to_cells(mapping(row.geometry), RESOLUTION)) for row in groups.itertuples()}
    allocated = []
    for i, row in enumerate(joined.itertuples()):
        available = row.COUNTYFP in COUNTIES
        if available and row.GEOID not in estimates:
            raise ValueError(f"Requested block group missing ACS estimates: {row.GEOID}")
        counts = parse_counts(estimates[row.GEOID]) if available else {field: 0 for field in VARIABLES}
        denominator = denominators[row.GEOID]
        if denominator <= 0:
            raise ValueError(f"Invalid H3 denominator for {row.GEOID}")
        fallback_name = tract_name(row.TRACTCE)
        if available:
            fallback_name = estimates[row.GEOID]["NAME"].split("; ")[1]
        allocated.append({"i": i, "h3": row.h3, "geoid": row.GEOID,
                          "tract": fallback_name, "acs_available": available,
                          **split_counts(counts, denominator)})
    # Validate the center join and H3 polygon fill agree on their denominator.
    inside_counts = Counter(row["geoid"] for row in allocated)
    if any(count > denominators[geoid] for geoid, count in inside_counts.items()):
        raise ValueError("Study cells exceed full block-group cells.")
    audit = []
    for geoid, inside_count in sorted(inside_counts.items()):
        available = geoid in estimates
        audit.append({"geoid": geoid, "full_cell_count": denominators[geoid],
                      "study_cell_count": inside_count, "acs_available": available,
                      "source_counts": parse_counts(estimates[geoid]) if available else None})
    write_json(CACHE / "allocation_audit.json", audit)
    write_json(path, allocated)
    return allocated
