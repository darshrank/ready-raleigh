# Ready Raleigh — Product Plan (v2)

**Track:** Center for Geospatial Analytics.
**One line:** Drop into a real 3D neighborhood built from public data, read the landscape like a
GeoGuessr pro, and plan its defense like a SimCity mayor. Every guess and plan becomes a map of
where the city should act.

**How it answers the problem statement**
- *Understand the issue:* players learn to read flood and heat risk from terrain, buildings and materials.
- *Who and what is affected:* every reveal shows real buildings, real (aggregate) people and real past damage.
- *Where to take action:* all guesses, plans and local tips aggregate into the Planner View
  (§7), which ranks places where data and residents agree action is needed, and flags where
  the data misses something.

---

## 1. Core insight: risk-reading is a learnable skill

GeoGuessr players learn transferable clues ("metas"), not every road. Flood and heat risk work
the same way: a creek in a low bowl, a culvert under a road, a manufactured home built before
the flood maps, a dark flat roof beside a parking lot mean the same thing anywhere. The game
teaches these clues as a **Field Guide**, so a non-local can learn the skill and beat a local.
Locals add **Local Intel** (tribal knowledge the data misses), which becomes learnable for
everyone.

## 2. Players and recipients

| Who | What they get |
|---|---|
| Players (residents, students, anyone) | A fun party/daily game; they learn their own city's risk and gain a transferable skill |
| Locals | A way to put what they know on the map and be credited for it |
| Planners / emergency managers | Planner View: crowd + data agreement map, blind spots, local intel, exports for QGIS |

## 3. Session flow

`Landing → Lobby → 5 rounds (each: brief → play → reveal) → Results → Perception gap → My Address`

Modes: **Flood** (ship first), **Heat** (second). Maps (areas): start with two Raleigh
location packs — **Crabtree Creek corridor** and **Walnut Creek / Southeast Raleigh** — then
all of Wake County, then historical storm maps (Florence, Matthew), then NC, then any US city.

## 4. Lobby (GeoGuessr Party / Among Us style)

- Host taps **Play with friends** → room gets a 4-letter code + QR (QR encodes `https://<domain>/r/CODE`).
- Up to 12 players; each gets a colored hard-hat avatar (8 colors, colorblind-safe set, plus icon shape).
- Avatars drop into a small plaza on the 3D map. Phones show your avatar, name field, and **Ready**.
- Host settings as visual tiles: Map, Mode, Rounds (3/5/7), Timer (30/60/90 s), Rules
  (Normal / No Lenses / Pro = no lenses + no street photo).
- **TV mode:** `/tv/CODE` shows the shared map, lobby, reveals and scoreboard; phones act as controllers.
- Reconnect by session id; late joiners spectate the current round and join the next.
- Also: **Solo** and **Daily Challenge** (same 5 rounds for everyone, one attempt, share card).

## 5. Rounds

Every round = one location (a ~2 km square from a pack) + one question + one input.
Rounds in a game are drawn from the pack's precomputed round bank (see DATA.md §6),
mixing types: typically A, B, A, B, C.

### Type A — Read the Block (estimate)
Camera starts on a 3D block; a street-level photo card is shown if available.
Question examples (Flood): "Water depth inside this building in a 1%-chance flood?",
"How many households on this block have no car?" (Heat): "Surface temperature here at 3 PM on a
clear July day?" Input: one slider with units. Truth: precomputed value from the pack.

### Type B — Pin It (classic GeoGuessr)
Question examples: "Where did water reach its highest mark in this area during Florence?"
(USGS high-water marks), "Which road segment floods first?" (inundation stage order),
"Which block is hottest?" (Landsat LST), "Where are flood insurance claims most concentrated?"
(OpenFEMA, tract level → use tract centroid; tolerance = tract size). Input: drop a pin.

### Type C — Build (SimCity)
Budget + palette of interventions/materials (§6.3). Drag cards onto valid sites. Live preview of
each placement's effect. Press **Run storm** (or **Run heatwave**) → animated simulation →
split screen: your plan vs. optimal plan. Score from protected residents (vulnerability
weighted) + damage avoided.

### Scoring (all deterministic, in `server/scoring.ts`, unit tested)

- Max **5,000** per round.
- Pin: `score = 5000 * exp(-d / s)` where `d` = meters from truth, `s` = round scale
  (default `area_diagonal_m / 10`, widened for tract-level truth).
- Estimate: `score = 5000 * exp(-|guess - truth| / s)` where `s` = round tolerance stored in the
  pack (set from data uncertainty, e.g. depth ±0.5 ft model error → s = 1.5 ft).
