import { Check, Radio } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import type { PresentationEvent, ReplayState } from "../../domain/types";
import type { MatchTxlineContext } from "../../runtime/api";
import { useServerClock } from "../../runtime/use-server-clock";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { ActiveRoundScene } from "./ActiveRoundScene";
import type { ViraExperienceModel } from "./experience-model";
import { useLocale } from "../../i18n/locale-context.tsx";
import { roundOptionCopy } from "../../i18n/round-copy.ts";

interface RoomStageProps {
  state: ReplayState;
  model: ViraExperienceModel;
  answerSummary: Record<string, number>;
  latestPresentationEvent: PresentationEvent | null;
  onSelect: (optionId: string) => void;
  onSubmit: () => void;
  onFanPulse: (side: "home" | "away") => Promise<void>;
  preMatchContext: MatchTxlineContext | null;
}

export function RoomStage({ state, model, answerSummary, latestPresentationEvent, onSelect, onSubmit, onFanPulse, preMatchContext }: RoomStageProps) {
  const round = state.snapshot.currentRound;
  const experience = model.scene;

  if (experience === "provider_unavailable") return <OperationalStage state={state} kind="provider" />;
  if (experience === "no_live_fixture") return <OperationalStage state={state} kind="no-fixture" />;
  if (experience === "scheduled_without_market") return <OperationalStage state={state} kind="scheduled-empty" context={preMatchContext} onFanPulse={onFanPulse} />;
  if (experience === "scheduled_with_market") return <OperationalStage state={state} kind="scheduled-ready" context={preMatchContext} onFanPulse={onFanPulse} />;
  if (experience === "live_waiting_for_market") return <PreparingRoundStage state={state} kind="market" context={preMatchContext} />;
  if (experience === "live_waiting_for_round") return <PreparingRoundStage state={state} kind="round" context={preMatchContext} />;

  if (round && state.currentAnswerState === "submitted") {
    return <WaitingSignalStage state={state} latestPresentationEvent={latestPresentationEvent} />;
  }

  return <ActiveRoundScene model={model} state={state} answerSummary={answerSummary} onSelect={onSelect} onSubmit={onSubmit} />;
}

function PreparingRoundStage({ state, kind, context }: { state: ReplayState; kind: "market" | "round"; context: MatchTxlineContext | null }) {
  const { formatNumber, t } = useLocale();
  const reduceMotion = useReducedMotion();
  const connected = state.snapshot.connectionState === "live";
  const receivedSignals = state.snapshot.timeline.length;
  const projectedMarket = context?.consumerProjection?.availability.canShowMarket ? context.consumerProjection.market.canonical1X2 : null;
  const watch = projectedMarket ? { priceLabel: projectedMarket.leadingChoice === "home" ? context?.fixture.homeTeam : projectedMarket.leadingChoice === "away" ? context?.fixture.awayTeam : t("lobby.draw"), pct: projectedMarket.selections[projectedMarket.leadingChoice], directional: context?.consumerProjection?.availability.canMakeDirectionalClaim === true } : null;

  return (
    <motion.section layout className="relative min-h-[31rem] overflow-hidden border-y border-white/15 bg-[#090d18]">
      <div aria-hidden className="absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-px w-[72%] -translate-x-1/2 bg-white/10">
          <motion.span
            className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_30px_rgba(202,255,40,.9)]"
            animate={reduceMotion ? { left: "50%" } : { left: ["0%", "100%", "0%"] }}
            transition={reduceMotion ? undefined : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(202,255,40,.065),transparent_44%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:100%_72px,110px_100%]" />
      </div>

      <div className="relative z-10 flex min-h-[31rem] flex-col items-center justify-center px-5 py-14 text-center">
        <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] text-primary">{kind === "market" ? t("room.stage.observationMode") : t("room.stage.momentFound")}</p>
        <h1 className="mt-6 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.7rem,6.5vw,6.5rem)] font-black uppercase leading-[.8]">
          {kind === "market" ? t("room.stage.watchingMatch") : t("room.stage.preparingRound")}
        </h1>
        <p className="mt-8 max-w-xl text-sm leading-6 text-white/50 md:text-base">
          {kind === "market" ? t("room.stage.watchingDescription") : t("room.stage.preparingDescription")}
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-x-7 gap-y-3 font-['DM_Mono'] text-[10px] font-bold uppercase tracking-[.12em] text-white/55">
          <StatusMetric active={connected} label={connected ? t("room.connection.connected") : t("room.connection.reconnecting")} />
          <StatusMetric label={t("room.stage.observations", { count: receivedSignals })} />
          <StatusMetric label={t("room.inRoom", { count: state.snapshot.roomPopulation })} />
        </div>
        <p className="mt-12 border-t border-white/15 pt-5 text-xs text-white/35">{kind === "market" ? t("room.stage.noButtons") : t("room.stage.contractRequired")}</p>
        {watch ? <div className="mt-7 grid w-full max-w-xl grid-cols-[1fr_auto] items-center border-y border-white/15 py-4 text-left"><div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{t("room.marketWatch.passiveContext")}</p><strong className="mt-1 block font-['Chakra_Petch'] text-xl font-black uppercase">{watch.directional ? t("room.marketWatch.directional", { selection: watch.priceLabel ?? "--" }) : t("room.marketWatch.lastObserved")}</strong></div><span className="font-['Chakra_Petch'] text-3xl font-black text-primary">{formatNumber(watch.pct, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span></div> : null}
      </div>
    </motion.section>
  );
}

