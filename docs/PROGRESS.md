# Progress

Agents: tick items when done and verified. Mark in-progress items with your agent name and lane,
for example `[~] (Claude, C)`. Add a handoff entry at the bottom at the end of every session.

## Phase 0: setup
- [x] P1 Monorepo scaffold, workspaces, fixtures, dev script (lane B/C)

## Phase 1: flood mode end to end
- [x] P2 Pipeline: study area, cells, census joins (A)
- [x] P3 Pipeline: roads graph, flood steps, sites, coverage, flood roads, hospitals, halftone dots (A)
- [x] P4 Engine: types, config, coverage, scoring, optimizer, tests (B)
- [x] Flood realism and balance: bridge exemptions, fractional exposure, 10k shelter capacity, shared attribution/timeline totals (A+B; staged data requires C adoption)
- [x] P5 Design tokens and map shell with layers (C)
- [x] P6 Planning phase: tray, placing, budget, timer, instant coverage (C)
- [~] P7 Simulation: halftone flood, closing roads, trips, counters (C + B). Pass 1 done (Claude, C); pass 2 = road routing
- [x] V1 Visual overhaul: title and briefing, game HUD, realistic water, night storm with helicopter camera, daylight end (C)
- [ ] P8 Results screen with score breakdown and optimal plan side by side (C)
- [~] P9 Rooms: (aum) done: lobby + QR, mayoral candidates, any player hosts, shared clock, storm starts together, ranked results stored in Tiger Data. Open: crowd heatmap, perception gap

## Phase 2: heatwave
- [ ] P10 Pipeline heat and trees, engine heat scoring, heat UI (A + B + C)

## Phase 3: planner
- [~] P11 Tiger Data storage and planner dashboard (D + C). Lane D done (Claude, D); /planner page (C) next

## Phase 4: bonus challenges
- [ ] P12 Gemini briefing and debrief (D)
- [ ] P13 ElevenLabs broadcast and narration (D)
- [ ] P14 GoDaddy domain and deploy (any)
- [~] P15 Live mode: USGS gauges and NWS weather into Tiger Data (D). Server done (Claude, D); title-screen live line (C) next
- [ ] P16 Solana plan record (D)

## Phase 5: demo
- [ ] P17 Demo hardening, offline fallback, seed data, Devpost

## Handoff log
<!-- Newest first. Template:

### 2026-10-03 18:40 (machine clock) Claude (Opus 5.5) for Aum, lane D + C, P9 rooms (branch feat/multiplayer)
- Story: every player is a mayoral candidate. Gameplay is the solo game unchanged; rooms only add
  the lobby, a shared planning clock, a storm that starts for everyone at once, and the ranking.
- No central screen (Among Us style): anyone taps "Host a game" on the landing page and becomes
  player 1 with host controls (Start the election, Next election); others scan the QR code shown
  on any lobby screen, or type the code. Host passes to the next connected player if the host leaves.
- Server: server/src/rooms.ts (state machine: lobby -> planning -> results, pure, tested),
  server/src/roomSocket.ts (raw `ws` on /ws/rooms/:code, replaces the P1 echo), server/src/net.ts
  (LAN address), GET /api/join-base. Locked plans go through buildPlay (same checks + score as
  POST /api/plays) and store.savePlay, so room games land in Tiger Data `plays` with the new
  nullable `candidate` column. Room logic ported from the aum branch (pocket-rivals pattern).
- Protocol: shared/src/room.ts (look, join{create}, resume, pick, start, lock, again; state,
  joined, error). Candidates: shared CANDIDATES = 16 Open Peeps busts (CC0) in
  app/public/candidates/, built by app/scripts/candidates.mjs (black -> var(--ink), white ->
  var(--bond); inlined so the tokens apply).
- App: routes/Play.tsx (join + candidate picker, lobby with Invite QR, waiting plate, results
  footer with the ranking); routes/Host.tsx removed (/host/:code opens Play); Solo.tsx takes an
  optional `room` (no title, server deadline, "Start the storm" sends the plan and waits);
  store.ts: phase 'waiting', `hold`, `startStorm()`; ResultsCard `footer`; vite `host: true`.
- Verified: npm test 51/51 (rooms.test.ts: logic, host-only actions, host hand-off, look, a real
  socket game with resume and Tiger-store write); typecheck; browser run with 3 phones (host from
  the landing page, join by QR link and by code, reload resumes, two wait while one plans, storm
  starts on all three within 52 ms, ranked results, Next election); solo unchanged.
- Next exact step: crowd heatmap and perception gap on the results (rankPlanner with this room's
  plays); maybe a "room" filter on GET /api/planner.
- Gotchas: rooms live in server memory (a server restart ends them; plays are already stored).
  Phones on Wi-Fi need `npm run dev` to expose Vite (host: true is set) and PUBLIC_URL for a tunnel.

### [time] [agent] [lane] [task id]
- Done:
- Half done:
- Next exact step:
- Gotchas:
-->

### 2026-10-04 Claude (Opus 5.5) lanes B+C, playtest fixes: bus seat reserve, useful roads
- Done: 10% bus seat reserve per shelter (riders most vulnerable first), useless roads hidden
  (usefulRoads in plan/targets.ts), green dots explained, bigger stop markers, optimal plan rebuilt.
- Verified: 70/71 tests (only the bench timeout); 5,000 random monotonicity trials; the playtest
  case (shelter + new stop in Thornton Commons) now adds 56 residents instead of 0.
- Next: tune BUS_SEAT_SHARE after more playtests; consider fading green dots that existing
  shelters already cover.

### 2026-10-03 22:40 EDT Claude (Opus 5.5) lanes A+B+C+D, existing shelters, stop pickups, less clutter
- Done: existing_shelters.json (FEMA NSS, npm run shelters), transit_stops.json now has stop ids.
  Engine: existing shelters as baseline, score = share of the gap, split seating, stop pickups
  ($0.5M), bus cells only, faster optimizer. Server: stopId through plays/planner/demand
  (report names the existing stop players chose). App: contextual targets (sites only while a
  shelter is armed, bus area + stops while a bus is armed), existing shelter markers everywhere,
  bus -> shelter link lines, HUD "covered of M at risk" after existing shelters, results text,
  legend, storm residents also go to existing shelters.
