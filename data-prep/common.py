"""Shared settings for the offline data-prep pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data-prep" / "cache"
OUT = ROOT / "public" / "data" / "raleigh"
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

# Study area: City of Raleigh plus a buffer so hydrology and routing don't
# stop dead at the city limit.
BBOX = (-78.86, 35.68, -78.45, 36.00)  # xmin, ymin, xmax, ymax (WGS84)

OVERTURE_BUCKET = "overturemaps-us-west-2"
OVERTURE_REGION = "us-west-2"

# H3 resolution for the analysis grid (res 9 cell ~0.105 km^2, edge ~174 m).
H3_RES = 9
