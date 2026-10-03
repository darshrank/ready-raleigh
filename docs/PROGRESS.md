# Progress

Agents: tick items when done and verified. Mark in-progress items with your agent name and lane,
for example `[~] (Claude, C)`. Add a handoff entry at the bottom at the end of every session.

## Phase 0: setup
- [ ] P1 Monorepo scaffold, workspaces, fixtures, dev script (lane B/C)

## Phase 1: flood mode end to end
- [x] P2 Pipeline: study area, cells, census joins (A)
- [x] P3 Pipeline: roads graph, flood steps, sites, coverage, flood roads, hospitals, halftone dots (A)
- [ ] P4 Engine: types, config, coverage, scoring, optimizer, tests (B)
- [ ] P5 Design tokens and map shell with layers (C)
- [ ] P6 Planning phase: tray, placing, budget, timer, instant coverage (C)
- [ ] P7 Simulation: halftone flood, closing roads, trips, counters (C + B)
- [ ] P8 Results screen with score breakdown and optimal plan side by side (C)
- [ ] P9 Rooms: server websocket, host and player views, leaderboard, crowd heatmap, perception gap (D + C)

## Phase 2: heatwave
- [ ] P10 Pipeline heat and trees, engine heat scoring, heat UI (A + B + C)

## Phase 3: planner
- [ ] P11 Tiger Data storage and planner dashboard (D + C)

## Phase 4: bonus challenges
- [ ] P12 Gemini briefing and debrief (D)
- [ ] P13 ElevenLabs broadcast and narration (D)
- [ ] P14 GoDaddy domain and deploy (any)
- [ ] P15 Live mode: USGS gauges and NWS weather into Tiger Data (D)
- [ ] P16 Solana plan record (D)

## Phase 5: demo
- [ ] P17 Demo hardening, offline fallback, seed data, Devpost

## Handoff log

### 2026-10-03 12:10 EDT — Codex — lane A — P2
- Done: Python 3.11 venv at `pipeline/.venv`, pinned dependencies, reusable pipeline package, cached stages, strict Cell validation, Census variable-label verification, source metadata, and population QA PNG. Latest available releases verified: TIGER places 2025, ACS five-year 2024; block-group shapes use ACS vintage 2024.
- Outputs: `app/public/data/cells.json` (6,392 resolution-9 cells; 536,016.193 estimated residents; 1,134,505 bytes), `app/public/data/meta.json`, `pipeline/out/check_population.png`, and `pipeline/out/sanity_report.json`. All P2 placeholders match AGENTS.md.
- Validation: nine unit/artifact tests passed, including full-block-group denominator conservation, partial-boundary allocation, sentinel rejection, OSM fallback/nearest names, and strict Cell schema. Completed an offline rerun with all HTTP requests prohibited; no cached/generated file changed. PNG visually inspected against the Raleigh city boundary. JS typecheck/tests are not applicable: this lane has no package.json or JS scaffold, as requested.
- Census access: API variable metadata is public, but data queries returned a Missing Key page. With no CENSUS_API_KEY, the pipeline streams the official Census 2024 table-based summary files and caches the exact Wake block-group rows. Optional environment key enables the API path; no credentials are stored.
- Allocation: split each complete block group's counts evenly across all its H3 centers, then retain study-area centers; this avoids pulling outside populations into partial boundary overlaps. Fractional estimates retain six decimals. The city-only approximation is 432,365.943 versus ACS Raleigh place 481,031 (ratio 0.8988); uniform spatial allocation, differing boundary vintages, and Wake-only coverage are documented limitations.
- Gotchas: 138 study cells fall in Durham County, outside the requested Wake ACS coverage. Their demographic fields are zero placeholders, NOT observed zeros; indices are in `meta.json.p2.missingDemographicCells` and shown gray in the PNG. Nearest OSM labels use 3,473 source places (maximum nearest distance 3,250 m); these are not official neighborhood polygons.
- Dependencies/decisions: pinned GeoPandas/Shapely/PyProj/Pyogrio/Pandas/NumPy, h3, requests, matplotlib and their transitive dependencies in `pipeline/requirements.txt`. EPSG:26917 supplies the meter-based 1 km buffer and name-distance calculations. Original planning documents were at the repository root, not docs/; read those originals and created only the explicitly requested docs/PROGRESS.md handoff. Root planning files and other lanes are untouched; dependency rationale is also in pipeline/README.md.
- Half done: none for P2. P3 flood, hospital access, canopy, and heat values remain intentionally uncomputed.
- Next exact step: lane A P3 should reuse `pipeline/cache/study_area.geojson` (kind city/buffer), `pipeline/cache/allocated_cells.json` (cell-to-block-group mapping), and stable indices in cells.json to prepare roads, flood steps, candidate sites, coverage, and hospitals. Run `pipeline/.venv/bin/python -m pipeline.build_all` to populate caches on a fresh checkout, before adding downstream Cell enrichments. Do not reset P2 outputs after P3 enrichment.
- Scope: only pipeline/, app/public/data/, and this requested handoff were changed. Commit locally only; no push.

<!-- Newest first. Template:
### [time] [agent] [lane] [task id]
- Done:
- Half done:
- Next exact step:
- Gotchas:
-->

### 2026-10-03 12:45 EDT — Codex — lane A — P2/P3
- Done: Extended the Census block-group join to Durham County (state 37, county 063), rebuilt `cells.json`, and verified all 6,392 study cells have demographic coverage; the former 138 placeholders are now 0. Built FEMA NFHL flood steps, OSMnx directed drive graph with speeds/travel times, OSM hospitals and candidate sites, directed hospital reachability and cut-off cells, multiprocessing site coverage, ranked flood-road protection candidates, and 120 m flood dots.
- Outputs: `app/public/data/cells.json`, `roads_graph.json`, `flood_steps.geojson`, `hospitals.json`, `sites.json`, `flood_roads.json`, `flood_dots.json`, and enriched `meta.json`. Sanity PNGs: `pipeline/out/check_flood_steps.png`, `check_cutoff_cells.png`, and `check_site_coverage.png`.
- Validation: P2/P3 artifact validator passes all contracts, relational references, geometry checks, coverage subsets, and 5 MB budgets. Seventeen unit tests pass, including one-way routing, parallel-edge minimum travel times, flood-zone precedence, road reopening equivalence, site catchment limits, and Durham demographic coverage. PNGs were visually inspected.
- Sanity: 39,285 graph nodes, 91,569 directed edges, 2,183 flooded edges, 5 hospitals, 184 retained sites, 50 flood-road candidates, 3,261 dots, 1,367 final-state cut-off cells (1,351 newly disconnected from a dry route), and 16 dry-disconnected cells.
- Gotchas: OSMnx cache contains the completed facility Overpass responses recovered after a transient Overpass timeout. Sites are capped at 184 because the coverage arrays reach the 5 MB budget; the preference order is schools, community centres, libraries, then worship. Flood polygons are simplified only for display; original dissolved geometry classifies cells and edges. Heat and canopy remain P10 placeholders.
- Next exact step: lane B should consume the published contracts and use `floodStep`/`cutOff` plus site `coverDry`/`coverFlood` and `flood_roads.unlocks` in scoring. Re-run `pipeline/.venv/bin/python -m pipeline.validate_flood` after any data edit.
- Commit: local only; no push.