- Verified: typecheck all; 70/71 tests (only the old bench timeout). In the app: clean board,
  shelter mode, bus mode (yellow area + stops), stop pickup at $0.5M, a bus adding 114 residents
  once shelters have seats, link line drawn, storm with 273 dots to existing shelters; 390 px.
- Next: the shelter-armed view still shows ~200 dry sites; size or fade them by how many people
  they would add. P8 results could list bus routes ("N rode from <stop> to <shelter>").
- Gotchas: re-run npm run shelters after the pipeline rebuilds roads_graph.json or cells.json
  (catchments use cell indices). score() needs existing_shelters.json in the data folder to match
  the app; fixtures have none (baseline 0).

### 2026-10-03 20:55 EDT Claude (Opus 5.5) lanes A+D+C, bus pickup demand report for planners
- Done: pipeline/transit.py + app/public/data/transit_stops.json (GoRaleigh 2024 feed, flagged
  expired; GoTriangle current). server/src/demand.ts (report, CSV, GeoJSON), store.pickups() on
  memory and Tiger (placements join plays), transit_stops table, GET /api/planner/bus-demand.
  app: solo games POST to /api/plays (app/src/api.ts), /planner panel + map hexagons
  (app/src/planner/BusDemand.tsx).
- Verified live on Tiger: 13 test plays (8 players) -> 2 areas shown, 1 hidden; Dacian Valley:
  6 players, 109 households with no car (46 in flood risk), nearest stop 500 m -> gap. CSV and
  GeoJSON download. /planner checked at desktop and 390 px. Test plays deleted. 64/65 tests
  (only the old bench timeout).
- Next: Gemini summary in place of the template (P12); same report for shelters and roads; a
  "why here?" tap after placing a piece; show planners the crowd ranking from GET /api/planner too.
- Gotchas: the report needs real plays from at least 5 different people per area; with few
  testers use ?minPlayers=3. A newer GoRaleigh GTFS URL can replace FEEDS[0] in pipeline/transit.py.

### 2026-10-03 19:45 EDT Claude (Opus 5.5) lanes B+C (+D planner text), flood evacuation chain
- Done: shared/src/engine/coverage.ts reworked (see DECISIONS "Evacuation chain"): bus pickups feed
  shelters and share their seats (drivers first), roads save whole dry cut-off blocks, shelters are
  the destination. optimizer.ts keeps bus candidates; fast bus-pass gains. missReason explains a
  bus with no shelter room. Tests: new "evacuation chain" block in balance.test.ts, updated bus test.
- Done (app): storm riders walk to the stop then ride to their shelter (sim.ts Residents.via/board,
  layers.ts two-leg move + 3-point trails); drivers use the engine's seat (shelterOf). HUD preview
  for a bus with no shelter: "A bus needs somewhere to go: place a shelter first." Piece text:
  "Takes households with no car to a shelter". Planner (server) values bus spots with the best plan's shelters.
- Done (data): app/public/data/optimal_flood.json regenerated (3 shelters + bus 5468, 76.3).
- Verified: typecheck all; 59/60 tests (only the old bench timeout). In the app (/solo?skip): a bus
  alone covers 0; plus the 3 optimal shelters covers 28,382 (= engine); storm builds with riders and
  runs. Screenshot of the storm checked.
- Not done: app/public/data/fixtures/optimal_flood.json is still the P4 file (the optimize script
  refuses the fixture: over 20% at risk). Riders are few on real data (no-car weight ~4%).
- Next: decide whether to raise NO_CAR_HH_WEIGHT so buses matter more; P8 results could show
  "N residents rode the bus to <shelter>" using protectorOf(...).via.

### 2026-10-03 18:45 EDT Claude (Opus 5.5) lane D, P15 live feeds (server)
- Done: server/src/live/ (sources.ts fetchers + pure parsers, store.ts Tiger/memory/failSoftLive,
  summary.ts, job.ts). Schema: `gauges` table and `gauge_hourly` continuous aggregate.
  GET /api/live/gauges -> `{store, updatedAt, stale, headline, gauges[], weather}`; each gauge has
  site, name, lon/lat, stageFt, flowCfs, trend rising|falling|steady, change1hFt, flood stages,
  category none|action|minor|moderate|major, belowFloodFt. GET /api/live/gauges/:site?hours=48 ->
  hourly rows from gauge_hourly (use %2F for the '/' in an nws grid id).
- Verified live: 27 USGS gauges, 75,145 readings (7 days) into Tiger in 18 s; 20 gauges have NOAA
  flood stages; KRDU temperature and the RAH grid rain forecast stored. Headline at 18:40 EDT:
  "Walnut Creek at Rose Lane at Raleigh, NC: 6.2 ft and rising, 3.9 ft below flood stage."
  Summary endpoint ~0.5 s. 14 server tests pass (parsers on trimmed real responses, summary, routes).
- Next exact step (lane C): show `headline` and `weather.rainNext24hMm` on the title screen from
  GET /api/live/gauges (hide it when the request fails or `stale` is true); optional gauge dots on
  the map coloured by `category`, with a sparkline from /api/live/gauges/:site.
- Gotchas: the first poll after a server start takes ~20 s (backfill); until then the endpoint
  returns what Tiger already has. Set LIVE_FEEDS=false to keep tests and offline demos quiet.

### 2026-10-03 18:20 EDT Claude (Opus 5.5) lanes B+C, real data is the default
- Done: app/src/data.ts falls back to /data (real Raleigh data) when VITE_DATA_BASE is unset or
  empty; shared/scripts/bundle.ts dataDir() falls back to app/public/data (REAL_DATA_DIR), so the
  server and `npm run optimize` match the app. .env.example now says VITE_DATA_BASE=/data. The
  data-folder test is updated and no longer fails on Windows path separators.
- Verified: with no .env, /solo?skip fetches /data/cells.json (1.2 MB) and the HUD reads
  "of 37,539 at risk" at 1440 and 390 px; no console errors. Screenshots timed out in the pane
  (WebGL page), so the check was by page text.
