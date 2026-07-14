import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { NormalizedMatchEvent, PresentationEvent, ReplayState, RoomSnapshot, RoundResolutionResult } from "../domain/types";
import { createInitialReplayState } from "../replay/initial-state";
import {
  connectTxlineOddsStream,
  castRoomFanPulse,
  disconnectTxlineStream,
  fetchLatestTxlineOdds,
  fetchRoomState,
  fetchTxlineStreamStatus,
  joinRoom,
  roomEventsUrl,
  submitRoomAnswer,
  validateRoomSession,
} from "./api";
import { getPublicToken } from "../social/share";
import type { TxlineStreamStatus } from "./api";

interface RoomRuntimeControls {
  play: () => void;
  pause: () => void;
  restart: () => void;
  setSpeed: (speed: ReplayState["speed"]) => void;
  selectAnswer: (optionId: string) => void;
  submitAnswer: () => Promise<void>;
  castFanPulse: (side: "home" | "away") => Promise<void>;
  fetchLatestTxlineOdds: () => Promise<void>;
  connectOddsStream: () => Promise<void>;
  disconnectOddsStream: () => Promise<void>;
}

function withCurrentParticipant(snapshot: RoomSnapshot, participantId: string | null): RoomSnapshot {
  if (!participantId) return snapshot;
  return {
    ...snapshot,
    currentParticipant: snapshot.currentParticipant ?? snapshot.participants.find((participant) => participant.id === participantId) ?? null,
    participants: snapshot.participants.map((participant) => ({
      ...participant,
      isCurrentUser: participant.id === participantId,
    })),
    leaderboard: snapshot.leaderboard.map((entry) => ({
      ...entry,
      isCurrentUser: entry.participantId === participantId,
    })),
  };
}

function stateFromSnapshot(base: ReplayState, incomingSnapshot: RoomSnapshot, participantId: string | null): ReplayState {
  const roundChanged = base.snapshot.currentRound?.id !== incomingSnapshot.currentRound?.id;
  const preservedAnswer = roundChanged ? null : incomingSnapshot.currentParticipantAnswer ?? base.snapshot.currentParticipantAnswer ?? (participantId ? base.snapshot.answers[participantId] : null);
  const snapshot = withCurrentParticipant({
    ...incomingSnapshot,
    fanPulse: incomingSnapshot.fanPulse ? {
      ...incomingSnapshot.fanPulse,
      currentParticipantChoice: incomingSnapshot.fanPulse.currentParticipantChoice ?? base.snapshot.fanPulse?.currentParticipantChoice ?? null,
    } : base.snapshot.fanPulse,
    currentParticipantAnswer: preservedAnswer,
    answers: preservedAnswer && participantId ? { [participantId]: preservedAnswer } : {},
  }, participantId);
  const participantAnswer = participantId ? snapshot.answers[participantId] : null;
  const effectiveAnswerState = participantAnswer?.state ?? (roundChanged ? "not_answered" : base.currentAnswerState);
  const selected = participantAnswer?.optionId ?? (roundChanged ? null : base.selectedOptionId);
  const resolutionBelongsToCurrentRound = snapshot.lastResolution?.roundId === snapshot.currentRound?.id;
  const currentUiState = snapshot.match.status === "finished"
    ? "match_finished"
    : snapshot.lastResolution && resolutionBelongsToCurrentRound
      ? snapshot.lastResolution.wasCurrentUserCorrect ? "resolved_success" : "resolved_failure"
      : effectiveAnswerState === "submitted"
        ? "awaiting_resolution"
        : snapshot.currentRound?.state === "awaiting_event"
          ? "awaiting_resolution"
          : "prediction_open";

  return {
    ...base,
    status: snapshot.connectionState === "live" ? "playing" : base.status,
    snapshot,
    selectedOptionId: selected,
    currentAnswerState: effectiveAnswerState,
    currentUiState,
    lastResolution: snapshot.lastResolution ?? null,
  };
}

