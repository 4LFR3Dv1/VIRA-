# Security and Privacy

## Assets and trust boundaries

- Guest session tokens and participant identity are private application data.
- Individual answers and option splits remain private until the server-owned lock.
- TxLINE and administrative credentials exist only on the backend.
- Optional Solana signing material is backend-only and is not required for competitive resolution.
- Public evidence must remain independently useful without exposing participant identity, session tokens or individual choices.

## Controls implemented in the repository

- Explicit allowed origins and authenticated participant state.
- Administrative ingest disabled by default and gated by both a feature flag and credential.
- Serialized room mutation and duplicate-answer rejection.
- Server-side admission timestamps and absolute deadlines.
- Append-only hash-chained history with deterministic replay.
- Redacted public verification endpoints.
- HTTP security and adversarial runtime tests.

## Residual risks

- The file-backed event store is a single-process design and depends on persistent-volume durability.
- Provider outages, schema changes or stale observations can reduce availability; authority checks intentionally fail closed.
- Guest identity is lightweight and is not Sybil-resistant.
- Optional Web Push and share flows add browser/platform privacy considerations.
- No external security audit is claimed.

## Reporting

Do not open a public issue containing credentials, tokens, personal data or an exploitable vulnerability. Contact the maintainer through the profile email with a minimal reproduction and affected surface. A repository-level disclosure policy can be added after maintainer contact expectations are finalized.

