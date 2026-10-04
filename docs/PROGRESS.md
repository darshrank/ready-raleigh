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
- [x] V2 Four cities and the broadcast: globe landing, Miami / San Francisco / New York on the same engine, narrated briefing tour, Find the weak spot, storm timeline, news desk with anchor, hazard sound and vibration (C + D, branch feat/new-features-adit)
- [x] V3 Map looks and two news channels: Satellite toggle, Light / Dark map, each city's own storm clock with daylight on the map, America News (English) and Bharat News (Hindi), news timed to end with the storm (C + D, branch feat/new-features-adit). Anchor portraits in (V3.1)
- [x] L1 Leaderboard after the storm: each city's all-time board (best play per player, Tiger Data), the best plan as the score to beat, your name on the board (C + D, branch feat/leaderboard)
- [x] L2 Results in three pages (Score, Leaderboard, Debrief) in solo and rooms, the election above the all-time board, Gemini debrief read by the ElevenLabs narrator, per-city news anchors (B + C + D, branch feat/leaderboard)
- [~] P8 Results screen with score breakdown and optimal plan side by side (C). Score breakdown done (L2); the best plan on the map is open
- [~] P9 Rooms: (aum) done: lobby + QR, mayoral candidates, any player hosts, shared clock, storm starts together, ranked results stored in Tiger Data. Open: crowd heatmap, perception gap

## Phase 2: heatwave
- [ ] P10 Pipeline heat and trees, engine heat scoring, heat UI (A + B + C)

## Phase 3: planner
- [~] P11 Tiger Data storage and planner dashboard (D + C). Lane D done (Claude, D); /planner page (C) next

## Semantic zoom (branch sakhi/semantic-zoom)
- [x] SZ Detail by zoom on the planning map (Claude, C + A): S1 places, S2 addresses, S3 GoRaleigh stops, S4 NC OneMap aerial, S5 site buildings, S6 hex fade

## Realism (branch sakhi/realism)
- [~] RL Game-quality 3D city and living flood water (Claude, C). Order: R0 baseline, R1 deck.gl
  buildings + tokens, R4 water surface, R5 3D water + stains, R3 windows, R7 tiers + reduced
  motion + docs, R2 shadows, R6 flow, rain, ending. `?realism=off` keeps the old path until R7.
  R5 is the wet stains only; flooded windows going dark moved to R3 (they live in the windows shader).
  - [x] R0 baseline traces
  - [x] R1 deck.gl 3D city, world tokens, piece outlines
  - [x] R4 water surface (deck.gl WaterLayer, arrival textures, uniforms only)
  - [x] R5 wet stains (3D water rise landed in R4)
  - [x] rebase checkpoint after R5: onto main 6434b22, conflicts combined; four-city adaptation
  - [x] R3 windows (+ flooded windows go dark)
  - [x] R7 tiers, reduced motion, docs (kill switch stays until the final check at the end)
  - [x] R2 ground shadows (cheap projected pass)
  - [x] R6 ending (settling waves on the drain) and rain ripples; creek flow streaks not done
  - [x] final rebase checkpoint (main 4cdffd8), full matrix, screenshot set
  - [ ] quiet-machine A/B (waiting for the user), then remove `?realism=off`
- [~] RO The storm overview (z11-13, 55 deg) made dramatic (Claude, C), all four cities:
  - [x] O1 city lights (building + street points, one additive layer, built in the flood worker)
  - [x] O2 blackout wave per hazard (flood: water + 400 m wave; quake: snapped lines; heat: rolling)
  - [x] O3 flood readable from the overview (deep channel, see-through edges, 1.5 px edge line)
  - [x] murky water and wet stains removed (user request): clean flood blues, no stains
  - [ ] O4 windows unchanged (from z15.5); four-city screenshots at 0/33/66/100%, one 1440 trace

## Phase 4: bonus challenges
- [~] P12 Gemini briefing and debrief (D). Debrief done (L2); the briefing is still a template
- [x] P13 ElevenLabs broadcast and narration (D): POST /api/tts, narrated briefing, news anchor (V2)
- [~] P14 GoDaddy domain and deploy (any): Render free service runs (mayday-mayor.onrender.com) with WARMUP=false and LIVE_FEEDS=false; the planner's optimizer is too heavy for its 0.1 CPU (502). Domain not registered yet. See docs/DEPLOY.md
- [x] P15 Live mode: USGS gauges and NWS weather into Tiger Data (D). Title-screen weather report per city (C) done
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

### 2026-10-04 (machine clock) Claude (Opus 5.5) lanes C+D, P15 title weather report per city
- Done: the server polls NWS weather for all four city centers (live/weather.ts CITY_POINTS; job.ts
  backfills ~a day of observations on the first poll) into gauge_readings (+ wind_kph, humidity_pct)
  and the new weather_stations table (conditions words). GET /api/live/weather?city= reads it back
  from Tiger with a 24 h temperature trend from gauge_hourly (cached 60 s). ui/WeatherNow.tsx: a
  plate in the title's top-right corner on wide screens, one row above the briefing on phones;
  hidden when the server is off or the reading is over 3 h old. /api/live/gauges keeps its weather
  on Raleigh's station now that other cities are polled.
- Verified: typecheck; live tests (9); real run against Tiger and NWS (KRDU, KMIA, KLGA, SFOC1);
  browser at 1440x900, 1366x700 and 390 (DOM; the pane does not paint the phone animation).
- Gotchas: the deployed Render server has LIVE_FEEDS=false, so a local server must poll to keep the
  report fresh (it hides itself after 3 h). SFOC1 (San Francisco) reports no conditions words.
  signals.test.ts can time out when the whole suite runs at once; it passes alone.
- Next: register the domain; precompute the planner's extended optimizer so /api/planner fits the
  free instance (or a paid instance).

### 2026-10-04 02:55 (machine clock) Claude (Opus 5.5) for Adit, lane C, Score page without "Where the plan fell short" (branch feat/leaderboard)
- Done: storm/Results.tsx ScorePage ends at the two protection meters; Meter lost its unit.
  biggestGaps (storm/debrief.ts) still feeds the debrief's "biggest gap" sentence.
- Verified: typecheck; browser at 1440 and 390 (the page fits on a phone without scrolling).

### 2026-10-04 02:50 (machine clock) Claude (Opus 5.5) for Adit, lane C, leaderboard shows the top 5 (branch feat/leaderboard)
- Done: the results' board (solo and the room's all-time board) asks for limit=5 (BOARD_TOP in
  app/src/api.ts) and lists the top 5 with the best plan row; a lower player's own row follows
  after "… N more mayors" (no gap row at #6). No server change: limit was already supported.
- Verified: typecheck; browser at 1440 and 390 on the Raleigh board (you at #11 of 38: ranks
  1 to 5, "… 5 more mayors", your row), plus #6 and #3 set in the store (no gap, no extra row).
  The save, debrief and voice calls were stubbed in the page, so no test play was added.

### 2026-10-04 02:40 (machine clock) Claude (Opus 5.5) for Adit, lane C, weak spot card under the clock (branch feat/leaderboard)
- Done: plan/WeakSpot.tsx split into WeakSpotPower (the button, the scan timing, the flight) and
  WeakSpotPanel (the scan and the card), rendered in Solo's top grid under the TopHud (phones:
  under the controls row). The scan's line count moved into the useWeakSpot store.
- Verified: typecheck; browser at 1440 (gap 8 px under the clock), 1100 (clock 147 px tall,
  still 8 px), 390 (card under the controls row); Protect it places the road and the slot closes.

### 2026-10-04 02:30 (machine clock) Claude (Opus 5.5) for Adit, lane C, Satellite on the landing and the title (branch feat/leaderboard)
- Done: the Satellite button on the landing (beside Light / Dark) and on the title screen (between
  Main menu and Sound). globeStyle(tokens, dark, satellite) adds the Esri imagery to the globe;
  the title's map already followed the setting (map/mood.ts). Phones: the title's buttons wrap
  in two rows, the landing hides its zoom buttons under 640 px.
- Verified: typecheck; browser at 1440 and 390 (globe printed and satellite, Dark dims the
  imagery, fly to Miami, Play to the Raleigh title with the imagery on, off again from the title).
- Next exact step: as in the L2 entry below.

### 2026-10-04 02:10 (machine clock) Claude (Opus 5.5) for Adit, lanes B + C + D, merge of main (PR #3) into feat/leaderboard
- Done:
  - Took main's city plumbing as is (Plan.city, CityId in shared/src/room.ts, data.ts
    cityLoader, per-city planner / bus demand / civic record / signals, rooms with a city) and
    dropped L1's own version (city beside the plan, PLANNER_CITY). On top of it: PlayStore.bests
    and renamePlayer, GET /api/leaderboard (city must be in CITY_IDS), POST /api/players/name,
    POST /api/debrief, Tiger indexes plays_board and plays_player. saveSoloPlay sends plan.city.
  - Room results: main's new host actions (Next election in <city> = again + start, Choose another
    city, Leave room; the others' Leave room) are on the last results page (Play.tsx
    NextElection). "Change city" on phones so the footer fits two rows. Main menu is solo only.
  - Fixed: rooms played Raleigh's story whatever the room's city (Solo.tsx storyOf('raleigh'),
    also on main), so a Miami room showed Raleigh's board and debrief facts. Gemini debriefs that
    run long now keep their whole sentences instead of falling back to the template.
- Verified: typecheck; npm test 124, all but bench.test.ts (two timing tests, machine load ~68).
  Browser: Miami solo (board and Solana play memo say miami), Miami room (election, "All time in
  Miami", Gemini debrief on Miami shelters, footer at 1440 and 390, Next election goes straight to
  planning).
- Next exact step: as in the L2 entry below.

### 2026-10-04 01:45 (machine clock) Claude (Opus 5.5) for Adit, lanes B + C + D, L2 results in three pages (branch feat/leaderboard)
- Done:
  - Pulled main (Solana record and cards, Gemini harness and news desk, Main menu) into
    feat/leaderboard and merged it with L1. (Its civic-city and Raleigh-only-signals changes were
    replaced by main's own versions in the next merge, above.)
  - Results in three pages, the same in solo and rooms (storm/Results.tsx, replaces ResultsCard):
    Score (score, % of the best plan, protected / stranded, the vulnerable and everyone meters, the
    three neighborhoods that lost the most, with the engine's reason), Leaderboard (L1's board;
    rooms: this election ranked above "All time in Raleigh", the row found by the room player
    id), Debrief. Numbered tabs (no numbers on phones), Back / Next, Play again on page 1, Main menu
    on page 3, the host's Next election there in rooms.
  - Debrief: shared/src/debrief.ts DebriefFacts (built in app/src/storm/debrief.ts from the score),
    POST /api/debrief (server/src/debrief.ts: Gemini, 40 to 560 characters, numbers checked
    against the facts, people counts given commas, cached by hash). The template summary when
    Gemini is off or refused. Written once per round, after the board (for the rank) or 5 s; the
    narrator clip (ElevenLabs) is prefetched and read once on arrival; Listen / Stop. The public
    record and the cards moved to this page.
  - Per-city anchors: app/public/anchors/<city>/{america,bharat}.jpg from Adit's six images;
    NewsDesk looks for the city's file first, then the root (Raleigh's).
