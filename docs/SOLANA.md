# Solana: civic audit trail and contribution cards (P16)

Status: agreed plan, not built yet. Branch `solana`, updated for main at e47bc0f (four cities,
weak spot, news desk, bus demand report). Devnet only, play money (DECISIONS.md).

## Why

Every game is a resident's proposed plan for Raleigh. Tiger Data already stores them and ranks
where residents and the data agree (`GET /api/planner`). Solana adds two things:

1. **Trust.** Public input that planners, journalists and residents can check without trusting our
   database: nothing can be quietly added, removed or edited after the fact.
2. **Incentive.** A local government (the collection authority) recognises useful contributions
   with non-transferable cards that a city partner can verify and honour with off-chain perks.

The loop: **play → the engine finds something real → it is published on Solana → you earn a card
that proves it → the city recognises it.**

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Card art | Gemini image generation (unique art per card), template card as fallback |
| Transferability | All cards non-transferable (soulbound) |
| Completeness layer | Yes: every game is anchored, plus the signal layer |
| Authority | Team key acts as the local government for the demo, labelled "Demo authority (simulated) — not the City of Raleigh" |
| Standard | Metaplex Core assets in one collection; Permanent Freeze Delegate on the collection (soulbound) |
| Claiming | Lazy mint: the card exists at once (Tiger Data), minted when the player connects a wallet in the session or later with a claim code |
| Keypair | Aum adds a devnet keypair to `.env` (`SOLANA_SECRET_KEY`) |

## What main now has that this plan builds on (e47bc0f)

- **Four cities** (`?city=`): Raleigh, Miami, New York, San Francisco on one engine. Rooms stay on
  Raleigh. Known gap (DECISIONS.md): New York (heat) and San Francisco (quake) play the flood rules
  with renamed pieces, so their scores are not yet meaningful hazard analysis.
- **Existing shelters and bus stops as the baseline** (Raleigh), and a **bus pickup demand report**
  for planners (`GET /api/planner/bus-demand`, CSV/GeoJSON).
- **Weak spot** (engine: the flood road whose protection keeps the most residents in reach).
- **News desk** with English and Hindi anchors (ElevenLabs) narrating the storm.
- **Solo games are now saved** (`saveSoloPlay` posts to `POST /api/plays`).

### Dependency to fix first (team)
Plays do not record the city. `saveSoloPlay` posts Miami, New York and San Francisco games too,
and the server re-checks them against Raleigh's data, so they are rejected (silently) or scored
against the wrong city. Solana needs the city in every fingerprint, signal and card, so:
`Plan.city` (default `raleigh`), a `city` column on `plays`, and the server loading each city's
data to score it. Until then, Solana covers Raleigh only.

### City scope for Solana
| City | Completeness layer | Signals and cards |
|---|---|---|
| Raleigh | Yes | Yes (real flood model, existing shelters and stops, rooms) |
| Miami | Yes, once plays carry the city | Yes (FEMA flood zones, flood rules) |
| New York, San Francisco | Yes, once plays carry the city | Not until their hazard models are fixed; labelled "limited model" |

## Two on-chain layers

### 1. Completeness layer (every game)
- At the end of each room election, and every ~5 minutes for solo plays, the server builds a
  Merkle tree over the batch's play fingerprints and writes **one** Memo transaction:
  `ready-raleigh:v1:plays:<root>:<count>:<dataBuild>`.
- Play fingerprint: SHA-256 of canonical JSON `{playId, city, mode, placements, score, dataBuild,
  roomCode, createdAt}`. No names (player ids are random UUIDs).
- Memo carries the city: `ready-raleigh:v1:plays:<city>:<root>:<count>:<dataBuild>`.
- Each play keeps its Merkle proof, so anyone can show it is included and unchanged.

### 2. Signal layer ("new or critical")
Deterministic rules in code (AI never decides), evaluated after each game against Tiger Data.
Published on **state changes only**, one Memo per signal:
`ready-raleigh:v1:signal:<city>:<type>:<spot>:<state>:<evidenceRoot>`.

| Signal | Rule (thresholds tunable in config) | Planner meaning |
|---|---|---|
| Consensus formed | A spot enters planner category `both` | Act now |
| Blind spot confirmed | A top data spot stays uncovered in the last N plays | Outreach needed |
| Local knowledge | A spot the data does not rank, picked by >= X% of recent plays | Investigate |
| Vulnerability gap | Plays protect vulnerable residents notably less than everyone | Equity flag |
| New best plan | A play beats the best score on this data build (room or city) | Community beats the baseline |
| Live conditions | Plays happen while a live gauge is at action stage (P15) | Opinion during a real event |
| Critical road | The engine's top weak spot (most residents kept in reach) stays unprotected in most plays, or many plays protect the same flood road | Fund this crossing |
| Bus demand hotspot | The bus demand report shows repeated pickups where no existing stop serves no-car households | Add or reroute service here |
| Baseline gap | Plays keep covering at-risk blocks that today's existing shelters miss | The current shelter network has a hole here |

