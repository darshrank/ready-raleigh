# Methods

Plain-language description of every model in Ready Raleigh: inputs, formula, assumptions,
limitations and validation. Written as each model is implemented. Numbers below are for the
`crabtree` area (bbox −78.70, 35.80, −78.60, 35.85) unless stated.

---

## 1. Building inventory (M1)

**Inputs**
- **NC Risk Building Footprints** (NC Emergency Management), the only source of construction,
  occupancy, foundation, year built, replacement value and first-floor elevation (FFE).
  Footprints were digitized from 2009–2012 orthoimagery and the service was last edited 2021-01-05.
- **Overture Maps buildings** (release 2026-09-23.1) and **OpenStreetMap** (Geofabrik snapshot
  2026-10-02), used only for heights, roof tags and to find buildings the NC inventory lacks.

**Method**
1. Query all NC footprints intersecting the area (20,701). Parcel IDs (`PID`) are never requested.
2. Decode coded values from the layer's own metadata. Each code carries the class and how it
   was derived, e.g. `3040` = "WOOD – HAZUS DERIVED". We keep both, so the UI can show
   "construction: wood (Hazus-derived)" rather than presenting a derived value as observed.
3. Units: FFE and lowest adjacent grade are **feet NAVD88**. We verified this against USGS 3DEP
   point elevations (EPQS) for 5 random buildings: lowest adjacent grade sits 2–10 ft below the
   3DEP ground value and FFE sits above it in every case. Values are stored in meters internally
   and shown in feet.
4. Missing values (`-8888`, `NOT PROVIDED`) stay empty. Nothing is filled in.
5. **Height**, in priority order:
   1. OSM `height` tag;
   2. Overture `height`;
   3. OSM `building:levels` × 3 m;
   4. NC number of stories × 3 m.

   An OSM or Overture footprint is matched to an NC footprint when their intersection is
   ≥ 30% of the smaller footprint. The source is stored per building (`height_src`).

**Coverage (crabtree)**

| Measure | Value |
|---|---|
| Buildings | 20,701 |
| With FFE | 100%, but 97.3% are *aerial-lidar derived* (lowest adjacent grade + offset); only 2.7% were measured (laser inclinometer 2.7%, survey < 0.1%) |
| Construction | wood 68.6%, masonry 5.6%, concrete 4.7%, steel 0.9%, manufactured < 0.1%, **no data 20.3%** |
| With occupancy/value/year | 79.7% (the 20.3% without are mostly outbuildings with no parcel match) |
| Height source | Overture 58.8%, NC stories 21.3%, OSM levels 0.1%, **none 19.7%** |
| Roof material/colour (OSM) | 0%, so roof colours will come from labeled AI estimates (M6) |
| Footprints in Overture but not NC | 2,948, likely built after the 2009–2012 imagery; rendered with a "no NC record" flag and no attributes |

**Limitations**
- The inventory is a 2009–2012 snapshot; newer buildings have geometry and height only.
- Construction and occupancy for most buildings are Hazus- or parcel-derived, not field-verified.
- The 3 m story height is a convention, not a measurement. It applies only where no measured
  height exists, and is labeled.

## 2. Synthetic residents (M1)

Residents are **simulated**: no real person is represented, and the product always says so.

**Inputs**
- ACS 2019–2023 5-year estimates by block group: total population (B01003), age (B01001),
  vehicles available (B25044), poverty ratio (C17002), limited-English households (C16002).
- 2020 Census block population (`POP20` in TIGER/Line 2020 blocks). Wake County total is
  1,129,410, matching the official 2020 count.
- Residential buildings from §1: Hazus classes RES1 (single-family), RES2 (manufactured),
  RES3 (multi-family), RES5 (group quarters) and RES6 (nursing homes). RES4 (hotels) is excluded.
- Footprints missing from the NC inventory, classified as residential in two ways, each
  labeled with how it was classified:
  - **OSM tag:** `building=house/detached/semidetached_house/bungalow` → RES1;
    `apartments/residential/terrace` → RES3; `dormitory` → RES5 (114 footprints).
  - **Census-housing inference:** in a block where the 2020 census records housing units
    (`HOUSING20 > 0`) but our inventory has no residential building, footprints with no use
    record and ≥ 60 m² (excludes sheds) are treated as RES3. Each is labeled "inferred: census
    block has N housing units" and listed in `residents.json` (56 footprints). Real occupancy
    data always wins: only footprints with no use record qualify. Floor area is estimated as
    footprint × floors.

**Method**
1. **Area target per block group** = ACS population × (share of the block group's 2020
   population living in blocks whose representative point is inside the area).