- Verified: typecheck; npm test 19 files, 118 tests (new server/src/debrief.test.ts). Browser on
  the real server: solo at 1440 and 390 (the three pages; tabs on one line on a phone), Gemini
  debrief in ~2.5 s, narrator clip in ~5 s while on page 1, Listen plays it; Miami, San
  Francisco, New York anchors on both channels; a room through two elections (standings,
  all-time row, "Candidate ..." debrief, on Solana, Mayor-elect card, Next election to the lobby;
  the board resets when each storm starts).
- Gotchas:
  - The automatic read needs audio unlocked by a click (browser autoplay rules); players have
    clicked by then. Scripted clicks do not count, so tests see "Listen" until a real click.
  - Vite HMR of Results.tsx or Solo.tsx reloads the game (dev only). From the console, import
    app modules by the URL in performance entries (with ?t=), or you get a second store.
  - More test plays on the real board: "Test Mayor" (solo) and "Test Priya" (rooms VRYP, MLFH).
    Delete them like L1's note, with player_name IN ('Test Mayor', 'Test Priya').
- Next exact step: the rest of P8, the best plan drawn on the map beside yours on the Score page
  (optimal_flood.json), or a Gemini-written briefing (P12).

### 2026-10-04 01:30 EDT Claude (Opus 5.5) lanes B+C+D, P16 Solana MVP (branch solana)
- Done (5 commits): shared/src/proof.ts (fingerprints, Merkle proofs); server/src/solana/ (devnet
  Memo anchoring of every play in batches, Tiger civic_* tables, signals: consensus, blind spot,
  new best); server/src/cards/ (Mayor-elect and signal cards, Gemini words and art, soulbound
  Metaplex Core mint on claim); app: Public record strip on the results card, /card/:id (claim
  with Phantom or a pasted address), /verify/:playId (the browser checks fingerprint, proof and
  the memo on devnet). Decisions and numbers in DECISIONS.md, plan status in SOLANA.md.
- Verified: typecheck, 106 tests; live devnet: anchors, the collection (frozen, no authority), a
  Gemini card minted to a fresh wallet, transfer refused by permanent_freeze_delegate (a plain
  asset transfers); browser at 1440 and 390: claim, verify 3/3, results strip, no page errors.
- Next exact step: civic signals timeline in the planner view; then the remaining signals.
- Gotchas: SOLANA_PAYER_SECRET_KEY signs (SOLANA_SECRET_KEY holds an address); set
  SOLANA_CARD_COLLECTION (in .env now); PUBLIC_URL must be reachable for wallets to show card art;
  solo plays anchor every 5 min, rooms at the end of each election; restart the server after .env
  changes (tsx watch does not reload env).

### 2026-10-04 00:40 EDT Claude (Opus 5.5) lanes B+C+D, Gemini news desk
- Done: the news anchor's reports come from Gemini (POST /api/news, server/src/news.ts) in a
  sensational cable-news voice, about the storm and the mayors' plans (rooms: rivals by name).
  Facts from app/src/storm/newsFacts.ts; types in shared/src/news.ts; NewsDesk swaps lines in as
  the script arrives, template per line otherwise. Harness fix: no server deadline (Google needs
  >= 10 s), default model gemini-3.8-flash.
- Verified: typecheck, tests (4 new), live route ~1.8-3.7 s, solo storm in the browser at 1440 and
  390 px: Gemini lines on the desk, no page errors.
- Half done: the first report can miss the script on a slow machine (falls back to its template).
  Possible next step: start the request earlier (e.g. when the plan is locked in rooms).
- Gotcha: .env GEMINI_MODEL=gemini-2.5-flash is retired for our key; set gemini-3.8-flash (the
  harness skips the 404 either way).

### 2026-10-04 00:15 EDT Claude (Opus 5.5) lane D, Gemini harness
- Done: server/src/ai/gemini.ts, one Gemini client for the whole server: `gemini.json()` (schema
  output), `gemini.text()`, `gemini.image()`, `GROUNDED` prompt rules, `AIError` on any failure,
  timeouts, model fallback chains (DECISIONS.md). GET /api/health reports `ai`. 8 unit tests with a
  fake client; `npm run ai:smoke -w server` makes one live call of each kind.
- Verified: typecheck, 85 tests; live smoke with the team key: JSON 1.0 s, image 10 s
  (gemini-3.1-flash-image, 934 KB JPEG, flat print look).
- Next exact step: Gemini news desk (the anchor reports what the mayors planned, template
  fallback), then Solana (docs/SOLANA.md on branch `solana`).
- Gotcha: no route exposes raw prompts; each feature adds its own endpoint and keeps a template.

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

### 2026-10-04 01:00 (machine clock) Claude (Opus 5.5) for Adit, lanes C + D, L1 leaderboard (branch feat/leaderboard)
- Done (like the "The room" step on feat/ready-raleigh-adit, in main's look):
  - Server: plays carry `city` (POST /api/plays body `city`, default raleigh). index.ts loads
    app/public/data/cities/<id> the first time a city's play arrives and scores it there (under
    1 s per city); an unknown city is a 400. GET /api/leaderboard?city&mode&playerId&limit ranks
    each player's best play (leaderboard.ts rankBoard: best score, ties to the earlier play),
    marks the asker's row, and never sends player ids. POST /api/players/name renames a player's
    plays (all cities). Old solo plays named "You" show as "Mayor XXXX" (first 4 of the id), the
    default the browser now uses.
  - Stores: PlayStore.bests and renamePlayer (memory, Tiger, failSoft merges memory after an
    outage). Tiger: plays.city column (default raleigh) and two indexes, applied on start. The
    planner and bus demand report count only Raleigh plays (PLANNER_CITY): other cities skip the
    placements table, and crowd() counts from plays because leaderboard_hourly has no city.
  - App: storm/Leaderboard.tsx. After a solo storm useBoard saves the play, then loads the board
    (one retry after 2.5 s, then "Try again"). The plate: Leaderboard and the city, "You placed 3
    of 27.", rows like the room's Standing (rank, crown on 1, name, protected and spent, score and
    % of best), the best plan as a dashed row where its score falls, your row on signal (pinned
    under the list if you are below the top 8), the name form, and where the board is kept.
    Desktop: results card left, board right (resultsPad right 480). Under 1024 px: "Your result"
    and "Leaderboard · #N" tabs, one card at a time, Play again on both. Rooms keep Standing.
- Verified: typecheck; npm test 84 of 86 (new server/src/leaderboard.test.ts: 9). The two
  failures are shared/src/engine/bench.test.ts timing out (also alone, without these changes).
  Browser on the real Tiger Data: Raleigh board at 1440 x 860 (12 mayors), rename, the pinned row,
  390 x 844 tabs, Miami's own board (3 shelters: client 17, server 17, 81% of best).
- Gotchas:
  - After the server starts it warms the optimizer for about 80 s and answers nothing meanwhile;
    the board shows "The leaderboard needs the game server" with Try again until then.
  - My test runs are on the real board as "Test Mayor" (score 0 in Raleigh, 17 in Miami). To
    remove them: DELETE FROM placements WHERE play_id IN (SELECT id FROM plays WHERE player_name =
    'Test Mayor'); then DELETE FROM plays WHERE player_name = 'Test Mayor';
- Next exact step: a weekly board (filter on created_at) if the all-time one fills up.

### 2026-10-04 03:20 EDT Claude (Opus 5.5) lane C, storm overview O3 + no murky water or stains
- Done (one commit, both touch water.ts): water.ts overview look at z11-13 (storm only, fading to
  the street-level look by z14.5): the extent texture's distance to the edge of every begun step
  makes the channel deep and dark (--flood-deep x 0.7) and the edges lighter and see-through
  (alpha 0.42 -> 0.94 over 90 m); a bright 1.5 px line (`fwidth` meters per pixel) on that edge and
  on the advancing front (`v / fwidth(v)`), --foam by day, --storm-glow at night.
- User request: no murky water and no wet stains. Water colors are now --flood / --flood-deep by
  day and --storm-water / --flood-deep at night (submerged streets --flood-deep); stain_apply,
  stain_peak and the stain colors are gone (stains.ts keeps only `stain_dark`, flooded windows
  going out); tokens --water-day/-night(-deep) and --wet-stain-day/-night deleted; DESIGN and
  DECISIONS updated.
- Checks: typecheck only (user: no screenshots or other checks); the user runs it in the browser.
- Next exact step: the user's look at the overview water; then the four-city screenshot set
  (0/33/66/100%, Dark map, camera held at the director's overview) into docs/screenshots, one 1440
  trace (`node app/scripts/storm-trace.mjs 1440 900`), vitest, and O4 (windows unchanged from z15.5).

### 2026-10-04 03:05 EDT Claude (Opus 5.5) lane C, storm overview O2 (blackout per hazard)
- Done: `cityLightsData.ts` gives every light a reference: its nearest zone cell on the flood
  worker's grid within 400 m (its own cell inside a zone; coarse 8x8-cell blocks skip most of the
  search) as a texture coordinate + distance, -1 if none. `floodData.ts` returns the step raster
  (`band`). `cityLights.ts` `lights_power()` reads the arrival + extent textures at that cell
  (shared with the water via `floodTextures`) and decides on the storm clock:
  - flood: out 0-1.5 s after the water arrives (600 ms flicker); within 400 m 2.5-5 s later + 0-1.2 s;
  - quake: inside at the step's start + 0-250 ms (220 ms flicker); nearby +0.4-1.8 s;
  - heat: only zone lights; step-1 zones roll (blocks of ~400 m, 3.6 s cycle, a third off) until
    the grid fails at step 2, then each zone goes dark for good as it spreads (step 3 at step 3);
  - reduced motion: off when the step's growth is 1 (per step, at once), no flicker, no rolling.
- Checks: typecheck; vitest 119/119 (+ nearest-zone test); overview shots at 0/33/66/100% in all
  four cities (Dark map): Raleigh's creeks open dark corridors by 66% that widen by 100%; Miami
  goes dark behind the surge; San Francisco's quake zones and New York's heat zones go dark per
  step; REDUCE=1 San Francisco: zones dark per step.
