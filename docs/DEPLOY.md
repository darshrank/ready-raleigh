# Deploy (P14): Railway + a GoDaddy Registry domain

One service runs everything: the server serves the built app (`server/src/web.ts`), `/api` and the
room WebSocket `/ws`, so the game, rooms and wallet card art share one origin. The `Dockerfile`
builds the app and starts the server; `railway.json` tells Railway to use it and to check
`/api/health`.

## 1. Railway service (once)
1. Sign in at railway.com with GitHub. New Project > Deploy from GitHub repo > `darshrank/ready-raleigh`.
   Railway finds `railway.json` and builds the Dockerfile. Every push to `main` redeploys.
2. Service > Variables > Raw Editor: paste the lines of your local `.env` (keys stay out of git).
   Leave out `PORT` (Railway sets it) and `VITE_*` (build-time; the defaults turn voice and AI on).
3. Service > Settings > Networking > Generate Domain. Open `https://<name>.up.railway.app/api/health`.
4. Set `PUBLIC_URL=https://<your domain>` in Variables once the domain works (room QR codes and
   wallet card art use it).

## 2. Domain (GoDaddy Registry track)
1. Register a name on a TLD that GoDaddy Registry runs (.us, .co and .biz among others; check the
   track's rules for the exact list), e.g. `maydaymayor.us`.
2. Railway: Settings > Networking > Custom Domain > enter `www.<domain>` (and the apex if wanted).
   Railway shows a CNAME target (and a TXT record for verification).
3. Registrar DNS: add the CNAME `www` -> Railway's target, and the TXT record. For the apex, use the
   registrar's forwarding from `<domain>` to `https://www.<domain>`, or an ALIAS/ANAME if offered.
4. Railway issues HTTPS on its own once DNS resolves (minutes, sometimes up to an hour).

## Notes
- Live feeds poll from the deployed server too; inserts are `ON CONFLICT` upserts, so a local
  server and the deployed one can share the Tiger database.
- The TTS and card-art caches (`server/.cache`) start empty on each deploy and refill on use.
- `LIVE_FEEDS=false` turns the pollers off.
