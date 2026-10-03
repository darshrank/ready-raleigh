"""USGS 3DEP DEM via the 3DEPElevation ImageServer `exportImage` REST endpoint (DATA.md §2).

py3dep's WMS endpoint returned ServiceUnavailable on 2026-10-03; the REST exportImage endpoint
serves the same 3DEP mosaic. At 3 m this area is sourced from the NC statewide 2003 lidar
(catalog item ned19_n36x00_w078x75_nc_statewide_2003); no 1 m 3DEP exists here.
"""

from __future__ import annotations

import numpy as np
import rasterio
from pyproj import Transformer

from ..areas import Area
from ..cache import fetch
from ..sources import Source

URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
RES_M = 3.0
BUFFER_M = 1500.0  # hydrology needs terrain beyond the play area
UTM = 32617


def grid(area: Area) -> tuple[float, float, float, float, int, int]:
    """Buffered UTM bbox snapped to the 3 m grid -> (xmin, ymin, xmax, ymax, width, height)."""
    tr = Transformer.from_crs(4326, UTM, always_xy=True)
    lon0, lat0, lon1, lat1 = area.bbox
    xs, ys = tr.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
    xmin = np.floor((min(xs) - BUFFER_M) / RES_M) * RES_M
    ymin = np.floor((min(ys) - BUFFER_M) / RES_M) * RES_M
    xmax = np.ceil((max(xs) + BUFFER_M) / RES_M) * RES_M
    ymax = np.ceil((max(ys) + BUFFER_M) / RES_M) * RES_M
    return xmin, ymin, xmax, ymax, int((xmax - xmin) / RES_M), int((ymax - ymin) / RES_M)


def source(fetched_at: str) -> Source:
    return Source(
        id="dem",
        dataset="USGS 3DEP DEM (NC statewide 2003 lidar, 1/9 arc-second) resampled to 3 m",
        url="https://www.usgs.gov/3d-elevation-program",
        date=f"lidar 2003; fetched {fetched_at}",
        license="Public domain (USGS)",
        method="3DEPElevation ImageServer exportImage, bilinear, EPSG:32617, 3 m",
    )


TILE_PX = 1000  # the service returns HTTP 500 for single exports this large; tile them


def _tile(x0: float, y0: float, x1: float, y1: float, w: int, h: int):
    res = fetch(
        "dem",
        URL,
        params={
            "bbox": f"{x0},{y0},{x1},{y1}",
            "bboxSR": UTM,
            "imageSR": UTM,
            "size": f"{w},{h}",
            "format": "tiff",
            "pixelType": "F32",
            "interpolation": "RSP_BilinearInterpolation",
            "f": "image",
        },
        suffix=".tif",
        timeout=600,
        retries=5,
    )
    with rasterio.open(res.path) as src:
        arr = src.read(1).astype("float32")
        nodata = src.nodata
    if (arr.shape[1], arr.shape[0]) != (w, h):
        raise ValueError(f"DEM tile size {arr.shape} != requested {(h, w)}")
    bad = (arr < -100) | (arr == nodata) if nodata is not None else arr < -100
    return np.where(bad, np.nan, arr), res.fetched_at


def fetch_dem(area: Area, out_path) -> str:
    xmin, ymin, xmax, ymax, w, h = grid(area)
    full = np.full((h, w), np.nan, dtype="float32")
    fetched = ""
    for row in range(0, h, TILE_PX):
        for col in range(0, w, TILE_PX):
            tw, th = min(TILE_PX, w - col), min(TILE_PX, h - row)
            x0 = xmin + col * RES_M
            y1 = ymax - row * RES_M
            arr, t = _tile(x0, y1 - th * RES_M, x0 + tw * RES_M, y1, tw, th)
            full[row : row + th, col : col + tw] = arr
            fetched = max(fetched, t)
    if np.isnan(full).mean() > 0.01:
        raise ValueError(f"DEM has {np.isnan(full).mean():.1%} nodata")
    profile = dict(
        driver="GTiff", dtype="float32", nodata=np.nan, crs=f"EPSG:{UTM}",
        transform=rasterio.transform.from_origin(xmin, ymax, RES_M, RES_M),
        width=w, height=h, count=1, compress="deflate", tiled=True,
    )  # fmt: skip
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(full, 1)
    return fetched
