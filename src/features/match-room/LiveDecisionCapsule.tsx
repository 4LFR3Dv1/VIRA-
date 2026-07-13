import { CheckCircle2, CircleDot, Radio, Trophy } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { formatMatchClock } from "../../domain/contracts";
import type { PresentationEvent, ReplayState } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { useServerClock } from "../../runtime/use-server-clock";
import { useLocale } from "../../i18n/locale-context.tsx";
import { stableOptionLabel } from "../../i18n/round-copy.ts";
import type { TranslateFunction } from "../../i18n/translate.ts";

interface LiveDecisionCapsuleProps {
  state: ReplayState;
  latestPresentationEvent?: PresentationEvent | null;
}

function remainingLabel(remainingMs: number | null) {
  const total = Math.max(0, Math.ceil((remainingMs ?? 0) / 1_000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function capsuleState(state: ReplayState, event: PresentationEvent | null | undefined, remainingMs: number | null, t: TranslateFunction) {
  const round = state.snapshot.currentRound;
  if (state.snapshot.match.status === "finished") {
    return {
      tone: "verified",
      icon: Trophy,
      label: t("leaderboard.matchFinished"),
      title: t("capsule.finalLocked"),
      detail: t("room.participants", { count: state.snapshot.leaderboard.length }),
    };
  }

  if (event?.kind === "round_resolved") {
    return {
      tone: event.correct ? "success" : "danger",
      icon: Trophy,
      label: t("result.roundResolved"),
      title: event.correct ? t("result.youWereCorrect") : t("result.received"),
      detail: event.currentRank ? `#${event.currentRank}` : stableOptionLabel(t, event.winningOptionId),
      event,
    };
  }

  if (event?.kind === "answer_registered" || state.currentAnswerState === "submitted") {
    const closed = round?.state === "locked";
    const football = round?.resolution.domain === "football" ? round.resolution.condition : null;
    return {
      tone: "registered",
      icon: CheckCircle2,
      label: closed ? t("round.answersClosed") : t("round.answerConfirmed"),
      title: closed ? football ? t("capsule.yourPickInPlay") : t("round.nextSignalDecides") : t("capsule.choiceProtected"),
      detail: closed && football?.endsAtClockSec !== undefined ? t("round.untilClock", { clock: formatMatchClock(football.endsAtClockSec) }) : closed ? stableOptionLabel(t, state.snapshot.currentParticipantAnswer?.optionId) : remainingLabel(remainingMs),
      event,
    };
  }

  return {
    tone: "open",
    icon: CircleDot,
    label: round ? t("round.label", { number: String(round.sequence).padStart(2, "0") }) : t("capsule.room"),
    title: round?.state === "open" ? t("capsule.openPredictions") : t("capsule.preparingRound"),
    detail: round ? remainingLabel(remainingMs) : t("capsule.waiting"),
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
  const { locale, t } = useLocale();
  const reduceMotion = useReducedMotion();
  const { remainingMs } = useServerClock(state.snapshot.serverTime, state.snapshot.currentRound?.locksAt);
  const current = capsuleState(state, latestPresentationEvent, remainingMs, t);
  const Icon = current.icon;
  const event = "event" in current ? current.event : null;

  return (
    <div className="sticky top-[4.7rem] z-30 mx-auto mt-2 w-full max-w-6xl px-3 md:px-4 lg:px-5">
      <motion.section
        layout
        key={`${state.snapshot.currentRound?.id}:${state.snapshot.currentRound?.state}:${state.currentAnswerState}:${event?.kind ?? "steady"}`}
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
            <h2 className="truncate font-['Chakra_Petch'] text-sm font-bold leading-tight md:text-base">{current.title}</h2>
          </div>
          <div className="shrink-0 rounded-full bg-background/80 px-3 py-1.5 text-right font-['DM_Mono'] text-[10px] text-primary">
            {event?.kind === "round_resolved" ? (
              <AnimatedNumber value={event.pointsAwarded} locales={locale} prefix={event.pointsAwarded > 0 ? "+" : ""} suffix={t("leaderboard.pointsShort")} />
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
