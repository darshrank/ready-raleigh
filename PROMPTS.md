# Ready Raleigh: agent playbook and prompts

This file is for you, not the agents. It explains how to run Claude Code and Codex together and
gives you every prompt in build order. Copy a prompt, paste it, let the agent run.

---

## 1. One-time setup (10 minutes)

1. Put the kit files in the project folder:
   ```
   /Users/sakhipatel/Desktop/masters/own/hackathon/wolfhacks/
     AGENTS.md  CLAUDE.md  PROMPTS.md  .env.example  .gitignore
     docs/PLAN.md  docs/DESIGN.md  docs/PROGRESS.md  docs/DECISIONS.md
   ```
2. Make it a git repo and push to a **private GitHub repo**. The Desktop folder lets your own
   agents swap. GitHub lets your 3 teammates and their agents work on the same files.
   ```
   cd /Users/sakhipatel/Desktop/masters/own/hackathon/wolfhacks
   git init && git add -A && git commit -m "chore: agent kit"
   gh repo create ready-raleigh --private --source=. --push
   ```
3. Copy `.env.example` to `.env` and paste your keys. Never commit `.env`.
4. How each agent finds the instructions:
   - **Codex** reads `AGENTS.md` on its own.
   - **Claude Code** reads `CLAUDE.md`, which imports `AGENTS.md` with one line (`@AGENTS.md`).
   - Any other agent (Cursor, Gemini CLI, Copilot): tell it "Read AGENTS.md first."
5. Optional but worth it: add the Context7 MCP server to both agents so they read current library
   docs. Solana, deck.gl, and the Gemini SDK change often.

A note on "GPT Astra": I can't confirm details about that model. Every prompt here is written to
work with any coding agent, so it doesn't matter which model runs it.

---

## 2. How to use Claude Code and Codex in tandem

**Split by lane, not by brand.** Both agents can do any task. Conflicts come from two agents
editing the same files, so give each agent its own lane and its own folder.

| Agent | Your default lanes | Why |
|---|---|---|
| Claude Code | C: UI (`app/`), plus merges and integration | UI needs screenshots, critique, and many small judgment calls. Keep one agent on it so the look stays consistent. |
| Codex | A: Data (`pipeline/`), B: Engine (`shared/`), D: Server (`server/`) | Well-defined tasks with clear "done when" checks. Good for running in parallel. |
| Both | Review each other | Codex reviews Claude's UI branch for bugs. Claude reviews Codex's engine for contract mistakes. |

**Run them in parallel with git worktrees.** Each agent gets its own folder and branch, so they
never collide:
```
cd /Users/sakhipatel/Desktop/masters/own/hackathon/wolfhacks
git worktree add ../wolfhacks-codex -b lane-a-pipeline
# Claude Code runs in wolfhacks/ (UI branch). Codex runs in wolfhacks-codex/.
```
Merge into `main` every time a task in `docs/PROGRESS.md` is done. Use the MERGE prompt.

**When one agent hits its limit:** open the other agent in the **same folder** and paste the
RESUME prompt. The handoff log in `docs/PROGRESS.md` tells it exactly where to continue. This only
works if every session ends with a handoff entry, so never skip that.

**Teammates:** each teammate owns one lane, clones the repo, and uses the same prompts. Four
people times one or two agents each is plenty. Do not run more than one agent per lane.

---

## 3. How to prompt (rules that save hours)

1. **One task per session.** Use the task IDs (P1, P2...). Clear the context between tasks.
2. **Give intent and a "done when."** The prompts below already do. Don't micromanage steps.
3. **Paste errors word for word.** Never summarize an error.
4. **Show, don't describe, for UI.** Attach a screenshot and say what's wrong.
5. **Commit after every green step.** Git is your undo button when an agent breaks things.
6. **Stop loops at 15 minutes.** If an agent circles the same bug, revert and use the BUG prompt
   with a smaller scope.
7. **Ask for the plan, let it run.** Every prompt starts with the opener below, which has the
   agent state a plan and then proceed without waiting.

