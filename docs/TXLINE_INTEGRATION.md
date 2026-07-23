# TxLINE Integration

TxLINE is VIRA's external authority for fixture identity, competition, lifecycle, market observations, scores and provider sequences. Integration occurs on the backend; credentials and raw provider access are not exposed to the browser.

## Data path

```text
TxLINE endpoint / stream
→ acquisition metadata and cache policy
→ server-side normalization
→ authority, lifecycle and freshness checks
→ Picks catalog or Match Room observation
→ persisted evidence and consumer projection
```

VIRA keeps kickoff time, provider observation time, acquisition time, cache materialization time and response-generation time distinct. Related market families are allowlisted only after their provider mapping is observed and certified.

## Runtime modes

- Live operation uses configured TxLINE credentials and the same normalizers/reducers as every other input mode.
- The permanent judge path uses a sanitized captured TxLINE test fixture and labels it as captured evidence.
- Missing or stale authority fails closed; the browser does not invent freshness or results.

## References

- [Endpoint map](TXLINE_ENDPOINT_MAP.md)
- [Payload inspection notes](TXLINE_PAYLOAD_INSPECTION.md)
- [Subscription evidence](TXLINE_SOLANA_SUBSCRIPTION_EVIDENCE.md)
- [Server cache](VIRA_SERVER_CACHE.md)
- [Football moment engine](FOOTBALL_MOMENT_ENGINE.md)

