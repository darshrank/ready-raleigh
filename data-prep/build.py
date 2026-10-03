"""Turn cached raw data into the small files the game loads.

Inputs (data-prep/cache, produced by fetch_overture.py, fetch_dem.py,
hydrology.py and optionally fetch_census.py).
Outputs (public/data/raleigh):
  meta.json        study area, sources, totals
  boundary.json    City of Raleigh limit (GeoJSON)
  hexes.json       H3 res-9 analysis grid with population, vulnerability and
                   flood exposure (population by HAND bin)
  graph.json       routable road network with flood-closure heights
  roads.json       flood-prone road stretches the player can protect
  facilities.json  schools, community centres, places of worship, hospitals...
  hand.png         HAND raster (Web Mercator) the browser animates as water
"""
import json
import math
import re
import time
from collections import defaultdict

import h3
import numpy as np
import pyarrow.parquet as pq
import shapely
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import Resampling, reproject
from scipy.ndimage import minimum_filter
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from shapely import wkb
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import substring, transform, unary_union
from shapely.strtree import STRtree

from common import BBOX, CACHE, H3_RES, OUT

T0 = time.time()
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32617", always_xy=True)
to_ll = Transformer.from_crs("EPSG:32617", "EPSG:4326", always_xy=True)

# 2020 Decennial Census count for the City of Raleigh (P1_001N, place 3755000).
# Used as the control total for building-based (dasymetric) population when
# tract-level census data has not been fetched. With census data, each tract's
# own count is used instead.
RALEIGH_2020_POP = 467665

HAND_BIN = 0.25   # metres; exposure is stored per bin of height above drainage
HAND_MAX = 10.0   # metres; buildings higher than this are never at risk
ROAD_GROUP_MAX_HAND = 5.0  # roads below this can be offered for protection

ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
                "residential", "living_street"]
GROUP_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified"}
SERVICE_EXCLUDE = {"driveway", "parking_aisle", "drive_through"}
NO_WALK = {"motorway", "trunk"}
FLOOD_IMMUNE = {"motorway", "trunk"}
BRIDGE_PAD_M = 30.0

NONRES_SUBTYPES = {"outbuilding", "commercial", "education", "agricultural", "civic", "religious",
                   "transportation", "entertainment", "industrial", "medical", "service", "military"}
NONRES_CLASSES = {"shed", "garage", "garages", "carport", "roof", "greenhouse", "commercial", "retail",
                  "office", "school", "parking", "university", "shelter", "industrial", "church",
                  "warehouse", "grandstand", "service", "public", "library", "hangar", "barn",
                  "hospital", "college", "kindergarten", "civic", "government", "hotel",
                  "supermarket", "fire_station", "train_station", "transportation", "stadium",
                  "sports_hall", "storage_tank", "toilets", "chapel", "mosque", "temple",
                  "synagogue", "farm_auxiliary", "kiosk"}
RES_CLASSES = {"house", "detached", "residential", "apartments", "terrace", "semidetached_house",
               "static_caravan", "dormitory", "bungalow", "cabin", "duplex"}
NONRES_LANDUSE = {"retail", "commercial", "industrial", "school", "university", "college",
                  "religious", "cemetery", "golf_course", "park", "pitch", "construction",
                  "military", "railway", "landfill", "quarry", "nature_reserve", "hospital",
                  "parking", "garages", "stadium", "track", "recreation_ground", "airport",
                  "aerodrome"}

FACILITY_CATS = {
    # category: (kind, can host a shelter)
    "elementary_school": ("school", True), "middle_school": ("school", True),
    "high_school": ("school", True), "college_university": ("school", True),
    "community_center": ("community", True), "cultural_center": ("community", True),
    "library": ("community", True), "sports_and_recreation": ("community", True),
    "stadium_arena": ("community", True),
    "christian_place_of_worship": ("worship", True), "muslim_place_of_worship": ("worship", True),
    "jewish_place_of_worship": ("worship", True), "hindu_place_of_worship": ("worship", True),
    "buddhist_place_of_worship": ("worship", True), "place_of_worship": ("worship", True),
    "hospital": ("hospital", False), "emergency_department": ("hospital", False),
    "fire_station": ("fire", False), "police_station": ("police", False),
}


