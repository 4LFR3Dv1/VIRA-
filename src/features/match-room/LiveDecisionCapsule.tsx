import { Activity, CheckCircle2, CircleDot, Radio, Trophy } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { formatMatchClock } from "../../domain/contracts";
import type { PresentationEvent, ReplayState } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";

interface LiveDecisionCapsuleProps {
  state: ReplayState;
  latestPresentationEvent?: PresentationEvent | null;
}

function pct(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return <AnimatedNumber value={value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />;
}

function optionLabel(optionId: string | null | undefined) {
  if (optionId === "yes") return "Sim";
  if (optionId === "no") return "Nao";
  return optionId ?? "--";
}

function capsuleState(state: ReplayState, event?: PresentationEvent | null) {
  const round = state.snapshot.currentRound;
  if (state.snapshot.match.status === "finished") {
    return {
      tone: "verified",
      icon: Trophy,
      label: "Partida encerrada",
      title: "Ranking final bloqueado",
      detail: `${state.snapshot.leaderboard.length} participantes`,
    };
  }

  if (event?.kind === "round_resolved") {
    return {
      tone: event.correct ? "success" : "danger",
      icon: Trophy,
      label: "Rodada resolvida",
      title: event.correct ? "Voce acertou" : "Resultado recebido",
      detail: event.currentRank ? `#${event.currentRank}` : optionLabel(event.winningOptionId),
      event,
    };
  }

  if (event?.kind === "txline_update") {
    return {
      tone: "live",
      icon: Activity,
      label: "TxLINE update",
      title: "Mercado atualizado",
      detail: event.currentValue !== null ? `${event.currentValue.toFixed(1)}%` : "sinal recebido",
      event,
    };
  }

  if (event?.kind === "answer_registered" || state.currentAnswerState === "submitted") {
    return {
      tone: "registered",
      icon: CheckCircle2,
      label: "Palpite registrado",
      title: "Aguardando TxLINE",
      detail: round ? `Rodada ${String(round.sequence).padStart(2, "0")}` : "sincronizado",
      event,
    };
  }

  return {
    tone: "open",
    icon: CircleDot,
    label: round ? `Rodada ${String(round.sequence).padStart(2, "0")}` : "Sala",
    title: round?.state === "open" ? "Palpites abertos" : "Preparando rodada",
    detail: round ? formatMatchClock(Math.max(round.locksAtClockSec - state.snapshot.match.matchClockSec, 0)) : "aguardando",
  };
}

function toneClasses(tone: string) {
  if (tone === "success") return "border-emerald-400/50 bg-emerald-400/12 text-emerald-100";
  if (tone === "danger") return "border-destructive/50 bg-destructive/12 text-red-100";
  if (tone === "registered") return "border-primary/45 bg-primary/12 text-primary";
  if (tone === "verified") return "border-primary/35 bg-card text-foreground";
  if (tone === "live") return "border-sky-300/35 bg-sky-300/10 text-sky-100";
  return "border-border bg-card/95 text-foreground";
}

export function LiveDecisionCapsule({ state, latestPresentationEvent }: LiveDecisionCapsuleProps) {
  const reduceMotion = useReducedMotion();
  const current = capsuleState(state, latestPresentationEvent);
  const Icon = current.icon;
  const event = "event" in current ? current.event : null;

  return (
    <div className="sticky top-[4.7rem] z-30 mx-auto mt-2 w-full max-w-6xl px-3 md:px-4 lg:px-5">
      <motion.section
        layout
        key={`${current.label}:${current.title}:${event?.id ?? state.snapshot.version}`}
        initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        aria-live="polite"
        className={`overflow-hidden rounded-full border px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,.24)] backdrop-blur-xl ${toneClasses(current.tone)}`}
      >
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-background/80">
            <Icon className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-['DM_Mono'] text-[9px] uppercase tracking-[.16em] text-muted-foreground">
              {current.label}
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate font-['Chakra_Petch'] text-sm font-bold leading-tight md:text-base">{current.title}</h2>
              {event?.kind === "txline_update" && event.previousValue !== null && event.currentValue !== null ? (
                <span className="hidden shrink-0 items-center gap-1 font-['DM_Mono'] text-[10px] text-primary sm:inline-flex">
                  {pct(event.previousValue)}
                  <span className="text-muted-foreground">→</span>
                  {pct(event.currentValue)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-background/80 px-3 py-1.5 text-right font-['DM_Mono'] text-[10px] text-primary">
            {event?.kind === "round_resolved" ? (
              <AnimatedNumber value={event.pointsAwarded} prefix={event.pointsAwarded > 0 ? "+" : ""} suffix=" pts" />
            ) : (
              current.detail
            )}
          </div>
          <Radio className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
        </div>
      </motion.section>
    </div>
  );
}
