import { ArrowUpRight, Loader2, Radio, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";

import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { TeamIcon } from "../../shared/team/team-icons";
import type { FeaturedMatchModel, FeaturedSignal } from "./featured-match-model";
import { deriveCanonicalExperienceState, experienceCopy, formatMarketCount } from "../match-experience/state-model";

type Props = { model: FeaturedMatchModel; onOpen: () => void };

function kickoff(value: string | null) {
  if (!value) return "Horário a confirmar";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function teamNameScale(name: string) {
  if (name.length >= 18) return "text-[clamp(2rem,2.8vw,3.7rem)] whitespace-normal";
  if (name.length >= 12) return "text-[clamp(2.2rem,3.2vw,4.2rem)] whitespace-nowrap";
  if (name.length >= 9) return "text-[clamp(2.45rem,3.6vw,4.7rem)] whitespace-nowrap";
  return "text-[clamp(2.7rem,4vw,5.2rem)] whitespace-nowrap";
}

function signalAge(value: string | null) {
  if (!value) return null;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes}min`;
  return `há ${Math.floor(minutes / 60)}h`;
}

export function FeaturedMatchStage({ model, onOpen }: Props) {
  const reduceMotion = useReducedMotion();
  const { fixture } = model;
  const canonical = deriveCanonicalExperienceState({ matchStatus: fixture.status, roomExists: true, hasSignal: model.signal.kind === "available", connectionState: "live" });
  return (
    <AnimatePresence mode="wait">
      <motion.section
        key={fixture.fixtureId}
        style={{ viewTransitionName: "featured-match" } as CSSProperties}
        initial={reduceMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
        transition={{ duration: reduceMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-[calc(100vw-2rem)] min-w-0 max-w-full overflow-hidden border-y border-white/12 bg-[#080d19] sm:w-full"
      >
        <StageBackdrop home={fixture.homeTeam} away={fixture.awayTeam} />
        <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/12 px-4 py-4 sm:px-7 lg:px-10">
          <div className="flex items-center gap-3 font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-white/50">
            <span>{fixture.competitionLabel}</span><span className="text-white/20">/</span><span>{kickoff(fixture.startTime)}</span>
          </div>
          <div className="flex items-center gap-4 font-['DM_Mono'] text-[9px] uppercase tracking-[.14em]">
            <span className="inline-flex items-center gap-2 text-primary"><Radio className="size-3" />{experienceCopy.match[canonical.match]}</span>
            <span className="text-white/55">{experienceCopy.room[canonical.room]}</span>
            <span className="text-white/55">{formatMarketCount(model.signalCount)}</span>
          </div>
        </header>

        <div className="relative z-10 hidden min-h-[34rem] grid-cols-[minmax(0,1fr)_minmax(280px,.72fr)_minmax(0,1fr)] lg:grid">
          <TeamField name={fixture.homeTeam} side="home" />
          <MarketScoreboard signal={model.signal} />
          <TeamField name={fixture.awayTeam} side="away" />
        </div>

        <div className="relative z-10 lg:hidden">
          <MobileMatchIdentity home={fixture.homeTeam} away={fixture.awayTeam} />
          <MarketScoreboard signal={model.signal} mobile />
        </div>

        <footer className="relative z-10 grid border-t border-white/12 bg-[#050814]/94 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 px-4 py-5 sm:px-7 lg:px-10">
            <span className="inline-flex items-center gap-2 font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-primary"><ShieldCheck className="size-4" />{experienceCopy.room[canonical.room]}</span>
            <span className="font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-white/55">{formatMarketCount(model.signalCount)}</span>
            {model.signal.kind === "available" && signalAge(model.signal.value.updatedAt) ? <span className="font-['DM_Mono'] text-[10px] uppercase tracking-[.12em] text-white/45">Mercado atualizado {signalAge(model.signal.value.updatedAt)}</span> : null}
          </div>
          <button type="button" onClick={onOpen} className="group flex min-h-20 items-center justify-between gap-12 bg-primary px-6 font-['Chakra_Petch'] text-sm font-black uppercase text-primary-foreground sm:px-8">
            Entrar na partida <ArrowUpRight className="size-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
          </button>
        </footer>
      </motion.section>
    </AnimatePresence>
  );
}

function StageBackdrop({ home, away }: { home: string; away: string }) {
  return <div aria-hidden className="absolute inset-0 overflow-hidden"><div className="absolute inset-y-0 left-0 w-[58%] bg-[linear-gradient(135deg,rgba(202,255,40,.18),transparent_70%)] [clip-path:polygon(0_0,100%_0,70%_100%,0_100%)]" /><div className="absolute inset-y-0 right-0 w-[58%] bg-[linear-gradient(225deg,rgba(122,167,255,.18),transparent_70%)] [clip-path:polygon(30%_0,100%_0,100%_100%,0_100%)]" /><span className="absolute -left-7 bottom-0 font-['Chakra_Petch'] text-[18rem] font-black leading-none text-white/[.025]">{home[0]}</span><span className="absolute -right-4 top-8 font-['Chakra_Petch'] text-[18rem] font-black leading-none text-white/[.025]">{away[0]}</span></div>;
}

function TeamField({ name, side }: { name: string; side: "home" | "away" }) {
  const away = side === "away";
  return <motion.div initial={{ opacity: 0, x: away ? 36 : -36, y: away ? -10 : 12 }} animate={{ opacity: 1, x: 0, y: away ? -10 : 12 }} transition={{ duration: .42, ease: [.22, 1, .36, 1] }} className={`relative flex min-w-0 flex-col justify-end overflow-hidden px-8 pb-12 pt-24 ${away ? "items-end text-right" : "items-start"}`}><TeamIcon name={name} side={side} size="lg" /><p className="mt-5 font-['DM_Mono'] text-[10px] uppercase tracking-[.18em] text-white/50">{away ? "Visitante" : "Casa"}</p><h2 style={{ viewTransitionName: away ? "away-team" : "home-team" } as CSSProperties} className={`mt-2 max-w-full font-['Chakra_Petch'] font-black uppercase leading-[.82] ${teamNameScale(name)}`}>{name}</h2></motion.div>;
}

function MobileMatchIdentity({ home, away }: { home: string; away: string }) {
  return <div className="relative min-h-56 overflow-hidden px-4 pb-8 pt-12 sm:px-7"><div className="absolute bottom-8 left-4 w-[40%] min-w-0 sm:left-7"><TeamCompact name={home} side="home" /></div><span className="absolute bottom-10 left-1/2 -translate-x-1/2 font-['DM_Mono'] text-[10px] font-black text-primary">VS</span><div className="absolute bottom-8 right-4 w-[40%] min-w-0 sm:right-7"><TeamCompact name={away} side="away" /></div></div>;
}

function TeamCompact({ name, side }: { name: string; side: "home" | "away" }) {
  const scale = name.length >= 11 ? "text-[clamp(1rem,4.6vw,1.35rem)]" : name.length >= 9 ? "text-[clamp(1.15rem,5.2vw,1.55rem)]" : "text-[clamp(1.3rem,6vw,1.8rem)]";
  return <div className={side === "away" ? "min-w-0 text-right" : "min-w-0"}><div className={side === "away" ? "flex justify-end" : ""}><TeamIcon name={name} side={side} size="md" /></div><h2 style={{ viewTransitionName: side === "home" ? "home-team" : "away-team" } as CSSProperties} className={`mt-3 whitespace-nowrap font-['Chakra_Petch'] font-black uppercase leading-[.86] ${scale}`}>{name}</h2></div>;
}

function MarketScoreboard({ signal, mobile = false }: { signal: FeaturedMatchModel["signal"]; mobile?: boolean }) {
  return <div className={`${mobile ? "border-t" : "border-x"} flex min-w-0 flex-col items-center justify-center border-white/12 bg-[#050814]/62 px-5 py-10 text-center backdrop-blur-sm`}><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.2em] text-primary">Placar de mercado</p>{signal.kind === "loading" ? <div className="grid min-h-56 place-items-center"><span className="inline-flex items-center gap-3 text-sm text-white/45"><Loader2 className="size-5 animate-spin text-primary" />Buscando sinal real</span></div> : signal.kind === "unavailable" ? <div className="flex min-h-56 flex-col items-center justify-center"><strong className="font-['Chakra_Petch'] text-4xl font-black uppercase leading-none">Aguardando<br /><span className="text-primary">sinal jogável</span></strong><p className="mt-5 max-w-xs text-sm text-white/45">Nenhum valor substituto será criado.</p></div> : <SignalContent signal={signal.value} mobile={mobile} />}</div>;
}

function SignalContent({ signal, mobile }: { signal: FeaturedSignal; mobile: boolean }) {
  const age = signalAge(signal.updatedAt);
  return <><p className="mt-7 font-['Chakra_Petch'] text-sm font-black uppercase text-white/65">{signal.label}</p><div style={{ viewTransitionName: "market-value" } as CSSProperties} className={`${mobile ? "text-[clamp(5rem,25vw,8rem)]" : "text-[clamp(5rem,8vw,9rem)]"} mt-1 flex items-start font-['Chakra_Petch'] font-black leading-none text-primary`}><AnimatedNumber value={signal.value} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /><span className="mt-2 text-[.22em]">%</span></div><SignalMovement signal={signal} age={age} />{signal.prompt ? <p className="mt-4 max-w-xs text-sm font-bold leading-5 text-white/75">{signal.prompt}</p> : <p className="mt-4 max-w-xs text-sm text-white/50">Último sinal confirmado pela TxLINE.</p>}<Distribution options={signal.distribution} /></>;
}

function SignalMovement({ signal, age }: { signal: FeaturedSignal; age: string | null }) {
  if (signal.previousValue === undefined && !age) return null;
  return <div className="mt-3 flex flex-wrap items-center justify-center gap-3 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.1em]">{signal.previousValue !== undefined ? <span className="text-white/40"><AnimatedNumber value={signal.previousValue} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /><span className="mx-2 text-primary">→</span><AnimatedNumber value={signal.value} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />%</span> : null}{signal.delta !== undefined ? <><span className="h-3 w-px bg-white/15" /><span className={signal.delta >= 0 ? "text-primary" : "text-[#7aa7ff]"}>{signal.delta >= 0 ? "+" : ""}<AnimatedNumber value={signal.delta} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> pp</span></> : null}{age ? <><span className="h-3 w-px bg-white/15" /><span className="text-white/40">Atualizado {age}</span></> : null}</div>;
}

function Distribution({ options }: { options: FeaturedSignal["distribution"] }) {
  if (options.length < 2) return null;
  return <div className="mt-8 w-full border-t border-white/12 pt-4"><div className="flex h-1.5 w-full overflow-hidden bg-white/10">{options.map((option, index) => <motion.span key={option.id} initial={{ width: 0 }} animate={{ width: `${option.value}%` }} className={index === 1 ? "bg-primary" : index === 0 ? "bg-white/45" : "bg-[#7aa7ff]"} />)}</div><div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))` }}>{options.map((option) => <div key={option.id} className="min-w-0"><span className="block truncate font-['DM_Mono'] text-[10px] uppercase text-white/50">{option.label}</span><strong className="mt-1 block text-xs"><AnimatedNumber value={option.value} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />%</strong></div>)}</div></div>;
}
