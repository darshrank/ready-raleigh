# Ready Raleigh: design direction

Read this before any UI work. The goal is a game nobody mistakes for a GIS dashboard or a template.

## Concept: a printed game board, then the night of the storm

Emergency flyers, evacuation maps, and board games share one thing: they are printed in a few
flat ink colors. Ready Raleigh plays on a civic map printed in spot inks, laid out on a table as a
game board. The game has **two moods**, and the switch between them is the show:

- **Day (calm):** title, planning, results. Daylight board, printed inks, chunky pieces.
- **Night (the storm):** the board goes dark storm blue, rain falls, the water glows, a news
  helicopter camera flies to what goes under. This is the hero moment. Spend the boldness here.

The map comes first in both moods. It must read as a real Raleigh street map a resident
recognizes: street and place names stay readable over everything, including the water.

Hazards: **flood is drawn as realistic water** (native map layers that follow the creek valleys).
**Heat keeps the halftone** (dots whose radius is temperature), the print-shop signature.

Phases (solo): title and briefing, the camera flies down, planning, the storm, results.
Rooms add the reveal: two printed maps side by side, the room's plan and the data's plan.

## Color tokens

All tokens live once as `:root` custom properties in `app/src/styles.css`; MapLibre and deck.gl read
them through `tokens()` (`app/src/tokens.ts`). Never hard-code a hex anywhere else.

Day inks:

| Token | Hex | Use |
|---|---|---|
| `--chalk` | `#DCE4E1` | land, page background (cool grey-green, not cream) |
| `--bond` | `#F7F9F8` | HUD plates, cards, tray, piece faces |
| `--ink` | `#1E2A47` | text, outlines, roads, the broadcast band, hard shadows |
| `--flood` | `#0078BF` | water (100-year band), flood UI |
| `--flood-deep` | `#00508A` | deepest water (floodway, step 1), the waterline edge |
| `--alarm` | `#FF48B0` | heat halftone, stranded people, road closed stripes, timer's last 30 s |
| `--signal` | `#FFC628` | budget, timer, broadcast text, selected piece, focus |
| `--safe` | `#00A95C` | protected people, coverage, evacuating residents |

Night storm palette (the basemap only; the inks above stay the same):

| Token | Hex | Use |
|---|---|---|
| `--storm-land` | `#172440` | land and label halos: deep storm blue, not black |
| `--storm-street` | `#2D416B` | streets as faint lines, rail, building footprints |
| `--storm-building` | `#22355A` | 3D buildings at night |
| `--storm-label` | `#A6B6D0` | street and place names, dimmed but readable (7.3:1 on land) |
| `--storm-water` | `#2A9DEB` | water at night, brighter so it glows against the dark city |
| `--storm-glow` | `#7CCBFF` | the soft glow around the waterline, submerged-road dashes |

Rules:
- Flat fills only. No gradients, no soft grey drop shadows, no glass.
- Depth is a hard offset shadow in `--ink` (3 px on map pieces, 5 px on tray pieces and HUD
  plates). Nothing else casts a shadow.
- Text contrast meets WCAG AA in both moods.
- The night palette is the map, not a UI theme. HUD plates stay `--bond` and `--ink` at night,
  like printed stickers on a dark board. No neon, no glow on UI chrome; only water glows.

## The world: realistic city and storm water (realism)

The board stays printed; the **world under it is realistic**: a lit 3D city and living storm water,
drawn by deck.gl layers in `app/src/world/` (interleaved below road barriers and every label).
The printed inks are the instruments (HUD, pieces, labels, coverage); the world tokens below are
the city and the water. The "flat fills only" rule is for the instruments, not the world.

