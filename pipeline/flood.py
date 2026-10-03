"""P3 spatial/routing computations. Directed routes run toward hospitals and sites."""
from collections import defaultdict, deque
from concurrent.futures import ProcessPoolExecutor
import json
import os

import geopandas as gpd
import h3
import networkx as nx
import numpy as np
from pyproj import Transformer
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely import make_valid, set_precision, union_all, prepare, intersects, STRtree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import transform, clip_by_rect

from .config import MAX_FILE_BYTES, METRIC_CRS

TO_METRIC = Transformer.from_crs(4326, METRIC_CRS, always_xy=True).transform
TO_WGS = Transformer.from_crs(METRIC_CRS, 4326, always_xy=True).transform


def polygonal(geometry):
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return geometry
    return union_all([g for g in geometry.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])


def hazard_step(zone, subtype):
    zone, subtype = str(zone or '').upper(), str(subtype or '').upper()
    if 'FLOODWAY' in subtype:
        return 1
    if zone in {'A', 'AE', 'AH', 'AO', 'AR', 'A99', 'V', 'VE'} or zone.startswith('AR/'):
        return 2
    if '0.2 PCT' in subtype:
        return 3
    return None


def dissolve_hazards(raw, study_polygon, route_polygon):
    raw = raw.to_crs(METRIC_CRS)
    route = transform(TO_METRIC, route_polygon)
    study = transform(TO_METRIC, study_polygon)
    buckets = defaultdict(list)
    for row in raw.itertuples():
        step = hazard_step(row.FLD_ZONE, row.ZONE_SUBTY)
        if step:
            buckets[step].append(polygonal(make_valid(row.geometry)))
    hazards, exports = {}, []
    for step in (1, 2, 3):
        if not buckets[step]:
            raise ValueError(f'No source flood geometry for step {step}.')
        hazards[step] = polygonal(make_valid(union_all(buckets[step]).intersection(route)))
        # Classify against unsimplified source; simplify only the display geometry.
        display = hazards[step].intersection(study).simplify(10, preserve_topology=True).intersection(study)
        display = polygonal(make_valid(transform(TO_WGS, display)))
        display = set_precision(display, .00001)
        exports.append({'type': 'Feature', 'properties': {'step': step}, 'geometry': mapping(display)})
    return hazards, {'type': 'FeatureCollection', 'features': exports}


def classify(geometries, hazards):
    series = gpd.GeoSeries(geometries, crs=METRIC_CRS)
    values = [None] * len(series)
    for step in (1, 2, 3):
        prepare(hazards[step])
        hits = np.flatnonzero(intersects(hazards[step], series.array))
        for i in hits:
            if values[i] is None:
                values[i] = step
    return values


def cell_flood_shares(polygons, hazards):
    """Metric area shares of cumulative, unsimplified zones (union avoids double counting)."""
    series = gpd.GeoSeries(polygons, crs=METRIC_CRS)
    shares = np.zeros((len(series), 3))
    for step in (1, 2, 3):
        cumulative = union_all([hazards[s] for s in range(1, step + 1)])
        parts = list(cumulative.geoms) if cumulative.geom_type == 'MultiPolygon' else [cumulative]
        tree = STRtree(parts)
        for i, polygon in enumerate(series):
            # The union's components are disjoint: their clipped areas can be summed exactly.
            area = 0.
            for j in tree.query(polygon):
                local = make_valid(clip_by_rect(parts[j], *polygon.bounds))
                area += polygon.intersection(local).area
            shares[i, step - 1] = min(1., max(0., area / polygon.area))
    steps = [next((s + 1 for s, fraction in enumerate(row) if fraction >= .2 - 1e-12), None) for row in shares]
    return steps, shares


def is_bridge(value):
    values = value if isinstance(value, list) else [value]
    return any(v is not None and str(v).lower() not in ('', 'no', 'false', '0', 'nan') for v in values)


def risk_share(cell):
    return cell['floodFrac'] if cell['floodStep'] is not None else float(cell['cutOff'])


