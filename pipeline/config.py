from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "pipeline"
CACHE = PIPELINE / "cache"
OUT = PIPELINE / "out"
DATA = ROOT / "app" / "public" / "data"
METRIC_CRS = "EPSG:26917"  # NAD83 / UTM zone 17N, meters, appropriate for Raleigh.
RESOLUTION = 9
BUFFER_METERS = 1000
STATE = "37"
COUNTY = "183"
COUNTIES = ("183", "063")
PLACE = "55000"
MAX_FILE_BYTES = 5_000_000