| Token | Hex | Use |
|---|---|---|
| `--water-day` / `--water-day-deep` | `#6F6A4C` / `#4F4B36` | murky storm water by day (500-year band / floodway) |
| `--water-night` / `--water-night-deep` | `#3A4A42` / `#26302C` | the same at night |
| `--foam` | `#E9E4D2` | foam behind the advancing water, sun highlight, lightning on the water |
| `--sky-day` / `--sky-night` | `#C9D8E6` / `#2D416B` | what the water reflects at a glancing angle |
| `--wall-day` / `--wall-night` | `#D9D4C9` / `#2A3550` | 3D building walls (roofs a touch darker) |
| `--glass-day` / `--glass-night` | `#5D6F80` / `#1A2236` | window panes |
| `--window-lit` | `#FFD28A` | lit windows at night, the sun's warm key light |
| `--shadow` | `#1B2333` (about 25%) | ground shadows |
| `--wet-stain-day` / `--wet-stain-night` | `#8A7F63` / `#232A30` | walls that stood in the water |

- **City:** every OpenFreeMap building in 3D when the camera tilts (sites + 2 km), lit by a warm
  low sun by day and a dim cool moon at night. Shelter sites stand out in the site tint only while a
  shelter is being placed.
- **Water:** creeps out of the creeks, a foam band behind the edge, scrolling noise, sky fresnel, a
  sun highlight by day, lightning by night; floodway deepest. Tilted, it rises (6 / 3 / 1.5 m by
  step) and drains when the storm ends, keeping its final extent. Planning keeps the faint `--flood`
  preview. Flood cities only; an earthquake or a heat wave keeps its printed ground colors.
- **Stains:** walls that stood in the water stay dark below the highest water line, with a ragged
  wicking edge and a tide line, after the water drains.
- **City lights:** at night the city is thousands of glowing points: building lights by residents
  (a whiter tint of `--window-lit`, mostly dim, a few bright) and street lights every 60 m along
  the main roads (`--window-lit`), 1.5-3 px, added over the map with a faint flicker. Only in the
  storm's night; gone by day and in planning; they fade out by z15.5, where the windows take over.
- **Windows:** a pane grid on every wall; at night a third glow `--window-lit`. When the water
  reaches a building its lights flicker and go out a few seconds later.
- **Only uniforms change per frame**: the shaders read the storm clock, the day/night mix and the
  lightning; no attribute is rebuilt while the storm runs.
- **Quality tiers** (`world/quality.ts`, `?quality=low|medium|high` to force): high on laptops;
  medium on phones (two noise octaves, windows fade sooner); low on small or old devices (one
  octave, no foam, window grid as its average tone, a shorter city, pixel ratio at most 1.25).
- **Reduced motion:** the water appears per step with no creep, waves, foam or rise; stains appear
  at their height; lights go out without the flicker; no lightning on the water; the street dashes
  stop.
- `?realism=off` keeps the MapLibre buildings and water described in "Water (flood)" (removed
  once realism passes its final check).

## Type

| Role | Family | Notes |
|---|---|---|
| Display, numbers, counters | Big Shoulders Display (700, 800) | condensed civic signage face; counters huge |
| Body, UI, labels | Public Sans (400, 600) | the US government's public-service typeface |

Load both from Google Fonts with fallbacks: `"Big Shoulders Display", "Arial Narrow", sans-serif`
and `"Public Sans", system-ui, sans-serif`. Use tabular figures for all changing numbers.

Type scale (px): 13, 15, 18, 24, 32, 48, 72, 120. Storm counters and the title use 120.
Sentence case everywhere. The broadcast band and its LIVE caption are the only uppercase, because
real emergency alerts use it.

## Water (flood)

Water is drawn as native MapLibre layers from `flood_steps.geojson`, inserted **above roads and
buildings and below every label**, so street and place names read over the water.
Under realism the deck.gl water ("The world" above) replaces these layers in the same slot; this
section describes the `?realism=off` path, and the same rules (steps, growth, preview, results).

- The three steps are disjoint bands (1 floodway, 2 the 100-year band, 3 the 500-year band).
  Each is a semi-transparent blue fill: step 1 `--flood-deep` (it arrives first, deepest), step 2
  `--flood`, step 3 a lighter tint of `--flood`. No hard polygon outlines.
