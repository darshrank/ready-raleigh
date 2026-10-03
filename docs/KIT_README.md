# Ready Raleigh — build kit

A multiplayer GeoGuessr × SimCity game on real flood and heat data, for the Center for
Geospatial Analytics track.

## What's here
| File | Purpose |
|---|---|
| `CLAUDE.md` | Rules Claude must follow (put at repo root; Claude Code reads it automatically) |
| `docs/PLAN.md` | Product, game design, UX spec, design system, validation, sponsor integrations, demo script |
| `docs/DATA.md` | Every data source and endpoint, models, location pack schema, database schema |
| `docs/BUILD.md` | Milestones M0–M11 with copy-paste prompts and acceptance checks |

## How to use
1. Create an empty repo and copy these files into it (CLAUDE.md at the root, docs/ folder).
2. Fill `.env` keys when Claude creates `.env.example`: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`,
   `DATABASE_URL` (Tiger Data), `MAPILLARY_TOKEN`.
3. Open the repo in Claude Code and paste the **M0** prompt from `docs/BUILD.md`.
4. Check every acceptance item before pasting the next milestone.
5. Split the team by milestone streams once M3 works: pipeline (M2, M10), game/UI (M3–M5, M9),
   AI + data platform (M6–M8).

## Sponsor credits (MLH DevRelay)
Run this yourself on your laptop, not inside Claude: it installs a binary in `~/.devrelay`,
edits your shell profile, registers itself with Claude Code and other AI tools, and schedules a
daily update check. Add `--no-telemetry` if you don't want usage data sent. Then sign in with
`devrelay login`.
```
curl -fsSL https://devrelay.com/install.sh | sh
```
