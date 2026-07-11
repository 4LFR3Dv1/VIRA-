import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

export function MatchRoomScreen() {
  const { matchId = DEFAULT_MATCH_ID } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const inspect = searchParams.get("inspect") === "true";
  const navigate = useNavigate();
  const initialName = window.localStorage.getItem(`vira:${matchId}:displayName`)
    || window.localStorage.getItem("vira:displayName")
    || "";
  const [playerName, setPlayerName] = useState(initialName);
  const [joinDialogOpen, setJoinDialogOpen] = useState(!initialName);
  const { state, controls, participantId, presentationEvents, acknowledgePresentationEvent, txlineFetchState, txlineStreamStatus } = useRoomRuntime(matchId, playerName);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [latestPresentationEvent, setLatestPresentationEvent] = useState<PresentationEvent | null>(null);
  const [verification, setVerification] = useState<RoomVerification | null>(null);
  const [preMatchContext, setPreMatchContext] = useState<MatchTxlineContext | null>(null);

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
  const answerSummary = useMemo(() => {
    if (!currentRound) {
      return {};
    }
    return state.snapshot.answerSummary?.byOption ?? {};
  }, [currentRound, state.snapshot.answerSummary]);
  const experienceModel = useMemo(() => createExperienceModel(state, latestPresentationEvent, verification), [latestPresentationEvent, state, verification]);

  useEffect(() => {
    if (state.snapshot.match.status !== "scheduled") return undefined;
    let cancelled = false;
    void fetchMatchTxlineContext(matchId).then((context) => { if (!cancelled) setPreMatchContext(context); }).catch(() => { if (!cancelled) setPreMatchContext(null); });
    return () => { cancelled = true; };
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
        toast.success("Palpite registrado", {
          description: "Aguardando o proximo sinal elegivel da TxLINE.",
        });
      }
      if (event.kind === "round_resolved") {
        setResolutionOpen(true);
      }
      acknowledgePresentationEvent(event.id);
    });
  }, [acknowledgePresentationEvent, presentationEvents]);

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
    <div className="min-h-screen bg-background text-foreground">
      <MatchHeader state={state} onBack={() => navigate("/")} />
      <TournamentLifecycleRail model={experienceModel} />
      <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-5 md:px-7 lg:px-10 lg:pb-12">
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

        {competitiveStage ? <CausalityRail state={state} latestPresentationEvent={latestPresentationEvent} verification={verification} /> : null}
        <MatchJourney journey={experienceModel.journey} />

        <ReplayFinishedPanel
          open={state.currentUiState === "match_finished"}
          leaderboard={state.snapshot.leaderboard}
          onRestart={() => {
            setResolutionOpen(false);
            controls.restart();
          }}
        />
      </main>

      <ResolutionOverlay
        open={resolutionOpen}
        result={state.lastResolution}
        presentationEvent={latestPresentationEvent}
        onClose={() => setResolutionOpen(false)}
      />

      <InspectorPanel
        open={inspect}
        state={state}
        currentRound={currentRound}
        txlineFetchState={txlineFetchState}
        txlineStreamStatus={txlineStreamStatus}
        onClose={() => setSearchParams({})}
        onFetchLatestTxlineOdds={controls.fetchLatestTxlineOdds}
        onConnectOddsStream={controls.connectOddsStream}
        onDisconnectOddsStream={controls.disconnectOddsStream}
      />

      <JoinRoomDialog
        name={playerName}
        subtitle={state.snapshot.match.title}
        open={joinDialogOpen}
        onClose={() => navigate("/")}
        onChangeName={setPlayerName}
        onConfirm={confirmPlayerName}
      />

      <MobileMatchContextNavigation hasJourney={experienceModel.journey.length >= 2} onReview={openOfficialReview} />

      <button
        onClick={openOfficialReview}
        className="fixed bottom-4 right-4 grid size-10 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-xl hover:text-primary"
        aria-label="Abrir revisao oficial VIRA"
      >
        <Info className="size-4" />
      </button>
    </div>
  );
}
