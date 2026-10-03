# Progress

## Milestones
| # | Milestone | Status |
|---|---|---|
| M0 | Scaffold | ✅ done (approved) |
| M1 | Pipeline: fetch + buildings + people (Crabtree) | ✅ done (approved) |
| M2 | Flood model + damage + roads + validation | ✅ done (approved) |
| M3 | Solo game loop (Pin It + Read the Block) | ✅ done — awaiting OK |
| M4 | Multiplayer lobby + TV mode | — |
| M5 | Build round + materials | — |
| M6 | Field Guide, coach, Gemini | — |
| M7 | Tiger Data + live data + Planner View | — |
| M8 | Local Intel | — |
| M9 | Voice, domain, polish | — |
| M10 | Heat mode | — |
| M11 | Second area, Daily Challenge, share card | — |

## M0 acceptance results (2026-10-03)
- `npm run screenshots` (Playwright, headless Chromium/SwiftShader): **all checks passed** —
  pitch 55° at both sizes; terrain source `terrain-dem` with 1.4× exaggeration and elevation
  returned at center; 3D building layer present; Space Grotesk + Inter loaded; drag release at
  31°/−17°/−70°/160° snaps to 45/0/−90/180; Shift+→ advances exactly 45°; rotate button +45°;
  styled error state (basemap blocked) and loading state; no page errors.
- `npm test` (server, node:test): 8/8 pass. `uv run pytest`: 4/4 pass. `ruff check`: clean.
  `npm run typecheck`: clean. `npm run build`: OK. HTTPS (`HTTPS=1`) serves with self-signed cert.
- Screenshots: `screenshots/m0/` (phone 390×844, TV 1920×1080, TV rotated, phone error, phone loading).

## M1 acceptance results (2026-10-03)
- `python -m pipeline build crabtree --stage fetch,buildings,people` from cache: **5.0 s** (< 30 s). ✅
- Report: 20,701 buildings; FFE 100% (97.3% aerial-lidar derived, 2.7% measured);
  construction wood 68.6 / masonry 5.6 / concrete 4.7 / steel 0.9 / manufactured <0.1 /
  no data 20.3 %. ✅
- Residents 53,563 vs ACS area total 53,936 = **−0.69%** (±2%). ✅ (first run −2.71% failed; fixed
  with the approved census-housing inference, see METHODS §2.)
- No PID/owner field in any output: `test_privacy.py` scans every pack file incl. decompressed
  PMTiles tiles. ✅ pytest 27/27, ruff clean, server tests 8/8.
- Outputs: `pipeline/out/crabtree/{buildings.pmtiles (6.0 MB), buildings.meta.json, residents.json (1.5 MB)}`,
  each with `pack_version`, `built_at`, `sources[]`.

## M3 acceptance results (2026-10-03)
- Full 5-round solo game plays end to end in the browser at 390×844 and 1920×1080 —
  `npm run smoke` (Playwright: landing → 5 rounds incl. estimate + pin input, a lens, reveal
  sequence, source sheet, results; total = sum of round scores; no page errors). ✅
- Every number on Reveal (answer, score) opens a source sheet with dataset, date, method, link. ✅
- Scoring tests: pin, estimate, lens penalty, time bonus, cap, ties (`server/test/scoring.test.ts`);
  phase machine tests (`game.test.ts`); real Socket.IO solo game (`realtime.test.ts`). Server 26/26. ✅
- Screenshots of the reveal sequence and every screen in `screenshots/m3/`. ✅
- pytest 59/59 (round bank tests added); ruff clean; M0 + M2 visual checks still pass.
- Bugs found by the smoke test and fixed: full-screen UI containers swallowed map taps
  (`#ui > *` specificity); deck.gl reveal markers drawn under the 3D terrain (lifted to terrain
  height, drawn on top); map padding changes cancelled camera flights; BG rounds flew to an
  empty point on reveal.

## M2 acceptance results (2026-10-03)
- Outputs: `stages/{0..53}.geojson` (13 MB total, ≤ 331 KB each), `stages.json`, `damage.json`,
  `roads.json`, `coverage.json`, `validation.json`. ✅
