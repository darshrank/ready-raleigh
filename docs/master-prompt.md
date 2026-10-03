# Urban Pulse: City Under Pressure

## Master Development Prompt

You are the lead architect, product designer, geospatial engineer, game designer,
and senior full-stack developer for a hackathon project.

Build a production-quality interactive web application named:

**Application name:** URBAN PULSE: CITY UNDER PRESSURE

**Tagline:**
"Pick a city. Face the disaster. Rewrite the outcome."

**Secondary line:**
"A multiplayer geospatial resilience game powered by real cities and real data."


## 0. PRODUCT VISION


Urban Pulse is a multiplayer, SimCity-inspired geospatial disaster-resilience
strategy game.

It is NOT a SimCity clone and must not copy SimCity artwork, assets, UI, sounds,
or copyrighted presentation.

Instead, create an original, premium city-management / emergency-command visual
language.

Players choose a REAL city:

1. Raleigh, North Carolina
2. Miami, Florida
3. New York City, New York
4. San Francisco, California

Each city uses:

- correct geographic coordinates
- real road topology
- real neighborhood / Census geography
- real buildings where available
- real public infrastructure locations where available
- real terrain/elevation where appropriate
- real demographic context
- relevant official/open hazard datasets

The game then presents a scientifically grounded but clearly labeled
SCENARIO SIMULATION.

Never claim the simulation is a forecast.

Display:
"Scenario simulation — not an emergency forecast."

Players receive:

- limited money
- limited emergency resources
- limited time
- incomplete information

They must decide WHERE to intervene.

Their decisions alter the simulated outcome.

After the disaster, show:

- who was protected
- who was stranded / underserved
- what failed
- why it failed
- what the player missed
- what an optimization algorithm would have done
- what the entire multiplayer room collectively believed
- where the crowd and geospatial analysis disagree

The game should satisfy the Center for Geospatial Analytics theme:

"Where should action be taken?"


## 1. THE FOUR SIGNATURE CITY PACKS


Treat each city as a ScenarioPack implementing the same game engine.

Do NOT create four unrelated applications.


### A. RALEIGH — HURRICANE CASCADE


**Theme:**
Inland hurricane rainfall + flash flooding + creek/river rise + road isolation.

**Visual identity:**
lush green terrain, tree canopy, creeks, suburban and urban roads,
dark hurricane clouds, blue flood propagation.

**Scenario title:**
"HURRICANE CASCADE"

**Narrative:**
A tropical system moves inland and stalls over the Triangle.
Rainfall accumulates rapidly.
Low-lying roads begin flooding.
Several critical transportation links become unusable.
Communities that appear geographically close to shelters may become
functionally isolated.

**Primary hazards:**

- intense rainfall
- flash flooding
- creek / river rise
- low-lying road closure
- emergency-route failure
- shelter accessibility loss
- localized power outage as optional event

**Core player interventions:**

- Temporary Shelter
- Bus Pickup Point
- Protect Critical Road
- Deploy High-Water Vehicle
- Temporary Flood Barrier
- Emergency Supply Hub
- Open Community Center
- Mobile Medical Unit

**Special Raleigh mechanic:**
ROAD REDUNDANCY.

Some neighborhoods depend heavily on a small number of road connections.

Allow the simulation to discover:
"this ordinary-looking road is an Achilles' Heel."

If it floods:

- travel paths reroute
- some residents take longer routes
- emergency response time increases
- some populations lose all viable shelter paths

**Signature visual moment:**
Water advances across the map while evacuation trails reroute in real time.


### B. MIAMI — STORM SURGE SIEGE


**Scenario title:**
"STORM SURGE SIEGE"

**Theme:**
Hurricane + storm surge + intense rainfall + low elevation + compound flooding.

**Visual identity:**
coastal turquoise/blue, Miami urban skyline, barrier/coastal geography,
dramatic ocean-side storm surge visualization.

**Narrative:**
A major hurricane approaches South Florida.
Storm surge begins pushing water inland while heavy rain reduces drainage
capacity.

**Primary hazards:**

- storm surge
- rainfall flooding
- high tide / compound flooding
- road inundation
- evacuation-zone pressure
- hospital/shelter access loss
- pump/drainage stress

**Player interventions:**

- Evacuation Shelter
- Evacuation Bus Hub
- Temporary Flood Barrier
- Mobile Pump
- Protect Critical Road
- Emergency Medical Site
- Raised Supply Depot
- Coastal Protection / Deployable Barrier

**Unique Miami mechanic:**
THE WATER HAS MULTIPLE SOURCES.

Visually distinguish:

ocean storm surge
rainfall / pluvial flooding
canal / drainage stress

Use slightly different animation textures or edge effects.

**Signature visual moment:**
Show a 3D coastal surge front moving inland while rain-created flood pockets
emerge separately.

Allow the player to discover that an inland neighborhood may be endangered
even if it is not directly on the coast.


### C. NEW YORK CITY — HEAT GRID


