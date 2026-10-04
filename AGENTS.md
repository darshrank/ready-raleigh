# Ready Raleigh: agent instructions

You are one of several coding agents (Claude Code, Codex, others) working in this repo during a
24-hour hackathon. Any agent may pick up where another stopped. Follow this file exactly.

## Read these first, every session
1. `AGENTS.md` (this file): architecture, contracts, rules.
2. `docs/PROGRESS.md`: what is done, what is in progress, the last handoff note.
3. `docs/PLAN.md`: the product plan.
4. `docs/DESIGN.md`: only if your task touches UI.
5. `docs/DECISIONS.md`: choices already made. Do not reopen them without a reason.

## What we are building
A multiplayer map game. Residents plan Raleigh's response to a flood or a heatwave on real data,
with a fixed budget. A simulation plays out, the game scores the plan, and the room sees how its
plans compare with the best plan the algorithm found. All plays combine into a planner dashboard
that shows where to act. Track: Center for Geospatial Analytics (WolfHacks 2026).

Judging criteria: Track fit, Technology ("wow"), Design, Execution (it must work).

## Architecture

```
pipeline/   Python. Runs once, offline. Builds all geodata into app/public/data/.
shared/     TypeScript. Types and the game engine (coverage, scoring, optimizer, sim timeline).
            Pure functions, no I/O. Used by app/ and server/.
app/        Vite + React + TypeScript. MapLibre GL + deck.gl. The game UI.
server/     Node + TypeScript (Fastify + ws). Rooms, AI, voice, database, Solana, live feeds.
docs/       Plan, design, progress, decisions.
```

Key principle: **the core game runs in the browser from static files.** Solo flood mode must work
even if the server is down. Server features are layered on top and must fail soft.

### Stack
- app: Vite, React 18, TypeScript strict, maplibre-gl, deck.gl (`@deck.gl/mapbox` MapboxOverlay,
  interleaved), h3-js, zustand, motion (framer-motion), Tailwind with tokens from DESIGN.md.
  No component kits with default styling (no stock shadcn look).
- server: Node 20, Fastify, ws, `@google/genai`, ElevenLabs JS SDK, `pg`, `@solana/web3.js` (v1).
- pipeline: Python 3.11, osmnx, geopandas, shapely, h3, rasterio, requests, pystac-client.
- Basemap: free vector tiles (OpenFreeMap or Protomaps), restyled per DESIGN.md. Verify the tile
  URL works before building on it.

### Spatial model
- Analysis unit: **H3 resolution 9 cell** ("cell"). Every cell has an integer index `i`.
  Arrays of cell indices are used everywhere instead of H3 strings, to keep files small.
- Study area: City of Raleigh boundary (Census TIGER place), buffered 1 km.
- Shelters snap to **real candidate sites** from OpenStreetMap (schools, community centres,
  libraries, places of worship). Planners place shelters in existing buildings.
- Bus pickups, cooling centers, water stations, trees: placed on any cell.
- Road protection: chosen from a precomputed list of flood-prone road segments.

### Flood model (simplified on purpose, say so in the pitch)
- Steps: 1 = floodway, 2 = 1% annual chance (100-year), 3 = 0.2% (500-year). Optional step 4
  from elevation is a stretch item.
- A road segment closes at the first step its geometry intersects.
- A cell is **at risk** if it floods by step 3, or if it loses every driving route to a hospital
  at step 3 ("cut off").

### Heat model (simplified)
- Cell heat = mean land surface temperature from a clear summer Landsat scene.
- At risk = cells at or above the heat threshold in config (default: 80th percentile).

## Data contracts (source of truth: `shared/src/types.ts`)

```ts
export type Mode = 'flood' | 'heat';
export type InterventionType =
  | 'shelter' | 'bus_pickup' | 'road_protection'          // flood
  | 'cooling_center' | 'tree_planting' | 'water_station'; // heat

export interface Cell {
  i: number;            // index into cells array
  h3: string;
  hood: string;         // neighborhood name for cards and debrief
  pop: number;
  pop65: number;
  lowInc: number;       // people below poverty line
  noCarHH: number;      // households with no vehicle
  floodStep: number | null; // first flood step that reaches this cell, null if never
  cutOff: boolean;      // loses all hospital access at final flood step
  heatC: number;        // mean land surface temperature, Celsius
  treePct: number;      // 0 to 100
}

export interface Site {          // shelter candidates
  id: string; name: string; kind: string;
  lon: number; lat: number; cell: number;
  floodStep: number | null;      // shelter unusable if flooded
  coverDry: number[];            // cell indices within drive limit, no flooding
  coverFlood: number[];          // cell indices within drive limit, final flood step
}

export interface FloodRoad {      // road protection candidates
  id: string; name: string; floodStep: number;
  coords: [number, number][];
  unlocks: number[];             // cells that stay connected if this road stays open
}

export interface Placement {
  id: string; type: InterventionType;
  cell?: number; siteId?: string; roadId?: string;
}

export interface Plan {
  roomCode: string; playerId: string; playerName: string;
  mode: Mode; placements: Placement[]; spent: number;
}

export interface ScoreResult {
  score: number;                 // 0 to 100
  atRiskWeighted: number; protectedWeighted: number;
  protectedPeople: number; strandedPeople: number;
  vulnerable: { protectedPct: number; everyonePct: number };
  byHood: { hood: string; atRisk: number; protected: number }[];
  topMisses: { cell: number; hood: string; reason: string; weighted: number }[];
}
```

