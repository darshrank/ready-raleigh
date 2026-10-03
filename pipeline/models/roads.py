"""Road closures and travel-time coverage (DATA.md §3.3).

Edge closes at the first stage where water over any sampled point of the road is > 0.5 ft
(NWS: 6 in of moving water can stall a car). Bridges (OSM bridge=yes): a bare-earth DEM has no
deck (it shows the creek bed), so the deck elevation is taken as the higher of the two approach
(endpoint) ground elevations; the bridge closes when water exceeds the deck.
"""

from __future__ import annotations

import networkx as nx
import numpy as np
import osmnx as ox
import rasterio
from shapely.geometry import LineString

CLOSE_DEPTH_M = 0.5 * 0.3048
# Untagged structures: a road profile notch at a mapped stream crossing (bare-earth DEM has no deck).
NOTCH_HALF_M = 30.0  # samples within this distance of the crossing form the notch
SHOULDER_M = 60.0  # approach (shoulder) samples are 30–60 m from the crossing
NOTCH_MIN_DEPTH_M = 1.0
SAMPLE_M = 6.0
SHELTER_DRIVE_S = 15 * 60


def load_drive(path) -> nx.MultiDiGraph:
    g = ox.load_graphml(path)
    g = ox.add_edge_speeds(g)
    return ox.add_edge_travel_times(g)


def _is_bridge(v) -> bool:
    if isinstance(v, list):
        return any(_is_bridge(x) for x in v)
    return isinstance(v, str) and v not in ("no", "")


def notch_deck(dists: np.ndarray, ground: np.ndarray, crossings: list[float]) -> np.ndarray:
    """Deck elevation for samples inside a stream-crossing notch, NaN elsewhere.

    dists: distance (m) of each sample along the edge; crossings: distances where the edge
    crosses a mapped stream. A notch is an untagged bridge (or culvert opening) when the samples
    within NOTCH_HALF_M of the crossing dip > NOTCH_MIN_DEPTH_M below *both* approaches; its deck
    is the lower of the two approach maxima (like tagged bridges: water must top the approaches).
    """
    deck = np.full(len(ground), np.nan)
    for c in crossings:
        off = dists - c
        notch = np.abs(off) <= NOTCH_HALF_M
        left = (off < -NOTCH_HALF_M) & (off >= -SHOULDER_M)
        right = (off > NOTCH_HALF_M) & (off <= SHOULDER_M)
        if not (notch.any() and left.any() and right.any()):
            continue
        d = min(np.nanmax(ground[left]), np.nanmax(ground[right]))
        if d - np.nanmin(ground[notch]) > NOTCH_MIN_DEPTH_M:
            deck[notch] = np.fmax(deck[notch], d) if np.isfinite(deck[notch]).any() else d
    return deck


def edge_samples(g: nx.MultiDiGraph, utm_crs, transform, shape_, streams=None, dem_flat=None):
    """Per edge: flat raster indices of sample points, endpoint indices, bridge flag, length, and
    deck overrides for untagged stream-crossing notches (needs `streams` in UTM + `dem_flat`)."""
    gu = ox.project_graph(g, to_crs=utm_crs)  # same node ids/keys; edge order may differ
    out = []
    for u, v, k, du in gu.edges(keys=True, data=True):
        geom = du.get("geometry") or LineString(
            [(gu.nodes[u]["x"], gu.nodes[u]["y"]), (gu.nodes[v]["x"], gu.nodes[v]["y"])]
        )
        n = max(int(geom.length // SAMPLE_M) + 1, 2)
        pts = [geom.interpolate(t, normalized=True) for t in np.linspace(0, 1, n)]
        rr, cc = rasterio.transform.rowcol(transform, [p.x for p in pts], [p.y for p in pts])
        rr, cc = np.asarray(rr), np.asarray(cc)
        ok = (rr >= 0) & (rr < shape_[0]) & (cc >= 0) & (cc < shape_[1])
        idx = np.ravel_multi_index((rr[ok], cc[ok]), shape_) if ok.any() else np.array([], int)
        bridge = _is_bridge(du.get("bridge"))
        deck = np.full(len(idx), np.nan)
        if streams is not None and dem_flat is not None and len(idx) and not bridge:
            dists = np.linspace(0, geom.length, n)[ok]
            crossings = []
            for sg in streams.geometry.values[streams.sindex.query(geom, predicate="intersects")]:
                x = geom.intersection(sg)
                for p in getattr(x, "geoms", [x]):
                    if p.geom_type == "Point":
                        crossings.append(geom.project(p))
            if crossings:
                deck = notch_deck(dists, dem_flat[idx], crossings)
        out.append(
            {
                "key": (u, v, k),
                "idx": idx,
                "ends": idx[[0, -1]] if len(idx) else idx,
                "bridge": bridge,
                "deck": deck,
                "untagged_structure": bool(np.isfinite(deck).any()),
                "length_m": float(geom.length),
            }
        )
    return out


def closure_stage(sample, dem_flat, wse_by_stage: list[np.ndarray]) -> int | None:
    """Index of the first stage at which the edge is impassable (None = never)."""
    idx = sample["idx"]
    if not len(idx):
        return None
    if sample["bridge"]:
        deck = np.nanmax(dem_flat[sample["ends"]])
        for i, w in enumerate(wse_by_stage):
            if np.nanmax(w[idx]) - deck > CLOSE_DEPTH_M:
                return i
        return None
    ground = dem_flat[idx]
    deck = sample.get("deck")
    if deck is not None and np.isfinite(deck).any():
        ground = np.where(np.isfinite(deck), deck, ground)
    for i, w in enumerate(wse_by_stage):
        if np.nanmax(w[idx] - ground) > CLOSE_DEPTH_M:
            return i
    return None


def reachable(g: nx.MultiDiGraph, source, closed: set, cutoff_s: float) -> dict:
    """Shortest drive time (s) from `source` to every node within cutoff, avoiding closed edges."""

    def weight(u, v, d):
        best = None
        for k, attr in d.items():
            if (u, v, k) in closed:
                continue
            t = attr.get("travel_time", 1e9)
            best = t if best is None or t < best else best
        return best  # None hides the edge

    return nx.single_source_dijkstra_path_length(g, source, cutoff=cutoff_s, weight=weight)
