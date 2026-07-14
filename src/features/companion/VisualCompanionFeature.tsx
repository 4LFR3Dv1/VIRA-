import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

import type { ReplayState } from "../../domain/types.ts";
import type { SupportedLocale } from "../../i18n/locale.ts";
import { useServerClock } from "../../runtime/use-server-clock.ts";
import { ViraCompanion } from "./ViraCompanion.tsx";
import { deriveViraCompanionViewModel } from "./view-model.ts";
import { useCompanionPreferences } from "./use-companion-preferences.ts";
import { useDocumentPictureInPicture } from "./use-document-pip.ts";
import { useWebPush } from "./use-web-push.ts";

interface VisualCompanionFeatureProps {
  state: ReplayState;
  participantId: string;
  sessionToken: string;
  matchId: string;
  locale: SupportedLocale;
  timeZone: string;
  inviteCode: string | null;
  companionHref: string;
  onFallbackNavigate: (href: string) => void;
}

export function VisualCompanionFeature({ state, participantId, sessionToken, matchId, locale, timeZone, inviteCode, companionHref, onFallbackNavigate }: VisualCompanionFeatureProps) {
  const model = useMemo(() => deriveViraCompanionViewModel(state, participantId), [participantId, state]);
  const { preferences, setEnabled } = useCompanionPreferences(matchId);
  const floating = useDocumentPictureInPicture();
  const countdownActive = model.state === "round_open" || model.state === "answer_confirmed";
  const { remainingMs } = useServerClock(model.serverTime, countdownActive ? model.locksAt : null, 1_000, { suspendWhenHidden: !floating.pipWindow });
  const push = useWebPush({ roomId: matchId, fixtureId: state.snapshot.match.id, participantId, sessionToken, locale, timeZone, inviteCode });
  const follow = useCallback(() => setEnabled(true), [setEnabled]);
  const unfollow = useCallback(() => setEnabled(false), [setEnabled]);
  const open = useCallback(() => {
    if (!floating.supported) { onFallbackNavigate(companionHref); return; }
    void floating.open().catch(() => onFallbackNavigate(companionHref));
  }, [companionHref, floating.open, floating.supported, onFallbackNavigate]);
  const returnToRoom = useCallback(() => { floating.close(); window.focus(); }, [floating.close]);
  const target = floating.pipWindow?.document.getElementById("vira-companion-pip-root") ?? null;

  return <>
    <div className="ml-auto mt-4 max-w-2xl"><ViraCompanion model={model} enabled={preferences.enabled} onFollow={follow} onUnfollow={unfollow} onOpenFloating={open} floatingAvailable={floating.supported} pushState={push.state} enabledPushTypes={push.enabledTypes} onEnableAlerts={push.enable} onDisableAlerts={push.disable} onToggleAlertType={push.toggleType} remainingMs={remainingMs} /></div>
    {target ? createPortal(<ViraCompanion model={model} enabled={preferences.enabled} onFollow={follow} onUnfollow={unfollow} onClose={floating.close} onReturnToRoom={returnToRoom} remainingMs={remainingMs} mode="pip" />, target) : null}
  </>;
}
