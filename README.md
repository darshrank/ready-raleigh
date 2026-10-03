# Ready Raleigh

A multiplayer GeoGuessr × SimCity game on real flood and heat data (Center for Geospatial
Analytics track). See `docs/PLAN.md`, `docs/DATA.md`, `docs/BUILD.md`; progress in `docs/PROGRESS.md`.

## Requirements
- Node ≥ 22 (tested on 24), npm ≥ 10
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for the pipeline)
- Optional: Docker (local TimescaleDB), tippecanoe (building tiles, M1+)

## Setup
```sh
cp .env.example .env        # fill keys; everything works without them (mock AI)
npm install
uv sync                     # Python pipeline env
npx playwright install chromium   # for screenshots / smoke tests
```

## Run
```sh
npm run dev                 # server :3000 + client :5173 (open http://localhost:5173)
HTTPS=1 npm run dev         # self-signed HTTPS on the server (phones need it for mic/camera)
npm run build && npm start -w server   # production: server serves client/dist on :3000
```
Phones on the same Wi-Fi: open the "Network" URL Vite prints. Set `PUBLIC_URL` to use our
domain or a tunnel in QR codes.

## Pipeline
```sh
uv run python -m pipeline areas
uv run python -m pipeline build crabtree   # all stages: fetch,buildings,people,flood,damage,roads,validate,rounds
uv run python -m pipeline build crabtree --stage rounds   # any subset; --refresh re-derives from the HTTP cache
```

## Checks
```sh
npm run typecheck           # tsc for shared, server, client
npm test                    # server tests (node:test)
uv run pytest               # pipeline tests
uv run ruff check pipeline
npm run screenshots         # with `npm run dev` running: M0 map checks + screenshots/
npm run screenshots:flood   # M2 /debug/flood checks
npm run smoke               # M3 Playwright: plays a full 5-round solo game at phone + TV sizes
```

## Credits
Server networking/TLS ported from [pocket-rivals](https://github.com/darshrank/pocket-rivals)
(MIT) — see `docs/PROGRESS.md` "Reused code". Map data © OpenStreetMap contributors,
OpenFreeMap / OpenMapTiles; terrain: Mapzen/AWS Terrain Tiles.
