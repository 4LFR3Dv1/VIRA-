# VIRA — TxODDS Consumer and Fan Experiences

## One-line pitch

VIRA turns authoritative live football moments into synchronized multiplayer decisions for friends.

## Product

Fans join instantly as guests, share a Match Room and receive short challenges opened by the match. Answers remain private until the server-owned deadline. When an authoritative TxLINE observation resolves the rule, points and ranking update for everyone together. Official Review then reproduces the round from the canonical ledger.

No wallet, OAuth, purchase or installation is required for the core experience.

## Why it is different

VIRA is not another scoreboard or passive prediction page. It connects the full consumer loop:

`match event → synchronized challenge → private answers → authoritative lock → shared result → ranking → reproducible review`

Real Web Push alerts can bring a fan back when a new round opens, without turning notifications into a gate for participation.

## TxLINE usage

TxLINE is the sports-data authority feeding fixture discovery, score snapshots and updates, historical score context and market odds. VIRA normalizes those inputs before they reach the authoritative room runtime. The browser renders server projections; it does not decide deadlines, winning options, points or ranking.

Endpoints used through the VIRA backend:

- `GET /txline/fixtures`
- `GET /txline/scores?fixtureId=...`
- `GET /txline/scores/updates?fixtureId=...`
- `GET /txline/scores/historical?fixtureId=...`
- `GET /txline/odds?fixtureId=...`

The deterministic walkthrough in the video is explicitly labeled `captured_txline_test_fixture`. A separate scene demonstrates the real production TxLINE integration path. Captured data is never represented as live delivery during recording.

## Technical highlights

- Authoritative Node runtime with serialized room processing.
- React, Vite and TypeScript Consumer application.
- SSE projections for synchronized participants.
- Append-only JSONL event ledger with hash chain.
- Deterministic replay and live/replay ranking equivalence.
- Guest session identity restored across reload and reconnect.
- Localized English and PT-BR experiences with timezone kept independent.
- Optional Web Push with VAPID, deduplication, TTL and token-free payloads.
- Optional Solana commitment after resolution; it never blocks the competitive result.

## Commercial path

Fans participate for free. Broadcasters, sponsors, clubs, creators and communities pay to distribute and operate branded match rooms, sponsored live moments, creator Mini Leagues, competition packages and white-label second-screen experiences.

The measurable journey is broader than a logo placement:

`share created → invite opened → participant admitted → live participation → return alert → result shared`

## TxLINE feedback

The normalized cross-competition model and the ability to combine fixtures, scores, updates and market context are the strongest parts of the API. They let VIRA maintain one Consumer contract while supporting different match states.

The main friction was temporal and lifecycle interpretation: kickoff time, market observation time, cache materialization time and exceptional fixture states must remain distinct. VIRA addressed this with a server-side Consumer projection, explicit freshness policy and fail-safe behavior when authority is incomplete or stale.

## Access

- Live app: https://vira.snelabs.space/?lang=en
- Public repository: https://github.com/4LFR3Dv1/VIRA-
- Demo video: pending final upload

No wallet, OAuth, purchase or installation required.
