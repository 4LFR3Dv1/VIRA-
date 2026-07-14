import { useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { DEFAULT_MATCH_ID } from "../../domain/contracts.ts";
import { useLocale } from "../../i18n/locale-context.tsx";
import { useRoomRuntime } from "../../runtime/use-room-runtime.ts";
import { ViraCompanion } from "./ViraCompanion.tsx";
import { useCompanionPreferences } from "./use-companion-preferences.ts";
import { deriveViraCompanionViewModel } from "./view-model.ts";
import { useServerClock } from "../../runtime/use-server-clock.ts";

export function CompanionRouteScreen() {
  const { matchId = DEFAULT_MATCH_ID } = useParams();
  const [searchParams] = useSearchParams();
  const { localizedHref, t } = useLocale();
  const navigate = useNavigate();
  const displayName = window.localStorage.getItem(`vira:${matchId}:displayName`) ?? window.localStorage.getItem("vira:displayName");
  const { state, participantId } = useRoomRuntime(matchId, displayName);
  const model = useMemo(() => deriveViraCompanionViewModel(state, participantId), [participantId, state]);
  const countdownActive = model.state === "round_open" || model.state === "answer_confirmed";
  const { remainingMs } = useServerClock(model.serverTime, countdownActive ? model.locksAt : null);
  const { preferences, setEnabled } = useCompanionPreferences(matchId);
  const roomParams = new URLSearchParams(searchParams);
  roomParams.delete("compact");
  const roomHref = localizedHref(`/match/${encodeURIComponent(matchId)}?${roomParams.toString()}`);
  const follow = useCallback(() => setEnabled(true), [setEnabled]);
  const unfollow = useCallback(() => setEnabled(false), [setEnabled]);
  const returnToRoom = useCallback(() => navigate(roomHref), [navigate, roomHref]);

  return (
    <main className="min-h-screen bg-[#050A12] p-3 text-white sm:grid sm:place-items-center sm:p-6">
      <div className="w-full max-w-md">
        <p className="mb-3 text-center font-['DM_Mono'] text-[9px] uppercase tracking-[.16em] text-white/40">{t("companion.compactDisclosure")}</p>
        <ViraCompanion model={model} enabled={preferences.enabled} onFollow={follow} onUnfollow={unfollow} onReturnToRoom={returnToRoom} remainingMs={remainingMs} mode="compact" />
      </div>
    </main>
  );
}
