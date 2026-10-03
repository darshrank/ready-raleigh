"""Build flood datasets after P2: python -m pipeline.build_flood."""
from collections import Counter
from datetime import datetime, timezone
import json
import os
import re

import geopandas as gpd
import h3
import numpy as np
from shapely.geometry import Polygon

from .config import CACHE, DATA, MAX_FILE_BYTES, METRIC_CRS, OUT
from .flood import (adjacency, dissolve_hazards, dots, facilities, hospital_distances,
                    cell_flood_shares, risk_share, prepare_graph, protection_roads, road_segments, site_coverage, snapped, TO_METRIC)
from .flood_sources import NFHL, download_amenities, download_flood, download_roads, routing_area
from .sources import read_json, write_json
from .validate import validate_cells


def plot_checks(area, cells, flood, hospitals, sites):
    os.environ.setdefault('MPLCONFIGDIR', str(OUT / '.mplconfig'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    polygons = [Polygon([(lon, lat) for lat, lon in h3.cell_to_boundary(c['h3'])]) for c in cells]
    frame = gpd.GeoDataFrame(cells, geometry=polygons, crs=4326).to_crs(METRIC_CRS)
    boundaries = area.to_crs(METRIC_CRS)
    hazards = gpd.GeoDataFrame.from_features(flood['features'], crs=4326).to_crs(METRIC_CRS)
    colors = {1: '#08306b', 2: '#2171b5', 3: '#9ecae1'}
    def base(title):
        fig, ax = plt.subplots(figsize=(10, 11), layout='constrained')
        boundaries.iloc[[1]].plot(ax=ax, color='#f1f3f5', edgecolor='#8494a5', linewidth=.7)
        ax.set_title(title, loc='left', fontsize=15)
        ax.set_axis_off()
        return fig, ax
    def finish(fig, ax, name, footer):
        boundaries.iloc[[0]].boundary.plot(ax=ax, color='#596979', linewidth=.4)
        minx, miny, maxx, maxy = boundaries.total_bounds
        ax.set_xlim(minx-600, maxx+600); ax.set_ylim(miny-600, maxy+600)
        x, y = minx+1000, miny+1000
        ax.plot([x,x+5000], [y,y], color='#25354a', linewidth=3)
        ax.text(x+2500,y+350,'5 km',ha='center',fontsize=8)
        ax.annotate('N', xy=(.95,.97),xytext=(.95,.9),xycoords='axes fraction',ha='center',arrowprops={'arrowstyle':'->'})
        fig.text(.02,.003,footer,fontsize=8)
        fig.savefig(OUT / name,dpi=140,facecolor='white');plt.close(fig)
    fig, ax = base('Ready Raleigh | FEMA flood steps\nFloodway → 1% annual chance → 0.2% annual chance')
    for step in (3,2,1):
        hazards.loc[hazards.step == step].plot(ax=ax,color=colors[step],linewidth=0)
    ax.legend(handles=[Patch(facecolor=colors[s],label=label) for s,label in [(1,'1 · Floodway'),(2,'2 · 1% annual chance'),(3,'3 · 0.2% annual chance')]],loc='upper left')
    finish(fig,ax,'check_flood_steps.png','FEMA NFHL · Wake + Durham · 10 m display simplification · Raleigh + 1 km study area')
    fig, ax = base(f'Ready Raleigh | Hospital access at flood step 3\n{sum(c["cutOff"] for c in cells):,} cells have no driving route')
    hazards.plot(ax=ax,color='#c6dbef',linewidth=0)
    frame.loc[frame.cutOff].plot(ax=ax,color='#e05c3f',linewidth=0,alpha=.85)
    hospital_xy = [TO_METRIC(h['lon'],h['lat']) for h in hospitals]
    ax.scatter([p[0] for p in hospital_xy],[p[1] for p in hospital_xy],marker='P',c='#1c7854',s=60,edgecolors='white',linewidths=.5)
    ax.legend(handles=[Patch(facecolor='#e05c3f',label='Loses hospital access'),Patch(facecolor='#c6dbef',label='Flood zones'),Patch(facecolor='#1c7854',label='Hospital (OSM)')],loc='upper left')
    finish(fig,ax,'check_cutoff_cells.png','Directed drive graph · Non-bridge roads close on intersection · Existing dry disconnections excluded')
    fig, axes = plt.subplots(1,2,figsize=(16,10),layout='constrained')
    usable = [s for s in sites if s['floodStep'] is None]
    for ax,key,label in zip(axes,['coverDry','coverFlood'],['Dry roads','Step-3 roads']):
        counts = Counter(i for s in usable for i in s[key])
        frame['coverage'] = [counts.get(i,0) for i in range(len(cells))]
        frame.plot(column='coverage',ax=ax,cmap='YlGnBu',vmin=0,vmax=len(usable),linewidth=0,legend=True,legend_kwds={'shrink':.6,'label':'Reachable dry candidate sites'})
        boundaries.iloc[[0]].boundary.plot(ax=ax,color='#657383',linewidth=.4)
        xy=[TO_METRIC(s['lon'],s['lat']) for s in usable]
        ax.scatter([p[0] for p in xy],[p[1] for p in xy],s=5,c='#ef7f32',alpha=.6)
        ax.set_title(label);ax.set_axis_off()
    fig.suptitle(f'Ready Raleigh | 15-minute shelter access\n{len(sites)} sites retained; {len(usable)} outside mapped flood zones',fontsize=17)
    fig.text(.02,.003,'Residents drive toward sites on one-way-aware roads. Orange dots: dry candidate sites. Free-flow catchments for at-risk cells; engine applies 10,000-person capacity.',fontsize=9)
    fig.savefig(OUT/'check_site_coverage.png',dpi=140,facecolor='white');plt.close(fig)


def main():
    for folder in (DATA, OUT, CACHE): folder.mkdir(exist_ok=True, parents=True)
    area = gpd.read_file(CACHE / 'study_area.geojson')
    study = area.geometry.iloc[1]
    route = routing_area(area)
    cells = read_json(DATA/'cells.json')
    print('[P3 1/7] Load official hazards, drive graph, facilities', flush=True)
    hazards, flood = dissolve_hazards(download_flood(route), study, route)
    graph, records, tree = prepare_graph(download_roads(route), hazards)
    print(f"  {len(graph['nodes'])} nodes; {len(graph['edges'])} directed edges", flush=True)
    hospitals, candidates, diagnostics, centers = facilities(download_amenities(route), study, hazards, tree, cells)
    print(f'  {len(hospitals)} hospitals; {len(candidates)} spatially deduplicated sites', flush=True)
    cell_nodes, snap_distances = snapped(tree, centers)
    polygons = gpd.GeoSeries([Polygon([(lon,lat) for lat,lon in h3.cell_to_boundary(c['h3'])]) for c in cells],crs=4326).to_crs(METRIC_CRS)
    steps, shares = cell_flood_shares(polygons, hazards)
    print('[P3 2/7] Multi-source hospital Dijkstra on dry and flooded roads', flush=True)
    dry = adjacency(len(graph['nodes']), graph['edges'])
    flooded = adjacency(len(graph['nodes']), graph['edges'], flooded=True)
    hospital_nodes = [h['node'] for h in hospitals]
    dry_distances = hospital_distances(dry, hospital_nodes)
    flood_distances = hospital_distances(flooded, hospital_nodes)
    # Only loss of a previously available route is flood-induced cut-off.
    cutoff = np.isfinite(dry_distances[cell_nodes]) & ~np.isfinite(flood_distances[cell_nodes])
    for c, step, cut, fractions in zip(cells, steps, cutoff, shares):
        c['floodStep'],c['cutOff'] = step,bool(cut)
        c['floodFrac'] = round(float(fractions[-1]), 6)
    validate_cells(cells)
    print('[P3 3/7] Multiprocessing 900-second site catchments', flush=True)
    sites = site_coverage(candidates, dry, flooded, cell_nodes, np.array([risk_share(c) > 0 for c in cells]))
    print('[P3 4/7] Rank continuous flooded street segments by restored weighted people', flush=True)
    segments = road_segments(records, study, cells)
    roads, ranked = protection_roads(segments, flooded, flood_distances, cell_nodes, cutoff, graph['edges'], cells)
    print(f'  {len(segments)} segments ranked; {sum(score > 0 for score,_ in ranked)} restore access', flush=True)
    print('[P3 5/7] Generate 120 m flood dots and compact exports', flush=True)
    outputs = {'cells.json':cells,'roads_graph.json':graph,'hospitals.json':hospitals,'sites.json':sites,
               'flood_roads.json':roads,'flood_steps.geojson':flood,'flood_dots.json':dots(flood)}
    for name,value in outputs.items():
        encoded = json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
        if len(encoded) >= MAX_FILE_BYTES: raise ValueError(f'{name}: {len(encoded)} exceeds budget')
        write_json(DATA/name,value)
        print(f'  {name}: {len(encoded):,} bytes',flush=True)
    metadata = read_json(DATA/'meta.json')
    metadata['task'] = 'P2+P3'
    metadata['buildDate'] = datetime.now(timezone.utc).isoformat()
    metadata['sources'].update({'flood':NFHL,'roads':'https://www.openstreetmap.org/copyright','facilities':'https://www.openstreetmap.org/copyright'})
    metadata['p2']['limitations'] = [x for x in metadata['p2']['limitations'] if not x.startswith('Flood, hospital')]
    report = {'nodes':len(graph['nodes']),'edges':len(graph['edges']),'floodedEdges':sum(r['step'] is not None for r in records),
        'cellFloodSteps':dict(Counter(str(c['floodStep']) for c in cells)), 'cutOffCells':int(cutoff.sum()),
        'newlyCutOffCells':int((np.isfinite(dry_distances[cell_nodes]) & cutoff).sum()),
        'dryDisconnectedCells':np.flatnonzero(~np.isfinite(dry_distances[cell_nodes])).tolist(),
        'finalNoHospitalCells':int((~np.isfinite(flood_distances[cell_nodes])).sum()),
        'bridgeEdges':sum(r['bridge'] for r in records),
        'atRiskPeople':round(sum(c['pop'] * risk_share(c) for c in cells), 3),
        'atRiskResidentShare':sum(c['pop'] * risk_share(c) for c in cells) / sum(c['pop'] for c in cells),
        'cutOffPeople':round(sum(c['pop'] for c in cells if c['cutOff']),3),
        'hospitals':len(hospitals),'sites':len(sites),'sitesBeforeSizeLimit':len(candidates),
        'floodRoads':len(roads),'candidateSegments':len(segments),'positiveUnlockSegments':sum(s>0 for s,r in ranked),
        'dots':len(outputs['flood_dots.json']),'maxCellSnapMeters':round(float(snap_distances.max()),1),
        'maxHospitalSnapMeters':max(diagnostics['hospitalSnapMeters']),
        'maxSiteSnapMeters':max(diagnostics['siteSnapMeters']),
        'topRoadWeightedUnlocks':[{'id':r['id'],'weighted':round(score,3)} for score,r in ranked[:50]]}
    source_dates = read_json(CACHE/'p3_source_dates.json')
    timestamps = set()
    for path in (CACHE/'osmnx').glob('*.json'):
        with path.open() as stream:
            timestamps.update(re.findall(r'\"timestamp_osm_base\":\s*\"([^\"]+)\"', stream.read(600)))
    source_dates['osmSnapshotTimestamps'] = sorted(timestamps)
    metadata['p3'] = {'sources':source_dates, 'sanity':report,
        'thresholds':{'cellFloodShare':.2,'shelterCapacityPeople':10000,'floodSteps':{'1':'floodway','2':'1% annual chance','3':'0.2% annual chance'},
            'driveSeconds':900,'hospitalBufferMeters':5000,'simplifyMeters':10,'dotSpacingMeters':120,'maxSites':300},
        'methods':{'graph':'OSMnx simplified directed drive graph; retain all components; posted speeds with road-class fallbacks in km/h; free-flow seconds.',
            'routingExtent':'Study area plus 5 km to include nearby hospitals and avoid hard study-boundary truncation.',
            'cellFlooding':'Cumulative unsimplified polygon union in EPSG:26917; floodStep at 20% area, floodFrac final share; uniform residents within each cell.',
            'hazards':'FEMA Wake/Durham DFIRM IDs, ID-complete download; unsimplified dissolved polygons classify cells/edges/site footprints. Display geometry clipped to study area and simplified 10 m.',
            'cutOff':'Cells whose nearest graph node cannot reach a hospital at step 3. Requires a dry route; pre-existing dry gaps are excluded and separately reported.',
            'coverage':'At-risk cells only; directed cell-to-site travel, 900-second threshold, nearest first; driveDry/driveFlood are aligned integer milliseconds. Engine checks site floodStep and applies capacity.',
            'siteSelection':'One per H3 resolution 8; schools, community centres, libraries, worship in that order. Retain first candidates fitting 5 MB.',
            'roadProtection':'Connected, unbranched flooded chains per street; reopen all member directed edges with all other flooded roads closed; rank (pop+pop65+lowInc+2.5*noCarHH)*riskShare of newly accessible cells.',
            'dots':'120 m metric grid inside exported flood geometry; earliest matching step.'},
        'limitations':['Flood zones are scenario stages, not a time/depth hydraulic model.',
            'Tagged OSM bridges are assumed passable at every step, regardless of actual deck elevation; traffic and turn restrictions are not modeled.',
            'Nearest-node snapping omits driveway/access connectors; snap distances are audited.',
            'OSM hospital tagging does not guarantee an emergency department, opening hours, or storm operation.',
            'NFHL coverage is limited to Wake and Durham; roads beyond those counties in the routing margin have no modeled flood closures.',
            'Heat and canopy fields remain zero placeholders for P10.'],
        'fileBytes':{name:(DATA/name).stat().st_size for name in outputs}}
    write_json(DATA/'meta.json',metadata)
    print(f"  meta.json: {(DATA/'meta.json').stat().st_size:,} bytes",flush=True)
    write_json(OUT/'flood_sanity_report.json',report)
    write_json(OUT/'cell_flood_shares.json',shares.tolist())
    # Reproducible audit artifacts are not shipped to the browser.
    write_json(CACHE/'p3_routing_audit.json',{'cellNodes':cell_nodes.tolist(),'siteNodes':{s['id']:s['_node'] for s in candidates},
        'roadEdges':{r['id']:r['_edges'] for r in segments},'hospitalNodes':hospital_nodes,'cellFloodShares':shares.tolist()})
    print('[P3 6/7] Render three sanity maps',flush=True)
    plot_checks(area,cells,flood,hospitals,sites)
    print('[P3 7/7] Validate published contracts and budgets',flush=True)
    from .validate_flood import validate_artifacts
    validate_artifacts()
    print(json.dumps(report,indent=2),flush=True)


if __name__ == '__main__':
    main()