def log(msg):
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


def read(name, columns=None):
    return pq.read_table(CACHE / f"overture_{name}.parquet", columns=columns).to_pylist()


def utm(geom):
    return transform(to_utm.transform, geom)


# --------------------------------------------------------------------------- rasters

class Hand:
    """Samples HAND, raw elevation and 'height above nearby channel' in UTM."""

    def __init__(self):
        with rasterio.open(CACHE / "hand_utm.tif") as src:
            self.hand = src.read(1)
            self.tf = src.transform
            self.profile = src.profile
        with rasterio.open(CACHE / "dem_utm.tif") as src:
            self.dem = src.read(1)
        with rasterio.open(CACHE / "streams_utm.tif") as src:
            streams = src.read(1).astype(bool)
        # Lowest channel elevation within ~50 m. Where a road crosses a creek on
        # a culvert, the D8 channel runs over the embankment and HAND there is
        # ~0, which would close every culvert crossing at the first ripple. The
        # road actually floods when water overtops the embankment, i.e. once
        # the creek rises by (road elevation - creek bed elevation).
        chan = np.where(streams, self.dem, np.float32(1e6))
        self.chan_min = minimum_filter(chan, size=11, mode="nearest")
        self.inv = ~self.tf
        self.h, self.w = self.hand.shape

    def _idx(self, x, y):
        c, r = self.inv * (np.asarray(x), np.asarray(y))
        r = np.clip(np.floor(r).astype(int), 0, self.h - 1)
        c = np.clip(np.floor(c).astype(int), 0, self.w - 1)
        return r, c

    def at(self, x, y):
        r, c = self._idx(x, y)
        v = self.hand[r, c]
        return np.where(v < -1000, np.nan, v)

    def road(self, x, y):
        r, c = self._idx(x, y)
        hand = self.hand[r, c]
        near = self.chan_min[r, c] < 1e5
        above = self.dem[r, c] - self.chan_min[r, c]
        v = np.where(near, np.maximum(hand, above), hand)
        return np.where(hand < -1000, np.nan, v)


def export_hand_png(hand: Hand, water_polys):
    """HAND warped to Web Mercator and packed into a PNG.

    R: HAND in 5 cm steps (0..254 => 0..12.7 m), 255 = higher / no data
    G: 255 where OSM maps permanent water (rivers, lakes)
    """
    xmin, ymin, xmax, ymax = BBOX
    merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    mx0, my0 = merc.transform(xmin, ymin)
    mx1, my1 = merc.transform(xmax, ymax)
    res = 15.0 / math.cos(math.radians((ymin + ymax) / 2))  # ~15 m on the ground
    w = int((mx1 - mx0) / res)
    h = int((my1 - my0) / res)
    dst_tf = transform_from_bounds(mx0, my0, mx1, my1, w, h)
    out = np.full((h, w), -9999.0, dtype="float32")
    reproject(hand.hand, out, src_transform=hand.tf, src_crs=hand.profile["crs"], dst_transform=dst_tf,
              dst_crs="EPSG:3857", resampling=Resampling.bilinear, src_nodata=-9999.0, dst_nodata=-9999.0)
    r = np.where(out < -1000, 255, np.clip(np.round(out / 0.05), 0, 255)).astype(np.uint8)
    merc_polys = [transform(merc.transform, p) for p in water_polys]
    g = rasterize([(p, 255) for p in merc_polys], out_shape=(h, w), transform=dst_tf, dtype="uint8") \
        if merc_polys else np.zeros((h, w), np.uint8)
    rgb = np.stack([r, g, np.zeros_like(r)], axis=-1)
    Image.fromarray(rgb, "RGB").save(OUT / "hand.png", optimize=True)
    log(f"hand.png {w}x{h}")
    return {"bounds": [xmin, ymin, xmax, ymax], "width": w, "height": h, "step": 0.05}


