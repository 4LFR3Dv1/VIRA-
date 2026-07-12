import { Check, Radio } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import type { PresentationEvent, ReplayState } from "../../domain/types";
import type { MatchTxlineContext } from "../../runtime/api";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { ActiveRoundScene } from "./ActiveRoundScene";
import type { ViraExperienceModel } from "./experience-model";

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
  const reduceMotion = useReducedMotion();
  const connected = state.snapshot.connectionState === "live";
  const receivedSignals = state.snapshot.timeline.length;
  const watch = context?.suggestedPrediction ?? null;

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
        <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] text-primary">{kind === "market" ? "Modo observacao" : "Momento encontrado"}</p>
        <h1 className="mt-6 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.7rem,6.5vw,6.5rem)] font-black uppercase leading-[.8]">
          {kind === "market" ? "Acompanhando a" : "Preparando"}
          <span className="block text-primary">{kind === "market" ? "partida" : "proxima rodada"}</span>
        </h1>
        <p className="mt-8 max-w-xl text-sm leading-6 text-white/50 md:text-base">
          {kind === "market"
            ? "O VIRA observa placar, relogio e contexto de mercado. Uma nova pergunta aparece apenas quando a partida produzir um momento relevante."
            : "Um momento futebolistico relevante foi encontrado. A sala esta preparando uma pergunta curta para todos."}
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-x-7 gap-y-3 font-['DM_Mono'] text-[10px] font-bold uppercase tracking-[.12em] text-white/55">
          <StatusMetric active={connected} label={connected ? "Conectado" : "Reconectando"} />
          <StatusMetric label={`${receivedSignals} observacoes recebidas`} />
          <StatusMetric label={`${state.snapshot.roomPopulation} na sala`} />
        </div>
        <p className="mt-12 border-t border-white/15 pt-5 text-xs text-white/35">{kind === "market" ? "Sem botoes agora. Assista ao jogo; o VIRA avisa quando houver algo que valha um palpite." : "A rodada abre somente quando o contrato futebolistico estiver pronto."}</p>
        {watch ? <div className="mt-7 grid w-full max-w-xl grid-cols-[1fr_auto] items-center border-y border-white/15 py-4 text-left"><div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">Market Watch · contexto passivo</p><strong className="mt-1 block font-['Chakra_Petch'] text-xl font-black uppercase">{watch.priceLabel} ganhou contexto</strong></div><span className="font-['Chakra_Petch'] text-3xl font-black text-primary">{watch.pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span></div> : null}
      </div>
    </motion.section>
  );
}

function OperationalStage({ state, kind, context = null, onFanPulse }: { state: ReplayState; kind: "provider" | "no-fixture" | "scheduled-empty" | "scheduled-ready"; context?: MatchTxlineContext | null; onFanPulse?: (side: "home" | "away") => Promise<void> }) {
  const match = state.snapshot.match;
  const scheduled = kind === "scheduled-empty" || kind === "scheduled-ready";
  const offset = state.snapshot.serverTime ? Date.parse(state.snapshot.serverTime) - Date.now() : 0;
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!scheduled || !match.startTime) return undefined;
    setNow(Date.now() + offset);
    const interval = window.setInterval(() => setNow(Date.now() + offset), 1_000);
    return () => window.clearInterval(interval);
  }, [match.startTime, offset, scheduled]);
  const kickoff = match.startTime
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(match.startTime))
    : "horario a confirmar";
  const remainingMs = match.startTime ? Math.max(0, new Date(match.startTime).getTime() - now) : null;
  const countdown = remainingMs === null ? null : formatCountdown(remainingMs);
  const copy = kind === "provider"
    ? { eyebrow: "Sala pausada", title: "Conexao temporariamente interrompida", body: "O estado competitivo foi preservado. Nenhuma resposta ou pontuacao sera alterada enquanto a conexao nao voltar.", tone: "text-amber-300" }
    : kind === "no-fixture"
      ? { eyebrow: "Proxima janela", title: "Nenhuma sala ao vivo agora", body: "As salas competitivas abrem quando uma partida e sinais reais da TxLINE estiverem disponiveis.", tone: "text-primary" }
      : { eyebrow: "Sala pre-jogo", title: countdown ? `A partida comeca em ${countdown}` : `Inicio previsto ${kickoff}`, body: kind === "scheduled-ready" ? "Os mercados pre-jogo ja estao disponiveis. A primeira rodada abre quando a partida entrar na janela ao vivo." : "A partida esta confirmada. Aguardamos o primeiro mercado disponivel da TxLINE.", tone: "text-primary" };

  return (
    <section className="relative min-h-[31rem] overflow-hidden border-y border-white/15 bg-[#090d18]">
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:100%_72px,110px_100%]" />
      <div className={`relative grid min-h-[31rem] items-center gap-10 px-6 py-14 md:px-10 ${scheduled ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]" : ""}`}>
        <div><p className={`font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] ${copy.tone}`}>{copy.eyebrow}</p><h1 className="mt-6 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.6rem,6vw,6.2rem)] font-black uppercase leading-[.82]">{copy.title}</h1><p className="mt-8 max-w-xl text-sm leading-6 text-white/50 md:text-base">{copy.body}</p><div className="mt-10 flex flex-wrap gap-6 font-['DM_Mono'] text-[10px] uppercase tracking-[.12em] text-white/45">{scheduled ? <StatusMetric label={`${state.snapshot.roomPopulation} aguardando`} /> : null}{kind === "provider" ? <StatusMetric active={false} label="Reconectando automaticamente" /> : <StatusMetric label={scheduled ? "Sala aberta" : "Agenda TxLINE"} />}{kind === "scheduled-ready" ? <StatusMetric label="Mercados disponíveis" /> : null}</div></div>
        {scheduled ? <PreMatchMarketWatch state={state} context={context} participantCount={state.snapshot.roomPopulation} onFanPulse={onFanPulse} /> : null}
      </div>
    </section>
  );
}

