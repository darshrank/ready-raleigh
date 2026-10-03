"""Download FEMA National Flood Hazard Layer flood zones for the study area.

Keeps the 1%-annual-chance floodplain (Special Flood Hazard Area: zones A,
AE, AH, AO...) and the 0.2%-annual-chance (500-year) shaded zone X.
Output: data-prep/cache/fema_nfhl.geojson with properties zone, sfha (bool),
kind ('100yr' | '500yr' | 'floodway').
"""
import json
import time

import requests

from common import BBOX, CACHE

URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
WHERE = "SFHA_TF='T' OR ZONE_SUBTY LIKE '%0.2 PCT%'"


def query(offset):
    xmin, ymin, xmax, ymax = BBOX
    params = {
        "where": WHERE,
        "geometry": json.dumps({"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF", "outSR": 4326, "returnGeometry": "true",
        "maxAllowableOffset": 0.00003,  # ~3 m generalisation
        "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": 1000, "f": "geojson",
    }
    for attempt in range(4):
        try:
            r = requests.get(URL, params=params, timeout=180)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def main():
    features, offset = [], 0
    while True:
        page = query(offset)
        fs = page.get("features", [])
        for f in fs:
            p = f["properties"]
            sub = (p.get("ZONE_SUBTY") or "").upper()
            kind = "floodway" if "FLOODWAY" in sub else ("100yr" if p.get("SFHA_TF") == "T" else "500yr")
            f["properties"] = {"zone": p.get("FLD_ZONE"), "sfha": p.get("SFHA_TF") == "T", "kind": kind}
            features.append(f)
        print(f"  {offset + len(fs)} polygons")
        if len(fs) < 1000:
            break
        offset += 1000
    out = CACHE / "fema_nfhl.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    kinds = {}
    for f in features:
        kinds[f["properties"]["kind"]] = kinds.get(f["properties"]["kind"], 0) + 1
    print(f"{len(features)} flood zone polygons {kinds} -> {out.name}")


if __name__ == "__main__":
    main()
