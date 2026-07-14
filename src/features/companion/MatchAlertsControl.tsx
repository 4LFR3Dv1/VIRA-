import { Bell, BellOff, LoaderCircle } from "lucide-react";

import type { SupportedLocale } from "../../i18n/locale.ts";
import { useLocale } from "../../i18n/locale-context.tsx";
import { useWebPush } from "./use-web-push.ts";

interface MatchAlertsControlProps {
  roomId: string;
  fixtureId: string;
  participantId: string | null;
  sessionToken: string | null;
  locale: SupportedLocale;
  timeZone: string;
  inviteCode: string | null;
}

export function MatchAlertsControl(props: MatchAlertsControlProps) {
  const { t } = useLocale();
  const push = useWebPush(props);
  const hasValidSession = Boolean(props.participantId && props.sessionToken);

  // These states are reached only after VAPID, Service Worker and PushManager
  // capability checks. Unsupported environments receive no misleading CTA.
  if (!hasValidSession || push.state === "checking" || push.state === "unavailable") return null;

  const enabled = push.state === "enabled";
  const requesting = push.state === "requesting";
  const unavailableToRequest = push.state === "denied" || push.state === "error";
  const label = enabled
    ? t("companion.alerts.disable")
    : requesting
      ? t("companion.alerts.requesting")
      : t("companion.alerts.receive");

  return (
    <button
      type="button"
      data-match-alerts-control
      onClick={() => void (enabled ? push.disable() : push.enable())}
      disabled={requesting || unavailableToRequest}
      title={push.state === "denied" ? t("companion.alerts.denied") : push.state === "error" ? t("companion.alerts.error") : undefined}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border/80 bg-card/80 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      aria-live="polite"
    >
      {requesting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : enabled ? <BellOff className="size-3.5" aria-hidden="true" /> : <Bell className="size-3.5" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
