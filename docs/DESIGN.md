# Ready Raleigh: design direction

Read this before any UI work. The goal is a UI nobody mistakes for a template.

## Concept: the city as a printed game board

Emergency flyers, evacuation maps, and board games share one thing: they are printed in a few
flat ink colors. Ready Raleigh looks like a civic map printed in spot inks, laid out on a table
as a game board. Hazards are drawn as **halftone dots**, the way a print shop shows shading.

That halftone is the one bold idea. Everything else stays quiet and disciplined.

The map comes first. It must read as a real Raleigh street map a resident recognizes; our data
sits on top of it as a light layer, never a wall of shapes that hides the streets.

- Planning phase: the calm board. Tactile pieces on a printed map.
- Simulation phase: an emergency broadcast takes over the top of the screen.
- Reveal phase: two printed maps side by side, the room's plan and the data's plan.

## Color tokens

| Token | Hex | Use |
|---|---|---|
| `--chalk` | `#DCE4E1` | land, page background (cool grey-green, not cream) |
| `--bond` | `#F7F9F8` | panels, cards, tray |
| `--ink` | `#1E2A47` | text, outlines, roads, the broadcast band |
| `--flood` | `#0078BF` | flood halftone, water |
| `--alarm` | `#FF48B0` | heat halftone, stranded people, perception gap |
| `--signal` | `#FFC628` | budget, timer, broadcast text, selected piece |
| `--safe` | `#00A95C` | protected people, coverage rings |

Rules: flat fills only. No gradients. No soft grey drop shadows. Depth comes from a hard 3 px
offset shadow in `--ink` on game pieces only. Text contrast meets WCAG AA.

## Type

| Role | Family | Notes |
|---|---|---|
| Display, numbers, counters | Big Shoulders Display (700, 800) | condensed civic signage face; counters huge |
| Body, UI, labels | Public Sans (400, 600) | the US government's public-service typeface |

Load both from Google Fonts with fallbacks: `"Big Shoulders Display", "Arial Narrow", sans-serif`
and `"Public Sans", system-ui, sans-serif`. Use tabular figures for all changing numbers.

Type scale (px): 13, 15, 18, 24, 32, 48, 72, 120. Counters during the simulation use 120.
Sentence case everywhere. The broadcast band is the only place with uppercase, because real
emergency alerts use it.

## The halftone (signature)

Hazards are not filled polygons. They are dot grids.
- pipeline/ exports a regular dot grid (about every 120 m) inside flood polygons, each dot tagged
  with its flood step, and one grid over the study area tagged with heat.
- deck.gl `ScatterplotLayer` draws the dots. Radius encodes intensity. Dots are small (at most
  about a third of the grid spacing) and about 75% opaque, so streets and labels read through.
- Flood simulation: as the step rises, dots in the new step grow from 0 to full radius over
  600 ms. The water "prints" itself onto the city.
- Heat: dot radius maps to temperature. Trees and cooling centers shrink nearby dots.
- Coverage rings when placing a piece: a ring of `--safe` dots, not a filled circle.

## Map

A city map first, our data second.

- Camera: top-down (pitch 0) by default in every phase. A small "Tilt" toggle on the map tilts
  to 45 degrees for a 3D look; it is off by default and never required to play.
- Camera framing: on load, fit the loaded data's extent at any screen size (no fixed center).
- Basemap (MapLibre, OpenFreeMap vector tiles, our own style, no sprite so no POI icons):
  - land `--chalk`; water `--flood` at 35%; creeks and rivers as `--flood` lines, clearly visible.
  - parks and woods: flat `--safe` tint at low opacity (light green, like any city map).
  - building footprints: flat `--ink` tint at about 8%, from zoom 13.
  - streets: `--bond` fill with a thin `--ink` casing; major roads wider; motorways solid `--ink`.
  - rail: thin dashed `--ink`.
  - labels in `--ink` with a chalk halo: neighborhood names, major street names from zoom 13,
    minor street names from zoom 15, water names in italic.