### The opener (paste at the top of EVERY session, then the task prompt)
```
Read AGENTS.md, docs/PROGRESS.md, docs/PLAN.md, and docs/DECISIONS.md. If this task touches UI,
also read docs/DESIGN.md. Your lane is [A/B/C/D]. Your task is below.
First, write a short plan: what you understood, files you will touch, steps, risks. Then build it
without waiting for me, unless a step would change a shared contract in shared/src/types.ts; in
that case stop and ask. When done: verify (typecheck, tests, and the browser for UI), update
docs/PROGRESS.md with a tick and a handoff entry, and commit.
```

---

## 4. Build prompts, in order

Suggested agent in brackets. Hours assume a 24-hour build; adjust to the real deadline.

### Hours 0 to 2

#### P1: Scaffold [Claude Code, lanes B and C]
```
Task P1: scaffold the monorepo.
- npm workspaces: app (Vite + React + TypeScript), server (Node + Fastify + ws + TypeScript),
  shared (TypeScript library). TypeScript strict everywhere. Path alias @shared for shared/src.
- Root scripts: dev (app and server together), typecheck, test (vitest), optimize.
- Create shared/src/types.ts exactly from the contracts in AGENTS.md, and shared/src/config.ts
  with the placeholder values from AGENTS.md.
- Create small fixtures in app/public/data/fixtures/: about 30 cells around NC State's main
  campus, 3 sites, 2 flood roads, 1 flood_steps.geojson, a tiny roads_graph.json. Same shapes
  as the real files, so the engine and UI can start before the pipeline is done.
- app: install maplibre-gl, deck.gl (@deck.gl/core, layers, geo-layers, mapbox), h3-js, zustand,
  motion, tailwind. Load Big Shoulders Display and Public Sans from Google Fonts.
- server: GET /api/health returns { ok: true }. A websocket at /ws/rooms/:code that echoes.
Done when: npm run dev shows a full-screen map centered on Raleigh with the fixture cells drawn
as hexagons, /api/health returns ok, and npm run typecheck passes.
```

#### P2: Cells and census [Codex, lane A]
```
Task P2: build the study area and cells in pipeline/.
- Python 3.11 venv, a pipeline package, a cache folder (pipeline/cache/) so each step skips if
  its output exists. pipeline/build_all.py runs steps in order.
- Study area: City of Raleigh boundary from Census TIGER places (latest year), buffered 1 km in a
  meter-based projection.
- Cells: H3 resolution 9 covering the study area. Give each an integer index i.
- Census: latest ACS 5-year at block group level for Wake County (state 37, county 183), joined to
  TIGER block group shapes. Fields: total population (B01003), age 65+ (sum the 65+ rows of
  B01001), people below poverty (C17002, ratio under 1.00), households with no vehicle (B25044,
  owner plus renter no-vehicle rows). Confirm each variable ID with the Census API variables list
  before using it.
- Assign each cell to the block group containing its centroid and split that block group's counts
  evenly across its cells.
- hood: name each cell from the nearest OpenStreetMap place=neighbourhood or suburb; fall back to
  the census tract name.
- Write app/public/data/cells.json with floodStep null, cutOff false, heatC 0, treePct 0 for now.
- Print a sanity report: cell count, total population, file size. Save a quick PNG of population
  to pipeline/out/check_population.png.
Done when: cells.json matches the Cell type in shared/src/types.ts, total population looks right
for Raleigh plus the buffer, and the PNG looks like Raleigh.
```

#### P4: Engine [Codex, lane B] (start in parallel with fixtures)
```
Task P4: build the game engine in shared/src/engine/ as pure functions, tested on fixtures.
- data.ts: types for the loaded static data bundle.
- atRisk.ts: at-risk cells for flood (floodStep <= 3 or cutOff) and heat (heatC at or above the
  config threshold). Weighted people per AGENTS.md config.
- coverage.ts: which at-risk cells each placement protects. Shelter: site.coverFlood, unusable if
  the site floods. Bus pickup: no-car households in gridDisk(cell, 2). Road protection: road.unlocks.
  Cooling center gridDisk 2, water station gridDisk 1, trees lower heat per config.
- score.ts: score(plan, data) -> ScoreResult per AGENTS.md. topMisses lists the 5 largest
  uncovered weighted cells with a plain reason, for example "no shelter within 15 minutes" or
  "households with no car and no bus pickup nearby".
- optimizer.ts: greedy budgeted max coverage, best marginal weighted gain per dollar, lazy
  evaluation. Script `npm run optimize` writes app/public/data/optimal_flood.json.
- timeline.ts: simTimeline(plan, data) -> per flood step: flooded cells, closed road ids,
  protected and stranded counts.
- Use typed arrays or bit masks. score must run under 30 ms for 4,000 cells.
- Vitest tests: empty plan scores 0; adding a placement never lowers the score; over-budget plans
  are rejected; the optimizer beats 100 random valid plans.
Done when: tests pass, npm run optimize works on fixtures, typecheck passes.
```

