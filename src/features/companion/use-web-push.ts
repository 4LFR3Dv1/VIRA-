import { useCallback, useEffect, useState } from "react";

import type { SupportedLocale } from "../../i18n/locale.ts";
import { fetchVapidPublicKey, registerCompanionSubscription, removeCompanionSubscription, updateCompanionSubscription } from "../../runtime/api.ts";

export type WebPushState = "checking" | "unavailable" | "available" | "requesting" | "enabled" | "denied" | "error";
export type UserPushType = "match_starting" | "round_open" | "round_resolved" | "rank_changed";
const DEFAULT_TYPES: UserPushType[] = ["match_starting", "round_open", "round_resolved", "rank_changed"];

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export function useWebPush({ roomId, fixtureId, participantId, sessionToken, locale, timeZone, inviteCode }: { roomId: string; fixtureId: string; participantId: string | null; sessionToken: string | null; locale: SupportedLocale; timeZone: string; inviteCode: string | null }) {
  const storageKey = `vira:companion:push:v1:${roomId}`;
  const [state, setState] = useState<WebPushState>("checking");
  const [subscriptionId, setSubscriptionId] = useState<string | null>(() => window.localStorage.getItem(storageKey));
  const [enabledTypes, setEnabledTypes] = useState<UserPushType[]>(DEFAULT_TYPES);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unavailable"); return; }
    let cancelled = false;
    void Promise.all([fetchVapidPublicKey(), navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription())]).then(([key, browserSubscription]) => {
      if (cancelled) return;
      setPublicKey(key);
      if (subscriptionId && !browserSubscription) { window.localStorage.removeItem(storageKey); setSubscriptionId(null); }
      setState(Notification.permission === "granted" && Boolean(subscriptionId && browserSubscription) ? "enabled" : Notification.permission === "denied" ? "denied" : "available");
    }).catch(() => { if (!cancelled) setState("unavailable"); });
    return () => { cancelled = true; };
  }, [storageKey, subscriptionId]);

  useEffect(() => {
    if (state !== "enabled" || !subscriptionId || !participantId || !sessionToken) return;
    void updateCompanionSubscription({ id: subscriptionId, roomId, participantId, sessionToken, locale, timeZone, enabledTypes }).catch(() => setState("error"));
  }, [enabledTypes, locale, participantId, roomId, sessionToken, state, subscriptionId, timeZone]);

  const enable = useCallback(async () => {
    if (!participantId || !sessionToken || !publicKey) return;
    setState("requesting");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "available"); return; }
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      const pushSubscription = current ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
      const result = await registerCompanionSubscription({ roomId, fixtureId, participantId, sessionToken, pushSubscription: pushSubscription.toJSON(), locale, timeZone, enabledTypes, inviteCode });
      window.localStorage.setItem(storageKey, result.subscription.id);
      setSubscriptionId(result.subscription.id); setState("enabled");
    } catch { setState("error"); }
  }, [enabledTypes, fixtureId, inviteCode, locale, participantId, publicKey, roomId, sessionToken, storageKey, timeZone]);

  const disable = useCallback(async () => {
    if (!participantId || !sessionToken) return;
    try {
      if (subscriptionId) await removeCompanionSubscription({ id: subscriptionId, roomId, participantId, sessionToken });
      const registration = await navigator.serviceWorker.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      window.localStorage.removeItem(storageKey); setSubscriptionId(null); setState("available");
    } catch { setState("error"); }
  }, [participantId, roomId, sessionToken, storageKey, subscriptionId]);

  const toggleType = useCallback((type: UserPushType) => {
    const next = enabledTypes.includes(type) ? enabledTypes.filter((value) => value !== type) : [...enabledTypes, type];
    setEnabledTypes(next);
    if (subscriptionId && participantId && sessionToken) void updateCompanionSubscription({ id: subscriptionId, roomId, participantId, sessionToken, locale, timeZone, enabledTypes: next }).catch(() => setState("error"));
  }, [enabledTypes, locale, participantId, roomId, sessionToken, subscriptionId, timeZone]);

  return { state, enabledTypes, enable, disable, toggleType };
}