- Unit tests: damage curves (known values, interpolation, clamping, class mapping), HAND
  inundation on a synthetic V-valley DEM (HAND values, wet width vs depth, monotonicity), depth
  scaling, backwater floor + pit gating, road closure / bridge deck / untagged-notch rules.
  pytest **54/54**; server **9/9**; ruff clean. ✅
- validation.json has numbers and METHODS.md §3–6 reports them, including the failures (mainstem
  bias, 20 ft NWS check 4.5 ft late, low-stage road artifacts). ✅
- `/debug/flood?area=crabtree`: stage slider raises water over 3D buildings (category-colored
  track, 1%/Matthew/Record chips, closed roads, building flood state). Playwright checks pass at
  390×844 and 1920×1080; screenshots in `screenshots/m2/`. ✅
- Rebuild `flood,damage,roads,validate` from cache: 56 s.

## Data verification log (M2)
| Source | Endpoint | Finding |
|---|---|---|
| 3DEP DEM | py3dep WMS | `ServiceUnavailableError`. Used the ImageServer `exportImage` REST endpoint (same 3DEP mosaic); 500 for one big export → tiled 1000 px. 1 m not available here; at 3 m the source is **NC statewide 2003 lidar**. |
| NHDPlus HR | pynhd | 352 flowlines, `totdasqkm` present. |
| FEMA NFHL | MapServer/28, /14 | Layer ids confirmed (28 zones, 14 cross-sections). Queries return **HTTP 500 unless** `geometryPrecision=6&maxAllowableOffset=0.00001`. 654 zones (AE 275, X 379 of which 357 are "1 PCT FUTURE CONDITIONS"), 125 XS all with WSEL_REG (ft NAVD88). |
| OpenFEMA claims | FimaNfipClaims v2 | Fields as DATA.md (+ waterDepth, censusBlockGroupFips — not used). 1,640 Wake claims (Fran 354, Matthew 124, Floyd 123, Florence 10). Aggregated by tract only. |
| NWPS | /gauges/ADRN7, /stageflow | Confirmed. Datum 186.5 ft NAVD88; categories 15/16/18/20; crests incl. Matthew 21.3 ft; 5 impact statements. `/stageflow` holds only ~30 days. |
| USGS STN HWMs | FilteredHWMs | **0 in Wake County** for Matthew/Florence/Michael → HWM backtest replaced (user decision). |
| Damage curves | USACE go-consequences | MIT license verified; RES1 = EGM 04-01 (Normal), others = USACE Galveston/HEC-FIA. |

## Data verification log (M1)
| Source | Endpoint | Finding |
|---|---|---|
| NC Risk Building Footprints | FeatureServer/0 | 200; maxRecordCount 2000; geoJSON + pagination OK; all DATA.md fields present **plus** FOUND_TYPE, NUM_STORY, LIDAR_LAG/HAG, BASMENT_TY, CONTREPVAL, NUM_UNITS. Coded values combine class + derivation + confidence. Sentinel −8888. FFE/LAG in **ft NAVD88** (checked vs USGS EPQS). Imagery 2009–2012; last edit 2021-01-05; no license stated. 20,701 in bbox. |
| Census Data API | api.census.gov/data/2023/acs/acs5 | **Now requires a key** (302 → missing_key.html). Decision: free key in `.env` `CENSUS_API_KEY`. |
| 2020 block population | TIGER2020 `tl_2020_37_tabblock20.zip` (348 MB) | Carries POP20/HOUSING20 → no API needed. Wake total 1,129,410 = official 2020. (County PL-layer file lacks POP20.) |
| Block groups | TIGER2023 `tl_2023_37_bg.zip` | Used 2023 (matches ACS vintage) instead of DATA.md's 2024; 597 BGs in Wake. |
| Overpass | overpass-api.de (+4 mirrors) | Needs a User-Agent (else 406). Host 162.55.144.139 refuses connections, 65.109.112.52 rate-limits (429/504); mirrors timed out/504/refused. Decision: **Geofabrik NC extract** (2026-10-02, md5-pinned) + osmium. Culvert count matches the live Overpass count (93). |
| Overture | overturemaps-py | Release 2026-09-23.1; 23,005 buildings, 12,552 with height. |

