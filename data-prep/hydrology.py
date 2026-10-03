"""Flood hazard model: Height Above Nearest Drainage (HAND).

HAND is the vertical distance from each cell down to the stream cell it
drains into, following D8 flow directions on the hydrologically conditioned
USGS 3DEP DEM. A cell with HAND = 2 m is inundated once the nearby channel
rises 2 m above its normal level, so raising a single water level reproduces
the flood spreading outward from Crabtree Creek, Walnut Creek, the Neuse and
their tributaries. (HAND is the basis of NOAA's National Water Model
inundation mapping.)

Outputs (cache): hand_utm.tif (HAND in metres, EPSG:32617, 10 m),
                 streams_utm.tif (channel mask).
"""
import numpy as np
import rasterio
from pysheds.grid import Grid
from rasterio.warp import Resampling, calculate_default_transform, reproject

from common import CACHE

CELL = 10.0  # metres
# Channels start where the upstream drainage area reaches this size. ~1 km^2
# matches the creeks NC floodplain mapping studies in Wake County.
STREAM_AREA_KM2 = 1.0
UTM = "EPSG:32617"


def to_utm():
    src_path = CACHE / "dem_3dep_13.tif"
    dst_path = CACHE / "dem_utm.tif"
    with rasterio.open(src_path) as src:
        transform, w, h = calculate_default_transform(src.crs, UTM, src.width, src.height,
                                                      *src.bounds, resolution=CELL)
        prof = src.profile.copy()
        prof.update(crs=UTM, transform=transform, width=w, height=h, nodata=-9999.0)
        with rasterio.open(dst_path, "w", **prof) as dst:
            reproject(rasterio.band(src, 1), rasterio.band(dst, 1), resampling=Resampling.bilinear,
                      dst_nodata=-9999.0)
    return dst_path


def main():
    dem_path = to_utm()
    grid = Grid.from_raster(str(dem_path))
    dem = grid.read_raster(str(dem_path))
    print("DEM", dem.shape)
    pit_filled = grid.fill_pits(dem)
    flooded = grid.fill_depressions(pit_filled)
    inflated = grid.resolve_flats(flooded)
    fdir = grid.flowdir(inflated)
    acc = grid.accumulation(fdir)
    thresh = STREAM_AREA_KM2 * 1e6 / (CELL * CELL)
    streams = acc > thresh
    print("stream cells", int(streams.sum()))
    hand = grid.compute_hand(fdir, inflated, streams)
    hand = np.asarray(hand, dtype="float32")
    hand[~np.isfinite(hand)] = -9999.0
    raw = np.asarray(dem, dtype="float32")
    # Depression filling lifts closed basins; measure HAND from the raw DEM so
    # ponds and sinks keep their true depth relative to the drainage they spill to.
    filled = np.asarray(inflated, dtype="float32")
    hand[raw <= -9000] = -9999.0
    ok = hand > -9999
    hand[ok] = np.maximum(0.0, hand[ok] - (filled[ok] - raw[ok]))
    with rasterio.open(dem_path) as src:
        prof = src.profile.copy()
    prof.update(dtype="float32", nodata=-9999.0, compress="deflate")
    with rasterio.open(CACHE / "hand_utm.tif", "w", **prof) as dst:
        dst.write(hand, 1)
    prof.update(dtype="uint8", nodata=0)
    with rasterio.open(CACHE / "streams_utm.tif", "w", **prof) as dst:
        dst.write(np.asarray(streams, dtype="uint8"), 1)
    v = hand[ok]
    for t in (1, 2, 3, 4, 6):
        print(f"share of area with HAND <= {t} m: {np.mean(v <= t):.3f}")


if __name__ == "__main__":
    main()