function OperationalStage({ state, kind, context = null, onFanPulse }: { state: ReplayState; kind: "provider" | "no-fixture" | "scheduled-empty" | "scheduled-ready"; context?: MatchTxlineContext | null; onFanPulse?: (side: "home" | "away") => Promise<void> }) {
  const { t } = useLocale();
  const match = state.snapshot.match;
  const scheduled = kind === "scheduled-empty" || kind === "scheduled-ready";
  const { remainingMs } = useServerClock(state.snapshot.serverTime, scheduled ? match.startTime : null, 1_000);
  const temporal = context?.consumerProjection?.temporal;
  const kickoff = temporal?.localKickoffDate && temporal.localKickoffTime ? `${temporal.localKickoffDate} · ${temporal.localKickoffTime}` : t("room.stage.timeToConfirm");
  const countdown = remainingMs === null ? null : formatCountdown(remainingMs);
  const copy = kind === "provider"
    ? { eyebrow: t("room.stage.providerEyebrow"), title: t("room.stage.providerTitle"), body: t("room.stage.providerBody"), tone: "text-amber-300" }
    : kind === "no-fixture"
      ? { eyebrow: t("room.stage.noFixtureEyebrow"), title: t("room.stage.noFixtureTitle"), body: t("room.stage.noFixtureBody"), tone: "text-primary" }
      : { eyebrow: t("room.stage.preMatchEyebrow"), title: countdown ? t("room.stage.startsIn", { countdown }) : t("room.stage.startsAt", { kickoff }), body: kind === "scheduled-ready" ? t("room.stage.marketReadyBody") : t("room.stage.marketWaitingBody"), tone: "text-primary" };

  return (
    <section className="relative min-h-[31rem] overflow-hidden border-y border-white/15 bg-[#090d18]">
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:100%_72px,110px_100%]" />
      <div className={`relative grid min-h-[31rem] items-center gap-10 px-6 py-14 md:px-10 ${scheduled ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]" : ""}`}>
        <div><p className={`font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] ${copy.tone}`}>{copy.eyebrow}</p><h1 className="mt-6 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.6rem,6vw,6.2rem)] font-black uppercase leading-[.82]">{copy.title}</h1><p className="mt-8 max-w-xl text-sm leading-6 text-white/50 md:text-base">{copy.body}</p><div className="mt-10 flex flex-wrap gap-6 font-['DM_Mono'] text-[10px] uppercase tracking-[.12em] text-white/45">{scheduled ? <StatusMetric label={t("room.stage.waiting", { count: state.snapshot.roomPopulation })} /> : null}{kind === "provider" ? <StatusMetric active={false} label={t("room.stage.reconnectingAutomatically")} /> : <StatusMetric label={scheduled ? t("room.stage.openRoom") : t("room.stage.txlineSchedule")} />}{kind === "scheduled-ready" ? <StatusMetric label={t("room.stage.marketsAvailable")} /> : null}</div></div>
        {scheduled ? <PreMatchMarketWatch state={state} context={context} participantCount={state.snapshot.roomPopulation} onFanPulse={onFanPulse} /> : null}
      </div>
    </section>
  );
}

