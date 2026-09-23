# Integrity Model

This document is the canonical index for VIRA's competitive guarantees and their verification surfaces.

| Property | Enforcement | Evidence |
| --- | --- | --- |
| Server-owned time | Each round has an immutable version and absolute `locksAt`; admission is timestamped server-side | Runtime and adversarial tests via `npm run test:runtime` and `npm run test:adversarial` |
| Private pre-lock answers | Participant state is authenticated; public verification redacts identities and choices | HTTP security tests and public replay contracts |
| One eligible resolution | `round.locked` is persisted before resolution; only the first eligible post-lock provider signal resolves | Event-sourcing and replay tests |
| Deterministic projection | Ledger replay, current projection and ranking must agree after restart | `npm run test:replay` and `npm run test:judge-playback` |
| Provider authority | Captured, internal and live inputs retain source kind; test events cannot create a verified TxLINE verdict | TxLINE adapter tests and disclosed playback source |
| Domain isolation | VIRA Picks never mutates Match Room points, answers, replay or ranking | Picks resolver/store/HTTP test suite |

## Non-guarantees

- VIRA does not guarantee uninterrupted provider delivery or permanent freshness.
- The current file store does not support multiple writers.
- The permanent judge playback is a sanitized captured TxLINE fixture, not a current live match.
- Mobile WebKit evidence is emulated rather than captured on a physical iPhone.

See [Security](SECURITY.md) for threat boundaries and [Replay and evidence](REPLAY_AND_EVIDENCE.md) for public verification.

