"""Fetch census tracts + ACS 5-year vulnerability data for Raleigh's counties.

ACS tables come from the Census Bureau's table-based summary files on
www2.census.gov (no API key needed; national files are streamed and filtered
to Wake and Durham counties). Tract polygons come from TIGERweb.

Output: data-prep/cache/census_tracts.geojson with, per tract:
  pop      total population                       (B01003)
  elderly  share aged 65+                         (B01001)
  poverty  share below the poverty line           (C17002: income/poverty ratio < 1)
  nocar    share of households with no vehicle    (B25044)
  hhsize   average household size                 (B25010)
build.py then distributes each tract's population over its residential
buildings (dasymetric mapping) instead of using the citywide fallback.
"""
import json
import sys

import requests

from common import CACHE

YEAR = 2023
STATE = "37"               # North Carolina
COUNTIES = ["183", "063"]  # Wake, Durham (Raleigh reaches into Durham County)

SF = f"https://www2.census.gov/programs-surveys/acs/summary_file/{YEAR}/table-based-SF/data/5YRData/acsdt5y{YEAR}-{{}}.dat"
TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query"

TABLES = {
    "b01003": ["B01003_E001"],
    "b01001": ["B01001_E001"] + [f"B01001_E{i:03d}" for i in list(range(20, 26)) + list(range(44, 50))],
    "c17002": ["C17002_E001", "C17002_E002", "C17002_E003"],
    "b25044": ["B25044_E001", "B25044_E003", "B25044_E010"],
    "b25010": ["B25010_E001"],
}


def summary_table(table, cols):
    """Stream one national summary file, keep this study area's tracts."""
    prefixes = tuple(f"1400000US{STATE}{c}" for c in COUNTIES)
    out = {}
    with requests.get(SF.format(table), stream=True, timeout=300) as r:
        r.raise_for_status()
        r.encoding = "utf-8"
        lines = (l.decode("utf-8") if isinstance(l, bytes) else l for l in r.iter_lines(chunk_size=1 << 20))
        head = next(lines).split("|")
        idx = [head.index(c) for c in cols]
        for line in lines:
            if not line.startswith(prefixes):
                continue
            parts = line.split("|")
            geoid = parts[0][len("1400000US"):]
            out[geoid] = [float(parts[i]) if parts[i] not in ("", ".", "null") else 0.0 for i in idx]
    print(f"  {table}: {len(out)} tracts")
    return out


def acs():
    t = {name: summary_table(name, cols) for name, cols in TABLES.items()}
    stats = {}
    for geoid, (pop,) in t["b01003"].items():
        age = t["b01001"].get(geoid)
        pov = t["c17002"].get(geoid)
        veh = t["b25044"].get(geoid)
        hh = t["b25010"].get(geoid)
        stats[geoid] = {
            "pop": pop,
            "elderly": sum(age[1:]) / age[0] if age and age[0] else 0.0,
            "poverty": (pov[1] + pov[2]) / pov[0] if pov and pov[0] else 0.0,
            "nocar": (veh[1] + veh[2]) / veh[0] if veh and veh[0] else 0.0,
            "hhsize": hh[0] if hh and hh[0] > 0 else 2.4,
        }
    return stats


def tracts(county):
    params = {"where": f"STATE='{STATE}' AND COUNTY='{county}'", "outFields": "GEOID", "outSR": "4326",
              "f": "geojson", "returnGeometry": "true"}
    r = requests.get(TIGERWEB, params=params, timeout=120)
    r.raise_for_status()
    return r.json()["features"]


def main():
    print(f"ACS {YEAR} 5-year summary files")
    stats = acs()
    features = []
    for county in COUNTIES:
        fs = tracts(county)
        for f in fs:
            geoid = f["properties"]["GEOID"]
            if geoid in stats:
                features.append({"type": "Feature", "geometry": f["geometry"],
                                 "properties": {"GEOID": geoid, **stats[geoid]}})
        print(f"county {county}: {len(fs)} tract polygons")
    if not features:
        sys.exit("no tracts fetched")
    out = CACHE / "census_tracts.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"{len(features)} tracts -> {out.name}")


if __name__ == "__main__":
    main()
