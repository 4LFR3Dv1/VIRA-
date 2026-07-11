# VIRA Hackathon Execution Lock

Status: final execution plan for submission
Track: TxODDS World Cup Hackathon - Consumer and Fan Experiences
Goal: close the smallest complete product loop that can win.

## 1. Winning Chain

VIRA should prove one chain perfectly:

```text
real TxLINE market opens a round
-> real participants answer
-> next eligible TxLINE signal arrives
-> deterministic rule resolves
-> each participant sees their own result
-> shared leaderboard changes
-> Evidence Chain proves the path
```

Do not expand product width until this chain works in two browser sessions.

## 2. Product Thesis

VIRA transforms real TxLINE market updates into multiplayer micro-predictions for World Cup fans.

It is not:

- a betting product;
- a generic odds dashboard;
- a local mock or scripted demo;
- a broad sports portal.

It is:

- a live fan room;
- a short prediction game;
- a shared leaderboard;
- a transparent TxLINE evidence pipeline.

## 3. P0 - Product Correctness

These are blockers. Do not move to polish before they pass.

### 3.1 Participant-Specific Resolution

Round result is global. User result is individual.

Global resolution:

```text
winningOptionId = yes
```

Participant resolution:

```text
Renan answer yes -> correct true -> +100
Ana answer no -> correct false -> +0
```

Implementation:

- Do not store `wasCurrentUserCorrect` as global room truth.
- Store only global facts in room state:
  - `roundId`
  - `winningOptionId`
  - `resolvedBy`
  - `event`
  - score outputs
- In `publicSnapshot(room, participantId)`, derive:
  - `wasCurrentUserCorrect`
  - `pointsAwarded`
  - `streakAfterResolve`
  - `movementLabel`

Acceptance:

- Correct user sees success overlay.
- Incorrect user sees failure overlay.
- Both clients see the same global winning option and leaderboard.

### 3.2 Session Bound To Participant

Current risk:

```text
client sends participantId
backend trusts it
```

Submission-grade fix:

```text
join -> participantId + sessionToken
frontend persists both
answer requires matching sessionToken
```

Implementation:

- Store `sessionToken` per participant in backend runtime.
- Persist `participantId` and `sessionToken` in frontend localStorage.
- Send token on answer submission.
- Reject:
  - missing participant;
  - token mismatch;
  - participant from another room.

No full auth system is needed.

### 3.3 Duplicate And Stale Provider Events

Keep separate:

```text
providerSequence = TxLINE ordering
localSequence = VIRA runtime ordering
```

Required behavior:

```text
duplicate event ID
-> ignored: duplicate_event_id

provider sequence lower than last applied
-> ignored: stale_provider_sequence

provider sequence jumps ahead
-> accepted
-> warning: sequence_gap_detected
```

Ignored events may appear in Evidence Chain, but must not mutate:

- market state;
- current round;
- match score;
- leaderboard;
- consumer timeline.

### 3.4 Temporal Round Contract

A round must not be created and resolved from the same TxLINE snapshot.

Bad:

```text
snapshot says Spain = 58.8%
question asks "Spain above 60%?"
same snapshot resolves answer
```

Correct:

```text
event 100 opens round with Spain = 58.8%
users answer
event 101 or later resolves
```

Minimum contract:

```ts
type MarketRoundContract = {
  openedFromEventId: string;
  openingValue: number;
  targetValue: number;
  minimumProviderSequence: number;
  resolutionMode: "next_eligible_update";
  comparison: "greater_than" | "less_than";
  expiresAt?: string;
};
```

Implementation:

- When generating a round, store baseline from the opening TxLINE event.
- Resolve only from an eligible later event:
  - same fixture;
  - same market signature;
  - provider sequence >= `minimumProviderSequence`;
  - event id != `openedFromEventId`.

Acceptance:

- Judge Mode shows baseline event and resolving event separately.
- Users cannot know the answer at open time from the same payload.

Market identity must be stable between the opening event and the resolving event.

Minimum market signature:

```ts
type MarketSignature = {
  fixtureId: string;
  marketType: string;
  period: string | null;
  line: string | null;
  participant: string;
  bookmakerId: string | number | null;
};
```

