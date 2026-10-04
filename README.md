# Mayday Mayor

**A multiplayer disaster-planning game on real city data that turns every game into public input for city planners.**

Built at WolfHacks 2026 for the Center for Geospatial Analytics track.

Cities have plenty of disaster data. What they lack is participation: the local knowledge of the people who live there, such as which underpass floods first, which road everyone actually uses to get out, and which block has elderly neighbors without a car. Surveys and town halls rarely capture it. Mayday Mayor does it with a game people want to play.

## How it works

1. **Pick a city.** Raleigh, Miami, New York or San Francisco, on a 3D globe.
2. **Run for mayor.** Plan solo, or host a room: friends scan a QR code, pick a candidate and plan at the same time (up to 12 players).
3. **Plan on real data.** $10M and three minutes to place shelters in real public buildings, evacuation bus pickups at real transit stops, and protection on the roads that fail first.
4. **Survive the disaster.** Floodwater spreads through FEMA flood zones in three stages, roads close, neighborhoods lose their routes to hospitals, and simulated residents reach safety or get stranded. A live AI news broadcast covers it in English and Hindi.
5. **See the results.** Your score against the best plan our optimizer found, a citywide leaderboard, and a spoken AI debrief.
6. **Leave a public record.** Your decisions are written to Solana in plain text. Plays that reveal something real earn a soulbound civic card.

Every finished game is a complete, comparable disaster plan. Together they feed the **planner view** (`/planner`):

- **Top places to act:** the highest-impact locations, ranked and pinned on the map.
- **Consensus:** where residents and the data agree.
- **Blind spots:** high-priority places residents keep missing.
- **Local knowledge:** places residents keep choosing that the model does not rank.
- **Evacuation demand:** where players keep asking for bus pickups, exportable as CSV and GeoJSON.

## Sponsor technologies

| Technology | What it does here |
|---|---|
| **Tiger Data (TimescaleDB)** | Plays, placements and live readings from 27 USGS river gauges and NWS weather in hypertables. Continuous aggregates power the leaderboard, crowd analytics and the planner view in real time. Columnstore compression took a week of gauge data from 11.8 MB to 147 KB (98.8%). Demo queries: [`docs/TIGER_DEMO.sql`](docs/TIGER_DEMO.sql). |
| **Gemini** | Writes the live news broadcast, the debrief, and each civic card's text and art (image generation), from facts the engine computes. The server rejects any line with a number not in those facts. |
| **ElevenLabs** | Voices the English and Hindi news anchors and the narrator. Clips are cached, so replays cost nothing. |
| **Solana (devnet)** | Each play's decisions in a Memo transaction, batches anchored as Merkle roots, civic signals published when they change, and soulbound Metaplex Core cards. `/verify/:playId` checks a play against the chain in the browser. Details: [`docs/SOLANA.md`](docs/SOLANA.md). |

## Architecture

```
pipeline/   Python. Builds the city data once: GeoPandas, Shapely, OSMnx, H3.
shared/     TypeScript engine shared by browser and server: coverage, scoring,
            hazard timeline, optimizer, civic-record proofs.
app/        React, MapLibre GL, deck.gl, Tailwind. The game, results and planner view.
server/     Fastify and WebSockets: rooms, Gemini, ElevenLabs, Tiger Data, Solana,
            live USGS and NWS feeds.
docs/       Plan, design, decisions, progress.
```

The core game runs in the browser from static files. Every server feature fails soft: if the database, an AI service or Solana is down, the game still works.

### The model

- The city is split into H3 resolution-9 cells, each with Census population, residents over 65, low-income residents and households without a car.
- A cell is at risk if it floods, or if it loses every driving route to a hospital as roads close.
- Shelters cover cells within a 15-minute drive that stays open; bus pickups cover a short walk.
- People are weighted toward those least able to evacuate: `pop + pop65 + lowIncome + 2.5 × noCarHouseholds`.
- The server re-scores every play, so scores and the public record cannot be faked.

### Data sources

US Census (TIGER/Line boundaries, ACS 2024 block groups), FEMA National Flood Hazard Layer, FEMA shelter records, OpenStreetMap (roads and facilities), transit GTFS feeds (GoRaleigh), USGS Water Services and the National Weather Service.

New York (heat) and San Francisco (earthquake) currently play on the flood rules; dedicated models are next.

## Run it locally

Requires Node 20+ (Python 3.11 only to rebuild the data).

```bash
npm install
cp .env.example .env   # fill in what you have; everything is optional
npm run dev            # app on :5173, server on :8787
```

Useful commands:

```bash
npm test               # all tests (vitest)
npm run typecheck
npm run optimize       # recompute the best plan per city
python -m pipeline.build_all   # rebuild the geodata (slow; cached steps skip)
```

### Environment

All keys are optional; without one, that feature falls back (templates, captions, in-memory storage, no chain).

| Variable | For |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_IMAGE_MODEL` | News, debrief, card words and art |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_*` | Anchor and narrator voices |
| `DATABASE_URL` | Tiger Data (`postgres://…?sslmode=require`); memory otherwise |
| `SOLANA_RPC_URL`, `SOLANA_PAYER_SECRET_KEY` | Devnet record (64-byte secret key as a JSON array) |
| `SOLANA_CARD_COLLECTION` | Card collection address, created once with `npm run sol:collection -w server` |
| `PUBLIC_URL` | Public base URL for room QR codes and card metadata |

See [`.env.example`](.env.example) for the rest and [`docs/DEPLOY.md`](docs/DEPLOY.md) for deployment.

## Routes

| Path | Page |
|---|---|
| `/` | Globe and city picker |
| `/solo` | Single player |
| `/play/:code` | A multiplayer room |
| `/planner` | Where to act: the planner view |
| `/card/:id` | A civic card and claiming it |
| `/verify/:playId` | Verify a play against Solana |

## Team

Built in 24 hours at WolfHacks 2026 by Aum Pandya, Adit Shah, Darsh Rank and Sakhi Patel.
