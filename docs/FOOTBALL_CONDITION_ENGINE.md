# VIRA Football Condition Engine

## Product contract

TxLINE market context selects an interesting team and moment. The competitive question is expressed in football language and is resolved only by authoritative score and match-clock observations.

The first supported condition is:

```text
Does Team X score in the next 10 match minutes?
```

## Timing

- Answers remain open for the server-authoritative round answer window.
- The football window starts only when `round.locked` is persisted.
- `football.condition.tracking_started` freezes the opening score, start clock and end clock.
- A server timer can lock answers, but only TxLINE match-clock observations can expire the football condition.
- The director opens another round only after 120 match seconds and only inside 15:00-35:00 or 45:00-75:00.

## Resolution

`YES` requires two coherent absolute-score observations:

```text
score increases
-> football.condition.candidate_met
-> subsequent observation preserves the increase
-> football.condition.confirmed
-> round.resolved YES
```

If the score returns before confirmation, `football.condition.candidate_revoked` is persisted and tracking continues. This covers VAR and provider corrections.

`NO` requires an authoritative observation at or after the end clock, no target-team score increase and no pending candidate.

## Ledger sequence

```text
round.opened
answer.submitted
round.locked
football.condition.tracking_started
football.condition.candidate_met (optional)
football.condition.candidate_revoked (optional)
football.condition.confirmed | football.condition.expired
round.resolved
```

The resolving `round.resolved` event stores the condition, normalized observation, resolution reason, scoring outputs and causal IDs. Replay never depends on future availability of the external API.

## Replay

- Market rounds remain `VerifiedRoundReplayV1`.
- Football rounds use `VIRA:VERIFIED_ROUND_REPLAY:V2`.
- V2 includes the opening score, clock range, final score, resolution reason and the same integrity, authority, timing, eligibility, determinism, projection and ranking checks.
- Solana commitments anchor the canonical replay hash regardless of replay version.

## Current scope

- Condition: `team_scores`.
- Duration: 10 match minutes.
- No condition crosses halftime.
- No new condition opens after 75:00.
- One competitive condition exists per room.
- Odds direct editorial selection; odds never prove a goal.
