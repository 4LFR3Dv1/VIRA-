import { ArrowRight, BellRing, ExternalLink, Radio, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { useLocale } from "../../i18n/locale-context.tsx";
import { useServerClock } from "../../runtime/use-server-clock.ts";
import type { ViraCompanionState, ViraCompanionViewModel } from "./view-model.ts";

interface ViraCompanionProps {
  model: ViraCompanionViewModel;
  enabled: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onReturnToRoom?: () => void;
  onOpenFloating?: () => void;
  floatingAvailable?: boolean;
  mode?: "in_app" | "compact" | "pip";
}

const stateKeys: Record<ViraCompanionState, `companion.state.${ViraCompanionState}`> = {
  upcoming: "companion.state.upcoming",
  live: "companion.state.live",
  round_open: "companion.state.round_open",
  answer_confirmed: "companion.state.answer_confirmed",
  locked: "companion.state.locked",
  resolved: "companion.state.resolved",
  offline: "companion.state.offline",
  reconnecting: "companion.state.reconnecting",
  error: "companion.state.error",
};

function clock(value: number) {
  const seconds = Math.max(0, Math.ceil(value / 1_000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function ViraCompanion({ model, enabled, onFollow, onUnfollow, onReturnToRoom, onOpenFloating, floatingAvailable = false, mode = "in_app" }: ViraCompanionProps) {
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  const { remainingMs } = useServerClock(undefined, model.locksAt);
  const isUrgent = model.state === "round_open" || model.state === "answer_confirmed";
  const roundPrompt = model.roundKind === "team_scores" && model.targetTeam && model.durationMinutes
    ? t("round.question.teamScores", { team: model.targetTeam, minutes: model.durationMinutes })
    : model.roundKind === "team_shot_on_target" && model.targetTeam && model.durationMinutes
      ? t("round.question.teamShotOnTarget", { team: model.targetTeam, minutes: model.durationMinutes })
      : t("round.question.marketTarget");

  if (!enabled) {
    return (
      <section aria-label={t("companion.title")} className="border border-primary/25 bg-[#08101a]/95 p-4 text-white shadow-[0_18px_60px_rgba(0,0,0,.28)] md:p-5">
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center bg-primary text-[#050a12]"><BellRing className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] text-primary">{t("companion.kicker")}</p>
            <h2 className="mt-1 font-['Chakra_Petch'] text-xl font-black uppercase">{t("companion.follow")}</h2>
            <p className="mt-2 max-w-xl text-sm leading-5 text-white/60">{t("companion.followDescription")}</p>
          </div>
          <button type="button" onClick={onFollow} className="inline-flex min-h-11 shrink-0 items-center gap-2 bg-primary px-4 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.12em] text-[#050a12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {t("companion.followAction")}<ArrowRight className="size-4" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <motion.section
      layout={!reduceMotion}
      aria-label={t("companion.title")}
      aria-live="polite"
      data-companion-state={model.state}
      className={`relative overflow-hidden border bg-[#08101a]/98 text-white shadow-[0_22px_80px_rgba(0,0,0,.34)] ${isUrgent ? "border-primary/70" : "border-white/15"} ${mode === "in_app" ? "p-4 md:p-5" : "min-h-full p-4"}`}
    >
      <motion.div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary" animate={reduceMotion ? undefined : isUrgent ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.65 }} transition={reduceMotion ? undefined : { duration: 1.2, repeat: Infinity }} />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/vira-symbol.png" alt="" className="size-8 object-contain" />
          <div className="min-w-0"><p className="font-['Chakra_Petch'] text-sm font-black uppercase">{t("companion.title")}</p><p className="truncate font-['DM_Mono'] text-[9px] uppercase tracking-[.14em] text-white/45">{model.homeTeam} × {model.awayTeam}</p></div>
        </div>
        <button type="button" onClick={onUnfollow} className="grid size-9 place-items-center text-white/45 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={t("companion.unfollow")}><X className="size-4" /></button>
      </div>

      <motion.div key={model.state} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="mt-5 pl-2">
          <div className="flex items-end justify-between gap-4">
            <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">{t(stateKeys[model.state])}</p><p className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase leading-none">{model.homeScore} <span className="text-white/25">:</span> {model.awayScore}</p></div>
            {isUrgent && remainingMs !== null ? <div className="text-right"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/45">{t("companion.closesIn")}</p><p className="font-['Chakra_Petch'] text-3xl font-black tabular-nums text-primary">{clock(remainingMs)}</p></div> : null}
          </div>
          {model.state === "round_open" || model.state === "answer_confirmed" || model.state === "locked" ? <p className="mt-4 border-t border-white/10 pt-4 text-sm font-semibold leading-5">{roundPrompt}</p> : null}
          {model.state === "answer_confirmed" ? <p className="mt-2 text-xs text-white/55">{t("companion.privateUntilLock")}</p> : null}
          {model.state === "resolved" ? <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4"><Metric label={t("companion.result")} value={model.correct ? t("companion.correct") : t("companion.incorrect")} /><Metric label={t("companion.points")} value={model.pointsAwarded === null ? "—" : `+${model.pointsAwarded}`} /><Metric label={t("companion.rank")} value={model.rank === null ? "—" : `#${model.rank}`} /></div> : null}
          {model.state === "offline" || model.state === "reconnecting" ? <p className="mt-3 text-xs text-amber-200/80">{t(model.state === "offline" ? "companion.offlineDescription" : "companion.reconnectingDescription")}</p> : null}
      </motion.div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pl-2 pt-4">
        {onReturnToRoom ? <button type="button" onClick={onReturnToRoom} className="inline-flex min-h-10 items-center gap-2 bg-primary px-4 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.1em] text-[#050a12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{t("companion.returnToRoom")}<ArrowRight className="size-3.5" /></button> : null}
        {onOpenFloating ? <button type="button" onClick={onOpenFloating} disabled={!floatingAvailable} className="inline-flex min-h-10 items-center gap-2 border border-white/20 px-3 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.1em] text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ExternalLink className="size-3.5" />{floatingAvailable ? t("companion.openFloating") : t("companion.openCompact")}</button> : null}
        <span className="ml-auto inline-flex items-center gap-1.5 self-center font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/35"><Radio className="size-3" />{t("companion.authority")}</span>
      </div>
    </motion.section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="font-['DM_Mono'] text-[8px] uppercase tracking-[.12em] text-white/35">{label}</p><p className="mt-1 font-['Chakra_Petch'] text-lg font-black uppercase">{value}</p></div>;
}
