# VIRA

[![Verify](https://github.com/4LFR3Dv1/VIRA-/actions/workflows/verify.yml/badge.svg)](https://github.com/4LFR3Dv1/VIRA-/actions/workflows/verify.yml)

> VIRA turns real TxLINE market updates into synchronized, verifiable multiplayer rounds for football fans.

```text
Live app: https://vira.snelabs.space
Judge walkthrough: https://vira.snelabs.space/help
Verified playback: https://vira.snelabs.space/help

No wallet, OAuth, purchase or installation required.
```

Test the core in under three minutes: make the 1X2 pick on `/`, open its share in an anonymous window, enter the same fixture from both windows, then use `/help` to inspect a resolved round reconstructed from the public ledger.

VIRA is a second-screen match room for live football. Fans join a shared room, answer micro-predictions during the match, and TxLINE score events resolve each round through the runtime engine.

The product goal is a working Consumer and Fan Experience, not a scripted mockup:

- shared room state lives in the backend;
- answers are timestamped server-side;
- duplicate answers return `409`;
- room updates stream over SSE;
- TxLINE snapshots, historical scores, odds and live score streams enter through backend adapters;
- prediction resolution is deterministic and event-driven.

## The Loop

1. A real fixture and its TxLINE market context open a VIRA room.
2. The server creates a versioned round with an absolute deadline.
3. Each authenticated participant submits one answer.
4. `round.locked` closes the competitive window in the append-only ledger.
5. The next eligible TxLINE observation resolves the same rule for everyone.
6. Score, ranking and the public projection can be reproduced from the ledger.

TxLINE is not decorative data in this loop. It supplies the fixture, market baseline, provider sequence and resolving observation. Internal test events are explicitly marked and cannot produce a verified TxLINE verdict.

## Architecture

### Social acquisition loop

Room invitations, resolved-result memories, pre-match 1X2 predictions and implicit Mini Leagues share one server-derived `ShareCard` pipeline. Public links use `/s/:code`, preserve attribution through admission, and never expose room session tokens or individual pre-lock answers. See [Social Share Layer](docs/SOCIAL_SHARE_LAYER.md).

### Consumer cadence

Production disables market-update rounds. TxLINE odds remain a passive editorial input while football conditions create at most seven meaningful rounds with match-clock cooldowns. See [Consumer Match Cadence](docs/CONSUMER_CADENCE.md).

The [Football Moment Engine](docs/FOOTBALL_MOMENT_ENGINE.md) normalizes factual actions and currently supports score and shot-on-target conditions with deterministic replay.

```text
TxLINE snapshots and live streams
             |
             v
normalization + acquisition origin
             |
             v
serialized room runtime
  | round.opened
  | answer.submitted
  | round.locked
  | txline.event.accepted
  | round.resolved
             |
             v
append-only JSONL + hash chain
             |
             v
public redacted projection + SSE + Official VIRA Review
```

The browser never decides the winner or the deadline. Room mutations are serialized server-side. Public snapshots hide individual answers and option splits until the round is closed; authenticated snapshots add only the requesting participant's answer.

## Run Locally

```powershell
npm install
npm run backend:dev
npm run dev
```

Default URLs:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:8787
```

Operational probes:

```text
GET /health  -> process liveness
GET /ready   -> ledger rehydrated, persistent directory writable, required TxLINE credentials configured
GET /operational/metrics -> memory, event-loop lag, queues, SSE, ledger, feed and disk metrics
GET /public/playback     -> latest redacted verified round, reconstructed without mutations
```

Run all release checks:

```powershell
npm run verify
```

Operational certification:

```powershell
npm run test:e2e:two-device
npm run test:judge-playback
npm run certify:match -- --cycles 3 --target https://vira.snelabs.space
npm run soak:match -- --target https://vira.snelabs.space --duration-sec 14400 --interval-sec 30
```

`certify:match` freezes `artifacts/certify-match.json`. `soak:match` continuously samples readiness, memory, event-loop lag, queues, feed state and the public replay; its production default is four hours and it writes `artifacts/soak-match.json`. An accelerated run must not be described as a four-hour soak.

To test multiplayer, open two independent browser profiles, join the same fixture with different names, submit opposite answers before the server deadline, and compare the resulting ranking and Official VIRA Review.

## TxLINE Credentials

Copy `.env.example` to `.env` and fill:

```text
TXLINE_NETWORK=mainnet
TXLINE_JWT=<guest jwt>
TXLINE_API_TOKEN=<activated api token>
TXLINE_FIXTURE_ID=<fixture id>
```

Or run the automated free-tier setup:

```powershell
npm install
npm run txline:setup:devnet
```

That command creates a local project wallet at `.txline/wallet-devnet.json`, requests devnet SOL, subscribes to TxLINE service level `1`, activates an API token, tests `fixtures/snapshot`, and writes the resulting credentials to `.env`.

For mainnet real-time World Cup data:

```powershell
npm run txline:setup:mainnet-realtime
```

Mainnet cannot be funded by airdrop. The generated `.txline/wallet-mainnet.json` address needs enough SOL for transaction fees before the mainnet setup can complete.

World Cup hackathon access does not require paid credits, but it still requires the TxLINE free-tier activation flow:

1. choose one network and keep it consistent across Solana RPC, TxLINE program ID, guest JWT and activation host;
2. subscribe on-chain to a free tier;
3. sign the activation message;
4. activate the API token;
5. use `Authorization: Bearer <guest jwt>` and `X-Api-Token: <api token>` for data calls.

Mainnet free tier options:

- service level `1`: World Cup and International Friendlies with 60-second delay;
- service level `12`: World Cup and International Friendlies in real time.

## Runtime Endpoints

```http
GET  /health
GET  /matches/catalog
GET  /txline/discovery?limit=20&save=1
POST /txline/auth/guest/start
GET  /txline/fixtures
GET  /txline/scores?fixtureId=...
GET  /txline/scores/updates?fixtureId=...
GET  /txline/scores/historical?fixtureId=...
GET  /txline/odds?fixtureId=...
```

```http
POST /rooms/:roomId/join
GET  /rooms/:roomId/state?participantId=...  # Bearer session token required
GET  /rooms/:roomId/events
POST /rooms/:roomId/rounds/:roundId/answer
POST /rooms/:roomId/txline-event       # internal, disabled by default
POST /rooms/:roomId/txline/connect     # internal, disabled by default
POST /rooms/:roomId/txline/disconnect  # internal, disabled by default
GET  /rooms/:roomId/txline/status
```

Public verification resources:

```http
GET /public/rooms/:roomId/events
GET /public/rooms/:roomId/projection
GET /public/rooms/:roomId/verification
GET /public/rooms/:roomId/rounds/:roundId/replay
GET /public/rooms/:roomId/rounds/:roundId/commitment
```

The round replay is a pure `VIRA:VERIFIED_ROUND_REPLAY:V1` projection derived from the internal ledger. It exposes aggregate participation only, records authority, timing, eligibility and rule evaluation, and includes a `replayHash` over canonical JSON. Six frozen vectors and the P1-B evidence artifact live in `tests/fixtures/replay` and `docs/p1-b-replay-evidence.json`.

`RoundCommitmentPayloadV1` anchors that exact replay hash asynchronously on Solana devnet through the Memo Program. Resolution never waits for Solana. Enable it with `VIRA_SOLANA_COMMITMENT_ENABLED=true`, `VIRA_SOLANA_NETWORK=devnet` and either `VIRA_SOLANA_KEYPAIR_PATH` or the secret `VIRA_SOLANA_KEYPAIR_JSON`. The production wallet needs devnet SOL. The first verified proof is recorded in `docs/p1-c-devnet-evidence.json`.

Internal mutation routes require both `VIRA_INTERNAL_INGEST_ENABLED=true` and a constant-time checked `X-Vira-Admin-Token`/Bearer credential matching `VIRA_ADMIN_TOKEN`. Keep them disabled in Consumer deployments.

## Integrity Contract

- Round authority uses its own `round.version`, independent of room projection changes.
- The server checks the absolute `locksAt` deadline while holding the room lock.
- Competitive rounds expose a fixed answer window (`VIRA_ROUND_ANSWER_WINDOW_SEC`, default 30 seconds); only the first eligible signal received after lock can resolve them.
- `round.locked` is idempotent and persisted before resolution.
- Only persisted answers submitted before lock are scored.
- Provider observations record `txline_live_stream`, `txline_snapshot`, `verified_playback` or `internal_test` acquisition origin.
- A review is verified only when hash chain, replayed projection, ranking and provider authority agree.
- Public answer events never expose participant identity or individual option choice.
- A round replay hash remains byte-identical after ledger rehydration and backend restart.
- Rejected stale, late, unauthenticated and unauthorized mutations do not change the ledger head or ranking.

## Production Deployment

The included `Dockerfile` serves the built frontend and API from one process. `compose.yaml` fixes the backend at one replica and mounts `vira-data` at `/var/lib/vira`.

```powershell
docker compose up --build -d
```

The restart proof used by CI is available as `npm run test:container`; it emits `artifacts/p1-a-container-smoke.json`. See `docs/P1_A_EVIDENCE.md` for its invariants and the public deployment record.

### Railway

Railway reads `railway.toml`, builds the root `Dockerfile` and gates activation on `/ready`. Attach a Railway Volume to the service in the dashboard with mount path `/var/lib/vira`; the Dockerfile deliberately does not use the unsupported Docker `VOLUME` instruction.

Set `VIRA_DATA_DIR=/var/lib/vira`. Keep the service at its default singleton deployment; Railway services with an attached volume cannot use horizontal replicas.

Required production invariants:

```text
replicas = 1
VIRA_DATA_DIR = persistent mounted volume
VIRA_INTERNAL_INGEST_ENABLED = false
VIRA_ADMIN_TOKEN = strong secret (only if internal tools are enabled)
VIRA_ALLOWED_ORIGINS = deployed public origin
```

The file event store is intentionally single-writer. Do not scale this image horizontally without replacing it with a transactional shared event store.

## Commercial Path

VIRA is designed as a B2B2C fan-engagement layer for broadcasters, tournament organizers, sponsors and sports communities. A partner can run branded rooms around its licensed feed while the same deterministic round and verification contracts remain intact. No money, shares, payout or betting position is part of the Consumer experience.

## Known Limits

- The current event store requires one process and one persistent volume.
- Market-family diversity is still narrower than the runtime rule engine supports.
- Long-running ledgers will eventually need snapshots/compaction or a transactional event store.
- Production URLs and submission video should be added here when published.

## TxLINE Discovery Matrix

Use this before choosing a demo fixture:

```powershell
npm run txline:discover -- --limit 20
```

The command probes each fixture across scores, score updates, historical scores and odds. It writes a report plus captured raw payloads under `.txline/captures/` and prints a matrix with item counts, event type hints and useful-event totals.

## Docs Used

- TxLINE docs index: https://txline-docs.txodds.com/llms.txt
- World Cup Free Tier: https://txline.txodds.com/documentation/worldcup
- Quickstart: https://txline.txodds.com/documentation/quickstart
- Fetching snapshots: https://txline.txodds.com/documentation/examples/fetching-snapshots
- Streaming data: https://txline.txodds.com/documentation/examples/streaming-data
- OpenAPI YAML: https://txline.txodds.com/docs/docs.yaml
