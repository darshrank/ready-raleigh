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
7. Write `app/public/data/cells.json` with exactly the AGENTS.md Cell fields and P2
   placeholders (`floodStep=null`, `cutOff=false`, `heatC=0`, `treePct=0`). Export
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