function PreMatchMarketWatch({ state, context, participantCount, onFanPulse }: { state: ReplayState; context: MatchTxlineContext | null; participantCount: number; onFanPulse?: (side: "home" | "away") => Promise<void> }) {
  const [submitting, setSubmitting] = useState<"home" | "away" | null>(null);
  const [pulseError, setPulseError] = useState(false);
  const probability = context?.canonical1X2?.selections ?? null;
  const markets = context?.marketTaxonomy?.observed ?? context?.availableMarkets.length ?? 0;
  const homeName = context?.fixture.homeTeam ?? state.snapshot.match.homeTeam.name;
  const awayName = context?.fixture.awayTeam ?? state.snapshot.match.awayTeam.name;
  const pulse = state.snapshot.fanPulse ?? { total: 0, byTeam: { home: 0, away: 0 }, currentParticipantChoice: null };
  const homeShare = pulse.total ? Math.round((pulse.byTeam.home / pulse.total) * 100) : 50;
  const awayShare = pulse.total ? 100 - homeShare : 50;
  const options = probability ? [
    { label: homeName, value: probability.home },
    { label: "Empate", value: probability.draw },
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
          <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.16em] text-primary">Mercado agora</p><h2 className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase">Market Watch</h2></div>
          <Radio className="size-4 text-primary" />
        </div>
        {options.length ? <div className="mt-5 grid grid-cols-3 border-y border-white/15">{options.map((option) => <div key={option.label} className="border-r border-white/15 px-2 py-4 text-center last:border-r-0"><span className="block truncate font-['DM_Mono'] text-[9px] uppercase text-white/45">{option.label}</span><strong className="mt-2 block font-['Chakra_Petch'] text-xl font-black text-primary"><AnimatedNumber value={option.value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></strong></div>)}</div> : <p className="mt-5 border-y border-white/15 py-5 text-sm text-white/45">Aguardando a primeira distribuição 1X2 confirmada.</p>}
      </div>

      <div className="border-t border-white/15 p-6">
        <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.16em] text-primary">Fan Pulse</p>
        <h3 className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase">Com quem voce esta?</h3>
        <p className="mt-2 text-xs text-white/40">Torcida pre-jogo. Nao vale pontos e nao interfere no mercado.</p>
        <div className="mt-5 grid grid-cols-2 border-y border-white/15">
          {(["home", "away"] as const).map((side) => {
            const selected = pulse.currentParticipantChoice === side;
            const label = side === "home" ? homeName : awayName;
            const share = side === "home" ? homeShare : awayShare;
            return <button key={side} type="button" disabled={Boolean(pulse.currentParticipantChoice) || Boolean(submitting)} onClick={() => void cast(side)} className={`relative min-h-24 overflow-hidden border-r border-white/15 p-4 text-left last:border-r-0 ${selected ? "bg-primary text-[#050814]" : "bg-white/[.02] hover:bg-white/[.06]"}`}><span className="relative z-10 block truncate font-['Chakra_Petch'] text-lg font-black uppercase">{label}</span><span className={`relative z-10 mt-5 block font-['DM_Mono'] text-[9px] uppercase ${selected ? "text-[#050814]/60" : "text-white/35"}`}>{submitting === side ? "Confirmando..." : selected ? "Seu lado" : pulse.total ? `${share}% da torcida` : "Escolher lado"}</span>{pulse.total ? <span className="absolute bottom-1 right-2 font-['Chakra_Petch'] text-5xl font-black opacity-10">{share}%</span> : null}</button>;
          })}
        </div>
        <div className="mt-4 flex items-center justify-between font-['DM_Mono'] text-[9px] uppercase text-white/35"><span>{pulse.total} no Fan Pulse</span><span>{participantCount} aguardando</span></div>
        {pulseError ? <p className="mt-3 text-xs text-amber-300">Nao foi possivel registrar sua torcida. Tente novamente.</p> : null}
      </div>

      <div className="border-t border-white/15 px-6 py-4 font-['DM_Mono'] text-[9px] uppercase text-white/35"><span>{markets} mercados TxLINE observados · {Math.min(5, markets)} em foco</span><p className="mt-2 normal-case leading-5">A primeira rodada competitiva abre somente quando a partida entrar ao vivo.</p></div>
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
  const round = state.snapshot.currentRound;
  if (!round) return null;
  const participant = state.snapshot.currentParticipant;
  const answer = state.snapshot.currentParticipantAnswer ?? (participant ? state.snapshot.answers[participant.id] : null);
  const option = round.options.find((item) => item.id === answer?.optionId);
  const predicate = round.resolution.predicate ?? {};
  const opening = typeof predicate.openingValue === "number" ? predicate.openingValue : null;
  const target = typeof predicate.pctGte === "number" ? predicate.pctGte : null;
  const offset = state.snapshot.serverTime ? Date.parse(state.snapshot.serverTime) - Date.now() : 0;
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (round.state !== "open") return undefined;
    setNow(Date.now() + offset);
    const timer = window.setInterval(() => setNow(Date.now() + offset), 500);
    return () => window.clearInterval(timer);
  }, [offset, round.id, round.state]);
  const remainingSec = Math.max(0, Math.ceil((Date.parse(round.locksAt) - now) / 1_000));
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
        <div className="flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary"><Check className="size-4" /> {answersClosed ? "Palpite em jogo" : "Palpite confirmado"}</div>
        <div className="mt-7 grid gap-10 lg:grid-cols-[1fr_.72fr] lg:items-end">
          <div><h1 className="font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6.3rem)] font-black uppercase leading-[.8]">{targetTeam.name}<span className="block text-primary">{shotOnTarget ? "finaliza no alvo?" : "marca?"}</span></h1><p className="mt-7 text-sm text-white/50">Voce respondeu: <strong className="ml-1 uppercase text-white">{option?.label ?? answer?.optionId ?? "--"}</strong></p><div className="mt-6 border-l-2 border-primary pl-4"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{answersClosed ? "Horizonte da previsao" : "Janela de resposta"}</p><strong className="mt-1 block font-['Chakra_Petch'] text-2xl font-black uppercase">{answersClosed && football.endsAtClockSec !== undefined ? `Ate ${formatClock(football.endsAtClockSec)}` : `Fecha em ${remainingSec}s`}</strong><p className="mt-1 text-xs text-white/40">{answersClosed ? shotOnTarget ? "Uma finalizacao no alvo confirmada resolve SIM. Sem chute no alvo, NAO vence." : "Um gol confirmado resolve SIM. Sem gol ate o limite, NAO vence." : `A janela de ${shotOnTarget ? "5" : "10"} minutos começa depois que as respostas forem bloqueadas.`}</p></div></div>
          <div className="border-l border-white/15 pl-6"><p className="font-['DM_Mono'] text-[10px] uppercase text-white/35">Acompanhamento oficial</p><div className="mt-5 grid grid-cols-2 gap-5"><div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{shotOnTarget ? "No alvo na abertura" : "Placar na abertura"}</p><strong className="mt-2 block font-['Chakra_Petch'] text-4xl font-black">{openingScore}</strong></div><div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{shotOnTarget ? "No alvo agora" : "Placar atual"}</p><strong className="mt-2 block font-['Chakra_Petch'] text-4xl font-black text-primary">{shotOnTarget ? targetStats?.shotsOnTarget ?? 0 : `${state.snapshot.match.homeScore}-${state.snapshot.match.awayScore}`}</strong></div></div><div className="mt-7 h-1 overflow-hidden bg-white/10"><motion.div className="h-full bg-primary" animate={{ width: `${football.startsAtClockSec !== undefined && football.endsAtClockSec !== undefined ? Math.max(0, Math.min(100, ((state.snapshot.match.matchClockSec - football.startsAtClockSec) / (football.endsAtClockSec - football.startsAtClockSec)) * 100)) : 0}%` }} /></div><p className="mt-4 font-['DM_Mono'] text-[9px] uppercase text-white/35">Agora {formatClock(state.snapshot.match.matchClockSec)} · limite {football.endsAtClockSec !== undefined ? formatClock(football.endsAtClockSec) : "apos o lock"}</p>{football.endsAtClockSec !== undefined && state.snapshot.match.matchClockSec >= football.endsAtClockSec ? <p className="mt-2 text-xs text-primary">Janela encerrada. Aguardando a observacao consolidada da TxLINE.</p> : null}</div>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section layout className="overflow-hidden border-y border-white/15 bg-[#090d18] px-5 py-10 md:px-8 md:py-14">
      <div className="flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary"><Check className="size-4" /> {answersClosed ? "Respostas encerradas" : "Palpite confirmado"}</div>
      <div className="mt-7 grid gap-10 lg:grid-cols-[1fr_.72fr] lg:items-end">
        <div>
          <h1 className="font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6.3rem)] font-black uppercase leading-[.8]">{answersClosed ? "O proximo sinal" : "Acompanhando seu"}<span className="block text-primary">{answersClosed ? "decide" : "palpite"}</span></h1>
          <p className="mt-7 text-sm text-white/50">Voce respondeu: <strong className="ml-1 uppercase text-white">{option?.label ?? answer?.optionId ?? "--"}</strong></p>
          <div className="mt-6 border-l-2 border-primary pl-4"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{answersClosed ? "Estado da rodada" : "Janela de resposta"}</p><strong className="mt-1 block font-['Chakra_Petch'] text-2xl font-black uppercase">{answersClosed ? "Escolhas bloqueadas" : `Fecha em ${remainingSec}s`}</strong><p className="mt-1 text-xs text-white/40">{answersClosed ? "A primeira observacao elegivel recebida agora resolve todos." : "Seu palpite ja esta confirmado. Outros participantes ainda podem responder."}</p></div>
        </div>
        <div className="border-l border-white/15 pl-6">
          <p className="font-['DM_Mono'] text-[10px] uppercase text-white/35">Sinal monitorado</p>
          <div className="mt-5 flex items-end gap-4">
            <SignalValue label="Abertura congelada" value={opening} />
            <span className="pb-2 text-2xl text-primary">→</span>
            <SignalValue label="Alvo" value={target} highlight />
          </div>
          <div className="relative mt-7 h-px bg-white/15"><motion.span className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_24px_rgba(202,255,40,.8)]" animate={{ left: ["8%", "88%", "8%"] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} /></div>
          <p className="mt-6 flex items-center gap-2 text-xs text-white/40"><Radio className="size-3 text-primary" /> {answersClosed ? "Monitorando o primeiro sinal elegivel apos o fechamento." : "Updates intermediarios nao alteram sua pergunta, abertura ou alvo."}</p>
        </div>
      </div>
    </motion.section>
  );
}

function SignalValue({ label, value, highlight = false }: { label: string; value: number | null | undefined; highlight?: boolean }) {
  return <div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</p><strong className={`mt-2 block font-['Chakra_Petch'] text-4xl font-black ${highlight ? "text-primary" : ""}`}>{typeof value === "number" ? <AnimatedNumber value={value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> : "--"}</strong></div>;
}