- Waterline: a darker (`--flood-deep`) line on the polygon edge with `line-blur`, so the edge
  reads as a soft waterline, not a stroke.
- Shimmer: a slow alpha drift on the water color (a few percent over about 3 s, each step out of
  phase). It animates only a constant color, never a data-driven expression.
- Growth: a step never pops in. Each part of a step grows in over about 1.5 s, delayed by its
  distance from the water already there, so the water spreads out of the creek valleys.
- 3D (tilted camera): water also draws as a translucent `fill-extrusion`, step 1 about 6 m,
  step 2 about 3 m, step 3 about 1.5 m, so it sits around the base of the 3D buildings
  (`render_height` from the tiles). The extrusion rises from 0 as the step grows.
- Planning preview: the same water, faint (about half strength), all three steps, no growth.
- Night: water uses `--storm-water` at higher strength, with a wide blurred `--storm-glow` line on
  the waterline so it glows against the dark city.
- Results: daylight returns, the water stays at its final level at full strength.

Flooded roads (storm and results):
- The real street geometry from the vector tiles, clipped to the water: a blue overlay on the
  street plus a slow flowing dash along the street's direction (`--bond` by day, `--storm-glow` by
  night).
- A small road-closed barrier (bond board, `--alarm` stripes, ink edge) where each street enters
  the water, turned across the street. Barriers give way to labels when they collide.
- No whole-road red line. Roads the plan protects stay `--safe` with an ink casing.

## The halftone (heat only)

Heat is a dot grid. Dot radius maps to temperature; trees and cooling centers shrink nearby dots.
Dots are small (at most a third of the grid spacing) and about 75% opaque so streets read through.
Coverage in planning is also a halftone: `--safe` dots that grow with the protected share of a block.

## Map

- Camera: top-down (pitch 0) while planning. A Tilt toggle tilts to 45 degrees and turns on 3D
  buildings and 3D water. The title orbits at 60 degrees; the storm tilts to 55 degrees.
- Camera framing: on load, fit the loaded data's extent (no fixed center). Phones (under 640 px)
  open at street level instead (zoom 13 or more) on the area with the most at-risk people.
- Basemap (MapLibre, OpenFreeMap vector tiles, our own style, no sprite so no POI icons). Day:
  - land `--chalk`; rivers and lakes `--flood` at 35%; creeks as `--flood` lines.
  - parks and woods: flat `--safe` tint at low opacity.
  - building footprints: flat `--ink` tint at about 8%, from zoom 13; 3D buildings when tilted.
  - streets: `--bond` fill with a thin `--ink` casing; major roads wider; motorways wider still.
  - rail: thin dashed `--ink`.
  - labels in `--ink` with a chalk halo: neighborhood names, major street names from zoom 12,
    minor street names from zoom 15, water names in italic.
- Night: land `--storm-land`, streets as faint `--storm-street` lines with no casing, buildings
  `--storm-street` / `--storm-building`, labels `--storm-label` with a `--storm-land` halo.
- Detail by zoom (semantic zoom, `app/src/map/detail.ts`). The city view (z12 and below) shows
  nothing new; each layer appears at its zoom, like a street atlas. Every layer has day and night
  colors in the basemap palette (`basemap.ts`), so the storm re-paints it.

  | Zoom | Layer | Day | Night |
  |---|---|---|---|
  | 14+ | Places from the tiles' `poi`: schools, hospitals and clinics, worship, community centers, libraries, grocery, fire, police. 16 px ink badge with a knocked-out pictogram; names from 15 | `--ink` 85% | `--storm-label` |
