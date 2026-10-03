# FAULTLINE: Cities Under Pressure

*Pick a city. Face the disaster. Rewrite the outcome.*

A multiplayer geospatial resilience game on real cities and real data. Players plan where to put shelters, buses, road protection and rescue teams before a disaster, watch it play out on the real road network, then compare their plan with an optimizer and the rest of the room. The combined plans show planners where residents and the data agree action is needed.

Built for the Center for Geospatial Analytics track.

## How a round works

1. **Choose a city**: Raleigh (Hurricane Cascade) is playable. Miami, New York and San Francisco have their map, camera and scenario design in place.
2. **Briefing**: a fly-through of the city with the real numbers: residents in the flood hazard area, households without a car, flood-prone crossings.
3. **Planning**: spend $10M in 3 minutes on shelters, bus pickups, road protection and high-water rescue teams. Intel scans, a time freeze and an Achilles' heel network scan help.
4. **Simulation**: water spreads along FEMA flood zones, roads close, and every evacuation is routed on the OpenStreetMap network. Reroutes, strandings and functional isolation all emerge from the routing.
5. **Results**: resilience score with transparent weights, who benefited, the critical failure, the optimizer's alternate timeline, the room leaderboard, and the perception gap between the crowd and the data.

## Data

OpenStreetMap (OSMnx), FEMA National Flood Hazard Layer, U.S. Census ACS 5-year (tract), OpenFreeMap tiles. See the in-app methodology page for roles and limitations.

## Run it

```bash
npm install && (cd web && pnpm install)
npm run dev        # game on http://localhost:3000, multiplayer rooms on :8787
npm run deploy     # one Cloudflare Worker: static game + rooms (npx wrangler login first)
```

## Where the pieces came from

This branch (`claude/unified-product`) merges the three team branches:

- **feat/ready-raleigh-adit**: the app shell, UI and animation, four city packs, engine, event feed, results and methodology.
- **sakhi/visual-overhaul**: the light, uncluttered street-map look used while planning.
- **claude/lucid-mccarthy-9x9exf**: realtime multiplayer rooms (Cloudflare Durable Objects) and the independent terrain (HAND) check of FEMA's flood zones.

See `CLAUDE.md` for the stack, data-prep commands and conventions. Specs are in `docs/`.

## Status

Frontend, engine and realtime rooms done. Next: Tiger Data persistence, then the bonus integrations.