- Population ("Who lives here" toggle, off by default): flat H3 fill in `--ink`, at most 30%
  opacity, 4 stepped tints, no hexagon outlines, no extrusion. A switch picks what it shows:
  Everyone, 65 and over, No car.
- An invisible pickable cell layer is always on, so a tap anywhere opens the neighborhood card.
  The selected neighborhood gets a `--signal` tint and a 2.5 px `--ink` outline.
- Shelter sites: small `--ink` squares (hollow if the site floods), always drawn on top.
- Closed roads: `--alarm`, 4 px, dashed while closing then solid.
- Moving residents: deck.gl `TripsLayer`, `--safe` trails. Stranded dots stop and turn `--alarm`.

## Game pieces

Each intervention is a round disc, like a board game token: `--bond` face, 2.5 px `--ink`
outline, hard 3 px `--ink` offset shadow, a simple pictogram, and its cost under it.
- Placing a piece: it "stamps" down (scale 1.15 to 1, 160 ms) and its coverage ring prints out.
- Pieces the player can't afford are shown at 40% with the cost in `--alarm`.
- Budget: a vertical stack of `--signal` chips that shrinks as money is spent.

## Layouts

Host screen (projector, 16:9):
```
+--------------------------------------------------------------+
| [room code BIG]                      [timer 2:41]   [budget] |
|                                                              |
|                   full-bleed map of Raleigh                  |
|                                                              |
| players: ● Aum ● Darsh ● Sakhi ● ...          [live counters]|
+--------------------------------------------------------------+
```
Simulation adds the broadcast band across the top:
```
+--------------------------------------------------------------+
| EMERGENCY ALERT  ·  CRABTREE CREEK RISING  ·  WADE AVE CLOSED| <- --ink band, --signal text, scrolls
|                                                              |
|                     map, halftone flooding                   |
|                                                              |
| 41,200 protected                          8,930 stranded     | <- 120 px counters
+--------------------------------------------------------------+
```
Reveal: two maps side by side, "Your room" and "The data". Gap cells pulse `--alarm` rings.

Player screen (phone, 390 px):
```
+------------------+
| $6M left   2:41  |
|                  |
|   map (touch)    |
|                  |
|------------------|
| (O) (O) (O)      | <- tray of pieces, bottom sheet
| Shelter $3M ...  |
+------------------+
```
Desktop solo: map left 70%, a narrow right rail for tray, budget, and the neighborhood card.
Content is left aligned. The map is always the largest thing on screen.

## Motion: one moment per phase
- Planning: the stamp when a piece lands.
- Simulation: the halftone flood printing step by step, with the broadcast band sliding in once.
- Reveal: the crowd heatmap develops left to right like a print being pulled, then the gap cells
  pulse three times.
Nothing else animates on its own. Respect `prefers-reduced-motion` (swap to instant changes).

## Sound (optional, host screen on, phones off by default)
Pre-generated with ElevenLabs and cached in `app/public/audio/`: piece stamp, alert tone, the
broadcast briefing, the results narration. Always show a mute toggle.

## Words
Plain, active, sentence case. Name things the way residents would.
- Buttons: "Place shelter", "Start the storm", "See how the room did".
- Counters: "protected", "stranded", "left in budget".
- Empty state: "Place your first shelter. Tap a building on the map."
- Errors say what happened and what to do: "Voice is off. The game still works."
- Debrief voice: direct and specific. "You left 1,800 households with no car north of Crabtree
  Creek without a bus pickup."

## Accessibility floor
- Never rely on color alone: flood is dots, closed roads are dashed then solid, stranded dots are
  hollow rings.
- Keyboard play: arrow keys move a cell cursor, Enter places, Delete removes.
- Visible focus ring: 3 px `--signal` with `--ink` outer ring.
- Works at 390 px wide and on a projector.

## What we chose not to do (keep it that way)
- No cream background with a serif headline and clay accent.
- No near-black page with one neon accent, no "cyber command center" look.
- No grid of identical rounded cards with soft shadows, no gradient washes.
- No uppercase eyebrow labels over headings, no monospace for small labels, no arrows on buttons.
- No glassmorphism over the map.