Stable key:

```text
fixtureId
+ marketType
+ period
+ line
+ participant
+ bookmakerId
```

Do not resolve a round with an event from a different market signature.

If no eligible update arrives before expiry:

```text
resolutionStatus: void
reason: no_eligible_update_before_expiry
scoreMutation: none
```

Consumer copy:

```text
Rodada anulada
Nenhuma atualizacao elegivel chegou dentro da janela.
```

No participant receives points for a void round.

### 3.5 Two Browser Synchronization

This is the key product test.

Test:

```text
Browser A: Renan
Browser B: Ana

both see two participants
both answer the same round
one TxLINE event resolves
each overlay shows individual result
both see identical final ranking
```

Do not add new major features until this passes.

### 3.6 Round 2 Opens After Resolution

The backend may advance immediately. The frontend can keep the overlay for 3-4 seconds.

Backend state:

```text
round 1 = resolved
round 2 = open
lastResolution remains available
```

Frontend behavior:

```text
show resolution overlay
round 2 is already visible behind it
close overlay after timeout
```

Answers must remain scoped by round.

Required structure:

```ts
answersByRound: {
  [roundId: string]: {
    [participantId: string]: ParticipantAnswer;
  };
};
```

Duplicate answer checks must use:

```text
roundId + participantId
```

Do not use a single `answers[participantId]` map as the source of truth across multiple rounds.

## 4. P1 - Emotional Product Moment

Once P0 passes, make the fan moment clear.

Required states:

- "Palpite registrado"
- "Aguardando TxLINE"
- "Atualização recebida"
- "Rodada resolvida"
- "+100"
- rank previous -> rank current

Consumer timeline should show:

- participant joined;
- prediction opened;
- answer count updated;
- TxLINE signal received;
- round resolved;
- leaderboard updated.

Avoid technical wording in the consumer surface. Keep it in Judge Mode.

## 5. Market Signal And Room Sentiment

Do not compare non-equivalent percentages.

Incorrect framing:

```text
SIM
Mercado 58.8%
Sala 64%
```

Why it is wrong:

- 58.8% is the implied market probability of Spain.
- 64% is the percentage of users who answered yes.
- They are not the same measurement.

Correct framing:

```text
TxLINE Signal
Spain: 58.8%
Target: 60%
Distance: 1.2 p.p.

Room Sentiment
SIM: 64%
NAO: 36%
```

Recommended component rename:

- `MarketVsRoom` -> `RoundPulse`

Minimum UI:

```text
MERCADO TXLINE
58.8% --------o-- 60%

SALA
SIM 64%
NAO 36%
```

Implementation:

- Backend should expose `txlineSignal` separately from `roomDistribution`.
- Frontend should render market signal and room sentiment as related but distinct panels.

## 6. Two Round Contracts Only

Do not build many templates before submission.

### Round 1: Threshold Crossing

Example:

```text
Spain ultrapassa 60% na proxima atualizacao?
```

Opens from:

```text
openingValue = 58.8
targetValue = 60
```

Resolves with:

```text
nextValue > targetValue -> yes
nextValue <= targetValue -> no
```

### Round 2: Direction

Example:

```text
A probabilidade da Spain sobe na proxima atualizacao?
```

Opens from:

```text
openingValue = 58.8
```

Resolves with:

```text
nextValue > openingValue -> yes
nextValue <= openingValue -> no
```

Keep this round binary for submission:

```text
SIM = sobe
NAO = cai ou permanece igual
```

Do not emit `same` unless the UI exposes a third option.

These two rounds prove:

- real market baseline;
- user answer window;
- next eligible update;
- deterministic resolution;
- round progression;
- shared ranking continuity.

## 7. P2 - Reproducibility Without Fake Data

Keep replay only if it uses real TxLINE records.

Allowed:

```text
Verified TxLINE Playback
-> odds historical / captured real payloads
-> same normalizer
-> same round engine
-> same internal SSE updates
```

Not allowed as main product claim:

```text
invented local event
-> scripted resolution
```

Judge Mode should label playback clearly:

```text
Acquisition: historical
Original endpoint: /api/odds/updates/...
Original timestamp: ...
Payload hash: ...
Playback speed: 4x
```