- Build: `score = 5000 * clamp(player_value / optimal_value, 0, 1)` where
  `value = Σ protected_resident_weight + λ * damage_avoided_$ / 1e5` (λ in pack config).
  Vulnerability weights: base 1.0; +0.5 age 65+; +0.5 no vehicle; +0.5 below poverty;
  +0.25 limited English (configurable, documented in METHODS.md).
- Lens penalty: each lens used during the round multiplies score by 0.9.
- Time bonus: up to +5% for locking in during the first third of the timer.
- Ties: earlier lock-in wins.

## 6. Skill system, materials, simulation

### 6.1 Field Guide (transferable clues)
A clue card unlocks when it decided the answer in a reveal you played. Each card: name, icon,
one-line rule, 3D snapshot of where you saw it, the data that proves it, mastery stars (0–3,
by correct uses). Starting set (Flood): Creek + low bowl; Culvert under road; One road out;
Pre-flood-map construction near water; Manufactured home in floodplain; Slab vs raised
foundation; Paved upstream (impervious upstream area); No-car households far from transit.
(Heat): Dark flat roofs + parking; No street canopy; Dense tree canopy; Water/greenway proximity;
Heat-vulnerable residents (65+, no AC proxy).
Each round in the bank is tagged with the clues that apply (computed from features; DATA.md §6).

### 6.2 Lenses (hint economy)
Four toggles re-color the 3D scene in place: **Elevation** (height above nearest stream, contours),
**Water** (streams, culverts, FEMA zones), **Surface** (materials, impervious %), **People**
(block-group vulnerability). Each use = ×0.9 score. After a miss, the coach names the lens that
would have helped.

### 6.3 Materials
**Building inspector** (tap any building): construction type, occupancy class, year built,
foundation / first-floor height, roof material & color (data or "estimated"), replacement value,
and live effect (water depth & damage $ in Flood; roof/surface temp in Heat). Source badge on each.

**Intervention palette** (costs are tunable config in `pipeline/config/interventions.yaml`;
every effect has a cited assumption in METHODS.md):

| Card | Mode | Placement | Effect in simulation |
|---|---|---|---|
| Shelter (real school/church/community center) | Flood/Heat | candidate sites only | Coverage = residents within 15 min drive on network not flooded |
| Bus pickup point | Flood | any road node | No-car households within 10 min walk evacuate |
| Elevate home(s) | Flood | residential building | First-floor height +N ft → damage via curves |
| Culvert upsizing | Flood | OSM culvert | Road overtop stage +X |
| Earthen berm / Concrete floodwall | Flood | drawn line ≤300 m | Protects area behind it up to design height |
| Permeable pavement | Flood | parking lot polygon | Lower runoff coefficient for upstream contributing area |
| Rain garden / bioswale | Flood | parcel/open land | Local storage volume |
| Street trees (pick species/canopy) | Heat/Flood | along street segments | Shade (sun-position shadows), canopy % up |
| Cool roof coating | Heat | building roof | Roof albedo up → roof/indoor temp down |
| Green roof | Heat/Flood | flat roof | Albedo + storage |
| Cooling center / water station | Heat | candidate sites | Walk-time coverage for heat-vulnerable residents |

### 6.4 Simulation (precomputed; client plays it back)
- **Flood:** HAND inundation. Water surface elevation per stream reach for stages
  1..N (from gauge history or Atlas 14 scenario); cell is wet if HAND < stage. Buildings: depth =
  WSE − first-floor elevation → damage % via HAZUS depth-damage curve by occupancy + construction.
  Roads: segment closed when its elevation < WSE. Access recomputed per stage.
- **People:** census block population dasymetrically assigned to residential buildings; synthetic
  households sampled from ACS block-group distributions (age, vehicle, poverty, language).
  Always labeled "simulated residents".
- **Heat:** Landsat surface temperature baseline (clear summer afternoon scene) + linear model
  fitted per area on canopy %, impervious %, roof albedo → intervention deltas.
- **Optimal plan:** maximal covering location problem over candidate sites with the same budget,
  solved with OR-Tools CP-SAT, precomputed per Build round.
- The game server applies a player's plan by table lookups on precomputed per-site coverage
  sets and per-building damage tables, so a Build round resolves in < 200 ms.

### 6.5 Local Intel (tribal knowledge)
Anyone can drop a tip (text, voice, or photo) on the map. Gemini returns
`{category, location_hint, geometry_guess, recurring:boolean, severity, pii_found}`; the server
snaps geometry to OSM features, strips PII, stores it. Other players upvote. Each tip gets a
badge computed by code: **Matches data** (overlaps modeled risk) or **Data misses this**.
Tips appear in reveals nearby. Tips with ≥10 upvotes from ≥5 players become regional clue cards.
Contributors get a Local Expert badge per H3 (res 8) cell.

