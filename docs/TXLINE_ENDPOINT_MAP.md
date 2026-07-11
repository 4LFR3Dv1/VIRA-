# TxLINE Endpoint Map

Source checked: `https://txline-docs.txodds.com/llms-full.txt`

This document maps the official TxLINE endpoints we can use in VIRA without adding mock or fallback sports data.

## Current Product Rule

VIRA must render a field only when it is backed by one of these sources:

- Direct TxLINE API response.
- A normalized event derived from a TxLINE response.
- User-generated room state created inside VIRA, such as joins, answers, ranking, and timeline.

If TxLINE does not expose or return a data category, the product must show it as unavailable or omit the block.

## Official Endpoints

| Family | Endpoint | Status in VIRA | Product Use |
| --- | --- | --- | --- |
| Auth | `POST /auth/guest/start` | Implemented | Guest JWT session. |
| Auth | `POST /api/token/activate` | Implemented in setup script | Activated API token after Solana subscription. |
| Fixtures | `GET /api/fixtures/snapshot` | Implemented | Lobby, fixture cards, preview identity, room configuration. |
| Fixtures | `GET /api/fixtures/updates/{epochDay}/{hourOfDay}` | Wrapper added | Fixture update audit trail. |
| Scores | `GET /api/scores/snapshot/{fixtureId}` | Implemented | Preview counts, latest score/action context. |
| Scores | `GET /api/scores/updates/{fixtureId}` | Implemented | Current 5-minute score/action updates. |
| Scores | `GET /api/scores/historical/{fixtureId}` | Implemented | Historical replay from real score records. |
| Scores | `GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}` | Wrapper added | Historical score capture by 5-minute interval. |
| Scores | `GET /api/scores/stream` | Implemented | Live score SSE ingestion. |
| Odds | `GET /api/odds/snapshot/{fixtureId}` | Implemented | Market probability, odds_shift event, round resolution. |
| Odds | `GET /api/odds/updates/{fixtureId}` | Implemented in context | Current 5-minute odds cache for a fixture. |
| Odds | `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}` | Wrapper added | Historical odds capture by 5-minute interval. |
| Odds | `GET /api/odds/stream` | Implemented | Live odds SSE ingestion. |
| Validation | `GET /api/fixtures/validation` | Wrapper added | Fixture proof in Judge Mode. |
| Validation | `GET /api/fixtures/batch-validation` | Wrapper added | Batch fixture proof. |
| Validation | `GET /api/odds/validation` | Wrapper added | Odds update proof. |
| Validation | `GET /api/scores/stat-validation` | Wrapper added | Score/stat proof. |
| Purchase | `POST /api/guest/purchase/quote` | Out of scope | Paid tier token purchase. |

## Not Found In Current Docs

Do not render these as official TxLINE data yet:

- Official lineups or team sheets.
- Player profiles.
- Player favorites.
- Player-level cards for preview.
- Official possession, shots, pressure, or tactical telemetry unless extracted from score records/stat keys.

Current product behavior:

- `/matches/:fixtureId/lineups` returns `501 txline_lineups_unavailable`.
- Preview explains that lineups are unavailable instead of inventing Fan XI data.
- Match Room `LiveField` shows source, event type, market value, and sequence from normalized TxLINE evidence only.

## Next Implementation Order

1. **Historical interval capture**
   - Endpoints:
     - `GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}`
     - `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}`
   - Why: build deterministic replay from real TxLINE records.
   - Product impact: demo video can be controlled without using invented events.

2. **Validation proofs**
   - Endpoints:
     - `GET /api/odds/validation`
     - `GET /api/scores/stat-validation`
     - `GET /api/fixtures/validation`
   - Why: enhances Judge Mode evidence chain.
   - Product impact: “this event was published by TxLINE and anchored” proof.

## Runtime Mapping

| TxLINE Payload Source | Normalized VIRA Event | Product Consequence |
| --- | --- | --- |
| `odds.snapshot` | `odds_shift` | Resolve market threshold rounds. |
| `odds.updates_fixture` | `odds_shift` | Resolve market movement rounds. |
| `odds.stream` | `odds_shift` | Live market-driven resolution. |
| `scores.snapshot` | `goal`, `card`, `period`, `match_end` when action fields permit | Resolve event-driven rounds. |
| `scores.updates_fixture` | `goal`, `card`, `period`, `match_end` when action fields permit | Resolve live 5-minute event rounds. |
| `scores.historical_fixture` | `txline-history` normalized events | Real historical replay. |

## UI Mapping

| UI Area | Allowed Data |
| --- | --- |
| Lobby | `fixtures.snapshot` only. |
| Preview header | fixture metadata from `fixtures.snapshot`. |
| Preview market block | `odds.snapshot` / `odds.updates_fixture` only. |
| Preview scores/activity summary | `scores.snapshot`, `scores.updates_fixture`, `scores.historical_fixture`. |
| Preview lineups | Hidden/unavailable until official endpoint exists. |
| Match Room field | normalized TxLINE evidence and VIRA room state only. |
| Ranking | VIRA answers and deterministic scoring only. |
| Timeline | VIRA room events plus normalized TxLINE events only. |
| Judge Mode | raw TxLINE hash, normalized event, rule evaluation, mutation outputs. |

## API Exposed By VIRA

```http
GET /txline/capabilities
```

Returns the machine-readable endpoint catalog used by this document.