#### P5: Design system and map shell [Claude Code, lane C]
```
Task P5: design tokens and the map shell. Read docs/DESIGN.md fully first.
Before coding, write a 10-line design plan (tokens, type scale, layout per screen) and check it
against the "What we chose not to do" list. Revise anything that drifts toward a template look.
Then build:
- CSS variables for every color token, the type scale, the focus ring. Tailwind theme reads them.
- MapLibre basemap from free vector tiles (OpenFreeMap or Protomaps; verify the style URL loads),
  restyled per DESIGN.md: chalk land, flood-tinted water, thin ink roads, no POI icons.
- deck.gl overlay (MapboxOverlay, interleaved) with layers: population H3 hexagons extruded low
  with a toggle for total / 65+ / no car; flood halftone dots (static preview, ScatterplotLayer);
  candidate sites as small ink squares.
- Neighborhood card on click: name, population, 65+, no-car households, flood step.
- Route skeletons: /, /solo, /host/:code, /play/:code, /planner.
Run it, screenshot at 1440 px and 390 px, critique against DESIGN.md, fix the top 3 issues,
then remove one decorative element that isn't earning its place.
Done when: /solo shows the styled 3D map with all layers on fixture data and passes the critique.
```

### Hours 2 to 8

#### P3: Roads, flood, sites, coverage [Codex, lane A]
```
Task P3: finish the flood data in pipeline/.
- Roads: OSMnx drive graph for the study area, simplified, with speeds and travel times.
  Export app/public/data/roads_graph.json as nodes [lon, lat] and edges
  [from, to, seconds, floodStep or null], coordinates rounded to 5 decimals.
- Flood: FEMA National Flood Hazard Layer flood hazard areas for Wake County (or NC FRIS if
  faster to get). Steps: 1 floodway, 2 the 1% annual chance zones, 3 the 0.2% zone. Dissolve per
  step, clip, simplify about 10 m, write flood_steps.geojson. Set floodStep on edges and cells.
- Hospitals: OSM amenity=hospital in Wake County, snapped to graph nodes. hospitals.json.
- cutOff: remove edges with floodStep <= 3, multi-source Dijkstra from hospitals, mark cells
  whose nearest node can't reach any hospital.
- Sites: OSM schools, community centres, libraries, places of worship. Keep at most 300, one per
  H3 resolution 8 cell, preferring schools and community centres. For each: floodStep, coverDry
  and coverFlood = cell indices whose nearest node is within 900 seconds of the site, on the dry
  graph and on the step-3 graph. Use multiprocessing.
- Flood roads: group flooded edges by street name into segments. Keep the 50 that cut off the most
  weighted people. unlocks = cells that regain hospital access if that segment stays open.
- Halftone dots: a grid about every 120 m inside the flood polygons, tagged with step.
  flood_dots.json as [lon, lat, step].
- Write meta.json with sources and build date. Print file sizes; keep each under 5 MB.
- Save sanity PNGs to pipeline/out/.
Done when: all files match AGENTS.md contracts and the UI loads them in place of fixtures.
```

#### P6: Planning phase [Claude Code, lane C]
```
Task P6: the planning phase in /solo, flood mode. Follow docs/DESIGN.md for pieces and motion.
- Tray of game pieces for the mode, with cost under each. Unaffordable pieces dimmed.
- Placing: shelter snaps to a site (highlight sites on hover), bus pickup to a cell, road
  protection to a flood road (highlight on hover). Stamp animation on place.
- Coverage ring: covered cells light up as --safe halftone dots.
- Live "residents covered" counter and budget chip stack, both driven by the engine's score().
- 180-second timer. Move or remove a piece (select, then drag or Delete). Keyboard play per
  DESIGN.md. State in a zustand store.
- Button "Start the storm" ends planning early.
Done when: you can place, move, and remove all three flood pieces with mouse, touch, and keyboard,
counters update instantly, and it works at 390 px.
```

