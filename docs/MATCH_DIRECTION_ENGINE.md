# VIRA Match Direction Engine

The Match Direction Engine translates accepted TxLINE football facts into restrained audiovisual scenes. It never infers authority from UI state and never changes competitive outcomes.

## Presentation levels

- `ambient`: temporary pressure atmosphere, no interaction and no queue.
- `banner`: shot on target, corner, yellow card, penalty and VAR review.
- `takeover`: confirmed goal, red card, confirmed/overturned VAR and full time.

## Arbitration

The director owns a single active scene. Confirmed semantic changes can preempt smaller interruptible scenes. A goal therefore discards an active shot banner. Round resolution remains pending until the causal takeover ends, then the existing result overlay receives exclusive ownership.

Commands are explicit: `enqueue`, `replace`, `revoke`, `dismiss` and `expire_ambient`. Amendments replace a correlated action and `action_discarded` removes active, queued or ambient presentations for its `sourceActionId`.

## Reconnect and accessibility

Presented moment IDs are retained per fixture in `sessionStorage`; SSE reconnects cannot replay a scene in the same browser session. Motion supports `full`, `reduced` and `off`, while the operating-system reduced-motion preference always wins. Sound is off by default. Vibration and generated Web Audio feedback run only while the tab is visible and never affect match state.

## Product rule

The engine directs changes of meaning, not every update. Market updates remain passive, pressure expires automatically, and the competitive result always has priority after the causal match scene completes.
