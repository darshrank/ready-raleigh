# Ready Raleigh

Multiplayer map game where residents plan Raleigh's response to floods and heatwaves on real data. Full spec: `docs/product-plan.md`. Read it before starting any feature.

## Context

- Hackathon project for the Center for Geospatial Analytics track. Judges are geospatial analysts, so scores and coverage must come from real spatial analysis (real road networks, census data, flood zones), never hardcoded or random numbers.
- Time is short. Prefer the simplest thing that works and demos well.

## Build order

Work in this order. Don't start a later step until the earlier one works end to end.

1. Flood mode end to end (plan sections 1 to 6): lobby, map and layers, planning, simulation, scoring, multiplayer reveal.
2. Heatwave mode on the same engine. Keep the engine mode-agnostic so this is mostly new data and interventions.
3. Planner dashboard.
4. Bonus challenges: Gemini, ElevenLabs, GoDaddy, Tiger Data, then Streaming, then Solana.
5. Stretch items, marked "(stretch)" in the plan.

Skip anything marked (stretch) unless asked.

## Stack (decided)

- Frontend: Vite + React + TypeScript, zustand for state. Map: MapLibre GL (CARTO dark basemap, falls back to our own road layer if it can't load) with deck.gl layers.
- Engine: `src/engine/` runs entirely in the browser (and in Node for tests). Dijkstra on the real road graph, staged flood model, greedy optimizer in a Web Worker.
- Realtime rooms: one Cloudflare Durable Object per room code (`worker/index.ts`), WebSockets. The room state machine lives in `src/shared/roomLogic.ts` and is shared with `LocalRoom` (solo play runs the same logic in the browser).
- Hosting: one Cloudflare Worker serves `dist/` as static assets and the `/room/<CODE>` WebSockets. `npm run deploy`.
- Data prep: offline Python in `data-prep/` writes small files to `public/data/raleigh/`.

## Data and model

- Roads, buildings, land use, facilities, neighbourhood names: OpenStreetMap via Overture Maps (S3). Elevation: USGS 3DEP 1/3 arc-second DEM.
- Flood hazard: Height Above Nearest Drainage (HAND) computed from the DEM with pysheds (`data-prep/hydrology.py`). Water rises through `CONFIG.flood.stages`; a home is at risk when the level passes its HAND; a road closes when water on it is deeper than `roadClosureDepth`. Motorways/trunks are treated as above the 100-year flood.
- Population: residential building floor area (dasymetric), controlled to census totals. Vulnerability (65+, poverty, no car) comes from ACS 2023 5-year tract data via `data-prep/fetch_census.py` (bulk summary files on www2.census.gov, no API key; tract polygons from TIGERweb). `fallback_demographics.json` (citywide shares) is only used if the census cache is missing, and the UI says so.
- Official floodplain: FEMA NFHL (`data-prep/fetch_fema.py`, hazards.fema.gov) is a map layer and the check on the HAND model. HAND channels start at 1 sq mi drainage (FEMA's study threshold). `meta.json` stores the agreement per water level (CSI 0.53 at 4 m, 86% of FEMA's 100-yr area captured). HAND flags more residents than FEMA's zones (about 14k at 4 m vs about 2.9k in FEMA 100/500-yr), because it applies a uniform rise to every studied stream and ignores elevated foundations and LOMAs.
- Analysis grid: H3 resolution 9.

## Conventions

- Preprocess heavy geodata offline into small files (GeoJSON or vector tiles) the browser can load fast. Don't fetch large datasets at runtime.
- Keep intervention costs, budget, timer length, and coverage radii in one config file. The plan says they are placeholders to tune.
- The My Address feature must keep the address in the browser only. Never send it to a server or log it.
- Keep API keys (Gemini, ElevenLabs, etc.) in environment variables, never in the repo.

## Commands

- Install: `npm install` and `python3 -m venv .venv && .venv/bin/pip install -r data-prep/requirements.txt`
- Dev: `npm run dev` (Vite on :5173 + room server via `wrangler dev` on :8787; Vite proxies `/room`). `npm run dev:web` alone is enough for solo play.
- Test: `npm test` (engine on the real data, room state machine). Typecheck: `npm run typecheck`.
- Data: `npm run data` (fetch Overture + DEM, hydrology, build). `npm run data:census` (needs www2.census.gov + tigerweb.geo.census.gov). `npm run data:fema` (needs hazards.fema.gov). `npm run data:build` to rebuild outputs from cache.
- Deploy: `npm run deploy` (Cloudflare account needed: `npx wrangler login`).
- Optimal plan: `npm run optimal` precomputes `public/data/raleigh/optimal.json`. Rerun after changing `src/config.ts` or the data (otherwise browsers recompute it in a worker, ~30 s).
- Balance exploration: `TUNE=1 npx vitest run test/tune.test.ts`.
