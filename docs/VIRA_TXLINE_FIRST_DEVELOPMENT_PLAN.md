# VIRA TxLINE-First Development Plan

Status: development audit and implementation plan
Target track: TxODDS World Cup Hackathon - Consumer and Fan Experiences
Primary objective: ship a functional fan product powered by TxLINE live or snapshot data, with a judge-visible evidence chain.

## 1. Product Direction

VIRA should be positioned as a live second-screen room for World Cup fans.

Core promise:

> Fans join a match room, answer short live micro-predictions, and TxLINE data resolves each round automatically while the leaderboard updates in real time.

This project should not be framed as a local demo, mock, scripted replay, betting product, or generic football dashboard. The winning angle is a small but complete consumer experience where TxLINE is visibly the primary data source.

## 2. Hackathon Requirements Mapped To VIRA

| Requirement | Current Status | Required Work |
| --- | --- | --- |
| Functional product, not mockup | Partially met | Fix runtime bugs, round progression, identity, and scoring feedback. |
| TxLINE as primary data source | Mostly met | Keep room configuration, predictions, odds, scores, and evidence tied to TxLINE payloads. |
| Live or deployable app | Not verified in repo | Prepare frontend/backend deployment, environment docs, and health checks. |
| Demo video up to 5 minutes | Not present | Build a video script around lobby -> room -> TxLINE signal -> resolution -> Judge Mode. |
| Public repo | Not verifiable locally | Ensure README and docs are submission-ready before publishing. |
| Technical documentation | Partially met | Add this implementation plan plus final submission README section. |
| API feedback | Partially met | Convert `TXLINE_PAYLOAD_INSPECTION.md` into a concise submission feedback section. |

## 3. What Already Exists

### 3.1 Frontend

Implemented:

- React + Vite app.
- Routes:
  - `/`
  - `/match/:matchId/preview`
  - `/match/:matchId`
- Lobby screen consuming backend `/matches`.
- Match preview screen consuming `/matches/:fixtureId/txline-context`.
- Match room screen with:
  - scoreboard/header;
  - live field;
  - active prediction card;
  - leaderboard;
  - market vs room panel;
  - timeline;
  - resolution overlay;
  - Judge Mode inspector.
- Runtime hook using:
  - room join;
  - room state fetch;
  - room SSE;
  - answer submission;
  - TxLINE odds snapshot ingestion;
  - TxLINE odds stream controls.

Important files:

- `src/app/routes.tsx`
- `src/features/lobby/LobbyScreen.tsx`
- `src/features/match-preview/MatchPreviewScreen.tsx`
- `src/features/match-room/MatchRoomScreen.tsx`
- `src/features/match-room/PredictionCard.tsx`
- `src/features/match-room/MarketVsRoom.tsx`
- `src/features/inspector/InspectorPanel.tsx`
- `src/runtime/api.ts`
- `src/runtime/use-room-runtime.ts`
- `src/domain/types.ts`

### 3.2 Backend

Implemented:

- Node HTTP backend using built-ins.
- Health endpoint.
- TxLINE guest auth start.
- TxLINE fixture, score, historical score, odds endpoints.
- TxLINE discovery endpoint.
- Match listing from `fixtures.snapshot`.
- Match TxLINE context builder from scores, updates, historical, odds, and odds updates.
- In-memory room runtime.
- Room join.
- Room snapshot.
- Room SSE.
- Answer submission with duplicate-answer rejection.
- Normalized TxLINE score and odds ingestion.
- TxLINE odds and score stream manager.
- Evidence chain creation for Judge Mode.

Important files:

- `backend/server.mjs`
- `backend/runtime.mjs`
- `backend/txline-client.mjs`
- `backend/txline-context.mjs`
- `backend/txline-stream.mjs`
- `backend/txline-discovery.mjs`
- `backend/txline-endpoints.mjs`

### 3.3 Documentation

Useful existing docs:

- `README.md`
- `backend/README.md`
- `docs/TXLINE_ENDPOINT_MAP.md`
- `docs/TXLINE_PAYLOAD_INSPECTION.md`

Current endpoint map already correctly states that VIRA should only render data backed by:

- direct TxLINE response;
- normalized event derived from TxLINE response;
- VIRA-generated room state such as joins, answers, ranking, and timeline.

Current payload inspection correctly concludes:

- score records currently observed are useful for plumbing and evidence, but not yet rich enough for reliable goals/cards/stat rounds;
- odds are currently the strongest TxLINE source for product-grade micro-predictions;
- prediction templates should prioritize `1X2_PARTICIPANT_RESULT`, `OVERUNDER_PARTICIPANT_GOALS`, and `ASIANHANDICAP_PARTICIPANT_GOALS`.

## 4. Current Build Status

Verified:

```powershell
npm run build
```

Result:

- Vite production build passes.
- No TypeScript or bundling failure was detected.

Interpretation:

- The most important problems are product/runtime correctness issues, not frontend compilation issues.

## 5. Critical Findings

### Finding 1: Correct Answers Are Displayed As Failure

Severity: critical

Problem:

- Backend awards points to the correct participant.
- Backend still sets `lastResolution.wasCurrentUserCorrect` to `false`.
- Frontend uses this field to choose `resolved_success` vs `resolved_failure`.
- Result: a user can be correct and receive points while the UI says they failed.

Current backend location:

- `backend/runtime.mjs`
- `resolveCurrentRound`
- `room.lastResolution.wasCurrentUserCorrect = false`

Current frontend location:

- `src/runtime/use-room-runtime.ts`
- `stateFromSnapshot`
- `snapshot.lastResolution.wasCurrentUserCorrect ? "resolved_success" : "resolved_failure"`

Implementation:

1. Stop storing a global `wasCurrentUserCorrect` as room-global truth.
2. Store room-global resolution facts:
   - `winningOptionId`
   - `answersEvaluated`
   - `answersCorrect`
   - score outputs
3. In `publicSnapshot(room, participantId)`, compute participant-specific result:
   - find `room.answers[participantId]`;
   - compare answer option with `lastResolution.winningOptionId`;
   - set `wasCurrentUserCorrect`;
   - set `pointsAwarded` for that participant;
   - set `streakAfterResolve` for that participant.
4. Keep evidence chain global and deterministic.

Acceptance criteria:

- User answers winning option.
- TxLINE event resolves round.
- Leaderboard awards points.
- Resolution overlay says the user won.
- Wrong answer produces failure state.

### Finding 2: No Round Progression

Severity: critical

Problem:

- `round-2` and `round-3` exist as seeds.
- Runtime only sets `currentRound` to the first round.
- Resolution marks current round as `resolved`.
- No next round opens.
- The product loop stops after one question.

Current backend locations:

- `backend/runtime.mjs`
- `roundSeedsForMatch`
- `defaultRoom`
- `resolveCurrentRound`

Implementation:

1. Add `rounds` array to room state:
   - store all generated rounds;
   - keep `currentRoundId` or derive current from round state.
2. Replace `room.currentRound` mutation with helper functions:
   - `currentRound(room)`
   - `setCurrentRound(room, roundId)`
   - `advanceToNextRound(room, previousRoundId)`
3. After resolution:
   - mark resolved round as `resolved`;
   - if next round exists, open it after a short transition or immediately;
   - clear answer state for the new round;
   - reset `roomDistribution` for new options;
   - keep leaderboard and timeline.
4. Emit SSE events:
   - `round.resolved`
   - `round.opened`
   - `room.snapshot`

Recommended MVP behavior:

- Resolve round 1 from odds threshold.
- Open round 2 from another odds movement or market threshold.
- Keep round 3 optional unless time allows.

Acceptance criteria:

- After a round resolves, the room shows a new active question.
- The same participant can answer the new round.
- Duplicate protection remains scoped per round.

