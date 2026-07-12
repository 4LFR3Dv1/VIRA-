import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import { fetchBackendHealth, fetchRoomState, fetchRoomVerification, validateRoomSession } from "../../runtime/api";
import { matchCurrentRoute } from "../routing/route-manifest";
import { ShellExperienceContext } from "./ShellContext";
import { SHELL_ROOM_PRESENCE_EVENT, SHELL_ROOM_REFERENCE_KEY } from "./room-presence";
import { deriveConnectionPresentation, type ActiveRoomPresenceState, type OfficialReviewAvailability, type PersistedRoomReference, type ShellActiveRoom, type ShellAtmosphereExperience, type ShellAtmosphereIntent, type ShellConnectivity, type ShellReadiness } from "./shell-experience";
import { deriveCanonicalExperienceState, experienceCopy } from "../../features/match-experience/state-model";

function readReference(): PersistedRoomReference | null {
  try {
    const raw = window.sessionStorage.getItem(SHELL_ROOM_REFERENCE_KEY);
    const value = raw ? JSON.parse(raw) as PersistedRoomReference : null;
    if (value && Date.now() - new Date(value.updatedAt).getTime() > 24 * 60 * 60 * 1_000) {
      window.sessionStorage.removeItem(SHELL_ROOM_REFERENCE_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function ShellStateProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const route = matchCurrentRoute(location.pathname);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [backend, setBackend] = useState<ShellConnectivity["backend"]>("unknown");
  const [presence, setPresence] = useState<ActiveRoomPresenceState>(() => {
    const reference = readReference();
    return reference ? { kind: "revalidating", reference } : { kind: "none" };
  });
  const [review, setReview] = useState<OfficialReviewAvailability>({ kind: "unavailable" });
  const [readiness, setReadiness] = useState<ShellReadiness>({ kind: "booting", scope: "global" });
  const [atmosphereOwners, setAtmosphereOwners] = useState<Map<string, ShellAtmosphereIntent>>(() => new Map());

  const registerAtmosphere = useCallback((owner: string, intent: ShellAtmosphereIntent) => {
    setAtmosphereOwners((current) => {
      const previous = current.get(owner);
      if (previous && JSON.stringify(previous) === JSON.stringify(intent)) return current;
      const next = new Map(current);
      next.set(owner, intent);
      return next;
    });
  }, []);

  const releaseAtmosphere = useCallback((owner: string) => {
    setAtmosphereOwners((current) => {
      if (!current.has(owner)) return current;
      const next = new Map(current);
      next.delete(owner);
      return next;
    });
  }, []);

  useEffect(() => {
    const online = () => setBrowserOnline(true);
    const offline = () => setBrowserOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = () => void fetchBackendHealth().then((ok) => !cancelled && setBackend(ok ? "healthy" : "unavailable")).catch(() => !cancelled && setBackend("unavailable"));
    check();
    const interval = window.setInterval(check, 15_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const room = (event as CustomEvent<ShellActiveRoom>).detail;
      setPresence({ kind: "confirmed", room });
    };
    window.addEventListener(SHELL_ROOM_PRESENCE_EVENT, listener);
    return () => window.removeEventListener(SHELL_ROOM_PRESENCE_EVENT, listener);
  }, []);

  useEffect(() => {
    if (presence.kind !== "revalidating") return;
    let cancelled = false;
    const reference = presence.reference;
    const sessionToken = window.sessionStorage.getItem(`vira:${reference.roomId}:sessionToken`);
    if (!sessionToken) {
      setPresence({ kind: "expired", roomId: reference.roomId });
      return;
    }
    void Promise.all([
      validateRoomSession(reference.roomId, reference.participantId, sessionToken),
      fetchRoomState(reference.roomId, reference.participantId, sessionToken),
    ]).then(([session, snapshot]) => {
      if (cancelled) return;
      const participant = session.participant ?? snapshot.participants.find((item) => item.id === reference.participantId);
      if (!session.valid || !participant || snapshot.version < reference.lastConfirmedVersion) {
        setPresence({ kind: "expired", roomId: reference.roomId });
        return;
      }
      const answer = snapshot.answers[reference.participantId];
      const canonical = deriveCanonicalExperienceState({ matchStatus: snapshot.match.status, roomExists: true, roundState: snapshot.currentRound?.state, answerState: answer?.state, hasResolution: Boolean(snapshot.lastResolution), hasSignal: Object.values(snapshot.marketDistribution).some((value) => Number.isFinite(value) && value > 0), connectionState: snapshot.connectionState });
      const phase = canonical.match === "finished" ? "finished" : canonical.round === "resolved" ? "result_available" : canonical.round === "locked" ? "answer_confirmed" : canonical.round === "open" ? "action_required" : "waiting";
      const labels = { finished: experienceCopy.room.finished, result_available: experienceCopy.round.resolved, answer_confirmed: experienceCopy.round.locked, action_required: experienceCopy.round.open, waiting: canonical.match === "scheduled" ? `${experienceCopy.room.open} · ${experienceCopy.match.scheduled}` : experienceCopy.signal.waiting } as const;
      setPresence({ kind: "confirmed", room: {
        roomId: snapshot.roomId,
        fixtureId: snapshot.match.id,
        homeTeam: snapshot.match.homeTeam.name,
        awayTeam: snapshot.match.awayTeam.name,
        phase,
        phaseLabel: labels[phase],
        participantId: reference.participantId,
        participantName: participant.displayName,
        answerConfirmed: answer?.state === "submitted" || answer?.state === "correct" || answer?.state === "incorrect",
        lastConfirmedVersion: snapshot.version,
        updatedAt: new Date().toISOString(),
        connectionState: snapshot.connectionState,
      } });
    }).catch(() => !cancelled && setPresence({ kind: "expired", roomId: reference.roomId }));
    return () => { cancelled = true; };
  }, [presence.kind]);

  useEffect(() => {
    const roomId = presence.kind === "confirmed" ? presence.room.roomId : null;
    if (!roomId) { setReview({ kind: "unavailable" }); return; }
    let cancelled = false;
    setReview({ kind: "checking", roomId });
    void fetchRoomVerification(roomId).then(() => !cancelled && setReview({ kind: "available", roomId })).catch((error: unknown) => !cancelled && setReview({ kind: "failed", roomId, reason: error instanceof Error ? error.message : "verification_failed" }));
    return () => { cancelled = true; };
  }, [presence.kind === "confirmed" ? presence.room.roomId : null]);

  useEffect(() => {
    if (presence.kind !== "confirmed" || presence.room.phase !== "finished") return undefined;
    const roomId = presence.room.roomId;
    const timeout = window.setTimeout(() => {
      window.sessionStorage.removeItem(SHELL_ROOM_REFERENCE_KEY);
      window.sessionStorage.removeItem(`vira:${roomId}:participantId`);
      window.sessionStorage.removeItem(`vira:${roomId}:sessionToken`);
      setPresence({ kind: "expired", roomId });
      setReview({ kind: "unavailable" });
    }, 10 * 60 * 1_000);
    return () => window.clearTimeout(timeout);
  }, [presence]);

  useEffect(() => {
    if (backend !== "unknown") setReadiness({ kind: "ready" });
  }, [backend]);

  const connectivity = useMemo<ShellConnectivity>(() => {
    const room = presence.kind === "confirmed" ? presence.room : null;
    const roomState = room?.connectionState;
    return {
      browser: browserOnline ? "online" : "offline",
      backend,
      roomStream: !room ? "not_applicable" : roomState === "live" ? "healthy" : roomState === "reconnecting" ? "reconnecting" : "connecting",
      txline: !room ? "not_applicable" : roomState === "live" ? "healthy" : roomState === "offline" ? "unavailable" : "reconnecting",
      lastConfirmedAt: room?.updatedAt,
    };
  }, [backend, browserOnline, presence]);

  const atmosphere = useMemo<ShellAtmosphereExperience>(() => {
    const fallback: ShellAtmosphereExperience = route.shellMode === "immersive"
      ? { atmosphere: "live", context: "match-room", fixtureFocus: .18 }
      : route.id === "match-preview"
        ? { atmosphere: "anticipation", context: "fixture-preview", fixtureFocus: .36 }
        : { atmosphere: "idle", context: "discovery", fixtureFocus: 0 };
    const winner = [...atmosphereOwners.entries()]
      .sort(([leftOwner, left], [rightOwner, right]) => (Number(right.priority) - Number(left.priority)) || rightOwner.localeCompare(leftOwner))[0]?.[1];
    if (!winner) return fallback;
    return { atmosphere: winner.atmosphere, context: winner.context, fixtureId: winner.fixtureId, homeAccent: winner.homeAccent, awayAccent: winner.awayAccent, fixtureFocus: Math.max(0, Math.min(1, winner.fixtureFocus ?? fallback.fixtureFocus)) };
  }, [atmosphereOwners, route.id, route.shellMode]);

  const value = useMemo(() => ({
    mode: route.shellMode,
    route: { id: route.id, title: route.title, context: route.context, backPath: route.backPath },
    connectivity,
    connection: deriveConnectionPresentation(connectivity),
    readiness,
    activeRoom: presence,
    review,
    atmosphere,
    registerAtmosphere,
    releaseAtmosphere,
  }), [atmosphere, connectivity, presence, readiness, registerAtmosphere, releaseAtmosphere, review, route]);

  return <ShellExperienceContext.Provider value={value}>{children}</ShellExperienceContext.Provider>;
}