function PreMatchMarketWatch({ state, context, participantCount, onFanPulse }: { state: ReplayState; context: MatchTxlineContext | null; participantCount: number; onFanPulse?: (side: "home" | "away") => Promise<void> }) {
  const { locale, t } = useLocale();
  const [submitting, setSubmitting] = useState<"home" | "away" | null>(null);
  const [pulseError, setPulseError] = useState(false);
  const probability = context?.consumerProjection?.availability.canShowMarket ? context.consumerProjection.market.canonical1X2?.selections ?? null : null;
  const markets = context?.marketTaxonomy?.observed ?? context?.availableMarkets.length ?? 0;
  const homeName = context?.fixture.homeTeam ?? state.snapshot.match.homeTeam.name;
  const awayName = context?.fixture.awayTeam ?? state.snapshot.match.awayTeam.name;
  const pulse = state.snapshot.fanPulse ?? { total: 0, byTeam: { home: 0, away: 0 }, currentParticipantChoice: null };
  const homeShare = pulse.total ? Math.round((pulse.byTeam.home / pulse.total) * 100) : 50;
  const awayShare = pulse.total ? 100 - homeShare : 50;
  const options = probability ? [
    { label: homeName, value: probability.home },
    { label: t("lobby.draw"), value: probability.draw },
    { label: awayName, value: probability.away },
  ] : [];
  const cast = async (side: "home" | "away") => {
    if (!onFanPulse || pulse.currentParticipantChoice || submitting) return;
    setSubmitting(side);
    setPulseError(false);
    try {
      await onFanPulse(side);
    } catch {
      setPulseError(true);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <aside className="border-y border-white/15 bg-[#050814]/55 lg:border">
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.16em] text-primary">{context?.consumerProjection?.availability.canMakeDirectionalClaim ? t("room.marketWatch.current") : probability ? t("room.marketWatch.lastObserved") : t("room.marketWatch.unavailable")}</p><h2 className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase">{t("room.marketWatch.title")}</h2></div>
          <Radio className="size-4 text-primary" />
        </div>
        {options.length ? <div className="mt-5 grid grid-cols-3 border-y border-white/15">{options.map((option) => <div key={option.label} className="border-r border-white/15 px-2 py-4 text-center last:border-r-0"><span className="block truncate font-['DM_Mono'] text-[9px] uppercase text-white/45">{option.label}</span><strong className="mt-2 block font-['Chakra_Petch'] text-xl font-black text-primary"><AnimatedNumber value={option.value} locales={locale} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></strong></div>)}</div> : <p className="mt-5 border-y border-white/15 py-5 text-sm text-white/45">{t("room.marketWatch.waiting1X2")}</p>}
      </div>

      <div className="border-t border-white/15 p-6">
        <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.16em] text-primary">{t("room.fanPulse.title")}</p>
        <h3 className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase">{t("room.fanPulse.question")}</h3>
        <p className="mt-2 text-xs text-white/40">{t("room.fanPulse.description")}</p>
        <div className="mt-5 grid grid-cols-2 border-y border-white/15">
          {(["home", "away"] as const).map((side) => {
            const selected = pulse.currentParticipantChoice === side;
            const label = side === "home" ? homeName : awayName;
            const share = side === "home" ? homeShare : awayShare;
            return <button key={side} type="button" disabled={Boolean(pulse.currentParticipantChoice) || Boolean(submitting)} onClick={() => void cast(side)} className={`relative min-h-24 overflow-hidden border-r border-white/15 p-4 text-left last:border-r-0 ${selected ? "bg-primary text-[#050814]" : "bg-white/[.02] hover:bg-white/[.06]"}`}><span className="relative z-10 block truncate font-['Chakra_Petch'] text-lg font-black uppercase">{label}</span><span className={`relative z-10 mt-5 block font-['DM_Mono'] text-[9px] uppercase ${selected ? "text-[#050814]/60" : "text-white/35"}`}>{submitting === side ? t("room.fanPulse.confirming") : selected ? t("room.fanPulse.yourSide") : pulse.total ? t("room.fanPulse.supportShare", { percentage: share }) : t("room.fanPulse.chooseSide")}</span>{pulse.total ? <span className="absolute bottom-1 right-2 font-['Chakra_Petch'] text-5xl font-black opacity-10">{share}%</span> : null}</button>;
          })}
        </div>
        <div className="mt-4 flex items-center justify-between font-['DM_Mono'] text-[9px] uppercase text-white/35"><span>{t("room.fanPulse.count", { count: pulse.total })}</span><span>{t("room.stage.waiting", { count: participantCount })}</span></div>
        {pulseError ? <p className="mt-3 text-xs text-amber-300">{t("room.fanPulse.error")}</p> : null}
      </div>

      <div className="border-t border-white/15 px-6 py-4 font-['DM_Mono'] text-[9px] uppercase text-white/35"><span>{t("room.marketWatch.observedSummary", { observed: markets, focused: Math.min(5, markets) })}</span><p className="mt-2 normal-case leading-5">{t("room.marketWatch.roundWhenLive")}</p></div>
    </aside>
  );
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function StatusMetric({ label, active = true }: { label: string; active?: boolean }) {
  return <span className="inline-flex items-center gap-2"><span className={`size-1.5 rounded-full ${active ? "bg-primary" : "bg-amber-400"}`} />{label}</span>;
}

