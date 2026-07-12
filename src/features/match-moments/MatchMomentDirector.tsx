import { Activity, Check, ChevronRight, Crosshair, Flag, Goal, ShieldAlert, TimerReset, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { MatchMoment, MotionPreference, PressureMoment } from "./match-moment-types";

interface Props {
  moment: MatchMoment | null;
  ambient: PressureMoment | null;
  motionPreference: MotionPreference;
  sound: boolean;
  onDismiss: () => void;
  onMotionChange: (motion: MotionPreference) => void;
  onSoundChange: (sound: boolean) => void;
  visible?: boolean;
}

function clock(seconds: number) {
  const minute = Math.floor(seconds / 60);
  const second = Math.floor(seconds % 60);
  return `${minute}:${String(second).padStart(2, "0")}`;
}

export function MatchMomentDirector({ moment, ambient, motionPreference, sound, onDismiss, onMotionChange, onSoundChange, visible = true }: Props) {
  const systemReduced = useReducedMotion();
  const reduced = Boolean(systemReduced) || motionPreference !== "full";
  if (!visible) return null;
  return <>
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[35] transition-opacity duration-700" style={{ opacity: ambient ? (ambient.level === "high" ? .58 : .34) : 0, background: ambient?.teamSide === "away" ? "linear-gradient(270deg, rgba(115,185,232,.24), transparent 58%)" : "linear-gradient(90deg, rgba(199,255,24,.2), transparent 58%)" }} />
    <div className="fixed right-16 top-4 z-[72] flex border border-white/10 bg-[#050814]/90 backdrop-blur">
      <button type="button" onClick={() => onSoundChange(!sound)} className="grid size-9 place-items-center text-white/55 hover:text-primary" title={sound ? "Silenciar momentos" : "Ativar som dos momentos"}>{sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</button>
      <button type="button" onClick={() => onMotionChange(motionPreference === "full" ? "reduced" : motionPreference === "reduced" ? "off" : "full")} className="relative grid size-9 place-items-center border-l border-white/10 text-white/55 hover:text-primary" title={`Movimento: ${motionPreference}`}><Activity className="size-4" /><span className={`absolute bottom-1 right-1 size-1.5 ${motionPreference === "off" ? "bg-white/25" : motionPreference === "reduced" ? "bg-amber-300" : "bg-primary"}`} /></button>
    </div>
    <AnimatePresence mode="wait">
      {moment ? <motion.div key={moment.id} initial={{ opacity: 0, y: reduced ? 0 : moment.presentation === "takeover" ? 0 : 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -18 }} transition={{ duration: reduced ? 0 : .38, ease: [.16, 1, .3, 1] }} className={moment.presentation === "takeover" ? "fixed inset-0 z-[70]" : "pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] mx-auto max-w-3xl"}>
        {moment.presentation === "takeover" ? <Takeover moment={moment} onDismiss={onDismiss} reduced={reduced} /> : <Banner moment={moment} reduced={reduced} />}
      </motion.div> : null}
    </AnimatePresence>
  </>;
}

function Takeover({ moment, onDismiss, reduced }: { moment: MatchMoment; onDismiss: () => void; reduced: boolean }) {
  const goal = moment.kind === "goal" ? moment : null;
  const fullTime = moment.kind === "full_time";
  const overturned = moment.kind === "var_overturned";
  const title = goal ? "GOL" : fullTime ? "FIM DE JOGO" : overturned ? "DECISAO ANULADA" : moment.kind === "red_card" ? "CARTAO VERMELHO" : "DECISAO CONFIRMADA";
  return <section role="status" aria-live="assertive" className={`relative grid min-h-dvh place-items-center overflow-hidden bg-[#050814] px-5 text-center ${overturned ? "grayscale" : ""}`}>
    <motion.div aria-hidden className="absolute size-[min(100vw,850px)] rounded-full border border-primary/45" initial={{ scale: reduced ? 1 : .08, opacity: 1 }} animate={{ scale: reduced ? 1 : 1.5, opacity: 0 }} transition={{ duration: reduced ? 0 : 1.4, ease: [.16, 1, .3, 1] }} />
    <div className="relative z-10 max-w-6xl">
      <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.2em] text-primary">Momento confirmado · {clock(moment.matchClockSec)}</p>
      <motion.h2 initial={{ scale: reduced ? 1 : .55 }} animate={{ scale: 1 }} transition={{ duration: reduced ? 0 : .62, ease: [.16, 1, .3, 1] }} className="mt-8 font-['Chakra_Petch'] text-[clamp(4rem,18vw,15rem)] font-black uppercase leading-[.72] tracking-[-.06em]">{title}</motion.h2>
      {moment.teamName ? <p className="mt-10 font-['Chakra_Petch'] text-[clamp(2rem,6vw,5rem)] font-black uppercase leading-none">{moment.teamName}</p> : null}
      {goal ? <p className="mt-5 font-['DM_Mono'] text-[clamp(3rem,10vw,8rem)] font-black text-primary">{goal.scoreAfter.home}-{goal.scoreAfter.away}</p> : null}
      {moment.playerName ? <p className="mt-4 text-lg uppercase text-white/60">{moment.playerName}</p> : null}
      <button type="button" onClick={onDismiss} className="mt-10 inline-flex min-h-12 items-center gap-2 border border-white/25 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary">Voltar a partida <ChevronRight className="size-4" /></button>
    </div>
  </section>;
}

function Banner({ moment, reduced }: { moment: MatchMoment; reduced: boolean }) {
  const config = moment.kind === "shot_on_target" ? { label: "NO ALVO", Icon: Crosshair }
    : moment.kind === "corner" ? { label: "ESCANTEIO", Icon: Flag }
      : moment.kind === "yellow_card" ? { label: "CARTAO AMARELO", Icon: ShieldAlert }
        : moment.kind === "penalty" ? { label: "PENALTI", Icon: Goal }
          : moment.kind === "var_started" ? { label: "VAR · EM REVISAO", Icon: TimerReset }
            : { label: moment.kind.replaceAll("_", " "), Icon: Check };
  return <aside role="status" aria-live="polite" className="relative grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-5 overflow-hidden border border-white/15 bg-[#080d19]/95 px-5 py-4 shadow-2xl backdrop-blur-md">
    <motion.div animate={reduced ? undefined : { scale: [1, 1.25, 1] }} className="grid size-14 place-items-center border border-primary/50 text-primary"><config.Icon className="size-7" /></motion.div>
    <div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.18em] text-primary">{config.label}</p><strong className="mt-2 block font-['Chakra_Petch'] text-2xl font-black uppercase leading-none">{moment.teamName ?? "Partida"}</strong>{moment.playerName ? <span className="mt-2 block text-xs text-white/45">{moment.playerName}</span> : null}</div>
    <time className="font-['DM_Mono'] text-sm font-black text-white/50">{clock(moment.matchClockSec)}</time>
    {!reduced ? <motion.span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-primary" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: moment.durationMs / 1000, ease: "linear" }} /> : null}
  </aside>;
}