- Gotcha: the fixtures are still at app/public/data/fixtures and shared/fixtures; set
  VITE_DATA_BASE=/data/fixtures (or DATA_DIR) to use them. `npm run optimize` without env now
  rewrites app/public/data/optimal_*.json. bench.test.ts still times out at 5 s on slower machines.

### 2026-10-03 17:55 EDT Claude (Opus 5.5) lane D, P11 server side (Tiger Data)
- Done: Tiger Data (TimescaleDB 2.30, Postgres 18) connected via DATABASE_URL in the root .env.
  server/src/db/schema.sql (idempotent, applied on every server start): hypertables `plays`,
  `placements`, `gauge_readings`; real-time continuous aggregates `placements_hourly`,
  `leaderboard_hourly`; reference tables `cells` (6,392), `sites` (216), `flood_roads` (50),
  `data_builds`; view `crowd_by_hood`. `npm run db:migrate -w server` does the same by hand.
- Done: POST /api/plays (validates, re-scores on the server, stores plan + placements; 201
  `{id, score, store}`, 400 `{problems}`), GET /api/planner?mode=flood (`{store, plays,
  atRiskWeighted, optimalProtectedWeighted, counts, spots[]}`; each spot has target, type, name,
  hood, lon/lat, category both|data|crowd, dataRank, crowdPicks, crowdShare, protectedPeople,
  reason). MemoryStore when DATABASE_URL is missing or Tiger fails; failSoft() at runtime.
- Verified live against Tiger with the real bundle: 2 plays saved in ~0.3 s, planner read them back
  at once (both 2 / data 12 / crowd 1); test rows deleted afterwards. 8 server tests pass (memory
  store + fixtures), server typecheck passes.
- Half done: nothing in lane D. Heat mode is wired but heat data is still placeholder (P10).
- Next exact step (lane C): build /planner in app/ from GET /api/planner: map the spots by
  category (both / data = gap / crowd), ranked list with `reason`, live refresh every few seconds.
  P9 rooms should POST each submitted plan to /api/plays.
- Gotchas: in a worktree the root .env is not there; run with
  `npx tsx --env-file=<main checkout>/.env src/index.ts` from server/. The server blocks for
  ~8 s right after start while it warms the optimizer (score baseline + 3x plan for the planner).
  The database also has `rounds` / `player_actions` tables from another branch; leave them.