### Hours 8 to 12 (milestone: one full solo game end to end)

#### P7: Simulation [Claude Code, lane C, uses lane B timeline]
```
Task P7: the flood simulation after planning.
- Broadcast band slides in once at the top (DESIGN.md), scrolling the events of each step:
  roads closing by name, neighborhoods cut off.
- Every 4 seconds, advance a flood step: halftone dots for that step grow from 0 over 600 ms,
  closed roads go dashed then solid --alarm.
- Residents: sample dots in at-risk cells (1 dot per 25 weighted people, max 6,000). Covered dots
  travel to their shelter along real roads: run Dijkstra in a Web Worker on roads_graph.json with
  closed edges removed, from the chosen shelters, and reconstruct paths. Draw with TripsLayer.
  Stranded dots stop and become hollow --alarm rings.
- If the worker isn't ready, fall back to straight arcs so the demo never stalls (behind a flag).
- 120 px counters for protected and stranded, ticking with the timeline.
- Respect prefers-reduced-motion.
Done when: a full solo flood game plays from planning to the end of the storm in under 30 seconds
of simulation with no frame drops on a laptop.
```

#### P8: Results [Claude Code, lane C]
```
Task P8: the results screen.
- Score, large. Vulnerable vs everyone protected, as two bars.
- Neighborhood breakdown list, sorted by people left unprotected.
- Two maps side by side: "Your plan" and "Best plan found", synced pan and zoom.
- Debrief text: for now, a template built from topMisses. Gemini replaces it in P12.
- Buttons: "Play again" and, in rooms, "See how the room did".
Done when: the screen fits on one projector screen and on a phone with scrolling.
```

### Hours 12 to 16

#### P9a: Rooms server [Codex, lane D]
```
Task P9a: multiplayer rooms in server/.
- In-memory rooms keyed by a 4-letter code with no look-alike letters (no O, I, L).
- Server owns phases and timers: lobby, briefing (20 s), planning (180 s), simulation,
  results, reveal. Broadcast `room` messages with endsAt.
- Host starts the game. Players submit { plan, score }. When all have submitted or the timer
  ends, compute and broadcast results: leaderboard, crowdCells (placement count per cell; shelters
  count at their site cell, roads at their midpoint cell), and gapCells (up to 10 highest weighted
  at-risk cells that no player covered but the optimal plan covers).
- Reconnect by playerId kept in the client. Heartbeat every 15 s.
- Unit tests for the phase machine and results math.
Done when: two terminal websocket clients can play a full room.
```

#### P9b: Room UI [Claude Code, lane C]
```
Task P9b: host and player views for rooms.
- /host/:code: giant room code and a QR code to /play/:code, player list, then each phase full
  screen. The reveal shows two maps, "Your room" (crowd heatmap) and "The data" (optimal plan),
  and gap cells pulse --alarm three times. This is the demo's high point; make it land.
- /play/:code: name entry, then the same planning UI as solo, then a waiting screen, then the
  player's own results and rank.
- Lobby on / to create a room or join with a code.
Done when: 3 phones and 1 laptop host can play a full room on the same Wi-Fi.
```

#### P12: Gemini [Codex, lane D]
```
Task P12: Gemini in server/src/ai/.
- Use @google/genai. Model name comes from GEMINI_MODEL; check the current docs for valid names.
- Briefing: one 3-sentence emergency briefing per mode, generated once at startup and cached.
- Debrief: POST /api/debrief takes { mode, score }. Prompt rules: 3 sentences max, name the
  biggest miss with the neighborhood and numbers taken only from the JSON, never invent numbers,
  plain and direct, supportive not scolding. Never send addresses or player names.
- 8-second timeout. On any failure return the template debrief.
- Behind VITE_FEATURE_AI. Wire the results screen to use it.
Done when: debriefs read well on 5 different plans and the game still works with no API key.
```