- Next exact step: O3 flood readable from the overview (water.ts: deep channel, see-through
  edges from the extent texture, 1.5 px edge line, z11-13 only, the current look from ~z14.5).

### 2026-10-04 02:50 EDT Claude (Opus 5.5) lane C, storm overview O1 (city lights)
- Sync first: `git fetch group`, main fast-forwarded 4cdffd8 -> 678870a (Darsh: rooms play Raleigh
  and Miami only, "Coming soon" for the others; no negative residents when moving a piece).
  sakhi/realism rebased onto it; only DECISIONS.md conflicted (both kept). Backup at
  `backup/realism-pre-rebase-3` (local).
- Done: `world/cityLightsData.ts` (pure: building lights scattered in each H3 cell by residents,
  street lights every 60 m along the drive graph, fastest roads first, street share <= 45%;
  seeded) + tests; `world/cityLights.ts` (`CityLightsLayer`: one point-list Model, additive
  blend, no depth, 1.5-3 CSS px, --window-lit streets and a whiter tint for buildings, mostly dim
  with a few bright ones, faint flicker on a third, none under reduced motion; brightness =
  night x level with a storm clock, so zero by day, in planning (also in Dark mode) and with no
  storm; fades out from z14.5 to z15.5 where the windows take over). The flood worker now runs in
  every city (the arrival textures for all four; the water and stains stay flood-only) and builds
  the lights after the flood data (a failure there never blocks the water). `TIER.lights`: 60k,
  30k on low. World draws the lights last (over the roofs).
- Counts: Raleigh, Miami, San Francisco 60k (27k street); New York 60k (20.7k street, every road).
  Worker: lights 40-150 ms after the flood data (Raleigh flood 0.7-0.9 s, New York 65 ms).
- Checks: typecheck; vitest 118/118; Raleigh and New York storm overview in Dark at 1440 (lights
  on), Raleigh planning in Dark (no lights), `?realism=off` storm (no world, no worker).
- Found, not changed (upstream camera): the director's opening tilt to the overview (at 250 ms)
  does not happen; the camera stays flat at the planning frame until the first helicopter flight
  (~3.7 s) and reaches the overview (Raleigh z11.2, New York z12.8, pitch 55) only after it.
  The screenshot script holds the director's own overview camera from 0.3 s.
- Next exact step: O2 blackout (flood / quake / heat characters, reduced motion per step).

### 2026-10-04 02:09 EDT Claude (Opus 5.5) lane C, realism final rebase checkpoint and full matrix
- Rebased sakhi/realism onto main 4cdffd8 (group/main moved: Main menu button, Gemini news desk,
  Solana records and cards, cities in rooms, civic signals). Only docs conflicted (DECISIONS, R1;
  rerere replayed the earlier resolutions); Solo.tsx merged cleanly. Every replayed commit
  typechecks (`git rebase -x`). Backup at `backup/realism-pre-rebase-2` (local). `npm install`
  for upstream's Solana/Metaplex server deps (lockfile unchanged).
- Rooms now carry a city (host picks it); they write `?city=` before the game renders and the game
  remounts per round, so the realism city logic (flood-only water, Raleigh-only files, NC aerial)
  follows the room's city unchanged. Checked with a Miami room (world water present).
- Full matrix: typecheck; vitest 112/112 (17 files); pipeline unittest 33 OK. Every city /solo
  planning -> storm -> results, realism on and off, 1440 and 390 (16 runs); globe landing into each
  city; hosted rooms in Raleigh and Miami through election, storm and results; news desk in every
  storm (template lines: GEMINI_API_KEY is empty here); no console errors. The first run after a
  dev-server start can hit Vite's dependency re-optimization reload; rerun it (done for Raleigh).
- Screenshots: docs/screenshots/realism/ (city day and night, Crabtree storm and aftermath, the
  other three cities' storms at 1440, Raleigh storm and results at 390).
- Not done: creek flow streaks (optional per the user). The quiet-machine A/B (5 alternating runs
  per mode, median, 1440 and 390) waits for the user to stop other servers; then remove the
  `?realism=off` kill switch and its MapLibre-only paths if it passes.
- Next exact step: ask the user, run `node app/scripts/storm-ab.mjs 1440 900 1 5 realism=off ""` and
  `node app/scripts/storm-ab.mjs 390 844 4 5 realism=off ""`, record medians here.

### 2026-10-04 01:54 EDT Claude (Opus 5.5) lane C, realism R6 (ending, rain ripples)
- Done: water.ts: the waves settle as the storm clears (amplitude and speed down with `ending`,
  on top of R4's drain and foam fade); rain ripples (RIPPLES_GLSL: a drop per 5 m cell, ring to
  2 m over 0.9 s, normal tilt + faint --foam highlight; storm clock, street zoom, not at the
  ending, not under reduced motion, not on the low tier: `TIER.ripples`). One check frame at
  Crabtree (night, z17.6): faint rings across the water.
- Not done: creek flow streaks (user: only if everything else is done; the final checkpoint and
  the full matrix come first).
- Checks: typecheck; vitest 85/85; Raleigh /solo storm -> results at 1440 (default and
  `?quality=low`), no console errors. One 1440 trace (realism, load ~4): 5.5 avg / 8.1 p95 /
  21 max ms, 59.8 fps.
- Next exact step: the final rebase checkpoint (Step 0 rules: `git fetch group`; if group/main
  moved, fast-forward main and rebase, combining conflicts by the same rules; stop and ask only
  for a product decision). Then the full matrix: every city, realism on and off, 1440 and 390,
  hosted room, news desk, Python tests, the screenshot set; ask the user before the quiet-machine
  A/B (5 alternating runs per mode, median). Remove `?realism=off` only after that passes.

### 2026-10-04 01:49 EDT Claude (Opus 5.5) lane C, realism R2 (cheap ground shadows)
- Done: buildings.ts draws a shadow pass before the buildings: the same triangles projected along
  the sun to the ground (vertex shader, `building.shadow` uniform), --shadow at 25% (fainter at
  night), premultiplied; depth "less" + depth snapped up to 1/16384 so overlapping shadows never
  double. `sunVector()` moved to lights.ts (water and shadows share it). Tier: off on low.
- What went wrong on the way: model.setParameters per pass replaced deck.gl's blending (shadows
  came out as opaque color over the page) and rebuilt the pipeline; now only gl.depthFunc is
  switched and restored. Then the shadows were blue: the building passes blend premultiplied
  (the water does not; both measured by pixel, see DECISIONS).
- Checks: typecheck; vitest 85/85; Raleigh /solo storm -> results at 1440, no console errors;
  pixel check downtown: a shaded ground pixel goes from (119,127,139) with shadows off to
  (96,104,118). One 1440 trace (realism, load ~4): 5.6 avg / 8.0 p95 / 28 max ms, 59.8 fps.
