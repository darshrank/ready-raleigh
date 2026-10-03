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

## Stack

- Map and animation: MapLibre GL and deck.gl (decided).
- Data: OpenStreetMap, US Census, NC OneMap, NOAA, USGS.
- Everything else (frontend framework, backend, realtime rooms, hosting) is not decided yet. Propose a choice before scaffolding, then record it here.

## Conventions

- Preprocess heavy geodata offline into small files (GeoJSON or vector tiles) the browser can load fast. Don't fetch large datasets at runtime.
- Keep intervention costs, budget, timer length, and coverage radii in one config file. The plan says they are placeholders to tune.
- The My Address feature must keep the address in the browser only. Never send it to a server or log it.
- Keep API keys (Gemini, ElevenLabs, etc.) in environment variables, never in the repo.

## Commands

None yet. Add install, dev, test, and data-prep commands here once the project is scaffolded.