### 6.6 Coach
After each reveal, one or two sentences explaining *this player's* miss, generated by Gemini
from the round's feature JSON and the player's answer only (no free facts). Falls back to the
round's template explanation.

## 7. Planner View (`/planner`)

- **Agreement grid** per H3 res-9 cell: data risk (high/low) × crowd attention (high/low) →
  *Act now*, *Blind spot: outreach*, *Local knowledge: investigate*, *Lower priority*.
- Intervention consensus: what players built where; damage avoided per $ by material.
- Local Intel layer filterable by "Data misses this".
- Neighborhood brief (Gemini) citing the datasets used.
- Usage panel: players, rounds, accuracy curves (round 1→5, game 1→n).
- Exports: GeoJSON, GeoPackage, CSV; "Open in Kepler.gl" link with a hosted GeoJSON.

## 8. UX spec and design system

### 8.1 Principles
1. Map first: the 3D city is full screen; UI is floating cards. No sidebars of forms.
2. One decision per screen.
3. Show, don't tell: reveals are animations, not paragraphs.
4. Every number is tappable → source sheet.
5. Under 10 seconds to fun: no sign-up, first round teaches itself (contextual tooltips once).

### 8.2 Visual identity: "City Desk, Storm Night"
A modern emergency-operations feel over a warm SimCity map. Map is bright and toy-like; UI is
dark glass cards with crisp type and signal colors.

**Tokens** (`client/src/styles/tokens.css`):
```
--ink-900: #0E1117   (card background, 88% opacity + 12px blur)
--ink-700: #1B2130   --ink-500: #2C3446   --line: rgba(255,255,255,.10)
--paper:   #F4EFE6   (light surfaces, Field Guide cards)
--text:    #F5F7FA   --text-dim: #A9B1C1
--water:   #2F7DF6   --water-deep: #1446A0   (one water ramp everywhere)
--heat-1:  #FFE08A   --heat-2: #FF9F43  --heat-3: #F2542D  --heat-4: #9E1F3D
--safe:    #2FBF9B   --alert: #FFB020   --danger: #E5484D
--map-grass: #9BD37A --map-road: #F2E6CC --map-water: #7FB8FF --map-bldg: #E9E2D6
Player colors (CB-safe + shape): #3B82F6 ●, #F59E0B ▲, #10B981 ■, #EF4444 ◆,
#8B5CF6 ★, #EC4899 ⬟, #14B8A6 ⬢, #F97316 ✚
```
Type: **Space Grotesk** (headings, numbers; tabular figures), **Inter** (body). Radii 14px
cards, 999px pills. Shadows: `0 8px 30px rgba(0,0,0,.35)`. Motion: 200 ms UI, 900–1200 ms
camera (ease-in-out cubic), springs for score counters.