### Static data files (written by pipeline/ to app/public/data/)
| File | Contents |
|---|---|
| `cells.json` | `Cell[]` |
| `sites.json` | `Site[]` |
| `flood_roads.json` | `FloodRoad[]` |
| `flood_steps.geojson` | flood polygons, property `step` |
| `roads_graph.json` | simplified drive graph: nodes `[lon,lat]`, edges `[from,to,seconds,floodStep|null]` |
| `hospitals.json` | `{name, lon, lat, node}[]` |
| `optimal_flood.json`, `optimal_heat.json` | best plan from the optimizer |
| `meta.json` | build date, sources, thresholds |
| `existing_shelters.json` | registered shelters (FEMA NSS) with capacity and catchments, `npm run shelters` |
| `transit_stops.json` | existing bus stops (GTFS), `python -m pipeline.transit` |

Size budget: keep every file under 5 MB uncompressed. If one grows past that, simplify geometry
or drop precision to 5 decimals.

### Game config (`shared/src/config.ts`, all placeholders to tune)
- Budget: $10M. Planning timer: 180 s.
- Costs: shelter $3M, bus pickup $1M, road protection $2M, cooling center $2M,
  tree planting $0.5M, water station $0.25M.
- Drive limit for shelters: 15 min. Walk coverage: H3 `gridDisk(cell, 2)` for bus pickup and
  cooling center, `gridDisk(cell, 1)` for water station.
- Tree planting: cell heat minus 1.5 C, ring 1 minus 0.5 C.
- Weighted people per cell: `pop + pop65 + lowInc + 2.5 * noCarHH`.
- Optional shelter capacity: `null` (off) or a number of people.

### Server API
REST:
- `GET  /api/health`
- `POST /api/debrief` body `{ mode, score: ScoreResult }` -> `{ text }` (Gemini)
- `POST /api/tts` body `{ text, voice: 'broadcast' | 'narrator' }` -> audio/mpeg (ElevenLabs, cached by hash)
- `POST /api/plays` body `{ plan, score }` -> stored in database
- `GET  /api/planner?mode=flood` -> ranked sites from all plays
- `GET  /api/live/gauges` -> latest USGS gauge readings
- `POST /api/solana/record` body `{ playId, planHash }` -> `{ signature, explorerUrl }`

WebSocket `/ws/rooms/:code`, JSON messages with a `type` field:
- client -> server: `join {name}`, `start` (host only), `submitPlan {plan, score}`
- server -> client: `room {phase, mode, players, endsAt}`, `results {leaderboard, crowdCells, gapCells}`
- Phases: `lobby -> briefing -> planning -> simulation -> results -> reveal`

### Routes in app/
- `/` landing and mode picker
- `/solo` single player, no server needed
- `/host/:code` big screen for the room (projector)
- `/play/:code` phone or laptop player
- `/planner` planner dashboard

### Environment (`.env`, never commit; see `.env.example`)
`GEMINI_API_KEY`, `GEMINI_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_BROADCAST`,
`ELEVENLABS_VOICE_NARRATOR`, `DATABASE_URL`, `SOLANA_RPC_URL`, `SOLANA_SECRET_KEY`,
`CENSUS_API_KEY`, `PORT`, `VITE_SERVER_URL`, `VITE_FEATURE_VOICE`, `VITE_FEATURE_AI`.

### Commands
- `npm install` at repo root (npm workspaces: app, server, shared)
- `npm run dev` runs app and server together
- `npm run typecheck`, `npm test`
- `npm run optimize` runs the optimizer in shared/ and writes `optimal_*.json`
- `python -m pipeline.build_all` rebuilds all data (slow; cached steps skip)

## Lanes (who owns which folders)
| Lane | Folders | Scope |
|---|---|---|
| A: Data | `pipeline/` | all geodata, coverage precompute |
| B: Engine | `shared/` | types, scoring, optimizer, sim timeline, tests |
| C: UI | `app/` | map, planning, simulation, reveal, planner page |
| D: Server | `server/` | rooms, Gemini, ElevenLabs, Tiger Data, Solana, live feeds |

Work only inside your lane's folders. If you must change a shared contract (`shared/src/types.ts`),
make the smallest change, note it in `docs/DECISIONS.md`, and mention it in your handoff.

## Rules
1. **Plan first.** Before writing code, state the files you will touch and the steps. Then build.
2. **One task per session.** Pick the task from `docs/PROGRESS.md`. Do not wander.
3. **Mock first.** If a dependency from another lane is not ready, build against a small fake
   file with the same contract. Put fakes in `*/fixtures/`.
4. **Fail soft.** Every server integration (Gemini, ElevenLabs, database, Solana, live feeds)
   sits behind a feature flag and has a fallback: template text, cached audio, in-memory store.
   A failed API call must never break the game.
5. **No secrets in code.** Read keys from env only. Check the diff for keys before every commit.
6. **No new dependency** without a one-line note in `docs/DECISIONS.md`.
7. **Verify before done.** Run `npm run typecheck` and relevant tests. For UI, run the app and
   check it in the browser at 1440 px wide and 390 px wide.
8. **Commit small.** Commit after each working step: `feat(lane-x): ...` or `fix(lane-x): ...`.
9. **Do not invent APIs.** If unsure about a library or endpoint, read its current docs
   (use the Context7 MCP if available). Libraries change fast.
10. **Hand off.** End every session by updating `docs/PROGRESS.md`: tick finished items, and
    write a handoff entry (what you did, what is half done, exact next step, any gotchas).
    Then commit. Another agent will resume from your note with no other context.
