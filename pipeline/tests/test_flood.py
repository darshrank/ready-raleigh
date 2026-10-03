import unittest
import numpy as np
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import box, LineString

from pipeline.flood import adjacency, hazard_step, hospital_distances, restored_nodes, init_coverage, cover_one, classify, road_segments, TO_METRIC


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
        self.assertEqual(result['coverDry'],[0,1,4])
        self.assertEqual(result['coverFlood'],[0,1])

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
