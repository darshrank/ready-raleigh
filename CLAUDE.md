# CLAUDE.md — Ready Raleigh

You are building **Ready Raleigh**: a multiplayer GeoGuessr × SimCity game on real
flood and heat data. Players read real 3D neighborhoods, guess risk, and plan defenses.
Their combined guesses and plans become a map of where the city should act.

Read these before writing code, in this order:
1. `docs/PLAN.md`   — product, game design, UX spec, design system
2. `docs/DATA.md`   — every data source, endpoint, field, and how it is processed
3. `docs/BUILD.md`  — milestones, the exact order to build, acceptance checks

## Non-negotiable rules

1. **Code computes every number; AI never does.** Scores, water depths, damage, temperatures,
   travel times and the optimal plan come from deterministic code over real data. Gemini only
   interprets (images, free text), explains, and summarizes. Validate all AI output against a
   JSON schema and clamp it. Every AI call has a non-AI fallback so the game never stalls.
2. **Real data only, with provenance.** Never invent a dataset value. Every value shown to a
   player carries a `source` object `{dataset, date, url, method}` that the UI can display.
   If data is missing, show "no data" and widen the scoring tolerance — never fill silently.
   AI estimates are stored separately with `estimated: true` and a confidence, and real data
   always wins over an estimate.
3. **Precompute, then play back.** All heavy geo work (flood stages, routing tables, damage
   tables, optimal plans, ground truth) runs offline in the Python pipeline and is saved as a
   *location pack*. The game server and client only load packs and run cheap lookups.
   A round must open in under 2 seconds.
4. **UI/UX is the product.** Follow the design system in `docs/PLAN.md` §8 exactly. No default
   browser styles, no unstyled states. Every screen has loading, empty and error states.
   Test at 390×844 (phone) and 1920×1080 (TV) for every screen you touch.
5. **Privacy.** Residents in simulations are synthetic and labeled "simulated". Never show
   owner names or parcel IDs. The "My Address" feature geocodes in the browser and never
   sends or stores the address on our server. Local Intel is scrubbed of names, faces and
   plates before it is stored.
6. **Keep it reliable on stage.** No live third-party API call may block a round. Live data
   (gauges, alerts) is polled in the background and cached; if it is stale, say so in the UI.
7. **Small, verified steps.** Finish one milestone in `docs/BUILD.md`, run its acceptance
   checks, show the result (screenshot or test output), then move on. Do not start the next
   milestone with failing checks.

## Stack (do not swap without asking)

- **Pipeline:** Python 3.11+, GeoPandas, Shapely 2, OSMnx, rasterio, WhiteboxTools,
  h3, pyproj, OR-Tools, requests. Lives in `pipeline/`.
- **Server:** Node 22 + Express + Socket.IO, TypeScript. Lives in `server/`.
- **Client:** TypeScript + Vite, MapLibre GL JS, deck.gl (via `@deck.gl/mapbox` MapboxOverlay,
  interleaved), no heavy UI framework required (Preact allowed for UI cards). Lives in `client/`.
- **Database:** Tiger Data (Timescale Cloud) Postgres with TimescaleDB + PostGIS. Local dev may
  use `docker run timescale/timescaledb-ha:pg16` (includes PostGIS).
- **AI:** Gemini REST API with `responseSchema` JSON output (same pattern as
  github.com/darshrank/pocket-rivals `server/ai.js`: model fallback chain, timeouts, mock).
- **Voice:** ElevenLabs text-to-speech, cached to files per text hash.

## Repo layout

```
pipeline/      Python: fetch → clean → model → pack (one CLI: `python -m pipeline build <area>`)
  areas/       area definitions (bbox, name, gauge ids, storm events)
  out/<area>/  generated location packs (gitignored except a small sample)
server/        game server: rooms, phases, scoring, AI, live data poller, planner API
client/        player + TV views: map, rounds, reveal, build, field guide, planner view
shared/        TypeScript types shared by server and client (pack schema, socket events)
docs/          PLAN.md, DATA.md, BUILD.md, METHODS.md (you write METHODS.md as you go)
```

## Conventions

- All coordinates WGS84 (EPSG:4326) at the boundary; do metric work in EPSG:32617 (UTM 17N).
- Elevations in feet in the UI, meters internally; convert only at display.
- Every pack file is versioned: `pack_version` and `built_at` at the top level.
- Socket events are typed in `shared/events.ts`; never emit an untyped event.
- Tests: `pytest` for pipeline math (damage curves, scoring, inundation); `node:test` or vitest
  for server phases and scoring; Playwright smoke test that plays one full solo game.
- Secrets in `.env` only (`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `DATABASE_URL`,
  `MAPILLARY_TOKEN`). Ship `.env.example`. Never commit keys.
- Write `docs/METHODS.md` as you implement each model: inputs, formula, assumptions,
  limitations, validation result. Judges will read it.

## When unsure

- If a data source fails or its schema differs from `docs/DATA.md`, stop and report what you
  found (URL, status, sample fields) rather than guessing.
- If a design choice is not covered, prefer the simpler option that keeps the map full-screen
  and the round under one decision.
