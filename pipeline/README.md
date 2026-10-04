# P2: Raleigh study area and population cells

Run from the repository root with Python **3.11**:

```sh
python3.11 -m venv pipeline/.venv
pipeline/.venv/bin/python -m pip install -r pipeline/requirements.txt
pipeline/.venv/bin/python -m pipeline.build_all
pipeline/.venv/bin/python -m unittest discover -s pipeline/tests -v
```

The first build needs internet access. A completed build reruns without network access.
`CENSUS_API_KEY` is optional: when set, the estimates use the Census API. Otherwise,
the pipeline streams the Census public table-based summary files and keeps Wake and Durham
block groups and the Raleigh place estimate. Variable IDs and labels are always
verified against the selected year's Census API group-variable lists before use.
Keys are never written to cache, metadata, or logs.

## Stages and outputs

1. Discover the newest published North Carolina TIGER place archive and latest ACS
   five-year release; record the selection in `pipeline/cache/releases.json`.
2. Extract Raleigh (`3755000`), reproject to EPSG:26917 (NAD83 / UTM 17N, meters),
   buffer 1,000 meters, return to WGS84. Preserve city and buffer in
   `pipeline/cache/study_area.geojson` (`kind=city|buffer`).
3. Read TIGER block groups of the **ACS vintage** to avoid mismatched census joins.
   Retain full polygons intersecting the study area, including adjacent counties.
4. Generate H3 resolution 9 cells whose centers lie inside the buffered city.
   Sort H3 IDs for stable sequential integer indices. Join centers to block groups.
5. Distribute Wake and Durham counts evenly over **all** H3 centers in each full block group,
   then retain study-area cells. This avoids allocating an entire outside block
   group's population into the few cells overlapping the buffer. Values remain
   fractional, rounded to six decimals; no household/person conversion is applied.
6. Label from the nearest named OSM `place=neighbourhood|suburb` feature within a
   search area extending 10 km beyond the study area. Use meter-based nearest-neighbor
   distances; ways/relations use Overpass centers. Empty OSM results fall back to
   the Census tract name. Failed network requests fail the stage rather than silently
   inventing names. These labels are not official neighborhood boundaries.
7. Write `app/public/data/cells.json` with the shared/src/types.ts Cell fields and P2
   placeholders (`floodStep=null`, `floodFrac=0`, `cutOff=false`, `heatC=0`, `treePct=0`). Export
   provenance, variables, limitations, and missing-demographic cell indices in
   `app/public/data/meta.json`.
8. Validate contract, uniqueness, finite nonnegative estimates, population sanity,
   and the 5 MB limit. Print totals and save `pipeline/out/sanity_report.json` plus
   `pipeline/out/check_population.png`.

## Verified variables

| Cell field | ACS estimate IDs |
|---|---|
| `pop` | `B01003_001E` |
| `pop65` | `B01001_020E`–`025E` and `B01001_044E`–`049E` |
| `lowInc` | `C17002_002E` + `C17002_003E` (under .50 and .50–.99) |
| `noCarHH` | `B25044_003E` + `B25044_010E` (owner/renter no vehicle) |

The selected release's exact labels are saved in `meta.json` and
`pipeline/cache/verified_variables.json`. Negative Census sentinel values fail the
build; they are not coerced into population counts. Age, poverty, and vehicle-access
measures overlap. ACS uncertainty is not represented in the current Cell contract.

## Coverage and interpretation

**Wake (37183) and Durham (37063)** estimates are joined. All 6,392 study
cells now have demographic coverage; the former 138 missing cells are filled
without changing indices. Missing coverage remains explicit in metadata.

Uniform allocation is a coarse model, not household locations. Population in lakes,
parks, and industrial cells is possible under this requested allocation method.
The unbuffered city estimate is checked against the ACS Raleigh place estimate as
a broad sanity check, not an exact equality: uniform allocation, geography vintage,
and estimation methods differ from the place estimate.

## Cache behavior

Downloads and derived steps reuse completed files. Downloads and JSON writes use
temporary files followed by atomic replacement. Failures do not become cache hits.
Do not delete the cache between normal runs. Generated files and the PNG are not
rewritten on cache hits; contract and sanity validation still run.