**Scenario title:**
"HEAT GRID"

Primary concept:
Extreme heat + energy stress + partial blackout + transit/accessibility cascade.

This should be visually and mechanically VERY different from Raleigh/Miami.

**Visual identity:**
dense Manhattan/Brooklyn/Queens 3D buildings,
orange-red thermal glow,
heat haze,
cool blue refuge zones,
nighttime transition during blackout.

**Narrative:**
A multi-day heat dome pushes temperatures upward.
Energy demand peaks.
A partial grid disruption removes cooling from parts of the city.
Some subway/transit nodes are degraded.
Residents without adequate cooling become increasingly vulnerable.

**Primary hazards:**

- heat exposure
- urban heat island
- low tree canopy
- population vulnerability
- cooling-access deficit
- partial power failure
- transit disruption
- medically vulnerable populations

Interventions:

- Cooling Center
- Mobile Cooling Bus
- Water Station
- Backup Generator
- Emergency Medical Hub
- Shade / Temporary Canopy
- Transit Shuttle
- Community Wellness Check Team
- Tree / Green Infrastructure investment for long-term mode

**Unique mechanic:**
HEAT ACCUMULATES THROUGH TIME.

12 PM
2 PM
4 PM
6 PM
9 PM

The city should visibly heat.

3D buildings and H3 cells become warmer.

Areas near cooling interventions become blue/cyan islands.

When a blackout event occurs:

certain cooling centers can fail unless they have backup power.

This creates strategic dependencies.

**Optional secondary NYC scenario:**
"CLOUDBURST"

Heavy rainfall overwhelms drainage.
Street flooding develops.
Basement-vulnerable areas and transit nodes become key.
Subway stations can close and shift travel to surface roads.

Do NOT make earthquake the flagship NYC scenario.

An earthquake can exist as an experimental scenario but not the primary one.


### D. SAN FRANCISCO — THE BIG ONE


**Scenario title:**
"THE BIG ONE"

**Theme:**
Earthquake + shaking + liquefaction + fires + road/infrastructure disruption.

**Visual identity:**
Bay Area topography,
3D buildings,
fault visualization,
shaking pulse,
dust,
fire/glow,
liquefaction zones.

Scenario starts quietly.

Then:

3...
2...
1...

EARTHQUAKE.

Perform a short controlled camera shake effect.
Do NOT make it nauseating.

Propagate a stylized seismic wave across the city.

Hazards:

- ground shaking
- liquefaction susceptibility
- road/bridge disruption
- building/infrastructure damage proxies
- fire ignition
- emergency-route loss
- aftershocks
- medical demand spikes

Interventions:

- Seismic Retrofit
- Fire Response Staging
- Emergency Water Cache
- Medical Field Station
- Clear Emergency Corridor
- Temporary Shelter
- Search-and-Rescue Team
- Backup Communications Node
- Emergency Supply Depot

**Unique mechanic:**
CASCADE CHAINS.

Earthquake
  ↓
liquefaction
  ↓
road closure
  ↓
water-line / response disruption
  ↓
fire spreads
  ↓
hospital accessibility changes

Signature visual:
after initial shaking, the disaster keeps evolving.

Players realize:
"The earthquake was only the beginning."

**Optional unlockable SF scenario:**
"TSUNAMI WARNING"

Treat it as a separate coastal scenario rather than implying every earthquake
creates a tsunami.

Use evacuation-to-high-ground mechanics.


## 2. REAL MAP REQUIREMENTS


THIS IS NON-NEGOTIABLE.

Do not use fake city backgrounds.

Use an actual geospatial map.

**Frontend:**
TypeScript.

**Mapping:**
MapLibre GL JS + deck.gl.

MapLibre GL JS is the base map / camera / terrain / 3D building environment.

deck.gl overlays dynamic simulation data.

Initial city camera locations [longitude, latitude]:

Raleigh:
[-78.6382, 35.7796]

Miami:
[-80.1918, 25.7617]

New York:
[-74.0060, 40.7128]

San Francisco:
[-122.4194, 37.7749]

These are initial camera centers only.

Actual analysis must use real geometries, not rectangular approximations.

Use OpenStreetMap-derived vector tiles or another properly attributed
open vector tile source.

Always show required map attribution.

Use actual:

- roads
- water
- building footprints
- parks
- facilities
- city boundaries

when data is available.

Support MapLibre:

- pitch
- bearing
- terrain
- fill-extrusion 3D buildings
- smooth camera transitions

Use deck.gl layers as appropriate:

- GeoJsonLayer
- PathLayer
- TripsLayer
- ScatterplotLayer
- ArcLayer
- H3HexagonLayer
- HeatmapLayer
- IconLayer
- ScenegraphLayer if performant
- PolygonLayer
- TextLayer

Do not use all layers simultaneously.


## 3. SIMCITY-LIKE VISUAL EXPERIENCE


The product should feel like a premium strategy game rather than a GIS portal.

