# Progress

Agents: tick items when done and verified. Mark in-progress items with your agent name and lane,
for example `[~] (Claude, C)`. Add a handoff entry at the bottom at the end of every session.

## Phase 0: setup
- [x] P1 Monorepo scaffold, workspaces, fixtures, dev script (lane B/C)

## Phase 1: flood mode end to end
- [ ] P2 Pipeline: study area, cells, census joins (A)
- [ ] P3 Pipeline: roads graph, flood steps, sites, coverage, flood roads, hospitals, halftone dots (A)
- [ ] P4 Engine: types, config, coverage, scoring, optimizer, tests (B)
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

