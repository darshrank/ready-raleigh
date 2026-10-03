# Ready Raleigh

A multiplayer map game where Raleigh residents plan their city's response to floods and heatwaves on real data. Each play is a proposed plan, and the combined plans show town planners where residents and the data agree action is needed.

Built for the Center for Geospatial Analytics track. The name is a placeholder.

## How a round works

1. **Join**: enter a room code on a phone or laptop, or play solo.
2. **Briefing**: pick Flood or Heatwave and learn the scenario.
3. **Planning**: spend a $10M budget in about 3 minutes, placing shelters, bus pickups, cooling centers and more on a real map of Raleigh.
4. **Simulation**: watch the event play out. Water spreads, roads close, and residents travel toward shelters.
5. **Results**: get a score based on the share of at-risk residents protected, weighted toward vulnerable groups, plus a debrief and the best plan the algorithm found.
6. **Reveal**: see the room's leaderboard, a crowd heatmap, and the perception gap, meaning the areas the data flags but the crowd ignored.

## Stack

- **Frontend:** Vite, React, TypeScript, MapLibre GL, deck.gl
- **Engine:** TypeScript in the browser: Dijkstra routing on the real road network, a staged flood model and a greedy optimizer in a Web Worker
- **Rooms:** Cloudflare Durable Objects over WebSockets (solo play runs the same room logic locally)
- **Data prep:** Python (pysheds, rasterio, shapely, h3) writing small files to `public/data/raleigh/`

## The spatial analysis

| What | How | Source |
|---|---|---|
| Flood hazard | Height Above Nearest Drainage from a hydrologically conditioned 10 m DEM (fill, D8 flow, channels at 1 km² drainage area). The water level rises in stages; each building and road segment floods when the level passes its HAND. | USGS 3DEP 1/3 arc-second |
| Roads | 56k-edge routable network with OSM road classes and bridge flags. Closure height = lowest 40 m stretch under water, ignoring bridges and their abutments. Motorways are assumed above the 100-year flood. | OpenStreetMap via Overture Maps |
| People | 117k residential buildings inside city limits. Residents are spread by floor area (dasymetric) and controlled to the 2020 Census count. Vulnerability shares come from ACS tracts. | OSM/Overture buildings, US Census |
| Shelter sites | Schools, community centers, libraries and places of worship. Placements snap to the nearest one. | OSM/Overture places |
| Coverage | Network travel times at the water level when each neighbourhood evacuates, with shelter capacity, walking to bus pickups, and bus rides to shelters. | |
| Score | Share of at-risk residents protected, with extra weight for residents who are 65+, low-income or car-free. | |
| Optimal plan | Greedy weighted max-coverage under the budget, plus a swap pass, scored with the same engine as the player. | |

## Running it

```bash
npm install
npm run dev          # http://localhost:5173 (web) + room server on :8787
npm test
```

The processed data is committed, so the data pipeline is only needed to rebuild it:

```bash
python3 -m venv .venv && .venv/bin/pip install -r data-prep/requirements.txt
npm run data         # Overture + USGS DEM -> HAND -> public/data/raleigh
npm run data:census  # ACS 5-year + TIGER tracts (needs api.census.gov)
```

Deploy with `npm run deploy` (Cloudflare Workers + Durable Objects).

## Build order

1. Flood mode end to end
2. Heatwave mode on the same engine
3. Planner dashboard
4. Bonus challenge integrations
5. Stretch items

The full spec is in [docs/product-plan.md](docs/product-plan.md).

## Status

First prototype: Flood mode end to end (lobby, briefing, planning, simulation, results, multiplayer reveal). Heatwave mode, the planner dashboard and the bonus integrations come next.

Known gap: the sandbox this was built in couldn't reach the Census API, so the vulnerability layers use citywide placeholder shares until `npm run data:census` runs. Every other number comes from the spatial pipeline.
