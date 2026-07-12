import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { Match, NormalizedMatchEvent } from "../../domain/types";
import { deriveMatchMoment } from "./derive-match-moment";
import { matchMomentDirectorReducer } from "./match-moment-reducer";
import { initialMatchMomentDirectorState, type MotionPreference } from "./match-moment-types";

const preferenceKey = "vira:match-direction:preferences";

function readPreferences(): { motion: MotionPreference; sound: boolean } {
  try {
    return { motion: "full", sound: false, ...JSON.parse(window.localStorage.getItem(preferenceKey) || "{}") };
  } catch {
    return { motion: "full", sound: false };
  }
}

function readSeen(fixtureId: string) {
  try {
    return JSON.parse(window.sessionStorage.getItem(`vira:${fixtureId}:match-moments-seen`) || "[]") as string[];
  } catch {
    return [];
  }
}

function feedback(kind: string, sound: boolean) {
  if (document.visibilityState !== "visible") return;
  if (navigator.vibrate) {
    if (kind === "goal") navigator.vibrate([40, 35, 90]);
    else if (kind === "red_card" || kind === "penalty") navigator.vibrate([80]);
    else if (kind === "shot_on_target") navigator.vibrate([24]);
  }
  if (!sound) return;
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "goal" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(kind === "goal" ? 180 : 320, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(kind === "goal" ? 420 : 180, context.currentTime + .18);
    gain.gain.setValueAtTime(.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .23);
    oscillator.onended = () => void context.close();
  } catch {
    // Feedback is progressive enhancement and never affects the match.
  }
}

export function useMatchMomentDirector(fixtureId: string, match: Match, events: NormalizedMatchEvent[]) {
  const persistedSeen = useMemo(() => readSeen(fixtureId), [fixtureId]);
  const [state, dispatch] = useReducer(matchMomentDirectorReducer, {
    ...initialMatchMomentDirectorState,
    seenIds: persistedSeen,
  });
  const [preferences, setPreferences] = useState(readPreferences);
  const consumedRef = useRef(new Set(persistedSeen));

  useEffect(() => {
    for (const event of events) {
      const command = deriveMatchMoment(event, match);
      if (!command) continue;
      if ((command.type === "enqueue" || command.type === "replace") && consumedRef.current.has(command.moment.id)) continue;
      if (command.type === "enqueue" || command.type === "replace") consumedRef.current.add(command.moment.id);
      dispatch(command);
    }
  }, [events, match]);

  useEffect(() => {
    window.sessionStorage.setItem(`vira:${fixtureId}:match-moments-seen`, JSON.stringify(state.seenIds.slice(0, 160)));
  }, [fixtureId, state.seenIds]);

  useEffect(() => {
    if (!state.active) return undefined;
    feedback(state.active.kind, preferences.sound);
    const duration = preferences.motion === "off" ? Math.min(state.active.durationMs, 1_800) : state.active.durationMs;
    const timer = window.setTimeout(() => dispatch({ type: "dismiss", momentId: state.active?.id }), duration);
    return () => window.clearTimeout(timer);
  }, [preferences.motion, preferences.sound, state.active?.id]);

  useEffect(() => {
    if (!state.ambient) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: "expire_ambient", momentId: state.ambient?.id ?? "" }), state.ambient.durationMs);
    return () => window.clearTimeout(timer);
  }, [state.ambient?.id]);

  const updatePreferences = useCallback((next: Partial<typeof preferences>) => {
    setPreferences((current) => {
      const value = { ...current, ...next };
      window.localStorage.setItem(preferenceKey, JSON.stringify(value));
      return value;
    });
  }, []);

  return {
    state,
    preferences,
    updatePreferences,
    dismiss: () => dispatch({ type: "dismiss" }),
    takeoverActive: state.active?.presentation === "takeover",
  };
}