| 16+ | House numbers (`housenumber`), 9.5-11 px, the lowest label priority | `--ink` 55% | `--storm-label` 60% |
| 16+ | Building names: named non-commercial `poi` (courthouses, public and government buildings, campus offices, dormitories, museums); the tiles' buildings carry no names | `--ink` 85% | `--storm-label` |
| 14+ | Nursing homes and assisted living (`care_homes.json`, OSM; the tiles drop them): the place badge with a house and heart; names from 15 | `--ink` 85% | `--storm-label` |
| 14+ | GoRaleigh bus stops (`bus_stops.json`, GTFS): rounded-square badge with a bus front; stop names from 16 | `--ink` 85% | `--storm-label` |
| 15+ | Shelter sites as their OSM building (`site_buildings.json`): ink outline and an ink 30% fill (hollow if the site floods); the site's square hides. Hover or tap: `--signal` fill and a card (name, type, "Shelter for up to 10,000 people", flood note). Sites with no building keep the square. Tilted (3D on): the site's building is extruded in an ink tint (pale if it floods) to the height of the tile building, so it stands out among the white 3D buildings | `--ink`, `--signal` on hover | `--storm-label` 55% outline, 14% fill |
| 16-17 | Aerial photo (NC OneMap orthoimagery), fades in from 16 to 17, above the land and green fills, below buildings, streets, water and labels, so the printed street map stays on top | 85%, saturation -0.35, blacks lifted | 80%, brightness max 0.38, saturation -0.6 |
| 14.5-16 | The hex fills step back: "Who lives here" and the selected-neighborhood tint fade from 100% to 35%, so streets and buildings read first. Coverage dots never fade; from 15 covered dots get a 1 px `--ink` rim | same | same |

- Population ("Who lives here", off by default): flat H3 fill in `--ink`, at most 30% opacity,
  4 stepped tints, no outlines, no extrusion. Everyone, 65 and over, No car.
- An invisible pickable cell layer is always on, so a tap anywhere opens the neighborhood card.
  The selected neighborhood gets a `--signal` tint and a 2.5 px `--ink` outline.
- Shelter sites: small `--ink` squares (hollow if the site floods). Hidden during the storm.
- Moving residents (storm): `--safe` dots with a soft `--safe` glow and short trails. Stranded
  residents stop and become hollow `--alarm` rings. Residents waiting for the water are small
  pale dots. Each shelter and bus pickup grows a flat `--safe` halo (ink edge) as people arrive.

## Game pieces

Each intervention is a round disc, like a board game token: `--bond` face, `--ink` rim, hard
`--ink` offset shadow, a simple pictogram, and its cost.
- In the tray the discs are big and chunky (76 px desktop, 60 px phone) with a 5 px shadow. Armed:
  the face turns `--signal` and the disc lifts (shadow grows). Unaffordable: 40% with the cost in
  `--alarm`.
- Landing (the juice): the piece stamps down (1.3x to 1x, 200 ms), a `--safe` coverage ring pulses
  out from it once, a short stamp sound plays, phones vibrate 15 ms, and a "+N residents" chip
  pops above it and floats away. While aiming, the "+N residents" chip rides above the cursor.

## Layouts

Every phase is the full-bleed map with floating plates. There is no side rail.

Title and briefing (full screen, day):
```
+--------------------------------------------------------------+
|   (Raleigh in 3D, slowly orbiting)                           |
|   Ready                                                      |
|   Raleigh            <- 120 px display, ink on a bond plate  |
|                                                              |
|   +------------------------------------+                     |
|   | Hurricane approaching.             |  <- briefing card,  |
|   | 72 hours of rain.                  |     48-72 px type   |
|   | You have $10M and 3 minutes.       |                     |
|   | [ Start planning ]                 |                     |
|   +------------------------------------+                     |
+--------------------------------------------------------------+
```
"Start planning" flies the camera down to the city (top-down) and starts the clock.

Planning (day, game HUD):
```
+--------------------------------------------------------------+
| Ready Raleigh    [ $6M ▮▮▮ | 2:41 | 41,200 covered ]  [Tilt][Layers][Sound]
|                                                   [neighborhood card]
|                    full-bleed map, faint water                |
|                                                              |
|            [ status line: what to do next / Remove ]          |
|  [ (O)      (O)      (O)    | placed: o o o | Start the storm ]  <- floating tray
|  [ Shelter  Bus      Road   |               |                 ]
|  [ $3M      $1M      $2M    |               |                 ]
+--------------------------------------------------------------+
```
Budget and timer float top-center, large. The timer turns `--alarm` and pulses in the last 30 s.

