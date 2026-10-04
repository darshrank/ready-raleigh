"""The map's detail data (semantic zoom), rebuilt from the cache with no downloads.

pipeline.build_all calls refresh_detail() last: its P2 step rewrites meta.json, which would drop
the detail blocks, so they are written again here from the cached GoRaleigh feed and Overpass
answers. A missing cache stops the rebuild with the command that fills it (never a silent gap).
"""
from .bus_stops import build as build_bus_stops
from .config import CACHE, DATA
from .site_buildings import build as build_site_buildings


def refresh_detail(data_dir=DATA, cache_dir=CACHE):
    print("[detail] Bus stops and site buildings from the cache", flush=True)
    build_bus_stops(data_dir, cache_dir, offline=True)
    build_site_buildings(data_dir, cache_dir, offline=True)
