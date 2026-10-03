"""Fetch census tracts + ACS 5-year vulnerability data for Raleigh's counties.

Needs network access to api.census.gov and tigerweb.geo.census.gov (both are
blocked in some sandboxes; run this on a laptop if so). A CENSUS_API_KEY env
var is optional for this request volume.

Output: data-prep/cache/census_tracts.geojson with, per tract:
  pop      total population (B01003)
  elderly  share aged 65+ (B01001)
  poverty  share below the poverty line (B17001)
  nocar    share of households with no vehicle (B08201)
  hhsize   average household size (B25010)
build.py then distributes each tract's population over its residential
buildings (dasymetric mapping) instead of using the citywide fallback.
"""
import json
import os
import sys

import requests

from common import CACHE

YEAR = 2023
STATE = "37"            # North Carolina
COUNTIES = ["183", "063"]  # Wake, Durham (Raleigh reaches into Durham County)

AGE65 = [f"B01001_{i:03d}E" for i in list(range(20, 26)) + list(range(44, 50))]
VARS = ["B01003_001E", "B17001_001E", "B17001_002E", "B08201_001E", "B08201_002E", "B25010_001E"] + AGE65

TIGERWEB = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query")


def acs(county):
    params = {"get": ",".join(["NAME"] + VARS), "for": "tract:*", "in": f"state:{STATE} county:{county}"}
    if os.environ.get("CENSUS_API_KEY"):
        params["key"] = os.environ["CENSUS_API_KEY"]
    r = requests.get(f"https://api.census.gov/data/{YEAR}/acs/acs5", params=params, timeout=60)
    r.raise_for_status()
    rows = r.json()
    head = rows[0]
    out = {}
    for row in rows[1:]:
        d = dict(zip(head, row))
        geoid = d["state"] + d["county"] + d["tract"]

        def num(k):
            v = float(d[k] or 0)
            return 0.0 if v < 0 else v  # ACS uses large negatives for "not available"

        pop = num("B01003_001E")
        pov_univ = num("B17001_001E")
        hh = num("B08201_001E")
        out[geoid] = {
            "pop": pop,
            "elderly": sum(num(k) for k in AGE65) / pop if pop else 0.0,
            "poverty": num("B17001_002E") / pov_univ if pov_univ else 0.0,
            "nocar": num("B08201_002E") / hh if hh else 0.0,
            "hhsize": num("B25010_001E") or 2.4,
        }
    return out


def tracts(county):
    params = {"where": f"STATE='{STATE}' AND COUNTY='{county}'", "outFields": "GEOID", "outSR": "4326",
              "f": "geojson", "returnGeometry": "true"}
    r = requests.get(TIGERWEB, params=params, timeout=120)
    r.raise_for_status()
    return r.json()["features"]


def main():
    features = []
    for county in COUNTIES:
        stats = acs(county)
        for f in tracts(county):
            geoid = f["properties"]["GEOID"]
            if geoid not in stats:
                continue
            features.append({"type": "Feature", "geometry": f["geometry"],
                             "properties": {"GEOID": geoid, **stats[geoid]}})
        print(f"county {county}: {len(stats)} tracts")
    if not features:
        sys.exit("no tracts fetched")
    out = CACHE / "census_tracts.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"{len(features)} tracts -> {out.name} (ACS {YEAR} 5-year)")


if __name__ == "__main__":
    main()