### 2026-10-03 15:50 EDT — Codex — lanes A+B — flood realism and balance
- Started by merging main in `wolfhacks/codex` (`3ccecd2` -> `6871632`, fast-forward). Main's docs layout/contracts retained. All task edits stay in pipeline/, shared/, and docs/; app/ and wolfhacks/claude were not edited. Commit locally only; no push.
- Done: bridge-tag exemption; cumulative metric flooded-area shares and >=20% first-step threshold; required Cell.floodFrac; fraction-adjusted risk/people/vulnerability weights; rebuilt directed road closures, hospital cut-off, site coverage and road-protection candidates; drive-time sorted catchments; OSM ref/neighborhood fallback road labels. Existing dry-disconnected cells no longer count as flood-induced cut-offs.
- Done: 10,000-person shelter capacity with nearest-cell allocation across overlapping sites, partial final cells, and road coverage freeing seats. Actual drive times are required Site.driveDry/driveFlood integer milliseconds aligned with coverDry/coverFlood. Flood optimizer eagerly recalculates gains after reassignment. score() returns bestPossible for the same budget, with a cached optimizer baseline. protectorOf() returns per-cell, per-part placement attribution/partial shares/weighted totals. simTimeline() supplies protectedWeighted and strandedWeighted and matches score() at the final step.
- Rebuilt outputs are in `pipeline/out/data/` **not app/public/data/**. This includes cells, sites, flood roads, graph, hospitals, flood polygons/dots, metadata, optimal_flood.json and balance_report.json. Per-step cell fractions are in `pipeline/out/cell_flood_shares.json`. Updated synthetic fixtures are in shared/fixtures/; npm run fixtures now writes there by default.
- Measured via `DATA_DIR=pipeline/out/data npm run optimize flood`: 544,819.362 study-area residents; **37,539.444 at-risk people (6.8903%)**, 47,812.808 weighted exposure. The 20% review gate passes. **261 flood-induced cut-off cells**, 16 pre-existing dry disconnections excluded. Cells first flooding at steps 1/2/3: **416 / 447 / 15**; null: **5,514**. 670 bridge edges remain open; 1,910 directed edges close. All 216 sites retained (204 dry), 50 road candidates.
- Balance: optimizer **76.3262/100**, protecting 28,383.863 people with three shelters and bus pickup at cell 5470 ($10M). Strongest single shelter: Red Bud Writing Project (`osm-node-12223563601`), 10,000 people = **26.6386% of at-risk people / 28.4862% of weighted exposure**. sites.json shrank from 4,997,659 to **2,311,270 bytes (53.75% smaller)** despite adding actual route times and 32 more sites. Real optimizer run ~1.57 s; first score computes this once, later calls reuse it.
- Verification: npm run typecheck passes shared/app/server; full npm test passes 37 tests (existing server socket test requires localhost access outside the sandbox); 22 Python tests pass; six TypeScript contract/data tests pass on the real staged bundle; strict artifact validator passes every file under 5 MB. `pipeline.verify_balance` independently checks all 670 bridge edges, all cumulative cell thresholds/shares, dry/flood hospital reachability, exact directed times/order for every site's catchments and all 50 road unlock sets. Regenerated cut-off/coverage maps visually inspected.
- Contract adoption for Claude: load the matching bundle from pipeline/out/data when updating app/public/data. Old cells/sites do not meet the new required contract; missing floodFrac/drive arrays fail explicitly. Use `protectorOf(plan, data).get(cell)` and each source's placement/part/share/weighted for resident destinations; do not reconstruct capacity from placementEffect.cells or straight-line distance. Sample `engineIndex(data).mode.flood.partW` for the dots; use timeline.protectedWeighted/strandedWeighted for corresponding counters. score.bestPossible is a percentage (0..100), compared at the total game budget, default $10M.
- Half done: none within lanes A/B. UI adoption is intentionally left to lane C per the user's boundary. P7 road-following animation/P8 results remain independent UI work. No new dependencies.
- Next exact step: Claude adopts the staged real bundle (and shared fixtures if using fixture mode), then replaces app-derived protection ownership with protectorOf and selects weighted timeline counters. See the final entries in docs/DECISIONS.md for partial-cell/overlap semantics and pipeline/README.md for rebuild/audit commands.

### 2026-10-03 15:10 (machine clock) Claude (Opus 5.5) lane C, V1 visual overhaul
- Scope: app/ and docs only. shared/ and pipeline/ untouched. DESIGN.md rewritten first (two moods,
  tokens, water, HUD, title, storm, end, sound, performance floor); DECISIONS has the new lines.
- Done (solo flow is now title -> intro -> planning -> storm -> results; /solo?skip starts at planning):
  - Title (ui/Title.tsx): Raleigh downtown orbiting at pitch 60 with 3D buildings, title plate,
    briefing card "Hurricane approaching. 72 hours of rain. You have $10M and 3 minutes.", "Start
    planning" -> MapView flies to the frame (flyToFrame, onFramed) -> store.startPlanning.
  - Planning HUD (ui/Hud.tsx replaces ui/PlanPanel.tsx; routes/Solo.tsx has no rail): top plate
    (budget chips, timer turns --alarm and pulses under 30 s, covered), bottom tray of chunky discs
    (CSS hard shadow, lift when armed) + placed pieces + Start the storm, status plate, top-right
    3D / Layers (toggles, legend, keys) / Sound. Neighborhood card floats (compact on phones).
    Framing pads around the plates (frame.ts Pad, hull-based framePoints).
  - Juice (plan/Juice.tsx): +N chip above the aim point, landing ring + floating +N chip, Web Audio
    stamp (ui/sound.ts), navigator.vibrate(15) on coarse pointers, stamp 1.3x -> 1 in 200 ms.
  - Water (map/flood.ts + basemap.ts): flood_steps.geojson split into 1,444 parts with growth
    delays (distance to earlier water); per-step fills (step 1 --flood-deep), blurred waterline,
    night glow line, shimmer, 3D extrusion per step (6/3/1.5 m) + 3D buildings above pitch 20.
    FloodView (one per map, floodViewOf(map)) animates looks, growth and the submerged streets.
  - Submerged streets: tile roads clipped against a 15 m flood raster (built in idle chunks):
    deep band + flowing dashes (4 crossfaded dash layers), road-closed barriers at each waterline
    (symbol layer from z12, rotated across the street, labels win collisions).
  - Storm (storm/director.ts, Weather.tsx, StormOverlay.tsx, sim.ts): wipe -> night palette, rain
    canvas, lightning + thunder, tilt to 55, per-step helicopter stop (named road that strands the
    most blocks; at step 3 the neighborhood cut off with the most people) with a LIVE caption,
    glowing evacuees, stranded rings, counters on plates, Skip to results. End: palette back to
    day over 1.6 s, water stays full, band slides away, camera to the city, results card slides up.
    Pieces + hospitals (night label colors) are the only deck.gl icons in the storm.
- Verified (GPU Chrome, app/scripts/drive.mjs with GPU=1): storm at 1440x900 with every effect on:
  59.8 fps, p99 16.8 ms, max 50 ms, 3 frames over 33 ms in 22.8 s; 390x844: 59.8 fps, max 50 ms.
  Screenshots of every phase at 1440 and 390, the fly-down, aim/landing juice, timer under 30 s,
  street-level close-ups of Glenwood Avenue under Crabtree Creek by night and by day.
  Regression: title -> planning; mouse place all three pieces (+114,992 hover for Boylan Chapel),
  drag shelter to Mount Olivet, select + Delete, keyboard 2/arrows/Enter, storm, skip, Play again
  (day palette, empty board), second storm; phone tap place, touch-drag, Remove, pan, storm,
  Play again. Reduced motion (REDUCE=1): no orbit/rain/wipe/flights, LIVE caption still names
  events. /host and /play show the water. typecheck, 30 tests, vite build. No console errors.
- Critique fixes (top 3 against DESIGN.md): the broadcast band now leaves when the sky clears;
  hospital names use night label colors during the storm; planning water preview raised to 75%.
- Half done: nothing in V1. P7 pass 2 (residents on roads) and P8 (full results) still open.
- Next exact step: P8 results screen (replace ResultsCard in storm/StormOverlay.tsx; it sits
  bottom-left on desktop with the city framed to its right via resultsPad in Solo.tsx).
- Gotchas:
  - drive.mjs: GPU=1 for any storm or frame-rate run; REDUCE=1 for reduced motion. It now kills
    Chrome on any exit; before that, a crashed run left headless Chromes animating (load avg 190)
    and every measurement after it was wrong. Wrap evals that return objects in void(...).
  - Never change a data-driven or cross-faded paint value per frame (relayout). FloodView.paint()
    caches what it sent; keep new animation on constants, feature-state or visibility.
  - fill-extrusion ignores color alpha; 3D water fades by layer opacity per step.
  - cameraForPoints jumps the map to measure: call it only while the map is still (it would stop a
    flight). The director computes every camera at storm start.
  - The title orbit uses camera padding; its cleanup removes the padding without moving the view.
  - Once (not reproduced in two reruns) a reduced-motion screenshot showed the pre-storm band lines
    at 6 s. If it shows again, look at useStormStep's timer in StormOverlay.tsx.

### 2026-10-03 14:05 (machine clock) Claude (Opus 5.5) lane C, P7 pass 1
- Scope: app/ and docs only. shared/ untouched (Codex will work on shared/ and pipeline/ in
  wolfhacks/codex); the storm only consumes engine exports.
- Done: the storm replaces the placeholder on /solo. Planning -> storm -> results card -> Play again.
  - app/src/storm/sim.ts: `buildStorm(data, placements)` (~17 ms on real data) from
    `simTimeline(soloPlan(...))` + `planState` / `placementEffect`. Pacing constants (LEAD 0.8 s,
    STEP 4 s, GROW 600 ms, DASH 1.8 s, STORM_MS 12.8 s). Residents: 5,999 dots (1 per 25 weighted
    people, capped at 6,000), fates: travels (shelter / bus pickup), stays (protected road), stranded.
    Band lines per step: headline, top 3 flooded hoods, named roads closing (+N more), protected
    roads that stay open, cut-off hoods at the final step, stranded so far.
  - app/src/storm/layers.ts: `stormRenderer(storm, data, reduce)`: per-step flood dot layers grow
    via radiusScale (and the pixel clamps, so it shows at city zoom); closing roads dashed
    (PathStyleExtension) then solid --alarm, held roads ink; TripsLayer trails (450 ms); residents
    and stranded rings as double-buffered binary attributes; --safe halos grow behind each shelter /
    pickup as people arrive. `stormWarmLayers()` precompiles shaders during planning.
  - app/src/storm/StormOverlay.tsx: Broadcast (slides in once; imperative ticker that drops unseen
    lines on each new step; static text with reduced motion; sr-only status line per step),
    Counters (120 px from 1400 px wide, 72 md, 48 phone; rAF writes textContent), ResultsCard
    (score, protected, stranded, Play again; P8 replaces it).
  - MapView `frameLayers` prop (rAF loop outside React). store: phases planning | storm | results,
    `stormAt`, `endStorm`. Phone (<640 px at load) frames `riskFocusPoints(data)` (map/frame.ts):
    gridDisk 3 around the at-risk cell with the most at-risk weight nearby, opens at z13.1 at 390.
    Rail during the storm: tray hidden, storm legend; on phones the bottom sheet hides.
- Verified on real data (scripts below): typecheck, 30 tests, vite build. Frame pacing on Apple M1
  (Chrome headless on Metal, 1440x900, optimal plan): 782 frames in 13 s, max 16.8 ms, 0 over 33 ms.
  Screenshots at 1440 and 390 across all steps; touch play at 390 (shelter + pickup by tap, storm,
  Play again, a second storm); reduced motion emulated (static band, instant counters, no trails);
  close-up of a closing road (dashed, then solid). No console errors.
- Half done: P7 pass 2 (residents follow roads, see next step). Rail still shows planned "residents
  covered" during the storm (fine, matches the card).
- Next exact step: P8 results screen (replace ResultsCard in storm/StormOverlay.tsx; load
  optimal_flood.json as OptimalPlan). P7 pass 2: route travellers over roads_graph.json (load it only
  for the storm), avoiding edges whose floodStep <= the resident's step.
- Requests for lane B (not done, engine untouched): (1) a `coverSources(plan, data)` helper that says
  which placement protects each part of each cell; storm/sim.ts derives it from placementEffect
  today and would drop that code. (2) simTimeline counts `pop` while dots sample weighted people,
  so dot shares and counters differ a little; a per-step weighted total would let them match.
- Gotchas:
  - Headless swiftshader runs the storm at ~2 fps; measure frames with a GPU Chrome:
    copy app/scripts/drive.mjs and swap the swiftshader flags for
    `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
  - Never hand deck.gl a layer instance it has dropped (assertion on init); Solo clones the planning
    stack for this. Storm layers cached inside the renderer are only reused while continuously shown.
  - deck.gl skips re-uploading a binary attribute when the typed array is the same object: mutate one
    of two buffers and alternate (storm/layers.ts).
  - Color binary attributes need `normalized: true` or deck.gl warns.

### 2026-10-03 15:40 Claude (Opus 5.5) lane C, flood dots + P6
- Priority from the user: a playable /solo for teammates. Balance (capacity / drive limit) is ON HOLD,
  Codex will do the data and capacity changes later. Nothing in pipeline/ or the engine math changed.
- Done, flood dots (a4257fe): the app loads the pipeline's flood_dots.json (`FloodDot` in
  shared/src/data.ts). halftone.ts is gone; make-fixtures writes a fixture flood_dots.json (other
  fixture files byte-identical). Measured in headless Chrome on real data: framed map 52.5 s -> 5.7 s,
  worst main-thread stall 1.6 s -> 9 ms. The app no longer fetches flood_steps.geojson; it now loads
  cells, sites, flood_roads, hospitals, flood_dots. `MapData` extends the engine's `DataBundle` (built once).
- Done, P6 planning on /solo (real data):
  - app/src/plan/: store.ts (zustand: phase, placements, armed, selected, hover/movingId, cursor,
    endsAt, notice; refuses over-budget and duplicate site/road), targets.ts (screen-px snapping,
    road labels "Unnamed road in <hood>", cursor steps), pieces.ts (disc SVGs for tray and map atlas),
    layers.ts (flood roads, protected roads, --safe coverage halftone, hollow preview rings, target
    highlight, cursor hex, pieces with the 1.15 -> 1 stamp, ghost), usePlanScore.ts (score(),
    per-cell protected share, hover preview with +N), usePlanning.ts (pointer + keyboard input).
  - app/src/ui/PlanPanel.tsx: budget chip stack, timer, residents covered (score().protectedPeople),
    tray (dimmed at 40% with cost in --alarm when unaffordable), status line, plan list (keyboard
    select + Remove), Start the storm, storm placeholder (alert band + summary, Back to planning,
    Start over). routes/Solo.tsx lays it out: rail at lg, top bar + map + bottom sheet at 390.
  - Facilities toggle (hospitals from hospitals.json + sites). Sites scale with zoom (5-14 px), so the
    opening view has no downtown blob; hospital names from z10.5. MapView got onReady / keyboard /
    cursor props (Host and Play unchanged and checked).
- Verified (scripted with app/scripts/drive.mjs on real data): mouse: place all three pieces, hover
  previews (+114,992 for Boylan Chapel), drag shelter to Mount Olivet, click + Delete. Touch at 390:
  tap-place all three, touch-drag move, tap + Remove, one-finger pan still pans. Keyboard: tray via
  Enter (focus jumps to the map), 1/2/3, arrows, Enter places, list select + arrows + Enter moves,
  Delete removes. Budget to $0 refuses a road with a notice. Timer expiry ends planning. Counters
  update on each action. Fixtures data path checked. typecheck, 30 tests, vite build.
- Half done: nothing in P6. The storm phase is a placeholder (StormPlaceholder in ui/PlanPanel.tsx).
- Next exact step: P7 simulation. Hook into `usePlan` phase 'storm' (store.endPlanning), replace
  StormPlaceholder, drive the steps from `simTimeline(soloPlan(placements), data)` (usePlanScore.ts
  has soloPlan). Load flood_steps/roads_graph only if the sim needs them (data.ts no longer does).
- Gotchas:
  - Game balance is still off (one shelter covers ~115k of 174k people, see the 14:30 entry). Waiting on
    Codex's capacity work; rebuild optimal_flood.json after it lands.
  - Pointer input is capture-phase on the map container (usePlanning.ts). A press on a piece calls
    stopPropagation on pointerdown/mousedown/touchstart so MapLibre does not pan; after a placing tap
    the next click is swallowed so deck.gl does not also open the neighborhood card.
  - Coverage dots use the fixed list of at-risk cells as data (radius/alpha 0 for uncovered) so deck.gl
    transitions per index; pieces are appended so only the new one "enters" (the stamp).
  - Dev: `window.__plan` is the plan store, `window.__map` the map. drive.mjs takes "G(lon,lat)" and
    "B(button text)" as coordinates. Do not edit files while a drive run is going: Vite reloads.
  - Phone opening view is z9.4 (whole city), below DESIGN's z13 target; pinch to zoom works and snapping
    is generous (48 px for sites on touch). Revisit framing if the demo is phone-first.
  - Headless "time to framed map" is ~5.5 s, mostly fetching 5 MB sites.json + 1.1 MB cells.json.

### 2026-10-03 14:30 Claude (Opus 5.5) lanes A+B, real data + shelter rule
- Done:
  - Merged data-pipeline (Codex P2, P3: 3a84291, 3ccecd2) into main. Codex's branch kept docs at
    the root; main's docs/ layout kept. Codex's two handoff entries are in this log in time order,
    their DECISIONS line is in docs/DECISIONS.md. The wolfhacks/codex checkout was not touched.
  - `.env` (gitignored) created from .env.example with `VITE_DATA_BASE=/data`. app/vite.config.ts
    now has `envDir: '..'` (one-line lane C change): Vite read .env from app/, so the root .env
    never reached the app and /solo kept loading fixtures.
  - Contract check on real data (`DATA_DIR=app/public/data npx vitest run shared/src/fixtures.test.ts`):
    all pass. One mismatch fixed: meta.json. `DataMeta` now types the pipeline's real shape
    (buildDate, task, sources map, p3.thresholds); the fixture generator writes the same shape;
    the data test checks meta and that coverage used the 900 s drive limit.
  - Shelter rule (user decision, DECISIONS): `shelterCells(site, idx)` in coverage.ts. Flooded cells
    are covered via coverDry, cut-off dry cells via coverFlood, flooded shelters still cover nobody.
    Tests: hand-made 4-cell bundle (both cases + a wet site) and a fixture check.
  - `npm run optimize flood` on real data -> app/public/data/optimal_flood.json: score 89.2,
    2 shelters (Boylan Chapel, osm-node-357813842) + roads road-0523, road-0168.
- Balance finding (NOT changed, waiting on the user): the game is too easy. At-risk: 2,497 cells
  (1,706 flood, 791 cut-off dry), 220,098 weighted (173,822 people). A 15-min drive reaches
  ~5,000 of 6,392 cells, so the average usable shelter covers 110,583 weighted (50.2%) and the best
  covers 66.5% (Boylan Chapel); 170 of 173 usable sites cover over 25%. Scratch estimates (cover
  rebuilt from roads_graph.json, matches the pipeline at 900 s, Jaccard 0.999 dry / 0.989 flood):
  - 10-min limit: mean shelter 25.6%, max 46.0%, optimal 77.0. Not enough on its own.
  - 5-min limit: mean 5.4%, max 11.6%, optimal 42.7.
  - Capacity, nearest-first by drive time (15 min): 5k people max 3.2% / optimal ~31 (roads
    dominate); 10k max 6.1% / ~36; 20k max 11.8% / ~47 (shelters and roads both matter).
- Verified: typecheck (all workspaces), 30 tests, data test on real data, screenshot of /solo at
  1440 with real data (fetches /data/cells.json, sites.json, flood_steps.geojson).
- Half done: nothing in A/B. optimal_flood.json must be rebuilt if the balance rule changes.
- Next exact step: user picks the balance fix (capacity is the proposal). Then lane C: swap
  `halftoneDots()` for the pipeline's flood_dots.json (see gotchas), then P6.
- Gotchas:
  - /solo freezes ~30 s on real data: `halftoneDots()` (app/src/map/halftone.ts) rasterises the
    city's flood polygons on the main thread (30.4 s in Node). The style and the camera fit wait
    behind it. Fix: load flood_dots.json (`[lon, lat, step][]`, 3,261 dots) instead.
  - Real-data framing fits the whole city at zoom 10.7 (1440 px), below the z13 DESIGN wants on
    phones; 184 site squares overlap downtown and cover the "Raleigh" label. Lane C to decide.
  - Flood road names can be "Unnamed road <osm ids>"; the UI needs a fallback label.
  - 1,250 cells are step 1 (floodway), more than the 424 at step 2: the floodway band is coarse at
    res 9. Fine for scoring, worth a look before the sim animates step by step.
  - Capacity needs a drive-time order per site. Cheapest path: lane A writes coverDry/coverFlood
    sorted by drive time (same file size), the engine fills nearest-first.

### 2026-10-03 13:45 Claude (Opus 5.5) lane B, P4
- Done: game engine in shared/src/engine/ (exported from `@shared` and `@shared/engine`):
  - context.ts: `engineIndex(data)` builds typed arrays once per bundle (WeakMap): weight split
    into car / no-car parts per mode, at-risk masks, hood ids, heat threshold, cached `disk(i,k)`.
  - atRisk.ts (`atRiskCells`, `heatThreshold`), coverage.ts (`placementCoverage(p, mode, data)`
    for the tray's instant coverage, `siteUsable`, effects and gains), plan.ts (`planCost`,
    `planProblems`, `PlanError`), score.ts (`score(plan, data)`), optimizer.ts
    (`optimize(mode, data)`), timeline.ts (`simTimeline(plan, data)`: per step flooded,
    newlyFlooded, closedRoadIds, heldRoadIds, protected and stranded people).
  - Model: see DECISIONS (P4 lines). topMisses reasons: "no shelter within 15 minutes",
    "households with no car and no bus pickup nearby", "the nearest shelter floods; ...",
    "cut off from hospitals; ...", heat: "hot block with no cooling center, ...".
  - data.ts: `DataBundle`, `OptimalPlan`. config.ts: `MODE_INTERVENTIONS`, `HEAT_COVER_CREDIT`,
    `NO_CAR_HH_WEIGHT`. types.ts unchanged.
  - `npm run optimize [flood|heat]` loads DATA_DIR, else app/public + VITE_DATA_BASE (reads .env),
    and writes optimal_flood.json / optimal_heat.json there. Fixtures: flood 68.3, heat 100.
  - Fixtures: added site-avent-ferry (dry, south of the creek); cells unchanged.
- Verified: typecheck (all workspaces), 26 tests. Benchmark on a synthetic 6,400-cell bundle:
  index build ~7.5 ms once, first score ~4.6 ms, warm score ~0.4 ms; optimizer ~120 ms.
- Half done: nothing. SHELTER_CAPACITY is still ignored (it is null).
- Next exact step: P6 planning phase can call `placementCoverage` per placement and `score` on
  every change (sub-millisecond). Load optimal_flood.json as `OptimalPlan` for P8.
- Gotchas:
  - Build the bundle object once and reuse it: the index cache is keyed by object identity.
  - coverFlood is reachability at the final step, so flooded cells are rarely in any site's
    coverFlood and shelters mostly help cut-off cells. On fixtures the north-side shelters cover
    no at-risk cell. If real data shows the same, lane A/B should decide whether flooded cells use
    coverDry (evacuate before the water arrives). Check `placementCoverage` per site on real data.
  - For heat the optimizer's lazy step is a heuristic (trees can gain from neighbours' cooling).
  - simTimeline is flood only and throws for a heat plan.
  - Engine tests always use the fixtures (they name fixture sites); fixtures.test.ts still
    follows DATA_DIR.

### 2026-10-03 13:05 Claude (Opus 5.5) lane C, P5 revision: map first
- Done: design change requested after P5. DESIGN.md "Map" rewritten (also the concept intro, the
  depth rule, halftone size, host layout) and the app follows it:
  - Camera top-down (pitch 0). "Tilt" button bottom-left of the map eases to 45 and back; state
    in the store (`tilt`), off by default, hidden on /host (`tiltControl={false}`).
  - Basemap (map/basemap.ts) now reads as a street map: building footprints (ink 7-10%, z13+),
    parks/woods/grounds in a light `--safe` tint, streets as bond fill with ink casing (motorways
    wider, heavier casing), dashed rail, creeks at 70%, names for major streets z12+, minor z15+,
    water in italic, neighborhoods bold.
  - Population: no extrusion, no grid. `cellsLayer` is always on and pickable; with "Who lives
    here" on (rail, off by default) it fills ink at 6/13/21/30% by Everyone / 65 and over /
    No car, with a Fewer-More key. Selected neighborhood: `hoodLayer` draws the hood's outline
    (h3 `cellsToMultiPolygon`) in 2.5 px ink over a 35% signal tint.
  - Halftone dots: radius 36/28/20 m (max 10 px), 75% opaque. Sites unchanged, always on top.
- Critique fixes: (1) framing now fits cells and sites only, not flood polygons; the fixture
  creek is much wider than the cells and pushed the 390 px view to z12.7, below where street
  names and buildings exist (z13.1 now). (2) Motorways were solid ink and turned the Beltline
  interchange into a blot; now cased streets.
- Verified: typecheck, 7 tests, vite build; screenshots at 1440 and 390 of default view, map click
  (card + outline), "Who lives here" on, Tilt on.
- Half done: nothing.
- Next exact step: P6 planning phase (tray in the /solo rail and the 390 bottom sheet).
- Gotchas:
  - deck.gl does not pick fills with alpha 0. The invisible pick layer uses alpha 1/255.
  - In dev, `window.__map` is the MapLibre map; the screenshot script can read it via the
    `EVAL` env var (for example zoom, or `queryRenderedFeatures` to check labels).
  - OpenFreeMap has no buildings below z13 and few names below z12; keep default framing at or
    above z13 on phones.

### 2026-10-03 12:45 EDT — Codex — lane A — P2/P3
- Done: Extended the Census block-group join to Durham County (state 37, county 063), rebuilt `cells.json`, and verified all 6,392 study cells have demographic coverage; the former 138 placeholders are now 0. Built FEMA NFHL flood steps, OSMnx directed drive graph with speeds/travel times, OSM hospitals and candidate sites, directed hospital reachability and cut-off cells, multiprocessing site coverage, ranked flood-road protection candidates, and 120 m flood dots.
- Outputs: `app/public/data/cells.json`, `roads_graph.json`, `flood_steps.geojson`, `hospitals.json`, `sites.json`, `flood_roads.json`, `flood_dots.json`, and enriched `meta.json`. Sanity PNGs: `pipeline/out/check_flood_steps.png`, `check_cutoff_cells.png`, and `check_site_coverage.png`.
- Validation: P2/P3 artifact validator passes all contracts, relational references, geometry checks, coverage subsets, and 5 MB budgets. Seventeen unit tests pass, including one-way routing, parallel-edge minimum travel times, flood-zone precedence, road reopening equivalence, site catchment limits, and Durham demographic coverage. PNGs were visually inspected.
- Sanity: 39,285 graph nodes, 91,569 directed edges, 2,183 flooded edges, 5 hospitals, 184 retained sites, 50 flood-road candidates, 3,261 dots, 1,367 final-state cut-off cells (1,351 newly disconnected from a dry route), and 16 dry-disconnected cells.
- Gotchas: OSMnx cache contains the completed facility Overpass responses recovered after a transient Overpass timeout. Sites are capped at 184 because the coverage arrays reach the 5 MB budget; the preference order is schools, community centres, libraries, then worship. Flood polygons are simplified only for display; original dissolved geometry classifies cells and edges. Heat and canopy remain P10 placeholders.
- Next exact step: lane B should consume the published contracts and use `floodStep`/`cutOff` plus site `coverDry`/`coverFlood` and `flood_roads.unlocks` in scoring. Re-run `pipeline/.venv/bin/python -m pipeline.validate_flood` after any data edit.
- Commit: local only; no push.

### 2026-10-03 12:25 Claude (Opus 5.5) lanes B+C, P5
- Done: tokens live once as :root vars in app/src/styles.css (7 colors, --rule, --piece-shadow,
  --focus-ring); Tailwind reads them via `@theme inline`; deck.gl/MapLibre read them through
  `tokens()` in app/src/tokens.ts. Type scale is `text-13` ... `text-120`. Focus ring is global
  (`:focus-visible`). Basemap is our own style on OpenFreeMap tiles (map/basemap.ts): chalk land,
  flood water at 35%, thin ink roads, no sprite (so no POI icons), only place names and major road
  names. Camera (map/frame.ts) binary-searches the largest zoom where every data vertex (hex
  corners, sites, flood rings) projects inside the padded viewport at pitch 45, and re-fits on
  resize until the user moves the map. Layers (map/layers.ts): H3 hexes extruded up to 60 m, 4
  stepped ink tints by vulnerable share, height toggle Everyone / 65+ / No car; flood halftone
  dots (map/halftone.ts makes a 120 m grid from flood_steps.geojson, radius by step) sitting on top
  of the hexes; sites as ink squares (hollow when the site floods). Neighborhood card on click
  (hood totals + first flood step), signal fill on the selected hood, Esc or empty click clears.
  Routes via a 40-line router (app/src/router.tsx): /, /solo, /host/:code, /play/:code, /planner.
  Added `FLOOD_STEP_NAMES` to shared/src/config.ts.
  Verified: typecheck, 7 tests, `vite build`, screenshots of every route at 1440 and 390, clicks
  on hexes at both widths. Critique fixes: site squares were clipped by hex tops (now
  depthCompare always, 16 px); MapLibre's white pill attribution restyled flat and folded on
  idle; framing switched from bbox corners to data vertices. Removed the doubled legend dots.
- Half done: nothing. /host, /play and /planner are skeletons (static timer and budget, no server).
- Next exact step: P6 planning phase. Put the tray in the /solo rail under the height toggle (the
  rail has room at 1440) and in the bottom sheet at 390. Use `--piece-shadow` and `shadow-piece`
  for tokens. When pipeline P3 lands, swap `halftoneDots()` for the exported dot grid.
- Gotchas:
  - deck.gl billboard icons must use `parameters: { depthCompare: 'always' }` or the hex they
    sit on clips their lower half.
  - Dots and squares get z = height of their H3 cell (`cellHeights`), so they ride on the pieces.
    Anything new drawn over cells must do the same, or it hides under the extrusions.
  - Screenshot script (CDP, Node's built-in WebSocket): send a `mouseMoved` before
    `mousePressed`/`mouseReleased`, or deck.gl ignores the click. Run shots one at a time; two
    swiftshader Chromes in parallel leave the basemap blank at 7 s.
  - MapLibre re-opens the compact attribution when the source's attribution arrives, which can be
    after 'load'; fold it on 'idle' (MapView.tsx).

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

### 2026-10-03 12:05 Claude (Opus 5.5) lanes B+C, P1
- Done: npm workspaces (shared, app, server), strict TS 7 via tsconfig.base.json, `@shared` alias
  (tsconfig paths + Vite alias + vitest alias; tsx reads tsconfig paths). Root scripts: `dev`
  (concurrently app + server), `typecheck`, `test` (vitest), `optimize` (stub), `fixtures`.
  shared/src/types.ts copied exactly from AGENTS.md; config.ts with all placeholders plus
  `weightedPeople()`; data.ts types the other static files (RoadsGraph, Hospital, FloodSteps, Meta).
  Fixtures in app/public/data/fixtures/ are generated by shared/scripts/make-fixtures.ts:
  37 cells (gridDisk 3 around Talley), Rocky Branch creek with 3 nested flood bands, 6x6 drive
  grid + UNC Rex Hospital, 3 sites, 2 flood roads. Result: 12 flooded cells, 22 cut off (south
  of the creek), Pullen CC site floods at step 1 (unusable shelter), each road unlocks 11/14 cells.
  shared/src/fixtures.test.ts checks shapes + cross references (set DATA_DIR to test real data).
  app: full-screen MapLibre (OpenFreeMap positron) + interleaved MapboxOverlay + H3HexagonLayer,
  DESIGN.md tokens in Tailwind v4 @theme, Big Shoulders Display + Public Sans from Google Fonts.
  server: Fastify GET /api/health -> {ok:true}; raw `ws` on /ws/rooms/:code sends
  {type:'hello',room} then echoes. Vite proxies /api and /ws to :8787. Server test covers both.
  Verified: typecheck, 7 tests, curl health (direct + proxy), ws echo, screenshots at 1440 + 390.
- Half done: nothing.
- Next exact step: P5 (restyle basemap to DESIGN.md, camera framing, layer toggles) or P4 (engine)
  against the fixtures. Regenerate fixtures with `npm run fixtures` if you change the generator.
- Gotchas:
  - The repo root is now wolfhacks/claude (the git dir moved there); Codex's worktree is
    wolfhacks/codex on branch data-pipeline. That branch still has the docs at the root, not docs/.
  - maplibre-gl must stay on v5 until deck.gl supports v6 (see DECISIONS). v5 imports as
    `import { Map } from 'maplibre-gl'`.
  - maplibre-gl.css is unlayered and sets `position: relative` on the map container, which beats
    Tailwind v4 utilities. Position a wrapper, not the container (see MapView.tsx).
  - Headless screenshots: Chrome `--virtual-time-budget` hangs on the map. Use CDP with real
    time and `--use-angle=swiftshader --enable-unsafe-swiftshader`.
  - npm audit flags transitive @loaders.gl/gltf via deck.gl mesh-layers (unused). Left as is.

