import unittest
import numpy as np
import networkx as nx
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import box, LineString

from pipeline.flood import adjacency, hazard_step, hospital_distances, restored_nodes, init_coverage, cover_one, classify, road_segments, TO_METRIC, cell_flood_shares, prepare_graph, is_bridge


class FloodTests(unittest.TestCase):
    def test_zone_priority(self):
        self.assertEqual(hazard_step('AE','FLOODWAY'),1)
        self.assertEqual(hazard_step('AE',None),2)
        self.assertEqual(hazard_step('X','0.2 PCT ANNUAL CHANCE FLOOD HAZARD'),3)
        self.assertIsNone(hazard_step('X','AREA OF MINIMAL FLOOD HAZARD'))
        self.assertIsNone(hazard_step('X','AREA WITH REDUCED FLOOD RISK DUE TO LEVEE'))

    def test_geometry_first_step_and_boundary_intersection(self):
        hazards={1:box(0,0,1,1),2:box(0,0,2,2),3:box(0,0,3,3)}
        self.assertEqual(classify([box(.1,.1,.2,.2),box(1.2,1.2,1.3,1.3),box(3,2,4,3),box(4,4,5,5)],hazards),[1,2,3,None])

    def test_cumulative_partial_area_and_threshold(self):
        hazards = {1: box(0, 0, 1, 10), 2: box(.5, 0, 2, 10), 3: box(2, 0, 5, 10)}
        steps, shares = cell_flood_shares([box(0, 0, 10, 10), box(5, 0, 15, 10)], hazards)
        self.assertEqual(steps, [2, None])
        np.testing.assert_allclose(shares, [[.1, .2, .5], [0, 0, 0]])
        # A boundary touch and a 19% sliver do not flood a whole cell.
        steps, shares = cell_flood_shares([box(0, 0, 10, 10)], {s: box(0, 0, 1.9, 10) for s in (1, 2, 3)})
        self.assertEqual(steps, [None])
        self.assertAlmostEqual(shares[0, 2], .19)

    def test_bridges_remain_open_but_bridge_no_closes(self):
        graph = nx.MultiDiGraph()
        graph.add_node(0, x=-78.65, y=35.78)
        graph.add_node(1, x=-78.64, y=35.78)
        for k, bridge in enumerate(['yes', ['no', 'viaduct'], 'no', None]):
            graph.add_edge(0, 1, key=k, travel_time=10, bridge=bridge, osmid=k)
        x, y = TO_METRIC(-78.65, 35.78)
        hazards = {s: box(x - 10000, y - 10000, x + 10000, y + 10000) for s in (1, 2, 3)}
        exported, _, _ = prepare_graph(graph, hazards)
        self.assertEqual([e[3] for e in exported['edges']], [None, None, 1, 1])
        self.assertFalse(is_bridge('false'))

    def test_road_name_uses_ref_then_neighborhood(self):
        # This test supplies an actual H3 neighborhood, never raw OSM identifiers.
        import h3
        cells = [{'h3': h3.latlng_to_cell(35.78, -78.65, 9), 'hood': 'Test Hood'}]
        def segment(ref):
            return road_segments([{'u': 0, 'v': 1, 'name': '', 'ref': ref, 'osmid': '12345', 'step': 1,
                'geometry': LineString([TO_METRIC(-78.65, 35.78), TO_METRIC(-78.64, 35.78)])}],
                box(-78.7, 35.7, -78.6, 35.8), cells)[0]
        self.assertEqual(segment('NC 50')['name'], 'NC 50')
        self.assertEqual(segment('')['name'], 'Unnamed road near Test Hood')

    def test_local_clipping_matches_exact_area_with_holes_and_disjoint_zones(self):
        from shapely import union_all
        outer = box(0, 0, 10, 10).difference(box(3, 3, 7, 7))
        hazards = {1: outer, 2: box(5, 5, 15, 15), 3: box(-5, -5, -1, -1)}
        polygons = [box(2, 2, 8, 8), box(9, 9, 16, 16), box(-4, -4, 1, 1)]
        _, shares = cell_flood_shares(polygons, hazards)
        exact = [[p.intersection(union_all([hazards[s] for s in range(1, step + 1)])).area / p.area
                  for step in (1, 2, 3)] for p in polygons]
        np.testing.assert_allclose(shares, exact, atol=1e-12)

    def test_neighborhood_label_does_not_merge_unrelated_unnamed_roads(self):
        xy = [TO_METRIC(-78.65 + i * .001, 35.78) for i in range(3)]
        records = [{'u': i, 'v': i + 1, 'name': '', 'osmid': str(i), 'step': 1,
                    'geometry': LineString(xy[i:i+2])} for i in range(2)]
        segments = road_segments(records, box(-78.7, 35.7, -78.6, 35.8))
        self.assertEqual(len(segments), 2)
        self.assertTrue(all(s['name'] == 'Unnamed road near Raleigh' for s in segments))

    def test_parallel_edges_take_min_and_one_way_reaches_hospital(self):
        graph=adjacency(4,[[0,1,7,None],[0,1,3,None],[1,2,4,None],[3,2,1,1]],flooded=True)
        distances=hospital_distances(graph,[2])
        self.assertEqual(distances[0],7)
        self.assertFalse(np.isfinite(distances[3]))
        self.assertFalse(np.isfinite(hospital_distances(graph,[0])[2]))

    def test_site_catchment_drives_to_site_and_honors_900_seconds(self):
        edges=[[0,1,899,None],[2,1,901,None],[1,3,1,None],[4,1,50,2]]
        dry=adjacency(5,edges);wet=adjacency(5,edges,True)
        init_coverage(dry.T.tocsr(),wet.T.tocsr(),np.arange(5))
        result=cover_one({'id':'school','_node':1})
        self.assertEqual(result['coverDry'],[1,4,0])
        self.assertEqual(result['coverFlood'],[1,0])

    def test_road_unlock_matches_full_dijkstra_including_chained_reopening(self):
        edges=[[0,1,1,None],[1,2,1,1],[2,3,1,2],[3,4,1,None],[5,0,1,None],[6,7,1,None]]
        wet=adjacency(8,edges,True)
        baseline=np.isfinite(hospital_distances(wet,[4]))
        gained=restored_nodes(wet.T.tocsr(),baseline,[(1,2),(2,3)])
        repaired=[e[:3]+[None] for e in edges]
        expected=set(np.flatnonzero(np.isfinite(hospital_distances(adjacency(8,repaired),[4])) & ~baseline))
        self.assertEqual(gained,expected)
        self.assertEqual(gained,{0,1,2,5})
        self.assertEqual(restored_nodes(wet.T.tocsr(),baseline,[(1,2)]),set())

    def test_street_chains_split_at_branches_and_keep_reciprocal_arcs(self):
        xy={0:(-78.65,35.78),1:(-78.64,35.78),2:(-78.63,35.78),3:(-78.64,35.79)}
        records=[]
        for u,v in [(0,1),(1,0),(1,2),(2,1),(1,3),(3,1)]:
            records.append({'u':u,'v':v,'name':'Test Street','osmid':'1','step':2,
                            'geometry':LineString([TO_METRIC(*xy[u]),TO_METRIC(*xy[v])])})
        segments=road_segments(records,box(-78.7,35.7,-78.6,35.8))
        self.assertEqual(len(segments),3)
        self.assertEqual(sorted(i for s in segments for i in s['_edges']),list(range(6)))
        self.assertTrue(all(len(s['_edges'])==2 for s in segments))

    def test_random_reopening_equivalence(self):
        rng=np.random.default_rng(17)
        for _ in range(30):
            edges=[[int(u),int(v),1,None if rng.random()<.6 else 2] for u,v in rng.integers(0,30,size=(80,2)) if u!=v]
            flooded=adjacency(30,edges,True)
            baseline=np.isfinite(hospital_distances(flooded,[29]))
            restore=[i for i,e in enumerate(edges) if e[3] and rng.random()<.4]
            gains=restored_nodes(flooded.T.tocsr(),baseline,[(edges[i][0],edges[i][1]) for i in restore])
            repaired=[e[:3]+[None if i in restore else e[3]] for i,e in enumerate(edges)]
            expected=set(np.flatnonzero(np.isfinite(hospital_distances(adjacency(30,repaired,True),[29])) & ~baseline))
            self.assertEqual(gains,expected)


if __name__=='__main__':unittest.main()
