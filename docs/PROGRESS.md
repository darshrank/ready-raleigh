# Progress

Agents: tick items when done and verified. Mark in-progress items with your agent name and lane,
for example `[~] (Claude, C)`. Add a handoff entry at the bottom at the end of every session.

## Phase 0: setup
- [x] P1 Monorepo scaffold, workspaces, fixtures, dev script (lane B/C)

## Phase 1: flood mode end to end
- [ ] P2 Pipeline: study area, cells, census joins (A)
- [ ] P3 Pipeline: roads graph, flood steps, sites, coverage, flood roads, hospitals, halftone dots (A)
- [x] P4 Engine: types, config, coverage, scoring, optimizer, tests (B)
- [x] P5 Design tokens and map shell with layers (C)
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
<!-- Newest first. Template:
### [time] [agent] [lane] [task id]
- Done:
- Half done:
- Next exact step:
- Gotchas:
-->

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