Main default camera:

pitch approximately 45–60 degrees

slightly angled city-management perspective

support rotate / pitch / zoom

Provide:

[2D ANALYSIS]
[3D CITY]
[TACTICAL]
[SHADOW CITY]

camera modes.

3D buildings should be extruded where map data supports them.

At lower zoom:
use aggregated H3 / polygon risk visualization.

At close zoom:
show buildings, roads, facilities and animated agents.

Never create millions of resident dots.

Use REPRESENTATIVE AGENTS.

**Example:**

1 animated dot might represent 100–500 residents.

Show the representation factor clearly.


## 4. LANDING PAGE


Create a cinematic landing page.

Logo:
URBAN PULSE

Subtitle:
CITY UNDER PRESSURE

Hero:

"Can you save a city before time runs out?"

Support:

"Plan against real geography. Survive the disaster. Discover what everyone
else missed."

Primary CTA:
PLAY NOW

Secondary:
WATCH 90-SECOND DEMO

Tertiary:
PLANNER MODE

Background:

slow rotating 3D globe / North America view

four glowing city markers:

Raleigh
Miami
New York
San Francisco

Hovering a city previews its signature hazard.

Raleigh:
animated rain

Miami:
surge ripple

NYC:
thermal glow

SF:
seismic pulse


## 5. CITY SELECTION — "CHOOSE YOUR CITY"


This page should be one of the most visually impressive.

Show four large interactive city cards.

Each has:

3D mini-map preview
city skyline silhouette
hazard type
difficulty
population-at-risk theme
special mechanic

RALEIGH
HURRICANE CASCADE
Difficulty: ●●●○○
Special Mechanic: Road Isolation

MIAMI
STORM SURGE SIEGE
Difficulty: ●●●●○
Special Mechanic: Compound Flooding

NEW YORK
HEAT GRID
Difficulty: ●●●●○
Special Mechanic: Cascading Blackout

SAN FRANCISCO
THE BIG ONE
Difficulty: ●●●●●
Special Mechanic: Cascading Infrastructure Failure

Click a city.

Camera transitions / flies into the actual city map.


## 6. GAME MODES


Provide:

SOLO
MULTIPLAYER ROOM
PLANNER LAB
DAILY CHALLENGE
AI CHALLENGE

Solo:
single player.

Multiplayer:
join using a 5–6 character room code.

Planner Lab:
no timer; analytical mode.

Daily Challenge:
everyone gets the same seeded scenario.

AI Challenge:
player plan vs optimizer.


## 7. MULTIPLAYER LOBBY


Host creates room.

Other players join by:

room code
QR code
share link

Lobby displays:

player names
chosen avatars
connection status
city
scenario
difficulty

HOST controls:

start game
timer length
budget
random-event intensity
role mode
public/private room


## 8. ASYMMETRIC TEAM ROLES


Optional but HIGHLY RECOMMENDED.

In cooperative multiplayer, players can have different civic roles.

INCIDENT COMMANDER

**Powers:**
- one emergency budget reallocation
- city-wide priority marker

INFRASTRUCTURE CHIEF

**Powers:**
- reveal one hidden critical road
- road-protection discount / bonus

PUBLIC HEALTH CHIEF

**Powers:**
- better health-risk visibility
- deploy mobile health unit

MOBILITY CHIEF

**Powers:**
- enhanced evacuation routes
- emergency bus redeployment

COMMUNITY LIAISON

**Powers:**
- reveal community-reported problem pins
- boost underserved-population insight

Each role sees slightly different information.

Players must communicate.

This creates cooperative strategy.


## 9. SCENARIO BRIEFING


Before planning starts:

cinematic fly-through of city.

ElevenLabs voice reads briefing.

**Example:**

"Emergency briefing. A slow-moving tropical system is approaching Raleigh.
Forecast rainfall threatens low-lying transportation corridors..."

**Show:**

hazard
estimated timeline
known vulnerable populations
available resources
budget
uncertainty

**Button:**

BEGIN PLANNING


## 10. PLANNING PHASE


Default:
3 minute countdown.

Budget example:
$10,000,000.

Costs are configurable scenario parameters and NOT claimed as real-world
engineering estimates unless sourced.

Main interface:

LEFT:
intervention toolbar

CENTER:
large 3D city map

RIGHT:
city status / neighborhood information

TOP:
timer + remaining budget + protected coverage estimate

BOTTOM:
event / strategy feed

Allow drag-and-drop interventions onto REAL map coordinates.

Intervention must snap where appropriate.

**Examples:**

Shelter → valid facility / candidate site

Road protection → real road segment

Bus hub → road-accessible location

Cooling center → building/facility or candidate point

Placement creates an animated influence/coverage region.

Immediately update:

residents potentially covered
vulnerable residents potentially covered
estimated accessibility
remaining budget

Allow:
move
undo
delete
redo


## 11. FOG OF WAR / INTELLIGENCE SYSTEM