# --------------------------------------------------------------------------- boundary

def city_boundary():
    areas = read("division_area")
    geoms = [wkb.loads(a["geometry"]) for a in areas
             if a["names"] and a["names"]["primary"] == "Raleigh" and a["subtype"] == "locality"]
    city = unary_union(geoms)
    log(f"Raleigh boundary area {utm(city).area / 1e6:.0f} km2")
    return city


# --------------------------------------------------------------------------- census

def load_census():
    """Tract polygons + ACS shares, if fetch_census.py has been run."""
    path = CACHE / "census_tracts.geojson"
    if not path.exists():
        return None
    fc = json.loads(path.read_text())
    tracts = []
    for f in fc["features"]:
        p = f["properties"]
        tracts.append({"geoid": p["GEOID"], "geom": shape(f["geometry"]), **p})
    log(f"census: {len(tracts)} tracts")
    return tracts


# --------------------------------------------------------------------------- buildings

def residential_buildings(city, census):
    landuse = []
    for r in read("land_use", ["geometry", "subtype", "class"]):
        if r["class"] in NONRES_LANDUSE or r["subtype"] in NONRES_LANDUSE:
            landuse.append(wkb.loads(r["geometry"]))
    lu_tree = STRtree(landuse)
    rows = read("building", ["geometry", "subtype", "class", "height", "num_floors", "is_underground"])
    log(f"{len(rows)} buildings")
    pts, area, floors, keep_rows = [], [], [], []
    for r in rows:
        if r["is_underground"]:
            continue
        st, cl = r["subtype"], r["class"]
        if st in NONRES_SUBTYPES or cl in NONRES_CLASSES:
            continue
        g = wkb.loads(r["geometry"])
        c = g.centroid
        a = utm(g).area
        if a < 40:  # sheds, garages
            continue
        explicit = st == "residential" or cl in RES_CLASSES
        if not explicit:
            if a > 4000:  # very large untagged footprints are warehouses / big-box retail
                continue
            if lu_tree.query(c, predicate="within").size:
                continue
        if r["num_floors"]:
            fl = max(1, r["num_floors"])
        elif r["height"]:
            fl = max(1, round(r["height"] / 3.2))
        else:
            fl = 1
        pts.append((c.x, c.y))
        area.append(a)
        floors.append(min(fl, 30))
    pts = np.array(pts)
    floor_area = np.array(area) * np.array(floors)
    shapely.prepare(city)
    inside = shapely.contains_xy(city, pts[:, 0], pts[:, 1])
    log(f"{len(pts)} residential buildings, {inside.sum()} inside city limits")

    pop = np.zeros(len(pts))
    tract_idx = np.full(len(pts), -1)
    if census:
        # Each tract's count is spread over all of its residential floor area,
        # including buildings outside city limits, so tracts that straddle the
        # boundary only contribute the residents who live inside it.
        tree = STRtree([t["geom"] for t in census])
        hp, ht = tree.query(shapely.points(pts), predicate="within")
        tract_idx[hp] = ht
        for ti, t in enumerate(census):
            m = tract_idx == ti
            fa = floor_area[m].sum()
            if fa > 0:
                pop[m] = floor_area[m] / fa * t["pop"]
        log(f"dasymetric population from census tracts: {pop[inside].sum():.0f} inside city")
    else:
        pop[inside] = floor_area[inside] / floor_area[inside].sum() * RALEIGH_2020_POP
        log(f"dasymetric population from city control total: {pop.sum():.0f}")
    pts, pop, tract_idx = pts[inside], pop[inside], tract_idx[inside]
    return pts, pop, tract_idx


# --------------------------------------------------------------------------- roads

def robust_min(v, run=4):
    """Lowest level at which a continuous ~40 m stretch (4 samples) is under water.

    A single low DEM cell (a ditch beside an underpass, an unflagged culvert
    abutment) shouldn't close a road; a run of submerged samples should.
    """
    if v.size == 0:
        return math.inf
    if v.size < run:
        return float(np.max(v)) if np.isfinite(v).all() else float(np.min(v))
    win = np.lib.stride_tricks.sliding_window_view(v, run).max(axis=1)
    return float(win.min())


