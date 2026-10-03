# Ready Raleigh — Build Plan for Claude

How to use: open the repo in Claude Code and paste one milestone prompt at a time.
Do not paste the next one until every acceptance check of the current one passes.
Each prompt assumes Claude has read `CLAUDE.md`, `docs/PLAN.md`, `docs/DATA.md`.

Order is chosen so a playable, good-looking game exists early (M3), then depth is added.

---

## M0 — Scaffold

**Prompt**
> Read CLAUDE.md and docs/*. Scaffold the monorepo exactly as in CLAUDE.md "Repo layout":
> `pipeline/` (Python package with CLI `python -m pipeline build <area>`, pyproject, ruff,
> pytest), `server/` (Node 22 + TS + Express + Socket.IO), `client/` (Vite + TS + MapLibre +
> deck.gl), `shared/` (types). Add `.env.example`, a root README with run commands, and
> `npm run dev` that starts server and client together. Add `client/src/styles/tokens.css`
> with the tokens from PLAN.md §8.2 and load Space Grotesk + Inter. Render a full-screen
> MapLibre map of Raleigh with the OpenFreeMap style and terrain from AWS Terrarium tiles.

**Acceptance**
- `npm run dev` opens a full-screen 3D map of Raleigh with terrain; pitch 55°, bearing snaps to 45° steps.
- `pytest` and server tests run (even if trivial).
- Screenshot at 390×844 and 1920×1080.

## M1 — Data pipeline: fetch + buildings + people (Crabtree)

**Prompt**
> Implement pipeline fetchers with caching for area `crabtree` (DATA.md §1–2): Overpass
> features, OSMnx drive/walk graphs, NC Risk Building Footprints (decode coded domains from
> the layer's pjson; drop PID from outputs), ACS block-group variables, TIGER block groups and
> blocks, 2020 block population. Join buildings with OSM/Overture heights. Build synthetic
> residents (DATA.md §3.4, fixed seed). Write `buildings.pmtiles` (or GeoJSON if PMTiles tooling
> is missing — report) and `residents.json`. Every output carries `sources[]`. Stop and report if
> any endpoint or field differs from DATA.md.

**Acceptance**
- `python -m pipeline build crabtree --stage fetch,buildings,people` completes from cache on rerun in < 30 s.
- Report: building count, % with FFE, % by construction type, residents total vs ACS total (±2%).
- No PID or owner field in any output (test asserts this).

## M2 — Flood model + damage + roads + validation

**Prompt**
> Implement HAND inundation (DATA.md §3.1) from 3DEP DEM + NHDPlus HR streams with
> WhiteboxTools; generate stages in 0.5 ft steps. Implement Hazus depth-damage lookup
> (§3.2) with tables in pipeline/config/ddf and unit tests for known depth→% values.
> Compute per-stage road closures and travel-time coverage sets for candidate sites (§3.3).
> Implement pipeline/validate.py: HWM backtest (USGS STN via pygeohydro for the nearest
> usable NC event), IoU vs FEMA NFHL 1% zone, Spearman vs OpenFEMA claims by tract.
> Write docs/METHODS.md sections for each, including limitations and the validation numbers.

**Acceptance**
- `stages/*.geojson`, `damage.json`, `roads.json`, `coverage.json`, `validation.json` exist.
- Unit tests pass for damage curves and inundation on a synthetic DEM.
- validation.json has numbers (even if imperfect) and METHODS.md reports them honestly.
- A debug page `/debug/flood?area=crabtree` shows a stage slider rising water over 3D buildings.

## M3 — The game loop (solo) with Pin It + Read the Block

**Prompt**
> Build the round bank generator (DATA.md §6) for types A and B. On the server implement the
> phase machine `lobby → brief → play → reveal → … → results` (reuse the pattern from
> pocket-rivals server/game.js), scoring in server/scoring.ts exactly per PLAN.md §5 with unit
> tests, and solo mode. On the client implement screens Landing, Round, Reveal, Results per
> PLAN.md §8.3 with the design system: bottom sheet input, timer bar, lens buttons (Elevation,
> Water, Surface, People) that recolor the scene in place, the full reveal sequence (guess
> drop, truth ripple, lines, camera flight, 3 s water animation, score count-up), and the
> source sheet on any number. Buildings colored by construction type, roofs by roof color.

**Acceptance**
- A full 5-round solo game plays end to end in the browser on phone and desktop sizes.
- Every number on Round/Reveal opens a source sheet with dataset, date, method.
- Scoring tests cover pin, estimate, lens penalty, time bonus, ties.
- Playwright smoke test plays one solo game.
- Screen recording or screenshots of a reveal sequence.

## M4 — Multiplayer lobby + TV mode

**Prompt**
> Implement rooms (4-letter code, QR to /r/CODE), avatars with the 8 player colors + shapes,
> host settings tiles, ready states, lock-in checks, reconnect via session id, spectators,
> and TV mode at /tv/CODE that shows the shared map, all players' guesses on reveal, and an
> animated scoreboard. Phones become controllers while TV is connected. Reuse pocket-rivals
> rooms.js patterns (QR, reconnect, LAN + tunnel PUBLIC_URL).

**Acceptance**
- 3 browsers + 1 TV view play a 5-round game; reveals show all colored guesses; scores match server.
- Killing and reopening a phone tab resumes the game.

## M5 — Build round (SimCity) + materials

**Prompt**
> Implement round type C: material tray from pipeline/config/interventions.yaml, drag to snap
> onto valid sites, live preview (coverage ripple along roads, budget bar, residents-protected
> counter), building inspector card (construction, occupancy, year, FFE, roof, replacement
> value, depth & damage at current stage, source badges). Precompute the optimal plan with
> OR-Tools CP-SAT in the pipeline. "Run storm": sky darkens, water rises by stage, synthetic
> resident dots move along real roads with deck.gl TripsLayer, closed roads pulse red, then a
> split screen of the player's plan vs optimal plan running in sync. Score per PLAN.md §5.

**Acceptance**
- Resolving a plan on the server takes < 200 ms (test).
- Optimal plan value ≥ any random plan in 1,000 random trials (test).
- Inspector values match pack data for 10 random buildings (test).

## M6 — Field Guide, coach, Gemini

**Prompt**
> Implement the Field Guide (clue unlocks from round clue tags, mastery stars, paper-style
> card grid) and the post-reveal coach. Add server/ai.ts with the pocket-rivals pattern:
> Gemini REST, responseSchema JSON, model fallback chain, timeouts, mock fallback. Coach input
> = round feature JSON + player answer only; output schema {text ≤ 240 chars, lens_hint}.
> Also implement pipeline AI estimates for roof color/material (DATA.md §4), cached and stored
> as estimated with confidence.

**Acceptance**
- With no API key, coach shows the round's template explanation; game never waits > 3 s.
- Roof estimates exist for buildings lacking data and render with an "estimated" badge.

## M7 — Tiger Data + live data + Planner View

**Prompt**
> Create the schema in DATA.md §7 on Tiger Data (TimescaleDB + PostGIS). Write every guess,
> plan and intel item. Add continuous aggregates: leaderboard_daily, accuracy_by_round_index,
> crowd_attention_h3. Add a live poller (NWPS every 15 min, NWS alerts) into gauge_readings,
> the Landing live strip, and auto "Live Round" creation when a gauge in an area reaches
> action stage. Build /planner per PLAN.md §7: agreement grid (H3 res 9), intervention
> consensus, intel layer, usage panel with accuracy curves, exports (GeoJSON, GeoPackage, CSV)
> and an Open in Kepler.gl link.

**Acceptance**
- Planner View updates within 1 minute of new games.
- Exported GeoJSON opens in QGIS with correct CRS (test file validated with GeoPandas).
- Stale live data shows "delayed, last reading HH:MM".

## M8 — Local Intel

**Prompt**
> Implement Local Intel per PLAN.md §6.5: drop a pin, text/voice/photo input, Gemini
> structuring + PII flagging, snap to OSM features, upvotes, data badge computed by code,
> reveal chips, promotion to regional clue cards, Local Expert badges.

**Acceptance**
- A tip containing a person's name is stored without it (test).
- Badge logic tested on a tip inside vs outside modeled risk.

## M9 — Voice, domain, polish pass

**Prompt**
> Add ElevenLabs TTS for the storm-start emergency broadcast and reveal narration, cached by
> text hash, with captions and the mute control. Add the full sound set (PLAN.md §8.4) with
> Web Audio. Do a polish pass on every screen: loading/empty/error states, reduced motion,
> 2D toggle, colorblind check, 44 px targets. Configure PUBLIC_URL for our domain so QR codes
> use it.

**Acceptance**
- Lighthouse accessibility ≥ 90 on Landing and Round.
- Every screen screenshot at 390×844 and 1920×1080 reviewed; no unstyled element.

## M10 — Heat mode

**Prompt**
> Implement Heat mode: Landsat LST pipeline + NLCD canopy/impervious + per-area model with
> R²/RMSE in METHODS.md; H3 heat columns; deck.gl SunLight with real date/time shadows;
> heat interventions (trees, cool roof, green roof, cooling center, water station); heat
> clue cards; heat round types A/B/C.

**Acceptance**
- Shadows move correctly when the time slider changes (visual check at 9 AM / 3 PM).
- Heat model validation numbers present.

## M11 — Second area, Daily Challenge, share card

**Prompt**
> Build the `walnut` pack, add Daily Challenge (same rounds for all, seeded by date, one
> attempt) and a share card image. Add an area picker to host settings.

## Optional — Streaming challenge, Solana
Only after confirming eligibility (streaming) and only if everything above is solid (Solana).

---

## Demo-day checklist
- [ ] Packs prebuilt and served locally; game works with internet off except live strip.
- [ ] Mock AI path tested (unplug key) — no stalls.
- [ ] Seed real usage: run open lobbies at the event; Planner View shows real counts.
- [ ] Methods page shows validation numbers; one slide quotes the flood backtest.
- [ ] TV view on the projector, QR to our domain, phones tested on venue Wi‑Fi + tunnel fallback.
- [ ] Disclose reused code (pocket-rivals patterns) per hackathon rules.
