import { ArrowRight, CalendarClock, Loader2, Radio, Signal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { MatchSummary, MatchTxlineContext } from "../../runtime/api";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { TeamIcon } from "../../shared/team/team-icons";
import { deriveCanonicalExperienceState, experienceCopy } from "../match-experience/state-model";

interface Props {
  matches: MatchSummary[];
  selectedId: string | null;
  selectedContext: MatchTxlineContext | null;
  contexts: Record<string, MatchTxlineContext | null>;
  contextStates: Record<string, "loading" | "ready" | "error">;
  onSelect: (fixtureId: string) => void;
  onOpen: (fixtureId: string) => void;
}

type FixtureExperience = {
  fixture: MatchSummary;
  context: MatchTxlineContext | null;
  contextState: "loading" | "ready" | "error";
  group: "live" | "open" | "upcoming" | "finished";
  label: string;
  detail: string;
  marketCount: number;
  active: boolean;
};

const GROUPS: Array<{ id: FixtureExperience["group"]; eyebrow: string; title: string }> = [
  { id: "live", eyebrow: "Agora", title: "Partidas ao vivo" },
  { id: "open", eyebrow: "Entre antes do início", title: "Salas abertas" },
  { id: "upcoming", eyebrow: "Calendário", title: "Próximas partidas" },
  { id: "finished", eyebrow: "Arquivo", title: "Partidas encerradas" },
];

function enrichFixture(
  fixture: MatchSummary,
  context: MatchTxlineContext | null,
  contextState: "loading" | "ready" | "error",
): FixtureExperience {
  const marketCount = context?.marketTaxonomy?.observed ?? context?.availableMarkets.length ?? 0;
  const hasMarket = marketCount > 0 || Boolean(context?.suggestedPrediction);
  const canonical = deriveCanonicalExperienceState({ matchStatus: fixture.status, roomExists: hasMarket, hasSignal: hasMarket, connectionState: contextState === "error" ? "reconnecting" : "live" });
  if (canonical.match === "finished") return { fixture, context, contextState, group: "finished", label: experienceCopy.match.finished, detail: marketCount ? `${marketCount} mercados observados` : "Resultado disponível", marketCount, active: false };
  if (canonical.match === "live") return { fixture, context, contextState, group: "live", label: experienceCopy.match.live, detail: contextState === "loading" ? "Verificando mercado" : hasMarket ? `${marketCount} mercados observados` : experienceCopy.signal.unavailable, marketCount, active: hasMarket };
  if (hasMarket) return { fixture, context, contextState, group: "open", label: experienceCopy.room.open, detail: `${marketCount} mercados observados`, marketCount, active: true };
  return { fixture, context, contextState, group: "upcoming", label: experienceCopy.match.scheduled, detail: contextState === "loading" ? "Verificando mercado" : contextState === "error" ? "Aguardando TxLINE" : "Sem mercado disponível", marketCount, active: false };
}

function timestamp(fixture: MatchSummary) {
  const value = fixture.startTime ? new Date(fixture.startTime).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function time(value: string | null) {
  if (!value) return { day: "A confirmar", hour: "--:--" };
  const date = new Date(value);
  return { day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date), hour: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date) };
}

export function FixtureAgenda({ matches, selectedId, selectedContext, contexts, contextStates, onSelect, onOpen }: Props) {
  const reduceMotion = useReducedMotion();
  const experiences = matches
    .map((fixture) => enrichFixture(fixture, contexts[fixture.fixtureId] ?? null, contextStates[fixture.fixtureId] ?? "loading"))
    .sort((a, b) => timestamp(a.fixture) - timestamp(b.fixture));

  return <section className="relative mt-12 lg:mt-16">
    <header className="mb-8 flex items-end justify-between gap-4"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.18em] text-primary">Calendário oficial</p><h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase leading-none sm:text-4xl">Partidas em foco</h2></div><div className="text-right"><strong className="font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-primary">{matches.length} fixtures</strong><span className="mt-2 hidden max-w-xs text-xs leading-5 text-white/50 md:block">Disponibilidade, mercados e horário sem precisar abrir cada partida.</span></div></header>
    <div className="space-y-10">
      {GROUPS.map((group) => {
        const items = experiences.filter((experience) => experience.group === group.id);
        if (!items.length) return null;
        return <section key={group.id} aria-labelledby={`fixture-group-${group.id}`}>
          <div className="mb-3 flex items-end justify-between border-b border-white/12 pb-3"><div><p className="font-['DM_Mono'] text-[9px] uppercase tracking-[.16em] text-primary">{group.eyebrow}</p><h3 id={`fixture-group-${group.id}`} className="mt-1 font-['Chakra_Petch'] text-xl font-black uppercase">{group.title}</h3></div><span className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{items.length} {items.length === 1 ? "partida" : "partidas"}</span></div>
          <div className="border-t border-white/12">{items.map((experience) => <FixtureRow key={experience.fixture.fixtureId} experience={experience} selected={experience.fixture.fixtureId === selectedId} selectedContext={experience.fixture.fixtureId === selectedId ? selectedContext : experience.context} reduceMotion={Boolean(reduceMotion)} onSelect={onSelect} onOpen={onOpen} />)}</div>
        </section>;
      })}
    </div>
  </section>;
}