def build_graph(hand: Hand):
    segs = read("segment", ["id", "geometry", "subtype", "class", "subclass", "names", "connectors",
                            "road_flags", "access_restrictions"])
    node_id = {}
    node_xy = []
    edges = []  # (u, v, coords_ll(list), length, cls, hand_min, name)

    def nid(cid, xy):
        if cid not in node_id:
            node_id[cid] = len(node_xy)
            node_xy.append(xy)
        return node_id[cid]

    # connectors at either end of a bridge: the DEM drops into the valley a
    # little before OSM's bridge geometry ends, so pad around them
    bridge_ends = set()
    for s in segs:
        for f in s["road_flags"] or []:
            if "is_bridge" in (f["values"] or []) and s["connectors"]:
                lo, hi = f["between"] or (0.0, 1.0)
                for c in s["connectors"]:
                    if abs(c["at"] - lo) < 1e-6 or abs(c["at"] - hi) < 1e-6:
                        bridge_ends.add(c["connector_id"])

    for s in segs:
        if s["subtype"] != "road" or s["class"] not in ROAD_CLASSES:
            continue
        if s["class"] == "service" and s["subclass"] in SERVICE_EXCLUDE:
            continue
        if any(a.get("access_type") == "denied" and not a.get("when") and not a.get("between")
               for a in (s["access_restrictions"] or [])):
            continue
        conns = s["connectors"] or []
        if len(conns) < 2:
            continue
        line = wkb.loads(s["geometry"])
        line_u = utm(line)
        L = line_u.length
        if L <= 0:
            continue
        bridges = []
        for f in s["road_flags"] or []:
            if "is_bridge" in (f["values"] or []) or "is_tunnel" in (f["values"] or []):
                bridges.append(tuple(f["between"]) if f["between"] else (0.0, 1.0))
        name = (s["names"] or {}).get("primary") or ""
        conns = sorted(conns, key=lambda c: c["at"])
        for a, b in zip(conns[:-1], conns[1:]):
            if b["at"] - a["at"] <= 0:
                continue
            part = substring(line_u, a["at"] * L, b["at"] * L)
            if part.length < 0.5:
                continue
            # sample the part every ~10 m, skipping bridge / tunnel spans
            n = max(2, int(part.length // 10) + 1)
            fr = np.linspace(0, 1, n)
            xs, ys = zip(*[part.interpolate(f, normalized=True).coords[0] for f in fr])
            gpos = a["at"] + fr * (b["at"] - a["at"])
            ok = np.ones(n, bool)
            pad = BRIDGE_PAD_M / L  # also skip the abutments either side of a bridge
            for lo, hi in bridges:
                ok &= ~((gpos >= lo - pad) & (gpos <= hi + pad))
            dist = fr * part.length
            if a["connector_id"] in bridge_ends:
                ok &= dist > BRIDGE_PAD_M
            if b["connector_id"] in bridge_ends:
                ok &= dist < part.length - BRIDGE_PAD_M
            hv = hand.road(np.array(xs), np.array(ys))
            hv = np.where(ok, hv, np.inf)
            hv = np.where(np.isnan(hv), np.inf, hv)
            # Interstates and other grade-separated highways are designed above
            # the 100-year flood (FHWA 23 CFR 650), so they are treated as open.
            hmin = math.inf if s["class"] in FLOOD_IMMUNE else robust_min(hv)
            coords = [to_ll.transform(x, y) for x, y in part.coords]
            u = nid(a["connector_id"], coords[0])
            v = nid(b["connector_id"], coords[-1])
            if u == v:
                continue
            edges.append([u, v, coords, part.length, s["class"], hmin, name])
    log(f"raw graph: {len(node_xy)} nodes, {len(edges)} edges")

    # keep the largest connected component
    n = len(node_xy)
    us = np.array([e[0] for e in edges])
    vs = np.array([e[1] for e in edges])
    m = coo_matrix((np.ones(len(edges)), (us, vs)), shape=(n, n))
    ncomp, labels = connected_components(m, directed=False)
    big = np.bincount(labels).argmax()
    edges = [e for e in edges if labels[e[0]] == big]

    # contract degree-2 chains with identical class and name
    adj = defaultdict(list)
    for i, e in enumerate(edges):
        adj[e[0]].append(i)
        adj[e[1]].append(i)
    used = [False] * len(edges)
    out_edges = []

    def mergeable(node):
        inc = adj[node]
        if len(inc) != 2:
            return False
        a, b = edges[inc[0]], edges[inc[1]]
        return a[4] == b[4] and a[6] == b[6] and inc[0] != inc[1]

    def walk(start_node, ei):
        """Follow a chain from start_node through edge ei until a non-mergeable node."""
        coords, length, hmin = [], 0.0, math.inf
        node = start_node
        e = edges[ei]
        while True:
            used[ei] = True
            fwd = e[0] == node
            c = e[2] if fwd else e[2][::-1]
            coords.extend(c if not coords else c[1:])
            length += e[3]
            hmin = min(hmin, e[5])
            node = e[1] if fwd else e[0]
            if not mergeable(node):
                break
            nxt = [k for k in adj[node] if k != ei][0]
            if used[nxt]:
                break
            ei, e = nxt, edges[nxt]
        return node, coords, length, hmin

    for i, e in enumerate(edges):
        if used[i]:
            continue
        if mergeable(e[0]) and mergeable(e[1]):
            continue  # interior of a chain; picked up from an end
        start = e[1] if mergeable(e[0]) and not mergeable(e[1]) else e[0]
        end, coords, length, hmin = walk(start, i)
        out_edges.append([start, end, coords, length, e[4], hmin, e[6]])
    for i, e in enumerate(edges):  # isolated loops
        if not used[i]:
            end, coords, length, hmin = walk(e[0], i)
            out_edges.append([e[0], end, coords, length, e[4], hmin, e[6]])
    out_edges = [e for e in out_edges if e[0] != e[1] or e[3] > 0]

    # renumber nodes
    keep = sorted({e[0] for e in out_edges} | {e[1] for e in out_edges})
    remap = {old: new for new, old in enumerate(keep)}
    nodes = [node_xy[k] for k in keep]
    for e in out_edges:
        e[0], e[1] = remap[e[0]], remap[e[1]]
    log(f"contracted graph: {len(nodes)} nodes, {len(out_edges)} edges")
    return nodes, out_edges


def simplify_coords(coords, tol_m=4.0):
    if len(coords) <= 2:
        return coords
    ls = LineString([to_utm.transform(*c) for c in coords]).simplify(tol_m)
    return [to_ll.transform(x, y) for x, y in ls.coords]


def road_groups(nodes, edges, city):
    """Flood-prone road stretches: connected runs of same-named low edges."""
    cand = [i for i, e in enumerate(edges) if e[5] <= ROAD_GROUP_MAX_HAND and e[4] in GROUP_CLASSES]
    parent = {i: i for i in cand}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    by_node = defaultdict(list)
    for i in cand:
        by_node[edges[i][0]].append(i)
        by_node[edges[i][1]].append(i)
    for lst in by_node.values():
        for a in lst:
            for b in lst:
                if a < b and edges[a][6] == edges[b][6]:
                    parent[find(a)] = find(b)
    groups = defaultdict(list)
    for i in cand:
        groups[find(i)].append(i)
    out = []
    for members in groups.values():
        hmin = min(edges[i][5] for i in members)
        length = sum(edges[i][3] for i in members)
        name = edges[members[0]][6]
        # midpoint of the lowest edge, where water reaches first
        low = min(members, key=lambda i: edges[i][5])
        c = edges[low][2]
        mid = c[len(c) // 2]
        cls = edges[members[0]][4]
        out.append({"edges": sorted(members), "hand": round(hmin, 2), "name": name, "cls": cls,
                    "length": round(length), "lon": round(mid[0], 5), "lat": round(mid[1], 5)})
    shapely.prepare(city)
    out = [g for g in out if shapely.contains_xy(city, g["lon"], g["lat"])]
    out.sort(key=lambda g: g["hand"])
    for i, g in enumerate(out):
        g["id"] = i
    group_of = [-1] * len(edges)
    for g in out:
        for i in g["edges"]:
            group_of[i] = g["id"]
    log(f"{len(out)} flood-prone road stretches")
    return out, group_of


# --------------------------------------------------------------------------- facilities

def facilities(city, hand: Hand):
    out = []
    near_city = city.buffer(0.005)
    shapely.prepare(near_city)
    for r in read("place", ["geometry", "names", "basic_category", "confidence"]):
        cat = r["basic_category"]
        if cat not in FACILITY_CATS or (r["confidence"] or 0) < 0.5:
            continue
        g = wkb.loads(r["geometry"])
        if not near_city.contains(g):
            continue
        name = (r["names"] or {}).get("primary") or ""
        if cat == "college_university" and (not re.search(r"(College|University)$", name)
                                            or re.search(r"Department|Office|School of|College of|Lab|Center", name)):
            continue  # Overture lists individual departments; keep the institutions
        if not name or "|" in name:
            continue
        kind, shelter = FACILITY_CATS[cat]
        x, y = to_utm.transform(g.x, g.y)
        hv = hand.at(np.array([x]), np.array([y]))[0]
        out.append({"name": name, "kind": kind,
                    "cat": cat, "shelter": shelter, "lon": round(g.x, 5), "lat": round(g.y, 5),
                    "hand": None if np.isnan(hv) else round(float(hv), 2)})
    # de-duplicate: same name within ~200 m, or any college campus listed twice
    seen, dedup = [], []
    for f in out:
        if any(f["name"] == s["name"] and (f["cat"] == "college_university" or
               (abs(f["lon"] - s["lon"]) < 0.002 and abs(f["lat"] - s["lat"]) < 0.002)) for s in seen):
            continue
        seen.append(f)
        dedup.append(f)
    log(f"{len(dedup)} facilities")
    return dedup


# --------------------------------------------------------------------------- neighbourhoods

def neighbourhoods(city):
    divs = read("division", ["geometry", "subtype", "names"])
    macro, micro = [], []
    near_city = city.buffer(0.01)
    shapely.prepare(near_city)
    for d in divs:
        if not d["names"]:
            continue
        g = wkb.loads(d["geometry"])
        if not near_city.contains(g):
            continue
        if d["subtype"] == "macrohood":
            macro.append((d["names"]["primary"], g.x, g.y))
        elif d["subtype"] in ("neighborhood", "microhood"):
            micro.append((d["names"]["primary"], g.x, g.y))
    log(f"{len(macro)} districts, {len(micro)} neighbourhoods")
    return macro, micro


# --------------------------------------------------------------------------- main

def main():
    hand = Hand()
    city = city_boundary()
    census = load_census()

    water_polys = []
    for r in read("water", ["geometry", "subtype", "class"]):
        g = wkb.loads(r["geometry"])
        if g.geom_type in ("Polygon", "MultiPolygon") and r["subtype"] in ("lake", "reservoir", "river", "pond", "water"):
            water_polys.append(g)
    hand_meta = export_hand_png(hand, water_polys)

    # ---- hex grid
    city_simple = city.simplify(0.0005)
    cells = sorted(h3.geo_to_cells(mapping(city_simple), H3_RES))
    cell_idx = {c: i for i, c in enumerate(cells)}
    log(f"{len(cells)} H3 res-{H3_RES} cells")
    centers = np.array([h3.cell_to_latlng(c)[::-1] for c in cells])  # lon, lat

    # ---- population
    bpts, bpop, btract = residential_buildings(city, census)
    bx, by = to_utm.transform(bpts[:, 0], bpts[:, 1])
    bhand = hand.at(bx, by)
    bcells = [h3.latlng_to_cell(lat, lon, H3_RES) for lon, lat in bpts]
    extra = sorted(set(bcells) - set(cell_idx))
    if extra:
        cells = cells + extra
        cell_idx = {c: i for i, c in enumerate(cells)}
        centers = np.array([h3.cell_to_latlng(c)[::-1] for c in cells])
        log(f"added {len(extra)} edge cells holding residents")
    bcell = [cell_idx[c] for c in bcells]
    nbins = int(HAND_MAX / HAND_BIN)
    pop = np.zeros(len(cells))
    expo = np.zeros((len(cells), nbins))
    tract_pop = defaultdict(lambda: defaultdict(float))
    for i, c in enumerate(bcell):
        if c < 0:
            continue
        pop[c] += bpop[i]
        if btract[i] >= 0:
            tract_pop[c][btract[i]] += bpop[i]
        hv = bhand[i]
        if not np.isnan(hv) and hv < HAND_MAX:
            expo[c, int(hv // HAND_BIN)] += bpop[i]
    log(f"population on grid {pop.sum():.0f}; within HAND<=3m {expo[:, :12].sum():.0f}")

    # ---- vulnerability shares
    if census:
        keys = ["elderly", "poverty", "nocar", "hhsize"]
        shares = {k: np.zeros(len(cells)) for k in keys}
        for c in range(len(cells)):
            tp = tract_pop.get(c)
            if not tp:
                continue
            tot = sum(tp.values())
            if tot <= 0:
                continue  # buildings only in zero-population tracts (campus, industrial)
            for k in keys:
                shares[k][c] = sum(census[t][k] * w for t, w in tp.items()) / tot
        demog_source = "acs5"
        tract_of = [max(tract_pop[c], key=tract_pop[c].get) if c in tract_pop else -1 for c in range(len(cells))]
    else:
        fb = json.loads((CACHE.parent / "fallback_demographics.json").read_text())
        shares = {k: np.full(len(cells), fb[k]) for k in ["elderly", "poverty", "nocar", "hhsize"]}
        demog_source = "citywide-fallback"
        tract_of = [-1] * len(cells)

    # ---- graph
    nodes, edges = build_graph(hand)
    groups, group_of = road_groups(nodes, edges, city)
    node_arr = np.array(nodes)
    nx, ny = to_utm.transform(node_arr[:, 0], node_arr[:, 1])
    # snap hexes to the nearest node that isn't on a motorway / trunk
    walkable = np.zeros(len(nodes), bool)
    for e in edges:
        if e[4] not in NO_WALK:
            walkable[e[0]] = walkable[e[1]] = True
    widx = np.where(walkable)[0]
    tree = cKDTree(np.c_[nx[widx], ny[widx]])
    cx, cy = to_utm.transform(centers[:, 0], centers[:, 1])
    dist, near = tree.query(np.c_[cx, cy])
    hex_node = widx[near]
    log(f"hex->node snap distance median {np.median(dist):.0f} m, p95 {np.percentile(dist, 95):.0f} m")

    # ---- facilities
    facs = facilities(city, hand)
    fx, fy = to_utm.transform([f["lon"] for f in facs], [f["lat"] for f in facs])
    _, fnear = tree.query(np.c_[fx, fy])
    for f, k in zip(facs, fnear):
        f["node"] = int(widx[k])

    # ---- neighbourhoods
    macro, micro = neighbourhoods(city)
    mt = cKDTree(np.column_stack(to_utm.transform([m[1] for m in macro], [m[2] for m in macro])))
    nt = cKDTree(np.column_stack(to_utm.transform([m[1] for m in micro], [m[2] for m in micro])))
    district_names = [m[0] for m in macro]
    _, hd = mt.query(np.c_[cx, cy])
    nd, hn = nt.query(np.c_[cx, cy])
    hood_names = sorted({micro[k][0] for k in hn})
    hood_idx = {n: i for i, n in enumerate(hood_names)}

    # ---- write hexes
    def rnd(a, d=1):
        return [round(float(x), d) for x in a]

    hexes = {
        "res": H3_RES,
        "binSize": HAND_BIN,
        "id": cells,
        "lon": rnd(centers[:, 0], 5),
        "lat": rnd(centers[:, 1], 5),
        "pop": rnd(pop, 1),
        "elderly": rnd(shares["elderly"], 3),
        "poverty": rnd(shares["poverty"], 3),
        "nocar": rnd(shares["nocar"], 3),
        "hhsize": rnd(shares["hhsize"], 2),
        "node": [int(x) for x in hex_node],
        "district": [int(x) for x in hd],
        "hood": [hood_idx[micro[k][0]] for k in hn],
        "tract": [census[t]["geoid"] if t >= 0 else None for t in tract_of] if census else None,
        # sparse exposure: per hex, [bin, pop, bin, pop, ...] for HAND < HAND_MAX
        "expo": [[v for b in np.nonzero(row)[0] for v in (int(b), round(float(row[b]), 1))] for row in expo],
        "districts": district_names,
        "hoods": hood_names,
    }
    (OUT / "hexes.json").write_text(json.dumps(hexes, separators=(",", ":")))

    # ---- write graph (coordinates quantised to 1e-5 degrees and delta-encoded)
    q = 1e5
    cls_list = ROAD_CLASSES
    node_q = [(round(x * q), round(y * q)) for x, y in nodes]
    geom = []
    for e in edges:
        c = simplify_coords(e[2])
        pts = [(round(x * q), round(y * q)) for x, y in c[1:-1]]
        flat, px, py = [], node_q[e[0]][0], node_q[e[0]][1]
        for x, y in pts:
            flat += [x - px, y - py]
            px, py = x, y
        geom.append(flat)
    graph = {
        "q": q,
        "classes": cls_list,
        "nodes": [v for xy in node_q for v in xy],
        "u": [e[0] for e in edges],
        "v": [e[1] for e in edges],
        "len": [round(e[3]) for e in edges],
        "cls": [cls_list.index(e[4]) for e in edges],
        # height above drainage at which water reaches the road, in cm; -1 = never (bridge / high ground)
        "hand": [-1 if (math.isinf(e[5]) or e[5] > 30) else int(round(e[5] * 100)) for e in edges],
        "grp": group_of,
        "geom": geom,
    }
    names = sorted({e[6] for e in edges})
    nidx = {n: i for i, n in enumerate(names)}
    graph["names"] = names
    graph["name"] = [nidx[e[6]] for e in edges]
    (OUT / "graph.json").write_text(json.dumps(graph, separators=(",", ":")))
    (OUT / "roads.json").write_text(json.dumps(groups, separators=(",", ":")))
    (OUT / "facilities.json").write_text(json.dumps(facs, separators=(",", ":")))
    (OUT / "boundary.json").write_text(json.dumps(
        {"type": "Feature", "properties": {"name": "Raleigh"}, "geometry": mapping(city.simplify(0.0003))},
        separators=(",", ":")))

    release = (CACHE / "overture_release.txt").read_text().strip()
    meta = {
        "city": "Raleigh, NC",
        "bbox": BBOX,
        "center": [-78.6382, 35.7796],
        "generated": time.strftime("%Y-%m-%d"),
        "population": round(float(pop.sum())),
        "hand": hand_meta,
        "demographics": demog_source,
        "sources": [
            {"name": "OpenStreetMap via Overture Maps " + release,
             "use": "road network, building footprints, land use, facilities, neighbourhood names"},
            {"name": "USGS 3DEP 1/3 arc-second DEM (n36w079)",
             "use": "Height Above Nearest Drainage flood model"},
            {"name": "US Census Bureau ACS 5-year + TIGER tracts" if census else
             "US Census 2020 (city total, P1) + ACS citywide shares",
             "use": "population and vulnerable groups"},
        ],
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    for f in sorted(OUT.iterdir()):
        log(f"  {f.name}: {f.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