#### P13: ElevenLabs [Codex, lane D]
```
Task P13: voice in server/src/voice/.
- ElevenLabs JS SDK. POST /api/tts { text, voice } returns MP3, cached on disk by a hash of
  text plus voice.
- Script `npm run gen:audio` pre-generates into app/public/audio/: the briefing for each mode
  read as an emergency broadcast, an alert tone, a piece-stamp sound effect, a results sting.
- The host screen plays the broadcast when the simulation starts and reads the debrief on results.
  Phones are muted by default. Always show a mute toggle.
- Behind VITE_FEATURE_VOICE. If audio fails, the game continues silently.
Done when: the host screen plays the briefing in sync with the broadcast band.
```

### Hours 16 to 19

#### P10: Heatwave [lanes A, B, C; split across agents]
```
Task P10: heatwave mode on the same engine.
Lane A: land surface temperature from a clear summer Landsat Collection 2 Level-2 scene over
Raleigh (try Microsoft Planetary Computer's STAC first, it needs no login; confirm the ST_B10
scale factor in the product guide before converting to Celsius; mask clouds with QA_PIXEL).
Mean per cell into heatC. Tree cover per cell from NLCD tree canopy if quick, else from OSM
wooded areas. Heat halftone dots as heat_dots.json [lon, lat, heatC].
Lane B: heat at-risk, coverage, and tree cooling per config. simTimeline for heat: hours
10 AM to 6 PM, heat builds, cooling pieces shrink nearby dots. Optimizer writes optimal_heat.json.
Lane C: mode switch, heat pieces in the tray, heat halftone in --alarm, heat simulation and
results using the same screens.
Done when: a full solo heat game plays end to end.
```

#### P11: Tiger Data and planner dashboard [Codex lane D, Claude lane C]
```
Task P11: storage and the planner page.
Lane D: SQL migrations for Tiger Data (Postgres): plays and placements as hypertables on time,
gauge_readings as a hypertable. Continuous aggregates: placements per cell per hour, and
leaderboard per hour. POST /api/plays stores each submitted plan and score. GET /api/planner
ranks cells into "Both agree" (crowd and data), "Data only" (gap), "Crowd only", using crowd
placement counts and the optimal plan plus uncovered weighted at-risk people. If DATABASE_URL is
missing, use an in-memory store with the same interface.
Lane C: /planner page: map with the three categories, a ranked list of sites with reasons,
and a CSV export button (stretch).
Done when: plays from rooms show up on /planner within a few seconds.
```

#### P14: Deploy and domain [any]
```
Task P14: deploy.
- app to Vercel, server to a host that supports websockets (Render or Railway). Set env vars,
  CORS, and VITE_SERVER_URL.
- Point the domain we registered through GoDaddy Registry at the Vercel app.
- Test a full room with 3 phones on the hackathon Wi-Fi. Write any issues in the handoff.
Done when: the public URL plays a full room.
```

### Hour 19: feature freeze. Only the items below after this.

#### P15: Live mode [Codex, lane D] (only if ahead of schedule)
```
Task P15: live gauges.
- Poll every 5 minutes: USGS instantaneous values for Wake County gauges (gage height and
  discharge). USGS is moving to a new Water Data API, so check which endpoint works today.
  Also the National Weather Service hourly forecast for Raleigh (send a User-Agent header).
- Insert into gauge_readings. GET /api/live/gauges returns latest readings plus the last 24 hours
  from a continuous aggregate.
- Live mode: pick the flood step from current gauge levels using simple thresholds in config.
- UI: a small live panel with sparklines on the host screen.
Databricks streaming only if organizers confirm a geospatial team can enter; then ask the
Databricks rep for the fastest ingestion path before building anything.
```

#### P16: Solana [Codex, lane D] (last; cut first)
```
Task P16: record plans on Solana devnet.
- @solana/web3.js v1, devnet RPC from env, team keypair from env. Script `npm run sol:fund`
  requests devnet SOL (the faucet rate-limits, so run it early).
- On each submitted plan: planHash = sha256 of the canonical JSON of mode plus placements.
  Send a Memo program transaction "ready-raleigh:v1:<mode>:<planHash>:<score>".
- Return the signature and the Solana Explorer devnet link. Show "Recorded on Solana" with the
  link on the results screen. Behind a feature flag; failures never block results.
- Stretch: the top plan in each room gets a second memo marked as a badge.
Done when: every plan in a room shows a working Explorer link.
```

