# Ready Raleigh: product plan (agent copy)

Source: team plan by Darsh, Oct 3, 2026. Name is a placeholder. Items marked (stretch) get cut
first. Additions made while setting up the repo are marked [added].

## Overview
A multiplayer map game where residents plan Raleigh's response to floods and heatwaves on real
data. The combined plans show planners where to act.
- Players: residents, who learn their own risk and get a say in planning.
- Recipients: town planners, who get a crowd map of where residents and the data agree.
- Track: Center for Geospatial Analytics. Every play is a proposed plan.
- A round: join, briefing, planning, simulation, results, reveal.

## 1. Lobby and modes
- Room join by code on phone or laptop. Solo play works too.
- Modes: Flood and Heatwave. Third mode (power outage or food access) is stretch.
- City: Raleigh. Other NC counties are stretch.
- [added] Big-screen host view (`/host/:code`) for the projector, phones as controllers.

## 2. Map and data layers
- Real map of Raleigh with toggleable layers.
- Hazard layer: flood zones (Flood), heat (Heatwave).
- People layers: population, elderly, low income, no car.
- Infrastructure: roads and existing facilities.
- Neighborhood card: tap an area to see population and risk stats.
- Sources: OpenStreetMap, US Census, NC OneMap, NOAA, USGS (track list).

## 3. Planning phase
- Fixed budget ($10M) and about 3 minutes to place interventions. Budget bar.
- Instant feedback: each placement lights up its coverage and updates "residents covered".
- Players can move or remove placements before the timer ends.

| Mode | Intervention | Cost | Covers |
|---|---|---|---|
| Flood | Shelter | $3M | Residents who can drive to it within 15 min |
| Flood | Bus pickup point | $1M | No-car households within walking distance |
| Flood | Road protection | $2M | Keeps one flood-prone road open |
| Heat | Cooling center | $2M [added placeholder] | Heat-vulnerable residents within a short walk |
| Heat | Tree planting | $0.5M [added placeholder] | Cools the surrounding area |
| Heat | Water station | $0.25M [added placeholder] | Residents within a short walk |

[added] Shelters snap to real candidate buildings from OSM.

## 4. Simulation
Animation on the map (MapLibre + deck.gl).
- Flood spreading: water rises in steps, flooded area grows.
- Roads closing: segments turn red as water reaches them.
- Residents moving: dots travel along real road routes toward shelters.
- Stranded residents: dots that can't reach a shelter stop and turn red.
- Live counters: protected and stranded totals.
- Heatwave: heat builds through the day; areas near trees and cooling centers cool down.
- Replay and speed control (stretch).

## 5. Scoring and debrief
- Score: share of at-risk residents protected, weighted toward vulnerable groups. Must come from
  real spatial analysis.
- Breakdown by neighborhood, and vulnerable vs everyone.
- AI debrief: plain-English summary of the biggest miss.
- Optimal plan: the player's plan next to the best plan the algorithm found.

## 6. Multiplayer reveal
- Leaderboard for the room.
- Crowd heatmap: where the whole room placed interventions, next to the optimal plan.
- Perception gap: areas the data flags that the crowd ignored. **High point of the demo.**

## 7. My Address (stretch)
Enter an address, see flood and heat risk, nearest help, whether the route stays open.
Address stays in the browser, never stored.

## 8. Local knowledge pins (stretch)
Players pin problems the data misses (street that floods, bus stop with no shade). Shared layer for
players and planners.

## 9. Planner dashboard
All plays combined into a ranked list of sites where residents and data agree. Community pins if
built. Export GeoJSON or CSV (stretch).

## 10. Bonus challenges (build after the core game works)
| Challenge | Use |
|---|---|
| Data Streaming | Live mode streams USGS gauge and NOAA weather readings into Databricks. Ask organizers if a geospatial team can enter. |
| Tiger Data | Gauge and temperature time series plus every play and score. Continuous Aggregates feed the leaderboard and planner dashboard. |
| Gemini | Debrief, plain-English questions about the map, scenario briefings. |
| ElevenLabs | Briefing as an emergency broadcast, narrated results. |
| Solana | Each submitted plan recorded on-chain as a public vote. Top plans get a badge. Weakest fit: last to build, first to cut. |
| GoDaddy Registry | Register a domain, host the game there. |

## Build order
1. Flood mode end to end: sections 1 to 6.
2. Heatwave mode on the same engine.
3. Planner dashboard.
4. Bonus: Gemini, ElevenLabs, GoDaddy, Tiger Data, then Streaming, then Solana.
5. Stretch: My Address, pins, third mode, export, replay controls.
