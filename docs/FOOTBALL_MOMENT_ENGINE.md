# Football Moment Engine

VIRA translates factual TxLINE football actions into a small number of meaningful multiplayer conditions.

## Normalized facts

`normalizeTxlineScore()` preserves goals, shots, corners, penalties, cards, possession, VAR, reliability changes, amendments, discarded actions, score adjustments, periods and match end. Normalized events carry provider sequence, match clock, participant side, confirmation, source action identity, outcome, cumulative stats and the raw payload.

## Authoritative statistics

Each room projects home/away shots, shots on target, corners, yellow cards and red cards, plus reliability for shots, corners and cards. Confirmed events update counters immediately. Cumulative TxLINE counters reconcile missed frames after reconnect. Amendments replace the referenced action; discarded actions remove its contribution.

The ledger records:

```text
football.event.accepted
football.event.amended
football.event.discarded
football.stats.updated
football.condition.candidate_met
football.condition.candidate_revoked
football.condition.confirmed
football.condition.expired
```

## Team shot on target

```text
Argentina finaliza no alvo nos proximos 5 minutos?
```

- The answer window remains 30 server seconds.
- The five match minutes start after `round.locked`.
- An unconfirmed on-target shot creates a candidate.
- A confirmed matching shot or authoritative counter increase resolves `YES`.
- Amendment/discard can revoke a pending candidate.
- An authoritative clock observation at the limit without an increase resolves `NO`.
- Odds never resolve the condition.

## Diversity

The RoundDirector selects `team_shot_on_target` only after shot coverage has become reliable. It never repeats the family immediately and allows at most two shot-on-target rounds per fixture. The global maximum remains seven football rounds.

## Replay V2

Replay includes the opening counter, final counter or confirmed causal shot, answer lock, window, origin, scoring hashes and deterministic predicate. Replay is derived from the ledger and remains byte-stable after restart.
