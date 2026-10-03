"""Run P2 in order: sources -> study area -> cells -> names -> export -> QA.

From repository root: pipeline/.venv/bin/python -m pipeline.build_all
Each stage reuses its completed output. See README.md for intentional invalidation.
"""
import json
import os
import platform
from datetime import datetime, timezone

import geopandas as gpd
import h3
from shapely.geometry import Point, Polygon

from .config import CACHE, DATA, MAX_FILE_BYTES, METRIC_CRS, OUT, RESOLUTION
from .geography import allocate_cells, block_groups, study_area
from .neighborhoods import fetch_places, name_cells
from .sources import census_data, discover_releases, read_json, verify_variables, write_json
from .validate import validate_cells


def plot_population(cells, area, report):
    path = OUT / "check_population.png"
    if path.exists():
        print("  cached: check_population.png", flush=True)
        return
    os.environ.setdefault("MPLCONFIGDIR", str(OUT / ".mplconfig"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import PowerNorm
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch

    polygons = [Polygon([(lon, lat) for lat, lon in h3.cell_to_boundary(c["h3"])]) for c in cells]
    available = [c["acs_available"] for c in read_json(CACHE / "allocated_cells.json")]
    frame = gpd.GeoDataFrame({"pop": [c["pop"] for c in cells], "available": available}, geometry=polygons, crs=4326).to_crs(METRIC_CRS)
    boundaries = area.to_crs(METRIC_CRS)
    fig, ax = plt.subplots(figsize=(10, 12), layout="constrained")
    frame.loc[frame.available].plot(column="pop", ax=ax, cmap="YlOrRd", norm=PowerNorm(gamma=.5), linewidth=0,
               legend=True, legend_kwds={"label": "Estimated residents per H3 cell (uniform within block group)", "shrink": .65})
    if (~frame.available).any():
        frame.loc[~frame.available].plot(ax=ax, color="#cbd1d8", linewidth=0)
    boundaries.iloc[[1]].boundary.plot(ax=ax, color="#3973ac", linewidth=.9, linestyle="--")
    boundaries.iloc[[0]].boundary.plot(ax=ax, color="#25354a", linewidth=.7)
    landmarks = gpd.GeoSeries([Point(-78.6382, 35.7796), Point(-78.671, 35.7847)], crs=4326).to_crs(METRIC_CRS)
    for name, point in zip(["Downtown Raleigh", "NC State"], landmarks):
        ax.plot(point.x, point.y, "o", color="#15334a", markersize=3)
        ax.annotate(name, (point.x, point.y), xytext=(5, -13), textcoords="offset points", fontsize=8,
                    bbox={"facecolor": "white", "edgecolor": "none", "alpha": .8})
    ax.legend(handles=[Line2D([0], [0], color="#25354a", label="Raleigh city boundary"),
                       Line2D([0], [0], color="#3973ac", linestyle="--", label="1 km buffer"),
                       Patch(facecolor="#cbd1d8", label="Demographics unavailable")], loc="upper left", fontsize=8)
    ax.annotate("N", xy=(.95, .96), xytext=(.95, .88), xycoords="axes fraction", ha="center",
                arrowprops={"arrowstyle": "->", "color": "#25354a"})
    minx, miny, maxx, maxy = boundaries.total_bounds
    x, y = minx + 1000, miny + 1000
    ax.plot([x, x + 5000], [y, y], color="#25354a", linewidth=3)
    ax.text(x + 2500, y + 350, "5 km", ha="center", fontsize=8)
    ax.set_title(f"Ready Raleigh | Population check\n{len(cells):,} H3 resolution 9 cells · {report['population_total']:,.0f} estimated residents", loc="left", fontsize=15)
    ax.set_axis_off()
    fig.text(.02, .004, f"ACS {report['acs_year']} 5-year · TIGER {report['tiger_year']} city / {report['acs_year']} block groups · NAD83 / UTM 17N\n"
             f"Wake and Durham estimates. {report['missing_demographic_cells']} cells have no ACS coverage (encoded as zero). Not a household-location map.", fontsize=8)
    fig.savefig(path, dpi=160, facecolor="white")
    plt.close(fig)


def sanity_report(cells, allocated, area, releases):
    points = gpd.GeoSeries([Point(*reversed(h3.cell_to_latlng(c["h3"]))) for c in cells], crs=4326)
    city_mask = points.within(area.geometry.iloc[0])
    city_estimate = int(census_data(releases["acs_year"], "place")[0]["B01003_001E"])
    report = {
        "cell_count": len(cells), "population_total": round(sum(c["pop"] for c in cells), 3),
        "population_city_only": round(sum(c["pop"] for c, inside in zip(cells, city_mask) if inside), 3),
        "acs_raleigh_place_population": city_estimate,
        "age_65_plus": round(sum(c["pop65"] for c in cells), 3),
        "below_poverty": round(sum(c["lowInc"] for c in cells), 3),
        "no_vehicle_households": round(sum(c["noCarHH"] for c in cells), 3),
        "missing_demographic_cells": sum(not c["acs_available"] for c in allocated),
        "block_groups_intersected": len({c["geoid"] for c in allocated}),
        "file_bytes": (DATA / "cells.json").stat().st_size,
        "tiger_year": releases["tiger_year"], "acs_year": releases["acs_year"],
        "city_area_km2": round(area.to_crs(METRIC_CRS).area.iloc[0] / 1e6, 3),
        "buffer_area_km2": round(area.to_crs(METRIC_CRS).area.iloc[1] / 1e6, 3),
    }
    if report["file_bytes"] >= MAX_FILE_BYTES:
        raise ValueError("cells.json exceeds the 5 MB file budget.")
    # Broad sanity bound, not a claim that area-weighted cells reproduce a place estimate.
    ratio = report["population_city_only"] / city_estimate
    if not .70 <= ratio <= 1.30:
        raise ValueError(f"Population allocation needs inspection: city/place ratio {ratio:.3f}.")
    report["city_to_acs_place_ratio"] = round(ratio, 4)
    report["note"] = "Fractional uniform block-group estimates; boundary vintages differ. Wake and Durham counties included."
    return report


def main():
    if tuple(map(int, platform.python_version_tuple()[:2])) != (3, 11):
        raise RuntimeError("Use the requested Python 3.11 virtual environment (pipeline/.venv).")
    for folder in (CACHE, DATA, OUT):
        folder.mkdir(parents=True, exist_ok=True)
    print("[1/6] Resolve releases and verify Census variables", flush=True)
    releases = discover_releases()
    labels = verify_variables(releases["acs_year"])
    print(f"  TIGER {releases['tiger_year']}; ACS {releases['acs_year']} 5-year", flush=True)
    print("[2/6] Raleigh boundary, 1 km metric buffer, matching block groups", flush=True)
    area = study_area(releases)
    groups = block_groups(releases, area)
    print("[3/6] H3 cells, centroid join, Census allocation", flush=True)
    allocated = allocate_cells(releases, area, groups)
    print("[4/6] Nearest OSM neighborhood/suburb names", flush=True)
    named_path = CACHE / "named_cells.json"
    if named_path.exists():
        named = read_json(named_path)
    else:
        payload = fetch_places(area)
        names, name_report = name_cells(allocated, payload)
        named = {"names": names, "report": name_report}
        write_json(named_path, named)
    print("[5/6] Export and validate Cell contract", flush=True)
    destination = DATA / "cells.json"
    previous = {c["h3"]: c for c in read_json(destination)} if destination.exists() else {}
    cells = [{"i": c["i"], "h3": c["h3"], "hood": named["names"][c["h3"]],
              **{key: c[key] for key in ("pop", "pop65", "lowInc", "noCarHH")},
              **{k: previous.get(c["h3"], {}).get(k, default) for k, default in
                 (("floodStep", None), ("cutOff", False), ("heatC", 0), ("treePct", 0))}} for c in allocated]
    validate_cells(cells)
    write_json(destination, cells)
    if [c["h3"] for c in cells] != [c["h3"] for c in allocated]:
        raise ValueError("cells.json and allocation cache disagree; invalidate derived outputs together.")
    print("[6/6] Population sanity report, provenance, and PNG", flush=True)
    report = sanity_report(cells, allocated, area, releases)
    write_json(OUT / "sanity_report.json", report)
    metadata = {
        "buildDate": datetime.now(timezone.utc).isoformat(), "task": "P2", "sources": {
            "city": f"https://www2.census.gov/geo/tiger/TIGER{releases['tiger_year']}/PLACE/tl_{releases['tiger_year']}_37_place.zip",
            "blockGroups": f"https://www2.census.gov/geo/tiger/TIGER{releases['acs_year']}/BG/tl_{releases['acs_year']}_37_bg.zip",
            "census": f"https://api.census.gov/data/{releases['acs_year']}/acs/acs5",
            "osm": "https://www.openstreetmap.org/copyright",
        }, "p2": {
            "releases": releases, "resolution": RESOLUTION, "bufferMeters": 1000, "metricCRS": METRIC_CRS,
            "verifiedVariables": labels, "names": named["report"], "sanity": report,
            "censusTransport": read_json(CACHE / "acs_transport.json") if (CACHE / "acs_transport.json").exists() else {"method": "Census API"},
            "allocation": "BG counts / all centroid-contained H3 cells in the complete BG; then retain study-area centers. Six decimal places.",
            "missingDemographicCells": [c["i"] for c in allocated if not c["acs_available"]],
            "limitations": ["Uniform spatial allocation is not observed household geography.",
                "Wake and Durham County ACS estimates are included; missing coverage is explicitly listed.",
                "Age, poverty and no-car measures overlap; noCarHH counts households, not people.",
                "Flood, hospital access, heat and canopy fields remain P2 placeholders.",
                "Nearest OSM place names are labels, not authoritative neighborhood boundaries.",
                "ACS margins of error are not modeled by the Cell contract."]}}
    old = read_json(DATA / "meta.json") if (DATA / "meta.json").exists() else {}
    if "p3" in old:
        metadata["p3"] = old["p3"]
        metadata["sources"].update(old["sources"])
        metadata["task"] = "P2+P3"
    write_json(DATA / "meta.json", metadata)
    plot_population(cells, area, report)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