function displayNameFromSession(roomId: string, fallbackName?: string | null) {
  const storageKey = `vira:${roomId}:displayName`;
  return window.localStorage.getItem(storageKey) || window.localStorage.getItem("vira:displayName") || fallbackName?.trim() || null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function presentationStorageKey(roomId: string) {
  return `vira:${roomId}:presentedEvents`;
}

function marketValueFromSnapshot(snapshot: RoomSnapshot) {
  return numberOrNull(snapshot.marketDistribution.yes)
    ?? numberOrNull(snapshot.currentRound?.resolution.predicate?.openingValue)
    ?? null;
}

function marketValueFromEvent(event: NormalizedMatchEvent, snapshot: RoomSnapshot) {
  const payload = event.payload ?? {};
  const priceNames = Array.isArray(payload.PriceNames) ? payload.PriceNames.map(String) : [];
  const pct = Array.isArray(payload.Pct) ? payload.Pct : [];
  const predicate = snapshot.currentRound?.resolution.predicate ?? {};
  const priceName = typeof predicate.priceName === "string"
    ? predicate.priceName
    : predicate.side === "away"
      ? "part2"
      : predicate.side === "draw"
        ? "draw"
        : "part1";
  const index = priceNames.findIndex((name) => name.toLowerCase() === priceName);
  return numberOrNull(pct[index >= 0 ? index : 0]);
}

export function useRoomRuntime(roomId: string, displayName?: string | null) {
  const effectiveDisplayName = displayNameFromSession(roomId, displayName);
  const [participantId, setParticipantId] = useState<string | null>(() => window.sessionStorage.getItem(`vira:${roomId}:participantId`));
  const [sessionToken, setSessionToken] = useState<string | null>(() => window.sessionStorage.getItem(`vira:${roomId}:sessionToken`));
  const [admissionToken] = useState(() => {
    const key = `vira:${roomId}:admissionToken`;
    const existing = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    if (existing) {
      window.localStorage.setItem(key, existing);
      return existing;
    }
    const created = window.crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  });
  const [inviteCode] = useState(() => new URLSearchParams(window.location.search).get("invite"));
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [state, setState] = useState<ReplayState>(() => createInitialReplayState(roomId));
  const latestStateRef = useRef(state);
  const [presentationEvents, setPresentationEvents] = useState<PresentationEvent[]>([]);
  const [matchMomentEvents, setMatchMomentEvents] = useState<NormalizedMatchEvent[]>([]);
  const [txlineFetchState, setTxlineFetchState] = useState<"idle" | "loading" | "accepted" | "error">("idle");
  const [txlineStreamStatus, setTxlineStreamStatus] = useState<TxlineStreamStatus | null>(null);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  const enqueuePresentationEvent = useCallback((event: PresentationEvent) => {
    const storageKey = presentationStorageKey(roomId);
    let presented: string[] = [];
    try {
      presented = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as string[];
    } catch {
      presented = [];
    }
    if (presented.includes(event.id)) return;
    const nextPresented = [event.id, ...presented].slice(0, 120);
    window.localStorage.setItem(storageKey, JSON.stringify(nextPresented));
    setPresentationEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event].slice(-24));
  }, [roomId]);

  const acknowledgePresentationEvent = useCallback((id: string) => {
    setPresentationEvents((current) => current.filter((event) => event.id !== id));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        if (!effectiveDisplayName) return;
        let activeParticipantId = participantId;
        let activeSessionToken = sessionToken;
        if (activeParticipantId && !sessionToken) {
          window.sessionStorage.removeItem(`vira:${roomId}:participantId`);
          window.sessionStorage.removeItem(`vira:${roomId}:sessionToken`);
          activeParticipantId = null;
          setParticipantId(null);
        }
        if (activeParticipantId && activeSessionToken) {
          const validation = await validateRoomSession(roomId, activeParticipantId, activeSessionToken).catch(() => ({ valid: false, participant: null, roomVersion: 0 }));
          if (!validation.valid) {
            window.sessionStorage.removeItem(`vira:${roomId}:participantId`);
            window.sessionStorage.removeItem(`vira:${roomId}:sessionToken`);
            activeParticipantId = null;
            activeSessionToken = null;
            setParticipantId(null);
            setSessionToken(null);
          }
        }
        if (!activeParticipantId) {
          const joined = await joinRoom(roomId, effectiveDisplayName, admissionToken, getPublicToken(), inviteCode);
          activeParticipantId = joined.participant.id;
          window.sessionStorage.setItem(`vira:${roomId}:participantId`, activeParticipantId);
          window.sessionStorage.setItem(`vira:${roomId}:sessionToken`, joined.sessionToken);
          setParticipantId(activeParticipantId);
          setSessionToken(joined.sessionToken);
          activeSessionToken = joined.sessionToken;
        }
        if (!activeParticipantId || !activeSessionToken) return;
        let snapshot = await fetchRoomState(roomId, activeParticipantId, activeSessionToken);
        if (activeParticipantId && !snapshot.participants.some((participant) => participant.id === activeParticipantId)) {
          window.sessionStorage.removeItem(`vira:${roomId}:participantId`);
          window.sessionStorage.removeItem(`vira:${roomId}:sessionToken`);
          const joined = await joinRoom(roomId, effectiveDisplayName, admissionToken, getPublicToken(), inviteCode);
          activeParticipantId = joined.participant.id;
          window.sessionStorage.setItem(`vira:${roomId}:participantId`, activeParticipantId);
          window.sessionStorage.setItem(`vira:${roomId}:sessionToken`, joined.sessionToken);
          setParticipantId(activeParticipantId);
          setSessionToken(joined.sessionToken);
          activeSessionToken = joined.sessionToken;
          snapshot = await fetchRoomState(roomId, activeParticipantId, activeSessionToken);
        }
        if (!cancelled) {
          setState((current) => stateFromSnapshot(current, snapshot, activeParticipantId));
        }
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            snapshot: {
              ...current.snapshot,
              connectionState: "offline",
            },
          }));
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
    };
  }, [admissionToken, effectiveDisplayName, inviteCode, participantId, roomId, sessionToken]);

  useEffect(() => {
    const events = new EventSource(roomEventsUrl(roomId, participantId));
    events.addEventListener("room.snapshot", (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as RoomSnapshot;
      setState((current) => stateFromSnapshot(current, snapshot, participantId));
    });
    events.addEventListener("round.resolved", (event) => {
      const resolution = JSON.parse((event as MessageEvent).data) as RoundResolutionResult;
      const previousSnapshot = latestStateRef.current.snapshot;
      const previousRank = participantId
        ? previousSnapshot.leaderboard.find((entry) => entry.participantId === participantId)?.rank ?? null
        : null;
      if (!participantId || !sessionToken) return;
      void fetchRoomState(roomId, participantId, sessionToken).then((snapshot) => {
        setState((current) => stateFromSnapshot(current, snapshot, participantId));
        const result = snapshot.lastResolution ?? resolution;
        const currentRank = participantId
          ? snapshot.leaderboard.find((entry) => entry.participantId === participantId)?.rank ?? null
          : null;
        const eventId = result.event?.id ?? resolution.event?.id ?? `${result.roundId}:${snapshot.version}`;
        enqueuePresentationEvent({
          id: `round-resolved:${roomId}:${eventId}:${participantId ?? "public"}`,
          kind: "round_resolved",
          eventId,
          roundId: result.roundId,
          correct: Boolean(result.wasCurrentUserCorrect),
          pointsAwarded: result.pointsAwarded ?? 0,
          previousRank,
          currentRank,
          winningOptionId: result.winningOptionId,
          openingValue: numberOrNull(previousSnapshot.currentRound?.resolution.predicate?.openingValue),
          resolutionValue: result.event ? marketValueFromEvent(result.event, previousSnapshot) : null,
        });
      });
    });
    events.addEventListener("match.event_received", (event) => {
      const normalized = JSON.parse((event as MessageEvent).data) as NormalizedMatchEvent;
      setMatchMomentEvents((current) => current.some((item) => item.id === normalized.id)
        ? current
        : [...current, normalized].slice(-32));
    });
    const refreshStreamStatus = () => {
      void fetchTxlineStreamStatus(roomId).then(setTxlineStreamStatus).catch(() => undefined);
    };
    events.addEventListener("txline.stream_started", refreshStreamStatus);
    events.addEventListener("txline.stream_failed", refreshStreamStatus);
    events.addEventListener("txline.stream_stopped", refreshStreamStatus);
    events.onerror = () => {
      setState((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          connectionState: "reconnecting",
        },
      }));
    };
    return () => events.close();
  }, [enqueuePresentationEvent, participantId, roomId, sessionToken]);

  const controls = useMemo<RoomRuntimeControls>(() => ({
    play: () => undefined,
    pause: () => undefined,
    restart: () => {
      if (!participantId || !sessionToken) return;
      void fetchRoomState(roomId, participantId, sessionToken).then((snapshot) => {
        setSelectedOptionId(null);
        setState((current) => stateFromSnapshot(current, snapshot, participantId));
      });
    },
    setSpeed: () => undefined,
    selectAnswer: (optionId: string) => {
      if (state.snapshot.match.status !== "live" || state.snapshot.currentRound?.state !== "open") return;
      setSelectedOptionId(optionId);
      setState((current) => ({
        ...current,
        selectedOptionId: optionId,
        currentAnswerState: "selected",
      }));
    },
    submitAnswer: async () => {
      const round = state.snapshot.currentRound;
      if (!participantId || !sessionToken || state.snapshot.match.status !== "live" || !round || !selectedOptionId) return;
      const response = await submitRoomAnswer({
        roomId,
        roundId: round.id,
        participantId,
        sessionToken,
        optionId: selectedOptionId,
        roundVersion: round.version,
      });
      enqueuePresentationEvent({
        id: `answer-registered:${roomId}:${response.eventId ?? `${round.id}:${participantId}`}`,
        kind: "answer_registered",
        eventId: response.eventId ?? `${round.id}:${participantId}`,
        roundId: response.roundId ?? round.id,
        optionId: response.optionId ?? selectedOptionId,
      });
      const snapshot = await fetchRoomState(roomId, participantId, sessionToken);
      setState((current) => stateFromSnapshot(current, snapshot, participantId));
    },
    castFanPulse: async (side) => {
      if (!participantId || !sessionToken || state.snapshot.match.status !== "scheduled") return;
      await castRoomFanPulse({ roomId, participantId, sessionToken, side });
      const snapshot = await fetchRoomState(roomId, participantId, sessionToken);
      setState((current) => stateFromSnapshot(current, snapshot, participantId));
    },
    fetchLatestTxlineOdds: async () => {
      setTxlineFetchState("loading");
      try {
        await fetchLatestTxlineOdds(roomId);
        setTxlineFetchState("accepted");
        if (!participantId || !sessionToken) throw new Error("invalid_session");
        const snapshot = await fetchRoomState(roomId, participantId, sessionToken);
        setState((current) => stateFromSnapshot(current, snapshot, participantId));
      } catch {
        setTxlineFetchState("error");
      }
    },
    connectOddsStream: async () => {
      const status = await connectTxlineOddsStream(roomId);
      setTxlineStreamStatus((current) => ({
        scores: current?.scores ?? { connected: false, status: "idle", kind: "scores" },
        odds: status,
      }));
    },
    disconnectOddsStream: async () => {
      const status = await disconnectTxlineStream(roomId, "odds");
      if ("scores" in status && "odds" in status) setTxlineStreamStatus(status);
      else {
        setTxlineStreamStatus((current) => ({
          scores: current?.scores ?? { connected: false, status: "idle", kind: "scores" },
          odds: status,
        }));
      }
    },
  }), [enqueuePresentationEvent, participantId, roomId, selectedOptionId, sessionToken, state.snapshot.currentRound, state.snapshot.version]);

  const refresh = useCallback(async () => {
    if (!participantId || !sessionToken) return;
    const snapshot = await fetchRoomState(roomId, participantId, sessionToken);
    setState((current) => stateFromSnapshot(current, snapshot, participantId));
  }, [participantId, roomId, sessionToken]);

  return { state, controls, refresh, participantId, sessionToken, presentationEvents, matchMomentEvents, acknowledgePresentationEvent, txlineFetchState, txlineStreamStatus };
}