function FixtureRow({ experience, selected, selectedContext, reduceMotion, onSelect, onOpen }: { experience: FixtureExperience; selected: boolean; selectedContext: MatchTxlineContext | null; reduceMotion: boolean; onSelect: (fixtureId: string) => void; onOpen: (fixtureId: string) => void }) {
  const fixture = experience.fixture;
  const fixtureTime = time(fixture.startTime);
  const market = selectedContext?.canonical1X2;
  const canOpen = experience.active || experience.group === "finished";
  return <motion.div layout className={`group relative block w-full overflow-hidden border-b border-white/12 text-left ${selected ? "text-[#050814]" : "text-white hover:bg-white/[.025]"}`}>
    {selected ? <motion.div layoutId="fixture-selection" className="absolute inset-0 bg-primary" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }} /> : null}
    <button type="button" onClick={() => onSelect(fixture.fixtureId)} aria-pressed={selected} className="relative z-10 grid min-h-24 w-full grid-cols-[6rem_minmax(0,1fr)_7.5rem] items-center gap-3 px-3 py-4 text-left sm:grid-cols-[8rem_minmax(0,1fr)_11rem] sm:px-4 lg:grid-cols-[9rem_minmax(0,1fr)_14rem]">
      <span><span className="block font-['DM_Mono'] text-[9px] uppercase opacity-50">{fixtureTime.day}</span><strong className="mt-1 inline-flex items-center gap-2 font-['Chakra_Petch'] text-lg sm:text-xl"><CalendarClock className="size-3.5" />{fixtureTime.hour}</strong></span>
      <span className="min-w-0"><span className="mb-2 block truncate font-['DM_Mono'] text-[8px] uppercase opacity-40">{fixture.competitionLabel}</span><span className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4"><Team name={fixture.homeTeam} side="home" /><span className="font-['DM_Mono'] text-[9px] font-black opacity-40">VS</span><Team name={fixture.awayTeam} side="away" right /></span></span>
      <span className={`flex h-full min-h-16 items-center justify-between gap-3 px-3 sm:px-4 ${selected ? "bg-[#050814] text-white" : "border-l border-white/10"}`}><span className="min-w-0"> <span className={`flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.1em] ${experience.active ? "text-primary" : selected ? "text-white" : "text-white/60"}`}>{experience.group === "live" ? <Radio className="size-3 shrink-0" /> : experience.contextState === "loading" ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Signal className="size-3 shrink-0" />}<span className="truncate">{experience.label}</span></span><span className={`mt-1 hidden truncate text-[10px] sm:block ${selected ? "text-white/45" : "text-white/35"}`}>{experience.detail}</span></span><ArrowRight className={`size-4 shrink-0 transition-transform group-hover:translate-x-1 ${experience.active ? "text-primary" : ""}`} /></span>
    </button>
    <AnimatePresence initial={false}>{selected ? <motion.div initial={reduceMotion ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="relative z-10 overflow-hidden bg-[#050814] text-white"><div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4"><Metric label={fixture.homeTeam} value={market?.selections.home} /><Metric label="Empate" value={market?.selections.draw} /><Metric label={fixture.awayTeam} value={market?.selections.away} /><Metric label="Observados" value={experience.marketCount} count /></div>{canOpen ? <button type="button" onClick={() => onOpen(fixture.fixtureId)} className="flex min-h-14 w-full items-center justify-between border-t border-white/12 px-4 font-['Chakra_Petch'] text-xs font-black uppercase text-primary hover:bg-primary hover:text-[#050814] sm:px-6"><span>{experience.group === "finished" ? "Ver resultado da partida" : "Abrir briefing"}</span><ArrowRight className="size-4" /></button> : <p className="border-t border-white/12 px-4 py-4 text-xs text-white/40 sm:px-6">O briefing abre quando a TxLINE disponibilizar um mercado jogável.</p>}</motion.div> : null}</AnimatePresence>
  </motion.div>;
}

function Team({ name, side, right = false }: { name: string; side: "home" | "away"; right?: boolean }) {
  return <span className={`flex min-w-0 items-center gap-2 ${right ? "justify-end text-right" : ""}`}>{!right ? <TeamIcon name={name} side={side} size="sm" /> : null}<strong className="truncate font-['Chakra_Petch'] text-base font-black uppercase sm:text-xl">{name}</strong>{right ? <TeamIcon name={name} side={side} size="sm" /> : null}</span>;
}

function Metric({ label, value, count = false }: { label: string; value?: number | null; count?: boolean }) {
  const valid = typeof value === "number" && Number.isFinite(value);
  return <div className="flex min-h-16 items-center justify-between gap-3 bg-[#080d19] px-4"><span className="truncate font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</span><strong className="text-sm text-primary">{valid ? <><AnimatedNumber value={value} format={count ? undefined : { minimumFractionDigits: 1, maximumFractionDigits: 1 }} />{count ? "" : "%"}</> : "--"}</strong></div>;
}