def prepare_graph(graph, hazards):
    node_ids = sorted(graph.nodes)
    index = {node: i for i, node in enumerate(node_ids)}
    nodes = [[round(graph.nodes[n]['x'], 5), round(graph.nodes[n]['y'], 5)] for n in node_ids]
    # Snapping uses full precision coordinates in a metric CRS.
    xy = np.array([TO_METRIC(graph.nodes[n]['x'], graph.nodes[n]['y']) for n in node_ids])
    records = []
    for u, v, key, data in sorted(graph.edges(keys=True, data=True), key=lambda e: e[:3]):
        line = data.get('geometry')
        if line is None:
            line = LineString([(graph.nodes[u]['x'], graph.nodes[u]['y']), (graph.nodes[v]['x'], graph.nodes[v]['y'])])
        name = data.get('name', '')
        name = ' / '.join(sorted(set(name))) if isinstance(name, list) else str(name)
        osmid = data.get('osmid')
        osmid = '-'.join(map(str, sorted(osmid))) if isinstance(osmid, list) else str(osmid)
        records.append({'u': index[u], 'v': index[v], 'seconds': max(.01, round(data['travel_time'], 2)),
                        'name': name, 'ref': data.get('ref', ''), 'bridge': is_bridge(data.get('bridge')),
                        'osmid': osmid, 'geometry': transform(TO_METRIC, line)})
    steps = classify([r['geometry'] for r in records], hazards)
    for r, step in zip(records, steps):
        r['step'] = None if r['bridge'] else step
    edges = [[r['u'], r['v'], r['seconds'], r['step']] for r in records]
    return {'nodes': nodes, 'edges': edges}, records, cKDTree(xy)


def adjacency(node_count, edges, flooded=False):
    # Parallel OSM edges must use their minimum travel time, never CSR's sum.
    weights = {}
    for u, v, seconds, step in edges:
        if flooded and step is not None and step <= 3:
            continue
        weights[u, v] = min(seconds, weights.get((u, v), float('inf')))
    if not weights:
        return csr_matrix((node_count, node_count))
    rows, cols = zip(*weights)
    return csr_matrix((list(weights.values()), (rows, cols)), shape=(node_count, node_count))


def hospital_distances(graph, hospital_nodes):
    if not hospital_nodes:
        raise ValueError('No hospital source nodes.')
    # Reversing arcs answers cell -> hospital on directed roads.
    return dijkstra(graph.T.tocsr(), directed=True, indices=sorted(set(hospital_nodes)), min_only=True)


def snapped(tree, points):
    distances, nodes = tree.query(np.array([[p.x, p.y] for p in points]))
    return np.asarray(nodes, dtype=int), np.asarray(distances)


def facilities(amenities, study, hazards, tree, cells):
    metric = amenities.to_crs(METRIC_CRS)
    study = transform(TO_METRIC, study)
    h3_to_cell = {c['h3']: c['i'] for c in cells}
    cell_points = [Point(TO_METRIC(*reversed(h3.cell_to_latlng(c['h3'])))) for c in cells]
    cell_tree = cKDTree([[p.x, p.y] for p in cell_points])
    candidates, hospitals, diagnostics = [], [], {'hospitalSnapMeters': [], 'siteSnapMeters': []}
    for _, row in metric.iterrows():
        footprint = make_valid(row.geometry)
        point = footprint.representative_point()
        lon, lat = TO_WGS(point.x, point.y)
        dist, node = tree.query([point.x, point.y])
        name = row.get('name')
        name = str(name) if isinstance(name, str) and name.strip() else row.amenity.replace('_', ' ').title()
        if row.amenity == 'hospital':
            hospitals.append({'name': name, 'lon': round(lon, 5), 'lat': round(lat, 5), 'node': int(node)})
            diagnostics['hospitalSnapMeters'].append(round(float(dist), 1))
        elif study.covers(point):
            step = next((s for s in (1, 2, 3) if footprint.intersects(hazards[s])), None)
            cell = h3_to_cell.get(h3.latlng_to_cell(lat, lon, 9))
            if cell is None:
                cell = int(cell_tree.query([point.x, point.y])[1])
            candidates.append({'id': f"osm-{row['element']}-{int(row['id'])}", 'name': name, 'kind': row.amenity,
                'lon': round(lon, 5), 'lat': round(lat, 5), 'cell': cell, 'floodStep': step,
                '_node': int(node), '_h8': h3.latlng_to_cell(lat, lon, 8), '_snap': round(float(dist), 1)})
    # Rank schools and community centres first, then keep one per resolution-8 cell.
    priority = {'school': 0, 'community_centre': 1, 'library': 2, 'place_of_worship': 3}
    candidates.sort(key=lambda s: (priority[s['kind']], s['floodStep'] is not None, s['id']))
    selected, used = [], set()
    for site in candidates:
        if site['_h8'] not in used:
            selected.append(site)
            used.add(site['_h8'])
        if len(selected) == 300:
            break
    # Collapse duplicate node/footprint hospital tags at the same road node and name.
    hospitals = list({(h['name'], h['node']): h for h in hospitals}.values())
    hospitals.sort(key=lambda h: (h['name'], h['node']))
    diagnostics['siteSnapMeters'] = [s['_snap'] for s in selected]
    diagnostics['candidateCount'] = len(candidates)
    return hospitals, selected, diagnostics, cell_points


