import { Check, Send } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import type { ReplayState } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import type { ViraExperienceModel } from "./experience-model";

interface ActiveRoundSceneProps {
  model: ViraExperienceModel;
  state: ReplayState;
  answerSummary: Record<string, number>;
  onSelect: (optionId: string) => void;
  onSubmit: () => void;
}

export function ActiveRoundScene({ model, state, answerSummary, onSelect, onSubmit }: ActiveRoundSceneProps) {
  if (!model.round) return null;
  const selected = state.selectedOptionId;
  const locked = state.currentAnswerState === "submitted" || state.snapshot.currentRound?.state !== "open";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [state.snapshot.currentRound?.id]);
  const remainingSec = Math.max(0, Math.ceil((Date.parse(state.snapshot.currentRound?.locksAt ?? "") - now) / 1_000));
  const total = Object.values(answerSummary).reduce((sum, value) => sum + value, 0);
  const football = state.snapshot.currentRound?.resolution.domain === "football";

  return (
    <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden border-y border-white/15 bg-[#090d18] px-5 py-8 md:px-8 md:py-11">
      <div className="flex items-end justify-between gap-5 border-b border-white/15 pb-5">
        <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] text-primary">Rodada {String(model.round.number).padStart(2, "0")}</p><p className="mt-1 text-xs text-white/40">Uma resposta por participante</p></div>
        <span className="font-['DM_Mono'] text-[10px] uppercase text-white/55">{model.round.status === "open" ? `${remainingSec}s para responder` : "Respostas encerradas"}</span>
      </div>

      <h1 className="mt-8 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.6rem,5.8vw,6rem)] font-black uppercase leading-[.8]">{model.round.question}</h1>

      {football ? <FootballRoundBrief state={state} remainingSec={remainingSec} /> : model.market ? <MarketScoreboard model={model} remainingSec={remainingSec} /> : null}

      <div className="mt-8 grid min-h-52 overflow-hidden border-y border-white/15 md:grid-cols-2">
        {model.round.options.map((option) => {
          const isSelected = selected === option.id;
          const share = total ? ((answerSummary[option.id] ?? 0) / total) * 100 : 50;
          return <motion.button
            key={option.id}
            type="button"
            disabled={locked}
            onClick={() => onSelect(option.id)}
            animate={{ opacity: selected && !isSelected ? 0.45 : 1, backgroundColor: isSelected ? "#caff28" : "rgba(255,255,255,.025)", color: isSelected ? "#070a13" : "#ffffff" }}
            className="relative border-b border-white/15 p-6 text-left last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"
          >
            <span className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.16em] opacity-50">{option.shortLabel}</span>
            <strong className="mt-8 block font-['Chakra_Petch'] text-3xl font-black uppercase leading-[.86] md:text-4xl">{option.label}</strong>
            <p className="mt-4 max-w-xs text-sm opacity-50">{option.explanation}</p>
            {locked ? <span className="absolute bottom-5 right-5 font-['Chakra_Petch'] text-5xl font-black opacity-10"><AnimatedNumber value={share} suffix="%" format={{ maximumFractionDigits: 0 }} /></span> : null}
            {isSelected ? <Check className="absolute right-5 top-5 size-5" /> : null}
          </motion.button>;
        })}
      </div>

      {!locked ? <button type="button" disabled={!selected} onClick={onSubmit} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 bg-primary px-7 font-['Chakra_Petch'] text-sm font-black uppercase text-[#070a13] disabled:cursor-not-allowed disabled:opacity-25"><Send className="size-4" /> Confirmar palpite</button> : null}
    </motion.section>
  );
}

function FootballRoundBrief({ state, remainingSec }: { state: ReplayState; remainingSec: number }) {
  const condition = state.snapshot.currentRound?.resolution.condition;
  const team = condition?.targetSide === "away" ? state.snapshot.match.awayTeam : state.snapshot.match.homeTeam;
  return <section className="mt-9 grid gap-5 border-y border-white/15 py-6 md:grid-cols-[1fr_auto] md:items-end">
    <div><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">Condicao futebolistica</p><h2 className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase">{team?.name} precisa marcar</h2><p className="mt-2 text-sm text-white/45">A janela de 10 minutos começa quando as respostas forem encerradas.</p></div>
    <div className="border-l border-white/15 pl-5 text-right"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">Respostas fecham</p><strong className="font-['Chakra_Petch'] text-4xl font-black text-primary">{remainingSec}s</strong></div>
  </section>;
}

function MarketScoreboard({ model, remainingSec }: { model: ViraExperienceModel; remainingSec: number }) {
  const market = model.market;
  if (!market) return null;
  const values = [market.openingValue, market.currentValue, market.targetValue].filter((value): value is number => typeof value === "number");
  const min = Math.min(...values, 0) - 1;
  const max = Math.max(...values, 100) + 1;
  const position = (value: number | null) => value === null ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return <section className="mt-9 border-y border-white/15 py-7">
    <div className="flex items-end justify-between gap-4"><div><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">Placar da rodada</p><h2 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">{market.label}</h2></div><span className="text-right font-['DM_Mono'] text-[9px] uppercase text-white/45">{remainingSec}s para responder<br />depois, o proximo sinal decide</span></div>
    <div className="relative mt-9 h-16">
      <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
      {market.targetValue !== null ? <span className="absolute top-0 h-full w-px bg-primary" style={{ left: `${position(market.targetValue)}%` }} /> : null}
      {market.currentValue !== null ? <motion.span layoutId="live-market-value" className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_28px_rgba(202,255,40,.8)]" animate={{ left: `${position(market.currentValue)}%` }} /> : null}
    </div>
    <div className="grid grid-cols-3 gap-4 border-t border-white/10 pt-5"><Probability label="Abertura" value={market.openingValue} /><Probability label="Referencia" value={market.openingValue} highlight /><Probability label="Alvo" value={market.targetValue} /></div>
  </section>;
}

function Probability({ label, value, highlight = false }: { label: string; value: number | null; highlight?: boolean }) {
  return <div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</p><strong className={`mt-1 block font-['Chakra_Petch'] text-3xl font-black ${highlight ? "text-primary" : ""}`}>{value === null ? "--" : <AnimatedNumber value={value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />}</strong></div>;
}