For a deliberate full refresh, remove the generated files in `pipeline/cache/`
(preserve `.gitkeep`), `pipeline/out/check_population.png`,
`pipeline/out/sanity_report.json`, and the **P2** `cells.json`/`meta.json`, then rerun.
Back up downstream P3/heat enrichments first: P2 must not overwrite their fields.
Changing releases, resolution, buffer, or allocation logic requires invalidating
all dependent artifacts together. The venv, raw downloads, and cache are ignored by Git.

## Dependencies and lane boundary

Pinned Python dependencies are confined to `pipeline/requirements.txt`: GeoPandas
(including Shapely, PyProj, Pyogrio, Pandas, NumPy) for geospatial joins/projection;
H3 for cells; Requests for source downloads; Matplotlib for the requested QA PNG.
The remaining pins are their transitive dependencies. Unit tests use stdlib unittest.
No app, server, or shared-code scaffolding is created. The requested handoff is in
`docs/PROGRESS.md`; the starter's PLAN/DECISIONS/PROGRESS files were originally at
the repository root rather than under docs/.

## Sources

- TIGER releases: https://www2.census.gov/geo/tiger/
- ACS API: https://api.census.gov/data.html
- ACS table-based summary files: https://www.census.gov/programs-surveys/acs/data/summary-file.html
- OSM contributors (ODbL attribution): https://www.openstreetmap.org/copyright
- H3 centroid-based polygon coverage: https://h3geo.org/docs/api/regions/

Maintain OSM attribution wherever the names are displayed or redistributed.

## P3 flood build

`pipeline/.venv/bin/python -m pipeline.build_flood` builds the real flood datasets
after P2. `python -m pipeline.build_all` runs both stages; use `--p2-only` for census.
All network responses, source geometries and full-precision road attributes are
cached under `pipeline/cache/`; browser artifacts are in `app/public/data/`.
Use `python -m pipeline.validate_flood` for the artifact contracts and budgets.

- FEMA NFHL layer 28 is queried for Wake/Durham FIRMs over the road search bounds.
  An ID-first query and exact returned-ID check prevent silent page truncation.
  Floodway takes precedence over A/AE/AH/AO/AR/A99/V/VE zones, then the explicit
  0.2% subtype. Minimal hazard and levee-protected X zones are excluded.
- Roads: OSMnx `drive`, simplified, all components retained. The graph extends 5 km
  beyond the study area to route to nearby hospitals. Posted OSM speeds override
  documented road-class fallback speeds (km/h); times are seconds, rounded to .01.
  Node coordinates use five decimals; full line geometry stays in the cache.
- Original dissolved hazard geometry determines intersections for roads, cell
  polygons and site footprints. Only the displayed study-area polygons simplify
  at 10 m. Tagged bridges remain open at all steps (a stated assumption). Cell
  shares use cumulative polygon unions in UTM; first >=20% area sets floodStep,
  and floodFrac stores the step-3 share. Population is uniform within each cell.
- Hospitals: every OSM `amenity=hospital` in the 5 km search margin, deduplicated
  by name and snapped node. No emergency-department or operating-status guarantee.
- Dijkstra runs on reversed directed edges to compute resident-to-destination
  routes. Parallel arcs use the minimum time, never a sparse-matrix sum. `cutOff`
  requires a dry route that is lost by step 3. Existing dry gaps are excluded
  and separately audited.
- Sites: one per H3 resolution-8 cell, preference order school, community centre,
  library, worship. Up to 300 sites are processed with multiprocessing; if their
  coverage arrays exceed 5 MB, retain the longest prefix that fits. Coverage is
  the at-risk portion of each 900-second catchment, sorted nearest first, with aligned
  driveDry/driveFlood integer milliseconds. The engine checks site floodStep,
  uses dry roads for evacuation of flooded cells and final roads for dry cut-off cells,
  and allocates 10,000 people per shelter.
- Road candidates are continuous, unbranched flooded chains of the same street,
  with reciprocal arcs protected together. Reopening is evaluated independently
  while all other flooded edges remain closed. Select the top 50 by restored
  `(pop + pop65 + lowInc + 2.5 * noCarHH) * riskShare`. The contract cannot represent joint
  benefits that require multiple separately protected segments.