_COVER = None


def init_coverage(dry_reverse, flood_reverse, cell_nodes, risk=None):
    global _COVER
    _COVER = dry_reverse, flood_reverse, cell_nodes, risk


def cover_one(site):
    dry, flooded, cell_nodes, risk = _COVER
    output = {k: v for k, v in site.items() if not k.startswith('_')}
    # Coverage is reachability, independent of whether a site itself floods.
    # Consumers separately reject a shelter with floodStep <= current step.
    for label, graph in [('coverDry', dry), ('coverFlood', flooded)]:
        distances = dijkstra(graph, directed=True, indices=site['_node'], limit=900)
        seconds = distances[cell_nodes]
        eligible = np.flatnonzero((seconds <= 900) & (risk if risk is not None else True))
        # Integer milliseconds preserve road-time precision while keeping JSON compact.
        times = np.rint(seconds[eligible] * 1000).astype(int)
        order = np.lexsort((eligible, times))
        output[label] = eligible[order].tolist()
        output[label.replace('cover', 'drive')] = times[order].tolist()
    return output


def site_coverage(sites, dry, flooded, cell_nodes, risk=None):
    with ProcessPoolExecutor(max_workers=min(6, os.cpu_count() or 1), initializer=init_coverage,
                             initargs=(dry.T.tocsr(), flooded.T.tocsr(), cell_nodes, risk)) as pool:
        results = list(pool.map(cover_one, sites, chunksize=8))
    # Fit the per-file budget while retaining the deterministic preference ranking.
    while len(json.dumps(results, separators=(',', ':'), ensure_ascii=False).encode()) >= MAX_FILE_BYTES:
        results.pop()
    if not results:
        raise ValueError('No sites fit the file budget.')
    return results


def road_segments(records, study, cells=None):
    """Continuous, unbranched flooded chains per street (both directions together)."""
    groups = defaultdict(dict)
    hood_tree = cKDTree([TO_METRIC(*reversed(h3.cell_to_latlng(c['h3']))) for c in cells]) if cells else None
    study = transform(TO_METRIC, study)
    for edge_i, r in enumerate(records):
        if r['step'] is None or not r['geometry'].intersects(study):
            continue
        ref = r.get('ref', '')
        ref = ' / '.join(sorted(set(ref))) if isinstance(ref, list) else ref
        midpoint = r['geometry'].interpolate(.5, normalized=True)
        hood = cells[int(hood_tree.query([midpoint.x, midpoint.y])[1])]['hood'] if hood_tree is not None else 'Raleigh'
        name = r['name'] or ref or f"Unnamed road near {hood}"
        # Reciprocal arcs share a geometry; retain distinct parallel carriageways.
        coords = tuple((round(x, 2), round(y, 2)) for x, y in r['geometry'].coords)
        canonical = min(coords, coords[::-1])
        key = (min(r['u'], r['v']), max(r['u'], r['v']), canonical)
        # A friendly fallback label must not merge unrelated unnamed OSM ways.
        group = (name, r['osmid'] if not r['name'] and not ref else '')
        entry = groups[group].setdefault(key, {'u': r['u'], 'v': r['v'], 'geom': r['geometry'], 'ids': []})
        entry['ids'].append(edge_i)
    segments = []
    for (name, _), physical in sorted(groups.items()):
        graph = nx.MultiGraph()
        for edge_id, entry in enumerate(physical.values()):
            graph.add_edge(entry['u'], entry['v'], key=edge_id, **entry)
        seen = set()
        # Start at junctions/endpoints; a final pass handles closed loops.
        starts = sorted(graph, key=lambda n: (graph.degree(n) == 2, n))
        for start in starts:
            for _, following, key, entry in list(graph.edges(start, keys=True, data=True)):
                if key in seen:
                    continue
                here, there, current = start, following, entry
                coords, ids = [], []
                while True:
                    seen.add(key)
                    line = list(current['geom'].coords)
                    if here != current['u']:
                        line.reverse()
                    coords.extend(line if not coords else line[1:])
                    ids.extend(current['ids'])
                    if graph.degree(there) != 2:
                        break
                    next_edges = [(v, k, d) for _, v, k, d in graph.edges(there, keys=True, data=True) if k not in seen]
                    if not next_edges:
                        break
                    here, (there, key, current) = there, next_edges[0]
                if len(coords) >= 2:
                    line = transform(TO_WGS, LineString(coords).simplify(10))
                    segments.append({'id': f'road-{len(segments):04d}', 'name': name,
                        'floodStep': min(records[i]['step'] for i in ids),
                        'coords': [[round(x, 5), round(y, 5)] for x, y in line.coords], '_edges': ids})
    return segments


