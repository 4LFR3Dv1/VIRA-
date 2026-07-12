import { canonicalJson, projectionHash, sha256Hex } from "./event-codec.mjs";

export const VERIFIED_ROUND_REPLAY_SCHEMA_VERSION = 1;
export const VERIFIED_ROUND_REPLAY_DOMAIN = "VIRA:VERIFIED_ROUND_REPLAY:V1";
export const VERIFIED_FOOTBALL_REPLAY_DOMAIN = "VIRA:VERIFIED_ROUND_REPLAY:V2";

const AUTHORITATIVE_ORIGINS = new Set([
  "txline_live_stream",
  "txline_snapshot",
  "verified_playback",
]);

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function iso(value, fallback = null) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function eventPayload(event) {
  return event?.payload && typeof event.payload === "object" ? event.payload : {};
}

function probabilityFor(round, observation) {
  const predicate = round?.resolution?.predicate ?? {};
  const payload = observation?.payload ?? {};
  const names = Array.isArray(payload.PriceNames) ? payload.PriceNames.map((name) => String(name).toLowerCase()) : [];
  const values = Array.isArray(payload.Pct) ? payload.Pct : [];
  const priceName = String(predicate.priceName ?? (predicate.side === "away" ? "part2" : predicate.side === "draw" ? "draw" : "part1")).toLowerCase();
  const index = names.indexOf(priceName);
  return index >= 0 ? asNumber(values[index]) : null;
}

function normalizedOrigin(resolvedPayload, acceptedPayload) {
  return String(
    acceptedPayload?.acquisitionOrigin
      ?? acceptedPayload?.event?.acquisitionOrigin
      ?? resolvedPayload?.event?.acquisitionOrigin
      ?? "unknown",
  );
}

function publicLeaderboard(rows) {
  return [...rows.values()]
    .sort((left, right) => right.points - left.points || right.streak - left.streak || left.participantKey.localeCompare(right.participantKey))
    .map((entry, index) => ({
      participantKey: entry.participantKey,
      points: entry.points,
      streak: entry.streak,
      rank: index + 1,
    }));
}

function participantKey(participantId) {
  return sha256Hex(`VIRA:PARTICIPANT:V1|${String(participantId)}`);
}

function applyResolutionToLeaderboard(leaderboard, payload) {
  const awards = Array.isArray(payload.awards) ? payload.awards : [];
  for (const entry of leaderboard.values()) {
    const award = awards.find((item) => String(item?.participantId) === entry.participantId);
    const points = asNumber(award?.points) ?? 0;
    entry.points += points;
    entry.streak = points > 0 ? entry.streak + 1 : 0;
  }
}

function deriveLeaderboardHashes(events, resolvedEvent) {
  const leaderboard = new Map();
  for (const event of events) {
    if (event.streamVersion > resolvedEvent.streamVersion) break;
    const payload = eventPayload(event);
    if (event.type === "participant.joined" && payload.participant?.id) {
      const id = String(payload.participant.id);
      leaderboard.set(id, { participantId: id, participantKey: participantKey(id), points: 0, streak: 0 });
    }
    if (event.type === "round.resolved") {
      if (event.eventId === resolvedEvent.eventId) {
        const before = publicLeaderboard(leaderboard);
        applyResolutionToLeaderboard(leaderboard, payload);
        return {
          before: projectionHash(before),
          after: projectionHash(publicLeaderboard(leaderboard)),
        };
      }
      applyResolutionToLeaderboard(leaderboard, payload);
    }
  }
  return { before: projectionHash([]), after: projectionHash([]) };
}

function eligibilityChecks(round, resolutionObservation, providerSequence) {
  const predicate = round?.resolution?.predicate ?? {};
  const payload = resolutionObservation?.payload ?? {};
  const checks = {
    differentFromOpening: !predicate.openedFromEventId || String(resolutionObservation?.id) !== String(predicate.openedFromEventId),
    minimumProviderSequence: !Number.isFinite(Number(predicate.minimumProviderSequence)) || providerSequence === null || providerSequence >= Number(predicate.minimumProviderSequence),
    market: !predicate.market || payload.SuperOddsType === predicate.market,
    line: predicate.line === undefined || predicate.line === null || payload.MarketParameters === predicate.line,
    period: predicate.period === undefined || predicate.period === null || payload.MarketPeriod === predicate.period,
    priceName: probabilityFor(round, resolutionObservation) !== null,
  };
  return { checks, valid: Object.values(checks).every(Boolean) };
}

