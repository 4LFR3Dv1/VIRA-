# TxLINE Payload Inspection

Last run: `2026-07-10T16:16:19.465Z`

Capture directory:

```text
.txline/captures/2026-07-10T16-16-09-193Z
```

Latest generated report:

```text
.txline/captures/latest.md
```

## Fixture Matrix

| Fixture | Match | Scores | Updates | Historical | Odds | Useful |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `18143850` | Vietnam vs Myanmar | 0 | 0 | 0 | 0 | 0 |
| `18182808` | Australia vs Brazil | 0 | 0 | 0 | 0 | 0 |
| `18182864` | Australia vs Brazil | 0 | 0 | 0 | 0 | 0 |
| `18213979` | Norway vs England | 2 | 2 | 0 | 2 | 6 |
| `18218149` | Spain vs Belgium | 2 | 2 | 0 | 1 | 5 |
| `18222446` | Argentina vs Switzerland | 2 | 2 | 0 | 1 | 5 |

## What Scores Currently Contain

For the World Cup fixtures with score data, the observed score records contain:

- `FixtureId`
- `GameState`
- `StartTime`
- `IsTeam`
- `FixtureGroupId`
- `CompetitionId`
- `CountryId`
- `SportId`
- `Participant1IsHome`
- `Participant1Id`
- `Participant2Id`
- `Action`
- `Id`
- `Ts`
- `ConnectionId`
- `Seq`
- `Data`
- `Stats`

Observed actions:

- `coverage_update`
- `comment`

Observed status:

- `scheduled`

Observed stats:

```json
{}
```

Current conclusion:

Scores are useful for proving fixture/update plumbing, sequence handling, status, timestamps, and future event ingestion. In the currently available fixtures they do not yet provide goals, cards, substitutions, possession, shots, player names, or populated stat keys.

## What Odds Currently Contain

Observed odds fields:

- `FixtureId`
- `MessageId`
- `Ts`
- `Bookmaker`
- `BookmakerId`
- `SuperOddsType`
- `GameState`
- `InRunning`
- `MarketParameters`
- `MarketPeriod`
- `PriceNames`
- `Prices`
- `Pct`

Observed market types:

- `1X2_PARTICIPANT_RESULT`
- `ASIANHANDICAP_PARTICIPANT_GOALS`
- `OVERUNDER_PARTICIPANT_GOALS`

Example useful product mappings:

| Market | VIRA Question Type |
| --- | --- |
| `1X2_PARTICIPANT_RESULT` | Market believes Team A / draw / Team B. |
| `OVERUNDER_PARTICIPANT_GOALS` | Market expects over/under a goal line. |
| `ASIANHANDICAP_PARTICIPANT_GOALS` | Market handicap confidence by participant. |

Current conclusion:

Odds are the strongest available TxLINE enrichment source right now. The Match Room should prioritize market-driven micro-predictions over player/lineup/stat claims until score events become richer.

## Product Decisions

Use now:

- fixture identity and scheduling from `fixtures.snapshot`;
- market cards and prediction rules from `odds.snapshot`;
- score/update evidence chain from `scores.snapshot` and `scores.updates`;
- participant, answer, ranking, and timeline state from VIRA runtime.

Do not show yet:

- official lineups;
- player profiles;
- player favorites as official data;
- possession;
- shots;
- pressure;
- goals/cards/substitutions unless a real score payload contains those actions.

## Recommended Next Work

1. Add `odds.updates_fixture` to context/probe.
2. Add `odds.stream` ingestion.
3. Expand prediction templates around real observed odds markets:
   - `1X2_PARTICIPANT_RESULT`;
   - `OVERUNDER_PARTICIPANT_GOALS`;
   - `ASIANHANDICAP_PARTICIPANT_GOALS`.
4. Keep probing `scores.snapshot`, `scores.updates`, and `scores.stream`; enable goal/card/substitution rounds only when those actions are observed in real payloads.