The consumer flow should prefer:

```text
stream connected
-> update received automatically
```

The manual "fetch latest TxLINE signal" button is acceptable only as an inspector tool.

## 8. Deployment Constraint

The current in-memory runtime is acceptable for the hackathon if deployed as:

```text
single instance
no horizontal autoscaling
no multiple independent workers
```

Document this limitation.

If using multiple replicas, add Redis/Postgres first for:

- rooms;
- participants;
- answers;
- scores;
- processed event IDs;
- last provider sequence.

Do not deploy multiple in-memory replicas.

## 9. Out Of Critical Path

Do not block submission on:

- wallet embedded;
- collectibles;
- social login;
- score rounds without observed rich score payloads;
- manual clock endpoint;
- many market templates;
- generic `/txline/ingest-latest`;
- multi-provider architecture;
- full user history persistence;
- editorial preview modules.

These can wait.

## 10. Execution Order

### P0 - Product Correct

1. Participant-specific resolution.
2. Session token validation.
3. Duplicate answer per `roundId + participantId`.
4. Duplicate/stale provider event handling.
5. Temporal contract: opening event -> next eligible event.
6. Two-browser synchronization test.
7. Round 2 opens after round 1 resolution.

P0 is not complete until this acceptance script passes end to end:

```text
1. Renan enters in Browser A.
2. Ana enters in Browser B.
3. Both appear with zero points.
4. Round opens from TxLINE event 100.
5. Renan answers SIM.
6. Ana answers NAO.
7. Renan resubmission returns 409.
8. Event 100 reappears and is ignored as duplicate_event_id.
9. Event sequence 99 is ignored as stale_provider_sequence.
10. Event 101 arrives and crosses the threshold.
11. Renan sees success and +100.
12. Ana sees failure and +0.
13. Both see the same ranking.
14. Event 101 reappears and grants no new points.
15. Round 2 opens.
16. Both can answer again.
```

### P1 - Product Felt By Fans

1. Registered-answer state.
2. Waiting-for-TxLINE state.
3. Update-received state.
4. Resolution overlay.
5. Score delta and rank movement.
6. Consumer timeline.
7. Replace Market vs Room with separated TxLINE signal and room sentiment.

### P2 - Reproducible Review

1. Verified playback from real TxLINE data.
2. Single-instance deploy.
3. Health check.
4. Restart behavior documented.
5. SSE reconnection check.

### P3 - Submission

1. README.
2. Technical overview.
3. API feedback.
4. Preliminary video.
5. Final video.
6. Global submission.
7. Brazil submission.

## 11. Video Script

Target: 3:30 to 4:00.

### 0:00-0:20 Thesis

VIRA transforms real TxLINE market updates into multiplayer micro-predictions.

### 0:20-0:45 Fixture And Preview

Show:

- real fixture;
- real markets;
- question created from market baseline.

### 0:45-1:25 Two Participants

Show:

- two browsers;
- Renan and Ana;
- both start with zero;
- different answers.

### 1:25-2:15 Resolution

Show:

- stream connected or verified TxLINE playback;
- next eligible market update;
- threshold crossed;
- one user wins;
- ranking updates in both clients.

### 2:15-3:10 Judge Mode

Show:

- endpoint;
- payload hash;
- provider sequence;
- baseline event;
- resolving event;
- deterministic rule;
- score mutation;
- broadcast.

### 3:10-3:40 Closing

Show:

- verified playback from real historical/captured TxLINE records;
- path to bars, creators, clubs, and fan zones.

## 12. Final Submission Definition

VIRA is ready when:

- two browsers can join one room with different names;
- both can answer one active round;
- answer submissions are token-bound;
- the round opened from one TxLINE event and resolved from a later eligible TxLINE event;
- duplicate and stale events do not mutate consumer state;
- correct and incorrect overlays are participant-specific;
- round 2 opens after round 1 resolves;
- TxLINE signal and room sentiment are semantically separated;
- Judge Mode proves baseline, update, rule, mutation, and broadcast;
- deployment runs as one consistent backend instance;
- video shows the full flow clearly in under 4 minutes.
