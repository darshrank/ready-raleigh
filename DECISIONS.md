# Decisions

One line each. Newest at the bottom. Do not reopen a decision without writing why.

- Core game runs in the browser from static files; server features are optional layers.
- Analysis unit is H3 resolution 9; cells referenced by integer index.
- Shelters snap to real OSM candidate sites; coverage precomputed per site (dry and flooded).
- Flood model uses FEMA flood zones as 3 steps; simplified on purpose, disclosed in the pitch.
- Runtime is TypeScript (app, server, shared); Python only for the offline data pipeline.
- Scoring and optimizer live in shared/ so the browser and the optimizer use the same math.
- Solana uses @solana/web3.js v1 on devnet only; play money, never real money.
