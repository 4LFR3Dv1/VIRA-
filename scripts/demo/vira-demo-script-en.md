# VIRA final demo narration

## 00:00–00:15 — Hook

Football is social, but most live sports products are passive. VIRA turns real match events into synchronized multiplayer decisions for friends.

## 00:15–00:33 — Pick and share

One fan makes a pre-match pick and creates a visual invite directly from the product. Every share carries the fixture, context and a clear path back into the experience.

## 00:33–00:45 — Guest-first join

A friend opens the link and joins instantly as a guest. There is no wallet, social account, payment or installation between the fan and the match.

## 00:45–01:09 — Match Room

Both participants arrive in the same Match Room. It combines the current TxLINE market view, shared match state, fan participation and the group ranking in one consumer experience.

## 01:09–01:17 — Web Push

Fans can enable optional match alerts with one contextual action. Production Web Push uses VAPID and the browser Push Service to bring subscribed fans back when a new round opens. The video explains this flow editorially; it does not simulate a native system notification.

## 01:17–01:35 — Round open

The match opens a short decision. Every participant receives the same structured question and the same countdown, synchronized to the server clock.

## 01:35–01:53 — Private answers

Ana and Bruno answer independently. Their choices remain private until lock, and the server accepts only one eligible response from each participant.

## 01:53–02:07 — Authoritative lock

The deadline belongs to the authoritative room runtime. Late or duplicate submissions cannot rewrite the competitive state after the window closes.

## 02:07–02:29 — Resolution

For this reproducible walkthrough, a captured TxLINE test fixture enters the same normalization pipeline. The observation resolves the structured rule for everyone at once. The browser never decides the winner.

## 02:29–02:35 — Ranking

Points and ranking update from the same resolved room state. Both participants converge on the same result and the same competitive ordering.

## 02:35–03:02 — TxLINE

In production, VIRA consumes TxLINE fixtures, scores, updates and market data. This read-only evidence shows the real integration path: TxLINE data is normalized, processed by the authoritative runtime, projected over SSE and presented to fans.

## 03:02–03:14 — Official Review

Every resolved round can be reviewed and reproduced. VIRA separates the origin of the input from processing integrity. The ledger, projection and ranking reproduce the same outcome, while captured data is never represented as live delivery.

## 03:14–03:30 — Commercial path

Fans participate for free. Broadcasters, sponsors, clubs, creators and communities pay to distribute branded match rooms and measure engagement from share to participation and return.

## 03:30–03:40 — Closing

VIRA is not another scoreboard. It is a verifiable multiplayer participation layer for live football, powered by TxLINE.
