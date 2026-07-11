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
  preMatchContext: MatchTxlineContext | null;
}

export function RoomStage({ state, model, answerSummary, latestPresentationEvent, onSelect, onSubmit, preMatchContext }: RoomStageProps) {
  const round = state.snapshot.currentRound;
  const experience = model.scene;

  if (experience === "provider_unavailable") return <OperationalStage state={state} kind="provider" />;
  if (experience === "no_live_fixture") return <OperationalStage state={state} kind="no-fixture" />;
  if (experience === "scheduled_without_market") return <OperationalStage state={state} kind="scheduled-empty" context={preMatchContext} />;
  if (experience === "scheduled_with_market") return <OperationalStage state={state} kind="scheduled-ready" context={preMatchContext} />;
  if (experience === "live_waiting_for_market") return <PreparingRoundStage state={state} kind="market" />;
  if (experience === "live_waiting_for_round") return <PreparingRoundStage state={state} kind="round" />;

  if (round && state.currentAnswerState === "submitted") {
    return <WaitingSignalStage state={state} latestPresentationEvent={latestPresentationEvent} />;
  }

  return <ActiveRoundScene model={model} state={state} answerSummary={answerSummary} onSelect={onSelect} onSubmit={onSubmit} />;
}

function PreparingRoundStage({ state, kind }: { state: ReplayState; kind: "market" | "round" }) {
  const reduceMotion = useReducedMotion();
  const connected = state.snapshot.connectionState === "live";
  const receivedSignals = state.snapshot.timeline.length;

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
        <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] text-primary">{kind === "market" ? "Partida ao vivo" : "Sinal encontrado"}</p>
        <h1 className="mt-6 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.7rem,6.5vw,6.5rem)] font-black uppercase leading-[.8]">
          {kind === "market" ? "Procurando um" : "Preparando"}
          <span className="block text-primary">{kind === "market" ? "sinal jogavel" : "proxima rodada"}</span>
        </h1>
        <p className="mt-8 max-w-xl text-sm leading-6 text-white/50 md:text-base">
          {kind === "market"
            ? "A TxLINE esta conectada e enviando observacoes, mas ainda nao forneceu um mercado que possa abrir uma rodada."
            : "O mercado foi encontrado. A sala esta transformando o sinal real na proxima pergunta."}
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-x-7 gap-y-3 font-['DM_Mono'] text-[10px] font-bold uppercase tracking-[.12em] text-white/55">
          <StatusMetric active={connected} label={connected ? "Conectado" : "Reconectando"} />
          <StatusMetric label={`${receivedSignals} observacoes recebidas`} />
          <StatusMetric label={`${state.snapshot.roomPopulation} na sala`} />
        </div>
        <p className="mt-12 border-t border-white/15 pt-5 text-xs text-white/35">{kind === "market" ? "Nenhum valor sintetico ou mercado substituto sera criado." : "A rodada abre automaticamente quando a pergunta estiver pronta."}</p>
      </div>
    </motion.section>
  );
}

function OperationalStage({ state, kind, context = null }: { state: ReplayState; kind: "provider" | "no-fixture" | "scheduled-empty" | "scheduled-ready"; context?: MatchTxlineContext | null }) {
  const match = state.snapshot.match;
  const scheduled = kind === "scheduled-empty" || kind === "scheduled-ready";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!scheduled || !match.startTime) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [match.startTime, scheduled]);
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
        {scheduled ? <PreMatchMarketWatch context={context} participantCount={state.snapshot.roomPopulation} /> : null}
      </div>
    </section>
  );
}

function PreMatchMarketWatch({ context, participantCount }: { context: MatchTxlineContext | null; participantCount: number }) {
  const probability = context?.endpoints.odds.data?.winProbability ?? null;
  const markets = context?.availableMarkets.length ?? 0;
  const options = probability ? [
    { label: context?.fixture.homeTeam ?? "Casa", value: probability.home },
    { label: "Empate", value: probability.draw },
    { label: context?.fixture.awayTeam ?? "Visitante", value: probability.away },
  ] : [];
  return <aside className="border-y border-white/15 bg-[#050814]/55 py-6 lg:border lg:p-6"><div className="flex items-center justify-between"><div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.16em] text-primary">Mercado agora</p><h2 className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase">Market Watch</h2></div><Radio className="size-4 text-primary" /></div>{options.length ? <div className="mt-6 border-t border-white/15">{options.map((option) => <div key={option.label} className="flex items-center justify-between border-b border-white/15 py-4"><span className="font-['DM_Mono'] text-[10px] uppercase text-white/45">{option.label}</span><strong className="font-['Chakra_Petch'] text-2xl font-black text-primary"><AnimatedNumber value={option.value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></strong></div>)}</div> : <p className="mt-6 border-y border-white/15 py-6 text-sm text-white/45">Aguardando a primeira distribuição 1X2 confirmada.</p>}<div className="mt-5 flex items-center justify-between font-['DM_Mono'] text-[9px] uppercase text-white/35"><span>{markets} mercados disponíveis</span><span>{participantCount} aguardando</span></div><p className="mt-5 text-xs leading-5 text-white/40">A primeira rodada competitiva abre somente quando a partida entrar ao vivo.</p></aside>;
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
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
  const current = latestPresentationEvent?.kind === "txline_update" ? latestPresentationEvent.currentValue : state.snapshot.marketDistribution.yes;

  return (
    <motion.section layout className="overflow-hidden border-y border-white/15 bg-[#090d18] px-5 py-10 md:px-8 md:py-14">
      <div className="flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary"><Check className="size-4" /> Palpite registrado</div>
      <div className="mt-7 grid gap-10 lg:grid-cols-[1fr_.72fr] lg:items-end">
        <div>
          <h1 className="font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6.3rem)] font-black uppercase leading-[.8]">Aguardando<span className="block text-primary">proximo sinal</span></h1>
          <p className="mt-7 text-sm text-white/50">Voce respondeu: <strong className="ml-1 uppercase text-white">{option?.label ?? answer?.optionId ?? "--"}</strong></p>
        </div>
        <div className="border-l border-white/15 pl-6">
          <p className="font-['DM_Mono'] text-[10px] uppercase text-white/35">Sinal monitorado</p>
          <div className="mt-5 flex items-end gap-4">
            <SignalValue label="Abertura" value={opening} />
            <span className="pb-2 text-2xl text-primary">→</span>
            <SignalValue label={current ? "Agora" : "Alvo"} value={current || target} highlight />
          </div>
          <div className="relative mt-7 h-px bg-white/15"><motion.span className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_24px_rgba(202,255,40,.8)]" animate={{ left: ["8%", "88%", "8%"] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} /></div>
          <p className="mt-6 flex items-center gap-2 text-xs text-white/40"><Radio className="size-3 text-primary" /> A TxLINE resolvera esta rodada no proximo evento elegivel.</p>
        </div>
      </div>
    </motion.section>
  );
}

function SignalValue({ label, value, highlight = false }: { label: string; value: number | null | undefined; highlight?: boolean }) {
  return <div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</p><strong className={`mt-2 block font-['Chakra_Petch'] text-4xl font-black ${highlight ? "text-primary" : ""}`}>{typeof value === "number" ? <AnimatedNumber value={value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> : "--"}</strong></div>;
}