- Dots: 120 m grid in UTM 17N, earliest hazard step, inside the exported polygons.
  Metadata includes source dates, thresholds, limitations, counts, snap-distance
  diagnostics, and output byte sizes. Heat/canopy await P10.

Sanity images: `pipeline/out/check_flood_steps.png`, `check_cutoff_cells.png`,
`check_site_coverage.png`. `flood_sanity_report.json` has counts; raw routing audit
(node assignments and segment edge membership) is cached for exact verification.
All files must be below 5,000,000 bytes uncompressed.

### P3 dependency decisions (lane A)

- OSMnx 2.1.1 provides the explicitly requested simplified driving graph, posted
  speeds and travel times, and OSM facility geometries.
- NetworkX 3.6.1 (OSMnx dependency) groups connected street segments.
- SciPy 1.17.1 provides projected nearest-node KD trees, sparse directed Dijkstra,
  and compact multiprocessing inputs. Its nearest-node support avoids adding
  scikit-learn. Tests remain stdlib unittest.

These dependency notes stay in the data lane per the explicit folder restriction.
No contracts or other lanes were changed.

## Data realism and balance handoff (2026-10-03)

The current rebuilt bundle is staged in `pipeline/out/data/` to honor the request
not to write under `app/`. It includes `optimal_flood.json` and `balance_report.json`.
The UI owner must adopt the matching bundle before consuming the new required
`Cell.floodFrac` and `Site.driveDry`/`driveFlood` fields. Updated synthetic fixtures
are in `shared/fixtures/`; `npm run fixtures` regenerates them there.

```sh
PIPELINE_DATA_DIR=pipeline/out/data pipeline/.venv/bin/python -m pipeline.build_flood
PIPELINE_DATA_DIR=pipeline/out/data pipeline/.venv/bin/python -m pipeline.validate_flood
PIPELINE_DATA_DIR=pipeline/out/data pipeline/.venv/bin/python -m pipeline.verify_balance
DATA_DIR=pipeline/out/data npm run optimize flood
DATA_DIR=pipeline/out/data node node_modules/vitest/vitest.mjs run shared/src/fixtures.test.ts
```

`build_flood` needs existing cells/meta from P2 in the selected directory; a fresh
build can run `build_all` with the same environment variable. `cell_flood_shares.json`
under `pipeline/out/` records every cell's three cumulative area shares in index order.
The verifier additionally uses the local routing audit cache to check exact drive
order/times, bridge exemptions, hospital disconnections and road unlocks.

The optimizer refuses flood datasets above 20% at-risk residents. Shares use actual
estimated people over all study-area residents (Raleigh plus 1 km), not vulnerability
weights over a population denominator. Weighted exposure is reported separately.

## Semantic-zoom data (standard library only)

These scripts need no virtualenv (`python3` 3.11+). They write small extra files for the map's
detail layers and record their sources in `meta.json`. Run each once with network; the downloads
are cached in `pipeline/cache/` (Overpass answers with their query in a `.query` file).

A full rebuild (`build_all`, also `--p2-only`) runs them last, from the cache only
(`pipeline/detail.py` `refresh_detail`), because its P2 step rewrites `meta.json`. A missing or
stale cache stops the rebuild with the command that fills it; it never downloads or drops a source.

| Command | Output | Source |
|---|---|---|
| `python3 -m pipeline.bus_stops` | `bus_stops.json` `[{id, name, lat, lon}]` | GoRaleigh GTFS, https://goraleigh.org/gr_gtfs (stops.txt, boarding stops) |
| `python3 -m pipeline.site_buildings` | `site_buildings.json` `[{id, match, osm, polygons}]` | OSM building footprints via Overpass (overpass-api.de; needs a User-Agent; `out geom`, not `out tags geom`, or relations lose their members) |
| `python3 -m pipeline.care_homes` | `care_homes.json` `[{id, name, kind, lat, lon}]` | OSM via Overpass: `amenity=social_facility` + `social_facility=nursing_home\|assisted_living`, `amenity=nursing_home` (the tiles drop these) |

Tests: `python3 -m unittest pipeline.tests.test_detail` (stdlib); `pipeline/tests/test_rebuild.py` (a rebuild keeps both
sources in meta.json) needs `pipeline/.venv`.