**Map style:** custom MapLibre style from OpenFreeMap/OSM: saturated grass, warm roads,
buildings extruded with facade color by construction type (wood #E9D8BE, masonry #C98F6B,
concrete #D9DCE1, steel #AEB8C4, manufactured #F1E3A0), roof cap color by roof color. Terrain
with 1.4× exaggeration + hillshade. Camera default pitch 55°, bearing snaps in 45° steps
(SimCity feel), free rotate on drag.

### 8.3 Screens (each needs loading, empty, error states)

1. **Landing:** orbiting 3D Raleigh with light rain; buttons *Play with friends*, *Daily
   Challenge*, small *Join with code*. Live strip: "Live: N NC gauges at action stage" → tap flies there.
2. **Lobby:** big code + QR, avatars dropping into plaza, host tiles, Ready states.
3. **Round:** top bar (round x/5, draining timer bar, lock-in checks); center 3D; corner
   street-photo card (expand on tap); bottom sheet with question + input; right edge lens
   buttons with "−10%" chips. Phone: bottom sheet + horizontal lens row.
4. **Reveal:** (1) all guesses drop in player colors, (2) truth lands with ripple, lines draw
   guess→truth, (3) camera flies to truth + 3 s animation (water rising to the real mark / heat
   columns), (4) points count up, scoreboard reorders, (5) coach card + "New Field Guide card"
   stamp, (6) Local Intel chip if nearby.
5. **Build:** bottom tray of material cards (illustrated, cost chip); drag to snap; live
   effect preview (coverage ripple along roads, shade, runoff arrows); budget bar + "residents
   protected" counter; building inspector on tap; **Run storm** → sky darkens, water rises,
   resident dots move, roads pulse red when closed; split screen vs optimal.
6. **Results:** podium, crowd heatmap fades in, data high-need cells pulse where crowd left
   gaps ("Perception gap"), share card.
7. **My Address:** search box (browser geocoding), camera dive, risk card for that building
   (materials, depth at 1% flood, nearest shelter route open/closed, top 2 actions).
8. **Field Guide:** grid of clue cards (paper style), locked silhouettes, mastery stars.
9. **Source sheet:** opened from any number: dataset, date, resolution, method, link.
10. **Methods page:** plain-language model explanations + validation results (§9).
11. **Planner View:** §7.

### 8.4 Sound
Rain loop, distant thunder, siren sting at storm start, radio-static transitions, stamp on
lock-in, chime when others lock in, coin count on points, cicadas + heat shimmer in Heat mode.
Always-visible mute (all / effects / off), remembered per device. Captions for all speech.

### 8.5 Accessibility
Colorblind-safe palettes plus icons/shapes; ≥44 px tap targets; every gesture has a button;
captions; reduced-motion setting (cuts camera flights to fades); 2D map toggle for low-end devices.

## 9. Correctness and validation (what the geospatial judges care about)

Build these checks into `pipeline/validate.py`; publish results on the Methods page and in the pitch:
- **Flood backtest:** modeled peak WSE vs USGS high-water marks for a past event in or near the
  area → report median and 90th-percentile absolute error (ft) and N marks.
- **Extent check:** modeled 1% extent vs FEMA NFHL Zone A/AE → IoU and % of FEMA area captured.
- **Damage sanity:** modeled damage by tract vs OpenFEMA NFIP claim counts/amounts by tract →
  Spearman rank correlation.
- **Heat check:** model vs held-out Landsat scene → RMSE (°F).
- **Usage proof:** rounds played, players, accuracy curve round 1→5 and game 1→n (shows learning).
Uncertainty is visible: depth and damage show ranges; AI estimates are labeled with confidence;
scoring tolerance widens where data is uncertain. Limitations listed in-app (e.g. no storm-drain
modeling; building data is NC-specific until NSI expansion).

## 10. Sponsor challenge integrations

| Challenge | Real job | Priority |
|---|---|---|
| **Gemini API** | Roof/foundation/culvert estimates from imagery (cached, labeled); Local Intel structuring + PII scrub; coach; round briefings; planner briefs. JSON schemas + fallback. | 1 |
| **Tiger Data** | TimescaleDB hypertables `gauge_readings`, `weather_readings`, `guesses`, `plans`, `intel_votes`; continuous aggregates for live leaderboards, accuracy curves, planner heatmaps; PostGIS for spatial joins. | 1 |
| **GoDaddy Registry** | The game's domain; every lobby QR points to it. | 2 (minutes) |
| **ElevenLabs** | Emergency-broadcast briefing at storm start; reveal narration; audio-described rounds (accessibility). Cached per text hash. | 2 |
| **Applied AI Data Streaming** | Live mode: gauges/alerts stream every 15 min; a gauge at action stage auto-creates a "Live Round". Confirm eligibility with organizers first; if eligible, also stream into Databricks. | 3 |
| **Solana** | Optional: hash each Local Intel item and submitted plan to a public ledger so planner input is tamper-evident. Build last or skip. | 4 |

In the demo, show these as one flow, not a sponsor list: broadcast voice (ElevenLabs) opens
the storm, live gauge strip (Tiger Data stream), coach card (Gemini), QR URL (GoDaddy).

## 11. Responsible use
Synthetic residents labeled; census data shown only as aggregates; buildings show characteristics,
never owners; addresses processed only in the browser; Local Intel moderated (no names, faces,
plates); all AI use disclosed in-app; "educational, not official emergency guidance" with links
to ReadyNC and the NWS.

## 12. Demo script (2.5 min)
1. (15 s) Landing orbit, live gauge strip. Judge scans QR on TV.
2. (45 s) Round: Pin It — "Where did Florence's water peak?" Everyone pins; reveal flies to the
   real USGS mark, water rises, scores count, coach card + Field Guide stamp.
3. (50 s) Build round: drag shelter + bus pickup + elevate homes; tap a building → materials
   and damage; Run storm with broadcast voice; split screen vs optimal.
4. (25 s) Perception gap across all real players this weekend + Planner View agreement grid.
5. (15 s) Methods card: "Our flood model is within X ft of USGS high-water marks." Export to QGIS.