Storm (night):
```
+--------------------------------------------------------------+
| EMERGENCY ALERT  ·  CRABTREE CREEK RISING  ·  WADE AVE CLOSED| <- --ink band, --signal text, scrolls
| LIVE  WADE AVE GOES UNDER                                    | <- caption while the camera is there
|          rain, lightning, tilted city, glowing water         |
|                                                              |
| 41,200 protected                          8,930 stranded     | <- 120 px counters, ticking
+--------------------------------------------------------------+
```
Results (day again): the whole city, water at its final level, the results card slides up from
the bottom.

Player screen (phone, 390 px): the same plates, compact. Top: one plate with budget, timer and
covered. Bottom: the tray (three discs) with "Start the storm" under it, the status line above.

## Motion: one moment per phase
- Title: Raleigh orbits slowly in 3D; the briefing card slides in; the camera flies down.
- Planning: the stamp, ring and chip when a piece lands; the water shimmers faintly.
- Storm: a fast wipe across the screen into the night palette, the camera tilts to 55 degrees,
  each step's water grows in, then the news helicopter flies to that step's event (a named road
  going under, a neighborhood cut off) for 2 seconds with a LIVE caption, and pulls back. Rain and
  occasional lightning throughout. Counters tick.
- End: the storm clears to daylight over about 1.5 s, the camera pulls back to the whole city, the
  results card slides up.
Respect `prefers-reduced-motion`: no orbit, flights, wipe, rain, lightning, shimmer or flowing
dashes; water and counters change instantly; the band is static text. The game stays complete.

## Sound
Synthesized in the browser (Web Audio, no files) until the ElevenLabs voice lands: piece stamp,
an alert chime when the storm starts, rain, and thunder after lightning. On by default on
desktop, off by default on phones. Always show a mute toggle (top right).

## Words
Plain, active, sentence case. Name things the way residents would.
- Buttons: "Start planning", "Place shelter", "Start the storm", "Skip to results", "Play again".
- Counters: "protected", "stranded", "left in budget", "covered".
- Empty state: "Place your first shelter. Tap a marked building on the map." (a square, or up close the outlined building)
- Errors say what happened and what to do: "Voice is off. The game still works."
- Debrief voice: direct and specific. "You left 1,800 households with no car north of Crabtree
  Creek without a bus pickup."

## Accessibility floor
- Never rely on color alone: flooded roads carry a flowing dash and a barrier marker; stranded
  residents are hollow rings; heat is dots.
- Keyboard play: 1 2 3 pick a piece, arrow keys move a cell cursor, Enter places, Delete removes.
  Every HUD control is a real button, reachable by Tab.
- Visible focus ring: 3 px `--signal` with `--ink` outer ring.
- Lightning: at most two flashes per strike, strikes at least 3 s apart, never full white.
- Works at 390 px wide and on a projector.

## Performance floor
The storm must hold 60 fps on a laptop with every effect on. Rain is one canvas path per frame at
device pixel ratio 1; lightning is one DOM layer; water animation only touches constant colors,
feature-state and visibility. If it stutters, drop rain particles first, then the shimmer. The
realistic world changes only shader uniforms per frame; on slower devices its quality tier drops
noise octaves, foam, window detail and pixel ratio before anything else.

## What we chose not to do (keep it that way)
- No cream background with a serif headline and clay accent.
- No near-black page with one neon accent, no "cyber command center" look. The night map is deep
  storm blue with the same printed inks on top.
- No side rail of panels, no grid of identical rounded cards with soft shadows, no gradient washes.
- No uppercase eyebrow labels over headings, no monospace for small labels, no arrows on buttons.
- No glassmorphism over the map.