Do not reveal every layer automatically.

Players initially receive incomplete planning information.

Create INTEL TOKENS.

Spend them to unlock:

DEMOGRAPHIC SCAN
ROAD FRAGILITY SCAN
HEALTH ACCESS SCAN
FLOOD DEPTH / HEAT DETAIL
COMMUNITY REPORTS
INFRASTRUCTURE X-RAY

This prevents the optimal move from being obvious.

It turns geospatial layers into gameplay mechanics.


## 12. "SPECIAL POWERS"


Special powers should remain believable, not magical.

SATELLITE SCAN
Reveal high-risk H3 cells temporarily.

INFRASTRUCTURE X-RAY
Reveal critical network bottlenecks.

COMMUNITY PULSE
Reveal local-knowledge reports and underserved populations.

TIME FREEZE
Pause planning timer for 10 seconds once.

AI CONSULT
Ask Gemini one constrained strategic question.

EMERGENCY BROADCAST
Temporarily increases evacuation compliance / route awareness in simulation.

RAPID DEPLOYMENT
Relocate one mobile intervention after simulation begins.

SECOND CHANCE
Reverse one placement immediately before lock-in.

Give each power a cost, cooldown, or one-use limit.


## 13. RIPPLE PREVIEW


One of the signature UX features.

Before confirming an intervention:

hover/place provisionally.

Show a subtle preview of downstream impact.

**Example:**

PROTECT ROAD R42

Direct:
+ road remains passable

Ripple:
+ 1,840 represented residents maintain shelter route
+ hospital travel time improves
+ 2 neighborhoods preserve redundancy

Display animated arcs or pulses.

Call feature:

"SEE THE RIPPLE"


## 14. LOCK PLAN


At timer end:

3
2
1

PLAN LOCKED.

Camera slightly pulls back.

Music/audio shifts.

Simulation begins.


## 15. LIVE DISASTER SIMULATION


Must be interactive.

Controls:

PLAY
PAUSE
1x
2x
4x
STEP
REWIND
RESET CAMERA

Timeline at bottom.

Show current simulated time.

Do not make simulation a pre-rendered video.

Users must still click:
roads
zones
facilities
agents
events

while it runs.


## 16. AGENT MOVEMENT


Use deck.gl TripsLayer or equivalent.

Representative resident / vehicle groups move along actual route geometries.

Colors:

cyan/blue:
successfully evacuating

green:
protected

yellow:
delayed

orange:
rerouted

red:
stranded

purple:
functionally isolated

Do not claim each dot is a single real person.

**Show:**
"1 agent = X represented residents."


## 17. NETWORK GRAPH / ROUTING ENGINE


**Backend:**

Python FastAPI
GeoPandas
Shapely
OSMnx
NetworkX

Pre-process/cache road graphs for all cities.

Represent:

intersections = nodes
road segments = edges

Edge attributes:

distance
travel time
hazard exposure
open/closed
capacity proxy
intervention protection
criticality

When road fails:

remove / penalize edge.

Recompute relevant routes.

Do NOT recompute all-pairs routing every frame.

Cache candidate paths.

Perform event-triggered recalculation.


## 18. ACHILLES' HEEL SYSTEM


Signature feature.

**Button:**

FIND THE CITY'S ACHILLES' HEEL

Analyze road / infrastructure network.

Potential signals:

betweenness
articulation/cut behavior
route redundancy
population served
hospital connectivity
shelter connectivity
hazard exposure

Animate:

SCANNING CITY...

Analyzing 1,243 road segments...
Testing connectivity...
Evaluating population dependence...
Finding hidden bottleneck...

Camera flies to candidate.

Display:

CRITICAL INFRASTRUCTURE FOUND

WHY IT MATTERS
WHO DEPENDS ON IT
WHAT HAPPENS IF IT FAILS
HOW TO PROTECT IT

This is an analytical aid and game mechanic.


## 19. SHADOW CITY


Create mode toggle:

PHYSICAL CITY
SHADOW CITY

Physical City:
normal geography.

Shadow City:
show only what remains functionally accessible.

Areas fade/darken when they lose access to:

hospital
shelter
food
transport
cooling
evacuation route

A neighborhood can physically exist but functionally disappear.

Metric:
FUNCTIONAL ISOLATION INDEX.

Color isolated zones purple.


## 20. CASCADE GRAPH


When something fails, show causal chain.

**Example:**

ROAD R42 FLOODED
       ↓
PRIMARY SHELTER ROUTE LOST
       ↓
ALTERNATE ROUTE +16 MIN
       ↓
BUS CAPACITY EXCEEDED
       ↓
412 REPRESENTED HOUSEHOLDS DELAYED
       ↓
ZONE 42 ENTERS FUNCTIONAL ISOLATION

Animate nodes progressively.


## 21. RANDOM EVENT SYSTEM


Every game should not play identically.

Events are seeded and reproducible.

**Examples:**