def restored_nodes(reverse_flood, baseline_reachable, restored_edges):
    """Incremental reverse reachability, exactly equivalent to reopening these arcs."""
    extra = defaultdict(list)
    queue, gained = deque(), set()
    for u, v in restored_edges:
        extra[v].append(u)
        if baseline_reachable[v] and not baseline_reachable[u]:
            queue.append(u)
            gained.add(u)
    while queue:
        v = queue.popleft()
        for u in list(reverse_flood.indices[reverse_flood.indptr[v]:reverse_flood.indptr[v+1]]) + extra[v]:
            u = int(u)
            if not baseline_reachable[u] and u not in gained:
                gained.add(u)
                queue.append(u)
    return gained


_ROADS = None


def init_roads(reverse_flood, reachable, cell_nodes, cutoff, edges, weights):
    global _ROADS
    _ROADS = reverse_flood, reachable, cell_nodes, cutoff, edges, weights


def unlock_one(segment):
    reverse, reachable, cell_nodes, cutoff, edges, weights = _ROADS
    gained = restored_nodes(reverse, reachable, [(edges[i][0], edges[i][1]) for i in segment['_edges']])
    unlocks = [int(i) for i in np.flatnonzero(cutoff) if int(cell_nodes[i]) in gained]
    result = {k: v for k, v in segment.items() if not k.startswith('_')}
    result['unlocks'] = unlocks
    return float(sum(weights[i] for i in unlocks)), result


def protection_roads(segments, flooded, distances, cell_nodes, cutoff, edges, cells):
    weights = [(c['pop'] + c['pop65'] + c['lowInc'] + 2.5*c['noCarHH']) * risk_share(c) for c in cells]
    with ProcessPoolExecutor(max_workers=min(6, os.cpu_count() or 1), initializer=init_roads,
                             initargs=(flooded.T.tocsr(), np.isfinite(distances), cell_nodes, cutoff, edges, weights)) as pool:
        ranked = list(pool.map(unlock_one, segments, chunksize=32))
    ranked.sort(key=lambda item: (-item[0], item[1]['id']))
    return [r for _, r in ranked[:50]], ranked


def dots(flood_geojson):
    from shapely.geometry import shape
    hazards = {f['properties']['step']: transform(TO_METRIC, shape(f['geometry'])) for f in flood_geojson['features']}
    for geometry in hazards.values():
        prepare(geometry)
    bounds = union_all(list(hazards.values())).bounds
    minx, miny, maxx, maxy = bounds
    dots = []
    for x in np.arange(np.floor(minx/120)*120, maxx+1, 120):
        for y in np.arange(np.floor(miny/120)*120, maxy+1, 120):
            point = Point(x, y)
            step = next((s for s in (1, 2, 3) if hazards[s].covers(point)), None)
            if step:
                lon, lat = TO_WGS(x, y)
                lon, lat = round(lon, 5), round(lat, 5)
                # Rounding must not push a dot across its display polygon boundary.
                if hazards[step].covers(Point(TO_METRIC(lon, lat))):
                    dots.append([lon, lat, step])
    return dots
