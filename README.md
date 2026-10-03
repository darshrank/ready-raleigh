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

## Planned stack

- **Map and animation:** MapLibre, deck.gl
- **Data:** OpenStreetMap, US Census, NC OneMap, NOAA, USGS

## Build order

1. Flood mode end to end
2. Heatwave mode on the same engine
3. Planner dashboard
4. Bonus challenge integrations
5. Stretch items

The full spec is in [docs/product-plan.md](docs/product-plan.md).

## Status

Planning. No code yet.
