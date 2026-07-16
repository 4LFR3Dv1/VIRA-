# VIRA Judge Walkthrough

Evaluate the complete VIRA journey in under three minutes. No wallet, OAuth, payment, extension or local setup is required.

## 1. Available now — VIRA Picks

1. Open the [live product](https://vira.snelabs.space/?lang=en) and choose a scheduled World Cup fixture.
2. Open **VIRA Picks**, enter a guest name and select one or two available predictions.
3. Confirm the immutable card. The server revalidates the fixture, kickoff, exact TxLINE market and freshness before accepting it.
4. Share the card and open the link in an anonymous or mobile window.
5. Create a second card with another guest identity. Picks remain separate from Match Room points and ranking.

Supported consumer markets are intentionally allowlisted:

- regular-time match result;
- regular-time Total Goals 2.5 when the exact TxLINE market is authoritative;
- Both Teams to Score remains hidden until a matching TxLINE market is observed and certified.

VIRA Picks contains no money, stake, payout, prize or combined probability.

## 2. During a live fixture — Match Room

1. Enter the same Match Room from two windows with different guest names.
2. Wait for a relevant TxLINE football observation to open a short synchronized challenge.
3. Submit one answer on each device. Individual choices and option splits remain private until lock.
4. Observe the same server-owned deadline on both screens.
5. The first eligible post-lock TxLINE observation resolves the rule, then points, streak and ranking update together.

The browser never chooses the deadline, winning option, score or ranking.

## 3. Anytime — Certified Playback

Open the [Judge Evaluation Guide](https://vira.snelabs.space/help?lang=en) when no match is live.

The playback is a **sanitized deterministic TxLINE test fixture** persisted in the append-only ledger and replayed by the production runtime. It is not presented as current live delivery. The page proves:

```text
TxLINE-shaped observation and provider sequence
        ↓
canonical server rule and immutable lock
        ↓
deterministic winning option and scoring
        ↓
hash-chain verification
        ↓
live projection = replayed projection
        ↓
live ranking = replayed ranking
```

The canonical fixture is pinned by default so a newly resolved room cannot silently replace the certified judge evidence. A different public room is inspected only when its `roomId` is requested explicitly.

## What to inspect

- fixture and provider identity;
- market signature, provider sequence and acquisition origin;
- server-owned lock timestamp;
- deterministic rule expression and winning option;
- answers evaluated and points applied;
- replay hash and event-range hash;
- hash-chain, authority, temporal, eligibility and determinism checks;
- projection and ranking equivalence after replay.

Public playback contains no session token, participant credential, TxLINE credential or private pre-lock selection.

## Submission links

- [Live product](https://vira.snelabs.space/?lang=en)
- [3:40 demo video](https://www.youtube.com/watch?v=eqe9e5TZ02k)
- [Public repository](https://github.com/4LFR3Dv1/VIRA-)
- [Commercial pitch](VIRA_Synchronized_Football_Engagement.pdf)
- [TxLINE endpoint map](TXLINE_ENDPOINT_MAP.md)
- [VIRA Picks authority and limits](VIRA_PICKS.md)

## Reproducible verification

```powershell
npm run test:e2e:two-device
npm run test:judge-playback
npm run test:browser:picks
npm run verify
```

Operational readiness, metrics, persistence and soak procedures live in the separate [Operations Runbook](OPERATIONS_RUNBOOK.md).