- Next exact step: R6: the ending (the water lowers and the foam fades as the storm clears: the
  drain exists, check it reads; consider lowering the flat surface's alpha too) and rain ripples
  on the water (rings from a hashed grid of drops on the storm clock, in water.ts, uniforms only,
  off under reduced motion and on the low tier). Creek flow streaks only if everything else is done. Then the
  final rebase checkpoint and the full matrix (ask the user before the quiet-machine A/B).
- Gotchas: the building passes blend premultiplied, the water straight; check a new translucent
  pass by pixel. Never call model.setParameters per frame.

### 2026-10-04 01:42 EDT Claude (Opus 5.5) lane C, realism R7 (quality tiers, reduced motion, docs)
- Done: `world/quality.ts` (TIER: high / medium / low, auto from device or `?quality=`); water.ts
  builds 3/2/1 noise octaves and drops foam on low; windows.ts fades the grid sooner on medium and
  keeps only its average on low; buildings.ts sinks the city at TIER.farPx; MapView caps the map's
  pixel ratio (3/2/1.25) under realism. Reduced motion was already wired through `frame.reduce`
  (no creep, waves, foam, rise, drain, flicker, water lightning, street dashes): checked with
  REDUCE=1. DESIGN.md: "The world" section (tokens, city, water, stains, windows, tiers, reduced
  motion, kill switch), notes in "Water (flood)" and "Performance floor".
- Kill switch: kept. The final check (quiet-machine A/B + full matrix with realism on and off)
  moved to the end (user), so `?realism=off` is removed only after it passes.
- Checks: typecheck; vitest 85/85; Raleigh /solo storm -> results at 1440 for the default tier,
  `?quality=medium`, `?quality=low` and REDUCE=1: no console errors (framer-motion's reduced-motion
  note only). One 1440 trace (realism, high, load ~6): 5.8 avg / 9.4 p95 / 37 max ms, 59.7 fps.
- Next exact step: R2 ground shadows, cheap only (user: skip deck.gl's built-in shadows). Plan:
  a flat --shadow footprint offset away from the sun (SUN_FROM), drawn by the building layers'
  roofs again at z=0 with a sun-projected offset in the vertex shader, or a 2D shadow pass from
  the roof polygons; then R6 (ending, rain ripples; creek streaks only if time allows), the final
  rebase checkpoint, then the full matrix (ask the user before the A/B).
- Gotchas: tier shader variants only compile on their tier; smoke-run `?quality=medium` and `low`
  after shader edits.

### 2026-10-04 01:37 EDT Claude (Opus 5.5) lane C, realism R3 (windows, flooded windows go dark)
- Done: `world/windows.ts` (shader module: pane grid from wall meters, ~3 m columns fitted to the
  wall, 3.2 m floors, fwidth anti-aliasing, fades to the average tone and glow at 0.7-1.6 m per
  pixel; --glass-day by day, --glass-night and 36% --window-lit at night, the glow added after
  lighting). `stain_dark` in world/stains.ts: once the water reaches a building its lights flicker
  and go out up to 4 s later (hash of the seed), storm clock only. buildings.ts wires both
  (BuildingPaint gains `windows`). Checked by eye at Raleigh downtown (day/night, near/far) and at
  Crabtree in Dark mode: the flooded mall's windows are lit before the storm and dark after; the
  dry apartments above stay lit.
- Checks (user's per-step routine from here: typecheck, TS tests, one Raleigh smoke run, one 1440
  trace): typecheck; vitest 85/85; Raleigh /solo storm -> results at 1440 (and the four cities,
  390 for Raleigh/Miami, a hosted room, before the routine changed): no console errors.
  One 1440 trace (storm time 1 s on): realism 5.4 avg / 8.0 p95 / 20 max ms, 59.9 fps (a
  realism=off run at the same time: 6.6 / 9.4 / 30). The machine was quiet (load ~3).
- Next exact step: R7: quality tiers (low/medium/high by device), prefers-reduced-motion for the
  world layers (no creep, waves, foam, rise, flicker: `frame.reduce` already freezes the water;
  check windows/stains), DESIGN.md world section, then remove the `?realism=off` kill switch only
  after R7 passes. The official A/B waits for the end (user: quiet machine, ask first).
- Gotchas: the quake and heat cities have no flood data, so `stain_dark` never fires there (New
  York's blackout stays upstream's DOM flicker).

### 2026-10-04 01:12 EDT Claude (Opus 5.5) lane C, realism rebase onto the four-city main + four-city adaptation
- Rebased sakhi/realism (semantic zoom S1-F3, realism R0-R5, 17 commits) onto main 6434b22
  (group/main unchanged at the second fetch). rerere on; backup of the old branch at
  `backup/realism-pre-rebase` (local only). Every replayed commit typechecks (`git rebase -x`).
  Rules used: upstream wins on game behavior (cities, globe, news desk, Gemini, buses), this branch
  on rendering (semantic zoom, deck.gl world, tokens, `?realism=off`), both kept where both changed.
- Conflicts and how they were combined:
  - basemap.ts: satellite toggle (imagery palette field, `palette`/`basePalette`, satellite source
    and layer) + places palette, detail sources, NC aerial layer above the satellite layer;
    `applyPalette` repaints color/opacity/brightness/saturation/contrast; `TILES` re-exported from
    world/tiles.ts for the globe; `siteTints` kept.
  - useFloodMap.ts: dry candidate sites only while a shelter is armed (upstream) + squares hide at
    z15 for sites drawn as their building (S5); existing shelters + hexFade imports.
  - usePlanning.ts, Hud.tsx: upstream's city-aware text functions with "marked building".
  - styles.css: world tokens + upstream's Devanagari font stacks.
  - MapView.tsx, Solo.tsx: both imports. flood.ts: per-city `dataBase()` + realism setup.
  - Weather.tsx: upstream's thunder/buzz/quake/heat + the lightning `strikes` for the water.
  - detail.ts (S3-F1): upstream removed `DATA_BASE`; now `dataBase()` from story.ts.
  - docs: entries in time order (PROGRESS newest first, upstream's own order untouched).
- Follow-up commits: (1) the 3D water drains at the storm's end (`FloodView.drain`, director),
  not on "day + full water" (upstream's clock brings dawn mid-storm); (2) four cities: realistic
  water + stains only for flood hazards, from each city's data; quake/heat keep MapLibre ground
  looks over the 3D city; Raleigh-only files (bus_stops, care_homes, site_buildings) and their
  credits only in Raleigh; NC OneMap aerial only in North Carolina and off under Satellite;
  (3) site buildings (2D/3D) follow the armed shelter (dry only), GoRaleigh atlas stops hide while
  a bus is armed (`useMapUi.siteTargets/stopTargets`).
- Checked: typecheck; vitest 85/85 (12 files, incl. Gemini harness 8); pipeline unittest 33 OK.
  All four cities /solo planning, storm, results, realism on and off, 1440 and 390; globe landing
  into each city; hosted room lobby -> election -> storm -> results; news desk in every storm; no
  console errors. `npm run ai:smoke -w server`: GEMINI_API_KEY empty, prints the template note.
  `npm install` was needed for upstream's @google/genai (lockfile unchanged).
- Frame times (Raleigh, A/B medians, from storm time 1 s):
  | Run | realism=off avg / p95 / max | realism avg / p95 / max |
  |---|---|---|
  | 1440 x 900, 3 runs | 8.5 / 13.2 / 36 (59.3 fps) | 7.4 / 15.6 / 49 (59.0 fps) |
  | 390 x 844, CPU 4x, 2 runs | 19.9 / 27.4 / 49 (48.2 fps) | 17.6 / 24.4 / 47 (52.3 fps) |
  Not comparable with the pre-rebase rows (upstream changed the storm and phone framing); compare
  within a row. A first 390 A/B hung in its first trace (headless Chrome never ended the trace);
  killed, the rerun was clean. 1440 p95 stays unconfirmed until the quiet-machine R7 check.
- Next exact step: R3 windows (+ flooded windows go dark per building).
- Gotchas: zsh treats `$c:a...` as a path modifier; write `"${c}:app/..."`. The first page load
  after `npm install` re-optimizes Vite deps and reloads the page mid-script; rerun. Upstream's
  results text can print "-0" ("Your plan reached -0 of ..."), not from this branch.

### 2026-10-04 00:30 EDT Claude (Opus 5.5) lane C, realism rebase checkpoint after R5 (stopped: code conflicts)
- `git fetch group`: group/main moved 1eba02e -> 6434b22 (9 commits: bus demand report, existing
  shelters/stops baseline, four cities + globe landing + news desk merge, Gemini harness, news
  anchor fix). Local `main` fast-forwarded to 6434b22. sakhi/realism is unchanged at its R5 commit:
  no rebase was started (previewed with `git merge-tree --write-tree main sakhi/realism`).
- Code conflicts (hunks / lines in conflict): basemap.ts 7 / 110, useFloodMap.ts 2 / 34,
  styles.css 1 / 27, Hud.tsx 2 / 22, Weather.tsx 2 / 21, usePlanning.ts 1 / 11, flood.ts 1 / 9,
  MapView.tsx 1 / 5, Solo.tsx 1 / 5; plus docs (DECISIONS, PROGRESS). Per the Step 0 rules the
  rebase stops here for the user. The 16 branch commits (semantic zoom S1-F3, R0, R1, R4, R5)
  are not upstream.
- Python: `pipeline/.venv/bin/python -m unittest discover -s pipeline/tests`: 33 tests OK
  (pytest is not installed in the venv or in requirements.txt; the README's command is unittest).
- Next exact step: the user decides how to resolve the conflicts (or to continue R3 on the current
  base and rebase later); then R3 windows + flooded windows going dark.

### 2026-10-04 00:28 EDT Claude (Opus 5.5) lane C, realism R5 (wet stains on walls)
- Scope (user decision): R5 = wet stains on walls below the water line that stay after the water
  drops. The flooded-window blackout moved to R3 (it lives in the windows shader). The 3D water
  rise already landed in R4.
- Done: `world/stains.ts` (shader module `stain`: samples the flood worker's extent texture for
  where each step's water reaches and the arrival texture for when; peak height = DEPTH_M[k] x
  rise x a taper near the step's edge, max over the 3 steps; walls below it get --wet-stain-day /
  --wet-stain-night, darkest at the foot, a ragged wicking edge ~0.2 m above the water line in
  wall meters, and a darker tide line; gated by `frame.level` so planning shows none). The rise is
  monotonic (the ending only drains the surface), so stains keep the peak through the results.
  `world/water.ts`: the rise formula is shared GLSL (`RISE_GLSL`, `flood_rise`) used by the water
  and the stains; the flood textures are cached per device (a WeakMap; the module-level cache
  would hand a second map, e.g. /solo left and re-entered, textures from a dead GL context);
  `dryTexture()` (1x1 dry land) is bound until the worker is done, since luma.gl throws on a
  missing binding. `world/buildings.ts`: `flood` prop on both building layers, stain module,
  bindings set once when the flood data changes. `world/world.ts`: setWater passes the data to
  the city and the site layers (clone, not per frame).
- Frame times (A/B medians, `app/scripts/storm-ab.mjs`, from storm time 1 s, load average ~4):
  | Run | realism=off avg / p95 / max | realism avg / p95 / max |
  |---|---|---|
  | 1440 x 900, 3 runs | 8.4 / 13.9 / 56 (59.2 fps) | 7.5 / 15.1 / 41 (58.7 fps) |
  | 390 x 844, CPU 4x, 2 runs | 29.1 / 41.6 / 70 (34.1 fps) | 25.4 / 34.7 / 66 (38.4 fps) |
  1440 p95 is unconfirmed until the R7 check on a quiet machine (user decision: 5 alternating
  runs per mode, median, ask the user first; they stop Codex and other servers).
- Checked: close shots at Crabtree Valley (results: lower walls stained after the drain; planning:
  clean walls; storm: the 3D water covers the lower walls), /solo storm + Skip at 1440 and 390,
  `?realism=off` storm + results, /play/:code?host lobby -> election -> storm -> Skip -> results;
  no console errors. typecheck, vitest 60/60. No Python changes.
- Next exact step: the rebase checkpoint (Step 0 rules): `git fetch group`; if group/main moved,
  fast-forward main and rebase sakhi/realism on it (docs conflicts in time order, PROGRESS newest
  first; any code conflict: abort and show the user). Run pytest from the pipeline's own venv
  (pipeline/README.md; create it per the README if missing). Then R3 windows, including flooded
  windows going dark per building (arrival + hash(seed) x 4 s, from the stain module's textures).
- Gotchas: GLSL `smoothstep(e0, e1, x)` with e0 > e1 is undefined (on Metal it gave no stain at
  all); write `1.0 - smoothstep(e1, e0, x)`. Take `fwidth` in uniform control flow (main) and pass
  it in. MapLibre caps pitch at 60, so walls are seen at a glancing angle and the day stain reads
  as a darker band low on the walls. drive.mjs: a `waitFor`/`eval` that returns a non-serializable
  object (e.g. `window.__world`) crashes the script; use `!!`. Stubbing `__map.flyTo/easeTo/jumpTo`
  from a script pins the camera mostly, but the director still moves it sometimes.

### 2026-10-04 00:05 EDT Claude (Opus 5.5) lane C, realism R4 (living storm water in deck.gl)
- Done: `world/floodData.ts` + `world/flood.worker.ts` (water geometry + arrival and extent
  textures, built once in a worker, ~0.5 s), `world/glsl.ts` (hash, value noise with gradient),
  `world/water.ts` (`WaterLayer`: creep from the creeks, foam band behind the edge, 3 octaves
  of noise in meters faded by zoom, sky fresnel, sun highlight by day, lightning by night, deep
  tokens for step 1 / regular for step 3 / blend for step 2, preview blue in planning, 3D rise by
  DEPTH_M 6/3/1.5 m when tilted, drained by `ending`), `world/submerged.ts` (submerged streets
  as deck PathLayers with a flowing dash on a time uniform). FloodView: creates the water from the
  worker, hides the MapLibre water layers under realism, skips its per-frame feature-state and
  paint writes, and writes `frame` (level, stepP, clock, stepStart, ending, flash, tilt) per
  frame. director.ts passes the storm clock (RevealFn element 3) and step starts; Weather.tsx
  publishes lightning strikes. MapLibre path untouched under `?realism=off`.
- Frame times (A/B medians, `app/scripts/storm-ab.mjs`, from storm time 1 s, same round):
  | Run | realism=off avg / p95 / max | realism avg / p95 / max |
  |---|---|---|
  | 1440 x 900, 3 runs | 10.5 / 20.6 / 80 (57.5 fps) | 10.0 / 17.4 / 83 (58.1 fps) |
  | 1440 x 900, 3 runs (earlier round) | 8.3 / 13.9 / 74 (59.2 fps) | 10.4 / 19.5 / 128 (56.8 fps) |
  | 390 x 844, CPU 4x, 2 runs | 30.4 / 42.4 / 84 (30.6 fps) | 25.2 / 35.0 / 60 (38.3 fps) |
  Dropping the MapLibre per-frame water writes pays for the shader on the phone. At 1440 the
  p95 is still over 16.7 ms in both modes in a loaded machine; the residents (left as they are,
  per the user) cost 0.3 ms JS + 0.5-1.5 ms uploads at 1440 and 1.3 ms JS on the phone (R0).
- Checked: /solo storm + Skip to results, /play/:code?host lobby -> election -> storm -> Skip ->
  results, with and without `?realism=off`; no console errors. typecheck, vitest 60/60. No
  Python changes (pytest not installed in this shell's python3; earlier 33/33 in Step 0).
- Next exact step: R5. The rise is already in water.ts (vertex shader, `water_rise`). Remaining:
  building stains (BuildingLayer/CityLayer fragment samples the extent texture to find the first
  step covering a wall, and the arrival texture for when; below the water height use
  --wet-stain-day/night; the stain uses the peak level so it stays after the ending) and windows
  going dark per building (arrival + hash(seed) x 4 s; lands with R3 windows if simpler, note it).
  `floodTextures(device, d)` in water.ts is the shared texture cache to bind into the building
  layers. Then the rebase checkpoint: `git fetch group`; if group/main moved, fast-forward main
  and rebase (docs conflicts in time order, PROGRESS newest first; any code conflict: abort and
  show the user).
- Decisions a new session needs: step order R0, R1, R4, R5, R3, R7, R2, R6 (one commit + one
  PROGRESS handoff each, with frame times). R6b dropped: residents, glow, rings and halos in
  storm/layers.ts stay as they are; the zero-per-frame rule covers the world layers and FloodView
  only; report the residents' cost separately and ask before touching them if they break the
  budget. `?realism=off` keeps the MapLibre water and buildings-3d path until R7 passes. Every
  commit leaves /solo, /host, /play/:code playable; revert a step that breaks the game. Rebase
  checkpoints after R5 and at the end. No push, no merge commits. Pause/speed/scrub don't exist
  (only Skip); everything follows the storm clock.
- Open problems: 1440 p95 sits around 17-20 ms in both modes on this loaded M1 (load 4-20), so
  the R7 budget check needs a quieter machine or more runs. Pre-existing long tasks when tiles
  load: flood.ts clipSoon (~68 ms) and detail.ts mark (~42 ms). Camera drags from scripts don't
  stop the helicopter director; screenshots use the director's views.

### 2026-10-04 Claude (Opus 5.5) merge of feat/new-features-adit (four cities) into main
- Done: merged Adit's cities (Miami, San Francisco, New York), globe landing, narrated briefing,
  weak spot, storm timeline, news desk, map modes, themes with tonight's engine work. 10 files
  conflicted; both sides kept (per-city data base + existing shelters/stops; city stories + our
  HUD/status texts; weak spot + bus area/links/existing shelters layers).
- Verified: typecheck; 76/77 tests (only the bench timeout); all four cities load and score in the
  browser with no console errors.
- Next (team decision): real models for New York (heat) and San Francisco (quake); scale the budget
  or at-risk definition for cities above 20% at risk; existing shelters and stops for the new cities.

### 2026-10-04 Claude (Opus 5.5) lanes B+C, playtest fixes: bus seat reserve, useful roads
- Done: 10% bus seat reserve per shelter (riders most vulnerable first), useless roads hidden
  (usefulRoads in plan/targets.ts), green dots explained, bigger stop markers, optimal plan rebuilt.
- Verified: 70/71 tests (only the bench timeout); 5,000 random monotonicity trials; the playtest
  case (shelter + new stop in Thornton Commons) now adds 56 residents instead of 0.
- Next: tune BUS_SEAT_SHARE after more playtests; consider fading green dots that existing
  shelters already cover.


### 2026-10-03 23:41 EDT Claude (Opus 5.5) lane C, realism R1 (3D city in deck.gl, world tokens, piece outlines)
- Done: 15 world tokens in styles.css + tokens.ts (`unit()` gives shader floats). `app/src/world/`:
  state.ts (`frame` uniforms, REALISM / `?realism=off`, WORLD_BEFORE = 'road-closed'), lights.ts
  (LightingEffect: warm low sun, cool moon, mutated in place by FloodView's mood fade),
  solids.ts (roofs + wall quads, normals, wall coords, seeds; fp64-split lng/lat; tile clipping),
  tile.worker.ts + tiles.ts (2-3 workers fetch + parse + build; one tile handed over per frame),
  buildings.ts (`CityLayer`: Tileset2D, z14 only, extent = sites + 2 km, cache 32, one Model,
  first tile via luma, the rest raw VAO + drawElements; per-fragment Phong; buildings sink into
  the ground toward 1800 screen px from the center; `BuildingLayer` for fixed sets), world.ts
  (owns the layers; MapView merges them under the route's layers and passes the lights).
  FloodView creates the World, hides MapLibre `buildings-3d` when tilted under realism, writes
  `frame.night`. detail.ts publishes site footprints + heights (`onSiteSolids`) and leaves
  MapLibre `site-buildings-3d` off under realism (F1 kept: site tints by day, night walls in the
  storm). Pieces: 2 px ink outline in the map atlas (plan/pieces.ts ATLAS_CELL).
- Contrast: HUD plates and piece faces are opaque bond/ink (13.4:1; signal on ink 9.0:1). The
  piece edge over its background: ink vs day walls 9.6:1, bond vs night walls 11.5:1; over a
  mid-grey aerial pixel the ink outline is 3.3:1 (meets 3:1 for graphics, not 4.5:1; no ink in
  the palette reaches 4.5:1 on mid-grey).
- Frame times (A/B medians, alternating runs, `app/scripts/storm-ab.mjs`, from storm time 1 s):
  | Run | realism=off avg / p95 / max | realism avg / p95 / max |
  |---|---|---|
  | 1440 x 900, 3 runs | 10.3 / 18.6 / 51 | 10.2 / 20.1 / 60 |
  | 1440 x 900, 3 runs (earlier, quieter machine) | 8.3 / 14.4 / 65 | 9.3 / 17.0 / 50 |
  | 390 x 844, CPU 4x, 2 runs | 31.3 / 47.3 / 93 (31.9 fps) | 29.4 / 44.0 / 67 (32.0 fps) |
  The machine's background load (Spotlight, other apps; load average 4-20) moves the baseline by
  2 ms avg and 4 ms p95 between rounds, so compare within a row. R1 adds about 0-1 ms avg and
  1.5-2.6 ms p95 at 1440, nothing measurable on the throttled phone.
- What did not work (kept out): deck.gl MVTLayer/SolidPolygonLayer (main-thread attribute builds,
  108-142 ms frames per new tile); TileLayer with one sublayer per tile (per-layer uniform work,
  ~7 ms a frame on the throttled phone); a hidden TileLayer (still loads tiles); z13+z14 tiles.
- Tooling: `storm-ab.mjs` (alternating A/B medians), `trace-cpu.mjs` (top functions of a
  `{trace, cpu:true}` run, main thread only), drive.mjs logs 3000 chars of console. Dev timing
  measures are opt-in (`?fxtime`); dev flags `?nocity` and `?nolight` for comparisons.
- Next exact step: R4. Uncommitted drafts are in the tree: world/floodData.ts + flood.worker.ts
  (water geometry, arrival + extent textures), world/water.ts (WaterLayer), world/glsl.ts,
  world/submerged.ts (submerged streets as deck PathLayers with a flowing-dash extension). Wire
  them into FloodView (worker at load, hide MapLibre water layers under realism, frame uniforms
  from RevealFn; director passes the storm clock as element 3 and step starts).
- Gotchas: an orphaned headless Chrome from an earlier session (5:42 PM, 6:44 PM) ran at 340% CPU
  and skewed the first traces; I stopped both (PPID 1, headless, swiftshader). Editing a module
  the page imports triggers Vite HMR and disturbs a running trace; don't edit app/src during an
  A/B. zsh does not split `$var`; quote args or use separate commands.

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


### 2026-10-03 21:21 EDT Claude (Opus 5.5) lane C, realism R0 (baseline storm traces)
- Branch `sakhi/realism` from sakhi/semantic-zoom rebased on group/main 1eba02e. Never pushed.
  The plan (R0-R7, user order R0 R1 R4 R5 R3 R7 R2 R6, R6b dropped) is in the task brief.
- Done: trace tooling. `app/scripts/drive.mjs` gains `{throttle:N}` (CDP CPU throttling) and
  `{trace:ms, file}` (Chrome performance trace via CDP Tracing). `app/scripts/trace-stats.mjs`
  summarizes a trace: per frame, `main` = the renderer main-thread task that ran the
  animation-frame callbacks, `gpu` = GPU-process GPUTask time until the next frame, `frame` =
  max(main, gpu); plus presented fps and dev `performance.measure` timings.
  `app/scripts/storm-trace.mjs <w> <h> [throttle] [query] [file]` opens /solo?skip, places the
  optimal plan, starts the storm (it tilts to 55 degrees and the helicopter flies) and traces 24 s.
- Done: `app/src/dev/fx.ts` (dev only, loaded by MapView): per-frame counts of MapLibre
  setData/setFeatureState/setPaintProperty/setLayoutProperty/setFilter and deck.gl attribute
  uploads by layer (`window.__fx.summary(sinceStormMs)`), and timings `map-render`,
  `storm-layers` (MapView's storm rebuild), `flood-frame` (FloodView), `attrs <layer>`.
- Baseline (GPU=1 headless Chrome, Apple M1, from storm time 1 s to 24 s, ms):
  | Run | frame avg | p95 | max | fps | map-render avg | residents JS + uploads |
  |---|---|---|---|---|---|---|
  | 1440x900 dpr 1 | 8.5 | 12.9 | 39.8 | 59.2 | 6.7 | 0.3 + ~0.5 |
  | 390x844 dpr 2, CPU 4x | 27.5 | 39.2 | 67.2 | 37.0 | 20.7 | 1.3 + ~1.5 |
  Runs vary by about 1 ms on the average (a second 1440 run gave 6.8 / 11.1). GPU time is small
  (2.5 avg) at both sizes; the cost is CPU (MapLibre render + deck draw).
- Per-frame writes today (390 run, after 1 s): setFeatureState on `flood` 15,888 in the storm,
  setPaintProperty on water-1..3 and submerged-flow-0..3 every frame, and every storm resident
  layer (storm-glow, -stranded, -residents, -halos, -trails) re-uploads all its attributes each
  frame (a new data object per frame). The residents stay as they are (user decision).
- Next exact step: R1. Add the 15 color tokens to styles.css and tokens.ts; app/src/world/
  (clock.ts, buildings.ts with a TileLayer + MVTLoader binary wgs84 + BuildingLayer, lights);
  FloodView swaps buildings-3d for the deck layers when tilted; `?realism=off` keeps the old path.
- Gotchas: run the traces with `bash` or quote args; zsh does not split `$var` in a for loop (a
  first attempt traced at a bogus size). Headless Chrome runs at 60 Hz with GPU=1.

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


### 2026-10-03 20:29 EDT Claude (Opus 5.5) lane C, semantic zoom screenshots and final check
- Done: docs/screenshots/semantic-zoom/tilted-planning-{1440,390}-z{15,17}.jpg (3D on, pitch
  45, Broughton High in the site color, unmatched site squares above the 3D buildings; aerial
  at z17). JPEG, 326-480 KB each (1440 z15 at quality 62, z17 at 70, 390 at 80).
- Final check: branch = group/main 1f8ec6a + 12 commits, 0 merge commits, nothing pushed.
  typecheck; 57 TS tests; 33 Python tests (pipeline/.venv); python3 test_detail 9. Two-player
  room check rerun (host /host/SZQB?host 1440, phone /play/SZQB 390): joined, both locked, storm
  started on both 2 ms apart; phone detail at z15/z17, none at z12; no console errors.
- Next exact step: team review of sakhi/semantic-zoom before any merge (none done here).
- Gotchas: the P9 handoff entry (18:40) sits inside the `<!-- Newest first. Template:` comment in
  this file, so it is hidden when rendered; left as upstream wrote it.

### 2026-10-03 20:27 EDT Claude (Opus 5.5) lanes A+C, semantic zoom F3 (nursing homes and assisted living)
- Finding: 182 z14 tiles over the study area hold one care home (`hospital/nursing_home`,
  Hillcrest); OpenMapTiles drops `amenity=social_facility`, how OSM tags most of them.
- Done: pipeline/care_homes.py (stdlib; Overpass cached in pipeline/cache/care_homes_overpass.json
  + .query; `read_homes` keeps nursing_home / assisted_living, drops repeats of one place) wrote
  app/public/data/care_homes.json: 18 places (13 assisted living, 5 nursing homes), 2,060 bytes;
  meta.json `sources.careHomes`, `careHomes`. refresh_detail rebuilds it too (offline).
  `overpass()` takes the script name for its cache messages. App: detail.ts source `care-homes`,
  pictogram `place-care` (house with a heart), layer `care-homes` (z14 icon, z15 names, places'
  palette colors), just below `places` in label priority. README, DESIGN row, DECISIONS line.
- Verified: python3 test_detail 9 OK (care-home kinds, names, the doubly mapped Glenaire), venv
  suite 33 OK (rebuild tests now also require sources.careHomes), typecheck, 57 TS tests. Shots:
  z12 0 care homes; z14 2-3 near Crabtree (Hillcrest with its name at z15), day and storm.
- Next exact step: commit the tilted-planning screenshots (z15, z17 x 1440, 390) under
  docs/screenshots/semantic-zoom/ as JPEG < 500 KB each; rerun the two-player room check.
- Gotchas: Overpass answered 504 twice in a row during this run; a later retry worked.

### 2026-10-03 20:23 EDT Claude (Opus 5.5) lane A, semantic zoom F2 (rebuild keeps the detail sources)
- Done: bus_stops.py and site_buildings.py refactored to `build(data_dir, cache_dir, refresh=False,
  offline=False)` (main() wraps it); `MissingCache` for offline runs without a cache. New
  pipeline/detail.py `refresh_detail()`; build_all.py `finish(p2_only, data_dir, cache_dir)` runs
  build_flood (unless --p2-only) then refresh_detail, last. Overpass caches now keep their query
  in `<cache>.query` (stale answers refused; old caches adopted once). meta.siteBuildings has
  `osmFetched` instead of `built`. README section updated.
- Tests: test_detail.py +3 (refresh restores sources.busStops / sources.siteBuildings and both
  blocks; offline + no cache raises and never calls urlopen; changed sites.json refuses the
  cache). New test_rebuild.py (venv): build_all.finish with a flood stage that rewrites meta.json
  ends with both sources and blocks; --p2-only path too. With refresh_detail stubbed out both
  rebuild tests fail ("meta.json lost sources.busStops"). Real offline refresh on
  app/public/data: data files byte-identical, meta.json only `built` -> `osmFetched`.
- Verified: python3 test_detail 8 OK; venv suite 32 OK; typecheck; 57 TS tests.
- Next exact step: F3 care homes. pipeline/care_homes.py (Overpass: amenity=social_facility +
  social_facility=nursing_home|assisted_living, amenity=nursing_home; study-area bbox
  35.6978,-78.8311,35.9813,-78.4596) -> app/public/data/care_homes.json + meta; add it to
  refresh_detail and its tests; app layer `care-homes` (z14 icon `place-care`, z15 names).

### 2026-10-03 20:20 EDT Claude (Opus 5.5) lane C, attribution stays folded (found during the room check)
- Done: MapView.tsx folds the compact attribution when MapLibre opens it on its own (a
  MutationObserver on the control, disconnected after that fold or on the player's first click).
  It used to wait for the first 'idle', which the water shimmer delays: on main it was open at
  load, and with the semantic-zoom aerial it stayed open; at 390 px it covered "Start the storm".
- Verified at 390: folded at load and at z17; one click on (i) opens it with "Bus stops: GoRaleigh
  GTFS | Imagery: NC OneMap, NC Center for Geographic Information and Analysis | OpenFreeMap ©
  OpenMapTiles Data from OpenStreetMap". typecheck.
- Next exact step: F2. Refactor pipeline/bus_stops.py and site_buildings.py into
  `build(data_dir, cache_dir, refresh=False, offline=False)`; add pipeline/detail.py
  `refresh_detail()` (offline, from cache) called last by build_all.main; tests in
  pipeline/tests/test_detail.py.

### 2026-10-03 20:18 EDT Claude (Opus 5.5) lane C, semantic zoom F1 (3D shelters)
- Context: branch rebased onto group/main 1f8ec6a (P9 rooms, P15 live). Rebase stops resolved per
  the user's rules (DECISIONS both sides in time order; PROGRESS upstream checklist kept, my
  section and entries placed by time; Solo.tsx room block kept, then the coverage rim lines).
  Then: npm install, typecheck, 57 TS tests (8 files, incl. rooms + live), 27 Python tests in a
  new claude/pipeline/.venv (python3.11, requirements.txt). Two-player room check (host
  /host/SZQA?host at 1440, phone /play/SZQA at 390): join, lock, storm started on both 3 ms apart;
  detail layers on the phone at z15/z17, none at z12; no console errors.
- Done (F1): detail.ts `siteBuilding3dLayer(P)` (fill-extrusion on the site-buildings source,
  visible when pitch > TILT_3D, exported from flood.ts) and, in installDetail, a debounced pass
  after omt tiles load / moveend that reads the tile building's render_height under each site in
  view (probe points inside the footprint) into feature-state `height`. Footprints are pushed out
  0.8 m (`pushOut`). basemap.ts palette `site3d` (bond->ink 55%) / `site3dFloods` (20%); storm =
  storm-building for both. Placed right after `buildings-3d` in the style.
- Verified: typecheck, 57 TS tests. Tilted 1440 shots: z15 10 site extrusions, all with a tile
  height; z17 Broughton in the site color, unmatched squares above the 3D buildings; flooded
  Washington Elementary pale; storm: Broughton looks like any building. No console errors.
- Next exact step: fold the attribution on MapLibre's own open (MapView.tsx; it is only folded on
  `idle`, which the water shimmer delays: at 390 it covers "Start the storm"), then F2 (rebuild
  safety: pipeline/detail.py refresh_detail from cache, called last by build_all, with tests),
  then F3 (care homes from OSM via Overpass: the tiles hold 1 of 16).
- Gotchas: tile building ids are height-group ids (one id, many buildings); never feature-state
  them per building.

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
### 2026-10-03 23:00 (machine clock) Claude (Opus 5.5) for Adit, lanes C + D, V3.1 name, portraits, voices (branch feat/new-features-adit)
- Done:
  - The game is called Mayday Mayor: browser title, landing, title screen ("Mayday / Mayor" over
    the city), planning header ("Mayday Mayor", then "Raleigh · Flood, solo"), room lobby, planner.
    The repo, AGENTS.md and localStorage keys keep ready-raleigh.
  - City cards: the names lost `truncate` (overflow hidden + line-height 1 cut the g and y);
    cards still match in height because Play sits at the bottom.
  - Anchor portraits from Adit (two TV-frame images): cropped to the anchor, 480 x 360 JPEG, in
    app/public/anchors/america.jpg and bharat.jpg. The crops keep each image's LIVE badge and leave
    out its "Floods Devastate Raleigh" lower third and Raleigh sign, so they work for every city.
    The desk hides its own LIVE tag over a portrait, finds .jpg, .png or .webp, and Solo looks the
    portraits up on mount so the storm opens on them. Anchor box w-32 / sm:w-44 / lg:w-64, desk
    lg:w-[38rem]. One frame each: the portrait leans in with the voice (no talk frame yet).
  - Voices: America News is a woman (default Sarah), Bharat News a man (default George, Hindi).
    `america` no longer falls back to ELEVENLABS_VOICE_BROADCAST. Checked from the TTS cache: the
    storm's English reports were read by Sarah, the Hindi ones by George, on the model the .env
    names (eleven_multilingual_v2, so no language_code is sent; Hindi still comes out Hindi).
- Verified: typecheck; npm test 63/63; browser 1440 x 860 (landing names, title, America and
  Bharat portraits on the desk, Hindi reports, results) and 390 x 844 (desk with portrait).
- Next exact step: a mouth-closed frame per anchor (america-talk.jpg is the open one) would make
  them talk; otherwise done.
- Later (23:07): the title screen fits the window at 100% zoom. Two height variants in styles.css
  (`tall` 900 px and up, `short` under 700 px): Mayday Mayor is 120 px only on tall desktops,
  72 px otherwise, 48 px on short screens; the briefing card is wider on desktop (max-w-2xl) so
  "You have $10M and 3 minutes." is one line. Measured: the card ends on screen at 1440x900,
  1440x785, 1536x730, 1280x650, 1024x600, 390x844, 390x664 and 375x560. "Hear the briefing" is
  gone: the narrated tour starts at once from the globe (audio already on), and on the first tap
  or key when /solo is opened directly.

### 2026-10-03 22:45 (machine clock) Claude (Opus 5.5) for Adit, lanes C + D, V3 map looks and news channels (branch feat/new-features-adit)
- Done:
  - Storm layout (Solo.tsx): rows, so nothing overprints: the band with Skip, Satellite, Light or
    Dark and Sound under its right end; the news desk in the room left; then the timeline and the
    counters (or the results card). The desk is a side-by-side card (anchor | words) everywhere.
  - City cards (Landing.tsx): equal height, Play pinned to the bottom; New York's question is one
    line ("Who keeps cool when the grid fails?").
  - News timing (NewsDesk.tsx, ui/voice.ts, ui/sound.ts loadClip): the alert at 1.2 s, each report
    as the helicopter leaves (event.fly + 200 ms). A report more than 2.5 s late stays on the feed
    unspoken; a clip that would still play 250 ms before STORM_MS is not started. Lines are short;
    the news voices read at speed 1.1. The desk hushes when it leaves (the sky clears or Skip).
  - Two channels (news.ts): America News (English) and Bharat News (Hindi), tabs on the desk,
    remembered in localStorage. Each city's alert in both languages (story.ts `alert`); event
    phrasing per hazard and language (news.ts BOOKS); spoken numbers rounded ("About 230,000",
    "लगभग 2.3 लाख"). StormEvent `news` (English text) became `about` {kind, name}. Hindi is set in
    Noto Sans Devanagari (Google Fonts, in both font stacks; downloaded only when Hindi shows).
  - Server voices (server/src/voice.ts): `america` and `bharat` on POST /api/tts, from
    ELEVENLABS_VOICE_AMERICA and ELEVENLABS_VOICE_BHARAT; Bharat sends language_code "hi". A voice
    ElevenLabs refuses (402 for a library voice on the free plan) falls back to the default voice
    for that slot and is remembered as refused until the server restarts.
  - Anchor portraits (NewsDesk.tsx Anchor): app/public/anchors/america.png and bharat.png (4:3,
    top-aligned), optional america-talk.png / bharat-talk.png with the mouth open (flaps with the
    voice). Without them, each channel has its own cartoon in the inks.
  - Per-city storm clocks (story.ts `clock`, storm/clock.ts): Raleigh Fri 3 PM to Sat 9 AM, Miami
    Sun noon to Mon 8 AM, San Francisco Tue 7:40 AM to 10:40 PM, New York Mon 9 AM to Tue 9 AM,
    with October sunrise and sunset. Timeline bands day / dusk / night / dawn and a sun or moon.
  - Light / Dark (theme.ts, ThemeButton): Light is the day board, and in the storm the map follows
    the clock (dark from mid-dusk to mid-dawn); Dark is the night palette everywhere. One place sets
    the palette and the water look: map/mood.ts useMapMood (director.ts no longer does). Hospital
    labels, rain streaks and the landing globe follow it. Plates stay bond and ink.
  - Satellite (basemap.ts, SatelliteButton, useMapUi.satellite, remembered): Esri World Imagery
    above the printed land and water, below streets, the water steps and labels; green and
    footprints go clear, streets are faint lines; dimmed and greyed at night. Credited while on.
- Verified: typecheck; npm test 63/63 (new app/src/storm/clock.test.ts: bands, turns, labels,
  spoken numbers). POST /api/tts voice bharat (Hindi) and america: 200, 3.9 s and 3.7 s alerts.
  Browser 1440x800: equal cards, dark globe, dark board, satellite light and dark, New York storm
  (day at 1:40 PM, night by 9:30 PM, desk 108-355 px, counters from 635 px), Bharat News in Hindi,
  Miami title in Dark. 390x844: Raleigh storm, no overflow, controls row, desk, timeline.
- Next exact step: drop Adit's anchor portraits into app/public/anchors/ (names above) and check
  them on the desk; if he sets ELEVENLABS_VOICE_AMERICA / _BHARAT, restart `npm run dev`.
- Gotchas:
  - The automated browser pane stops drawing frames after ~10 s; resizing the viewport by 1 px
    (Emulation.setDeviceMetricsOverride) forces a fresh frame for a screenshot.
  - Esri imagery has stair-stepped dark patches over open water at city zooms (its mosaic).
  - The briefing narrator stays English on both channels.

### 2026-10-03 21:30 (machine clock) Claude (Opus 5.5) for Adit, lanes C + D, V2 four cities and the broadcast (branch feat/new-features-adit)
- Done:
  - Landing: interactive globe (map/globe.ts, MapLibre globe projection): drag to spin, scroll,
    pinch or +/- to zoom, slow auto-spin that pauses while you touch it. City markers and four
    city cards (cities.ts, ui/Skyline.tsx); Play flies into the city and hands off to the title
    orbit. The rooms plate (join, host, planner) is unchanged.
  - Four cities, one engine: `?city=raleigh|miami|san-francisco|new-york` (Raleigh by default).
    story.ts holds each city's words (title, narrated briefing, step names, band, headlines,
    anchor lines, button and result copy, piece names); dataBase() picks the folder. Raleigh keeps
    /data; the others read app/public/data/cities/<id>/ in main's contracts, converted from the
    feat/ready-raleigh-adit packs by shared/scripts/import-city.ts. map/flood.ts draws water for
    floods and a flat ground look (signal for the quake, alarm for the heat) for the others.
  - Voice (P13): server/src/voice.ts, POST /api/tts {text, voice: broadcast|narrator} via
    ElevenLabs REST, cached in server/.cache/tts (git-ignored); 503 without a key. GET /api/health
    now returns `voice`. ui/voice.ts plays clips through the game's AudioContext; captions only
    when voice is off.
  - Narrated briefing: "Hear the briefing" on the title (starts on its own once audio is
    unlocked); the camera flies to each tour stop while its sentence is said (useBriefingTour).
  - Find the weak spot (once per round): shared/src/engine/weakSpot.ts (+ test) and
    plan/WeakSpot.tsx: scan, fly to the road, highlight, "Protect it". Hidden where no road can be
    protected (New York).
  - Storm timeline: storm/Timeline.tsx + clock.ts, a 6 PM to 7 AM clock with dusk, night and dawn
    bands, pins at each step and event, and a playhead; the director fades the day map to night
    over 2.6 s.
  - News desk: storm/NewsDesk.tsx, a flat-ink cartoon anchor whose mouth follows the clip's
    analyser (a synthetic rhythm without voice), the last 3 headlines with clock times, voice
    prefetched. StormEvent gained `label` (pin) and `news` (anchor sentence).
  - Hazard effects (storm/Weather.tsx, ui/sound.ts): a siren and a vibration at the start in
    every city. Floods: rain, lightning with thunder, a water rush each step. Quake: map shake,
    rumble and aftershocks. Heat: a breathing heat tint, a blackout flicker with power-down at step
    2. Vibration only on coarse pointers; reduced motion drops the shake and the flicker.
- Verified: typecheck (shared, app, server); npm test 60/60 (new weakSpot.test.ts, /api/tts
  refuses empty text, health has `voice`); each converted city passes shared/src/fixtures.test.ts
  with DATA_DIR. Browser at 1440: globe, Play hand-off (Miami), planning in all four cities, storms
  with the news desk and the results card, no console errors. 390: landing, New York planning,
  Raleigh news desk.
- Next exact step: play each city on a real phone with sound on and tune the story lines; then
  let rooms pick a city (server scores Raleigh only today).
- Gotchas:
  - New York runs the flood engine as a heat stand-in: steps are the hottest blocks by heat score,
    no road closes, sites in step-1 cells lose power. The real heat engine (P10) is not used.
  - San Francisco's steps are the scenario's high-liquefaction zones split by shaking (MMI), so
    the west side near the fault reads high. Miami is ~40% at risk (broad FEMA zones).
  - Imported cities have no optimal_flood.json (the offline optimizer refuses above 20% at risk);
    score() computes bestPossible in the browser (~0.6 s for Miami).
  - Rooms, the planner and POST /api/plays still use Raleigh data.
  - The automated browser pane stops drawing frames after ~10 s, so flights and animations look
    frozen there; judge motion in a real browser.

### 2026-10-03 19:14 EDT Claude (Opus 5.5) lane C, semantic zoom S6 (hex fade) and final check
- Done (S6): layers.ts `hexFade(zoom)`; `cellsLayer(..., opacity)` (only the visible people fill
  fades; the pick target stays) and `hoodLayer(..., opacity)`, fed by useFloodMap from the store's
  zoom. plan/layers.ts `coverageLayer(..., rim)` adds a 1 px ink rim from `COVERAGE_RIM_ZOOM` (15);
  Solo passes it. Coverage alpha is unchanged at every zoom.
- Final check (all on branch sakhi/semantic-zoom, 6 commits, nothing pushed):
  - Shots at z12 / z15 / z17, planning and storm, 1440x900 and 390x844 (GPU Chrome). New layers at
    z12: 0 rendered features and 0 aerial tile requests in all four runs. z15: places 6-21, bus
    stops 8-32, site buildings 1-7. z17: house numbers, aerial, Broughton High outlined.
  - No console errors or warnings on /solo (day and storm), /host/ABCD and /play/ABCD. vite build ok.
  - Pan at z17 (S4 run): 60 fps, p99 16.8 ms, 0 frames over 33 ms.
  - New data: bus_stops.json 116,584 B, site_buildings.json 126,406 B (both < 5,000,000).
    Credits: map attribution shows "Bus stops: GoRaleigh GTFS" and "Imagery: NC OneMap, NC Center
    for Geographic Information and Analysis" when those layers are in view (OSM via the tiles);
    meta.json `sources.busStops`, `sources.siteBuildings`, `busStops`, `siteBuildings`.
  - typecheck, 43 vitest tests, 5 python tests (python3 -m unittest pipeline.tests.test_detail).
- Half done: nothing.
- Next exact step: merge sakhi/semantic-zoom into main when the team agrees (no conflicts expected
  outside app/src/map, app/src/ui/Hud.tsx, store.ts, Solo.tsx, docs). Optional follow-ups: nursing
  homes as places (left out per the brief); a nearest-building fallback for the 54 node sites outside
  any footprint; show site outlines on top of 3D buildings when tilted.
- Gotchas: rerun `python3 -m pipeline.bus_stops` and `python3 -m pipeline.site_buildings` after a
  full `build_all` (it drops their meta blocks; caches make it offline). Fixture mode has no detail
  files (the map warns and skips them).

### 2026-10-03 19:08 EDT Claude (Opus 5.5) lanes A+C, semantic zoom S5 (shelter sites as buildings)
- Done (data): pipeline/site_buildings.py (stdlib; two Overpass queries cached in
  pipeline/cache/site_elements_overpass.json and site_nearby_buildings_overpass.json) wrote
  app/public/data/site_buildings.json `[{id, match, osm, polygons}]` (MultiPolygon coords, 5
  decimals): **162 of 216 sites matched** (contains 50, self 51, grounds 61; osm-node 50/104,
  osm-way 100/100, osm-relation 12/12), 126,406 bytes. The 54 unmatched are nodes outside every
  footprint (e.g. Ravenscroft School, East Garner Elementary); they keep their square. meta.json
  gains `sources.siteBuildings` and `siteBuildings`. 2 more unit tests (rings, holes, rules).
- Done (app): detail.ts source + `siteBuildingLayers(P)` (fill + outline, z15+, placed after
  `buildings`), feature-state hover, `loadSiteBuildings()` (shared with useFloodMap, which hides the
  square of matched sites at z15+), `installDetail(map, onSite)` wires mousemove/click/mouseleave
  and closes on any other click or zoomstart. store `siteCard`; ui/SiteCard.tsx (name, type,
  "Shelter for up to 10,000 people", flood note) rendered by MapView. Palette siteFill/siteHover/
  siteLine per mood. Status text now says "marked building" (Hud.tsx, usePlanning.ts, DESIGN).
- Verified: typecheck, 43 tests, 5 python tests. z12 0 site buildings; z15 6-7; z17 Broughton
  outlined, square hidden. Hover at 1440 and tap at 390 show the card; a tap elsewhere closes it.
  Day/storm 1440, 390 shots. No console errors.
- Next exact step: S6. In useFloodMap/Solo, fade the H3 fills at z15+: deck.gl `opacity` on
  `cells` (who-lives-here), `hood` tint and the cursor hex fill (plan/layers.ts cursorLayer), from
  1 at z14.5 to 0.35 at z16 using the store's zoom. Keep `coverage` (plan/layers.ts coverageLayer)
  at full alpha and add a thin ink rim from z15 so it reads over the aerial. Then the full DONE
  check (z12/15/17 x day/storm x 1440/390), data sizes, attribution, and a final handoff.
- Gotchas: with 3D on (pitch > 20) the 3D buildings cover the flat site outlines; fine for the storm
  (DESIGN hides sites there), but a tilted planning view shows sites only as place icons.

### 2026-10-03 19:00 EDT Claude (Opus 5.5) lane C, semantic zoom S4 (NC OneMap aerial)
- Done: detail.ts raster source `aerial` (NC OneMap Orthoimagery_Latest_cached tiles, minzoom 16,
  maxzoom 20, attribution "Imagery: NC OneMap, NC Center for Geographic Information and Analysis")
  and `aerialLayer(P)` (raster-opacity z16 0 -> z17 85% day / 80% night), placed in basemap.ts
  groundLayers after `waterway`, before `buildings`. Palette `aerial` {opacity, saturation,
  contrast, brightnessMin, brightnessMax} per mood; applyPalette's regex now includes raster tone.
- Verified: typecheck, 43 tests. nconemap requests: 0 at z12 and z15, 68 by z17 (1440). Day, storm
  (1440) and 390 shots; labels and streets read on the photo. Pan at z17, GPU Chrome 1440x900, 12
  drags over 10.5 s: 60 fps, p99 16.8 ms, max 16.8 ms, 0 frames over 33 ms. No console errors.
- Next exact step: S5. Write pipeline/site_buildings.py (stdlib + Overpass at
  https://overpass-api.de/api/interpreter, send a User-Agent or it is refused; cache responses in
  pipeline/cache/). For each site in sites.json: osm-node -> the building way/relation whose
  polygon contains it; osm-way/relation tagged building -> itself; grounds (school campus) ->
  the building containing site lon/lat, else the largest building inside the grounds. Write
  app/public/data/site_buildings.json `[{id, match, rings}]` (5 decimals, < 5 MB) and report counts
  per rule. Then the app: GeoJSON source `site-buildings`, outline + fill layers z15+, hide the
  deck.gl square for matched sites at z15+, hover/tap card (name, type, capacity 10,000).
- Gotchas: raster sources pick tiles by rounded zoom, so z16.5 already loads z17 imagery.

### 2026-10-03 18:56 EDT Claude (Opus 5.5) lanes A+C, semantic zoom S3 (GoRaleigh bus stops)
- Done: pipeline/bus_stops.py (stdlib, cached in pipeline/cache/goraleigh_gtfs.zip + .json) wrote
  app/public/data/bus_stops.json: 1,386 stops, 116,584 bytes, feed S1000098 resolved to
  goraleigh.org/sites/default/files/2026-09/goraleighgtfs_sept062026.zip. meta.json gains
  `sources.busStops` and `busStops` {url, resolvedUrl, lastModified, downloaded, feedVersion,
  feedStart, feedEnd, count}. pipeline/tests/test_detail.py (3 tests). pipeline/README.md section.
- Done (app): detail.ts `detailSources()` (GeoJSON `bus-stops` with attribution "Bus stops: GoRaleigh
  GTFS"), a bus SDF badge, layer `bus-stops` (z14+, names z16+). `installDetail` fetches
  `${DATA_BASE}/bus_stops.json`; a failed fetch only warns. Palette `busIcon` per mood.
- Verified: typecheck, 43 tests, python unittest. z12: 0; z15: 29-32 stops; z17: 8-9 with names.
  Attribution shows GoRaleigh once stops are in view. Day, storm (1440) and 390 shots. No errors.
- Next exact step: S4. Add raster source `aerial` to `detailSources()`:
  tiles `https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest_cached/ImageServer/tile/{z}/{y}/{x}`,
  tileSize 256, minzoom 16, maxzoom 20, attribution "Imagery: NC OneMap / NC CGIA". Layer
  `aerial` (minzoom 16) in basemap.ts groundLayers after `water`/`waterway`, before `buildings`:
  raster-opacity z16 0 -> z17 0.85; palette `aerialBrightnessMax`/`aerialSaturation` per mood and
  widen applyPalette's regex to raster-brightness|raster-saturation. Then GPU=1 pan test at z17.
- Gotchas: in fixture mode (VITE_DATA_BASE=/data/fixtures) bus_stops.json does not exist; the map
  warns and shows no stops. `build_all` drops meta.busStops; rerun `python3 -m pipeline.bus_stops`.

### 2026-10-03 18:52 EDT Claude (Opus 5.5) lane C, semantic zoom S2 (addresses, building names)
- Done: detail.ts `detailLabelLayers(P)` (replaces placeLayers): `addresses` (housenumber, z16+,
  lowest priority), `building-names` (z16+, `BUILDING_NAMES_FILTER`), then `places`. Palette gains
  `address` (ink 55% / storm-label 60%).
- Verified: typecheck, 43 tests. Shots at 1440 (day, storm) and 390 (day): z12 all 0; z17 Oakwood
  57-80 house numbers; downtown z16.5 10 building names (museums, State Court of Appeals, NC
  Department of Public Safety). No console errors.
- Next exact step: S3. Write pipeline/bus_stops.py (stdlib only): GET https://goraleigh.org/gr_gtfs
  (follows a 301 to the dated zip), cache it as pipeline/cache/goraleigh_gtfs.zip, read stops.txt
  (location_type blank or 0), write app/public/data/bus_stops.json `[{id,name,lat,lon}]` (5
  decimals), and add `sources.busStops` + a `busStops` block (url, resolved url, feed_version,
  feed dates, downloaded) to meta.json. Then in detail.ts a GeoJSON source `bus-stops`, a bus SDF
  icon, a `bus-stops` layer z14+ (names z16+), source attribution "GoRaleigh GTFS".
- Gotchas: tile POIs include their own `bus/bus_stop` points (all agencies); we do not draw those.

### 2026-10-03 18:50 EDT Claude (Opus 5.5) lane C, semantic zoom S1 (places)
- Branch `sakhi/semantic-zoom` in wolfhacks/claude, from group/main a7b011c. Never pushed. The plan
  (S1-S6) is in the task brief; research found: OpenFreeMap tiles have `poi` (class, subclass,
  name, rank) and `housenumber`, but the `building` layer carries no names; GoRaleigh GTFS is at
  https://goraleigh.org/gr_gtfs (1,386 stops); NC OneMap imagery is a 3857 tile cache at
  services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest_cached/ImageServer/tile/{z}/{y}/{x}
  (CORS ok, terms "free and unrestricted use", cite NC OneMap / NC CGIA); sites.json ids are 104
  osm-node, 100 osm-way, 12 osm-relation.
- Done (S1): app/src/map/detail.ts: `PLACES_FILTER`, canvas pictograms (`PLACE_ICONS`) turned into
  SDF images (`sdfImage`), `placeLayers(P)` (z14 icons, z15 names, below street names), and
  `installDetail(map)` (adds icons; MapView calls it at map creation). basemap.ts exports `Palette`
  with `placeIcon`/`placeLabel` per mood and slots the places into `labelLayers`.
- Verified: typecheck, 43 tests. Shots (scratchpad, not committed) at 1440 day and storm and 390 day,
  z12/z15/z17: `queryRenderedFeatures` on `places` gives 0 at z12, 18-21 at z15. No console errors.
- Next exact step: S2. In detail.ts add `addressLayers(P)`: `housenumber` text at z16+ (10 px, ink
  55% / storm-label 60%), placed lowest of the labels, plus a z16+ names layer for non-commercial
  named POIs (town_hall courthouse/public_building, office government/educational_institution,
  college, lodging/dormitory, museum, information/office) since the tiles have no building names.
  Add palette entries `address`, then shots with IDS=places,addresses,building-names.
- Gotchas: the map is never "idle" or `loaded()` while the water shimmers; wait on
  `isStyleLoaded()` / `areTilesLoaded()` in scripts. The shot helper used is a scratch script around
  app/scripts/drive.mjs (jumpTo a view, poll areTilesLoaded, count rendered features, shot). For
  storm shots run GPU=1 and drag the map once first so the helicopter camera lets go.

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

