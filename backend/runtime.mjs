import crypto from "node:crypto";

import { hashStoredEvent, projectionHash, redactInternalEvent } from "./event-codec.mjs";
import { deriveRoundCommitment } from "./round-commitment.mjs";
import { deriveVerifiedRoundReplay } from "./verified-round-replay.mjs";

const nowIso = () => new Date().toISOString();

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function shortId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function sessionTokenHash(token) {
  return `sha256:${crypto.createHash("sha256").update(String(token)).digest("hex")}`;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const matchSeed = {
  id: "unconfigured",
  title: "TxLINE fixture",
  competitionLabel: "TxLINE",
  status: "live",
  homeTeam: { id: "home", name: "Home", shortName: "HOME", flag: "", accent: "#caff28" },
  awayTeam: { id: "away", name: "Away", shortName: "AWAY", flag: "", accent: "#71b9e8" },
  homeScore: 0,
  awayScore: 0,
  matchClockSec: 0,
};

const dynamicFixtureSeeds = new Map();
const dynamicPredictionSeeds = new Map();
const DEFAULT_ROUND_ANSWER_WINDOW_SEC = Math.max(10, Math.min(120, Number(process.env.VIRA_ROUND_ANSWER_WINDOW_SEC) || 30));
const MARKET_ROUNDS_ENABLED = process.env.VIRA_MARKET_ROUNDS_ENABLED === "true" || (process.env.NODE_ENV !== "production" && process.env.VIRA_MARKET_ROUNDS_ENABLED !== "false");
const FOOTBALL_ROUND_COOLDOWN_SEC = Math.max(120, Number(process.env.VIRA_FOOTBALL_ROUND_COOLDOWN_SEC) || 240);
const FOOTBALL_ROUNDS_MAX = Math.max(1, Math.min(12, Number(process.env.VIRA_FOOTBALL_ROUNDS_MAX) || 7));

function emptyMatchStats() {
  const side = () => ({ shots: 0, shotsOnTarget: 0, corners: 0, yellowCards: 0, redCards: 0 });
  return { home: side(), away: side(), reliability: { shots: "unknown", corners: "unknown", cards: "unknown" }, updatedAtClockSec: 0, sourceEventId: null };
}

function openedRound(round, openedAtMs = Date.now()) {
  const durationSec = Math.max(1, Number(round.answerWindowSec) || Number(round.locksAtClockSec) - Number(round.opensAtClockSec) || DEFAULT_ROUND_ANSWER_WINDOW_SEC);
  return {
    ...round,
    answerWindowSec: durationSec,
    locksAtClockSec: Number(round.opensAtClockSec) + durationSec,
    version: Number(round.version) || 1,
    openedAt: round.openedAt ?? new Date(openedAtMs).toISOString(),
    locksAt: round.locksAt ?? new Date(openedAtMs + durationSec * 1_000).toISOString(),
    lockedAt: round.lockedAt ?? null,
    state: round.state === "scheduled" ? "scheduled" : "open",
  };
}

function eventServerTimeMs(event) {
  const value = Date.parse(event?.receivedAt ?? event?.occurredAt ?? "");
  return Number.isFinite(value) ? value : Date.now();
}

function teamFromName(id, name, accent) {
  const safeName = String(name || id);
  return {
    id,
    name: safeName,
    shortName: safeName.slice(0, 3).toUpperCase(),
    flag: safeName.slice(0, 2).toUpperCase(),
    accent,
  };
}

function matchForRoom(roomId) {
  const fixture = dynamicFixtureSeeds.get(roomId);
  if (!fixture) return { ...matchSeed, id: roomId };
  return {
    ...matchSeed,
    id: roomId,
    title: fixture.title,
    competitionLabel: fixture.competitionLabel,
    status: fixture.status ?? matchSeed.status,
    startTime: fixture.startTime ?? null,
    homeScore: Number.isFinite(Number(fixture.homeScore)) ? Number(fixture.homeScore) : matchSeed.homeScore,
    awayScore: Number.isFinite(Number(fixture.awayScore)) ? Number(fixture.awayScore) : matchSeed.awayScore,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
  };
}

function roundSeedsForMatch(match) {
  const footballConditionsEnabled = match.status === "live" && dynamicPredictionSeeds.has(String(match.id));
  if (!footballConditionsEnabled && !MARKET_ROUNDS_ENABLED) return [];
  const seeds = [
    {
      ...roundSeeds[0],
      answerWindowSec: DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      matchId: match.id,
      title: footballConditionsEnabled ? `${match.homeTeam.name} marca nos proximos 10 minutos?` : `${match.homeTeam.name} chega a 55% ou mais no proximo sinal?`,
      contextLabel: footballConditionsEnabled ? "Previsao de jogo · proximos 10 minutos" : "Mercado 1X2 · proximo sinal elegivel",
      resolution: footballConditionsEnabled
        ? { domain: "football", mode: "football_condition", condition: { kind: "team_scores", targetSide: "home", durationSec: 600, state: "awaiting_lock" } }
        : { mode: "first_matching_event", eventType: "odds_shift", predicate: { market: "1X2_PARTICIPANT_RESULT", side: "home", pctGte: 55 } },
    },
    {
      ...roundSeeds[1],
      answerWindowSec: DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      matchId: match.id,
      title: `A probabilidade de ${match.homeTeam.name} sobe no proximo sinal?`,
      contextLabel: "Mercado 1X2 · direcao do proximo sinal",
      options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Nao" }],
      resolution: {
        mode: "first_matching_event",
        eventType: "odds_shift",
        predicate: {
          market: "1X2_PARTICIPANT_RESULT",
          side: "home",
          direction: "up",
        },
      },
    },
    {
      ...roundSeeds[2],
      matchId: match.id,
      title: `${match.homeTeam.name} segura a vantagem ate os 80?`,
    },
  ];
  return footballConditionsEnabled ? seeds.slice(0, 1) : seeds;
}

const roundSeeds = [
  {
    id: "round-1",
    matchId: "bra-arg-demo",
    sequence: 1,
    title: "Sai cartao nos proximos cinco minutos?",
    contextLabel: "Rodada 01 · leitura rapida",
    options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Nao" }],
    opensAtClockSec: 3780,
    locksAtClockSec: 3870,
    state: "open",
    resolution: { mode: "first_matching_event", eventType: "card", windowEndsAtClockSec: 4080, elapsedOptionId: "no" },
  },
  {
    id: "round-2",
    matchId: "bra-arg-demo",
    sequence: 2,
    title: "Quem marca o proximo gol?",
    contextLabel: "Rodada 02 · sala dividida",
    options: [{ id: "bra", label: "Brasil" }, { id: "arg", label: "Argentina" }, { id: "none", label: "Ninguem" }],
    opensAtClockSec: 3975,
    locksAtClockSec: 4040,
    state: "scheduled",
    resolution: { mode: "first_matching_event", eventType: "goal" },
  },
  {
    id: "round-3",
    matchId: "bra-arg-demo",
    sequence: 3,
    title: "Brasil segura a vantagem ate os 80?",
    contextLabel: "Rodada 03 · reta final",
    options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Nao" }],
    opensAtClockSec: 4560,
    locksAtClockSec: 4620,
    state: "scheduled",
    resolution: { mode: "window_elapsed", windowEndsAtClockSec: 4800, elapsedOptionId: "yes" },
  },
];

export function createRoomRuntime({ eventStore = null, commitmentPublisher = null } = {}) {
  const rooms = new Map();
  const clients = new Map();
  const roomLocks = new Map();
  const roundTimers = new Map();
  const pendingCommitments = new Set();
  let nextEventId = 1;
  let nextLocalSequence = 1;

  async function withRoomLock(roomId, operation) {
    const key = String(roomId);
    const previous = roomLocks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const queued = run.catch(() => undefined).finally(() => {
      if (roomLocks.get(key) === queued) roomLocks.delete(key);
    });
    roomLocks.set(key, queued);
    return run;
  }

  function domainEvent(room, type, payload, options = {}) {
    return {
      eventId: options.eventId ?? shortId("evt"),
      roomId: room.roomId,
      type,
      idempotencyKey: options.idempotencyKey ?? `${type}:${room.roomId}:${crypto.randomUUID()}`,
      causationId: options.causationId,
      correlationId: options.correlationId ?? shortId("corr"),
      createdAt: options.createdAt ?? nowIso(),
      schemaVersion: 1,
      payload,
    };
  }

  function initialRoomEvents(room) {
    return [
      domainEvent(room, "room.configured", {
        match: room.match,
        roomLabel: room.roomLabel,
        connectionState: room.connectionState,
      }, {
        idempotencyKey: `room-configured:${room.roomId}`,
      }),
      ...(room.currentRound ? [domainEvent(room, "round.opened", {
        round: room.currentRound,
        timelineEntryId: "timeline-round-1-open",
        timelineMatchClockSec: room.match.matchClockSec,
      }, {
        idempotencyKey: `round-opened:${room.roomId}:${room.currentRound.id}`,
      })] : []),
    ];
  }

  function ensureInitialRoomEvents(room, pendingEvents) {
    if (room.streamVersion > 0) return pendingEvents;
    if (pendingEvents.some((event) => event.type === "room.configured")) return pendingEvents;
    return [...initialRoomEvents(room), ...pendingEvents];
  }

  async function appendDomainEvents(room, pendingEvents) {
    if (!eventStore || !pendingEvents.length) return [];
    const events = ensureInitialRoomEvents(room, pendingEvents);
    const receipt = await eventStore.append({
      streamId: room.roomId,
      expectedStreamVersion: room.streamVersion ?? 0,
      events,
    });
    room.streamVersion = receipt.currentVersion;
    room.ledgerHeadHash = receipt.lastEventHash ?? room.ledgerHeadHash ?? null;
    return receipt.persistedEvents;
  }

  function clearRoundTimer(roomId) {
    const timer = roundTimers.get(String(roomId));
    if (timer) clearTimeout(timer);
    roundTimers.delete(String(roomId));
  }

  async function lockCurrentRound(room, reason, options = {}) {
    const round = room.currentRound;
    if (!round || round.state !== "open") return false;
    const lockedAt = options.lockedAt ?? nowIso();
    const conditionSeed = round.resolution?.condition ?? {};
    const condition = round.resolution?.domain === "football"
      ? {
          ...conditionSeed,
          state: "tracking",
          startsAtClockSec: room.match.matchClockSec,
          endsAtClockSec: room.match.matchClockSec + Number(conditionSeed.durationSec ?? (conditionSeed.kind === "team_shot_on_target" ? 300 : 600)),
          openingObservation: conditionSeed.kind === "team_shot_on_target"
            ? {
                eventId: room.matchStats.sourceEventId,
                providerSequence: room.lastNormalizedEvent?.providerSequence ?? null,
                shotsOnTarget: room.matchStats[conditionSeed.targetSide === "away" ? "away" : "home"].shotsOnTarget,
                matchClockSec: room.match.matchClockSec,
                observedAt: room.lastNormalizedEvent?.occurredAt ?? lockedAt,
              }
            : {
                eventId: room.lastNormalizedEvent?.id ?? null,
                providerSequence: room.lastNormalizedEvent?.providerSequence ?? null,
                homeScore: room.match.homeScore,
                awayScore: room.match.awayScore,
                matchClockSec: room.match.matchClockSec,
                observedAt: room.lastNormalizedEvent?.occurredAt ?? lockedAt,
              },
        }
      : null;
    const lockedRound = {
      ...round,
      state: "locked",
      lockedAt,
      lockReason: reason,
      version: (Number(round.version) || 1) + 1,
      resolution: condition ? { ...round.resolution, condition } : round.resolution,
    };
    const lockEvents = [domainEvent(room, "round.locked", {
      roundId: round.id,
      roundVersion: lockedRound.version,
      lockedAt,
      reason,
      round: lockedRound,
    }, {
      idempotencyKey: `round-locked:${room.roomId}:${round.id}`,
      causationId: options.causationId,
      correlationId: options.correlationId,
    })];
    if (condition) {
      lockEvents.push(domainEvent(room, "football.condition.tracking_started", {
        roundId: round.id,
        condition,
      }, {
        idempotencyKey: `football-condition-tracking:${room.roomId}:${round.id}`,
        causationId: options.causationId,
        correlationId: options.correlationId,
      }));
    }
    await appendDomainEvents(room, lockEvents);
    room.currentRound = lockedRound;
    room.version += 1;
    clearRoundTimer(room.roomId);
    pushTimeline(room, { id: `timeline-${round.id}-locked`, matchClockSec: room.match.matchClockSec, title: "Respostas encerradas", description: "Somente respostas confirmadas antes do fechamento participam do resultado.", tone: "info" });
    emitRoomSnapshot(room.roomId);
    return true;
  }

  function scheduleRoundLock(room) {
    clearRoundTimer(room.roomId);
    const round = room.currentRound;
    if (!round || round.state !== "open" || room.match.status !== "live" || !round.locksAt) return;
    const delay = Math.max(0, Date.parse(round.locksAt) - Date.now());
    const timer = setTimeout(() => {
      void withRoomLock(room.roomId, async () => {
        const current = getRoom(room.roomId).currentRound;
        if (!current || current.id !== round.id || current.state !== "open") return;
        await lockCurrentRound(getRoom(room.roomId), "deadline_elapsed");
      });
    }, Math.min(delay, 2_147_483_647));
    timer.unref?.();
    roundTimers.set(String(room.roomId), timer);
  }

  function defaultRoom(roomId) {
    const match = matchForRoom(roomId);
    const matchRounds = roundSeedsForMatch(match);
    const initialRound = match.status === "finished" || !matchRounds[0] ? null : openedRound({ ...matchRounds[0] });
    const room = {
      roomId,
      roomLabel: `Sala VIRA · ${match.title}`,
      roomPopulation: 0,
      match,
      connectionState: "connecting",
      currentRound: initialRound,
      participants: [],
      answersByRound: initialRound ? { [initialRound.id]: {} } : {},
      answerKeys: new Set(),
      participantSessions: new Map(),
      fanPulseChoices: new Map(),
      leaderboard: [],
      timeline: [
        { id: "timeline-room-started", matchClockSec: match.matchClockSec, title: match.status === "finished" ? "Partida encerrada" : "Sala ativa", description: match.status === "finished" ? "A fixture da TxLINE ja esta encerrada; a sala live permanece somente leitura." : "A sala esta pronta para receber participantes reais.", tone: "info" },
        ...(initialRound ? [{ id: "timeline-round-1-open", matchClockSec: match.matchClockSec, title: "Nova previsao aberta", description: initialRound.title, tone: "info" }] : []),
      ],
      marketDistribution: {},
      roomDistribution: initialRound ? Object.fromEntries(initialRound.options.map((option) => [option.id, 0])) : {},
      version: 1,
      lastSequence: 0,
      appliedEventIds: new Set(),
      appliedScoreActionIds: new Set(),
      consumerEventKeys: new Set(),
      source: undefined,
      lastNormalizedEvent: null,
      lastAuthoritativeScoreObservation: null,
      matchStats: emptyMatchStats(),
      footballActions: new Map(),
      roundHistory: [],
      lastResolution: null,
      latestEvidence: null,
      evidenceHistory: [],
      providerSequences: new Map(),
      sequenceWarnings: [],
      streamVersion: 0,
      ledgerHeadHash: null,
    };
    applySuggestedPrediction(room, dynamicPredictionSeeds.get(roomId));
    return room;
  }

  function getRoom(roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, defaultRoom(roomId));
    return rooms.get(roomId);
  }

  function configureMatch(matchSummary, context = null) {
    const roomId = String(matchSummary?.fixtureId ?? matchSummary?.id ?? "");
    if (!roomId) return;
    dynamicFixtureSeeds.set(roomId, {
      title: String(matchSummary.title ?? `${matchSummary.homeTeam} vs ${matchSummary.awayTeam}`),
      competitionLabel: String(matchSummary.competitionLabel ?? "TxLINE Fixture"),
      status: String(matchSummary.status ?? "live"),
      startTime: matchSummary.startTime ?? null,
      homeScore: Number.isFinite(Number(matchSummary.homeScore)) ? Number(matchSummary.homeScore) : undefined,
      awayScore: Number.isFinite(Number(matchSummary.awayScore)) ? Number(matchSummary.awayScore) : undefined,
      homeTeam: teamFromName("home", matchSummary.homeTeam, "#caff28"),
      awayTeam: teamFromName("away", matchSummary.awayTeam, "#71b9e8"),
    });
    if (context?.suggestedPrediction) dynamicPredictionSeeds.set(roomId, context.suggestedPrediction);

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const updatedMatch = matchForRoom(roomId);
      const updatedRounds = roundSeedsForMatch(updatedMatch);
      const becameFinished = updatedMatch.status === "finished" && room.match.status !== "finished";
      room.match = {
        ...room.match,
        title: updatedMatch.title,
        competitionLabel: updatedMatch.competitionLabel,
        status: becameFinished ? room.match.status : updatedMatch.status,
        startTime: updatedMatch.startTime,
        homeScore: Number.isFinite(Number(updatedMatch.homeScore)) ? Number(updatedMatch.homeScore) : room.match.homeScore,
        awayScore: Number.isFinite(Number(updatedMatch.awayScore)) ? Number(updatedMatch.awayScore) : room.match.awayScore,
        homeTeam: updatedMatch.homeTeam,
        awayTeam: updatedMatch.awayTeam,
      };
      room.roomLabel = `Sala VIRA · ${updatedMatch.title}`;
      if (!becameFinished && room.currentRound && updatedRounds[0] && room.currentRound.id === updatedRounds[0].id && room.currentRound.state !== "resolved") {
        room.currentRound = {
          ...updatedRounds[0],
          resolution: room.currentRound.state === "open" ? updatedRounds[0].resolution : room.currentRound.resolution,
          state: room.currentRound.state,
          version: room.currentRound.version,
          openedAt: room.currentRound.openedAt,
          locksAt: room.currentRound.locksAt,
          lockedAt: room.currentRound.lockedAt,
        };
        room.roomDistribution = {
          ...Object.fromEntries(updatedRounds[0].options.map((option) => [option.id, 0])),
          ...room.roomDistribution,
        };
      }
      room.version += 1;
      applySuggestedPrediction(room, context?.suggestedPrediction);
      emitRoomSnapshot(roomId);
      scheduleRoundLock(room);
      if (becameFinished) {
        const finalClock = Math.max(Number(room.match.matchClockSec) || 0, 90 * 60);
        const lifecycleTimeout = matchSummary.lifecycleResolution === "maximum_live_window_elapsed";
        queueMicrotask(() => void applyNormalizedEvent(roomId, {
          id: `${lifecycleTimeout ? "lifecycle-timeout" : "catalog-match-end"}:${roomId}`,
          matchId: roomId,
          type: "match_end",
          sequence: 0,
          occurredAt: nowIso(),
          matchClockSec: finalClock,
          absoluteScore: { home: room.match.homeScore, away: room.match.awayScore },
          payload: { Status: "finished", authority: lifecycleTimeout ? "vira_lifecycle" : "txline_catalog", lifecycleResolution: matchSummary.lifecycleResolution ?? null },
          source: lifecycleTimeout ? "verified-playback" : "txline-snapshot",
        }, { acquisitionOrigin: lifecycleTimeout ? "verified_playback" : "txline_snapshot" }).catch(() => undefined));
      }
    }
  }

  function applySuggestedPrediction(room, suggestedPrediction) {
    if (!suggestedPrediction || !room.currentRound || room.currentRound.state !== "open") return;
    if (room.match.status === "finished") return;
    if (Object.keys(currentRoundAnswers(room)).length > 0) return;
    if (room.currentRound.resolution?.domain === "football") {
      const suggestedSide = suggestedPrediction?.priceName === "part2" ? "away" : "home";
      const team = suggestedSide === "away" ? room.match.awayTeam : room.match.homeTeam;
      room.currentRound = {
        ...room.currentRound,
        title: `${team.name} marca nos proximos 10 minutos?`,
        resolution: {
          ...room.currentRound.resolution,
          condition: { ...room.currentRound.resolution.condition, targetSide: suggestedSide },
        },
      };
      return;
    }
    const canonicalTitle = `market:${suggestedPrediction.marketType}:${suggestedPrediction.priceName}:gte:${suggestedPrediction.threshold}`;
    room.currentRound = {
      ...room.currentRound,
      title: canonicalTitle,
      contextLabel: `market:${suggestedPrediction.marketType}`,
      resolution: {
        mode: "first_matching_event",
        eventType: "odds_shift",
        predicate: {
          market: suggestedPrediction.marketType,
          side: suggestedPrediction.priceName === "part2" ? "away" : suggestedPrediction.priceName === "draw" ? "draw" : "home",
          pctGte: suggestedPrediction.threshold,
          priceName: suggestedPrediction.priceName,
          line: suggestedPrediction.line,
          period: suggestedPrediction.period,
          openingValue: suggestedPrediction.pct,
          openedFromEventId: suggestedPrediction.openingEventId ?? suggestedPrediction.marketId,
          minimumProviderSequence: Number.isFinite(Number(suggestedPrediction.providerSequence)) && Number(suggestedPrediction.providerSequence) > 0 ? Number(suggestedPrediction.providerSequence) + 1 : undefined,
          marketSignature: suggestedPrediction.marketSignature,
        },
      },
    };
    room.roomDistribution = {
      yes: room.roomDistribution.yes ?? 0,
      no: room.roomDistribution.no ?? 0,
    };
    const latestOpen = room.timeline.find((item) => item.id === "timeline-round-1-open");
    if (latestOpen) latestOpen.description = canonicalTitle;
  }

  function emit(roomId, event, data) {
    const id = nextEventId++;
    const roomClients = clients.get(roomId) ?? new Map();
    for (const response of roomClients.keys()) {
      response.write(`id: ${id}\n`);
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    return { eventId: String(id), clientCount: roomClients.size };
  }

  function emitRoomSnapshot(roomId) {
    const id = nextEventId++;
    const roomClients = clients.get(roomId) ?? new Map();
    for (const [response] of roomClients.entries()) {
      response.write(`id: ${id}\n`);
      response.write("event: room.snapshot\n");
      response.write(`data: ${JSON.stringify(snapshot(roomId, null))}\n\n`);
    }
    return { eventId: String(id), clientCount: roomClients.size };
  }

  function currentRoundAnswers(room) {
    if (!room.currentRound) return {};
    room.answersByRound[room.currentRound.id] ??= {};
    return room.answersByRound[room.currentRound.id];
  }

  function marketSignatureFromPayload(payload = {}) {
    const priceNames = Array.isArray(payload.PriceNames) ? payload.PriceNames.map(String).join("/") : "";
    return [
      payload.FixtureId ?? "",
      payload.SuperOddsType ?? "UNKNOWN_MARKET",
      payload.MarketParameters ?? "default",
      payload.MarketPeriod ?? "match",
      priceNames,
      payload.BookmakerId ?? payload.Bookmaker ?? "TxLINE",
    ].join("|");
  }

  function probabilityMapFromPayload(payload = {}) {
    const names = Array.isArray(payload.PriceNames) ? payload.PriceNames.map((name) => String(name).toLowerCase()) : [];
    const values = Array.isArray(payload.Pct) ? payload.Pct : [];
    return Object.fromEntries(names.map((name, index) => [name, Number(values[index])]).filter(([, value]) => Number.isFinite(value)));
  }

  function eventProviderSequenceKey(event) {
    const payload = event.payload ?? {};
    if (event.type === "odds_shift") return `odds:${marketSignatureFromPayload(payload)}`;
    return `${event.source ?? "txline"}:scores:${payload.FixtureId ?? event.matchId ?? "fixture"}`;
  }

  function deriveParticipantResolution(room, participantId) {
    if (!room.lastResolution) return null;
    if (!participantId) return null;
    const answers = room.answersByRound[room.lastResolution.roundId] ?? {};
    const answer = answers[participantId] ?? null;
    const scoreOutput = room.lastResolution.scoreOutputs?.find((output) => output.participantId === participantId);
    const leaderboardEntry = room.leaderboard.find((entry) => entry.participantId === participantId);
    const rankLabel = leaderboardEntry ? `${leaderboardEntry.rank}o lugar` : "ranking atualizado";
    return {
      ...room.lastResolution,
      wasCurrentUserCorrect: Boolean(answer && answer.optionId === room.lastResolution.winningOptionId),
      pointsAwarded: scoreOutput?.delta ?? 0,
      streakAfterResolve: leaderboardEntry?.streak ?? 0,
      movementLabel: rankLabel,
    };
  }

  function publicSnapshot(room, participantId = null) {
    const currentParticipant = participantId
      ? room.participants.find((participant) => participant.id === participantId) ?? null
      : null;
    const currentAnswer = participantId ? currentRoundAnswers(room)[participantId] ?? null : null;
    const roundClosed = Boolean(room.currentRound && ["locked", "resolved", "expired"].includes(room.currentRound.state));
    const totalAnswers = Object.keys(currentRoundAnswers(room)).length;
    const fanPulseHome = [...room.fanPulseChoices.values()].filter((side) => side === "home").length;
    const fanPulseAway = [...room.fanPulseChoices.values()].filter((side) => side === "away").length;
    return {
      serverTime: new Date().toISOString(),
      roomId: room.roomId,
      roomLabel: room.roomLabel,
      roomPopulation: room.participants.length,
      match: room.match,
      matchStats: cloneJson(room.matchStats),
      connectionState: room.connectionState,
      currentRound: room.currentRound,
      currentParticipant,
      participants: room.participants.map((participant) => ({
        ...participant,
        isCurrentUser: participant.id === participantId,
      })),
      answers: currentAnswer ? { [participantId]: currentAnswer } : {},
      currentParticipantAnswer: currentAnswer,
      answerSummary: { total: totalAnswers, ...(roundClosed ? { byOption: { ...room.roomDistribution } } : {}) },
      fanPulse: {
        total: fanPulseHome + fanPulseAway,
        byTeam: { home: fanPulseHome, away: fanPulseAway },
        currentParticipantChoice: participantId ? room.fanPulseChoices.get(participantId) ?? null : null,
      },
      leaderboard: room.leaderboard.map((entry) => ({
        ...entry,
        isCurrentUser: entry.participantId === participantId,
      })),
      timeline: room.timeline,
      marketDistribution: room.marketDistribution,
      roomDistribution: roundClosed ? { ...room.roomDistribution } : {},
      version: room.version,
      lastSequence: room.lastSequence,
      source: room.source,
      lastNormalizedEvent: room.lastNormalizedEvent,
      lastResolution: deriveParticipantResolution(room, participantId),
      latestEvidence: room.latestEvidence,
      evidenceHistory: room.evidenceHistory,
      ledger: {
        streamVersion: room.streamVersion ?? 0,
        headHash: room.ledgerHeadHash ?? null,
      },
    };
  }

  function snapshot(roomId, participantId = null) {
    return publicSnapshot(getRoom(roomId), participantId);
  }

  function authenticatedSnapshot(roomId, participantId, sessionToken) {
    const validation = validateSession(roomId, participantId, sessionToken);
    if (!validation.valid) {
      const error = new Error("invalid_session");
      error.status = 401;
      throw error;
    }
    return publicSnapshot(getRoom(roomId), participantId);
  }

  function rankLeaderboard(entries) {
    const previous = new Map(entries.map((entry) => [entry.participantId, entry.rank]));
    return [...entries]
      .sort((left, right) => right.points - left.points || right.streak - left.streak || left.displayName.localeCompare(right.displayName))
      .map((entry, index) => {
        const rank = index + 1;
        const previousRank = previous.get(entry.participantId) ?? rank;
        return {
          ...entry,
          rank,
          movement: previousRank > rank ? "up" : previousRank < rank ? "down" : "steady",
        };
      });
  }

  async function join(roomId, displayName, admissionToken = null) {
    return withRoomLock(roomId, async () => {
      const room = getRoom(roomId);
      const safeName = String(displayName || "Fan").trim().slice(0, 40) || "Fan";
      const suppliedToken = typeof admissionToken === "string" && admissionToken.length >= 16 ? admissionToken : null;
      const sessionToken = suppliedToken ?? crypto.randomUUID();
      const tokenHash = sessionTokenHash(sessionToken);
      const existingParticipant = room.participants.find((item) => room.participantSessions.get(item.id) === tokenHash);
      if (existingParticipant) {
        return { participant: existingParticipant, sessionToken, roomVersion: room.version, reused: true };
      }
      const participant = {
        id: suppliedToken
          ? `participant-${crypto.createHash("sha256").update(`${roomId}:${suppliedToken}`).digest("hex").slice(0, 24)}`
          : `participant-${crypto.randomUUID()}`,
        displayName: safeName,
        initials: safeName.slice(0, 1).toUpperCase(),
        accent: "bg-primary",
        joinedAt: nowIso(),
      };
      const initialEvents = room.streamVersion === 0
        ? [
            domainEvent(room, "room.configured", {
              match: room.match,
              roomLabel: room.roomLabel,
              connectionState: room.connectionState,
            }, {
              idempotencyKey: `room-configured:${room.roomId}`,
            }),
            ...(room.currentRound ? [domainEvent(room, "round.opened", {
              round: room.currentRound,
              timelineEntryId: "timeline-round-1-open",
              timelineMatchClockSec: room.match.matchClockSec,
            }, {
              idempotencyKey: `round-opened:${room.roomId}:${room.currentRound.id}`,
            })] : []),
          ]
        : [];
      await appendDomainEvents(room, [
        ...initialEvents,
        domainEvent(room, "participant.joined", {
          participant,
          sessionTokenHash: tokenHash,
        }, {
          idempotencyKey: `participant:${room.roomId}:${participant.id}`,
        }),
      ]);
      room.participants.push(participant);
      room.participantSessions.set(participant.id, tokenHash);
      room.leaderboard.push({ participantId: participant.id, displayName: participant.displayName, points: 0, rank: room.leaderboard.length + 1, streak: 0, movement: "steady", delta: 0 });
      room.leaderboard = rankLeaderboard(room.leaderboard);
      room.version += 1;
      emit(roomId, "participant.joined", { participant, version: room.version });
      emitRoomSnapshot(roomId);
      return { participant, sessionToken, roomVersion: room.version, reused: false };
    });
  }

  function validateSession(roomId, participantId, sessionToken) {
    const room = getRoom(roomId);
    const valid = Boolean(sessionToken) && room.participantSessions.get(participantId) === sessionTokenHash(sessionToken);
    return {
      valid,
      participant: valid ? room.participants.find((item) => item.id === participantId) ?? null : null,
      roomVersion: room.version,
    };
  }

  async function submitAnswer(roomId, roundId, participantId, optionId, clientAnswerId, roundVersion, sessionToken) {
    return withRoomLock(roomId, async () => {
      const room = getRoom(roomId);
      if (!room.currentRound || room.currentRound.id !== roundId || room.currentRound.state !== "open") {
        const error = new Error("round_not_open");
        error.status = 409;
        throw error;
      }
      if (!room.participants.some((participant) => participant.id === participantId)) {
        const error = new Error("participant_not_found");
        error.status = 404;
        throw error;
      }
      if (!sessionToken || room.participantSessions.get(participantId) !== sessionTokenHash(sessionToken)) {
        const error = new Error("invalid_session");
        error.status = 401;
        throw error;
      }
      if (room.match.status !== "live") {
        const error = new Error("match_not_live");
        error.status = 409;
        throw error;
      }
      if (Number(roundVersion) !== Number(room.currentRound.version)) {
        const error = new Error("stale_round_version");
        error.status = 409;
        error.body = { expected: room.currentRound.version, received: roundVersion };
        throw error;
      }
      if (!room.currentRound.locksAt || Date.now() >= Date.parse(room.currentRound.locksAt)) {
        await lockCurrentRound(room, "deadline_elapsed");
        const error = new Error("round_locked");
        error.status = 409;
        throw error;
      }
      if (!room.currentRound.options.some((option) => option.id === optionId)) {
        const error = new Error("invalid_option");
        error.status = 400;
        throw error;
      }
      const existingKey = `${roundId}:${participantId}`;
      if (room.answerKeys.has(existingKey)) {
        const error = new Error("duplicate_answer");
        error.status = 409;
        throw error;
      }

      const answer = {
        id: clientAnswerId || crypto.randomUUID(),
        roundId,
        participantId,
        optionId,
        roundVersion,
        submittedAtMs: Date.now(),
        answeredAtClockSec: room.match.matchClockSec,
        answeredAt: nowIso(),
        state: "submitted",
      };
      const persistedEvents = await appendDomainEvents(room, [
        domainEvent(room, "answer.submitted", {
          answer,
        }, {
          idempotencyKey: `answer:${room.roomId}:${roundId}:${participantId}`,
        }),
      ]);
      room.answerKeys.add(existingKey);
      room.answersByRound[roundId] ??= {};
      room.answersByRound[roundId][participantId] = answer;
      room.roomDistribution[optionId] = (room.roomDistribution[optionId] ?? 0) + 1;
      room.version += 1;
      emit(roomId, "answer.count_updated", { roundId, optionId, answersSummary: room.roomDistribution, version: room.version });
      emitRoomSnapshot(roomId);
      return {
        accepted: true,
        eventId: persistedEvents[0]?.eventId ?? answer.id,
        roundId,
        optionId,
        answeredAt: answer.answeredAt,
        answerState: answer.state,
      };
    });
  }

  async function castFanPulse(roomId, participantId, side, sessionToken) {
    return withRoomLock(roomId, async () => {
      const room = getRoom(roomId);
      if (room.match.status !== "scheduled") {
        const error = new Error("fan_pulse_pre_match_only");
        error.status = 409;
        throw error;
      }
      if (!sessionToken || room.participantSessions.get(participantId) !== sessionTokenHash(sessionToken)) {
        const error = new Error("invalid_session");
        error.status = 401;
        throw error;
      }
      if (side !== "home" && side !== "away") {
        const error = new Error("invalid_fan_pulse_side");
        error.status = 400;
        throw error;
      }
      if (room.fanPulseChoices.has(participantId)) {
        const error = new Error("fan_pulse_already_cast");
        error.status = 409;
        throw error;
      }
      const event = domainEvent(room, "fan_pulse.cast", {
        participantId,
        side,
        castAt: nowIso(),
      }, {
        idempotencyKey: `fan-pulse:${room.roomId}:${participantId}`,
      });
      const persisted = await appendDomainEvents(room, [event]);
      room.fanPulseChoices.set(participantId, side);
      room.version += 1;
      emitRoomSnapshot(roomId);
      return { accepted: true, side, eventId: persisted[0]?.eventId ?? event.eventId, roomVersion: room.version };
    });
  }

  function winningOptionFor(round, event) {
    if (round.resolution?.domain === "football") {
      return footballConditionEvaluation(round, event).winningOptionId;
    }
    if (round.resolution.mode === "first_matching_event") {
      if (event.type !== round.resolution.eventType) return null;
      if (round.resolution.windowEndsAtClockSec && event.matchClockSec > round.resolution.windowEndsAtClockSec) {
        return round.resolution.elapsedOptionId ?? null;
      }
      if (event.type === "odds_shift") {
        return oddsWinningOption(round, event);
      }
      if (round.options.some((option) => option.id === event.teamId)) return event.teamId;
      return round.options[0]?.id ?? null;
    }
    if (round.resolution.mode === "window_elapsed" && round.resolution.windowEndsAtClockSec && event.matchClockSec >= round.resolution.windowEndsAtClockSec) {
      return round.resolution.elapsedOptionId ?? round.options[0]?.id ?? null;
    }
    return null;
  }

  function footballConditionEvaluation(round, event) {
    const condition = round?.resolution?.condition ?? {};
    const terminalRepair = condition.state === "expired" && event.type === "match_end";
    if (!["tracking", "candidate_met", "confirmed"].includes(condition.state) && !terminalRepair) {
      return { winningOptionId: null, reason: "condition_not_tracking", expression: "football condition awaiting lock" };
    }
    if (condition.kind === "team_shot_on_target") {
      const targetSide = condition.targetSide === "away" ? "away" : "home";
      const openingValue = Number(condition.openingObservation?.shotsOnTarget ?? 0);
      const currentValue = Number(event.authoritativeStats?.[targetSide]?.shotsOnTarget);
      const clock = Number(event.matchClockSec);
      const start = Number(condition.startsAtClockSec);
      const end = Number(condition.endsAtClockSec);
      const confirmedShot = event.type === "shot" && event.participantSide === targetSide && event.confirmed !== false && String(event.outcome ?? "").toLowerCase().replaceAll("_", "") === "ontarget";
      const confirmed = condition.confirmedObservation;
      if (confirmed && Number(confirmed.matchClockSec) <= end) return { winningOptionId: "yes", reason: "condition_confirmed", expression: `${targetSide} shotsOnTarget ${confirmed.value} > ${openingValue} before ${end}`, actualValue: confirmed.value, expectedValue: openingValue };
      if (Number.isFinite(clock) && clock >= start && clock <= end && (confirmedShot || (Number.isFinite(currentValue) && currentValue > openingValue))) return { winningOptionId: "yes", reason: "condition_confirmed", expression: `${targetSide} shotsOnTarget ${currentValue} > ${openingValue} before ${end}`, actualValue: currentValue, expectedValue: openingValue };
      if (event.type === "match_end") return { winningOptionId: Number.isFinite(currentValue) && currentValue > openingValue ? "yes" : "no", reason: "match_finished", expression: `${targetSide} shotsOnTarget ${currentValue} ${currentValue > openingValue ? ">" : "=="} ${openingValue} at full time`, actualValue: currentValue, expectedValue: openingValue };
      if (Number.isFinite(clock) && clock >= end && !condition.candidateObservation) return { winningOptionId: "no", reason: "window_expired", expression: `${targetSide} shotsOnTarget ${currentValue} == ${openingValue} at ${clock}`, actualValue: currentValue, expectedValue: openingValue };
      return { winningOptionId: null, reason: "condition_pending", expression: `${targetSide} shotsOnTarget ${currentValue} == ${openingValue}; tracking until ${end}`, actualValue: currentValue, expectedValue: openingValue };
    }
    if (condition.kind !== "team_scores") return { winningOptionId: null, reason: "unsupported_football_condition", expression: String(condition.kind) };
    const home = Number(event.absoluteScore?.home);
    const away = Number(event.absoluteScore?.away);
    const clock = Number(event.matchClockSec);
    const start = Number(condition.startsAtClockSec);
    const end = Number(condition.endsAtClockSec);
    if (!Number.isFinite(home) || !Number.isFinite(away)) {
      return { winningOptionId: null, reason: "score_observation_missing", expression: "authoritative score required" };
    }
    if (!Number.isFinite(clock) || !Number.isFinite(start) || !Number.isFinite(end) || clock < start) {
      return { winningOptionId: null, reason: "observation_outside_window", expression: `${clock} >= ${start}` };
    }
    const targetSide = condition.targetSide === "away" ? "away" : "home";
    const openingScore = Number(condition.openingObservation?.[targetSide === "home" ? "homeScore" : "awayScore"]);
    const currentScore = targetSide === "home" ? home : away;
    const confirmed = condition.confirmedObservation;
    if (confirmed && Number(confirmed.matchClockSec) <= end) {
      return {
        winningOptionId: "yes",
        reason: "condition_confirmed",
        expression: `${targetSide}Score ${confirmed.targetScore} > openingScore ${openingScore} before ${end}`,
        actualValue: Number(confirmed.targetScore),
        expectedValue: openingScore,
      };
    }
    if (event.type === "match_end") {
      return {
        winningOptionId: currentScore > openingScore ? "yes" : "no",
        reason: "match_finished",
        expression: `${targetSide}Score ${currentScore} ${currentScore > openingScore ? ">" : "=="} openingScore ${openingScore} at full time`,
        actualValue: currentScore,
        expectedValue: openingScore,
      };
    }
    if (clock >= end && !condition.candidateObservation) {
      return {
        winningOptionId: "no",
        reason: "window_expired",
        expression: `${targetSide}Score ${currentScore} == openingScore ${openingScore} at ${clock}`,
        actualValue: currentScore,
        expectedValue: openingScore,
      };
    }
    return {
      winningOptionId: null,
      reason: "condition_pending",
      expression: `${targetSide}Score ${currentScore} == openingScore ${openingScore}; tracking until ${end}`,
      actualValue: currentScore,
      expectedValue: openingScore,
    };
  }

  function advanceFootballCondition(room, event, correlationId) {
    const round = room.currentRound;
    const condition = round?.resolution?.condition;
    if (!round || round.state !== "locked" || round.resolution?.domain !== "football") return [];
    if (condition?.kind === "team_shot_on_target") {
      const targetSide = condition.targetSide === "away" ? "away" : "home";
      const openingValue = Number(condition.openingObservation?.shotsOnTarget ?? 0);
      let currentValue = Number(event.authoritativeStats?.[targetSide]?.shotsOnTarget);
      const clock = Number(event.matchClockSec);
      const end = Number(condition.endsAtClockSec);
      if (!Number.isFinite(currentValue) || !Number.isFinite(clock) || !Number.isFinite(end)) return [];
      const confirmedShot = event.type === "shot" && event.participantSide === targetSide && event.confirmed !== false && String(event.outcome ?? "").toLowerCase().replaceAll("_", "") === "ontarget";
      const candidateShot = event.type === "shot" && event.participantSide === targetSide && event.confirmed === false && String(event.outcome ?? "").toLowerCase().replaceAll("_", "") === "ontarget";
      if (confirmedShot && currentValue <= openingValue) {
        currentValue = openingValue + 1;
        room.matchStats[targetSide].shotsOnTarget = Math.max(room.matchStats[targetSide].shotsOnTarget, currentValue);
        event.authoritativeStats = cloneJson(room.matchStats);
      }
      const observation = { eventId: event.id, sourceActionId: event.sourceActionId ?? null, providerSequence: event.providerSequence ?? null, value: currentValue, matchClockSec: clock, observedAt: event.occurredAt ?? nowIso() };
      if (candidateShot && clock <= end && !condition.candidateObservation) {
        const candidateObservation = { ...observation, value: openingValue + 1 };
        const nextCondition = { ...condition, state: "candidate_met", candidateObservation };
        round.resolution = { ...round.resolution, condition: nextCondition };
        return [domainEvent(room, "football.condition.candidate_met", { roundId: round.id, condition: nextCondition, observation: candidateObservation }, { idempotencyKey: `football-candidate:${room.roomId}:${round.id}:${event.id}`, causationId: event.id, correlationId })];
      }
      const directConfirmation = clock <= end && currentValue > openingValue && (event.confirmed !== false || event.cumulativeStats);
      if (directConfirmation) {
        const nextCondition = { ...condition, state: "confirmed", candidateObservation: condition.candidateObservation ?? observation, confirmedObservation: observation };
        round.resolution = { ...round.resolution, condition: nextCondition };
        return [domainEvent(room, "football.condition.confirmed", { roundId: round.id, condition: nextCondition, observation }, { idempotencyKey: `football-confirmed:${room.roomId}:${round.id}:${event.id}`, causationId: event.id, correlationId })];
      }
      if (clock <= end && currentValue > openingValue && !condition.candidateObservation) {
        const nextCondition = { ...condition, state: "candidate_met", candidateObservation: observation };
        round.resolution = { ...round.resolution, condition: nextCondition };
        return [domainEvent(room, "football.condition.candidate_met", { roundId: round.id, condition: nextCondition, observation }, { idempotencyKey: `football-candidate:${room.roomId}:${round.id}:${event.id}`, causationId: event.id, correlationId })];
      }
      if (condition.candidateObservation && currentValue <= openingValue) {
        const nextCondition = { ...condition, state: "tracking", candidateObservation: null, confirmedObservation: null };
        round.resolution = { ...round.resolution, condition: nextCondition };
        return [domainEvent(room, "football.condition.candidate_revoked", { roundId: round.id, condition: nextCondition, observation }, { idempotencyKey: `football-candidate-revoked:${room.roomId}:${round.id}:${event.id}`, causationId: event.id, correlationId })];
      }
      return [];
    }
    if (condition?.kind !== "team_scores") return [];
    const home = Number(event.absoluteScore?.home);
    const away = Number(event.absoluteScore?.away);
    const clock = Number(event.matchClockSec);
    if (!Number.isFinite(home) || !Number.isFinite(away) || !Number.isFinite(clock)) return [];
    const targetSide = condition.targetSide === "away" ? "away" : "home";
    const openingScore = Number(targetSide === "home" ? condition.openingObservation?.homeScore : condition.openingObservation?.awayScore);
    const targetScore = targetSide === "home" ? home : away;
    const end = Number(condition.endsAtClockSec);
    if (!Number.isFinite(openingScore) || !Number.isFinite(end)) return [];
    const observation = { eventId: event.id, providerSequence: event.providerSequence ?? null, targetScore, homeScore: home, awayScore: away, matchClockSec: clock, observedAt: event.occurredAt ?? nowIso() };
    if (targetScore > openingScore && clock <= end && !condition.candidateObservation) {
      const nextCondition = { ...condition, state: "candidate_met", candidateObservation: observation };
      round.resolution = { ...round.resolution, condition: nextCondition };
      return [domainEvent(room, "football.condition.candidate_met", { roundId: round.id, condition: nextCondition, observation }, { idempotencyKey: `football-candidate:${room.roomId}:${round.id}:${event.id}`, causationId: event.id, correlationId })];
    }
    if (condition.candidateObservation && targetScore > openingScore) {
      const nextCondition = { ...condition, state: "confirmed", confirmedObservation: observation };
      round.resolution = { ...round.resolution, condition: nextCondition };
      return [domainEvent(room, "football.condition.confirmed", { roundId: round.id, condition: nextCondition, observation }, { idempotencyKey: `football-confirmed:${room.roomId}:${round.id}:${event.id}`, causationId: event.id, correlationId })];
    }
    if (condition.candidateObservation && targetScore <= openingScore) {
      const nextCondition = { ...condition, state: "tracking", candidateObservation: null, confirmedObservation: null };
      round.resolution = { ...round.resolution, condition: nextCondition };
      return [domainEvent(room, "football.condition.candidate_revoked", { roundId: round.id, condition: nextCondition, observation }, { idempotencyKey: `football-candidate-revoked:${room.roomId}:${round.id}:${event.id}`, causationId: event.id, correlationId })];
    }
    return [];
  }

  function oddsEvaluation(round, event) {
    const predicate = round.resolution.predicate ?? {};
    const payload = event.payload ?? {};
    const providerSequence = Number(event.providerSequence ?? event.payload?.Seq ?? event.payload?.seq);
    if (predicate.openedFromEventId && String(event.id) === String(predicate.openedFromEventId)) {
      return {
        winningOptionId: null,
        actualValue: null,
        expectedValue: Number(predicate.pctGte ?? predicate.openingValue ?? 50),
        expectedOperator: "next_event",
        expression: "event.id != openedFromEventId",
        predicateResult: false,
        ignoredReason: "opening_event_cannot_resolve_round",
      };
    }
    if (Number.isFinite(Number(predicate.minimumProviderSequence)) && Number.isFinite(providerSequence) && providerSequence < Number(predicate.minimumProviderSequence)) {
      return {
        winningOptionId: null,
        actualValue: null,
        expectedValue: Number(predicate.minimumProviderSequence),
        expectedOperator: ">=",
        expression: `providerSequence >= ${predicate.minimumProviderSequence}`,
        predicateResult: false,
        ignoredReason: "before_minimum_provider_sequence",
      };
    }
    if (predicate.marketSignature && marketSignatureFromPayload(payload) !== predicate.marketSignature) {
      return {
        winningOptionId: null,
        actualValue: null,
        expectedValue: String(predicate.marketSignature),
        expectedOperator: "==",
        expression: "marketSignature == round.marketSignature",
        predicateResult: false,
        ignoredReason: "market_signature_mismatch",
      };
    }
    if (predicate.market && payload.SuperOddsType !== predicate.market) {
      return {
        winningOptionId: null,
        actualValue: null,
        expectedValue: Number(predicate.pctGte ?? 50),
        expectedOperator: ">=",
        expression: `${predicate.side ?? "home"}Probability >= ${predicate.pctGte ?? 50}`,
        predicateResult: false,
      };
    }
    if (predicate.line !== undefined && predicate.line !== null && payload.MarketParameters !== predicate.line) {
      return {
        winningOptionId: null,
        actualValue: null,
        expectedValue: String(predicate.line),
        expectedOperator: "==",
        expression: `MarketParameters == ${predicate.line}`,
        predicateResult: false,
      };
    }
    if (predicate.period !== undefined && predicate.period !== null && payload.MarketPeriod !== predicate.period) {
      return {
        winningOptionId: null,
        actualValue: null,
        expectedValue: String(predicate.period),
        expectedOperator: "==",
        expression: `MarketPeriod == ${predicate.period}`,
        predicateResult: false,
      };
    }

    const priceNames = Array.isArray(payload.PriceNames) ? payload.PriceNames : [];
    const pct = Array.isArray(payload.Pct) ? payload.Pct : [];
    const sideName = predicate.priceName ?? (predicate.side === "away" ? "part2" : predicate.side === "draw" ? "draw" : "part1");
    const index = priceNames.findIndex((name) => String(name).toLowerCase() === sideName);
    if (index === -1) {
      return {
        winningOptionId: null,
        actualValue: null,
        expectedValue: Number(predicate.pctGte ?? 50),
        expectedOperator: ">=",
        expression: `${predicate.side ?? "home"}Probability >= ${predicate.pctGte ?? 50}`,
        predicateResult: false,
      };
    }

    const value = Number(pct[index]);
    const threshold = Number(predicate.pctGte ?? 50);
    const openingValue = Number(predicate.openingValue);
    const isDirectionRound = predicate.direction === "up";
    const predicateResult = isDirectionRound
      ? Number.isFinite(value) && Number.isFinite(openingValue) && value > openingValue
      : Number.isFinite(value) && value >= threshold;
    return {
      winningOptionId: predicateResult ? "yes" : "no",
      actualValue: Number.isFinite(value) ? value : null,
      expectedValue: isDirectionRound && Number.isFinite(openingValue) ? openingValue : threshold,
      expectedOperator: isDirectionRound ? ">" : ">=",
      expression: isDirectionRound
        ? `${predicate.side ?? "home"}Probability > ${Number.isFinite(openingValue) ? openingValue : "openingValue"}`
        : `${predicate.side ?? "home"}Probability >= ${threshold}`,
      predicateResult,
    };
  }

  function oddsWinningOption(round, event) {
    return oddsEvaluation(round, event).winningOptionId;
  }

  function optionDistributionForRound(round) {
    return Object.fromEntries((round?.options ?? []).map((option) => [option.id, 0]));
  }

  function openNextRound(room, resolvedRound, event) {
    if (resolvedRound.resolution?.domain === "football" || !MARKET_ROUNDS_ENABLED) {
      return null;
    }
    const resolvedPredicate = resolvedRound.resolution?.predicate ?? {};
    const odds = event.type === "odds_shift" ? oddsEvaluation(resolvedRound, event) : null;
    const openingValue = odds?.actualValue;
    const providerSequence = Number(event.providerSequence ?? event.payload?.Seq ?? event.payload?.seq);
    const nextSequence = resolvedRound.sequence + 1;
    const nextPredicate = {
      market: resolvedPredicate.market ?? "1X2_PARTICIPANT_RESULT",
      side: resolvedPredicate.side ?? "home",
      priceName: resolvedPredicate.priceName,
      line: resolvedPredicate.line,
      period: resolvedPredicate.period,
      marketSignature: resolvedPredicate.marketSignature,
      openingValue: Number.isFinite(openingValue) ? openingValue : resolvedPredicate.openingValue,
      openedFromEventId: event.id,
      minimumProviderSequence: Number.isFinite(providerSequence) ? providerSequence + 1 : undefined,
      direction: "up",
    };
    const sideLabel = resolvedPredicate.side === "draw"
      ? "empate"
      : resolvedPredicate.side === "away"
        ? room.match.awayTeam.name
        : room.match.homeTeam.name;
    const nextRound = openedRound({
      id: `round-${nextSequence}`,
      matchId: room.match.id,
      sequence: nextSequence,
      contextLabel: "Mercado 1X2 · direcao do proximo sinal",
      options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Nao" }],
      title: `A probabilidade de ${sideLabel} sobe no proximo sinal?`,
      opensAtClockSec: event.matchClockSec,
      locksAtClockSec: event.matchClockSec + DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      answerWindowSec: DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      state: "open",
      resolution: {
        mode: "first_matching_event",
        eventType: "odds_shift",
        predicate: nextPredicate,
      },
    }, eventServerTimeMs(event));
    room.currentRound = nextRound;
    room.answersByRound[nextRound.id] ??= {};
    room.roomDistribution = optionDistributionForRound(nextRound);
    pushTimeline(room, {
      id: `timeline-${nextRound.id}-open-${event.id}`,
      matchClockSec: event.matchClockSec,
      title: "Nova previsao aberta",
      description: nextRound.title,
      tone: "info",
    });
    scheduleRoundLock(room);
    return nextRound;
  }

  function maybeOpenDirectedFootballRound(room, event) {
    const previous = room.currentRound;
    if (room.match.status !== "live" || !dynamicPredictionSeeds.has(String(room.match.id))) return null;
    if (previous && (previous.state !== "resolved" || previous.resolution?.domain !== "football")) return null;
    if (previous && previous.sequence >= FOOTBALL_ROUNDS_MAX) return null;
    const clock = Number(event.matchClockSec);
    if (!Number.isFinite(Number(event.absoluteScore?.home)) || !Number.isFinite(Number(event.absoluteScore?.away))) return null;
    const resolvedAtClock = Number(room.lastResolution?.event?.matchClockSec ?? previous?.resolution.condition?.endsAtClockSec ?? 0);
    const safeWindow = (clock >= 300 && clock <= 2100) || (clock >= 2700 && clock <= 4500);
    if (!safeWindow || (previous && clock < resolvedAtClock + FOOTBALL_ROUND_COOLDOWN_SEC)) return null;
    const targetSide = room.match.homeScore < room.match.awayScore
      ? "home"
      : room.match.awayScore < room.match.homeScore
        ? "away"
        : previous?.resolution.condition?.targetSide === "home" ? "away" : "home";
    const team = targetSide === "home" ? room.match.homeTeam : room.match.awayTeam;
    const previousFamily = previous?.resolution.condition?.kind ?? null;
    const shotRounds = room.roundHistory.filter((item) => item.family === "team_shot_on_target").length;
    const shotCoverage = room.matchStats.reliability.shots === "reliable";
    const useShotOnTarget = shotCoverage && previousFamily !== "team_shot_on_target" && shotRounds < 2;
    const condition = useShotOnTarget
      ? { kind: "team_shot_on_target", targetSide, durationSec: 300, state: "awaiting_lock" }
      : { kind: "team_scores", targetSide, durationSec: 600, state: "awaiting_lock" };
    const round = openedRound({
      id: `round-${(previous?.sequence ?? 0) + 1}`,
      matchId: room.match.id,
      sequence: (previous?.sequence ?? 0) + 1,
      contextLabel: useShotOnTarget ? "Momento de ataque · proximos 5 minutos" : "Previsao de jogo · proximos 10 minutos",
      options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Nao" }],
      title: useShotOnTarget ? `${team.name} finaliza no alvo nos proximos 5 minutos?` : `${team.name} marca nos proximos 10 minutos?`,
      opensAtClockSec: clock,
      locksAtClockSec: clock + DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      answerWindowSec: DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      state: "open",
      resolution: { domain: "football", mode: "football_condition", condition },
    }, eventServerTimeMs(event));
    room.currentRound = round;
    room.answersByRound[round.id] ??= {};
    room.roomDistribution = optionDistributionForRound(round);
    pushTimeline(room, { id: `timeline-${round.id}-open-${event.id}`, matchClockSec: clock, title: "Nova previsao aberta", description: round.title, tone: "info" });
    scheduleRoundLock(room);
    return round;
  }

  function ruleEvaluationFor(round, event) {
    if (!round) {
      return {
        roundId: null,
        roundPrompt: null,
        eventId: event.id,
        ruleMode: "none",
        expression: "no active round",
        actualValue: null,
        expectedOperator: null,
        expectedValue: null,
        predicateResult: false,
        roundStateBefore: "none",
        windowValid: false,
      };
    }

    if (round.state === "resolved") {
      return {
        roundId: round.id,
        roundPrompt: round.title,
        eventId: event.id,
        ruleMode: round.resolution.mode,
        expression: "round already resolved",
        actualValue: null,
        expectedOperator: null,
        expectedValue: null,
        predicateResult: false,
        roundStateBefore: round.state,
        windowValid: true,
        ignoredReason: "round_already_resolved",
      };
    }

    if (round.resolution?.domain === "football") {
      const evaluation = footballConditionEvaluation(round, event);
      return {
        roundId: round.id,
        roundPrompt: round.title,
        eventId: event.id,
        ruleMode: "football_condition",
        expression: evaluation.expression,
        actualValue: evaluation.actualValue ?? null,
        expectedOperator: evaluation.winningOptionId === "yes" ? ">" : "==",
        expectedValue: evaluation.expectedValue ?? null,
        predicateResult: Boolean(evaluation.winningOptionId),
        roundStateBefore: round.state,
        windowValid: evaluation.reason !== "observation_outside_window",
        ignoredReason: evaluation.winningOptionId ? undefined : evaluation.reason,
      };
    }
    if (event.type === "odds_shift") {
      const odds = oddsEvaluation(round, event);
      return {
        roundId: round.id,
        roundPrompt: round.title,
        eventId: event.id,
        ruleMode: round.resolution.mode,
        expression: odds.expression,
        actualValue: odds.actualValue,
        expectedOperator: odds.expectedOperator,
        expectedValue: odds.expectedValue,
        predicateResult: Boolean(odds.winningOptionId),
        roundStateBefore: round.state,
        windowValid: true,
        ignoredReason: odds.ignoredReason,
      };
    }

    const winningOptionId = winningOptionFor(round, event);
    const windowValid = !round.resolution.windowEndsAtClockSec || event.matchClockSec <= round.resolution.windowEndsAtClockSec;
    return {
      roundId: round.id,
      roundPrompt: round.title,
      eventId: event.id,
      ruleMode: round.resolution.mode,
      expression: `${event.type} == ${round.resolution.eventType ?? "any"}`,
      actualValue: null,
      expectedOperator: "==",
      expectedValue: round.resolution.eventType ?? null,
      predicateResult: Boolean(winningOptionId),
      roundStateBefore: round.state,
      windowValid,
    };
  }

  function resolveCurrentRound(room, event, options = {}) {
    const round = room.currentRound;
    const repairingExpiredRound = options.repairExpiredRound === true && round?.state === "expired";
    if (!round || (round.state !== "locked" && !repairingExpiredRound)) return null;
    const answersForRound = room.answersByRound[round.id] ?? {};
    const fallbackScore = room.lastAuthoritativeScoreObservation;
    let resolutionEvent = round.resolution?.domain === "football"
      && (!Number.isFinite(Number(event.absoluteScore?.home)) || !Number.isFinite(Number(event.absoluteScore?.away)))
      && Number(fallbackScore?.matchClockSec) >= Number(round.resolution.condition?.endsAtClockSec)
      ? fallbackScore
      : event;
    const shotCondition = round.resolution?.condition?.kind === "team_shot_on_target" ? round.resolution.condition : null;
    const shotSide = shotCondition?.targetSide === "away" ? "away" : "home";
    const confirmedTargetShot = shotCondition && resolutionEvent.type === "shot" && resolutionEvent.participantSide === shotSide && resolutionEvent.confirmed !== false && String(resolutionEvent.outcome ?? "").toLowerCase().replaceAll("_", "") === "ontarget";
    if (confirmedTargetShot) {
      const openingShots = Number(shotCondition.openingObservation?.shotsOnTarget ?? 0);
      const stats = cloneJson(resolutionEvent.authoritativeStats ?? room.matchStats);
      stats[shotSide].shotsOnTarget = Math.max(Number(stats[shotSide].shotsOnTarget) || 0, openingShots + 1);
      resolutionEvent = { ...resolutionEvent, authoritativeStats: stats };
    }
    const footballEvaluation = round.resolution?.domain === "football" ? footballConditionEvaluation(round, resolutionEvent) : null;
    const winningOptionId = footballEvaluation?.winningOptionId ?? winningOptionFor(round, event);
    if (!winningOptionId) return null;

    let currentUserDelta = 0;
    let answersEvaluated = 0;
    let answersCorrect = 0;
    let totalPointsApplied = 0;
    const scoreOutputs = [];
    room.leaderboard = room.leaderboard.map((entry) => {
      const answer = answersForRound[entry.participantId];
      const previousScore = entry.points;
      answersEvaluated += answer?.roundId === round.id ? 1 : 0;
      if (!answer || answer.roundId !== round.id || answer.optionId !== winningOptionId) {
        return { ...entry, delta: 0, streak: 0 };
      }
      answersCorrect += 1;
      const streak = entry.streak + 1;
      const delta = 100 + (streak >= 3 ? 40 : streak === 2 ? 20 : 0);
      totalPointsApplied += delta;
      currentUserDelta = Math.max(currentUserDelta, delta);
      scoreOutputs.push({
        type: "score.updated",
        participantId: entry.participantId,
        displayName: entry.displayName,
        previousScore,
        delta,
        currentScore: previousScore + delta,
      });
      return { ...entry, points: entry.points + delta, delta, streak };
    });
    room.leaderboard = rankLeaderboard(room.leaderboard);
    const resolvedCondition = footballEvaluation?.reason === "window_expired"
      ? { ...round.resolution?.condition, state: "expired" }
      : round.resolution?.condition ?? null;
    const resolvedRound = {
      ...round,
      state: "resolved",
      version: (Number(round.version) || 1) + 1,
      resolution: resolvedCondition ? { ...round.resolution, condition: resolvedCondition } : round.resolution,
    };
    room.currentRound = resolvedRound;
    room.roundHistory.push({ roundId: round.id, family: round.resolution?.condition?.kind ?? "market", targetSide: round.resolution?.condition?.targetSide ?? null, openedAtClockSec: round.opensAtClockSec });
    room.lastResolution = {
      roundId: round.id,
      roundVersion: resolvedRound.version,
      winningOptionId,
      wasCurrentUserCorrect: false,
      pointsAwarded: currentUserDelta,
      streakAfterResolve: 0,
      movementLabel: "ranking atualizado",
      resolvedBy: footballEvaluation?.reason === "match_finished" ? "match_state" : footballEvaluation?.reason === "window_expired" || round.resolution.mode === "window_elapsed" ? "window" : "event",
      resolutionDomain: round.resolution?.domain ?? "market",
      resolutionReason: footballEvaluation?.reason ?? null,
      condition: resolvedCondition,
      event: resolutionEvent,
      answersEvaluated,
      answersCorrect,
      totalPointsApplied,
      scoreOutputs,
    };
    pushTimeline(room, {
      id: `timeline-${round.id}-resolved`,
      matchClockSec: event.matchClockSec,
      title: "Rodada resolvida",
      description: `Opcao vencedora: ${round.options.find((option) => option.id === winningOptionId)?.label ?? winningOptionId}.`,
      tone: "success",
    });
    openNextRound(room, resolvedRound, event);
    return room.lastResolution;
  }

  function updateMarketDistribution(room, event) {
    if (event.type !== "odds_shift" || !room.currentRound) return;
    const odds = oddsEvaluation(room.currentRound, event);
    if (typeof odds.actualValue !== "number") return;
    if (room.currentRound.options.some((option) => option.id === "yes") && room.currentRound.options.some((option) => option.id === "no")) {
      room.marketDistribution = {
        yes: odds.actualValue,
        no: Math.max(0, 100 - odds.actualValue),
      };
    }
  }

  function applyAuthoritativeScore(room, event) {
    const rawAction = String(event.payload?.Action ?? event.payload?.action ?? "").toLowerCase().replaceAll("-", "_");
    const authority = event.scoreAuthority ?? (
      rawAction === "goal_kick" || event.confirmed === false
        ? "none"
        : event.type === "match_end"
          ? "final"
          : event.type === "goal" || event.type === "penalty"
            ? "confirmed_action"
            : Number.isFinite(Number(event.absoluteScore?.home)) && Number.isFinite(Number(event.absoluteScore?.away))
              ? "legacy_snapshot"
              : "none"
    );
    if (authority === "none") return;
    const scoreActionId = String(event.sourceActionId ?? event.providerActionId ?? event.id);
    const home = Number(event.absoluteScore?.home);
    const away = Number(event.absoluteScore?.away);
    if (Number.isFinite(home) && Number.isFinite(away)) {
      room.match.homeScore = Math.max(0, home);
      room.match.awayScore = Math.max(0, away);
      room.lastAuthoritativeScoreObservation = cloneJson(event);
      if (authority === "confirmed_action") room.appliedScoreActionIds.add(scoreActionId);
      return;
    }
    if ((event.type !== "goal" && event.type !== "penalty") || event.confirmed !== true || room.appliedScoreActionIds.has(scoreActionId)) return;
    if (event.participantSide === "home" || event.teamId === room.match.homeTeam.id) room.match.homeScore += 1;
    if (event.participantSide === "away" || event.teamId === room.match.awayTeam.id) room.match.awayScore += 1;
    room.appliedScoreActionIds.add(scoreActionId);
  }

  function consumeConsumerVisibleMatchEvent(room, event) {
    if (event.confirmed === false) return false;
    if (!new Set(["goal", "penalty", "corner", "shot", "card", "var", "match_end", "action_amended", "action_discarded"]).has(event.type)) return false;
    const rawAction = String(event.payload?.Action ?? event.payload?.action ?? event.type);
    const key = `${event.type}:${rawAction}:${event.sourceActionId ?? event.providerActionId ?? event.id}`;
    if (room.consumerEventKeys.has(key)) return false;
    room.consumerEventKeys.add(key);
    return true;
  }

  function applyFootballEventStats(room, event, correlationId = null, emitEvents = true) {
    const relevant = new Set(["shot", "corner", "penalty", "card", "var", "reliability", "action_amended", "action_discarded"]);
    if (!relevant.has(event.type) && !event.cumulativeStats) return [];
    const before = JSON.stringify(room.matchStats);
    const side = event.participantSide === "away" ? "away" : "home";
    const actionId = String(event.sourceActionId ?? event.id);
    const normalizedOutcome = String(event.outcome ?? "").toLowerCase().replaceAll("_", "");
    const countsOnTarget = (entry) => entry?.type === "shot" && entry.confirmed && String(entry.outcome ?? "").toLowerCase().replaceAll("_", "") === "ontarget";
    const removeAction = (entry) => {
      if (!entry) return;
      if (entry.type === "shot" && entry.confirmed) room.matchStats[entry.side].shots = Math.max(0, room.matchStats[entry.side].shots - 1);
      if (countsOnTarget(entry)) room.matchStats[entry.side].shotsOnTarget = Math.max(0, room.matchStats[entry.side].shotsOnTarget - 1);
    };
    if (event.type === "action_discarded") {
      const discardedId = String(event.discardedActionId ?? event.sourceActionId ?? "");
      const existing = room.footballActions.get(discardedId);
      removeAction(existing);
      room.footballActions.delete(discardedId);
    } else if (event.type === "action_amended") {
      const existing = room.footballActions.get(actionId);
      removeAction(existing);
      const amended = { type: event.amendedActionType ?? existing?.type, side: event.participantSide ?? existing?.side ?? side, outcome: event.outcome ?? existing?.outcome ?? null, confirmed: event.confirmed !== false };
      room.footballActions.set(actionId, amended);
      if (amended.type === "shot" && amended.confirmed) room.matchStats[amended.side].shots += 1;
      if (countsOnTarget(amended)) room.matchStats[amended.side].shotsOnTarget += 1;
    } else if (event.type === "shot") {
      const existing = room.footballActions.get(actionId);
      if (existing) removeAction(existing);
      const next = { type: "shot", side, outcome: normalizedOutcome, confirmed: event.confirmed !== false };
      room.footballActions.set(actionId, next);
      if (next.confirmed) room.matchStats[side].shots += 1;
      if (countsOnTarget(next)) room.matchStats[side].shotsOnTarget += 1;
      room.matchStats.reliability.shots = "reliable";
    }
    if (event.type === "reliability") {
      const action = String(event.payload?.Action ?? "").toLowerCase();
      const unreliable = event.payload?.Data?.Unreliable !== false;
      if (action.includes("corner")) room.matchStats.reliability.corners = unreliable ? "unreliable" : "reliable";
      if (action.includes("card")) room.matchStats.reliability.cards = unreliable ? "unreliable" : "reliable";
    }
    for (const targetSide of ["home", "away"]) {
      const stats = event.cumulativeStats?.[targetSide];
      if (!stats) continue;
      for (const field of ["shots", "shotsOnTarget", "corners", "yellowCards", "redCards"]) {
        const value = Number(stats[field]);
        if (Number.isFinite(value)) room.matchStats[targetSide][field] = Math.max(0, value);
      }
      if (Number.isFinite(Number(stats.shots)) || Number.isFinite(Number(stats.shotsOnTarget))) room.matchStats.reliability.shots = "reliable";
    }
    room.matchStats.updatedAtClockSec = Math.max(room.matchStats.updatedAtClockSec, Number(event.matchClockSec) || 0);
    room.matchStats.sourceEventId = event.id;
    const changed = before !== JSON.stringify(room.matchStats);
    if (!emitEvents) return [];
    const eventType = event.type === "action_amended" ? "football.event.amended" : event.type === "action_discarded" ? "football.event.discarded" : "football.event.accepted";
    return [domainEvent(room, eventType, { event }, { idempotencyKey: `${eventType}:${room.roomId}:${event.id}`, causationId: event.id, correlationId }), ...(changed ? [domainEvent(room, "football.stats.updated", { stats: cloneJson(room.matchStats), causedByEventId: event.id }, { idempotencyKey: `football-stats:${room.roomId}:${event.id}`, causationId: event.id, correlationId })] : [])];
  }

  function withConsolidatedScore(room, event) {
    if (Number.isFinite(Number(event.absoluteScore?.home)) && Number.isFinite(Number(event.absoluteScore?.away))) return event;
    if (event.type === "odds_shift" || !Number.isFinite(Number(event.matchClockSec))) return event;
    return {
      ...event,
      absoluteScore: { home: room.match.homeScore, away: room.match.awayScore },
      scoreConsolidatedFromRoom: true,
    };
  }

  function pctValueForRound(round, event) {
    const predicate = round?.resolution?.predicate ?? {};
    const payload = event.payload ?? {};
    const priceNames = Array.isArray(payload.PriceNames) ? payload.PriceNames : [];
    const pct = Array.isArray(payload.Pct) ? payload.Pct : [];
    const sideName = predicate.priceName ?? (predicate.side === "away" ? "part2" : predicate.side === "draw" ? "draw" : "part1");
    const index = priceNames.findIndex((name) => String(name).toLowerCase() === sideName);
    const value = index >= 0 ? Number(pct[index]) : NaN;
    return Number.isFinite(value) ? value : null;
  }

  function reanchorOpenRoundFromLiveOdds(room, event) {
    const round = room.currentRound;
    if (!round || round.state !== "open" || event.type !== "odds_shift") return;
    if (round.resolution?.domain === "football") return;
    if (Object.keys(currentRoundAnswers(room)).length > 0) return;
    const predicate = round.resolution?.predicate ?? {};
    if (Number.isFinite(Number(predicate.openingValue)) && predicate.openedFromEventId) return;
    const providerSequence = Number(event.providerSequence ?? event.payload?.Seq ?? event.payload?.seq);
    const shouldReanchor = !Number.isFinite(Number(predicate.minimumProviderSequence))
      || Number(predicate.minimumProviderSequence) <= 1
      || predicate.openedFromEventId === event.id;
    if (!shouldReanchor) return;
    const openingValue = pctValueForRound(round, event);
    if (openingValue === null) return;
    const nextThreshold = predicate.pctGte !== undefined && predicate.pctGte !== null
      ? Math.max(Number(predicate.pctGte), Math.ceil(openingValue))
      : Math.ceil(openingValue);
    room.currentRound = {
      ...round,
      title: round.title
        .replace(/ultrapassa \d+(?:\.\d+)?%/, `chega a ${nextThreshold}% ou mais`)
        .replace(/chega a \d+(?:\.\d+)?% ou mais/, `chega a ${nextThreshold}% ou mais`),
      opensAtClockSec: event.matchClockSec || room.match.matchClockSec,
      locksAtClockSec: (event.matchClockSec || room.match.matchClockSec) + DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      answerWindowSec: DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      version: (Number(round.version) || 1) + 1,
      openedAt: new Date(eventServerTimeMs(event)).toISOString(),
      locksAt: new Date(eventServerTimeMs(event) + DEFAULT_ROUND_ANSWER_WINDOW_SEC * 1_000).toISOString(),
      resolution: {
        ...round.resolution,
        predicate: {
          ...predicate,
          openingValue,
          pctGte: nextThreshold,
          openedFromEventId: event.id,
          minimumProviderSequence: Number.isFinite(providerSequence) ? providerSequence + 1 : undefined,
          marketSignature: predicate.marketSignature ?? marketSignatureFromPayload(event.payload ?? {}),
        },
      },
    };
    scheduleRoundLock(room);
    const openEntry = room.timeline.find((item) => item.id === "timeline-round-1-open");
    if (openEntry) {
      openEntry.matchClockSec = room.currentRound.opensAtClockSec;
      openEntry.description = room.currentRound.title;
    }
  }

  function finishMatch(room, event) {
    room.match.status = "finished";
    if (room.currentRound && room.currentRound.state !== "resolved") {
      const condition = room.currentRound.resolution?.condition;
      room.currentRound = {
        ...room.currentRound,
        state: "expired",
        resolution: condition
          ? { ...room.currentRound.resolution, condition: { ...condition, state: "expired" } }
          : room.currentRound.resolution,
      };
    }
    pushTimeline(room, {
      id: `timeline-match-finished-${event.id}`,
      matchClockSec: event.matchClockSec,
      title: "Partida encerrada",
      description: "A TxLINE enviou o evento de fim de jogo. A sala foi fechada para novos palpites.",
      tone: "info",
    });
  }

  function pushTimeline(room, entry) {
    if (entry.title === "Mercado TxLINE atualizado") {
      const latestMarketEntry = room.timeline.find((item) => item.title === "Mercado TxLINE atualizado");
      if (latestMarketEntry) {
        latestMarketEntry.id = entry.id;
        latestMarketEntry.matchClockSec = entry.matchClockSec;
        latestMarketEntry.description = entry.description;
        latestMarketEntry.tone = entry.tone;
        return;
      }
    }
    room.timeline.unshift(entry);
    room.timeline = room.timeline.slice(0, 30);
  }

  function createEvidenceInput(room, event, acquisition = {}) {
    const payload = event.payload ?? {};
    const requestId = acquisition.requestId ?? payload.txlineRequestId ?? shortId("txreq");
    const rawPayload = acquisition.rawPayload ?? payload;
    return {
      requestId,
      fixtureId: String(payload.FixtureId ?? payload.fixtureId ?? event.matchId ?? room.roomId),
      provider: "TxLINE",
      endpoint: acquisition.endpoint ?? payload.txlineEndpoint ?? "unknown",
      httpMethod: acquisition.httpMethod ?? "GET",
      httpStatus: acquisition.httpStatus ?? 200,
      receivedAt: acquisition.receivedAt ?? payload.capturedAt ?? nowIso(),
      rawPayloadHash: sha256(rawPayload),
      excerpt: {
        market: payload.SuperOddsType ?? payload.Action ?? payload.EventType ?? payload.type,
        percentages: Array.isArray(payload.Pct) ? payload.Pct.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : undefined,
        providerSequence: payload.Seq ?? payload.seq ?? payload.Sequence ?? payload.sequence,
        line: payload.MarketParameters ?? null,
        period: payload.MarketPeriod ?? null,
        priceNames: Array.isArray(payload.PriceNames) ? payload.PriceNames.map(String) : undefined,
      },
    };
  }

  function appendEvidence(room, evidence) {
    room.latestEvidence = evidence;
    room.evidenceHistory = [evidence, ...room.evidenceHistory].slice(0, 20);
  }

  function evidence(roomId, limit = 10) {
    const room = getRoom(roomId);
    return {
      latestEvidence: room.latestEvidence,
      evidenceHistory: room.evidenceHistory.slice(0, limit),
    };
  }

  function evidenceById(roomId, evidenceId) {
    return getRoom(roomId).evidenceHistory.find((item) => item.id === evidenceId) ?? null;
  }

  function resetRoomForReplay(roomId, seedRoomId = roomId) {
    const seededRoom = defaultRoom(seedRoomId);
    const room = getRoom(roomId);
    room.roomLabel = seededRoom.roomLabel;
    room.match = cloneJson(seededRoom.match);
    room.roomPopulation = 0;
    room.connectionState = "connecting";
    room.currentRound = null;
    room.participants = [];
    room.answersByRound = {};
    room.answerKeys = new Set();
    room.participantSessions = new Map();
    room.fanPulseChoices = new Map();
    room.leaderboard = [];
    room.timeline = [];
    room.marketDistribution = {};
    room.roomDistribution = {};
    room.version = 1;
    room.lastSequence = 0;
    room.appliedEventIds = new Set();
    room.appliedScoreActionIds = new Set();
    room.consumerEventKeys = new Set();
    room.source = undefined;
    room.lastNormalizedEvent = null;
    room.lastAuthoritativeScoreObservation = null;
    room.matchStats = emptyMatchStats();
    room.footballActions = new Map();
    room.roundHistory = [];
    room.lastResolution = null;
    room.latestEvidence = null;
    room.evidenceHistory = [];
    room.providerSequences = new Map();
    room.sequenceWarnings = [];
    room.streamVersion = 0;
    room.ledgerHeadHash = null;
    return room;
  }

  function applyStoredEventToRoom(room, storedEvent) {
    const payload = cloneJson(storedEvent.payload ?? {});
    room.streamVersion = Math.max(room.streamVersion ?? 0, Number(storedEvent.streamVersion) || 0);
    room.ledgerHeadHash = storedEvent.eventHash ?? room.ledgerHeadHash ?? null;

    switch (storedEvent.type) {
      case "room.configured": {
        if (payload.match) room.match = payload.match;
        room.roomLabel = payload.roomLabel ?? room.roomLabel;
        room.connectionState = payload.connectionState ?? room.connectionState;
        room.timeline = [
          { id: "timeline-room-started", matchClockSec: room.match.matchClockSec, title: "Sala ativa", description: "A sala esta pronta para receber participantes reais.", tone: "info" },
        ];
        break;
      }
      case "participant.joined": {
        const participant = payload.participant;
        if (!participant || room.participants.some((item) => item.id === participant.id)) break;
        room.participants.push(participant);
        if (payload.sessionTokenHash) room.participantSessions.set(participant.id, payload.sessionTokenHash);
        room.leaderboard.push({ participantId: participant.id, displayName: participant.displayName, points: 0, rank: room.leaderboard.length + 1, streak: 0, movement: "steady", delta: 0 });
        room.leaderboard = rankLeaderboard(room.leaderboard);
        break;
      }
      case "fan_pulse.cast": {
        if (payload.participantId && (payload.side === "home" || payload.side === "away")) {
          room.fanPulseChoices.set(payload.participantId, payload.side);
        }
        break;
      }
      case "round.opened": {
        const round = payload.round ? openedRound(payload.round, Date.parse(storedEvent.createdAt)) : null;
        if (!round) break;
        room.currentRound = round;
        room.answersByRound[round.id] ??= {};
        room.roomDistribution = optionDistributionForRound(round);
        const timelineEntry = {
          id: payload.timelineEntryId ?? `timeline-${round.id}-open-${storedEvent.eventId}`,
          matchClockSec: payload.timelineMatchClockSec ?? round.opensAtClockSec ?? room.match.matchClockSec,
          title: "Nova previsao aberta",
          description: round.title,
          tone: "info",
        };
        if (payload.timelineEntryId === "timeline-round-1-open") room.timeline.push(timelineEntry);
        else pushTimeline(room, timelineEntry);
        break;
      }
      case "answer.submitted": {
        const answer = payload.answer;
        if (!answer) break;
        const key = `${answer.roundId}:${answer.participantId}`;
        if (room.answerKeys.has(key)) break;
        room.answerKeys.add(key);
        room.answersByRound[answer.roundId] ??= {};
        room.answersByRound[answer.roundId][answer.participantId] = answer;
        room.roomDistribution[answer.optionId] = (room.roomDistribution[answer.optionId] ?? 0) + 1;
        break;
      }
      case "round.locked": {
        if (!room.currentRound || room.currentRound.id !== payload.roundId) break;
        room.currentRound = payload.round
          ? cloneJson(payload.round)
          : {
              ...room.currentRound,
              state: "locked",
              version: payload.roundVersion ?? (Number(room.currentRound.version) || 1) + 1,
              lockedAt: payload.lockedAt ?? storedEvent.createdAt,
              lockReason: payload.reason ?? "ledger_replay",
            };
        pushTimeline(room, { id: `timeline-${payload.roundId}-locked`, matchClockSec: room.match.matchClockSec, title: "Respostas encerradas", description: "Somente respostas confirmadas antes do fechamento participam do resultado.", tone: "info" });
        break;
      }
      case "football.condition.tracking_started": {
        if (!room.currentRound || room.currentRound.id !== payload.roundId || !payload.condition) break;
        room.currentRound = {
          ...room.currentRound,
          resolution: { ...room.currentRound.resolution, domain: "football", condition: payload.condition },
        };
        break;
      }
      case "football.condition.candidate_met":
      case "football.condition.candidate_revoked":
      case "football.condition.confirmed":
      case "football.condition.expired": {
        if (!room.currentRound || room.currentRound.id !== payload.roundId || !payload.condition) break;
        room.currentRound = { ...room.currentRound, resolution: { ...room.currentRound.resolution, domain: "football", condition: payload.condition } };
        break;
      }
      case "round.terminal_repair_started": {
        if (!room.currentRound || room.currentRound.id !== payload.roundId || !payload.condition) break;
        room.currentRound = {
          ...room.currentRound,
          state: "expired",
          resolution: { ...room.currentRound.resolution, domain: "football", condition: payload.condition },
        };
        break;
      }
      case "txline.event.accepted": {
        const event = payload.event;
        if (!event) break;
        room.appliedEventIds.add(event.id);
        const providerSequence = Number(event.providerSequence ?? event.payload?.Seq ?? event.payload?.seq);
        if (Number.isFinite(providerSequence)) room.providerSequences.set(eventProviderSequenceKey(event), providerSequence);
        if (payload.sequenceWarning) room.sequenceWarnings.unshift(payload.sequenceWarning);
        room.lastSequence = event.localSequence ?? event.sequence ?? room.lastSequence;
        room.lastNormalizedEvent = event;
        room.connectionState = "live";
        room.source = event.source;
        room.match.matchClockSec = event.matchClockSec || room.match.matchClockSec;
        if (room.match.status !== "finished" && (event.payload?.StatusId === 2 || event.payload?.Clock?.Running === true)) room.match.status = "live";
        if (room.match.status !== "finished") {
          reanchorOpenRoundFromLiveOdds(room, event);
          updateMarketDistribution(room, event);
        }
        applyAuthoritativeScore(room, event);
        applyFootballEventStats(room, event, storedEvent.correlationId, false);
        const consumerEventVisible = consumeConsumerVisibleMatchEvent(room, event) && event.consumerPresentationSuppressed !== true;
        if (event.type !== "match_end" && consumerEventVisible) {
          pushTimeline(room, {
            id: `timeline-${event.id}`,
            matchClockSec: event.matchClockSec,
            title: event.type === "goal" ? "Gol confirmado" : event.type === "card" ? "Cartao confirmado" : event.type === "odds_shift" ? "Mercado TxLINE atualizado" : "Evento TxLINE recebido",
            description: `Evento ${event.type} aplicado ao runtime da sala.`,
            tone: event.type === "goal" ? "success" : "info",
          });
        }
        break;
      }
      case "txline.event.ignored": {
        if (payload.evidence) appendEvidence(room, payload.evidence);
        break;
      }
      case "round.resolved": {
        const roundId = payload.roundId;
        const winningOptionId = payload.winningOptionId;
        const awards = Array.isArray(payload.awards) ? payload.awards : [];
        if (!room.roundHistory.some((item) => item.roundId === roundId)) room.roundHistory.push({ roundId, family: payload.condition?.kind ?? payload.resolutionDomain ?? "market", targetSide: payload.condition?.targetSide ?? null, openedAtClockSec: room.currentRound?.opensAtClockSec ?? 0 });
        room.leaderboard = room.leaderboard.map((entry) => {
          const award = awards.find((item) => item.participantId === entry.participantId);
          if (!award) return { ...entry, delta: 0, streak: 0 };
          const points = Number(award.points) || 0;
          return {
            ...entry,
            points: entry.points + points,
            delta: points,
            streak: points > 0 ? entry.streak + 1 : entry.streak,
          };
        });
        room.leaderboard = rankLeaderboard(room.leaderboard);
        if (room.currentRound?.id === roundId) {
          room.currentRound = {
            ...room.currentRound,
            state: "resolved",
            version: payload.roundVersion ?? (Number(room.currentRound.version) || 1) + 1,
            resolution: payload.condition
              ? { ...room.currentRound.resolution, condition: payload.condition }
              : room.currentRound.resolution,
          };
        }
        room.lastResolution = {
          roundId,
          winningOptionId,
          wasCurrentUserCorrect: false,
          pointsAwarded: 0,
          streakAfterResolve: 0,
          movementLabel: "ranking atualizado",
          resolvedBy: payload.resolvedBy ?? "event",
          resolutionDomain: payload.resolutionDomain ?? "market",
          resolutionReason: payload.resolutionReason ?? null,
          condition: payload.condition ?? null,
          event: payload.event,
          answersEvaluated: payload.answersEvaluated,
          answersCorrect: payload.answersCorrect,
          totalPointsApplied: payload.totalPointsApplied,
          scoreOutputs: awards.map((award) => ({
            type: "score.updated",
            participantId: award.participantId,
            displayName: award.displayName,
            previousScore: award.previousScore,
            delta: award.points,
            currentScore: award.currentScore,
          })),
        };
        pushTimeline(room, {
          id: `timeline-${roundId}-resolved`,
          matchClockSec: payload.event?.matchClockSec ?? room.match.matchClockSec,
          title: "Rodada resolvida",
          description: `Opcao vencedora: ${room.currentRound?.options?.find((option) => option.id === winningOptionId)?.label ?? winningOptionId}.`,
          tone: "success",
        });
        break;
      }
      case "match.finished": {
        const event = payload.event ?? { id: storedEvent.eventId, matchClockSec: room.match.matchClockSec };
        finishMatch(room, event);
        break;
      }
      default:
        break;
    }
    room.version += 1;
    return room;
  }

  async function projectRoomFromLedger(roomId) {
    const room = resetRoomForReplay(roomId);
    if (!eventStore) return room;
    for await (const event of eventStore.readStream(roomId)) {
      applyStoredEventToRoom(room, event);
    }
    return room;
  }

  async function rehydrateFromLedger() {
    if (!eventStore) return { rooms: 0, events: 0 };
    const streamIds = new Set();
    const terminalRepairs = [];
    let eventCount = 0;
    for await (const event of eventStore.readAll()) {
      streamIds.add(event.streamId);
      eventCount += 1;
      const persistedLocalSequence = Number(event.payload?.event?.localSequence ?? event.payload?.normalizedObservation?.localSequence);
      if (Number.isFinite(persistedLocalSequence)) nextLocalSequence = Math.max(nextLocalSequence, persistedLocalSequence + 1);
    }
    for (const streamId of streamIds) {
      const room = await projectRoomFromLedger(streamId);
      scheduleRoundLock(room);
      if (
        room.match.status === "finished"
        && room.currentRound?.resolution?.domain === "football"
        && ["open", "locked", "expired"].includes(room.currentRound.state)
        && room.lastResolution?.roundId !== room.currentRound.id
      ) {
        terminalRepairs.push({ roomId: String(streamId), roundId: room.currentRound.id });
      }
      if (commitmentPublisher?.enabled) {
        for await (const event of eventStore.readStream(streamId)) {
          if (event.type === "round.resolved" && event.payload?.roundId) scheduleRoundCommitment(streamId, String(event.payload.roundId));
        }
      }
    }
    for (const repair of terminalRepairs) {
      const room = getRoom(repair.roomId);
      if (room.currentRound?.id !== repair.roundId) continue;
      const matchClockSec = Math.max(Number(room.match.matchClockSec) || 0, 90 * 60);
      const conditionSeed = room.currentRound.resolution?.condition ?? {};
      const repairCondition = {
        ...conditionSeed,
        state: "expired",
        startsAtClockSec: Number.isFinite(Number(conditionSeed.startsAtClockSec)) ? Number(conditionSeed.startsAtClockSec) : matchClockSec,
        endsAtClockSec: Number.isFinite(Number(conditionSeed.endsAtClockSec))
          ? Number(conditionSeed.endsAtClockSec)
          : matchClockSec + Number(conditionSeed.durationSec ?? (conditionSeed.kind === "team_shot_on_target" ? 300 : 600)),
        openingObservation: conditionSeed.openingObservation ?? (conditionSeed.kind === "team_shot_on_target"
          ? {
              eventId: room.matchStats.sourceEventId,
              providerSequence: room.lastNormalizedEvent?.providerSequence ?? null,
              shotsOnTarget: room.matchStats[conditionSeed.targetSide === "away" ? "away" : "home"].shotsOnTarget,
              matchClockSec,
              observedAt: room.lastNormalizedEvent?.occurredAt ?? nowIso(),
            }
          : {
              eventId: room.lastNormalizedEvent?.id ?? null,
              providerSequence: room.lastNormalizedEvent?.providerSequence ?? null,
              homeScore: room.match.homeScore,
              awayScore: room.match.awayScore,
              matchClockSec,
              observedAt: room.lastNormalizedEvent?.occurredAt ?? nowIso(),
            }),
      };
      room.currentRound = {
        ...room.currentRound,
        state: "expired",
        resolution: { ...room.currentRound.resolution, condition: repairCondition },
      };
      await appendDomainEvents(room, [domainEvent(room, "round.terminal_repair_started", {
        roundId: repair.roundId,
        fromState: room.currentRound.state,
        reason: "finished_match_missing_round_resolution",
        condition: repairCondition,
      }, {
        idempotencyKey: `round-terminal-repair:${repair.roomId}:${repair.roundId}`,
      })]);
      await applyNormalizedEvent(repair.roomId, {
        id: `terminal-repair:${repair.roomId}:${repair.roundId}`,
        matchId: repair.roomId,
        type: "match_end",
        sequence: 0,
        occurredAt: nowIso(),
        matchClockSec,
        absoluteScore: { home: room.match.homeScore, away: room.match.awayScore },
        payload: { Status: "finished", authority: "verified_ledger_repair" },
        source: "verified-playback",
      }, {
        acquisitionOrigin: "verified_playback",
        terminalRepairRoundId: repair.roundId,
      });
    }
    return { rooms: streamIds.size, events: eventCount };
  }

  async function publicEvents(roomId) {
    if (!eventStore) return [];
    const events = [];
    for await (const event of eventStore.readStream(roomId)) {
      events.push(redactInternalEvent(event));
    }
    return events;
  }

  async function hasPublicRoom(roomId) {
    if (rooms.has(String(roomId))) return true;
    if (!eventStore) return false;
    for await (const _event of eventStore.readStream(String(roomId))) {
      return true;
    }
    return false;
  }

  function comparableSnapshot(room) {
    const snapshotValue = publicSnapshot(room, null);
    return {
      ...snapshotValue,
      serverTime: undefined,
      version: undefined,
      latestEvidence: undefined,
      evidenceHistory: [],
      currentParticipant: null,
      participants: snapshotValue.participants.map(({ isCurrentUser, ...participant }) => participant),
      leaderboard: snapshotValue.leaderboard.map(({ isCurrentUser, ...entry }) => entry),
    };
  }

  async function verifyRoom(roomId) {
    const events = [];
    let hashChainValid = true;
    let previousHash = null;
    if (eventStore) {
      for await (const event of eventStore.readStream(roomId)) {
        const expectedHash = hashStoredEvent(event);
        if (event.previousStreamEventHash !== previousHash || event.eventHash !== expectedHash) hashChainValid = false;
        previousHash = event.eventHash;
        events.push(event);
      }
    }
    const liveRoom = rooms.get(roomId);
    if (!liveRoom && events.length === 0) {
      const error = new Error("room_not_found");
      error.status = 404;
      error.body = { roomId };
      throw error;
    }
    if (!liveRoom) {
      await projectRoomFromLedger(roomId);
    }
    const room = rooms.get(roomId);
    if (!room) {
      const error = new Error("room_projection_unavailable");
      error.status = 500;
      error.body = { roomId };
      throw error;
    }
    const liveSnapshot = comparableSnapshot(room);
    const replayRoom = resetRoomForReplay(`__verify__${roomId}`, roomId);
    replayRoom.roomId = roomId;
    for (const event of events) applyStoredEventToRoom(replayRoom, event);
    const replaySnapshot = comparableSnapshot(replayRoom);
    rooms.delete(`__verify__${roomId}`);
    const liveProjectionHash = projectionHash(liveSnapshot);
    const replayedProjectionHash = projectionHash(replaySnapshot);
    const rankingMatches = projectionHash(liveSnapshot.leaderboard) === projectionHash(replaySnapshot.leaderboard);
    const authorityValid = !events.some((event) => event.type === "txline.event.accepted" && event.payload?.acquisitionOrigin === "internal_test");
    return {
      roomId,
      status: hashChainValid && liveProjectionHash === replayedProjectionHash && authorityValid ? "verified" : "diverged",
      eventCount: events.length,
      streamVersion: events[events.length - 1]?.streamVersion ?? 0,
      ledgerHeadHash: previousHash,
      hashChainValid,
      replaySucceeded: true,
      liveProjectionHash,
      replayedProjectionHash,
      projectionMatches: liveProjectionHash === replayedProjectionHash,
      rankingMatches,
      authorityValid,
      schemaVersion: 1,
    };
  }

  async function verifiedRoundReplay(roomId, roundId) {
    return withRoomLock(roomId, async () => {
      if (!eventStore) {
        const error = new Error("round_replay_event_store_required");
        error.status = 503;
        throw error;
      }
      const events = [];
      for await (const event of eventStore.readStream(roomId)) events.push(event);
      if (!events.length) {
        const error = new Error("room_not_found");
        error.status = 404;
        throw error;
      }
      return deriveVerifiedRoundReplay(events, roundId, await verifyRoom(roomId));
    });
  }

  async function commitmentEvents(roomId, roundId) {
    const events = [];
    if (!eventStore) return events;
    for await (const event of eventStore.readStream(roomId)) {
      if (String(event.payload?.roundId ?? "") === String(roundId) && event.type.startsWith("round.commitment.")) events.push(event);
    }
    return events;
  }

  async function roundCommitment(roomId, roundId) {
    const events = await commitmentEvents(roomId, roundId);
    const confirmed = events.findLast((event) => event.type === "round.commitment.confirmed");
    const failed = events.findLast((event) => event.type === "round.commitment.failed");
    const requested = events.findLast((event) => event.type === "round.commitment.requested");
    if (confirmed) return { status: "confirmed", ...confirmed.payload };
    if (pendingCommitments.has(`${roomId}:${roundId}`)) return { status: "confirming", ...(requested?.payload ?? {}), network: commitmentPublisher?.network ?? "devnet" };
    if (failed) return { status: "failed", ...failed.payload };
    if (requested) return { status: "pending", ...requested.payload };
    if (!commitmentPublisher?.enabled) return { status: "unsupported", roomId, roundId, network: "unsupported" };
    return { status: "pending", roomId, roundId, network: commitmentPublisher.network };
  }

  async function prepareRoundCommitment(roomId, roundId) {
    const events = [];
    for await (const event of eventStore.readStream(roomId)) events.push(event);
    const replay = deriveVerifiedRoundReplay(events, roundId, await verifyRoom(roomId));
    return deriveRoundCommitment(events, replay);
  }

  async function publishRoundCommitment(roomId, roundId) {
    if (!commitmentPublisher?.enabled || !eventStore) return roundCommitment(roomId, roundId);
    const key = `${roomId}:${roundId}`;
    if (pendingCommitments.has(key)) return roundCommitment(roomId, roundId);
    pendingCommitments.add(key);
    let commitment = null;
    try {
      const existing = await commitmentEvents(roomId, roundId);
      if (existing.some((event) => event.type === "round.commitment.confirmed")) return roundCommitment(roomId, roundId);
      commitment = await withRoomLock(roomId, async () => {
        const prepared = await prepareRoundCommitment(roomId, roundId);
        if (!existing.some((event) => event.type === "round.commitment.requested")) {
          const room = getRoom(roomId);
          await appendDomainEvents(room, [domainEvent(room, "round.commitment.requested", {
            roundId,
            commitmentHash: prepared.commitmentHash,
            payload: prepared.payload,
            canonicalHex: prepared.canonicalHex,
            requestedAt: nowIso(),
            network: commitmentPublisher.network,
          }, { idempotencyKey: `round-commitment-requested:${prepared.commitmentHash}` })]);
        }
        return prepared;
      });
      const receipt = await commitmentPublisher.publish(commitment);
      await withRoomLock(roomId, async () => {
        const room = getRoom(roomId);
        await appendDomainEvents(room, [domainEvent(room, "round.commitment.confirmed", {
          roundId,
          commitmentHash: commitment.commitmentHash,
          replayHash: commitment.payload.replayHash,
          ...receipt,
        }, { idempotencyKey: `round-commitment-confirmed:${commitment.commitmentHash}` })]);
      });
    } catch (error) {
      if (commitment) {
        await withRoomLock(roomId, async () => {
          const room = getRoom(roomId);
          await appendDomainEvents(room, [domainEvent(room, "round.commitment.failed", {
            roundId,
            commitmentHash: commitment.commitmentHash,
            replayHash: commitment.payload.replayHash,
            network: commitmentPublisher.network,
            failedAt: nowIso(),
            reason: String(error?.message ?? "solana_commitment_failed").slice(0, 160),
          }, { idempotencyKey: `round-commitment-failed:${commitment.commitmentHash}:${Date.now()}` })]);
        });
      }
    } finally {
      pendingCommitments.delete(key);
    }
    return roundCommitment(roomId, roundId);
  }

  function scheduleRoundCommitment(roomId, roundId) {
    if (!commitmentPublisher?.enabled) return;
    const timer = setTimeout(() => void publishRoundCommitment(roomId, roundId), 0);
    timer.unref?.();
  }

  async function applyNormalizedEvent(roomId, normalizedEvent, acquisition = {}) {
    return withRoomLock(roomId, async () => {
    const room = getRoom(roomId);
    const activeRound = room.currentRound;
    if (normalizedEvent.type === "odds_shift" && activeRound?.state === "open" && activeRound.locksAt && Date.now() < Date.parse(activeRound.locksAt)) {
      return snapshot(roomId);
    }
    if (normalizedEvent.type === "odds_shift" && activeRound?.state === "locked") {
      if (activeRound.resolution?.domain === "football") return snapshot(roomId);
      const predicate = activeRound.resolution?.predicate ?? {};
      const payload = normalizedEvent.payload ?? {};
      const signatureMatches = !predicate.marketSignature || marketSignatureFromPayload(payload) === predicate.marketSignature;
      const marketMatches = !predicate.market || payload.SuperOddsType === predicate.market;
      const lineMatches = predicate.line === undefined || predicate.line === null || payload.MarketParameters === predicate.line;
      const periodMatches = predicate.period === undefined || predicate.period === null || payload.MarketPeriod === predicate.period;
      if (!signatureMatches || !marketMatches || !lineMatches || !periodMatches) return snapshot(roomId);
    }
    const previousVersion = room.version;
    const evidenceId = shortId("evc");
    const correlationId = shortId("corr");
    const providerSequence = normalizedEvent.sequence || normalizedEvent.payload?.Seq || normalizedEvent.payload?.seq || undefined;
    const providerSequenceNumber = Number(providerSequence);
    const localSequence = nextLocalSequence++;
    const acquisitionOrigin = acquisition.acquisitionOrigin ?? (normalizedEvent.source === "txline-live" ? "txline_live_stream" : normalizedEvent.source === "txline-snapshot" ? "txline_snapshot" : "verified_playback");
    const event = {
      ...normalizedEvent,
      acquisitionOrigin,
      receivedAt: acquisition.receivedAt ?? normalizedEvent.receivedAt ?? nowIso(),
      providerSequence,
      localSequence,
      sequence: localSequence,
      matchClockSec: normalizedEvent.type === "match_end"
        ? Math.max(Number(normalizedEvent.matchClockSec) || 0, Number(getRoom(roomId).match.matchClockSec) || 0, 90 * 60)
        : normalizedEvent.matchClockSec || getRoom(roomId).match.matchClockSec || 0,
      source: normalizedEvent.source === "txline-live" && normalizedEvent.payload?.txlineEndpoint?.includes("/snapshot/")
        ? "txline-snapshot"
        : normalizedEvent.source,
      consumerPresentationSuppressed: acquisition.suppressConsumerPresentation === true,
      stateReconciliationOnly: acquisition.reconciliationOnly === true && normalizedEvent.type !== "match_end",
    };
    const evidenceBase = {
      id: evidenceId,
      correlationId,
      createdAt: nowIso(),
      input: createEvidenceInput(room, event, acquisition),
      normalization: {
        eventId: event.id,
        sourceInputRequestId: acquisition.requestId ?? event.payload?.txlineRequestId ?? null,
        type: event.type,
        source: event.source,
        localSequence,
        providerSequence,
        matchClockSec: event.matchClockSec,
        teamId: event.teamId,
        normalizedValues: event.type === "odds_shift" && Array.isArray(event.payload?.Pct)
          ? (() => {
              const probabilityByPriceName = probabilityMapFromPayload(event.payload);
              return {
              homeProbability: probabilityByPriceName.part1,
              drawProbability: probabilityByPriceName.draw,
              awayProbability: probabilityByPriceName.part2,
              probabilityByPriceName,
              marketType: event.payload.SuperOddsType ? String(event.payload.SuperOddsType) : undefined,
              line: event.payload.MarketParameters ?? null,
              period: event.payload.MarketPeriod ?? null,
              priceNames: Array.isArray(event.payload.PriceNames) ? event.payload.PriceNames.map(String) : undefined,
            }; })()
          : {},
      },
      ruleEvaluation: ruleEvaluationFor(room.currentRound, event),
      outputs: [],
      status: "normalized",
    };
    const receiptId = shortId("receipt");
    const receivedDomainEvent = domainEvent(room, "txline.event.received", {
      receiptId,
      providerEventId: event.id,
      providerSequence,
      endpoint: evidenceBase.input.endpoint,
      rawPayloadHash: evidenceBase.input.rawPayloadHash,
      normalizedObservation: event,
      acquisitionOrigin,
    }, {
      idempotencyKey: `txline-received:${room.roomId}:${receiptId}`,
      correlationId,
    });

    if (room.appliedEventIds.has(event.id)) {
      const evidence = {
        ...evidenceBase,
        status: "ignored",
        ruleEvaluation: {
          ...evidenceBase.ruleEvaluation,
          predicateResult: false,
          ignoredReason: "duplicate_event_id",
        },
      };
      await appendDomainEvents(room, [
        receivedDomainEvent,
        domainEvent(room, "txline.event.ignored", {
          receiptEventId: receivedDomainEvent.eventId,
          providerEventId: event.id,
          reason: "duplicate_event_id",
          evidence,
        }, {
          idempotencyKey: `txline-ignored:${room.roomId}:${receiptId}`,
          causationId: receivedDomainEvent.eventId,
          correlationId,
        }),
      ]);
      appendEvidence(room, evidence);
      emit(roomId, "txline.event_ignored", { reason: "duplicate_event_id", event, evidenceId });
      return snapshot(roomId);
    }

    if (room.match.status === "finished" && event.type !== "match_end") {
      const evidence = {
        ...evidenceBase,
        status: "ignored",
        ruleEvaluation: {
          ...evidenceBase.ruleEvaluation,
          predicateResult: false,
          ignoredReason: "match_already_finished",
        },
      };
      await appendDomainEvents(room, [
        receivedDomainEvent,
        domainEvent(room, "txline.event.ignored", {
          receiptEventId: receivedDomainEvent.eventId,
          providerEventId: event.id,
          reason: "match_already_finished",
          evidence,
        }, {
          idempotencyKey: `txline-ignored:${room.roomId}:${receiptId}`,
          causationId: receivedDomainEvent.eventId,
          correlationId,
        }),
      ]);
      appendEvidence(room, evidence);
      emit(roomId, "txline.event_ignored", { reason: "match_already_finished", event, evidenceId });
      return snapshot(roomId);
    }

    const providerSequenceKey = eventProviderSequenceKey(event);
    const lastProviderSequence = room.providerSequences.get(providerSequenceKey);
    if (Number.isFinite(providerSequenceNumber) && Number.isFinite(lastProviderSequence) && providerSequenceNumber < lastProviderSequence) {
      const evidence = {
        ...evidenceBase,
        status: "ignored",
        ruleEvaluation: {
          ...evidenceBase.ruleEvaluation,
          predicateResult: false,
          ignoredReason: "stale_provider_sequence",
        },
      };
      await appendDomainEvents(room, [
        receivedDomainEvent,
        domainEvent(room, "txline.event.ignored", {
          receiptEventId: receivedDomainEvent.eventId,
          providerEventId: event.id,
          reason: "stale_provider_sequence",
          evidence,
        }, {
          idempotencyKey: `txline-ignored:${room.roomId}:${receiptId}`,
          causationId: receivedDomainEvent.eventId,
          correlationId,
        }),
      ]);
      appendEvidence(room, evidence);
      emit(roomId, "txline.event_ignored", { reason: "stale_provider_sequence", event, evidenceId });
      return snapshot(roomId);
    }

    const sequenceWarning = Number.isFinite(providerSequenceNumber)
      && Number.isFinite(lastProviderSequence)
      && providerSequenceNumber > lastProviderSequence + 1
      ? {
          type: "sequence_gap_detected",
          providerSequenceKey,
          previousProviderSequence: lastProviderSequence,
          currentProviderSequence: providerSequenceNumber,
        }
      : null;

    await appendDomainEvents(room, [
      receivedDomainEvent,
      domainEvent(room, "txline.event.accepted", {
        receiptEventId: receivedDomainEvent.eventId,
        providerEventId: event.id,
        providerSequence,
        event,
        acquisitionOrigin,
        sequenceWarning,
      }, {
        idempotencyKey: `txline-accepted:${room.roomId}:${event.id}`,
        causationId: receivedDomainEvent.eventId,
        correlationId,
      }),
    ]);

    room.appliedEventIds.add(event.id);
    if (Number.isFinite(providerSequenceNumber)) room.providerSequences.set(providerSequenceKey, providerSequenceNumber);
    if (sequenceWarning) room.sequenceWarnings.unshift(sequenceWarning);
    room.lastSequence = localSequence;
    room.lastNormalizedEvent = event;
    room.connectionState = "live";
    room.source = event.source;
    room.match.matchClockSec = event.matchClockSec || room.match.matchClockSec;
    if (room.match.status !== "finished" && (event.payload?.StatusId === 2 || event.payload?.Clock?.Running === true)) room.match.status = "live";
    if (room.match.status !== "finished") {
      reanchorOpenRoundFromLiveOdds(room, event);
      updateMarketDistribution(room, event);
    }
    applyAuthoritativeScore(room, event);
    const footballStatEvents = applyFootballEventStats(room, event, correlationId);
    if (footballStatEvents.length) await appendDomainEvents(room, footballStatEvents);
    const evaluationEvent = { ...withConsolidatedScore(room, event), authoritativeStats: cloneJson(room.matchStats) };
    const footballConditionEvents = event.stateReconciliationOnly ? [] : advanceFootballCondition(room, evaluationEvent, correlationId);
    if (footballConditionEvents.length) await appendDomainEvents(room, footballConditionEvents);
    const consumerEventVisible = consumeConsumerVisibleMatchEvent(room, event) && event.consumerPresentationSuppressed !== true;
    const matchMomentEventVisible = consumerEventVisible
      || (event.type === "possession" && Boolean(event.possession) && event.consumerPresentationSuppressed !== true);
    const timelineEntryId = event.type === "match_end" ? `timeline-match-finished-${event.id}` : `timeline-${event.id}`;
    if (event.type !== "match_end" && consumerEventVisible) {
      pushTimeline(room, {
        id: timelineEntryId,
        matchClockSec: event.matchClockSec,
        title: event.type === "goal" ? "Gol confirmado" : event.type === "card" ? "Cartao confirmado" : event.type === "odds_shift" ? "Mercado TxLINE atualizado" : "Evento TxLINE recebido",
        description: `Evento ${event.type} aplicado ao runtime da sala.`,
        tone: event.type === "goal" ? "success" : "info",
      });
    }
    const currentRuleEvaluation = ruleEvaluationFor(room.currentRound, evaluationEvent);
    if (!event.stateReconciliationOnly && room.currentRound?.state === "open") {
      const deadlineElapsed = room.currentRound.locksAt && Date.now() >= Date.parse(room.currentRound.locksAt);
      if (deadlineElapsed || event.type === "match_end") {
        await lockCurrentRound(room, event.type === "match_end" ? "match_finished" : "deadline_elapsed", { causationId: event.id, correlationId });
      }
    }
    const repairExpiredRound = acquisition.terminalRepairRoundId === room.currentRound?.id
      && event.type === "match_end"
      && event.acquisitionOrigin === "verified_playback";
    const resolution = event.stateReconciliationOnly
      ? null
      : resolveCurrentRound(room, evaluationEvent, { repairExpiredRound });
    const directedRound = event.stateReconciliationOnly || resolution || event.type === "match_end" ? null : maybeOpenDirectedFootballRound(room, evaluationEvent);
    if (resolution) {
      await appendDomainEvents(room, [
        ...(resolution.resolutionDomain === "football" && resolution.resolutionReason === "window_expired"
          ? [domainEvent(room, "football.condition.expired", {
              roundId: resolution.roundId,
              condition: resolution.condition,
              observation: event,
            }, {
              idempotencyKey: `football-condition-expired:${room.roomId}:${resolution.roundId}`,
              causationId: event.id,
              correlationId,
            })]
          : []),
        domainEvent(room, "round.resolved", {
          roundId: resolution.roundId,
          roundVersion: resolution.roundVersion,
          causedByTxlineEventId: event.id,
          winningOptionId: resolution.winningOptionId,
          resolvedBy: resolution.resolvedBy,
          resolutionDomain: resolution.resolutionDomain,
          resolutionReason: resolution.resolutionReason,
          condition: resolution.condition,
          answersEvaluated: resolution.answersEvaluated,
          answersCorrect: resolution.answersCorrect,
          totalPointsApplied: resolution.totalPointsApplied,
          awards: (resolution.scoreOutputs ?? []).map((output) => ({
            participantId: output.participantId,
            displayName: output.displayName,
            points: output.delta,
            previousScore: output.previousScore,
            currentScore: output.currentScore,
            correct: output.delta > 0,
          })),
          event: resolution.event,
        }, {
          idempotencyKey: `round-resolved:${room.roomId}:${resolution.roundId}:${event.id}`,
          causationId: event.id,
          correlationId,
        }),
        ...(room.currentRound && room.currentRound.id !== resolution.roundId
          ? [domainEvent(room, "round.opened", {
              round: room.currentRound,
              causedByResolutionRoundId: resolution.roundId,
              causedByEventId: event.id,
              timelineEntryId: `timeline-${room.currentRound.id}-open-${event.id}`,
              timelineMatchClockSec: room.currentRound.opensAtClockSec,
            }, {
              idempotencyKey: `round-opened:${room.roomId}:${room.currentRound.id}`,
              causationId: event.id,
              correlationId,
            })]
          : []),
      ]);
      scheduleRoundCommitment(room.roomId, resolution.roundId);
    }
    if (event.type === "match_end") {
      finishMatch(room, evaluationEvent);
      await appendDomainEvents(room, [domainEvent(room, "match.finished", {
        fixtureId: room.roomId,
        reason: "txline_game_finalised",
        causedByEventId: event.id,
        event: evaluationEvent,
      }, {
        idempotencyKey: `match-finished:${room.roomId}:${room.roomId}`,
        causationId: event.id,
        correlationId,
      })]);
    }
    if (directedRound) {
      await appendDomainEvents(room, [domainEvent(room, "round.opened", {
        round: directedRound,
        causedByEventId: event.id,
        timelineEntryId: `timeline-${directedRound.id}-open-${event.id}`,
        timelineMatchClockSec: directedRound.opensAtClockSec,
      }, {
        idempotencyKey: `round-opened:${room.roomId}:${directedRound.id}`,
        causationId: event.id,
        correlationId,
      })]);
    }
    room.version += 1;
    const outputs = [
      { type: "timeline.created", timelineEntryId },
      ...(resolution?.scoreOutputs ?? []),
      {
        type: "leaderboard.updated",
        previousVersion,
        currentVersion: room.version,
      },
    ];
    if (matchMomentEventVisible) {
      const eventEmit = emit(roomId, "match.event_received", event);
      outputs.push({ type: "sse.emitted", eventId: eventEmit.eventId, eventName: "match.event_received", clientCount: eventEmit.clientCount });
    }
    if (resolution) {
      const resolutionEmit = emit(roomId, "round.resolved", resolution);
      outputs.push({ type: "sse.emitted", eventId: resolutionEmit.eventId, eventName: "round.resolved", clientCount: resolutionEmit.clientCount });
    }
    const evidence = {
      ...evidenceBase,
      ruleEvaluation: currentRuleEvaluation,
      sequenceWarning,
      resolution: resolution
        ? {
            resolutionId: shortId("res"),
            roundId: resolution.roundId,
            causedByEventId: event.id,
            winningOptionId: resolution.winningOptionId,
            resolvedBy: resolution.resolvedBy === "window" ? "window_elapsed" : resolution.resolvedBy,
            answersEvaluated: resolution.answersEvaluated,
            answersCorrect: resolution.answersCorrect,
            totalPointsApplied: resolution.totalPointsApplied,
            idempotencyKey: `${resolution.roundId}:${event.id}`,
          }
        : undefined,
      outputs,
      status: resolution ? "resolved" : currentRuleEvaluation.predicateResult ? "matched" : "normalized",
    };
    appendEvidence(room, evidence);
    const snapshotEmit = emitRoomSnapshot(roomId);
    evidence.outputs.push({ type: "sse.emitted", eventId: snapshotEmit.eventId, eventName: "room.snapshot", clientCount: snapshotEmit.clientCount });
    return snapshot(roomId);
    });
  }

  function attachClient(roomId, response, participantId = null) {
    if (!clients.has(roomId)) clients.set(roomId, new Map());
    clients.get(roomId).set(response, participantId);
    response.write("event: room.snapshot\n");
    response.write(`data: ${JSON.stringify(snapshot(roomId, null))}\n\n`);
    const heartbeat = setInterval(() => {
      response.write(`: vira-heartbeat ${Date.now()}\n\n`);
    }, 15_000);
    response.on("close", () => {
      clearInterval(heartbeat);
      clients.get(roomId)?.delete(response);
    });
  }

  function operationalMetrics() {
    let sseClients = 0;
    for (const roomClients of clients.values()) sseClients += roomClients.size;
    return {
      roomsActive: [...rooms.values()].filter((room) => room.match.status !== "finished").length,
      roomsTotal: rooms.size,
      participants: [...rooms.values()].reduce((total, room) => total + room.participants.length, 0),
      roundsOpen: [...rooms.values()].filter((room) => room.currentRound?.state === "open").length,
      sseClients,
      queueDepth: roomLocks.size,
      roundTimers: roundTimers.size,
      pendingCommitments: pendingCommitments.size,
    };
  }

  function publicRoomSummaries() {
    return [...rooms.values()].map((room) => {
      const value = publicSnapshot(room, null);
      return { roomId: room.roomId, match: value.match, roomPopulation: value.roomPopulation, lastResolution: value.lastResolution, ledger: value.ledger };
    });
  }

  return { getRoom, snapshot, authenticatedSnapshot, join, validateSession, submitAnswer, castFanPulse, applyNormalizedEvent, attachClient, emit, configureMatch, evidence, evidenceById, rehydrateFromLedger, publicEvents, hasPublicRoom, projectRoomFromLedger, verifyRoom, verifiedRoundReplay, roundCommitment, publishRoundCommitment, operationalMetrics, publicRoomSummaries };
}
