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

The three product questions are fixed:

| Kind | Canonical IDs | Resolver |
| --- | --- | --- |
| Regular-time result | `match_result:home`, `match_result:draw`, `match_result:away` | `resolveMatchResultV1` |
| Regular-time total 2.5 | `total_goals:2.5:over`, `total_goals:2.5:under` | `resolveTotalGoalsV1` |
| Both teams score | `both_teams_score:yes`, `both_teams_score:no` | `resolveBothTeamsScoreV1` |

Captured repository evidence proves the TxLINE provider identifier `1X2_PARTICIPANT_RESULT` for the first question. The repository does not currently contain captured TxLINE evidence for the provider identifiers of Total Goals 2.5 or Both Teams Score. Those mappings therefore fail closed by default. They may only be configured after checking real provider output:

```dotenv
VIRA_PICKS_TOTAL_GOALS_MARKET_TYPES=
VIRA_PICKS_BTTS_MARKET_TYPES=
```

No similar market is substituted. Empty, stale, ambiguous, in-running, wrong-period, wrong-line or incomplete observations are unavailable. This limitation is intentional and means the current branch should remain disabled until the two identifiers are verified against real TxLINE responses.

## Authority and lock

- `locksAt` is the authoritative fixture kickoff timestamp supplied by the server catalog.
- Only a scheduled fixture with a future kickoff accepts confirmation.
- A live, finished, unknown or missing fixture status does not become scheduled.
- The store rechecks the server clock; client delay cannot extend the deadline.
- Confirmation is immutable and idempotent. Reusing a key with different selections returns a conflict.
- Cancelled, postponed and abandoned fixtures void their cards without migration.
- Unknown or stale final data remains pending.

Resolution requires an explicit `txline_game_finalised` authority snapshot with a fresh, structured regular-time score. Total score is not assumed to be a regular-time score. Extra time and penalties are ignored by contract and tests.

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
- Provider type mappings for Total Goals 2.5 and Both Teams Score are deliberately unverified and disabled by default.
- Production resolution still needs a TxLINE projection that proves the final regular-time score separately from extra time and penalties.
- The isolated E2E uses a captured, fixed final authority through a guarded local-only E2E route.

Recommendation: keep the branch unmerged and the flag off until real TxLINE captures verify the two missing market identifiers and the production regular-time final-score authority. The implemented V1 is suitable for review and post-hackathon evolution without risking the approved competitive core.