function predicateFor(round, observedValue) {
  const predicate = round?.resolution?.predicate ?? {};
  const openingValue = asNumber(predicate.openingValue);
  const targetValue = asNumber(predicate.pctGte ?? predicate.openingValue) ?? 0;
  const direction = predicate.direction === "up";
  const operator = direction ? ">" : ">=";
  const expectedValue = direction && openingValue !== null ? openingValue : targetValue;
  const result = observedValue !== null && (direction ? observedValue > expectedValue : observedValue >= expectedValue);
  return { operator, expectedValue, result, expression: `${observedValue ?? "n/a"} ${operator} ${expectedValue}` };
}

export function canonicalVerifiedRoundReplay(replay) {
  const { replayHash: _replayHash, ...hashable } = replay;
  return canonicalJson(hashable);
}

export function hashVerifiedRoundReplay(replay) {
  return sha256Hex(canonicalVerifiedRoundReplay(replay));
}

export function deriveVerifiedRoundReplay(events, roundId, verification) {
  const ordered = [...events].sort((left, right) => Number(left.streamVersion) - Number(right.streamVersion));
  const openedEvent = ordered.find((event) => event.type === "round.opened" && String(eventPayload(event).round?.id) === String(roundId));
  const resolvedEvent = ordered.find((event) => event.type === "round.resolved" && String(eventPayload(event).roundId) === String(roundId));
  if (!openedEvent) throw Object.assign(new Error("round_replay_open_event_not_found"), { status: 404 });
  if (!resolvedEvent) throw Object.assign(new Error("round_replay_not_resolved"), { status: 409 });

  const openedPayload = eventPayload(openedEvent);
  const resolvedPayload = eventPayload(resolvedEvent);
  const round = openedPayload.round ?? {};
  const lockEvent = ordered.find((event) => event.type === "round.locked" && String(eventPayload(event).roundId) === String(roundId));
  if (!lockEvent) throw Object.assign(new Error("round_replay_lock_event_not_found"), { status: 409 });
  const lockPayload = eventPayload(lockEvent);
  const answers = ordered.filter((event) => event.type === "answer.submitted" && String(eventPayload(event).answer?.roundId) === String(roundId) && event.streamVersion < lockEvent.streamVersion);
  const distribution = {};
  for (const answerEvent of answers) {
    const optionId = String(eventPayload(answerEvent).answer?.optionId ?? "unknown");
    distribution[optionId] = (distribution[optionId] ?? 0) + 1;
  }

  const lockedRound = lockPayload.round ?? round;
  if (lockedRound.resolution?.domain === "football") {
    const condition = lockedRound.resolution.condition ?? {};
    const resolutionObservation = resolvedPayload.event ?? {};
    const acceptedEvent = ordered.find((event) => event.type === "txline.event.accepted" && String(eventPayload(event).providerEventId) === String(resolutionObservation.id ?? resolvedPayload.causedByTxlineEventId ?? ""));
    const origin = normalizedOrigin(resolvedPayload, eventPayload(acceptedEvent));
    const authorityValid = AUTHORITATIVE_ORIGINS.has(origin) && verification?.authorityValid !== false;
    const lockedAt = iso(lockPayload.lockedAt, lockEvent.createdAt);
    const timingValid = answers.every((event) => Date.parse(event.createdAt) <= Date.parse(lockedAt));
    const leaderboardHashes = deriveLeaderboardHashes(ordered, resolvedEvent);
    const opening = condition.openingObservation ?? {};
    const targetSide = condition.targetSide === "away" ? "away" : "home";
    const openingTargetScore = asNumber(targetSide === "home" ? opening.homeScore : opening.awayScore) ?? 0;
    const finalHomeScore = asNumber(resolutionObservation.absoluteScore?.home);
    const finalAwayScore = asNumber(resolutionObservation.absoluteScore?.away);
    const finalTargetScore = targetSide === "home" ? finalHomeScore : finalAwayScore;
    const observedClock = asNumber(resolutionObservation.matchClockSec) ?? 0;
    const endClock = asNumber(condition.endsAtClockSec) ?? 0;
    const conditionMet = finalTargetScore !== null && finalTargetScore > openingTargetScore && observedClock <= endClock;
    const winningOptionId = String(resolvedPayload.winningOptionId ?? (conditionMet ? "yes" : "no"));
    const deterministicWinner = conditionMet ? "yes" : observedClock >= endClock ? "no" : null;
    const replay = {
      domain: VERIFIED_FOOTBALL_REPLAY_DOMAIN,
      schemaVersion: 2,
      resolutionDomain: "football",
      roomId: String(openedEvent.streamId ?? openedEvent.roomId),
      roundId: String(roundId),
      roundVersion: asNumber(lockedRound.version) ?? 1,
      prompt: {
        text: String(lockedRound.title ?? round.title ?? ""),
        operator: "score_increase",
        targetValue: null,
        priceName: targetSide,
        marketSignature: "football:team_scores",
      },
      condition,
      opening: {
        eventId: opening.eventId ? String(opening.eventId) : null,
        providerSequence: asNumber(opening.providerSequence),
        value: null,
        score: { home: asNumber(opening.homeScore) ?? 0, away: asNumber(opening.awayScore) ?? 0 },
        matchClockSec: asNumber(opening.matchClockSec) ?? 0,
        observedAt: iso(opening.observedAt, lockedAt),
        acquisitionOrigin: "txline_snapshot",
      },
      participation: { confirmedAnswers: answers.length, distributionVisible: true, distribution },
      lock: { lockedAt, reason: "deadline", causedByEventId: lockEvent.causationId ? String(lockEvent.causationId) : null, temporalIntegrityValid: timingValid },
      resolution: {
        eventId: String(resolutionObservation.id ?? resolvedEvent.eventId),
        providerSequence: asNumber(resolutionObservation.providerSequence ?? resolutionObservation.payload?.Seq),
        observedValue: null,
        score: { home: finalHomeScore ?? 0, away: finalAwayScore ?? 0 },
        matchClockSec: observedClock,
        winningOptionId,
        reason: String(resolvedPayload.resolutionReason ?? (conditionMet ? "condition_confirmed" : "window_expired")),
        expression: conditionMet
          ? `${targetSide}Score ${finalTargetScore} > openingScore ${openingTargetScore} before ${endClock}`
          : `${targetSide}Score ${finalTargetScore} == openingScore ${openingTargetScore} at ${observedClock}`,
        predicateResult: conditionMet,
        resolvedAt: iso(resolutionObservation.receivedAt ?? resolutionObservation.occurredAt, resolvedEvent.createdAt),
        acquisitionOrigin: origin,
      },
      scoring: {
        answersEvaluated: asNumber(resolvedPayload.answersEvaluated) ?? answers.length,
        answersCorrect: asNumber(resolvedPayload.answersCorrect) ?? 0,
        totalPointsApplied: asNumber(resolvedPayload.totalPointsApplied) ?? 0,
        leaderboardBeforeHash: leaderboardHashes.before,
        leaderboardAfterHash: leaderboardHashes.after,
      },
      proof: {
        firstStreamVersion: Number(openedEvent.streamVersion), lastStreamVersion: Number(resolvedEvent.streamVersion), roundEventRangeHash: String(resolvedEvent.eventHash),
        hashChainValid: verification?.hashChainValid === true, projectionMatches: verification?.projectionMatches === true, rankingMatches: verification?.rankingMatches === true,
        authorityValid, temporalIntegrityValid: timingValid,
        eligibilityValid: finalHomeScore !== null && finalAwayScore !== null && observedClock >= Number(condition.startsAtClockSec ?? 0),
        determinismValid: deterministicWinner === winningOptionId,
      },
      technical: {
        openingStreamVersion: Number(openedEvent.streamVersion), lockStreamVersion: Number(lockEvent.streamVersion), resolutionStreamVersion: Number(resolvedEvent.streamVersion),
        marketType: null, line: null, period: null, minimumProviderSequence: null,
        eligibilityChecks: { authoritativeScore: finalHomeScore !== null && finalAwayScore !== null, startsAfterLock: observedClock >= Number(condition.startsAtClockSec ?? 0), withinResolutionPolicy: deterministicWinner !== null },
        causationId: resolvedEvent.causationId ?? null, correlationId: resolvedEvent.correlationId ?? null,
        openingEventHash: String(openedEvent.eventHash), lockEventHash: String(lockEvent.eventHash), resolutionEventHash: String(resolvedEvent.eventHash),
      },
    };
    return { ...replay, replayHash: hashVerifiedRoundReplay(replay) };
  }

  const resolutionObservation = resolvedPayload.event ?? {};
  const providerEventId = String(resolvedPayload.causedByTxlineEventId ?? resolutionObservation.id ?? "");
  const acceptedEvent = ordered.find((event) => event.type === "txline.event.accepted" && String(eventPayload(event).providerEventId) === providerEventId);
  const acceptedPayload = eventPayload(acceptedEvent);
  const providerSequence = asNumber(acceptedPayload.providerSequence ?? resolutionObservation.providerSequence ?? resolutionObservation.payload?.Seq);
  const observedValue = probabilityFor(round, resolutionObservation);
  const predicate = predicateFor(round, observedValue);
  const eligibility = eligibilityChecks(round, resolutionObservation, providerSequence);
  const origin = normalizedOrigin(resolvedPayload, acceptedPayload);
  const authorityValid = AUTHORITATIVE_ORIGINS.has(origin) && verification?.authorityValid !== false;
  const lockedAt = iso(lockPayload.lockedAt, lockEvent.createdAt);
  const timingValid = answers.every((event) => Date.parse(event.createdAt) <= Date.parse(lockedAt));
  const leaderboardHashes = deriveLeaderboardHashes(ordered, resolvedEvent);
  const answersCorrect = asNumber(resolvedPayload.answersCorrect) ?? 0;
  const answersEvaluated = asNumber(resolvedPayload.answersEvaluated) ?? answers.length;

  const replay = {
    domain: VERIFIED_ROUND_REPLAY_DOMAIN,
    schemaVersion: VERIFIED_ROUND_REPLAY_SCHEMA_VERSION,
    roomId: String(openedEvent.streamId ?? openedEvent.roomId),
    roundId: String(roundId),
    roundVersion: asNumber(round.version) ?? 1,
    prompt: {
      text: String(round.title ?? ""),
      operator: predicate.operator,
      targetValue: predicate.expectedValue,
      priceName: String(round.resolution?.predicate?.priceName ?? round.resolution?.predicate?.side ?? "unknown"),
      marketSignature: String(round.resolution?.predicate?.marketSignature ?? round.resolution?.predicate?.market ?? "unknown"),
    },
    opening: {
      eventId: round.resolution?.predicate?.openedFromEventId ? String(round.resolution.predicate.openedFromEventId) : null,
      providerSequence: asNumber(round.resolution?.predicate?.minimumProviderSequence) !== null ? Number(round.resolution.predicate.minimumProviderSequence) - 1 : null,
      value: asNumber(round.resolution?.predicate?.openingValue),
      observedAt: iso(round.openedAt, openedEvent.createdAt),
      acquisitionOrigin: String(round.resolution?.predicate?.openingAcquisitionOrigin ?? "txline_snapshot"),
    },
    participation: {
      confirmedAnswers: answers.length,
      distributionVisible: true,
      distribution,
    },
    lock: {
      lockedAt,
      reason: String(lockPayload.reason ?? "deadline_elapsed").includes("deadline") ? "deadline" : "eligible_signal",
      causedByEventId: lockEvent.causationId ? String(lockEvent.causationId) : null,
      temporalIntegrityValid: timingValid,
    },
    resolution: {
      eventId: providerEventId || String(resolvedEvent.eventId),
      providerSequence,
      observedValue,
      winningOptionId: String(resolvedPayload.winningOptionId ?? (predicate.result ? "yes" : "no")),
      expression: predicate.expression,
      predicateResult: predicate.result,
      resolvedAt: iso(resolutionObservation.receivedAt ?? resolutionObservation.occurredAt, resolvedEvent.createdAt),
      acquisitionOrigin: origin,
    },
    scoring: {
      answersEvaluated,
      answersCorrect,
      totalPointsApplied: asNumber(resolvedPayload.totalPointsApplied) ?? 0,
      leaderboardBeforeHash: leaderboardHashes.before,
      leaderboardAfterHash: leaderboardHashes.after,
    },
    proof: {
      firstStreamVersion: Number(openedEvent.streamVersion),
      lastStreamVersion: Number(resolvedEvent.streamVersion),
      roundEventRangeHash: String(resolvedEvent.eventHash),
      hashChainValid: verification?.hashChainValid === true,
      projectionMatches: verification?.projectionMatches === true,
      rankingMatches: verification?.rankingMatches === true,
      authorityValid,
      temporalIntegrityValid: timingValid,
      eligibilityValid: eligibility.valid,
      determinismValid: String(resolvedPayload.winningOptionId) === (predicate.result ? "yes" : "no"),
    },
    technical: {
      openingStreamVersion: Number(openedEvent.streamVersion),
      lockStreamVersion: Number(lockEvent.streamVersion),
      resolutionStreamVersion: Number(resolvedEvent.streamVersion),
      marketType: round.resolution?.predicate?.market ?? null,
      line: round.resolution?.predicate?.line ?? null,
      period: round.resolution?.predicate?.period ?? null,
      minimumProviderSequence: asNumber(round.resolution?.predicate?.minimumProviderSequence),
      eligibilityChecks: eligibility.checks,
      causationId: resolvedEvent.causationId ?? null,
      correlationId: resolvedEvent.correlationId ?? null,
      openingEventHash: String(openedEvent.eventHash),
      lockEventHash: String(lockEvent.eventHash),
      resolutionEventHash: String(resolvedEvent.eventHash),
    },
  };
  return { ...replay, replayHash: hashVerifiedRoundReplay(replay) };
}