Raleigh:
- creek rises faster than expected
- shelter capacity reduced
- local road floods
- ambulance route blocked

Miami:
- pump failure
- surge arrives early
- bridge restriction
- shelter reaches capacity

NYC:
- blackout expands
- cooling center generator fails
- transit node closes
- emergency-room demand spike

SF:
- aftershock
- secondary fire
- road debris
- water-line disruption

Gemini may narratively select/describe events ONLY from a validated event schema.

Deterministic game logic computes impact.

AI must not invent numeric geospatial outcomes.


## 22. GAMIFICATION / METRICS


Do NOT make score simply "people saved."

Use multidimensional score.

RESILIENCE SCORE 0–100.

Components:

Population Protected
Vulnerable Population Protected
Accessibility Preserved
Critical Infrastructure Preserved
Resource Efficiency
Equity
Response Time
Community Trust

Show weights transparently.

**Example:**

FINAL SCORE: 84

Population Protection       89
Vulnerable Population       93
Accessibility               81
Network Resilience          74
Budget Efficiency           88
Equity                      79

Do not pretend weights are scientifically canonical.

Label:
"Game scoring model."

Allow methodology inspection.


## 23. EQUITY / FAIRNESS MECHANIC


A plan that protects only high-population or wealthy/low-risk areas should not
automatically dominate.

Use vulnerability-aware weighting.

**Show:**

WHO BENEFITED?

overall residents
older adults
low-income households
no-vehicle households
high-risk zones

Make geographic tradeoffs visible.


## 24. POST-ROUND REVEAL


This is the emotional high point.

Sequence:

1. YOUR RESULT
2. NEIGHBORHOOD BREAKDOWN
3. CRITICAL FAILURE
4. WHAT YOU MISSED
5. OPTIMAL/REFERENCE PLAN
6. CROWD PLAN
7. PERCEPTION GAP
8. AI DEBRIEF

Use strong animations.


## 25. GHOST TIMELINE


Allow a split-screen counterfactual replay.

LEFT:
YOUR CITY

RIGHT:
OPTIMIZED CITY

Run both timelines synchronously.

Same scenario seed.

Same disaster.

Different intervention plan.

User watches consequences diverge.

Call it:

"THE ROAD NOT TAKEN"

or

"ALTERNATE TIMELINE"

Metrics animate independently.

This should be a major wow feature.


## 26. MULTIPLAYER LEADERBOARD


**Show:**

rank
player
score
vulnerable population protected
budget efficiency
critical infrastructures preserved

Allow cooperative mode where group score matters more than rank.


## 27. CROWD INTELLIGENCE MAP


Aggregate all interventions placed by the room.

Render heatmap / H3 intensity layer.

Then compare with deterministic optimization.

Create FOUR classifications:

CONSENSUS PRIORITY
crowd high + model high

DATA BLIND SPOT
crowd low + model high

COMMUNITY SIGNAL
crowd high + model low

LOW PRIORITY
crowd low + model low

This four-quadrant output is extremely important.

Show it visually.


## 28. PERCEPTION GAP


High point of multiplayer reveal.

**Example:**

"Every player overlooked Zone 17."

Then reveal:

represented residents
vulnerability
no-car percentage
hazard level
nearest viable shelter
network bottleneck

Ask:

"Why did everyone miss it?"

This turns gameplay into participatory geospatial research.


## 29. COMMUNITY KNOWLEDGE PINS


Residents can add reports such as:

"this street floods"
"this bus stop has no shade"
"this intersection becomes inaccessible"
"elevator frequently fails"
"local shelter entrance is difficult to access"

Types:

Flood
Heat
Mobility
Accessibility
Infrastructure
Other

Pins are clearly marked:
COMMUNITY REPORTED
NOT VERIFIED

Allow upvotes / confirmations.

Keep separate from authoritative layers.


## 30. MY ADDRESS


Optional personal mode.

User enters address.

Geocode client-side/server-side as appropriate.

Do not permanently store exact address.

**Show:**

scenario exposure
nearest help
route to shelter/cooling center
whether route survives current simulation
nearby community reports

Display privacy note.


## 31. CITY DNA


Every neighborhood has a "Resilience DNA."

Visualization:

Flood
Heat
Mobility
Healthcare
Social Vulnerability
Road Fragility
Shelter Access
Tree Canopy
Infrastructure Exposure

Allow:

FIND SIMILAR NEIGHBORHOODS

Highlight spatially distant neighborhoods with similar profiles.


## 32. AI COMMANDER — GEMINI


Gemini must NOT be a generic chatbot.

Use Gemini function/tool calling.

Expose deterministic tools:

get_city_state()
get_zone_profile()
get_high_risk_zones()
get_vulnerable_population()
get_critical_roads()
simulate_road_failure()
query_shelter_access()
query_healthcare_access()
query_timeseries()
compare_plans()
optimize_resources()
find_facility_candidates()
get_player_plan()
get_crowd_plan()
get_perception_gap()
generate_alert_context()

