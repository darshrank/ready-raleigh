# Ready Raleigh — Data Sources and Pipeline

Rules: every fetch is cached to `pipeline/cache/<source>/<hash>` with the request URL and
timestamp. Every derived value keeps a `source` record. If an endpoint or schema differs from
this file, stop and report it. Items marked **(verify)** were not confirmed live when this
document was written; check them first.

## 1. Areas

`pipeline/areas/*.yaml`:
```yaml
id: crabtree
name: Crabtree Creek corridor, Raleigh
bbox: [-78.70, 35.80, -78.60, 35.85]   # lon_min, lat_min, lon_max, lat_max (adjust to taste)
county_fips: "37183"                    # Wake County
nwps_gauges: [ADRN7]                    # Crabtree Creek at Anderson Drive (confirmed in NWPS)
usgs_sites: []                          # fill from NWPS/USGS lookup
storm_events: []                        # USGS STN event ids for backtests (look up)
```
Second area: `walnut` — Walnut Creek / Southeast Raleigh (set bbox; look up gauges, e.g. Walnut
Creek gauges in NWPS list such as BKJN7 / BRMN7 are upstream in Cary — pick ones inside bbox).

## 2. Sources

### Basemap and features
| Data | Source | Access |
|---|---|---|
| Vector basemap | OpenFreeMap (OSM) | Style `https://tiles.openfreemap.org/styles/liberty` → fork into a custom style. Alternative: Protomaps PMTiles extract hosted ourselves |
| Roads, buildings, amenities, waterways, culverts (`tunnel=culvert`), trees, parking | OSM via Overpass | `POST https://overpass-api.de/api/interpreter` with bbox query; also OSMnx `graph_from_bbox` for drive/walk graphs |
| Building heights (fill gaps) | Overture Maps buildings | Overture release via DuckDB/`overturemaps` CLI, bbox extract |

### Buildings with materials (NC) — the key dataset
**NC Risk Building Footprints**, ArcGIS FeatureServer layer 0 ("All Buildings"):
`https://services1.arcgis.com/YBWrN5qiESVpqi92/ArcGIS/rest/services/NC_Risk_Building_Footprints/FeatureServer/0/query`
Query: `where=1=1&geometry=<bbox>&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson`
(page with `resultOffset`/`resultRecordCount`; confirm geojson support and max record count — **verify**).
Fields: `BLDG_ID, PID, OCCUP_TYPE (HAZUS class e.g. RES1, COM1, EDU1), BUILD_TYPE (CONCRETE,
MANUFCHOME, MASONRY, STEEL, WOOD), FL_SCHEME, FLD_ZONE, STATIC_BFE, WIND_ZONE, YEAR_BUILT,
YRBUILTSRC, BLDG_VALUE, BLDVAL_SRC, BLDGREPVAL, HTD_SQ_FT, FFE (first-floor elevation), FFE_TYP`.
Coded domains: read them from `.../FeatureServer/0?f=pjson` and decode. Never display `PID`.

National fallback (later): USACE National Structure Inventory API
`https://nsi.sec.usace.army.mil/nsiapi/structures?bbox=...` (**verify** params) — construction
type, foundation type and height, occupancy.

