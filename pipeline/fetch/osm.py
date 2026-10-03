"""OpenStreetMap features + drive/walk graphs from a Geofabrik extract (DATA.md §2, amended).

DATA.md specified Overpass. On 2026-10-03 overpass-api.de was unusable (one host refused all
connections, the other returned 429/504; four public mirrors failed), so per decision we use
the Geofabrik North Carolina extract — the same OSM data as a dated daily snapshot — clipped to
the area with osmium and loaded with OSMnx from file. Network graphs use OSMnx's own Overpass
filters, applied locally with the same (unanchored regex) semantics.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import geopandas as gpd
import networkx as nx
import osmnx as ox
from osmnx import _overpass

from ..areas import Area
from ..cache import CACHE_DIR, FetchError, fetch
from ..sources import Source

# Pinned, dated extract (md5 verified). Bump deliberately to refresh OSM.
GEOFABRIK_DATE = "261002"
GEOFABRIK_URL = (
    f"https://download.geofabrik.de/north-america/us/north-carolina-{GEOFABRIK_DATE}.osm.pbf"
)
GEOFABRIK_MD5 = "9944c7955bbfe6912ce6e305f439adaf"
GEOFABRIK_TIMESTAMP = "2026-10-02T20:21:34Z"  # from north-carolina-updates/state.txt

LAYERS: dict[str, dict] = {
    "buildings": {"building": True},
    "amenities": {
        "amenity": ["school", "place_of_worship", "community_centre", "hospital", "fire_station"]
    },
    "waterways": {"waterway": ["river", "stream", "canal", "drain", "ditch"]},
    "culverts": {"tunnel": "culvert"},
    "trees": {"natural": ["tree", "tree_row", "wood"], "landuse": "forest"},
    "parking": {"amenity": "parking"},
}
KEEP_TAGS = [
    "name", "building", "building:levels", "height", "roof:material", "roof:colour",
    "roof:shape", "amenity", "waterway", "tunnel", "natural", "landuse", "parking", "layer",
]  # fmt: skip
# Way tags the network filters look at.
NETWORK_TAGS = [
    "access", "area", "highway", "service", "motor_vehicle", "motorcar", "foot",
    "sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right",
]  # fmt: skip


def source() -> Source:
    return Source(
        id="osm",
        dataset="OpenStreetMap (Geofabrik North Carolina extract)",
        url="https://www.openstreetmap.org/copyright",
        date=f"OSM snapshot {GEOFABRIK_TIMESTAMP}",
        license="ODbL 1.0 © OpenStreetMap contributors",
        method=f"Geofabrik {GEOFABRIK_URL} clipped to area bbox with osmium; loaded with OSMnx",
    )


def _osmium() -> str:
    exe = shutil.which("osmium")
    if not exe:
        raise FetchError("osmium not found — `brew install osmium-tool`")
    return exe


def area_extract(area: Area) -> Path:
    """Area-clipped OSM XML (complete ways), cached next to the state extract."""
    pbf = fetch("geofabrik", GEOFABRIK_URL, suffix=".osm.pbf", stream=True, timeout=1800)
    verified = pbf.path.with_suffix(".md5ok")  # verify the 429 MB file once, not every run
    if not verified.exists():
        digest = hashlib.md5()
        with pbf.path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 22), b""):
                digest.update(chunk)
        if digest.hexdigest() != GEOFABRIK_MD5:
            raise FetchError(f"Geofabrik md5 {digest.hexdigest()} != expected {GEOFABRIK_MD5}")
        verified.write_text(GEOFABRIK_MD5)
    out = CACHE_DIR / "geofabrik" / f"{area.id}_{GEOFABRIK_DATE}.osm"
    if not out.exists():
        bbox = ",".join(str(v) for v in area.bbox)
        subprocess.run(
            [_osmium(), "extract", "-b", bbox, "-s", "complete_ways", "--overwrite",
             "-o", str(out), str(pbf.path)],
            check=True,
        )  # fmt: skip
    return out


def fetch_features(area: Area) -> tuple[dict[str, gpd.GeoDataFrame], str]:
    xml = area_extract(area)
    out: dict[str, gpd.GeoDataFrame] = {}
    for name, tags in LAYERS.items():
        try:
            gdf = ox.features_from_xml(xml, tags=tags)
        except ox._errors.InsufficientResponseError:
            gdf = gpd.GeoDataFrame(geometry=[], crs=4326)
        if len(gdf):
            gdf = gdf.reset_index()
            cols = [c for c in KEEP_TAGS if c in gdf.columns]
            gdf["osm_id"] = gdf["element"].astype(str) + "/" + gdf["id"].astype(str)
            gdf = gdf[["osm_id", *cols, "geometry"]]
            gdf = gdf[gdf.intersects(_bbox_polygon(area))]
        out[name] = gdf
    return out, GEOFABRIK_TIMESTAMP


def _bbox_polygon(area: Area):
    from shapely.geometry import box

    return box(*area.bbox)


# --- network graphs -------------------------------------------------------------------------

_CLAUSE = re.compile(r'\["([^"]+)"(?:(!~|~|=|!=)"([^"]*)")?\]')


def parse_filter(flt: str) -> list[tuple[str, str | None, str | None]]:
    """OSMnx/Overpass filter string -> [(key, op, regex)]."""
    return [(k, op or None, v or None) for k, op, v in _CLAUSE.findall(flt)]


def way_passes(tags: dict[str, str], clauses: list[tuple[str, str | None, str | None]]) -> bool:
    """Overpass semantics: ["k"] requires k; ["k"!~"re"] passes if k absent or no re.search match."""
    for key, op, rx in clauses:
        val = tags.get(key)
        if op is None:
            if val is None:
                return False
        elif op == "!~":
            if val is not None and re.search(rx, val):
                return False
        elif op == "~":
            if val is None or not re.search(rx, val):
                return False
        elif op == "=":
            if val != rx:
                return False
        elif op == "!=" and val == rx:
            return False
    return True


def _filtered_xml(src: Path, dst: Path, clauses) -> None:
    tree = ET.parse(src)
    root = tree.getroot()
    keep_nodes: set[str] = set()
    for way in list(root.findall("way")):
        tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
        if way_passes(tags, clauses):
            keep_nodes.update(nd.get("ref") for nd in way.findall("nd"))
        else:
            root.remove(way)
    for rel in root.findall("relation"):
        root.remove(rel)
    for node in list(root.findall("node")):
        if node.get("id") not in keep_nodes:
            root.remove(node)
    tree.write(dst, encoding="utf-8", xml_declaration=True)


def fetch_graphs(area: Area, work: Path) -> str:
    xml = area_extract(area)
    hw = CACHE_DIR / "geofabrik" / f"{area.id}_{GEOFABRIK_DATE}_highways.osm"
    if not hw.exists():
        subprocess.run(
            [_osmium(), "tags-filter", "--overwrite", "-o", str(hw), str(xml), "w/highway"],
            check=True,
        )
    ox.settings.useful_tags_way = sorted(set(ox.settings.useful_tags_way) | set(NETWORK_TAGS))
    meta = {}
    for kind in ("drive", "walk"):
        clauses = parse_filter(_overpass._get_network_filter(kind))
        flt = work / f"highways_{kind}.osm"
        _filtered_xml(hw, flt, clauses)
        g: nx.MultiDiGraph = ox.graph_from_xml(
            flt, bidirectional=(kind == "walk"), simplify=False, retain_all=True
        )
        g = ox.truncate.truncate_graph_bbox(g, area.bbox, truncate_by_edge=True)
        # Keep bridges/tunnels as their own edges so their endpoints are the abutments.
        g = ox.simplify_graph(g, edge_attrs_differ=["bridge", "tunnel"])
        g = ox.truncate.largest_component(g, strongly=False)
        ox.save_graphml(g, work / f"graph_{kind}.graphml")
        flt.unlink()
        meta[kind] = {"nodes": g.number_of_nodes(), "edges": g.number_of_edges()}
    (work / "graphs.meta.json").write_text(json.dumps(meta, indent=2))
    return GEOFABRIK_TIMESTAMP
