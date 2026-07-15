# VIRA Picks V1

VIRA Picks is an isolated, pre-match social prediction experience. A fan confirms one to three structured answers for one fixture, shares an immutable card and compares the official result with friends. It has no money, stake, prize, return, payout, wallet or wagering behavior.

The feature is disabled by default and does not mutate the Match Room runtime, competitive ledger, round deadlines, SSE, replay, Mini League points, ranking, session contracts or `FixtureConsumerProjectionV1`.

## Feature flags

Both sides must be enabled intentionally:

```dotenv
VIRA_PICKS_ENABLED=true
VITE_VIRA_PICKS_ENABLED=true
```

The default for both flags is `false`. Enabling only the frontend does not bypass backend authorization or market checks.

## Architecture

```text
TxLINE fixture + exact odds observation
              |
              v
server allowlist -> canonical snapshot -> SHA-256 reference
              |
              v
serialized Picks store -> immutable card -> public allowlisted projection
              |                         |
              v                         v
official regular-time snapshot      picks / picks_result share
              |
              v
three pure V1 resolvers -> reproducible per-selection result
```

The dedicated store persists to `picks-v1.json` with a temporary file plus atomic rename. Mutations are serialized in-process. This is a single-writer design: run one backend process against one persistent volume. A multi-process deployment requires a transactional database and a distributed serialization strategy before enabling Picks.

## Contracts and allowlist

The browser submits only the fixture ID, canonical selection IDs and an idempotency key. The authenticated public identity comes from the existing `X-Vira-Public-Token` contract. Market type, period, line, prices and probabilities are never accepted from browser input.

The domain keeps three versioned resolvers, while only observed markets are exposed:

| Kind | Canonical IDs | TxLINE exposure |
| --- | --- | --- |
| Regular-time result | `match_result:home`, `match_result:draw`, `match_result:away` | Observed `1X2_PARTICIPANT_RESULT` |
| Regular-time total 2.5 | `total_goals:2.5:over`, `total_goals:2.5:under` | Observed `OVERUNDER_PARTICIPANT_GOALS` with `marketPeriod === null`, literal `line=2.5`, exact `over/under` |
| Both teams score | Resolver retained only | Not observed; absent from catalog, confirmation, consensus and share |

The frozen sanitized vector `overunder-2-5-observed-sanitized.mjs` records the exact provider signature and expected SHA-256. Parsing consumes the complete parameter string. Approximate lines, alternate representations, duplicate/unknown options, extra options, non-null periods and ambiguous observations fail closed. Provider aliases cannot be enabled through environment variables. BTTS remains unavailable until an equivalent real TxLINE observation is captured and reviewed.

## Authority and lock

- `locksAt` is the authoritative fixture kickoff timestamp supplied by the server catalog.
- Only a scheduled fixture with a future kickoff accepts confirmation.
- A live, finished, unknown or missing fixture status does not become scheduled.
- The store rechecks the server clock; client delay cannot extend the deadline.
- Confirmation is immutable and idempotent. Reusing a key with different selections returns a conflict.
- Cancelled, postponed and abandoned fixtures void their cards without migration.
- Unknown or stale final data remains pending.

Resolution requires a hashed `RegularTimeScoreAuthorityV1`, separate from the terminal score. Status 5 uses its structured final score. Status 10 and 13 require fresh, complete structured history (`scores?Ts=0`) and recover the last score at or before the first post-regular-time status. If reconnect history is incomplete or no authoritative 90-minute score exists, the card remains unresolved. Extra-time and shootout totals never command Picks resolution.

## Existing Consumer 1X2 audit

The current Consumer prediction path resolves from `runtime.snapshot(...).match.homeScore/awayScore` after `match_end`; the runtime stores the absolute score carried by that terminal event. This is a credible post-extra-time risk, but the repository has no captured TxLINE status 10/13 vector proving that the terminal event score is cumulative in those paths. Following the protection gate, the existing runtime, ledger, `FixtureConsumerProjectionV1`, prediction resolution and ranking were not modified. A real sanitized extra-time or penalty history is required before proposing such a change.

## Persistence and privacy

Market and resolution snapshots are canonicalized and referenced by SHA-256. Rehydration preserves cards, per-selection results and resolution hashes.

The public projection is allowlisted. It excludes tokens, private participant IDs, headers, credentials, sessions and internal snapshot bodies. Picks remain hidden from third-party public projection before lock unless the owner explicitly shares the card. Sharing records publication consent for that immutable card.

Friend attribution is stored separately from competitive Mini League scoring. A friend opening a Picks card and creating their own card inherits only the Picks social group ID. No points or authoritative ranking are changed.

## API capabilities

```http
GET  /picks/fixtures/:fixtureId/catalog
POST /picks/cards
GET  /picks/cards/public/:publicCode
GET  /picks/fixtures/:fixtureId/me
POST /picks/cards/:cardId/share
POST /picks/cards/public/:publicCode/open
```

The store emits `picks.confirmed`, `picks.locked`, `picks.selection_resolved`, `picks.resolved`, `picks.voided`, `picks.shared` and `picks.opened`. `/operational/metrics` exposes aggregate counts without selections or PII.

## Verification

```bash
npm run test:picks
npm run test:browser:picks
npm run verify
```

The focused browser journey runs on Chromium desktop, Chromium mobile viewport and Mobile WebKit with reduced motion. Generated screenshots are written under `artifacts/picks-visual/` and are not source artifacts.

## Known limits and merge recommendation

- File persistence is single-writer.
- Total Goals 2.5 is observed and strictly allowlisted; Both Teams Score remains unobserved and unavailable.
- Production resolution is wired to the TxLINE historical-score projection, but remains dependent on that endpoint returning a complete structured boundary record; otherwise it deliberately stays pending.
- The isolated E2E uses a captured, fixed final authority through a guarded local-only E2E route.

Recommendation: keep the branch unmerged and both flags off until production can acquire and validate complete score history for regular-time authority. The implemented V1 remains isolated from the approved competitive core.
