# FAULTLINE: Cities Under Pressure

Multiplayer geospatial resilience game: pick a real city, plan against a disaster on real data, then compare your plan with an optimizer and the rest of the room. Formerly "Ready Raleigh" (placeholder name). The name lives in `BRAND` in `web/src/config/game.ts`.

Specs: `docs/master-prompt.md` (current four-city design) and `docs/product-plan.md` (original Raleigh plan). Read them before starting any feature.

## Context

- Hackathon project for the Center for Geospatial Analytics track. Judges are geospatial analysts, so scores and coverage must come from real spatial analysis (real road networks, census data, flood zones), never hardcoded or random numbers.
- Time is short. Prefer the simplest thing that works and demos well.

## Build order

Work in this order. Don't start a later step until the earlier one works end to end.

1. All four city packs end to end on one engine (done in the frontend on real data): Raleigh flood, Miami surge, New York heat, San Francisco earthquake. Multiplayer uses labelled simulated players until the backend exists.
2. Backend: FastAPI, realtime rooms, Tiger Data persistence.
3. Gemini and ElevenLabs through the backend (keys in `.env.example`).
4. Planner dashboard.
5. Bonus challenges: Gemini, ElevenLabs, GoDaddy, Tiger Data, then Streaming, then Solana.
6. Stretch items, marked "(stretch)" in the plans.

Skip anything marked (stretch) unless asked.

## Stack (decided)

- Frontend (`web/`): Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), Motion, Zustand, TanStack Query, Recharts.
- Map: MapLibre GL JS 5 (pinned; v6 not yet supported by our deck.gl setup) with an interleaved deck.gl 9 overlay. Basemap: OpenFreeMap vector tiles with a custom style in `web/src/features/map/style.ts`.
- Engine: TypeScript in `web/src/lib/engine/` (road graph + Dijkstra, flood model, seeded simulation, scoring, Achilles' heel scan, optimizer, crowd analysis). Heavy runs go through a Web Worker (`engine.worker.ts`).
- Data prep (`data-prep/build_city.py`): Python 3.13, OSMnx, GeoPandas, Shapely, NetworkX, h3. Writes compact JSON to `web/public/data/<city>/`. Hazard sources: FEMA NFHL (Raleigh, Miami), USGS/ABAG liquefaction scenario (San Francisco), OSM green space + NYC Heat Vulnerability Index (New York). New York facilities, bus stops and neighborhood names come from NYC Open Data and NYS DOH instead of Overpass.
- Planned: Python FastAPI backend, WebSockets for rooms, Tiger Data (PostgreSQL + PostGIS + Timescale), Gemini, ElevenLabs, Solana devnet. Hosting: Vercel (web), Railway/Render/Fly (API), Tiger Cloud (DB).

## Conventions

- Preprocess heavy geodata offline into small files (GeoJSON or compact JSON) the browser can load fast. Don't fetch large datasets at runtime.
- Every tunable game number (per-city intervention catalogs and costs, budget, timer, radii, capacities, hazard timing, score weights) lives in `web/src/config/game.ts` under `CITY_SCENARIOS`. They are placeholders to tune.
- Day/night: the basemap palette changes in place (`features/map/daylight.ts`); never swap the MapLibre style, or the interleaved deck overlay detaches.
- The simulation is deterministic per seed. Random events are resolved once per round and never shown to the planning estimate.
- Label anything that is not real: "Scenario simulation — not an emergency forecast", SIMULATED PLAYERS, DEMO DATA. Never label demo data as live.
- React Strict Mode is off because deck.gl's interleaved overlay can only attach to the MapLibre WebGL context once.
- The My Address feature must keep the address in the browser only. Never send it to a server or log it.
- Keep API keys (Gemini, ElevenLabs, etc.) in environment variables, never in the repo. Templates: `.env.example` (backend secrets) and `web/.env.example` (public frontend config).

## Commands

```bash
# frontend
cd web && pnpm install
pnpm dev              # http://localhost:3000
pnpm lint
pnpm exec tsc --noEmit
pnpm engine:check [city]   # headless engine run against the generated city data

# data prep (writes web/public/data/<city>/; downloads are cached in data-prep/cache/)
cd data-prep && uv venv .venv --python 3.13 && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python build_city.py all   # or raleigh|miami|new-york|san-francisco; needs network (Overpass, FEMA, Esri, USGS/ABAG, NYC Open Data)
# keep ox.settings.requests_timeout at 600: it is part of the OSMnx cache key, so changing it re-downloads everything
```
