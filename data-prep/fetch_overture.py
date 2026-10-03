"""Download Overture Maps (OpenStreetMap-derived) features for the study area.

Overture is read straight from its public S3 bucket with a bbox filter, so
only the row groups that touch Raleigh are transferred.

Usage: python data-prep/fetch_overture.py [--release 2026-09-23.1]
"""
import argparse
import sys
import time

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pfs
import pyarrow.parquet as pq

from common import BBOX, CACHE, OVERTURE_BUCKET, OVERTURE_REGION

LAYERS = {
    # name: (theme, type, columns)
    "segment": ("transportation", "segment",
                ["id", "geometry", "subtype", "class", "subclass", "names", "connectors",
                 "road_flags", "access_restrictions", "speed_limits"]),
    "building": ("buildings", "building",
                 ["id", "geometry", "subtype", "class", "height", "num_floors", "is_underground"]),
    "place": ("places", "place",
              ["id", "geometry", "names", "categories", "basic_category", "confidence", "addresses"]),
    "division": ("divisions", "division",
                 ["id", "geometry", "subtype", "class", "names", "population"]),
    "division_area": ("divisions", "division_area",
                      ["id", "geometry", "subtype", "class", "names", "division_id", "is_land"]),
    "land_use": ("base", "land_use", ["id", "geometry", "subtype", "class", "names"]),
    "water": ("base", "water",
              ["id", "geometry", "subtype", "class", "names", "is_intermittent"]),
}


def latest_release(fs):
    infos = fs.get_file_info(pfs.FileSelector(f"{OVERTURE_BUCKET}/release/", recursive=False))
    return sorted(i.path.rsplit("/", 1)[-1] for i in infos)[-1]


def fetch(fs, release, name):
    theme, typ, cols = LAYERS[name]
    path = f"{OVERTURE_BUCKET}/release/{release}/theme={theme}/type={typ}"
    dataset = ds.dataset(path, filesystem=fs, format="parquet")
    cols = [c for c in cols if c in dataset.schema.names] + ["bbox"]
    xmin, ymin, xmax, ymax = BBOX
    flt = ((pc.field("bbox", "xmin") < xmax) & (pc.field("bbox", "xmax") > xmin) &
           (pc.field("bbox", "ymin") < ymax) & (pc.field("bbox", "ymax") > ymin))
    t0 = time.time()
    table = dataset.to_table(columns=cols, filter=flt)
    out = CACHE / f"overture_{name}.parquet"
    pq.write_table(table, out)
    print(f"{name}: {table.num_rows} rows in {time.time() - t0:.0f}s -> {out.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release")
    ap.add_argument("layers", nargs="*", default=list(LAYERS))
    args = ap.parse_args()
    fs = pfs.S3FileSystem(anonymous=True, region=OVERTURE_REGION)
    release = args.release or latest_release(fs)
    print("Overture release", release)
    (CACHE / "overture_release.txt").write_text(release)
    for name in args.layers:
        fetch(fs, release, name)


if __name__ == "__main__":
    sys.exit(main())
