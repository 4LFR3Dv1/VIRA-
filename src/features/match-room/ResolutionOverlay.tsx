import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import type { PresentationEvent, RoundResolutionResult } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";

interface Props { result: RoundResolutionResult | null; presentationEvent?: PresentationEvent | null; open: boolean; onClose: () => void; shareAction?: React.ReactNode }

function Pct({ value }: { value: number | null | undefined }) {
  return typeof value === "number" ? <AnimatedNumber value={value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> : <>--</>;
}

export function ResolutionOverlay({ result, presentationEvent, open, onClose, shareAction }: Props) {
  const [act, setAct] = useState(0);
  const reduceMotion = useReducedMotion();
  const event = presentationEvent?.kind === "round_resolved" ? presentationEvent : null;
  useEffect(() => {
    if (!open || !result) return undefined;
    setAct(reduceMotion ? 3 : 0);
    if (reduceMotion) return undefined;
    const timers = [850, 1750, 2850].map((delay, index) => window.setTimeout(() => setAct(index + 1), delay));
    return () => timers.forEach(window.clearTimeout);
  }, [open, reduceMotion, result?.roundId]);
  if (!open || !result) return null;

  const success = result.wasCurrentUserCorrect;
  const opening = event?.openingValue ?? null;
  const current = event?.resolutionValue ?? null;
  const football = result.resolutionDomain === "football";
  const finalScore = result.event?.absoluteScore;
  const shotCondition = result.condition?.kind === "team_shot_on_target" ? result.condition : null;
  const shotOnTarget = Boolean(shotCondition);
  const targetSide = result.condition?.targetSide === "away" ? "away" : "home";
  const openingStat = shotCondition?.openingObservation?.shotsOnTarget ?? 0;
  const finalStat = shotCondition ? result.event?.authoritativeStats?.[targetSide]?.shotsOnTarget ?? shotCondition.confirmedObservation?.value ?? openingStat : null;
  const scoreOpening = result.condition?.kind === "team_scores" ? result.condition.openingObservation : null;
  const footballActs = [
    <Act key="observation" eyebrow="Observacao oficial TxLINE"><Big>{shotOnTarget ? <>{openingStat}<span className="text-primary"> → </span>{finalStat}</> : <>{scoreOpening?.homeScore ?? 0}-{scoreOpening?.awayScore ?? 0}<span className="text-primary"> → </span>{finalScore?.home ?? 0}-{finalScore?.away ?? 0}</>}</Big><p className="mt-7 text-white/45">{shotOnTarget ? "Finalizacoes no alvo confirmadas para a equipe." : `Placar consolidado no minuto ${Math.floor((result.event?.matchClockSec ?? 0) / 60)}.`}</p></Act>,
    <Act key="rule" eyebrow="Condicao avaliada"><Big>{result.resolutionReason === "window_expired" ? "Janela encerrada" : result.resolutionReason === "match_finished" ? "Partida encerrada" : shotOnTarget ? "Chute confirmado" : "Gol confirmado"}</Big><p className="mt-7 text-white/45">Opcao vencedora: <strong className="uppercase text-white">{result.winningOptionId === "yes" ? "Sim" : "Nao"}</strong></p></Act>,
  ];
  const marketActs = [
    <Act key="signal" eyebrow="Novo sinal TxLINE"><Big><Pct value={opening} /><span className="text-primary"> → </span><Pct value={current} /></Big><p className="mt-7 text-white/45">A probabilidade recebeu uma nova observacao.</p></Act>,
    <Act key="rule" eyebrow="Regra avaliada"><Big>{event?.winningOptionId === "yes" ? "Alvo cruzado" : "Abaixo do alvo"}</Big><p className="mt-7 text-white/45">Opcao vencedora: <strong className="uppercase text-white">{result.winningOptionId === "yes" ? "Sim" : "Nao"}</strong></p></Act>,
  ];
  const acts = [
    ...(football ? footballActs : marketActs),
    <Act key="result" eyebrow="Rodada resolvida"><h2 className="font-['Chakra_Petch'] text-[clamp(3.5rem,10vw,10rem)] font-black uppercase leading-[.74]">{success ? "Voce acertou" : "Resultado recebido"}</h2><p className="mt-10 font-['Chakra_Petch'] text-[clamp(5rem,13vw,12rem)] font-black leading-none text-primary"><AnimatedNumber value={result.pointsAwarded} prefix={result.pointsAwarded > 0 ? "+" : ""} /></p></Act>,
    <Act key="ranking" eyebrow="Ranking atualizado"><h2 className="font-['Chakra_Petch'] text-[clamp(3.2rem,9vw,8rem)] font-black uppercase leading-[.78]">{event?.previousRank && event.currentRank ? <><span className="text-white/35">#{event.previousRank}</span><span className="text-primary"> → </span>#{event.currentRank}</> : result.movementLabel}</h2><p className="mt-8 font-['DM_Mono'] text-xs uppercase tracking-[.16em] text-primary">Resultado registrado no ledger</p></Act>,
  ];
  return <motion.div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[#050814] px-5" initial={{ clipPath: "inset(100% 0 0 0)" }} animate={{ clipPath: "inset(0% 0 0 0)" }} transition={{ duration: reduceMotion ? 0 : .5, ease: [.76, 0, .24, 1] }}>
    <div aria-hidden className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:100%_90px,140px_100%]" />
    <AnimatePresence mode="wait">{acts[act]}</AnimatePresence>
    {act === 3 ? <div className="absolute bottom-8 right-8 flex flex-wrap justify-end gap-3">{shareAction}<button onClick={onClose} className="inline-flex min-h-12 items-center gap-2 border border-white/20 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary"><X className="size-4" /> Voltar a sala</button></div> : null}
    <div className="absolute bottom-8 left-8 flex gap-2">{acts.map((_, index) => <span key={index} className={`h-1 w-8 ${index <= act ? "bg-primary" : "bg-white/15"}`} />)}</div>
  </motion.div>;
}

function Act({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return <motion.section key={eyebrow} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -28 }} className="relative z-10 w-full max-w-6xl text-center"><p className="mb-7 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.22em] text-primary">{eyebrow}</p>{children}</motion.section>;
}
function Big({ children }: { children: React.ReactNode }) { return <h2 className="font-['Chakra_Petch'] text-[clamp(3.8rem,11vw,10rem)] font-black uppercase leading-none">{children}</h2>; }