function WaitingSignalStage({ state, latestPresentationEvent }: { state: ReplayState; latestPresentationEvent: PresentationEvent | null }) {
  const { locale, t } = useLocale();
  const round = state.snapshot.currentRound;
  if (!round) return null;
  const participant = state.snapshot.currentParticipant;
  const answer = state.snapshot.currentParticipantAnswer ?? (participant ? state.snapshot.answers[participant.id] : null);
  const option = round.options.find((item) => item.id === answer?.optionId);
  const answerLabel = option ? roundOptionCopy(t, round, option).label : "--";
  const predicate = round.resolution.predicate ?? {};
  const opening = typeof predicate.openingValue === "number" ? predicate.openingValue : null;
  const target = typeof predicate.pctGte === "number" ? predicate.pctGte : null;
  const { remainingMs } = useServerClock(state.snapshot.serverTime, round.locksAt);
  const remainingSec = Math.max(0, Math.ceil((remainingMs ?? 0) / 1_000));
  const answersClosed = round.state === "locked";
  const football = round.resolution.domain === "football" ? round.resolution.condition : null;
  const targetTeam = football?.targetSide === "away" ? state.snapshot.match.awayTeam : state.snapshot.match.homeTeam;
  const shotOnTarget = football?.kind === "team_shot_on_target";
  const targetStats = football?.targetSide === "away" ? state.snapshot.matchStats?.away : state.snapshot.matchStats?.home;
  const openingScore = football?.openingObservation
    ? football.kind === "team_shot_on_target" ? String(football.openingObservation.shotsOnTarget) : `${football.openingObservation.homeScore}-${football.openingObservation.awayScore}`
    : `${state.snapshot.match.homeScore}-${state.snapshot.match.awayScore}`;

  if (football) {
    return (
      <motion.section layout className="overflow-hidden border-y border-white/15 bg-[#090d18] px-5 py-10 md:px-8 md:py-14">
        <div className="flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary"><Check className="size-4" /> {answersClosed ? t("round.answerInPlay") : t("round.answerConfirmed")}</div>
        <div className="mt-7 grid gap-10 lg:grid-cols-[1fr_.72fr] lg:items-end">
          <div><h1 className="font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6.3rem)] font-black uppercase leading-[.8]">{shotOnTarget ? t("round.teamMustShoot", { team: targetTeam.name }) : t("round.teamMustScore", { team: targetTeam.name })}</h1><p className="mt-7 text-sm text-white/50">{answersClosed ? t("round.yourAnswer", { answer: answerLabel }) : t("round.answerPrivateUntilLock")}</p><div className="mt-6 border-l-2 border-primary pl-4"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{answersClosed ? t("round.predictionHorizon") : t("round.answerWindow")}</p><strong className="mt-1 block font-['Chakra_Petch'] text-2xl font-black uppercase">{answersClosed && football.endsAtClockSec !== undefined ? t("round.untilClock", { clock: formatClock(football.endsAtClockSec) }) : t("round.closesIn", { count: remainingSec })}</strong><p className="mt-1 text-xs text-white/40">{answersClosed ? shotOnTarget ? t("round.shotResolutionClosed") : t("round.goalResolutionClosed") : t("round.windowStarts", { minutes: Math.max(1, Math.round(football.durationSec / 60)) })}</p></div></div>
          <div className="border-l border-white/15 pl-6"><p className="font-['DM_Mono'] text-[10px] uppercase text-white/35">{t("round.officialTracking")}</p><div className="mt-5 grid grid-cols-2 gap-5"><div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{shotOnTarget ? t("round.shotsAtOpening") : t("round.scoreAtOpening")}</p><strong className="mt-2 block font-['Chakra_Petch'] text-4xl font-black">{openingScore}</strong></div><div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{shotOnTarget ? t("round.shotsNow") : t("round.scoreNow")}</p><strong className="mt-2 block font-['Chakra_Petch'] text-4xl font-black text-primary">{shotOnTarget ? targetStats?.shotsOnTarget ?? 0 : `${state.snapshot.match.homeScore}-${state.snapshot.match.awayScore}`}</strong></div></div><div className="mt-7 h-1 overflow-hidden bg-white/10"><motion.div className="h-full bg-primary" animate={{ width: `${football.startsAtClockSec !== undefined && football.endsAtClockSec !== undefined ? Math.max(0, Math.min(100, ((state.snapshot.match.matchClockSec - football.startsAtClockSec) / (football.endsAtClockSec - football.startsAtClockSec)) * 100)) : 0}%` }} /></div><p className="mt-4 font-['DM_Mono'] text-[9px] uppercase text-white/35">{t("round.nowAndLimit", { now: formatClock(state.snapshot.match.matchClockSec), limit: football.endsAtClockSec !== undefined ? formatClock(football.endsAtClockSec) : t("round.afterLock") })}</p>{football.endsAtClockSec !== undefined && state.snapshot.match.matchClockSec >= football.endsAtClockSec ? <p className="mt-2 text-xs text-primary">{t("round.windowExpiredWaiting")}</p> : null}</div>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section layout className="overflow-hidden border-y border-white/15 bg-[#090d18] px-5 py-10 md:px-8 md:py-14">
      <div className="flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary"><Check className="size-4" /> {answersClosed ? t("round.answersClosed") : t("round.answerConfirmed")}</div>
      <div className="mt-7 grid gap-10 lg:grid-cols-[1fr_.72fr] lg:items-end">
        <div>
          <h1 className="font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6.3rem)] font-black uppercase leading-[.8]">{answersClosed ? t("round.nextSignalDecides") : t("round.followingYourPick")}</h1>
          <p className="mt-7 text-sm text-white/50">{answersClosed ? t("round.yourAnswer", { answer: answerLabel }) : t("round.answerPrivateUntilLock")}</p>
          <div className="mt-6 border-l-2 border-primary pl-4"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{answersClosed ? t("round.answersClosed") : t("round.answerWindow")}</p><strong className="mt-1 block font-['Chakra_Petch'] text-2xl font-black uppercase">{answersClosed ? t("round.choicesLocked") : t("round.closesIn", { count: remainingSec })}</strong><p className="mt-1 text-xs text-white/40">{answersClosed ? t("round.firstEligibleSignal") : t("round.othersCanAnswer")}</p></div>
        </div>
        <div className="border-l border-white/15 pl-6">
          <p className="font-['DM_Mono'] text-[10px] uppercase text-white/35">{t("round.monitoredMarket")}</p>
          <div className="mt-5 flex items-end gap-4">
            <SignalValue label={t("round.frozenOpening")} value={opening} locale={locale} />
            <span className="pb-2 text-2xl text-primary">→</span>
            <SignalValue label={t("round.target")} value={target} highlight locale={locale} />
          </div>
          <div className="relative mt-7 h-px bg-white/15"><motion.span className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_24px_rgba(202,255,40,.8)]" animate={{ left: ["8%", "88%", "8%"] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} /></div>
          <p className="mt-6 flex items-center gap-2 text-xs text-white/40"><Radio className="size-3 text-primary" /> {answersClosed ? t("round.monitorAfterClose") : t("round.intermediateUpdatesStable")}</p>
        </div>
      </div>
    </motion.section>
  );
}

function SignalValue({ label, value, highlight = false, locale }: { label: string; value: number | null | undefined; highlight?: boolean; locale: "en" | "pt-BR" }) {
  return <div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</p><strong className={`mt-2 block font-['Chakra_Petch'] text-4xl font-black ${highlight ? "text-primary" : ""}`}>{typeof value === "number" ? <AnimatedNumber value={value} locales={locale} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> : "--"}</strong></div>;
}