Gemini:

- generates scenario briefing
- explains analysis
- provides post-round debrief
- answers natural-language geospatial questions
- acts as strategic coach
- explains WHY an optimized intervention matters

Gemini must NOT fabricate numbers.

All numerical claims must come from tool results.

Example prompt:

"We have $3M left. Which intervention helps the most no-car households?"

Gemini calls tools.

Return:

recommendation
evidence
map target
tradeoff
confidence/limitations

**Button:**
SHOW ME

Map flies to referenced location.


## 33. AI DISASTER DIRECTOR


Create optional mode:

AI DISASTER DIRECTOR

Gemini may choose a narrative event from a pre-approved event catalog based
on current game state.

For example:

"Shelter B loses 25% of capacity."

The event's deterministic effect must already be encoded.

AI decides WHEN / HOW TO NARRATE.

Game engine controls WHAT THE EFFECT MEANS.


## 34. ELEVENLABS


Use ElevenLabs for immersive audio.

Features:

EMERGENCY BRIEFING
POST-ROUND NARRATION
PUBLIC ALERTS
ACCESSIBILITY AUDIO
MULTILINGUAL MESSAGE GENERATION

Create:
RADIO MODE.

When enabled:

a command-center radio feed narrates major events.

**Example:**

"Warning. Road R42 is no longer passable.
Zone 17 has lost its primary shelter route."

Do not over-narrate.

Prioritize critical events.

Languages:
English
Spanish
Hindi
Mandarin

Provide transcript/captions.


## 35. TIGER DATA


Tiger Data / TimescaleDB is core infrastructure, not decoration.

Use PostgreSQL + time-series hypertables for:

simulation_events
environment_observations
infrastructure_status
zone_risk_snapshots
player_actions
score_snapshots
multiplayer_events

Potential schema:

simulation_events(
    time TIMESTAMPTZ,
    room_id UUID,
    city_id TEXT,
    scenario_id TEXT,
    event_type TEXT,
    entity_id TEXT,
    payload JSONB
)

player_actions(
    time TIMESTAMPTZ,
    room_id UUID,
    player_id UUID,
    intervention_type TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    cost NUMERIC,
    metadata JSONB
)

zone_risk_snapshots(
    time TIMESTAMPTZ,
    room_id UUID,
    zone_id TEXT,
    hazard_score DOUBLE PRECISION,
    accessibility_score DOUBLE PRECISION,
    isolation_score DOUBLE PRECISION,
    protected_population INTEGER
)

Use Continuous Aggregates for:

room leaderboard
city-wide metrics
time-series charts
planner dashboard
crowd placement aggregates


## 36. LIVE DATA MODE


Separate:

GAME SCENARIO
from
LIVE CONDITIONS

Never mix them silently.

LIVE mode can ingest applicable NOAA / USGS feeds.

**Show:**

LIVE DATA
or
SIMULATED SCENARIO

prominently.

If participating in a compatible data-streaming challenge,
build optional pipeline integration separately.


## 37. SOLANA


Solana is optional and must never dominate product.

Use Devnet.

Best use:

"CIVIC PROOF."

After a player / room submits a final plan:

hash canonical plan JSON.

Record:

plan hash
room
city
timestamp
score/reference
optional consensus classification

in a Devnet transaction.

Then show:

VERIFIED PLAN RECEIPT.

Top plans may receive a demo badge.

Alternative:
record planner-approved interventions / resource commitments.

Never imply blockchain validates whether the plan is objectively correct.

It only verifies that a record has not been silently changed.


## 38. GODADDY / DOMAIN


Design branding so application can deploy to a custom domain.

Do not hardcode final domain before availability is verified.


## 39. DATA SOURCES


**Base:**

OpenStreetMap
US Census
Census TIGER/Line where useful
NOAA
USGS
NC OneMap for Raleigh
Data.gov

May additionally use official local open-data portals where needed:

Raleigh local GIS
Miami-Dade open/resilience data
NYC Open Data
DataSF / California / USGS

Keep source metadata for every layer.

Data panel must show:

source
timestamp/version if known
simulation role
limitations


## 40. FRONTEND STACK


**Use:**

Next.js
React
TypeScript
Tailwind CSS
shadcn/ui
MapLibre GL JS
deck.gl
Zustand
TanStack Query
Framer Motion / Motion where useful
Recharts for secondary charts

**Optional:**
Three.js only when MapLibre/deck.gl cannot achieve desired effect.

Avoid unnecessary libraries.


## 41. BACKEND STACK


**Recommended:**

Python 3.12+
FastAPI
GeoPandas
Shapely
OSMnx
NetworkX
Pydantic
Tiger Data / PostgreSQL

**Optional optimization:**
OR-Tools
SciPy

**Realtime:**
WebSocket endpoint for rooms/simulation state.


## 42. FRONTEND ARCHITECTURE


Use a modular city adapter architecture.

