import { Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { DEFAULT_MATCH_ID } from "../../domain/contracts";
import type { PresentationEvent, RoomVerification } from "../../domain/types";
import type { MatchTxlineContext } from "../../runtime/api";
import { fetchMatchTxlineContext, fetchRoomVerification } from "../../runtime/api";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { Leaderboard } from "../leaderboard/Leaderboard";
import { useRoomRuntime } from "../../runtime/use-room-runtime";
import { JoinRoomDialog } from "../lobby/JoinRoomDialog";
import { CausalityRail } from "./CausalityRail";
import { LiveDecisionCapsule } from "./LiveDecisionCapsule";
import { MatchHeader } from "./MatchHeader";
import { MatchJourney } from "./MatchJourney";
import { MobileMatchContextNavigation } from "./MobileMatchContextNavigation";
import { ReplayFinishedPanel } from "./ReplayFinishedPanel";
import { ResolutionOverlay } from "./ResolutionOverlay";
import { RoomStage } from "./RoomStage";
import { deriveRoomExperience } from "./derive-room-experience";
import { createExperienceModel } from "./experience-model";
import { TournamentLifecycleRail } from "./TournamentLifecycleRail";
import { createConfirmedRoomPresence, publishConfirmedRoomPresence } from "../../app/shell/room-presence";
import { createRoomShare } from "../../social/share";
import { ViraShareButton } from "../../social/ViraShareButton";
import { MiniLeaguePanel } from "../../social/MiniLeaguePanel";
import { MatchMomentDirector } from "../match-moments/MatchMomentDirector";
import { useMatchMomentDirector } from "../match-moments/use-match-moment-director";
import { useShellAtmosphere } from "../../app/shell/use-shell-atmosphere";
import { setShellOverlayState } from "../../app/shell/shell-events";
import { useLocale } from "../../i18n/locale-context.tsx";
import { ViraCompanion } from "../companion/ViraCompanion.tsx";
import { deriveViraCompanionViewModel } from "../companion/view-model.ts";
import { useCompanionPreferences } from "../companion/use-companion-preferences.ts";
import { useDocumentPictureInPicture } from "../companion/use-document-pip.ts";
import { useWebPush } from "../companion/use-web-push.ts";
import { useServerClock } from "../../runtime/use-server-clock.ts";

export function MatchRoomScreen() {
  const { locale, localizedHref, t, timeZone } = useLocale();
  const { matchId = DEFAULT_MATCH_ID } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const inspect = searchParams.get("inspect") === "true";
  const navigate = useNavigate();
  const initialName = window.localStorage.getItem(`vira:${matchId}:displayName`)
    || window.localStorage.getItem("vira:displayName")
    || "";
  const [playerName, setPlayerName] = useState(initialName);
  const [joinDialogOpen, setJoinDialogOpen] = useState(!initialName);
  const { state, controls, participantId, sessionToken, presentationEvents, matchMomentEvents, acknowledgePresentationEvent, txlineFetchState, txlineStreamStatus } = useRoomRuntime(matchId, playerName);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolutionRequested, setResolutionRequested] = useState(false);
  const [latestPresentationEvent, setLatestPresentationEvent] = useState<PresentationEvent | null>(null);
  const [verification, setVerification] = useState<RoomVerification | null>(null);
  const [preMatchContext, setPreMatchContext] = useState<MatchTxlineContext | null>(null);
  const matchDirection = useMatchMomentDirector(matchId, state.snapshot.match, matchMomentEvents);
  const companion = useMemo(() => deriveViraCompanionViewModel(state, participantId), [participantId, state]);
  const { preferences: companionPreferences, setEnabled: setCompanionEnabled } = useCompanionPreferences(matchId);
  const floatingCompanion = useDocumentPictureInPicture();
  const companionCountdownActive = companion.state === "round_open" || companion.state === "answer_confirmed";
  const { remainingMs: companionRemainingMs } = useServerClock(companion.serverTime, companionCountdownActive ? companion.locksAt : null, 1_000, { suspendWhenHidden: !floatingCompanion.pipWindow });
  const companionPush = useWebPush({ roomId: matchId, fixtureId: state.snapshot.match.id, participantId, sessionToken, locale, timeZone, inviteCode: searchParams.get("invite") });
  const followCompanion = useCallback(() => setCompanionEnabled(true), [setCompanionEnabled]);
  const unfollowCompanion = useCallback(() => setCompanionEnabled(false), [setCompanionEnabled]);
  const returnFromPip = useCallback(() => { floatingCompanion.close(); window.focus(); }, [floatingCompanion.close]);
  useShellAtmosphere("route:match-room", {
    atmosphere: state.snapshot.match.status === "finished" ? "finished" : state.snapshot.match.status === "paused" ? "halftime" : "live",
    context: state.snapshot.match.status === "finished" ? "post-match" : "match-room",
    fixtureId: state.snapshot.match.id,
    homeAccent: state.snapshot.match.homeTeam.accent,
    awayAccent: state.snapshot.match.awayTeam.accent,
    fixtureFocus: state.snapshot.match.status === "finished" ? .08 : .2,
    priority: 30,
  });

  const confirmPlayerName = () => {
    const safeName = playerName.trim();
    if (!safeName) return;
    window.localStorage.setItem("vira:displayName", safeName);
    window.localStorage.setItem(`vira:${matchId}:displayName`, safeName);
    setJoinDialogOpen(false);
  };
  const openOfficialReview = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("inspect", "true");
    setSearchParams(nextParams);
  };

  const currentRound = state.snapshot.currentRound;
  const experience = deriveRoomExperience(state);
  const competitiveStage = experience === "round_open" || experience === "answer_locked" || experience === "resolving" || experience === "finished";
  const previewChoice = searchParams.get("choice");
  const inviteCode = searchParams.get("invite");
  const companionParams = new URLSearchParams(searchParams);
  companionParams.delete("inspect");
  const companionHref = localizedHref(`/match/${encodeURIComponent(matchId)}/companion?${companionParams.toString()}`);
  const openCompanion = useCallback(() => {
    if (!floatingCompanion.supported) {
      navigate(companionHref);
      return;
    }
    void floatingCompanion.open().catch(() => navigate(companionHref));
  }, [companionHref, floatingCompanion.open, floatingCompanion.supported, navigate]);
  const answerSummary = useMemo(() => {
    if (!currentRound) {
      return {};
    }
    return state.snapshot.answerSummary?.byOption ?? {};
  }, [currentRound, state.snapshot.answerSummary]);
  const experienceModel = useMemo(() => createExperienceModel(state, latestPresentationEvent, verification, t), [latestPresentationEvent, state, t, verification]);

  useEffect(() => {
    setShellOverlayState("match-inspector", inspect);
    return () => setShellOverlayState("match-inspector", false);
  }, [inspect]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void fetchMatchTxlineContext(matchId).then((context) => { if (!cancelled) setPreMatchContext(context); }).catch(() => { if (!cancelled) setPreMatchContext(null); });
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [matchId, state.snapshot.match.status]);

  useEffect(() => {
    if (!participantId || !state.snapshot.currentParticipant || state.snapshot.version <= 0) return;
    publishConfirmedRoomPresence(createConfirmedRoomPresence(state, participantId, state.snapshot.currentParticipant.displayName));
  }, [participantId, state]);

  useEffect(() => {
    if (
      (previewChoice === "yes" || previewChoice === "no")
      && currentRound?.state === "open"
      && state.snapshot.match.status === "live"
      && !state.selectedOptionId
      && state.currentAnswerState === "not_answered"
    ) {
      controls.selectAnswer(previewChoice);
    }
  }, [controls, currentRound?.state, previewChoice, state.currentAnswerState, state.selectedOptionId]);

  useEffect(() => {
    presentationEvents.forEach((event) => {
      setLatestPresentationEvent(event);
      if (event.kind === "answer_registered") {
        toast.success(t("room.toast.answerRegistered"), {
          description: currentRound?.resolution.domain === "football" ? t("room.toast.footballWindow") : t("room.toast.waitingTxline"),
        });
      }
      if (event.kind === "round_resolved") {
        setResolutionRequested(true);
      }
      acknowledgePresentationEvent(event.id);
    });
  }, [acknowledgePresentationEvent, currentRound?.resolution.domain, presentationEvents, t]);

  useEffect(() => {
    if (!resolutionRequested || matchDirection.takeoverActive) return;
    const handoff = window.setTimeout(() => {
      setResolutionOpen(true);
      setResolutionRequested(false);
    }, 120);
    return () => window.clearTimeout(handoff);
  }, [matchDirection.takeoverActive, resolutionRequested]);

  useEffect(() => {
    if (!resolutionOpen) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setResolutionOpen(false), 4200);
    return () => window.clearTimeout(timeout);
  }, [resolutionOpen, state.lastResolution?.roundId]);

  useEffect(() => {
    const shouldVerify = state.lastResolution || state.snapshot.match.status === "finished";
    if (!shouldVerify) return undefined;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void fetchRoomVerification(matchId)
        .then((result) => {
          if (!cancelled) setVerification(result);
        })
        .catch(() => {
          if (!cancelled) setVerification(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [matchId, state.lastResolution?.roundId, state.snapshot.ledger?.streamVersion, state.snapshot.match.status]);

  return (
    <div className="min-h-screen bg-background/55 text-foreground">
      <MatchHeader state={state} onBack={() => navigate(localizedHref("/matches"))} />
      <TournamentLifecycleRail model={experienceModel} />
      <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-5 md:px-7 lg:px-10 lg:pb-12">
        {participantId && sessionToken ? <div className="flex justify-end"><ViraShareButton label={t("room.invite")} create={() => createRoomShare({ kind: "room", roomId: matchId, participantId, sessionToken, displayName: state.snapshot.currentParticipant?.displayName ?? playerName }, { locale, timeZone })} /></div> : null}
        {participantId && sessionToken ? <div className="ml-auto mt-4 max-w-2xl"><ViraCompanion model={companion} enabled={companionPreferences.enabled} onFollow={followCompanion} onUnfollow={unfollowCompanion} onOpenFloating={openCompanion} floatingAvailable={floatingCompanion.supported} pushState={companionPush.state} enabledPushTypes={companionPush.enabledTypes} onEnableAlerts={companionPush.enable} onDisableAlerts={companionPush.disable} onToggleAlertType={companionPush.toggleType} remainingMs={companionRemainingMs} /></div> : null}
        {competitiveStage ? <LiveDecisionCapsule state={state} latestPresentationEvent={latestPresentationEvent} /> : null}

        <section className={`mt-5 grid gap-5 lg:items-start ${competitiveStage ? "lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]" : "grid-cols-1"}`}>
          <RoomStage
            state={state}
            model={experienceModel}
            answerSummary={answerSummary}
            latestPresentationEvent={latestPresentationEvent}
            onSelect={controls.selectAnswer}
            onSubmit={controls.submitAnswer}
            onFanPulse={controls.castFanPulse}
            preMatchContext={preMatchContext}
          />

          {competitiveStage ? <aside id="match-ranking" className="scroll-mt-24 lg:sticky lg:top-[7.5rem]"><Leaderboard entries={state.snapshot.leaderboard} /></aside> : null}
        </section>
        <MiniLeaguePanel inviteCode={inviteCode} />

        {competitiveStage ? <CausalityRail state={state} latestPresentationEvent={latestPresentationEvent} verification={verification} /> : null}
        <MatchJourney journey={experienceModel.journey} />

        <ReplayFinishedPanel
          open={state.currentUiState === "match_finished"}
          leaderboard={state.snapshot.leaderboard}
          onRestart={() => {
            setResolutionOpen(false);
            setResolutionRequested(false);
            controls.restart();
          }}
        />
      </main>

      <MatchMomentDirector
        moment={resolutionOpen ? null : matchDirection.state.active}
        ambient={matchDirection.state.ambient}
        motionPreference={matchDirection.preferences.motion}
        sound={matchDirection.preferences.sound}
        onDismiss={matchDirection.dismiss}
        onMotionChange={(motion) => matchDirection.updatePreferences({ motion })}
        onSoundChange={(sound) => matchDirection.updatePreferences({ sound })}
        visible={!resolutionOpen && !inspect && !joinDialogOpen}
      />

      <ResolutionOverlay
        open={resolutionOpen}
        result={state.lastResolution}
        presentationEvent={latestPresentationEvent}
        onClose={() => setResolutionOpen(false)}
        shareAction={participantId && sessionToken ? <ViraShareButton label={t("room.shareResult")} create={() => createRoomShare({ kind: "result", roomId: matchId, participantId, sessionToken, displayName: state.snapshot.currentParticipant?.displayName ?? playerName }, { locale, timeZone })} /> : null}
      />

      <InspectorPanel
        open={inspect}
        state={state}
        currentRound={currentRound}
        txlineFetchState={txlineFetchState}
        txlineStreamStatus={txlineStreamStatus}
        onClose={() => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("inspect");
          setSearchParams(nextParams);
        }}
        onFetchLatestTxlineOdds={controls.fetchLatestTxlineOdds}
        onConnectOddsStream={controls.connectOddsStream}
        onDisconnectOddsStream={controls.disconnectOddsStream}
      />

      <JoinRoomDialog
        name={playerName}
        subtitle={state.snapshot.match.title}
        open={joinDialogOpen}
        onClose={() => navigate(localizedHref("/matches"))}
        onChangeName={setPlayerName}
        onConfirm={confirmPlayerName}
      />

      <MobileMatchContextNavigation hasJourney={experienceModel.journey.length >= 2} onReview={openOfficialReview} />

      <button
        onClick={openOfficialReview}
        className="fixed bottom-4 right-4 hidden size-10 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-xl hover:text-primary lg:grid"
        aria-label={t("room.openReview")}
      >
        <Info className="size-4" />
      </button>
      {floatingCompanion.pipWindow && floatingCompanion.pipWindow.document.getElementById("vira-companion-pip-root") ? createPortal(
        <ViraCompanion
          model={companion}
          enabled={companionPreferences.enabled}
          onFollow={followCompanion}
          onUnfollow={unfollowCompanion}
          onClose={floatingCompanion.close}
          onReturnToRoom={returnFromPip}
          remainingMs={companionRemainingMs}
          mode="pip"
        />,
        floatingCompanion.pipWindow.document.getElementById("vira-companion-pip-root")!,
      ) : null}
    </div>
  );
}
