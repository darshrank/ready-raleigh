"""Offline spatial/routing audit of the balance rebuild, using its source cache."""
import numpy as np
import osmnx as ox
from scipy.sparse.csgraph import dijkstra
from .config import CACHE, DATA, OUT
from .sources import read_json
from .flood import adjacency, hospital_distances, is_bridge, restored_nodes, risk_share


def main():
    cells = read_json(DATA / 'cells.json')
    sites = read_json(DATA / 'sites.json')
    roads = read_json(DATA / 'flood_roads.json')
    graph = read_json(DATA / 'roads_graph.json')
    audit = read_json(CACHE / 'p3_routing_audit.json')
    shares = np.asarray(read_json(OUT / 'cell_flood_shares.json'))
    assert shares.shape == (len(cells), 3)
    assert np.all((shares >= 0) & (shares <= 1)) and np.all(np.diff(shares, axis=1) >= -1e-9)
    for c, row in zip(cells, shares):
        assert c['floodStep'] == next((s + 1 for s, value in enumerate(row) if value >= .2 - 1e-12), None)
        assert c['floodFrac'] == round(float(row[-1]), 6)
    raw = ox.load_graphml(CACHE / 'drive.graphml')
    ordered = sorted(raw.edges(keys=True, data=True), key=lambda e: e[:3])
    assert len(ordered) == len(graph['edges'])
    bridges = [i for i, (_, _, _, d) in enumerate(ordered) if is_bridge(d.get('bridge'))]
    assert bridges and all(graph['edges'][i][3] is None for i in bridges)
    dry = adjacency(len(graph['nodes']), graph['edges'])
    wet = adjacency(len(graph['nodes']), graph['edges'], True)
    nodes = np.array(audit['cellNodes'])
    dry_access = np.isfinite(hospital_distances(dry, audit['hospitalNodes']))
    wet_access = np.isfinite(hospital_distances(wet, audit['hospitalNodes']))
    cutoff = dry_access[nodes] & ~wet_access[nodes]
    assert np.array_equal(cutoff, [c['cutOff'] for c in cells])
    risk = np.array([risk_share(c) > 0 for c in cells])
    for s in sites:
        for suffix, routing in [('Dry', dry), ('Flood', wet)]:
            times = dijkstra(routing.T.tocsr(), directed=True, indices=audit['siteNodes'][s['id']], limit=900)[nodes]
            eligible = np.flatnonzero((times <= 900) & risk)
            millis = np.rint(times[eligible] * 1000).astype(int)
            order = np.lexsort((eligible, millis))
            assert s['cover' + suffix] == eligible[order].tolist(), s['id']
            assert s['drive' + suffix] == millis[order].tolist(), s['id']
    for r in roads:
        edges = audit['roadEdges'][r['id']]
        assert not set(edges).intersection(bridges)
        gained = restored_nodes(wet.T.tocsr(), wet_access, [graph['edges'][i][:2] for i in edges])
        assert r['unlocks'] == [int(i) for i in np.flatnonzero(cutoff) if nodes[i] in gained]
        assert not r['name'].startswith('Unnamed road ') or r['name'].startswith('Unnamed road near ')
    population = sum(c['pop'] for c in cells)
    at_risk = sum(c['pop'] * risk_share(c) for c in cells)
    assert at_risk <= .2 * population, 'At-risk resident share exceeds the review gate'
    print(f'Area shares, {len(bridges)} bridge edges, cut-off, {len(sites)} sorted site catchments, '
          f'{len(roads)} road unlocks verified; at-risk share {at_risk / population:.4%}.')


if __name__ == '__main__':
    main()