2. Split each block group's target across its in-area blocks by 2020 block population. Then
   split each block's share across its residential buildings by heated square feet (footprint ×
   stories when square feet is missing, counted in the report). All splits use largest-remainder
   integer allocation, so totals are exact and deterministic.
3. Give each simulated person four attributes, each drawn independently with the block group's
   rate:
   - age 65+ = B01001 65+ / total;
   - no vehicle = households with none / all households (B25044);
   - below poverty = income-to-poverty ratio < 1.0 (C17002);
   - limited English = limited-English-speaking households / all households (C16002).

   The RNG seed is fixed per area (`seed` in the area file), so builds are reproducible.
4. **Vulnerability weight** = 1.0 + 0.5 (65+) + 0.5 (no vehicle) + 0.5 (below poverty) + 0.25
   (limited English), from `pipeline/config/vulnerability.yaml` (PLAN.md §5).

**Assumptions and limitations**
- Attributes are independent within a block group. Real correlations (e.g. older households
  having fewer cars) are not modeled, so individual combinations are illustrative and only
  aggregates are meaningful.
- Household-universe rates (vehicles, language) are applied to persons.
- Block population is from 2020, while ACS totals describe 2019–2023. Blocks only set *where*
  inside a block group people go.
- People in blocks with no residential building in the 2009–2012 inventory cannot be placed;
  the number is reported as `unplaced_no_residential_building`.

**Validation (acceptance: residents placed within ±2% of the ACS area total)**

| | Value |
|---|---|
| ACS area target (44 block groups, 695 in-area blocks) | 53,936 |
| Placed, NC + OSM-tagged buildings only | 52,475 (**−2.71%**, failed) |
| Placed, adding the census-housing inference | **53,563 (−0.69%, passes)** |
| Still unplaced (blocks with no qualifying footprint) | 373 |
| Mean rates among simulated residents | 65+ 16.4%, no vehicle 4.3%, below poverty 5.9%, limited-English household 0.9% |

The first run failed because 26 blocks holding 2,839 people (2020) are post-2012 apartment
complexes. They appear only as untagged Overture footprints; for example, block
371830526022010 has 633 residents and 498 housing units but no NC building. The inference rule
was added for exactly this case.

## 3. Flood inundation — HAND (M2)

**Inputs**
- **DEM:** USGS 3DEP, 3 m, from the 3DEPElevation ImageServer. Here it is sourced from the
  **NC statewide 2003 lidar**; no newer 1 m 3DEP covers this area. The area is buffered by
  1.5 km so drainage at the edges is resolved.
- **Streams:** NHDPlus High Resolution flowlines (352, with total drainage area).
- **Gauge:** NOAA NWPS ADRN7, Crabtree Creek at Anderson Drive. Gauge datum 186.5 ft NAVD88;
  flood categories action 15 / minor 16 / moderate 18 / major 20 ft; record crest 23.1 ft
  (1996-09-06).

**Method**
1. **Hydro-conditioning** (WhiteboxTools): burn NHD streams 5 m into the DEM, breach
   depressions (least-cost, remainder filled), compute D8 flow directions.
2. **HAND**: every stream cell is a pour point, and each cell is labeled with the stream cell
   it drains to. HAND = cell elevation − channel elevation of that stream cell. Channel
   elevation is the lowest *unburned* DEM value within 2 cells (6 m) of the mapped line,
   because NHD lines sit a few metres off the lidar channel.