**Example:**

/src
  /app
  /components
  /features
    /map
    /simulation
    /planning
    /multiplayer
    /results
    /ai
    /audio
  /cities
    /raleigh
    /miami
    /new-york
    /san-francisco
  /scenarios
  /stores
  /types
  /lib

CityPack interface:

interface CityPack {
  id: CityId;
  name: string;
  center: [number, number];
  initialZoom: number;
  initialPitch: number;
  bounds?: LngLatBoundsLike;
  scenarioIds: string[];
  availableLayers: LayerDefinition[];
  interventionCatalog: InterventionDefinition[];
  cameraBookmarks: CameraBookmark[];
  attribution: AttributionEntry[];
}

Scenario interface:

interface DisasterScenario {
  id: string;
  cityId: CityId;
  name: string;
  durationSeconds: number;
  briefing: ScenarioBriefing;
  hazards: HazardDefinition[];
  randomEvents: ScenarioEventDefinition[];
  scoringWeights: ScoreWeights;
  initialize(state: SimulationState): SimulationState;
  tick(state: SimulationState, dt: number): SimulationState;
}


## 43. CENTRAL SIMULATION STATE


One state drives ALL pages.

No disconnected demo pages.

SimulationState:

cityId
scenarioId
seed
simulatedTime
phase
budget
players
roles
interventions
hazards
roadStatuses
facilityStatuses
zoneMetrics
agentGroups
events
scores
crowdData
aiRecommendations

If road R42 fails:

map changes
routes change
AI sees it
timeline sees it
results include it
Shadow City sees it
planner dashboard sees it

ONE WORLD STATE.


## 44. PERFORMANCE REQUIREMENTS


Do NOT store animation of every agent in React component state.

Use deck.gl and animation state efficiently.

Use requestAnimationFrame.

Use typed arrays where helpful.

Use Web Workers for heavy client computations where practical.

Use map vector tiles / PMTiles / MVT rather than huge GeoJSON where appropriate.

Level of detail:

far zoom:
H3 / aggregate

medium zoom:
roads + zones + facilities

close zoom:
buildings + detailed interventions + agents

Precompute/cache OSM road graphs.


## 45. UI VISUAL DESIGN


Style:

premium emergency-command strategy game.

**Base:**
near-black navy / charcoal.

Use city-specific environmental accent palettes without sacrificing consistency.

Avoid:
generic admin dashboard
giant grids of cards
excessive gradients
neon overload
stock photography

Map should occupy majority of the game screen.

Typography:
clear modern sans serif.

Important counters:
large monospaced/tabular figures where appropriate.

Status terminology:

STABLE
WATCH
ELEVATED
CRITICAL
ISOLATED

Do not rely solely on red/green.


## 46. HUD


TOP LEFT:
city / scenario

TOP CENTER:
simulated clock / phase / timer

TOP RIGHT:
budget / resilience

LEFT EDGE:
interventions / powers

RIGHT:
selected zone / facility / road inspector

BOTTOM:
timeline

BOTTOM RIGHT:
AI Commander button
radio / ElevenLabs toggle

Minimal until expanded.


## 47. NEIGHBORHOOD INSPECTOR


Click geographic area.

**Show:**

population represented
hazard exposure
older population
vehicle access
income vulnerability
healthcare access
shelter/cooling access
road redundancy
current isolation
interventions nearby

Explain:
WHY THIS ZONE MATTERS.


## 48. INTERVENTION PLACEMENT UX


When picking intervention:

cursor changes to placement mode.

Valid locations:
highlight subtly.

Invalid:
do not permit placement.

On placement:
pulse animation.

Coverage area grows.

Budget animates down.

Potential impact counter updates.

Provide accessible keyboard placement alternative.


## 49. PLANNER DASHBOARD


Separate post-game analytical view for civic planners.

Aggregate across many game sessions.

**Show:**

most frequently selected intervention sites
consensus priorities
model priorities
data blind spots
community signals
local knowledge pins
average outcomes
neighborhood equity measures

Filters:

city
scenario
date
player count
intervention
neighborhood

Export:
GeoJSON
CSV


## 50. DATA/METHODOLOGY PAGE


This page is mandatory.

Explain:

source datasets
model assumptions
scenario nature
risk normalization
network routing
scoring
optimization
limitations

Visual pipeline:

DATA
  ↓
GEOSPATIAL PROCESSING
  ↓
CITY GRAPH
  ↓
SCENARIO ENGINE
  ↓
PLAYER ACTIONS
  ↓
SIMULATION
  ↓
SCORING
  ↓
CROWD INTELLIGENCE
  ↓
PLANNER ACTION MAP

Never hide limitations.


## 51. ACCESSIBILITY


Keyboard support.

High-contrast mode.

Colorblind-safe patterns/labels.

Screen-reader descriptions of current selected geography.

Map information must have textual alternatives.

Voice briefing captions.

Reduced-motion option.

