"""Download the USGS 3DEP 1/3 arc-second (~10 m) DEM for the study area.

Reads only the needed window of the 1x1 degree Cloud-Optimized GeoTIFF from
the USGS National Map S3 bucket.
"""
import os

import rasterio
from rasterio.windows import from_bounds

from common import BBOX, CACHE

TILE = "n36w079"  # covers 35-36N, 78-79W, which contains the whole study area
URL = f"/vsicurl/https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/{TILE}/USGS_13_{TILE}.tif"


def main():
    if os.path.exists("/root/.ccr/ca-bundle.crt"):
        os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
    out = CACHE / "dem_3dep_13.tif"
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MULTIRANGE="YES"):
        with rasterio.open(URL) as src:
            win = from_bounds(*BBOX, transform=src.transform).round_offsets().round_lengths()
            data = src.read(1, window=win)
            profile = src.profile.copy()
            profile.update(width=data.shape[1], height=data.shape[0],
                           transform=src.window_transform(win), blockxsize=256, blockysize=256)
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(data, 1)
    print(f"DEM {data.shape} min {data[data > -1000].min():.1f} max {data.max():.1f} m -> {out.name}")


if __name__ == "__main__":
    main()