3. **Gauge → depth.** The water surface at the gauge is stage + 186.5 ft. Depth above the
   channel there is d_g = WSE − 190.1 ft, where 190.1 ft is the channel elevation at the gauge
   (the 2003 lidar's water surface, about a 3.6 ft stage).
4. **Depth on every reach**: d = d_g × (A / A_gauge)^0.3, where A is NHDPlus drainage area.
   This uses hydraulic geometry: depth ∝ Q^0.4 (Leopold & Maddock) and Q ∝ A^0.75.
5. **Backwater**: a tributary's water surface can't be lower than the receiving stream's at
   the confluence, so a flat-pool floor is propagated up the NHD network. The floor applies
   only to cells above the junction's base-flow water surface; lower cells are pits
   (storm-drain inlets, notches) that the pool can't reach.
6. A cell is **wet** when WSE > max(DEM, channel). Cells below their channel are treated as
   channel level, consistent with HAND being clamped at 0.
7. **Stages**: 0–25 ft in 0.5 ft steps, plus three exact scenarios:
   - 1% flood, **22.7 ft**: FEMA's regulatory 1% water elevation at the cross-section 90 m
     from the gauge (209.2 ft) minus the gauge datum.
   - Hurricane Matthew crest, 21.3 ft.
   - Record crest, 23.1 ft.

   That's 54 stages, each written as a simplified wet-area polygon.

**Limitations**
- No hydraulic routing. Water surface follows the channel profile at a scaled depth, so
  impoundment pools on Crabtree Creek (the 2003 lidar shows ~12 ft steps where the water
  surface is flat) get too much water. This is the main source of the mainstem's +3.1 ft bias.
- No storm-drain or pipe modeling. Flash flooding on small streams is tied to the Crabtree
  gauge through drainage-area scaling, not to local rainfall.
- 2003 terrain: fill placed since then is missing. The DEM reads a median 1.9 ft (p10 0.4,
  p90 5.0 ft) above the NC building lowest-adjacent-grade values from newer lidar.

## 4. Building damage (M2)

- For each building, take the footprint cell with the **lowest HAND** (water reaches it
  first). At each stage, if that cell is wet, depth above the first floor = WSE − FFE (NC
  Risk, ft NAVD88).
- **Damage %** comes from USACE go-consequences depth-damage functions (MIT; Hazus-library
  curves), keyed by occupancy, number of stories and basement:
  - single-family homes (RES1): USACE EGM 04-01 curves, reported as mean with a ±1 sd range;
  - other classes: USACE Galveston District curves (deterministic).
- **Damage $** = damage % × NC Risk building replacement value. Where the value is missing,
  damage $ is left empty, not filled. Contents are not included.
- Unit tests check curve values read from the file (e.g. RES1 1-story, no basement, 4 ft →
  47.1%), interpolation, clamping and class mapping.

| Scenario | Buildings with water above the floor | Modeled structure damage |
|---|---|---|
| Matthew 2016 (21.3 ft) | 56 | $53.4 M |
| 1% flood (22.7 ft) | 92 | $64.5 M |

**Limitation:** 97% of first-floor elevations are aerial-lidar estimates, not surveys
(see §1), so depth above the floor inherits that error on top of the water-surface error.

## 5. Roads and shelter coverage (M2)

- **Roads**: the OSMnx drive graph (bridges and tunnels kept as their own edges), sampled
  every 6 m against the DEM. An edge **closes** at the first stage where water is more than
  0.5 ft over any sample (NWS: 6 in of moving water can stall a car).
- **Bridges**: a bare-earth DEM has no bridge deck; it shows the creek bed.
  - *OSM-tagged bridges* use the higher abutment elevation as the deck.
  - *Untagged crossings*: where a road crosses an NHD stream and its profile within 30 m dips
    more than 1 m below both approaches (30–60 m away), the dip is treated as a structure with
    deck = the lower approach. This applies to 119 directed edges. Smooth embankments over
    culverts show no dip and are unaffected (unit-tested).
- **Coverage**: 56 candidate sites, OSM amenities (schools, places of worship, community
  centres, hospitals, fire stations). For each stage, closed edges are removed and a drive-time
  search (Dijkstra, OSMnx speeds) finds the road nodes within 15 min of each site, going from
  residents to the site. A site also stops counting once its own location is wet. Stored as
  the stage at which each node loses access.

## 6. Validation (M2)

**There is no high-water-mark backtest.** USGS STN has **0** high-water marks in Wake County
for Matthew (267 statewide), Florence (462) or Michael (0). Approved replacement:

| Check | Result |
|---|---|
| **Water elevation vs FEMA 1% cross-sections** (N = 124; the one used to set the 1% stage is excluded) | median abs. error **3.15 ft**, 90th pct **7.62 ft**, median bias +0.24 ft |
| — Crabtree mainstem (N = 33) | 3.12 ft median, bias **+3.12 ft** (pools, see §3) |
| — tributaries (N = 91) | 3.16 ft median, bias **−1.82 ft** |
| **1% extent vs FEMA Zone AE** (3 m cells in the play area) | IoU **0.66**; the model covers 84.1% of the FEMA area; 75.0% of the model's area is inside FEMA |
| **NWS impact statements, ADRN7** | 16 ft "water reaches lowest homes on Claremont": model 16.5 ✓ · 18 ft "lowest sections of Claremont Dr": model 17.5 ✓ · 24 ft "Anderson Dr bridge submerged": model 24.5 ✓ · 20 ft "lower homes on Claremont flood": model 24.5 (water above the first floor), **4.5 ft late** |
| **1% damage vs NFIP claims by tract** (23 tracts, all years) | Spearman ρ = **0.47** (p = 0.02) vs claim count; **0.51** (p = 0.01) vs building $ paid |
| Road edges closed below the NWS action stage (artifacts) | 5 at 4 ft and 16 at 6 ft, of 5,662 directed edges |

**Notes**
- **20 ft check:** the miss is in first-floor elevation, not water extent (the 16 ft "water
  reaches the homes" check passes). Either the lidar-derived FFEs are too high, or NWS's
  "floods" means water at the homes rather than above the floor.
- **FEMA 1% zone:** NC maps a *future-conditions* 1% floodplain as shaded Zone X. It's
  excluded; only current-conditions AE is compared.
- **Scoring:** the median water-elevation error, **3.15 ft**, becomes the scoring tolerance
  for depth estimates (PLAN §5: tolerance comes from data uncertainty).

## 7. Scoring (M3) — `server/src/scoring.ts`

Everything here is deterministic code; no AI is involved. Unit tests cover pin and estimate
scoring, lens penalty, time bonus, the cap and ties.

**Score formulas**
- **Pin:** 5000 · exp(−d / s), where d = great-circle metres (haversine) to the nearest truth
  point. Some rounds have tied answers, which give several truth points.
- **Estimate:** 5000 · exp(−|guess − truth| / s).

**Tolerance `s`** comes from data uncertainty, as PLAN §5 asks:

| Round | s | Basis |
|---|---|---|
| Depth above the first floor | **3.15 ft** | The model's median water-elevation error against FEMA cross-sections (§6) |
| Share of households with no car | **The block group's ACS 90% margin of error** (minimum 3 points) | Standard Census proportion margin-of-error formula |
| Pin rounds | **283 m** | The 2 km round square's diagonal / 10 |
| Claims round (tract-level truth) | **Half the tract's width**, if larger than 283 m | Widened for tract-level truth |

**Adjustments**
- **Lenses:** × 0.9 for each distinct lens used.
- **Time bonus:** up to +5%, falling linearly from lock-in at 0 s to lock-in at one third of
  the timer.
- **Cap:** the round score never exceeds **5,000** (decision logged in PROGRESS).
- **Ties:** equal totals are broken by the earlier total lock-in time.

## 8. Round bank (M3) — `pipeline/rounds.py`

**Candidates**
- Questions are generated on 2 km squares placed on a 1 km grid inside the area (124
  candidates for Crabtree). Each candidate is scored for "interestingness" from data
  confidence, spread between answers and number of clues.
- The best 15 per type are kept, with no repeated answer feature and kinds spread out:
  29 rounds in total.

**Round types**

| Type | Question | Answer (truth) |
|---|---|---|
| A | Depth above the first floor in the 1% flood | Damage table at the 1% stage. Kept only for buildings with 0.5–10 ft of water that first flood at or above the NWS action stage (15 ft), avoiding the low-stage artifacts in §6. Rounds with a measured FFE rank higher. |
| A | Share of households with no car in the highlighted block group | ACS B25044. Kept only if there are ≥ 150 households and the margin of error is < 12 points. |
| B | First building to get water inside past action stage | Earliest floor-wet stage in the square. Ties within 0.25 ft count as several truth points. |
| B | First road to go under past action stage | Earliest closing road edge in the square; skipped if more than 2 road names tie. |
| B | Most flood insurance claims | The tract with the most NFIP claims, at least 1.5× the next tract nearby. |

**Clues** are computed from data and named after Field Guide cards:
- Creek + low bowl: less than 5 ft above the creek and within 150 m of it.
- Culvert under road: an OSM culvert within 150 m.
- One road out: the building's road node is behind a single road link that closes by the 1% stage.
- Manufactured home in floodplain.
- Slab vs raised foundation: slab-on-grade or basement.
- Big watershed upstream: more than 100 km² drains through.
- No-car households: 10% or more of households.

"Paved upstream" waits for NLCD impervious data (M10). Each round's template explanation is
its fact plus its clues; the Gemini coach (M6) will fall back to it.

**Street photos:** Mapillary, the nearest non-panorama image within ~150 m, downloaded into
the pack and credited on screen (CC BY-SA 4.0); 20 of 29 rounds have one.

**Lens layers** (in the pack):
- Elevation: height-above-creek bands < 3, 3–6 and 6–10 ft, on a 9 m grid.
- Water: NHD streams, OSM culverts, FEMA AE and future-conditions zones.
- Surface: OSM parking lots; NLCD impervious data comes in M10.
- People: block-group ACS rates with the same vulnerability weights as residents (§2).

---

## Rendering only (not a model)
- **Terrain in the 3D view** uses AWS Terrain Tiles (Terrarium, zoom ≤ 15, ~4.8 m/px) with
  1.4× vertical exaggeration for readability. These tiles are **for display only**; flood
  modeling will use USGS 3DEP DEMs.
