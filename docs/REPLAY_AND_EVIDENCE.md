# Replay and Evidence

VIRA treats evidence as a runtime output, not a post-hoc screenshot. Accepted commands and provider observations become ordered domain events in an append-only JSONL ledger. Each record participates in a hash chain, allowing replay to detect mutation and rebuild the same public projection and ranking.

## Public verification surfaces

- [`GET /public/playback`](https://vira.snelabs.space/public/playback) — disclosed permanent playback package.
- `GET /public/rooms/:roomId/events` — redacted public event history.
- `GET /public/rooms/:roomId/projection` — rebuilt public room state.
- `GET /public/rooms/:roomId/verification` — integrity summary.
- `GET /public/rooms/:roomId/rounds/:roundId/replay` — round replay.
- `GET /public/rooms/:roomId/rounds/:roundId/commitment` — optional commitment state.

## Reproduce locally

```bash
npm ci
npm run test:replay
npm run test:judge-playback
npm run verify
```

## Evidence packages

- [Replay evidence sample](p1-b-replay-evidence.json)
- [Solana devnet commitment evidence](p1-c-devnet-evidence.json)
- [P1 evidence narrative](P1_A_EVIDENCE.md)
- Release `vira-demo-final-v2-2026-07-16` contains the certified Demo V2 media package and manifest.

Evidence from a sanitized captured fixture proves the deterministic product path; it is not represented as evidence of a currently live match.