## Decisions
- **Repo layout:** kit moved to root (`CLAUDE.md`, `docs/`); kit README kept as
  `docs/KIT_README.md`; duplicate root `PLAN.md` removed; `git init`.
- **Scoring cap** (open question, my default pending your answer): time bonus applies but the
  round score is capped at 5,000.
- **Players vs colors** (default pending): extend to 12 color+shape pairs (4 to be added to
  tokens in M4, CB-checked); until then cap at 8.
- **Heat wording** (default pending): Landsat overpass is ~10:30–11:00 local, so heat questions
  say "late morning on a clear July day", not "3 PM".
- **Pin scale** (default pending): `s = round-square diagonal / 10` (~280 m for 2 km), not the
  whole area.
- **Python:** pinned 3.12 via uv (`.python-version`); system Python 3.14 lacks wheels for
  some geo libs. `pyproject.toml` lives at repo root so `python -m pipeline` works from root
  (the M0 prompt said "pipeline/ … pyproject"; package code is in `pipeline/`).
- **Node:** `engines >=22`; developing on Node 24.
- **Basemap style:** OpenFreeMap liberty fetched at runtime and recolored from `tokens.css`
  (no hardcoded colors in TS); transit/minor POI labels and one-way arrows hidden. Land =
  `--map-grass` mixed 55% toward `--paper` (pure grass everywhere was unreadable); parks use
  pure `--map-grass`.
