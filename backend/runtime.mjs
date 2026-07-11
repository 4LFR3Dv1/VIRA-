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
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
  };
}

function roundSeedsForMatch(match) {
  return [
    {
      ...roundSeeds[0],
      answerWindowSec: DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      matchId: match.id,
      title: `${match.homeTeam.name} chega a 55% ou mais no proximo sinal?`,
      contextLabel: "Mercado 1X2 · proximo sinal elegivel",
      resolution: {
        mode: "first_matching_event",
        eventType: "odds_shift",
        predicate: {
          market: "1X2_PARTICIPANT_RESULT",
          side: "home",
          pctGte: 55,
        },
      },
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
    const lockedRound = { ...round, state: "locked", lockedAt, lockReason: reason, version: (Number(round.version) || 1) + 1 };
    await appendDomainEvents(room, [domainEvent(room, "round.locked", {
      roundId: round.id,
      roundVersion: lockedRound.version,
      lockedAt,
      reason,
    }, {
      idempotencyKey: `round-locked:${room.roomId}:${round.id}`,
      causationId: options.causationId,
      correlationId: options.correlationId,
    })]);
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
    const initialRound = match.status === "finished" ? null : openedRound({ ...matchRounds[0] });
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
      source: undefined,
      lastNormalizedEvent: null,
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
      homeTeam: teamFromName("home", matchSummary.homeTeam, "#caff28"),
      awayTeam: teamFromName("away", matchSummary.awayTeam, "#71b9e8"),
    });
    if (context?.suggestedPrediction) dynamicPredictionSeeds.set(roomId, context.suggestedPrediction);

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const updatedMatch = matchForRoom(roomId);
      const updatedRounds = roundSeedsForMatch(updatedMatch);
      room.match = {
        ...room.match,
        title: updatedMatch.title,
        competitionLabel: updatedMatch.competitionLabel,
        status: updatedMatch.status,
        startTime: updatedMatch.startTime,
        homeTeam: updatedMatch.homeTeam,
        awayTeam: updatedMatch.awayTeam,
      };
      if (updatedMatch.status === "finished" && room.currentRound) {
        room.currentRound = { ...room.currentRound, state: "expired" };
      }
      room.roomLabel = `Sala VIRA · ${updatedMatch.title}`;
      if (room.currentRound && room.currentRound.id === updatedRounds[0].id && room.currentRound.state !== "resolved") {
        room.currentRound = {
          ...updatedRounds[0],
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
    }
  }

  function applySuggestedPrediction(room, suggestedPrediction) {
    if (!suggestedPrediction || !room.currentRound || room.currentRound.state !== "open") return;
    if (room.match.status === "finished") return;
    if (Object.keys(currentRoundAnswers(room)).length > 0) return;
    room.currentRound = {
      ...room.currentRound,
      title: suggestedPrediction.prompt,
      contextLabel: `Mercado · ${suggestedPrediction.marketType}`,
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
    if (latestOpen) latestOpen.description = suggestedPrediction.prompt;
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
    return `${event.source ?? "txline"}:${event.type}:${payload.FixtureId ?? event.matchId ?? "fixture"}`;
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
      roomId: room.roomId,
      roomLabel: room.roomLabel,
      roomPopulation: room.participants.length,
      match: room.match,
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

  async function join(roomId, displayName) {
    return withRoomLock(roomId, async () => {
      const room = getRoom(roomId);
      const safeName = String(displayName || "Fan").trim().slice(0, 40) || "Fan";
      const participant = {
        id: `participant-${crypto.randomUUID()}`,
        displayName: safeName,
        initials: safeName.slice(0, 1).toUpperCase(),
        accent: "bg-primary",
        joinedAt: nowIso(),
      };
      const sessionToken = crypto.randomUUID();
      const tokenHash = sessionTokenHash(sessionToken);
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
      return { participant, sessionToken, roomVersion: room.version };
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

  function resolveCurrentRound(room, event) {
    const round = room.currentRound;
    if (!round || round.state !== "locked") return null;
    const answersForRound = room.answersByRound[round.id] ?? {};
    const winningOptionId = winningOptionFor(round, event);
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
    const resolvedRound = { ...round, state: "resolved", version: (Number(round.version) || 1) + 1 };
    room.currentRound = resolvedRound;
    room.lastResolution = {
      roundId: round.id,
      winningOptionId,
      wasCurrentUserCorrect: false,
      pointsAwarded: currentUserDelta,
      streakAfterResolve: 0,
      movementLabel: "ranking atualizado",
      resolvedBy: round.resolution.mode === "window_elapsed" ? "window" : "event",
      event,
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

  function alignOpenRoundToLiveClock(room, event) {
    if (!room.currentRound || room.currentRound.state !== "open" || !event.matchClockSec) return;
    if (Object.keys(currentRoundAnswers(room)).length > 0) return;

    const secondsRemaining = room.currentRound.locksAtClockSec - event.matchClockSec;
    const shouldRealign = room.currentRound.opensAtClockSec > event.matchClockSec || secondsRemaining > 180 || secondsRemaining <= 0;
    if (!shouldRealign) return;

    room.currentRound = {
      ...room.currentRound,
      opensAtClockSec: event.matchClockSec,
      locksAtClockSec: event.matchClockSec + DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      answerWindowSec: DEFAULT_ROUND_ANSWER_WINDOW_SEC,
      version: (Number(room.currentRound.version) || 1) + 1,
      openedAt: new Date(eventServerTimeMs(event)).toISOString(),
      locksAt: new Date(eventServerTimeMs(event) + DEFAULT_ROUND_ANSWER_WINDOW_SEC * 1_000).toISOString(),
    };
    scheduleRoundLock(room);
    const openEntry = room.timeline.find((item) => item.id === "timeline-round-1-open");
    if (openEntry) openEntry.matchClockSec = event.matchClockSec;
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
    if (room.currentRound) {
      room.currentRound = {
        ...room.currentRound,
        state: "expired",
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
    room.source = undefined;
    room.lastNormalizedEvent = null;
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
        room.currentRound = {
          ...room.currentRound,
          state: "locked",
          version: payload.roundVersion ?? (Number(room.currentRound.version) || 1) + 1,
          lockedAt: payload.lockedAt ?? storedEvent.createdAt,
          lockReason: payload.reason ?? "ledger_replay",
        };
        pushTimeline(room, { id: `timeline-${payload.roundId}-locked`, matchClockSec: room.match.matchClockSec, title: "Respostas encerradas", description: "Somente respostas confirmadas antes do fechamento participam do resultado.", tone: "info" });
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
          alignOpenRoundToLiveClock(room, event);
          reanchorOpenRoundFromLiveOdds(room, event);
          updateMarketDistribution(room, event);
        }
        if (event.type === "goal" && event.teamId === room.match.homeTeam.id) room.match.homeScore += 1;
        if (event.type === "goal" && event.teamId === room.match.awayTeam.id) room.match.awayScore += 1;
        if (event.type !== "match_end") {
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
          room.currentRound = { ...room.currentRound, state: "resolved" };
        }
        room.lastResolution = {
          roundId,
          winningOptionId,
          wasCurrentUserCorrect: false,
          pointsAwarded: 0,
          streakAfterResolve: 0,
          movementLabel: "ranking atualizado",
          resolvedBy: payload.resolvedBy ?? "event",
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
      if (commitmentPublisher?.enabled) {
        for await (const event of eventStore.readStream(streamId)) {
          if (event.type === "round.resolved" && event.payload?.roundId) scheduleRoundCommitment(streamId, String(event.payload.roundId));
        }
      }
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
      matchClockSec: normalizedEvent.matchClockSec || getRoom(roomId).match.matchClockSec || 0,
      source: normalizedEvent.source === "txline-live" && normalizedEvent.payload?.txlineEndpoint?.includes("/snapshot/")
        ? "txline-snapshot"
        : normalizedEvent.source,
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
      ...(event.type === "match_end"
        ? [domainEvent(room, "match.finished", {
            fixtureId: room.roomId,
            reason: "txline_game_finalised",
            causedByEventId: event.id,
            event,
          }, {
            idempotencyKey: `match-finished:${room.roomId}:${room.roomId}`,
            causationId: receivedDomainEvent.eventId,
            correlationId,
          })]
        : []),
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
    if (event.type === "match_end") finishMatch(room, event);
    if (room.match.status !== "finished") {
      alignOpenRoundToLiveClock(room, event);
      reanchorOpenRoundFromLiveOdds(room, event);
      updateMarketDistribution(room, event);
    }
    if (event.type === "goal" && event.teamId === room.match.homeTeam.id) room.match.homeScore += 1;
    if (event.type === "goal" && event.teamId === room.match.awayTeam.id) room.match.awayScore += 1;
    const timelineEntryId = event.type === "match_end" ? `timeline-match-finished-${event.id}` : `timeline-${event.id}`;
    if (event.type !== "match_end") {
      pushTimeline(room, {
        id: timelineEntryId,
        matchClockSec: event.matchClockSec,
        title: event.type === "goal" ? "Gol confirmado" : event.type === "card" ? "Cartao confirmado" : event.type === "odds_shift" ? "Mercado TxLINE atualizado" : "Evento TxLINE recebido",
        description: `Evento ${event.type} aplicado ao runtime da sala.`,
        tone: event.type === "goal" ? "success" : "info",
      });
    }
    const currentRuleEvaluation = ruleEvaluationFor(room.currentRound, event);
    if (room.currentRound?.state === "open") {
      const deadlineElapsed = room.currentRound.locksAt && Date.now() >= Date.parse(room.currentRound.locksAt);
      if (deadlineElapsed) {
        await lockCurrentRound(room, "deadline_elapsed", { causationId: event.id, correlationId });
      }
    }
    const resolution = resolveCurrentRound(room, event);
    if (resolution) {
      await appendDomainEvents(room, [
        domainEvent(room, "round.resolved", {
          roundId: resolution.roundId,
          causedByTxlineEventId: event.id,
          winningOptionId: resolution.winningOptionId,
          resolvedBy: resolution.resolvedBy,
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
          event,
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
    const eventEmit = emit(roomId, "match.event_received", event);
    outputs.push({ type: "sse.emitted", eventId: eventEmit.eventId, eventName: "match.event_received", clientCount: eventEmit.clientCount });
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

  return { getRoom, snapshot, authenticatedSnapshot, join, validateSession, submitAnswer, castFanPulse, applyNormalizedEvent, attachClient, emit, configureMatch, evidence, evidenceById, rehydrateFromLedger, publicEvents, hasPublicRoom, projectRoomFromLedger, verifyRoom, verifiedRoundReplay, roundCommitment, publishRoundCommitment };
}