If reduced motion:
disable camera shake
reduce water/fire animations
avoid flashing effects


## 52. MOBILE


Players should be able to join multiplayer from phones.

Mobile UI:

map full-screen
bottom intervention tray
top timer/budget
swipe-up zone inspector
large touch targets

Desktop/projector:
full command-center view.


## 53. JUDGE DEMO MODE


Create a deterministic seeded demo that cannot fail.

**Button:**
RUN JUDGE DEMO.

Suggested sequence:

1. Open globe.
2. Choose Raleigh.
3. Cinematic fly-in.
4. ElevenLabs hurricane briefing.
5. Show $10M budget.
6. Place shelter.
7. Place bus hub.
8. Protect one road.
9. Lock plan.
10. Flood begins.
11. Residents evacuate.
12. One unexpected road fails.
13. Trips reroute.
14. Zone turns purple: FUNCTIONALLY ISOLATED.
15. Trigger Achilles' Heel analysis.
16. Reveal that an unprotected road was critical.
17. Show cascading dependency graph.
18. End simulation.
19. Player score.
20. Show other multiplayer plans.
21. Crowd heatmap.
22. Optimal plan.
23. PERCEPTION GAP:
    "Everyone overlooked this neighborhood."
24. Reveal high no-car/vulnerable population.
25. Gemini explains why.
26. ElevenLabs narrates debrief.
27. Show Ghost Timeline:
    player plan vs optimized plan.
28. Planner map updates.
29. Optional Solana plan proof.
30. Final line:

"Maps show us where hazards are.
Urban Pulse shows us where action changes the outcome."

Demo length:
90–120 seconds.


## 54. CROSS-CITY "WORLD TOUR" MODE


After completing a city:

show world map.

Award:
RESILIENCE BADGE.

Unlock next city.

Progress:

RALEIGH     84
MIAMI       76
NEW YORK    LOCKED / 91
SAN FRANCISCO 68

Create:

GLOBAL RESILIENCE PASSPORT.

Badges:

FLOOD STRATEGIST
EQUITY CHAMPION
NETWORK GUARDIAN
HEAT DEFENDER
INFRASTRUCTURE ARCHITECT
PERCEPTION BREAKER

These are game achievements.


## 55. DAILY CITY CHALLENGE


A deterministic scenario seed changes daily.

All players compete on same:

city
budget
event seed
resources

Leaderboard.

This improves replayability.


## 56. SHAREABLE RESULTS


Generate beautiful result card:

URBAN PULSE

MIAMI — STORM SURGE SIEGE

Score: 87
Protected: 81%
Equity: 92
Budget Efficiency: 79

"You ranked in the top X%" only if actual rank data exists.

Share link.

Do not fabricate comparative stats.


## 57. ERROR/FALLBACK MODE


Hackathon reliability matters.

If remote dataset fails:
use bundled simplified snapshot.

If Gemini fails:
use deterministic debrief templates.

If ElevenLabs fails:
display transcript + browser TTS fallback if appropriate.

If Solana fails:
hide proof feature.

If live data fails:
switch to scenario data.

The core game MUST remain playable.


## 58. DEMO DATA RULE


Seed realistic but clearly labeled simulation data.

Do not label mock data as LIVE.

**Show:**
DEMO DATA
SCENARIO DATA
or
LIVE DATA

depending on source.


## 59. BUILD PRIORITY


Although architecture supports everything, build in this order:

P0:
real MapLibre map
city selection
four city camera packs
Raleigh complete planning loop
budget / interventions
Raleigh simulation
score/results

P1:
multiplayer rooms
real road routing
Raleigh crowd reveal
perception gap
Achilles' Heel
Gemini debrief

P2:
Miami scenario
NYC scenario
San Francisco scenario

P3:
Tiger Data
ElevenLabs
Planner Dashboard
Ghost Timeline
Shadow City

P4:
Solana
My Address
Community Pins
Daily challenge
role powers
advanced achievements

Never sacrifice a working end-to-end game for incomplete bonus features.


## 60. FINAL PRODUCT PRINCIPLE


The application must never feel like:

"four maps plus a chatbot."

It must feel like:

ONE CITY-RESILIENCE GAME ENGINE
WITH FOUR REAL GEOGRAPHIC WORLDS.

Every city must force a different strategy.

Raleigh asks:
"What happens when roads disappear?"

Miami asks:
"Can you stay ahead of rising water?"

New York asks:
"Who loses protection when the city overheats and the grid weakens?"

San Francisco asks:
"What fails after the shaking stops?"

The emotional loop is:

SEE THE CITY
→ UNDERSTAND THE THREAT
→ MAKE HARD CHOICES
→ WATCH CONSEQUENCES UNFOLD
→ DISCOVER WHAT YOU MISSED
→ COMPARE WITH EVERYONE ELSE
→ LEARN WHERE ACTION MATTERS

Build Urban Pulse so that the judges want to play another city after the
first demo ends.
