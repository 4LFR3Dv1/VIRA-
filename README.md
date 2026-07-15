<div align="center">
  <img src="public/vira-icon.png" width="112" alt="VIRA logo" />

  # VIRA

  **Play the match live with your friends.**

  VIRA turns authoritative football moments into synchronized multiplayer challenges powered by TxLINE.

  [![Live App](https://img.shields.io/badge/Live_app-Open_VIRA-9EF01A?style=for-the-badge&labelColor=050814)](https://vira.snelabs.space/?lang=en)
  [![Demo](https://img.shields.io/badge/Demo-3%3A40_on_YouTube-FF0033?style=for-the-badge&labelColor=050814)](https://www.youtube.com/watch?v=eqe9e5TZ02k)
  [![Commercial Pitch](https://img.shields.io/badge/Pitch-Commercial_PDF-9EF01A?style=for-the-badge&labelColor=050814)](docs/VIRA_Synchronized_Football_Engagement.pdf)
  [![Judge Walkthrough](https://img.shields.io/badge/Judges-3_minute_walkthrough-FFFFFF?style=for-the-badge&labelColor=050814)](https://vira.snelabs.space/help?lang=en)
  [![Verify](https://github.com/4LFR3Dv1/VIRA-/actions/workflows/verify.yml/badge.svg)](https://github.com/4LFR3Dv1/VIRA-/actions/workflows/verify.yml)

  **TxODDS World Cup Hackathon · Consumer & Fan Experience · Functional devnet deployment**
</div>

<br />

[![VIRA — synchronized multiplayer football experience](https://i.ytimg.com/vi/eqe9e5TZ02k/maxresdefault.jpg)](https://www.youtube.com/watch?v=eqe9e5TZ02k)

## The match becomes the game

Most football products ask fans to watch a feed. VIRA lets them play the unfolding match together.

Fans enter instantly as guests, join a shared Match Room and answer short challenges opened by what is happening on the pitch. Answers stay private until one server-owned deadline. The next eligible TxLINE observation resolves the same rule for everyone, then points, streaks and ranking update together.

```text
TxLINE match event
        ↓
synchronized challenge
        ↓
private answers → authoritative lock
        ↓
shared result → ranking → verifiable replay → share
```

No wallet, OAuth, purchase or installation is required for the fan experience. Solana is used by the backend to activate TxLINE access and optionally anchor a resolved replay hash.

## Judge fast path — under three minutes

1. Open the [live app](https://vira.snelabs.space/?lang=en) and make the featured 1X2 prediction.
2. Share the result and open the link in an anonymous or mobile window.
3. Enter the same fixture from both windows with different names.
4. Compare the synchronized room, private answer state and Mini League membership.
5. Open [Official VIRA Review](https://vira.snelabs.space/help?lang=en) to inspect a resolved round reconstructed from the public ledger.

```text
Pick → Share → Join → Play → Resolve → Rank → Verify
```

The canonical [3:40 demo video](https://www.youtube.com/watch?v=eqe9e5TZ02k) shows the complete experience, two isolated participants and the real TxLINE integration path. The [judge walkthrough](docs/JUDGE_WALKTHROUGH.md) provides the operational version of the same flow.

## Why VIRA stands out

| Fan value | What VIRA delivers |
| --- | --- |
| **Instant access** | Guest entry with no wallet or account ceremony. |
| **A reason to keep watching** | Short challenges driven by meaningful football conditions rather than constant market noise. |
| **A shared live moment** | Server-authoritative deadlines and SSE projections keep every participant on the same round. |
| **Friendly competition** | Points, streaks, ranking and implicit Mini Leagues emerge from room invitations. |
| **Return loops** | Share cards and optional Web Push bring fans back for a new round or resolved result. |
| **Trust** | Every verified result can be reproduced from an append-only, hash-chained event ledger. |
| **Mainstream positioning** | No money, payout, betting position or token purchase is part of the Consumer experience. |

## Built for the hackathon criteria

| Criterion | Product evidence |
| --- | --- |
| **Fan Accessibility & UX** | English and PT-BR, responsive UI, guest entry, PWA, share links and a focused second-screen flow. |
| **Real-Time Responsiveness** | TxLINE score/odds adapters, stream reconnection, serialized room processing and SSE delivery to participants. |
| **Originality & Value Creation** | The match opens a synchronized social decision loop instead of becoming another passive scoreboard. |
| **Commercial Path** | A B2B2C engagement layer for broadcasters, sponsors, clubs, creators and sports communities. |
| **Completeness & Execution** | Deployed product, public demo, persistent backend, deterministic replay, two-device E2E and operational probes. |

## TxLINE is the live authority

TxLINE is not decorative content in VIRA. It provides the fixture identity, competition, market baseline, provider sequence and football observations that drive the runtime.

| TxLINE input | VIRA use |
| --- | --- |
| Fixture snapshot | Match discovery, competition identity, kickoff and room configuration. |
| Score snapshot and updates | Scoreboard reconciliation, football actions and authoritative match lifecycle. |
| Historical scores | Deterministic inspection and replay from real provider records. |
| Odds snapshot and updates | Canonical full-match 1X2 context and pre-match prediction. |
| Score stream | Live football observations delivered to active Match Rooms. |
| Odds stream | Live market observations supported by the runtime adapter. |

VIRA deliberately fails closed when authority is missing or stale. It does not invent lineups, players, possession or unsupported market facts. The complete mapping is documented in [TxLINE Endpoint Map](docs/TXLINE_ENDPOINT_MAP.md).

### Demo disclosure

The competitive walkthrough uses a sanitized captured TxLINE test fixture so judges can see the complete open → answer → lock → resolve loop after live activity has ended. It is explicitly labeled `captured_txline_test_fixture` in the video and evidence artifacts.

A separate demo segment shows the real production TxLINE path. Normal operation uses the same normalizer, runtime, reducer, ledger and Consumer UI; only the deterministic capture input is controlled.

## Architecture

```mermaid
flowchart LR
    TX[TxLINE fixtures, scores and odds] --> N[Normalization and authority checks]
    N --> R[Serialized Match Room runtime]
    R --> L[(Append-only JSONL ledger<br/>with hash chain)]
    R --> S[SSE projections]
    S --> A[Fan A]
    S --> B[Fan B]
    L --> V[Verified replay]
    V --> O[Official VIRA Review]
    V -. asynchronous .-> SOL[Solana Memo commitment]
```

The browser never decides the deadline, winning option, score or ranking. Room mutations are serialized server-side, answers are timestamped at admission and only the first eligible post-lock provider signal can resolve a competitive round.

### Integrity contract

- A round has its own immutable version and absolute `locksAt` deadline.
- Individual choices and option splits remain private before lock.
- Duplicate answers are rejected with `409`.
- `round.locked` is persisted before resolution and is idempotent.
- Only answers admitted before the deadline can score.
- Provider observations retain acquisition origin, endpoint and sequence evidence.
- Internal test events cannot produce a verified TxLINE verdict.
- Replay, projection and ranking must agree after restart.
- Public verification never exposes participant identity, session tokens or individual choices.

## Solana: two distinct responsibilities

VIRA keeps its Solana responsibilities explicit:

1. **TxLINE subscription** — the project wallet subscribes to the free TxLINE devnet service level, signs the activation message and receives backend API credentials. See [TxLINE Solana Subscription Evidence](docs/TXLINE_SOLANA_SUBSCRIPTION_EVIDENCE.md).
2. **VIRA replay commitment** — after a verified resolution, VIRA can asynchronously anchor the exact replay hash through the Solana Memo Program. Resolution never waits for the chain. See the [confirmed devnet evidence](docs/p1-c-devnet-evidence.json) and [Explorer transaction](https://explorer.solana.com/tx/2P4ZUus1epocVRUr8BvC59VvQTTJGjRPNGUDQ3K2gfTJqvPzG8r66U8PsKdEPxQzsfJxCN9GMXhKBXNA23G6XTJh?cluster=devnet).

## Commercial path

VIRA is a B2B2C fan-engagement layer. Fans play for free; partners pay to operate and distribute the experience around licensed sports data.

| Offer | Buyer | Value |
| --- | --- | --- |
| **Sponsored Match Room** | Brands and broadcasters | Own the live fan interaction around one high-attention fixture. |
| **Tournament Package** | Organizers and media partners | Run a consistent engagement layer across an entire competition. |
| **Creator Mini League** | Creators and sports communities | Turn an audience into a recurring match-day group. |
| **White-label Experience** | Clubs, apps and rights holders | Embed the challenge engine with partner identity and distribution. |

The measurable funnel is:

```text
share created → invite opened → guest joined → live answer
→ return alert → result viewed → result shared
```

Commercial reporting can price and optimize distribution around qualified joins, answer rate, return rate, share conversion and repeat participation — not merely logo impressions.

The [VIRA commercial pitch](docs/VIRA_Synchronized_Football_Engagement.pdf) presents the product positioning, TxLINE-powered architecture, measurable engagement funnel, partner value and revenue paths in a concise five-page deck.

## Production evidence

At the latest release gate:

- production build passed;
- 139 automated unit, contract and integration checks passed;
- the two-device Consumer E2E passed with isolated identities and equivalent rankings;
- public read-only smoke tests passed on Chromium desktop, Chromium mobile viewport and Mobile WebKit;
- the deployed Consumer projection agreed across Home, Lobby and Match Preview;
- the public verified replay preserved hash-chain, projection and ranking equivalence;
- the deployment exposed healthy readiness, persistent storage and configured TxLINE devnet access.

Public operational endpoints:

```http
GET /health
GET /ready
GET /operational/metrics
GET /public/playback
```

The canonical video package includes its own [metadata](scripts/demo/vira-demo-metadata.md), [certification manifest](scripts/demo/vira-demo-certification.json), captions and reproducible composition timeline.

## Technology

- **Consumer:** React 18, TypeScript, Vite, Motion and responsive PWA assets.
- **Runtime:** Node.js, serialized room queues and Server-Sent Events.
- **Persistence:** append-only JSONL event store, optimistic concurrency and hash chaining.
- **Sports data:** TxLINE fixtures, odds, scores, updates, historical records and streams.
- **Blockchain:** Solana/Anchor for TxLINE activation; Solana Memo Program for optional replay commitments.
- **Quality:** Node test runner, Playwright, deterministic fixtures and deployment audits.
- **Delivery:** Docker, Railway health gates and a persistent single-writer volume.

## Run locally

Requirements: Node.js 22+ and npm.

```powershell
git clone https://github.com/4LFR3Dv1/VIRA-.git
cd VIRA-
npm install
Copy-Item .env.example .env
npm run backend:dev
```

In another terminal:

```powershell
npm run dev
```

Default URLs:

```text
Frontend  http://127.0.0.1:5173
Backend   http://127.0.0.1:8787
```

The UI can boot without TxLINE credentials for local contract work. A TxLINE-backed catalog requires the activation flow below.

## Activate TxLINE access

The automated devnet setup creates a local project wallet, requests devnet SOL, subscribes to service level `1`, signs the activation message, obtains the API token and tests the fixture snapshot.

```powershell
npm run txline:setup:devnet
```

For the documented mainnet real-time World Cup tier:

```powershell
npm run txline:setup:mainnet-realtime
```

Mainnet needs enough SOL for transaction fees. The World Cup free tier removes TxL data fees, not normal Solana transaction fees. Never commit `.env`, a wallet keypair, guest JWT or API token.

Minimum backend configuration:

```dotenv
TXLINE_NETWORK=devnet
TXLINE_JWT=<guest-jwt>
TXLINE_API_TOKEN=<activated-api-token>
TXLINE_FIXTURE_ID=<optional-fixture-id>
```

To inspect available fixtures and endpoint coverage:

```powershell
npm run txline:discover -- --limit 20
```

## Verify the product

Run the full release gate:

```powershell
npm run verify
```

Run the exact two-device flow referenced in the judge walkthrough:

```powershell
npm run test:e2e:two-device
```

Run the public verified playback contract:

```powershell
npm run test:judge-playback
```

Optional operational certification:

```powershell
npm run certify:match -- --cycles 3 --target https://vira.snelabs.space
npm run soak:match -- --target https://vira.snelabs.space --duration-sec 14400 --interval-sec 30
```

An accelerated certification must not be described as the four-hour wall-clock soak.

## API surface

### TxLINE adapters

```http
GET  /matches/catalog
GET  /txline/capabilities
GET  /txline/fixtures
GET  /txline/scores?fixtureId=...
GET  /txline/scores/updates?fixtureId=...
GET  /txline/scores/historical?fixtureId=...
GET  /txline/odds?fixtureId=...
```

### Match Rooms

```http
POST /rooms/:roomId/join
GET  /rooms/:roomId/state?participantId=...
GET  /rooms/:roomId/events
POST /rooms/:roomId/rounds/:roundId/answer
GET  /rooms/:roomId/txline/status
```

### Public verification

```http
GET /public/rooms/:roomId/events
GET /public/rooms/:roomId/projection
GET /public/rooms/:roomId/verification
GET /public/rooms/:roomId/rounds/:roundId/replay
GET /public/rooms/:roomId/rounds/:roundId/commitment
```

Authenticated room state requires the participant's Bearer session token. Internal ingest routes are disabled in Consumer deployments and require an explicit feature flag plus an administrative credential.

## Deployment

The included `Dockerfile` builds the frontend and serves the application and API from one Node process. `compose.yaml` mounts persistent state at `/var/lib/vira`.

```powershell
docker compose up --build -d
```

Production invariants:

```text
replicas = 1
VIRA_DATA_DIR = persistent mounted volume
VIRA_INTERNAL_INGEST_ENABLED = false
VIRA_ALLOWED_ORIGINS = deployed public origin
```

The current event store is deliberately single-writer. Horizontal replicas require replacing it with a transactional shared store.

## TxLINE developer feedback

What worked especially well:

- one normalized cross-competition model;
- consistent fixture identifiers across fixtures, scores and odds;
- provider sequences that support idempotent processing;
- historical records that make deterministic inspection possible;
- canonical market data that can be normalized once on the server.

Where we found friction:

- kickoff, observation, cache materialization and response-generation times must remain distinct;
- canonical full-match 1X2 needs careful selection among related periods;
- exceptional fixture states need explicit lifecycle handling;
- live feeds must degrade safely without the browser inventing freshness.

VIRA addresses these points through a server-side Consumer projection, explicit freshness policy, score reconciliation and fail-closed authority rules.

## Documentation

| Document | Purpose |
| --- | --- |
| [Judge Walkthrough](docs/JUDGE_WALKTHROUGH.md) | Fast evaluation path and operational runbook. |
| [TxLINE Endpoint Map](docs/TXLINE_ENDPOINT_MAP.md) | Provider endpoints and product mapping. |
| [Football Moment Engine](docs/FOOTBALL_MOMENT_ENGINE.md) | Normalized football actions and round conditions. |
| [Consumer Cadence](docs/CONSUMER_CADENCE.md) | Meaningful-round limits and cooldown policy. |
| [Social Share Layer](docs/SOCIAL_SHARE_LAYER.md) | Invitations, predictions, Mini Leagues and privacy. |
| [VIRA Picks V1](docs/VIRA_PICKS.md) | Isolated pre-match Picks architecture, authority, flags and known limits. |
| [PWA Cache Policy](docs/pwa-cache-policy.md) | Why competitive state is never served stale. |
| [Solana Subscription Evidence](docs/TXLINE_SOLANA_SUBSCRIPTION_EVIDENCE.md) | Secret-free TxLINE activation record. |
| [Commercial Pitch](docs/VIRA_Synchronized_Football_Engagement.pdf) | Five-page product, architecture, partner value and monetization overview. |

## Known limits

- The file event store supports one process and one persistent volume.
- Market-family diversity is narrower than the general rule engine supports.
- Mobile WebKit evidence uses emulation rather than a physical iPhone.
- The deterministic competitive demo uses a captured, explicitly disclosed TxLINE fixture.
- Long-running ledgers will eventually need snapshotting, compaction or a transactional store.

## Submission

- **Live app:** https://vira.snelabs.space/?lang=en
- **PT-BR app:** https://vira.snelabs.space/?lang=pt-BR
- **Demo:** https://www.youtube.com/watch?v=eqe9e5TZ02k
- **Commercial pitch:** [VIRA — Synchronized Football Engagement](docs/VIRA_Synchronized_Football_Engagement.pdf)
- **Judge walkthrough:** https://vira.snelabs.space/help?lang=en
- **Public repository at submission:** https://github.com/4LFR3Dv1/VIRA-

---

<div align="center">
  <strong>VIRA turns watching together into playing together.</strong><br />
  Powered by TxLINE. Verified by its event ledger. Built for every match-day group.
</div>