### Finding 3: Provider Sequence Is Not Enforced

Severity: critical

Problem:

- Runtime extracts `providerSequence`.
- It replaces event `sequence` with a local sequence.
- It does not reject stale TxLINE records where provider sequence is lower than already applied.
- Out-of-order events can mutate match state and timeline after newer events.

Current backend location:

- `backend/runtime.mjs`
- `applyNormalizedEvent`

Implementation:

1. Track both:
   - `room.lastProviderSequenceBySource`
   - `room.lastLocalSequence`
2. Keep local sequence for VIRA ordering only.
3. Preserve TxLINE provider sequence in evidence and stale checks.
4. Before applying an event:
   - if duplicate `event.id`, ignore idempotently;
   - if provider sequence is finite and lower than last provider sequence for that source/fixture, mark evidence as `ignored` with reason `stale_provider_sequence`;
   - if provider sequence skips ahead, apply but record `sequence_gap_detected` in evidence.
5. Never update score, timeline, last event, or round resolution for stale events.

Acceptance criteria:

- Same event ID applies once.
- Lower provider sequence is ignored.
- Judge Mode shows ignored stale event reason.
- Local sequence still increments for accepted VIRA events.

### Finding 4: Window-Based Resolution Is Not Real Yet

Severity: high

Problem:

- `window_elapsed` only resolves when an event happens and `matchClockSec >= windowEndsAtClockSec`.
- If no event arrives, the round never resolves.
- For first-matching-event windows, fallback only happens when a late event of the expected type arrives.

Current backend location:

- `backend/runtime.mjs`
- `winningOptionFor`
- `resolveCurrentRound`

Implementation:

For hackathon scope, avoid over-investing in event absence unless needed. Prefer odds-based rounds that resolve when a TxLINE odds signal arrives.

If implementing:

1. Add `applyClockTick(roomId, matchClockSec, sourceEvent)` helper.
2. On every accepted TxLINE score/odds event, update match clock.
3. Evaluate current round:
   - if `window_elapsed` and clock passed threshold, resolve fallback option;
   - if `first_matching_event` with elapsed fallback and clock passed threshold without matching event, resolve fallback.
4. Add route only if needed:
   - `POST /rooms/:roomId/clock`
   - or derive only from TxLINE score records.

Acceptance criteria:

- A time-window round resolves from TxLINE-derived clock movement.
- No invented local timer is required for the main product claim.

### Finding 5: Market Distribution Is Empty

Severity: high

Problem:

- `MarketVsRoom` renders market percentages from `marketDistribution`.
- Runtime initializes `marketDistribution` as `{}`.
- Odds normalization does not update it.
- Product shows room sentiment but not real market sentiment.

Current locations:

- `backend/runtime.mjs`
- `src/features/match-room/MarketVsRoom.tsx`

Implementation:

1. Create `marketDistributionFromOdds(round, event)` in `backend/runtime.mjs`.
2. For yes/no threshold rounds:
   - extract relevant price probability from `PriceNames` and `Pct`;
   - if actual value >= threshold:
     - `yes = actualValue`
     - `no = 100 - actualValue`
   - otherwise:
     - `yes = actualValue`
     - `no = 100 - actualValue`
3. For 1X2 rounds:
   - map `part1`, `draw`, `part2` to current round option IDs.
4. Update `room.marketDistribution` whenever an accepted odds event matches the active round market.
5. Include market values in evidence normalization.

Acceptance criteria:

- After ingesting odds, Market vs Room shows non-zero market percentages.
- Percentages correspond to TxLINE `Pct`.
- Judge Mode and UI agree on values.

### Finding 6: Identity And Session Token Are Incomplete

Severity: medium

Problem:

- Backend returns `sessionToken`.
- Frontend stores only `participantId`.
- Answer submission trusts `participantId` from request body.
- `JoinRoomDialog` exists but is not wired into the current room entry flow.
- Default name is always `Renan`.

Current locations:

- `backend/runtime.mjs`
- `src/runtime/use-room-runtime.ts`
- `src/features/lobby/JoinRoomDialog.tsx`

Implementation:

1. Persist both:
   - `participantId`
   - `sessionToken`
2. Submit answer with:
   - `Authorization: Bearer <sessionToken>`
   - or body token if keeping simple.
3. Backend stores session token per participant.
4. Backend validates:
   - participant exists;
   - token matches participant;
   - participant belongs to room.
5. Wire `JoinRoomDialog` into the room flow or remove it to avoid dead code.
6. Let user pick display name before joining.

Acceptance criteria:

- Two browsers can join with different names.
- Each sees itself highlighted.
- One participant cannot submit as another participant by changing body ID.

### Finding 7: Replay Language Conflicts With TxLINE-First Strategy

Severity: medium

Problem:

- Code and docs still contain replay terminology.
- Runtime controls `play`, `pause`, and `setSpeed` are no-ops.
- For this hackathon strategy, "local demo" should not be the main narrative.

Current locations:

- `src/replay/initial-state.ts`
- `src/runtime/use-room-runtime.ts`
- `README.md`
- older planning docs

Implementation:

1. Keep initial loading state if useful, but rename frontend-facing concepts:
   - "Replay" -> "TxLINE evidence playback" only if based on captured real TxLINE records.
   - "Demo local" -> avoid in user-facing docs.
2. Remove no-op controls from visible UI unless implemented.
3. If controlled video flow is needed, use captured TxLINE payloads from `.txline/captures`, not invented events.

Acceptance criteria:

- Main user flow and README are TxLINE-first.
- No visible primary UI suggests mocked local simulation.
- Judge-facing docs can still mention captured real TxLINE records for reproducible review.

## 6. Recommended Product Shape For Winning

### 6.1 Main User Flow

1. User opens VIRA.
2. Lobby loads fixtures from TxLINE.
3. User selects a fixture.
4. Preview shows:
   - teams;
   - fixture metadata;
   - available odds markets;
   - suggested first question.
5. User enters room.
6. User chooses display name.
7. Active question appears.
8. User submits answer.
9. Room waits for TxLINE signal.
10. Backend ingests latest odds or stream update.
11. Engine resolves round.
12. Leaderboard, timeline, and market-vs-room update.
13. Judge Mode shows evidence chain.

### 6.2 First Winning Round Type

Use odds threshold.

Example:

> Mercado coloca Espanha acima de 55%?

Source:

- `GET /api/odds/snapshot/{fixtureId}`
- or `GET /api/odds/stream`

Why:

- Observed payloads contain useful odds fields now.
- Scores observed so far do not reliably contain goals/cards/stats.
- Odds make the TxLINE integration obvious and responsive.

### 6.3 Second Round Type

Use market movement.

Example:

> A probabilidade do time da casa sobe no proximo update?

Source:

- previous odds snapshot/update;
- next odds snapshot/update.

Implementation:

- store previous normalized odds value in room;
- compare with next accepted odds event;
- resolve `up`, `down`, or `same`.

Why:

- More original than simple threshold.
- Shows live responsiveness.
- Does not depend on rare goal/card events.

## 7. Backend Implementation Plan

### 7.1 Runtime State Refactor

File:

- `backend/runtime.mjs`

Add room fields:

```js
rounds: matchRounds,
currentRoundId: matchRounds[0].id,
lastLocalSequence: 0,
lastProviderSequenceBySource: {},
participantSessions: new Map(),
marketState: {},
```

Replace direct `room.currentRound` assumptions with helper:

```js
function getCurrentRound(room) {
  return room.rounds.find((round) => round.id === room.currentRoundId) ?? null;
}
```

Snapshot still returns `currentRound` for frontend compatibility.

### 7.2 Participant-Specific Snapshot

File:

- `backend/runtime.mjs`

Modify `publicSnapshot(room, participantId)`:

- compute `currentParticipant`;
- compute participant-specific answer state;
- compute participant-specific `lastResolution`;
- mark current user in participants and leaderboard.

Do not mutate room-global resolution while building snapshot.

### 7.3 Answer Validation

File:

- `backend/runtime.mjs`

In `submitAnswer`:

- verify current round exists;
- verify round is open;
- verify participant exists;
- verify option exists in current round;
- verify token if implemented;
- reject duplicate per `roundId:participantId`;
- server timestamp remains authoritative.

HTTP statuses:

- `400 invalid_option`
- `401 invalid_session`
- `404 participant_not_found`
- `409 duplicate_answer`
- `409 round_not_open`

### 7.4 TxLINE Event Application

File:

- `backend/runtime.mjs`

Split `applyNormalizedEvent` into smaller helpers:

- `prepareRuntimeEvent`
- `shouldIgnoreEvent`
- `applyMatchState`
- `applyMarketState`
- `evaluateCurrentRound`
- `resolveCurrentRound`
- `appendEvidence`
- `emitRuntimeOutputs`

Keep behavior deterministic and easier to test manually.

### 7.5 Market Distribution

File:

- `backend/runtime.mjs`

Add:

```js
function updateMarketDistribution(room, round, event) {
  if (event.type !== "odds_shift") return;
  // read event.payload.PriceNames and event.payload.Pct
  // map values into active round options
}
```

Call this before resolution so the snapshot and Judge Mode show the same market values.

### 7.6 Round Progression

File:

- `backend/runtime.mjs`

Add:

```js
function advanceToNextRound(room, resolvedRoundId) {
  const index = room.rounds.findIndex((round) => round.id === resolvedRoundId);
  const next = room.rounds[index + 1];
  if (!next) return null;
  next.state = "open";
  room.currentRoundId = next.id;
  room.roomDistribution = Object.fromEntries(next.options.map((option) => [option.id, 0]));
  room.marketDistribution = {};
  room.lastResolution = null; // optional after overlay has seen event; see frontend note
  return next;
}
```

Important frontend note:

- If `lastResolution` is cleared immediately, overlay may disappear too fast.
- Preferred: keep `lastResolution`, but snapshot also returns new `currentRound`.
- Frontend should dismiss overlay after timeout while still showing new round behind it.

### 7.7 Server Routes

File:

- `backend/server.mjs`

Keep TxLINE-first behavior:

- `/matches` should require TxLINE credentials.
- `/rooms/:roomId/...` can still require fixture-backed room configuration.

Improve:

- return clear JSON errors for missing credentials and fixture not found;
- add route to fetch current odds and apply it:
  - already exists: `POST /rooms/:roomId/txline/ingest-odds`;
  - extend response with accepted/ignored status and evidence summary.

Potential addition:

```http
POST /rooms/:roomId/txline/ingest-latest
```

This can choose best available source:

1. odds updates;
2. odds snapshot;
3. score updates;
4. score snapshot.

## 8. Frontend Implementation Plan

### 8.1 Runtime Hook

File:

- `src/runtime/use-room-runtime.ts`

Changes:

- Store `sessionToken` in localStorage alongside `participantId`.
- Submit token with answer.
- Remove or hide no-op `play`, `pause`, and `setSpeed`.
- Handle `409 duplicate_answer` gracefully:
  - fetch latest state;
  - show submitted/locked state rather than crashing silently.
- Make `stateFromSnapshot` depend on participant-specific resolution returned by backend.

### 8.2 API Client

File:

- `src/runtime/api.ts`

Changes:

- Include session token in `submitRoomAnswer`.
- Add typed response for answer errors if needed.
- Add endpoint wrapper:
  - `ingestLatestTxlineSignal(roomId, fixtureId)`
- Make stream status types include ignored messages and last evidence ID if backend returns it.

### 8.3 Join Experience

Files:

- `src/features/lobby/JoinRoomDialog.tsx`
- `src/features/match-preview/MatchPreviewScreen.tsx`
- `src/features/match-room/MatchRoomScreen.tsx`
- `src/runtime/use-room-runtime.ts`

Options:

1. Lightweight:
   - Show join dialog when entering match room and no local participant exists.
   - Pass chosen display name into `useRoomRuntime`.
2. Faster:
   - Prompt for name in preview before navigating to room.

Recommended:

- Use join dialog inside match room.
- Do not join automatically as `Renan`.

### 8.4 Match Room UX

Files:

- `src/features/match-room/PredictionCard.tsx`
- `src/features/match-room/ResolutionOverlay.tsx`
- `src/features/match-room/MarketVsRoom.tsx`
- `src/features/match-room/LiveField.tsx`

Changes:

- Show clear state:
  - "Palpite registrado"
  - "Aguardando sinal TxLINE"
  - "Mercado atualizado"
  - "Rodada resolvida"
- Market vs Room:
  - label which bar is TxLINE market and which bar is room;
  - show unavailable state if no market data yet.
- Resolution overlay:
  - use participant-specific result;
  - show winning option;
  - show points awarded;
  - avoid implying betting payout.

### 8.5 Judge Mode

File:

- `src/features/inspector/InspectorPanel.tsx`

Current structure is strong. Improve:

- Show ignored/stale sequence reasons.
- Show endpoint family:
  - odds snapshot;
  - odds updates;
  - odds stream;
  - scores stream.
- Show raw percent values and mapped option values.
- Add button:
  - "Aplicar ultimo sinal TxLINE"
  - this should call backend ingestion and refresh room state.

## 9. Documentation Plan

### 9.1 README

Update `README.md` before submission:

- Replace any "scripted mockup" language with TxLINE-first wording.
- Keep "not a mockup" statement.
- Add "How judges can test".
- Add endpoint list.
- Add known limitations:
  - score event richness depends on current TxLINE fixture payloads;
  - VIRA currently prioritizes odds-driven predictions because observed odds payloads are richer.

### 9.2 Submission Technical Doc

Create or update:

- `docs/SUBMISSION_TECHNICAL_OVERVIEW.md`

Sections:

1. Product idea.
2. User flow.
3. Architecture.
4. TxLINE endpoints used.
5. Normalization model.
6. Evidence chain.
7. What is live.
8. Limitations.
9. API feedback.

### 9.3 API Feedback

Use content from `docs/TXLINE_PAYLOAD_INSPECTION.md`.

Feedback summary:

- What worked well:
  - unified fixture/odds schema;
  - odds `Pct` and `PriceNames` are easy to map to consumer predictions;
  - SSE approach fits live fan UX.
- Friction:
  - score payloads observed so far contain limited action richness;
  - lineup/player/stat categories are not available or not populated in observed fixtures;
  - validation proof integration needs clearer product-level examples.

## 10. Testing Plan

No formal test runner currently exists in `package.json`.

Recommended minimum before submission:

### 10.1 Backend Manual Tests

Use small Node scripts or HTTP calls.

Cases:

1. Join room.
2. Submit answer.
3. Duplicate answer returns `409`.
4. Invalid option returns `400`.
5. Correct odds event resolves round.
6. Wrong answer shows failure.
7. Correct answer shows success.
8. Duplicate event ID does not double-score.
9. Stale provider sequence is ignored.
10. Next round opens after resolution.

### 10.2 Frontend Manual Tests

Cases:

1. Lobby loads fixtures.
2. Preview loads TxLINE context.
3. Room prompts for display name.
4. Answer button locks after submit.
5. TxLINE ingestion resolves round.
6. Resolution overlay is correct.
7. Leaderboard updates.
8. Market vs Room updates.
9. Judge Mode shows evidence chain.
10. Two browsers see the same room state.

### 10.3 Build Check

Run:

```powershell
npm run build
```

Optional:

```powershell
npm run backend:dev
npm run dev
```