- **Bearing snap:** pointer gestures snap to nearest 45° on release; keyboard rotation
  (MapLibre's 15° steps) snaps onward in the pressed direction (otherwise it could never leave 0°).
- **Dev join links:** Vite proxy keeps the Host header so `/api/info` and QR codes use the
  dev port (5173) on the LAN address.
- **Fonts** bundled via @fontsource (works offline on demo day) instead of Google Fonts.

- **Flood validation:** FEMA cross-section WSE + NWS impact statements replace the USGS HWM
  backtest (user decision). Demo "Pin It" round uses Matthew 2016 at the real gauge crest, not
  Florence (Florence isn't among ADRN7's top crests and has 10 Wake claims).
- **1% scenario stage** = FEMA XS WSEL nearest the gauge − datum = 22.7 ft; that XS is excluded
  from validation.
- **Model fixes found by validation (all physically motivated, none tuned to FEMA):**
  backwater floor (bias −1.77 → +0.24 ft), bridges kept as separate graph edges + deck rule
  (Anderson Dr bridge closure 15 ft → 24.5 ft vs NWS 24), untagged-crossing notch rule,
  pit gating / effective ground (closures at 4 ft: 21 → 5).
- **Bug fixed:** road samples were paired with the wrong edge geometry (projected graph
  reorders edges).
- **Depth scoring tolerance** = median WSE error (3.15 ft), stored in validation.json.

- **Round bank:** truths below the NWS action stage excluded (validation showed low-stage
  artifacts); depth tolerance = validation median WSE error; ACS MOE fetched for the no-car
  tolerance; explanations name Field Guide cards; "paved upstream" clue deferred to NLCD (M10).
- **Phase machine** is deterministic (`tick(room, now)`), 200 ms server ticker; truth never
  leaves the server before the reveal (tested).
- **Landing:** "Play with friends" / "Daily Challenge" shown disabled with a "Soon" pill until
  M4/M11; landing orbit pauses on user input and is off under reduced motion.
- **Mapillary** thumbnails are cached into the pack (signed URLs expire); whole-area bbox
  queries return 500, so the pipeline queries ~300 m boxes.

## Reused code (pocket-rivals, MIT, © 2026 Pocket Rivals contributors)
| Our file | Source | How |
|---|---|---|
| `server/src/tls.ts` | `server/tls.js` | Ported to TS; selfsigned v5 option `days` → `notAfterDate` (v5 has no `days`) |
| `server/src/net.ts` | `server/index.js` (`lanAddresses`, `publicBase`) | Ported to TS; join URL is `/r/CODE`; keeps request port |
| `server/src/index.ts` | `server/index.js` (HTTP/HTTPS start, banner, Socket.IO setup) | Ported to TS, typed events |
| `server/src/rooms.ts` | `server/rooms.js` | Ported to TS: code alphabet, secret player ids, per-viewer state, TTL sweep; game state replaced |
| `server/src/realtime.ts` | `server/index.js` (socket handlers) | Pattern: `on()` wrapper → ack({error}) for GameError, attach/resume, per-player broadcast |
| `server/src/game.ts` | `server/game.js` | Pattern only: sync actions + phase advance; new phases (brief/play/reveal/results) and timer `tick` |
| `server/test/*.test.ts` | `test/game.test.js` | Test approach: drive phases directly with `node:test` |

Still to port per instructions: `server/ai.js` Gemini plumbing (M6), `public/voice.js` +
`public/camera.js` (M8), `public/audio.js` synth engine + `public/fx.js` (M9).

- **OSM source:** Geofabrik extract instead of Overpass (user decision, see log). Drive/walk
  graphs use OSMnx's own Overpass network filters applied locally (tested).
- **Census key:** `CENSUS_API_KEY` in `.env` (user decision); the pipeline reads `.env` itself.
- **Fetch stage is idempotent:** each step skips when its work parquet exists; `--refresh`
  re-derives from the HTTP cache; deleting `pipeline/cache/` refetches.
- **Lint:** E501 disabled in ruff lint; `ruff format` enforces width.
- **Buildings missing from NC inventory** are rendered (height only, flagged). Residential
  class comes from OSM `building=` tags (approved), or from the census-housing inference
  (approved, 56 footprints, labeled `inferred`). No other attributes are invented.
- **Mapillary** token verified (200; fields id, thumb_1024_url, computed_geometry, captured_at).

## Open issues
- 19.7% of NC buildings have no height source; client must render them with a visible
  "height: no data" default (decide in M3).
- Inferred-residential ids live in `residents.json`; the M5 building inspector must show
  their "inferred" label (they aren't in the tile properties).
- Coach is the template explanation until Gemini (M6); Field Guide stamp arrives in M6.
- Round bank has 1 claims round only (few tracts beat the 1.5× rule); 29 rounds total.
- Client bundle still unsplit (~1.5 MB); lens GeoJSON up to 915 KB (lazy, gzip ~5×).
- 373 residents remain unplaced (blocks with no footprint ≥ 60 m²).
- Flood model: mainstem +3.1 ft bias over impoundment pools; tributary −1.8 ft; 20 ft NWS
  "homes flood" check 4.5 ft late (FFE uncertainty). Possible later improvement: synthetic
  rating curves (Manning) per reach instead of drainage-area scaling.
- 16 directed road edges close at ≤ 6 ft (artifacts at crossings the notch rule misses).
- Large commercial buildings near Wake Forest Rd show damage from the action stage (15 ft);
  partly the mainstem bias. Watch for this in round selection (M3): prefer high-confidence rounds.
- Contradictions 1–4 above use my defaults until you confirm.
- Roof-cap colors and deck.gl sun shadows need a building-rendering decision before M3/M10
  (MapLibre fill-extrusion can't color roofs separately; deck shadows only fall on deck layers).
- Bus-stop icons from OSM `poi_r1` still appear at high zoom; filter by class in the M9 polish pass.
- Client bundle is 1.45 MB (404 KB gzip), mostly MapLibre + deck.gl; code-split in M9.
- `tippecanoe` and WhiteboxTools not installed yet (needed M1/M2).
- Correctness risks to address in M2: gauge datum → HAND stage conversion; bridges in a
  bare-earth DEM; few/no Florence HWMs in the Crabtree bbox.