### Terrain and hydrography
| Data | Source |
|---|---|
| DEM for modeling (1 m or 1/3") | USGS 3DEP via `py3dep` (HyRiver) or TNM API |
| DEM for rendering | AWS Terrain Tiles (Terrarium) `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` as MapLibre `raster-dem` (encoding `terrarium`) |
| Stream lines | USGS NHDPlus HR (via `pynhd`), cross-check with NC OneMap hydrography |
| HAND | Compute with WhiteboxTools `ElevationAboveStream` from breached DEM + rasterized streams (same approach as NOAA OWP inundation-mapping) |

### Flood hazard and history
| Data | Source |
|---|---|
| FEMA flood zones | NFHL MapServer `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer` — Flood Hazard Zones layer (S_FLD_HAZ_AR; **verify** layer id, commonly 28) |
| Past flood claims | OpenFEMA `https://www.fema.gov/api/open/v2/FimaNfipClaims?$filter=countyCode eq '37183'` (fields incl. `censusTract`, `yearOfLoss`, `amountPaidOnBuildingClaim`, `dateOfLoss`; **verify** field names) — aggregate by tract only |
| High-water marks | USGS STN (Flood Event Viewer) via `pygeohydro.STNFloodEventData` (filter state NC, event) |
| Live gauges + flood categories | NOAA NWPS `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=..&bbox.ymin=..&bbox.xmax=..&bbox.ymax=..&srid=EPSG_4326` → `status.observed.{primary, primaryUnit, floodCategory, validTime}`, `status.forecast.*` (confirmed). Per gauge: `/nwps/v1/gauges/{lid}` and `/stageflow` for stages and history (**verify**) |
| Gauge history | USGS Water Data APIs (check current endpoint; legacy waterservices is being retired) |
| Rainfall scenarios | NOAA Atlas 14 PFDS (precipitation frequency for a point) |
| Alerts | NWS `https://api.weather.gov/alerts/active?area=NC` (send a `User-Agent` header) |
| Weather | Open-Meteo `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&hourly=temperature_2m,precipitation` (no key) |

### Heat
| Data | Source |
|---|---|
| Surface temperature | Landsat Collection 2 Level-2 (ST_B10) via Microsoft Planetary Computer STAC `https://planetarycomputer.microsoft.com/api/stac/v1` collection `landsat-c2-l2`; pick clear summer afternoon scenes (cloud < 10%), convert to °F |
| Tree canopy, impervious %, land cover | NLCD (MRLC) — tree canopy cover, impervious descriptor, land cover rasters |

### People
| Data | Source |
|---|---|
| ACS 5-year by block group | `https://api.census.gov/data/2023/acs/acs5?get=<vars>&for=block%20group:*&in=state:37%20county:183` — age 65+ (B01001), no vehicle (B25044), poverty (C17002), limited English (C16002), total pop (B01003) |
| Block population (dasymetric) | 2020 Decennial P1 by block |
| Geometries | Census TIGER/Line 2024 block groups & blocks for NC (`tl_2024_37_bg`, `tl_2020_37_tabblock20`) |
| Vulnerability index | CDC/ATSDR SVI (tract) for comparison layer |
| Facilities | OSM amenities (school, place_of_worship, community_centre, hospital, fire_station) as candidate sites |
| Pollution context (Heat mode, optional) | EPA ECHO facilities |

### Imagery
| Data | Source |
|---|---|
| Street photos | Mapillary API v4 `https://graph.mapillary.com/images?bbox=..&fields=id,thumb_1024_url,computed_geometry,captured_at&access_token=$MAPILLARY_TOKEN`; fallback Panoramax. Show attribution. |
| Aerial | NC OneMap orthoimagery (WMS/tiles) — input to Gemini roof estimates; **verify** service URL |

## 3. Models (implement in `pipeline/models/`, document in METHODS.md)

1. **Inundation:** stages 0..N (0.5 ft steps up to the record stage + 2 ft) per reach; wet if
   `HAND < stage`. Output: per-stage polygons (simplified) + per-building WSE.
2. **Damage:** `depth_ft = WSE_ft − FFE_ft` (if FFE missing: ground elev + default by
   foundation/year, flagged estimated). `damage_pct = curve[occupancy][construction](depth)`
   from FEMA Hazus Flood depth-damage functions (store tables in `pipeline/config/ddf/` with citation;
   USACE go-consequences repo is a convenient machine-readable source — **verify** license).
   `damage_$ = damage_pct × BLDGREPVAL`.
3. **Roads:** OSMnx drive + walk graphs; edge elevation = min DEM along edge; closed when
   `WSE > elev`. For each stage compute travel time matrices from residential building nodes to
   candidate sites and hospitals (precomputed; store as sparse coverage sets).
4. **Residents:** block pop → residential buildings by `HTD_SQ_FT` share; households sampled from
   block-group ACS distributions with fixed seed (reproducible).
5. **Heat:** per-area OLS: `LST ~ canopy% + impervious% + roof_albedo_proxy`; report R² and RMSE;
   intervention deltas use fitted coefficients (cool roof uses albedo change).
6. **Optimal plan:** OR-Tools CP-SAT maximal covering with budget; per Build round.

## 4. AI estimates (Gemini, cached)

- **Roof color/material** from aerial chip (256 px) per building lacking OSM `roof:material`:
  schema `{roof_color: enum[dark,medium,light,white,green], roof_material: enum[asphalt_shingle,
  metal, membrane_flat, tile, green, unknown], confidence: 0..1}`.
- **Visible features** from street photo: `{raised_foundation: bool|null, culvert_visible: bool,
  curb_ramp: bool|null, confidence}`.
Store in `ai_estimates` with `estimated:true`, model name, prompt version. Real data overrides.

## 5. Location pack schema (`pipeline/out/<area>/pack.json` + tiles)

```
pack_version, built_at, area{id,name,bbox}, sources[] (dataset, url, date, license),
buildings.pmtiles      (id, height, construction, occupancy, year, ffe, roof, value_rep, flags)
stages/{i}.geojson     (inundation polygon per stage), stages.json (stage ft → road closures)
roads.json             (edge id → elevation, closure stage)
damage.parquet/json    (building id × stage → depth, damage_pct, damage_$)
coverage.json          (site id × stage → covered resident ids/weights)
residents.json         (synthetic households: building id, weight, attrs) — labeled simulated
heat/{lst, model}.json (H3 res-10 cells: lst_f, canopy, impervious)
truth/*.json           (HWMs, claims-by-tract, hottest cells)
rounds.json            (round bank, §6)
validation.json        (§ PLAN 9 metrics)
```

## 6. Round bank generation (`pipeline/rounds.py`)

For each area generate ~60 candidate rounds, score "interestingness" (variance in answers,
clue diversity, data confidence) and keep the best 30:
- Type A: pick buildings/blocks with high-confidence values; store `truth`, `tolerance`,
  `units`, `clues[]` (computed: e.g. `culvert_within_150m`, `pre_firm_year`, `manufactured`,
  `slab`, `hand_lt_1m`, `impervious_upstream_gt_40pct`, `canopy_lt_10pct`).
- Type B: truth point/area with scale `s`; clues as above.
- Type C: budget, candidate sites, precomputed optimal value and plan.
Each round stores a template explanation (fallback for the coach) built from its clues.

## 7. Database (Tiger Data / TimescaleDB + PostGIS)

```sql
CREATE TABLE gauge_readings (time timestamptz, lid text, stage_ft double precision,
  flow_kcfs double precision, flood_category text);
SELECT create_hypertable('gauge_readings','time');
CREATE TABLE guesses (time timestamptz, game_id uuid, round_id text, player_id uuid,
  area_id text, kind text, value double precision, geom geography(Point), score int,
  lenses int, ms_to_lock int);
SELECT create_hypertable('guesses','time');
CREATE TABLE plans (time timestamptz, game_id uuid, round_id text, player_id uuid,
  placements jsonb, value double precision, score int);
SELECT create_hypertable('plans','time');
CREATE TABLE intel (id uuid primary key, time timestamptz, area_id text, geom geography,
  category text, text_clean text, media_url text, badge text, upvotes int default 0);
-- continuous aggregates: leaderboard_daily, accuracy_by_round_index, crowd_attention_h3
```
No raw addresses, no PII anywhere in the database.
