"""Validate every browser-facing P3 contract and relational invariant."""
import math

import h3
from shapely.geometry import Point, shape
from shapely import union_all

from .config import DATA, MAX_FILE_BYTES
from .sources import read_json
from .validate import validate_cells


def validate_artifacts():
    files = ['cells.json','roads_graph.json','hospitals.json','sites.json','flood_roads.json','flood_steps.geojson','flood_dots.json','meta.json']
    data = {name:read_json(DATA/name) for name in files}
    for name in files:
        assert 0 < (DATA/name).stat().st_size < MAX_FILE_BYTES, name
    cells=data['cells.json'];validate_cells(cells)
    count=len(cells)
    def indices(values):
        assert values == sorted(set(values))
        assert all(type(i) is int and 0 <= i < count for i in values)
    def coordinate(pair):
        assert len(pair)==2 and all(type(n) in (int,float) and math.isfinite(n) and round(n,5)==n for n in pair)
        assert -180<=pair[0]<=180 and -90<=pair[1]<=90
    graph=data['roads_graph.json'];assert set(graph)=={'nodes','edges'}
    for node in graph['nodes']:coordinate(node)
    for edge in graph['edges']:
        assert len(edge)==4
        assert all(type(n) is int and 0<=n<len(graph['nodes']) for n in edge[:2])
        assert math.isfinite(edge[2]) and edge[2]>0
        assert edge[3] in (None,1,2,3)
    assert data['hospitals.json']
    for h in data['hospitals.json']:
        assert set(h)=={'name','lon','lat','node'} and h['name']
        coordinate([h['lon'],h['lat']]);assert type(h['node']) is int and 0<=h['node']<len(graph['nodes'])
    sites=data['sites.json'];assert 0<len(sites)<=300
    assert len({s['id'] for s in sites})==len(sites)
    assert len({h3.latlng_to_cell(s['lat'],s['lon'],8) for s in sites})==len(sites)
    for s in sites:
        assert set(s)=={'id','name','kind','lon','lat','cell','floodStep','coverDry','coverFlood'}
        coordinate([s['lon'],s['lat']]);assert s['floodStep'] in (None,1,2,3)
        assert s['name'] and s['kind'] in {'school','community_centre','library','place_of_worship'}
        assert type(s['cell']) is int and 0<=s['cell']<count
        indices(s['coverDry']);indices(s['coverFlood'])
        assert set(s['coverFlood']) <= set(s['coverDry'])
    roads=data['flood_roads.json'];assert 0<len(roads)<=50
    assert len({r['id'] for r in roads})==len(roads)
    weights=[]
    for r in roads:
        assert set(r)=={'id','name','floodStep','coords','unlocks'}
        assert r['name'] and r['floodStep'] in (1,2,3) and len(r['coords'])>=2
        for xy in r['coords']:coordinate(xy)
        indices(r['unlocks']);assert all(cells[i]['cutOff'] for i in r['unlocks'])
        weights.append(sum(cells[i]['pop']+cells[i]['pop65']+cells[i]['lowInc']+2.5*cells[i]['noCarHH'] for i in r['unlocks']))
    assert weights==sorted(weights,reverse=True)
    flood=data['flood_steps.geojson'];assert flood['type']=='FeatureCollection'
    assert [f['properties']['step'] for f in flood['features']]==[1,2,3]
    polygons={f['properties']['step']:shape(f['geometry']) for f in flood['features']}
    assert all(g.is_valid and not g.is_empty and g.geom_type in ('Polygon','MultiPolygon') for g in polygons.values())
    assert data['flood_dots.json']
    seen=set()
    for x,y,step in data['flood_dots.json']:
        coordinate([x,y]);assert step in (1,2,3) and polygons[step].covers(Point(x,y))
        assert (x,y) not in seen;seen.add((x,y))
    assert data['meta.json']['p2']['missingDemographicCells']==[]
    assert data['meta.json']['p3']['sanity']['cutOffCells']==sum(c['cutOff'] for c in cells)
    print('All P2/P3 contracts, references, coverage subsets, geometries and file budgets pass.',flush=True)


if __name__=='__main__':validate_artifacts()