Signals need several distinct players before they count (anti-farming). Small hackathon rooms:
room-level signals plus city-wide ones.

Also anchored: the data build fingerprint per city (once per build), and hourly snapshots of the
`/api/planner` ranking and the bus demand report, so "community priorities as of block X" can be
cited by planners and transit agencies.

## Contribution cards

| Card | Earned by |
|---|---|
| Mayor-elect | Winning a room election |
| Blind-spot spotter | Your plan triggered a blind-spot signal |
| Local knowledge | Your plan triggered a local-knowledge signal |
| Consensus builder | Your plan pushed a spot into consensus |
| Gap finder | Your plan covered a baseline gap or a bus demand hotspot first |
| Civic planner (no incentive) | Completing a game; recognition only |

Using the in-game Weak spot power never earns a card by itself (the engine found it, not the
player); a card needs a signal that several different players' plans produced.

Card content (city on every card):
- **Facts from code** (engine + Tiger Data): neighborhood, residents protected, signal type, rank,
  room, data build, play fingerprint, signal transaction. Stored as Core asset attributes.
- **Words from Gemini**: title, flavour line, why it matters. JSON schema validated, length
  clamped, template fallback.
- **Art from Gemini image generation**, prompted with Sakhi's printed-ink style (flat spot inks,
  ink outlines, the player's candidate) and the spot's neighborhood. Timeout and template fallback
  (candidate portrait + printed map of the spot) so a card always appears. Image model from env
  (`GEMINI_IMAGE_MODEL`) with a fallback chain; Gemini image model names are changing in 2026.
- Hosted by our server for devnet (stretch: Arweave via Irys devnet).

Player moment on the results card: *"Your platform flagged a blind spot in Southeast Raleigh —
published on Solana"*, the card reveal, Explorer link, and Claim (connect Phantom, or keep the
claim code / QR). The news desk anchor can read the signal as a breaking-news line (English or
Hindi, reusing the ElevenLabs voices); the text is the template sentence, not generated numbers.

## Architecture (planned)

- `server/src/solana/`: connection + keypair (`@solana/web3.js` v1 for Memo; Umi + `mpl-core` for
  cards), Merkle tree and proofs, batch anchoring job, signal rules, mint-on-claim.
- `server/src/cards/`: Gemini text (schema) and image generation with fallbacks, card render.
- Tiger Data: `anchors` (city, root, signature, slot, kind, count, created_at), `signals` (city,
  type, spot, state, evidence root, signature), `cards` (id, play_id, kind, attributes, image, claim code hash,
  status unclaimed|minted, asset address, owner). Plays gain `fingerprint` and `anchor_id`.
- API: `GET /api/solana/proof/:playId`, `GET /api/solana/anchors`, `GET /api/solana/signals`,
  `GET /api/cards/:id`, `POST /api/cards/:id/claim {wallet, code}`.
- App: results-card signal moment and card reveal, claim flow (wallet adapter, optional),
  `/verify` page (recompute fingerprint, check the proof, read the memo from devnet),
  "Civic signals" timeline in the planner view.
- `npm run sol:fund` (devnet faucet), `npm run sol:collection` (create the soulbound collection
  once; its address goes in `.env`).

## Rules we keep

- Devnet only, labelled; never real money. The "government incentive" is a redeemable-perk
  concept in the demo.
- Fail soft, behind `SOLANA_ENABLED`: anchoring, signals and minting run asynchronously and never
  block a game or its results (AGENTS.md).
- No names, addresses or person-level data on chain or in card attributes: neighborhood level only.
- Code computes every number; Gemini only writes words and art.
- Not "verified residents": we say tamper-evident, not one person one vote.

## Open questions

- Who adds `Plan.city` and the `plays.city` column (the dependency above), and when.

- Signal thresholds (N plays, X% share) for small rooms.
- Whether claim codes expire, and per-device limits on cards.
- Gemini image cost and latency per card at the demo (pre-warm, or generate after the reveal).

## Sources
- Metaplex Core soulbound assets: https://developers.metaplex.com/core/guides/create-soulbound-nft-asset
- Permanent Freeze Delegate plugin: https://developers.metaplex.com/core/plugins/permanent-freeze-delegate
- Gemini API generateContent: https://ai.google.dev/api/generate-content
