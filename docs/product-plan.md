# Ready Raleigh: Product Plan

Oct 3, 2026

## Overview

Ready Raleigh is a multiplayer map game where residents plan their city's response to floods and heatwaves on real data. The combined plans show planners where to act. The name is a placeholder.

- **Players:** residents, who learn their own risk and get a say in planning.
- **Recipients:** town planners, who get a crowd-sourced map of where residents and the data agree action is needed.
- **Track:** Center for Geospatial Analytics. Every play is a proposed plan, so the game answers "where to take action" directly.
- **A round:** join, briefing, planning, simulation, results, reveal.
- **Scope:** items marked (stretch) can be cut if time runs short.

## 1. Lobby and modes

- **Room join:** players enter a room code on a phone or laptop. Solo play works too.
- **Scenario modes:** Flood and Heatwave. A third mode, such as power outage or food access, is a stretch item.
- **City:** Raleigh first. Other NC counties are a stretch item.

## 2. Map and data layers

- **Real map:** Raleigh, with layers the player can toggle.
- **Hazard layer:** flood zones in Flood mode, heat in Heatwave mode.
- **People layers:** population, plus vulnerable groups (elderly, low income, no car).
- **Infrastructure layers:** roads and existing facilities.
- **Neighborhood card:** tapping an area shows its population and risk stats.
- **Data sources:** OpenStreetMap, US Census, NC OneMap, NOAA, and USGS, all from the track's list.

## 3. Planning phase

Players get a fixed budget and about 3 minutes to place interventions on the map. The budget and costs below are placeholders to tune.

| Mode | Intervention | Cost | What it covers |
|---|---|---|---|
| Flood | Shelter | $3M | Residents who can drive to it within 15 minutes |
| Flood | Bus pickup point | $1M | Households without cars within walking distance |
| Flood | Road protection | $2M | Keeps one flood-prone road open |
| Heatwave | Cooling center | To set | Heat-vulnerable residents within a short walk |
| Heatwave | Tree planting | To set | Cools the surrounding area |
| Heatwave | Water station | To set | Residents within a short walk |

- **Budget:** $10M per round, tracked by a budget bar.
- **Instant feedback:** each placement lights up its coverage area and updates a "residents covered" counter.
- **Editing:** players can move or remove placements before the timer ends.

## 4. Simulation

After planning, the event plays out as an animation on the map, built with MapLibre and deck.gl.

- **Flood spreading:** water rises in steps and the flooded area grows.
- **Roads closing:** road segments turn red as the water reaches them.
- **Residents moving:** dots travel along real road routes toward shelters.
- **Stranded residents:** dots that can't reach a shelter stop and turn red.
- **Live counters:** protected and stranded totals update as the simulation runs.
- **Heatwave version:** heat builds through the day, and areas near trees and cooling centers cool down.
- **Controls:** replay and speed control (stretch).

## 5. Scoring and debrief

The score is the share of at-risk residents protected, weighted toward vulnerable groups. It must come from real spatial analysis, since the judges are from a geospatial analytics center.

- **Breakdown:** results by neighborhood, plus how the most vulnerable fared compared with everyone else.
- **AI debrief:** a short plain-English summary of the biggest miss, such as an uncovered area where many households have no car.
- **Optimal plan:** the player's plan shown next to the best plan the algorithm found.

## 6. Multiplayer reveal

- **Leaderboard:** everyone in the room ranked by score.
- **Crowd heatmap:** where the whole room placed interventions, shown next to the optimal plan.
- **Perception gap:** areas the data flags that the crowd ignored. This is the high point of the demo.

## 7. My Address (stretch)

- **Personal risk:** a player enters an address and sees their flood and heat risk.
- **Nearest help:** their closest shelter or cooling center, and whether their route stays open.
- **Privacy:** the address is used only in the browser and never stored.

## 8. Local knowledge pins (stretch)

- **Resident reports:** players pin problems the data misses, like a street that floods in every storm or a bus stop with no shade.
- **Shared layer:** the pins show up as a map layer for other players and for planners.

## 9. Planner dashboard

- **Aggregate view:** all plays combined into a ranked list of sites where residents and the data agree action is needed.
- **Community pins:** the local knowledge layer, if built.
- **Export:** download the results as GeoJSON or CSV (stretch).

## 10. Bonus challenge integrations

All six bonus challenges have a place in the product. Build them after the core game works.

| Challenge | How the product uses it |
|---|---|
| Data Streaming Challenge | A Live mode streams real-time USGS river gauge and NOAA weather readings into Databricks, so the flood scenario reflects current conditions and a live dashboard shows river levels. |
| Tiger Data | Stores the gauge and temperature time-series plus every play and score. Continuous Aggregates feed the leaderboard and the planner dashboard. |
| Gemini | Writes the post-round debrief, answers plain-English questions about the map, and generates the scenario briefings. |
| ElevenLabs | Reads the briefing as an emergency broadcast and narrates the results, which also helps people who can't read the map easily. |
| Solana | Records each submitted plan on-chain as a public vote, so community input can't be quietly altered. Top plans earn an on-chain badge. |
| GoDaddy Registry | Register a domain and host the game there. |

Open questions:

- [ ] Ask the organizers whether a geospatial team can enter the Data Streaming Challenge. It is described as an extension of the two Applied AI tracks.
- [ ] Decide whether to keep Solana. It is the weakest fit of the six, so it goes last and gets cut first.

## Build order

The full list is more than a weekend's work, so build in this order and stop where time runs out.

1. Flood mode end to end: sections 1 to 6.
2. Heatwave mode on the same engine.
3. Planner dashboard.
4. Bonus challenges: Gemini, ElevenLabs, GoDaddy, and Tiger Data first, then Streaming, then Solana.
5. Stretch items: My Address, local knowledge pins, a third mode, export, replay controls.