Then test with two browser sessions.

## 11. Development Order

### Phase 1: Runtime Correctness

1. Participant-specific resolution.
2. Answer validation.
3. Event idempotency and stale sequence checks.
4. Market distribution from odds.
5. Round progression.

Exit criteria:

- One user can join, answer, get resolved correctly, and move to next round.

### Phase 2: TxLINE Signal Quality

1. Improve odds market selection.
2. Add market movement round.
3. Improve `/txline/ingest-odds` response.
4. Add optional `/txline/ingest-latest`.

Exit criteria:

- Product can resolve at least two distinct odds-driven rounds from real TxLINE payloads.

### Phase 3: UX Polish

1. Wire display name dialog.
2. Improve prediction card states.
3. Improve market vs room labels.
4. Improve resolution overlay.
5. Remove visible no-op replay controls if any.

Exit criteria:

- A non-technical fan can understand the room without Judge Mode.

### Phase 4: Judge Mode And Docs

1. Add sequence warning display.
2. Show market mapping details.
3. Add submission technical overview.
4. Update README.
5. Add API feedback section.

Exit criteria:

- A judge can understand exactly how TxLINE powered the resolution.

### Phase 5: Deploy And Video

1. Deploy backend.
2. Deploy frontend.
3. Verify env variables.
4. Record 3.5 to 4.5 minute video.
5. Submit global and Brazil listings.

## 12. Video Script

Target length: under 5 minutes.

### 0:00 - 0:25 Problem

Fans watch World Cup matches with phones in hand, but live data is usually passive. VIRA turns live match and odds signals into a game between friends.

### 0:25 - 0:55 TxLINE Fixture Lobby

Show:

- fixtures loaded from TxLINE;
- fixture card;
- preview button.

Say:

- "These are TxLINE fixtures, not hardcoded matches."

### 0:55 - 1:30 Match Preview

Show:

- teams;
- available odds markets;
- suggested first prediction.

Say:

- "VIRA reads TxLINE odds and generates a fan-readable question."

### 1:30 - 2:20 Fan Room

Show:

- enter room;
- choose name;
- answer prediction;
- leaderboard.

Say:

- "The answer is timestamped by the backend and can only be submitted once."

### 2:20 - 3:10 TxLINE Resolution

Show:

- click "fetch latest TxLINE signal" or stream update;
- round resolves;
- points awarded;
- leaderboard updates;
- market vs room updates.

Say:

- "The engine resolves from TxLINE data, not from a scripted command."

### 3:10 - 4:20 Judge Mode

Show:

- endpoint;
- raw payload hash;
- normalized event;
- rule evaluation;
- winning option;
- score outputs;
- SSE client count.

Say:

- "This is the evidence chain from TxLINE input to product output."

### 4:20 - 4:50 Closing

Say:

- "This pattern scales across all 104 games: fixtures, odds, score events, rooms, and leaderboards."

## 13. Submission Positioning

Use this summary:

> VIRA is a live World Cup room where friends compete on micro-predictions generated and resolved from TxLINE odds and match data. It turns TxLINE's real-time sports feed into a consumer fan experience: answer a short question, wait for the next TxLINE signal, and watch the leaderboard update. Judge Mode exposes the full evidence chain from raw TxLINE payload to normalized event, rule evaluation, and score update.

## 14. Final Definition Of Done

The project is submission-ready when:

- fixtures load from TxLINE;
- preview displays real TxLINE context;
- room join works with user-selected display name;
- answer submission is backend-owned and duplicate-safe;
- at least one odds-driven round resolves from TxLINE payload;
- a second round opens after resolution;
- correct and incorrect user results display accurately;
- leaderboard updates exactly once per accepted event;
- market vs room uses real odds values;
- Judge Mode shows endpoint, payload hash, normalized event, rule, resolution, and outputs;
- stale/duplicate events are ignored;
- README is submission-ready;
- deployed app works;
- video shows the full flow in under 5 minutes.

