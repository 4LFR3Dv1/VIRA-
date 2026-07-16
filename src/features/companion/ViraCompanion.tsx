import { ArrowRight, Bell, BellOff, BellRing, ExternalLink, Radio, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { memo } from "react";

import { useLocale } from "../../i18n/locale-context.tsx";
import { sameViraCompanionViewModel, type ViraCompanionState, type ViraCompanionViewModel } from "./view-model.ts";
import type { UserPushType, WebPushState } from "./use-web-push.ts";

interface ViraCompanionProps {
  model: ViraCompanionViewModel;
  enabled: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onReturnToRoom?: () => void;
  onOpenFloating?: () => void;
  floatingAvailable?: boolean;
  mode?: "in_app" | "compact" | "pip";
  pushState?: WebPushState;
  enabledPushTypes?: UserPushType[];
  onEnableAlerts?: () => void;
  onDisableAlerts?: () => void;
  onToggleAlertType?: (type: UserPushType) => void;
  onClose?: () => void;
  remainingMs?: number | null;
}

const pushTypeKeys: Record<UserPushType, "companion.alertType.matchStarting" | "companion.alertType.roundOpen" | "companion.alertType.roundResolved" | "companion.alertType.rankChanged"> = {
  match_starting: "companion.alertType.matchStarting", round_open: "companion.alertType.roundOpen", round_resolved: "companion.alertType.roundResolved", rank_changed: "companion.alertType.rankChanged",
};

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

function ViraCompanionComponent({ model, enabled, onFollow, onUnfollow, onReturnToRoom, onOpenFloating, floatingAvailable = false, mode = "in_app", pushState, enabledPushTypes = [], onEnableAlerts, onDisableAlerts, onToggleAlertType, onClose, remainingMs = null }: ViraCompanionProps) {
  (globalThis as typeof globalThis & { __VIRA_COMPANION_RENDER_PROBE__?: (mode: string) => void }).__VIRA_COMPANION_RENDER_PROBE__?.(mode);
  const { t, teamName } = useLocale();
  const reduceMotion = useReducedMotion();
  const isUrgent = model.state === "round_open" || model.state === "answer_confirmed";
  const roundPrompt = model.roundKind === "team_scores" && model.targetTeam && model.durationMinutes
    ? t("round.question.teamScores", { team: teamName(model.targetTeam), minutes: model.durationMinutes })
    : model.roundKind === "team_shot_on_target" && model.targetTeam && model.durationMinutes
      ? t("round.question.teamShotOnTarget", { team: teamName(model.targetTeam), minutes: model.durationMinutes })
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

  if (mode === "pip") return <PipCompanion model={model} remainingMs={remainingMs} roundPrompt={roundPrompt} onClose={onClose} onReturnToRoom={onReturnToRoom} />;

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
          <div className="min-w-0"><p className="font-['Chakra_Petch'] text-sm font-black uppercase">{t("companion.title")}</p><p className="truncate font-['DM_Mono'] text-[9px] uppercase tracking-[.14em] text-white/45">{teamName(model.homeTeam)} × {teamName(model.awayTeam)}</p></div>
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
        {onOpenFloating ? <button type="button" onClick={onOpenFloating} className="inline-flex min-h-10 items-center gap-2 border border-white/20 px-3 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.1em] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ExternalLink className="size-3.5" />{floatingAvailable ? t("companion.openFloating") : t("companion.openCompact")}</button> : null}
        <span className="ml-auto inline-flex items-center gap-1.5 self-center font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/35"><Radio className="size-3" />{t("companion.authority")}</span>
      </div>
      {mode === "in_app" && pushState && pushState !== "checking" && pushState !== "unavailable" ? <div className="mt-4 border-t border-white/10 pl-2 pt-4" data-testid="companion-alerts">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.14em] text-white/70">{t("companion.alerts.title")}</p><p className="mt-1 text-xs text-white/45">{t("companion.alerts.description")}</p></div>
          {pushState === "enabled" ? <button type="button" onClick={onDisableAlerts} className="inline-flex min-h-9 items-center gap-2 border border-white/15 px-3 font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.1em]"><BellOff className="size-3.5" />{t("companion.alerts.disable")}</button> : pushState === "denied" ? <span className="text-xs text-amber-200">{t("companion.alerts.denied")}</span> : <button type="button" disabled={pushState === "requesting"} onClick={onEnableAlerts} className="inline-flex min-h-9 items-center gap-2 border border-primary/50 px-3 font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.1em] text-primary disabled:opacity-50"><Bell className="size-3.5" />{pushState === "requesting" ? t("companion.alerts.requesting") : t("companion.alerts.enable")}</button>}
        </div>
        {pushState === "enabled" ? <fieldset className="mt-3 grid gap-2 sm:grid-cols-2"><legend className="sr-only">{t("companion.alerts.types")}</legend>{(Object.keys(pushTypeKeys) as UserPushType[]).map((type) => <label key={type} className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-white/65"><input type="checkbox" checked={enabledPushTypes.includes(type)} onChange={() => onToggleAlertType?.(type)} className="accent-[#C8FF00]" />{t(pushTypeKeys[type])}</label>)}</fieldset> : null}
        {pushState === "error" ? <p role="status" className="mt-2 text-xs text-amber-200">{t("companion.alerts.error")}</p> : null}
      </div> : null}
    </motion.section>
  );
}

function sameProps(left: ViraCompanionProps, right: ViraCompanionProps) {
  return sameViraCompanionViewModel(left.model, right.model) && left.enabled === right.enabled && left.mode === right.mode && left.remainingMs === right.remainingMs && left.floatingAvailable === right.floatingAvailable && left.pushState === right.pushState && left.enabledPushTypes?.join("|") === right.enabledPushTypes?.join("|") && left.onFollow === right.onFollow && left.onUnfollow === right.onUnfollow && left.onReturnToRoom === right.onReturnToRoom && left.onOpenFloating === right.onOpenFloating && left.onEnableAlerts === right.onEnableAlerts && left.onDisableAlerts === right.onDisableAlerts && left.onToggleAlertType === right.onToggleAlertType && left.onClose === right.onClose;
}

export const ViraCompanion = memo(ViraCompanionComponent, sameProps);

function PipCompanion({ model, remainingMs, roundPrompt, onClose, onReturnToRoom }: { model: ViraCompanionViewModel; remainingMs: number | null; roundPrompt: string; onClose?: () => void; onReturnToRoom?: () => void }) {
  const { t, teamName } = useLocale();
  const urgent = model.state === "round_open" || model.state === "answer_confirmed";
  return <section className="vira-pip" aria-label={t("companion.title")} aria-live="polite" data-companion-state={model.state}>
    <header className="vira-pip__header"><div className="vira-pip__brand"><img src="/vira-symbol.png" alt="" /><div><p className="vira-pip__title">{t("companion.title")}</p><p className="vira-pip__fixture">{teamName(model.homeTeam)} × {teamName(model.awayTeam)}</p></div></div>{onClose ? <button type="button" className="vira-pip__close" onClick={onClose} aria-label={t("common.close")}>×</button> : null}</header>
    <div className="vira-pip__body"><p className="vira-pip__state">{t(stateKeys[model.state])}</p><div className="vira-pip__score"><strong className="vira-pip__score-value">{model.homeScore} : {model.awayScore}</strong>{urgent && remainingMs !== null ? <div><p className="vira-pip__label">{t("companion.closesIn")}</p><div className="vira-pip__countdown">{clock(remainingMs)}</div></div> : null}</div>
      {(model.state === "round_open" || model.state === "answer_confirmed" || model.state === "locked") ? <p className="vira-pip__prompt">{roundPrompt}</p> : null}
      {model.state === "answer_confirmed" ? <p className="vira-pip__notice">{t("companion.privateUntilLock")}</p> : null}
      {model.state === "offline" || model.state === "reconnecting" ? <p className="vira-pip__notice">{t(model.state === "offline" ? "companion.offlineDescription" : "companion.reconnectingDescription")}</p> : null}
      {model.state === "resolved" ? <div className="vira-pip__metrics"><PipMetric label={t("companion.result")} value={model.correct ? t("companion.correct") : t("companion.incorrect")} /><PipMetric label={t("companion.points")} value={model.pointsAwarded === null ? "—" : `+${model.pointsAwarded}`} /><PipMetric label={t("companion.rank")} value={model.rank === null ? "—" : `#${model.rank}`} /></div> : null}
    </div>
    <footer className="vira-pip__actions">{onReturnToRoom ? <button type="button" className="vira-pip__return" onClick={onReturnToRoom}>{t("companion.returnToRoom")} →</button> : null}<span className="vira-pip__authority">{t("companion.authority")}</span></footer>
  </section>;
}

function PipMetric({ label, value }: { label: string; value: string }) { return <div><p className="vira-pip__label">{label}</p><p className="vira-pip__metric-value">{value}</p></div>; }

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="font-['DM_Mono'] text-[8px] uppercase tracking-[.12em] text-white/35">{label}</p><p className="mt-1 font-['Chakra_Petch'] text-lg font-black uppercase">{value}</p></div>;
}
