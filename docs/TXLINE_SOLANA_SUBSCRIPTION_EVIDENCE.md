# TxLINE Solana Subscription Evidence

This document records the secret-free identity of the TxLINE subscription used to activate VIRA's devnet data access.

## Subscription

| Field | Value |
| --- | --- |
| Network | Solana devnet |
| TxLINE service level | `1` |
| Subscriber wallet | `E5yeUyBjvHmf6J2KzovToPBDY55v9bgQiXqYozTU9NxC` |
| Subscription transaction | `2CFgJK9HmuuDdzs4WZamMtin5L2sZmTZ9oNLwyGQeaekhDYwZE8nNr5yzfdM7dc579hbsVk9sCo3SDs7ksTeZbta` |
| Explorer | [Open the subscription transaction on Solana Explorer](https://explorer.solana.com/tx/2CFgJK9HmuuDdzs4WZamMtin5L2sZmTZ9oNLwyGQeaekhDYwZE8nNr5yzfdM7dc579hbsVk9sCo3SDs7ksTeZbta?cluster=devnet) |

The setup flow submitted `subscribe(serviceLevelId, durationWeeks)` through the TxLINE devnet program, signed the activation message with the same wallet, called `/api/token/activate`, and tested `/api/fixtures/snapshot`. The resulting guest JWT and API token are deployment secrets and are never included in this repository.

## Operational corroboration

The public VIRA deployment reports TxLINE devnet credentials configured and serves a TxLINE-backed fixture catalog:

- [Runtime health](https://vira.snelabs.space/health)
- [Readiness](https://vira.snelabs.space/ready)
- [TxLINE-backed match catalog](https://vira.snelabs.space/matches/catalog)

At the 2026-07-15 audit, the standard public devnet RPC no longer returned historical status for the recorded subscription signature. The signature is therefore retained here as the activation record, not presented as a newly independently confirmed transaction. Devnet history can be transient; refresh this evidence with a new subscription signature if an Explorer-resolvable proof is required for final judging.

## Separate VIRA commitment

This TxLINE subscription is distinct from VIRA's optional post-resolution replay-hash commitment. The independently confirmed Memo commitment is recorded in [`p1-c-devnet-evidence.json`](p1-c-devnet-evidence.json) and can be inspected in its [Solana Explorer transaction](https://explorer.solana.com/tx/2P4ZUus1epocVRUr8BvC59VvQTTJGjRPNGUDQ3K2gfTJqvPzG8r66U8PsKdEPxQzsfJxCN9GMXhKBXNA23G6XTJh?cluster=devnet).