#### P17: Demo hardening [Claude Code]
```
Task P17: make the demo unbreakable.
- Turn off each feature flag one at a time and confirm the game still works.
- Kill the server and confirm /solo still plays fully from static files.
- Seed the planner with 40 simulated plays, clearly labeled "synthetic" in the UI.
- Error boundaries on every screen, loading states for data files, check performance on a phone.
- Write docs/DEMO.md: the 3-minute demo script and the backup plan if Wi-Fi fails.
Done when: we can run the demo twice in a row with no surprises.
```

---

## 5. Utility prompts (use any time)

#### RESUME (an agent ran out of limits)
```
Another agent was working in this folder and stopped mid-task. Read AGENTS.md, then the newest
entry in the handoff log of docs/PROGRESS.md. Run git status, git diff, and git log -10 --stat.
Tell me in 5 lines what state the work is in. Then continue from the "Next exact step." Do not
redo finished work and do not start a new task.
```

#### REVIEW (one agent reviews the other)
```
Review the changes on branch [name] against main (git diff main...[name]). Check: matches the
contracts in shared/src/types.ts, follows the fail-soft rule, no secrets, score() stays fast, and
no UI pattern from the "What we chose not to do" list in docs/DESIGN.md. Output a numbered list:
severity, file and line, problem, fix. Do not change code unless I reply "fix".
```

#### MERGE
```
Merge branch [name] into main. Resolve conflicts in favor of shared/src/types.ts and
docs/DECISIONS.md. Run typecheck and tests. Run the app and play one solo game. Report what
changed and anything broken.
```

#### BUG
```
Bug: I did [action]. Expected [expected]. Got [actual].
Error, word for word: [paste]
Find the root cause before changing code. Explain it in 2 lines. Make the smallest fix. Add a
test if the bug was in shared/. Verify and commit.
```

#### UI CRITIQUE (attach a screenshot)
```
Here is a screenshot of [screen]. Compare it with docs/DESIGN.md. List the 5 biggest gaps:
hierarchy, spacing, type scale, color misuse, anything that looks templated. Fix the top 3 only,
then remove one element that isn't earning its place. Screenshot again and compare.
```

#### MAKE IT COOLER (when a screen works but looks flat)
```
This screen works but doesn't have a moment. Read docs/DESIGN.md. Propose 3 ideas for one
memorable, on-concept moment on this screen (halftone, printed board, broadcast). Pick the best,
explain why in one line, and build only that one. Keep everything else quiet.
```

#### SCOPE CUT
```
It's hour [N] of 24. Read docs/PROGRESS.md. Propose cuts so flood mode end to end plus the room
reveal is solid by hour [M]. List what to cut, and the 3 tasks left in priority order. Update
docs/PROGRESS.md.
```

#### DEVPOST AND PITCH
```
Read docs/PLAN.md, docs/PROGRESS.md, and the code. Write: (1) a Devpost write-up with
inspiration, what it does, how we built it, challenges, what we learned, what's next, and the
list of tools; (2) a 3-minute pitch script that opens with the problem in one line, runs the live
demo with a judge playing, shows the perception gap reveal, and closes on what planners get.
Plain language, no buzzwords. State clearly that the flood model is simplified and that any
seeded plays are synthetic.
```

---

## 6. Schedule at a glance

| Hours | Claude Code | Codex | Milestone |
|---|---|---|---|
| 0 to 2 | P1, then P5 | P2, P4 on fixtures | map renders |
| 2 to 8 | P6 | P3, finish P4 | planning works on real data |
| 8 to 12 | P7, P8, merges | review UI, fixes | **full solo game** |
| 12 to 16 | P9b | P9a, P12, P13 | **full room game with voice** |
| 16 to 19 | P10 UI or P11 UI | P10 data and engine, P11 server, P14 | deployed |
| 19 | freeze | freeze | |
| 19 to 24 | P17, rehearse | P15 or P16 if ahead | demo twice, submit |
