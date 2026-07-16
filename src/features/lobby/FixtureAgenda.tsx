import { ArrowRight, CalendarClock, Loader2, Radio, Signal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useLocale } from "../../i18n/locale-context.tsx";
import { competitionDisplayName } from "../../i18n/semantic-copy.ts";
import type { StaticTranslationKey } from "../../i18n/translate.ts";
import type { MatchSummary, MatchTxlineContext } from "../../runtime/api";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { TeamIcon } from "../../shared/team/team-icons";

interface Props { matches: MatchSummary[]; selectedId: string | null; selectedContext: MatchTxlineContext | null; contexts: Record<string, MatchTxlineContext | null>; contextStates: Record<string, "loading" | "ready" | "error">; onSelect: (fixtureId: string) => void; onOpen: (fixtureId: string) => void; }
type Group = "live" | "open" | "upcoming" | "finished";
type FixtureExperience = { fixture: MatchSummary; context: MatchTxlineContext | null; contextState: "loading" | "ready" | "error"; group: Group; statusKey: StaticTranslationKey; detail: "result" | "checking" | "markets" | "waiting_txline" | "no_market"; marketCount: number; active: boolean };
const groups: Group[] = ["live", "open", "upcoming", "finished"];
const statusKeys = { scheduled: "state.match.scheduled", live: "state.match.live", paused: "state.match.paused", postponed: "state.match.postponed", cancelled: "state.match.cancelled", finished: "state.match.finished", unknown: "state.match.unavailable" } as const satisfies Record<string, StaticTranslationKey>;

function enrichFixture(fixture: MatchSummary, context: MatchTxlineContext | null, contextState: "loading" | "ready" | "error"): FixtureExperience {
  const marketCount = context?.marketTaxonomy?.observed ?? context?.availableMarkets.length ?? 0;
  const projection = fixture.consumerProjection;
  const status = projection?.fixture.status ?? "unknown";
  const hasMarket = projection?.availability.canShowMarket === true;
  if (status === "finished") return { fixture, context, contextState, group: "finished", statusKey: statusKeys.finished, detail: "result", marketCount, active: false };
  if (status === "live") return { fixture, context, contextState, group: "live", statusKey: statusKeys.live, detail: contextState === "loading" ? "checking" : hasMarket ? "markets" : "no_market", marketCount, active: hasMarket };
  if (status === "scheduled" && hasMarket) return { fixture, context, contextState, group: "open", statusKey: statusKeys.scheduled, detail: "markets", marketCount, active: true };
  return { fixture, context, contextState, group: "upcoming", statusKey: statusKeys[status], detail: contextState === "loading" ? "checking" : contextState === "error" ? "waiting_txline" : "no_market", marketCount, active: false };
}
function timestamp(fixture: MatchSummary) { const value = fixture.consumerProjection?.fixture.kickoffAt ? new Date(fixture.consumerProjection.fixture.kickoffAt).getTime() : Number.POSITIVE_INFINITY; return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY; }

export function FixtureAgenda({ matches, selectedId, selectedContext, contexts, contextStates, onSelect, onOpen }: Props) {
  const reduceMotion = useReducedMotion();
  const { t } = useLocale();
  const experiences = matches.map((fixture) => enrichFixture(fixture, contexts[fixture.fixtureId] ?? null, contextStates[fixture.fixtureId] ?? "loading")).sort((a, b) => timestamp(a.fixture) - timestamp(b.fixture));
  return <section className="relative mt-12 lg:mt-16"><header className="mb-8 flex items-end justify-between gap-4"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.18em] text-primary">{t("lobby.agenda.eyebrow")}</p><h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase leading-none sm:text-4xl">{t("lobby.agenda.title")}</h2></div><div className="text-right"><strong className="font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-primary">{t("lobby.fixtureCount", { count: matches.length })}</strong><span className="mt-2 hidden max-w-xs text-xs leading-5 text-white/50 md:block">{t("lobby.agenda.description")}</span></div></header><div className="space-y-10">{groups.map((group) => { const items = experiences.filter((item) => item.group === group); if (!items.length) return null; return <section key={group} aria-labelledby={`fixture-group-${group}`}><div className="mb-3 flex items-end justify-between border-b border-white/12 pb-3"><div><p className="font-['DM_Mono'] text-[9px] uppercase tracking-[.16em] text-primary">{t(`lobby.group.${group}.eyebrow` as StaticTranslationKey)}</p><h3 id={`fixture-group-${group}`} className="mt-1 font-['Chakra_Petch'] text-xl font-black uppercase">{t(`lobby.group.${group}.title` as StaticTranslationKey)}</h3></div><span className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{t("lobby.matchCount", { count: items.length })}</span></div><div className="border-t border-white/12">{items.map((experience) => <FixtureRow key={experience.fixture.fixtureId} experience={experience} selected={experience.fixture.fixtureId === selectedId} selectedContext={experience.fixture.fixtureId === selectedId ? selectedContext : experience.context} reduceMotion={Boolean(reduceMotion)} onSelect={onSelect} onOpen={onOpen} />)}</div></section>; })}</div></section>;
}

function FixtureRow({ experience, selected, reduceMotion, onSelect, onOpen }: { experience: FixtureExperience; selected: boolean; selectedContext: MatchTxlineContext | null; reduceMotion: boolean; onSelect: (fixtureId: string) => void; onOpen: (fixtureId: string) => void }) {
  const { locale, t, formatDateTime, teamName } = useLocale();
  const fixture = experience.fixture;
  const projection = fixture.consumerProjection;
  const kickoffAt = projection?.fixture.kickoffAt;
  const day = kickoffAt ? formatDateTime(kickoffAt, { timeZone: projection.temporal.timeZone, day: "2-digit", month: "short" }) : t("lobby.timeToConfirm");
  const hour = kickoffAt ? formatDateTime(kickoffAt, { timeZone: projection.temporal.timeZone, hour: "2-digit", minute: "2-digit" }) : "--:--";
  const market = projection?.availability.canShowMarket ? projection.market.canonical1X2 : null;
  const canOpen = projection?.availability.canEnterRoom === true;
  const detail = experience.detail === "markets" ? t("market.observedCount", { count: experience.marketCount }) : experience.detail === "checking" ? t("lobby.checkingMarket") : experience.detail === "waiting_txline" ? t("lobby.waitingTxline") : experience.detail === "result" ? t("lobby.resultAvailable") : t("lobby.noMarket");
  const scoreAvailable = Number.isFinite(Number(fixture.homeScore)) && Number.isFinite(Number(fixture.awayScore));

  return <motion.div layout className={`group relative block w-full overflow-hidden border-b border-white/12 text-left ${selected ? "text-[#050814]" : "text-white hover:bg-white/[.025]"}`}>
    {selected ? <motion.div layoutId="fixture-selection" className="absolute inset-0 bg-primary" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }} /> : null}
    <button type="button" onClick={() => onSelect(fixture.fixtureId)} aria-pressed={selected} className="relative z-10 grid min-h-24 w-full grid-cols-[6rem_minmax(0,1fr)_7.5rem] items-center gap-3 px-3 py-4 text-left sm:grid-cols-[8rem_minmax(0,1fr)_11rem] sm:px-4 lg:grid-cols-[9rem_minmax(0,1fr)_14rem]">
      <span><span className="block font-['DM_Mono'] text-[9px] uppercase opacity-50">{day}</span><strong className="mt-1 inline-flex items-center gap-2 font-['Chakra_Petch'] text-lg sm:text-xl"><CalendarClock className="size-3.5" />{hour}</strong></span>
      <span className="min-w-0"><span className="mb-2 block truncate font-['DM_Mono'] text-[8px] uppercase opacity-40">{competitionDisplayName(t, fixture)}</span><span className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4"><Team name={fixture.homeTeam} side="home" /><span className="font-['DM_Mono'] text-[9px] font-black opacity-40">VS</span><Team name={fixture.awayTeam} side="away" right /></span></span>
      <span className={`flex h-full min-h-16 items-center justify-between gap-3 px-3 sm:px-4 ${selected ? "bg-[#050814] text-white" : "border-l border-white/10"}`}><span className="min-w-0"><span className={`flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.1em] ${experience.active ? "text-primary" : selected ? "text-white" : "text-white/60"}`}>{experience.group === "live" ? <Radio className="size-3 shrink-0" /> : experience.contextState === "loading" ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Signal className="size-3 shrink-0" />}<span className="truncate">{t(experience.statusKey)}</span></span><span className={`mt-1 hidden truncate text-[10px] sm:block ${selected ? "text-white/45" : "text-white/35"}`}>{detail}</span></span><ArrowRight className={`size-4 shrink-0 transition-transform group-hover:translate-x-1 ${experience.active ? "text-primary" : ""}`} /></span>
    </button>
    <AnimatePresence initial={false}>{selected ? <motion.div initial={reduceMotion ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="relative z-10 overflow-hidden bg-[#050814] text-white">
      {experience.group === "finished" ? <div className="flex min-h-20 items-center justify-center gap-4 border-y border-white/12"><span className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{t("postMatch.finalScore")}</span><strong className="flex items-center gap-2 font-['Chakra_Petch'] text-3xl font-black">{scoreAvailable ? <><AnimatedNumber value={Number(fixture.homeScore)} locales={locale} /><span className="text-primary">-</span><AnimatedNumber value={Number(fixture.awayScore)} locales={locale} /></> : "--"}</strong></div> : <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4"><Metric label={teamName(fixture.homeTeam)} value={market?.selections.home} locale={locale} /><Metric label={t("lobby.draw")} value={market?.selections.draw} locale={locale} /><Metric label={teamName(fixture.awayTeam)} value={market?.selections.away} locale={locale} /><Metric label={t("lobby.observed")} value={experience.marketCount} count locale={locale} /></div>}
      {canOpen ? <button type="button" onClick={() => onOpen(fixture.fixtureId)} className="flex min-h-14 w-full items-center justify-between border-t border-white/12 px-4 font-['Chakra_Petch'] text-xs font-black uppercase text-primary hover:bg-primary hover:text-[#050814] sm:px-6"><span>{experience.group === "finished" ? t("lobby.viewResult") : t("lobby.openBriefing")}</span><ArrowRight className="size-4" /></button> : <p className="border-t border-white/12 px-4 py-4 text-xs text-white/40 sm:px-6">{t("lobby.briefingUnavailable")}</p>}
    </motion.div> : null}</AnimatePresence>
  </motion.div>;
}

function Team({ name, side, right = false }: { name: string; side: "home" | "away"; right?: boolean }) { const { teamName } = useLocale(); return <span className={`flex min-w-0 items-center gap-2 ${right ? "justify-end text-right" : ""}`}>{!right ? <TeamIcon name={name} side={side} size="sm" /> : null}<strong className="truncate font-['Chakra_Petch'] text-base font-black uppercase sm:text-xl">{teamName(name)}</strong>{right ? <TeamIcon name={name} side={side} size="sm" /> : null}</span>; }
function Metric({ label, value, count = false, locale }: { label: string; value?: number | null; count?: boolean; locale: string }) { const valid = typeof value === "number" && Number.isFinite(value); return <div className="flex min-h-16 items-center justify-between gap-3 bg-[#080d19] px-4"><span className="truncate font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</span><strong className="text-sm text-primary">{valid ? <><AnimatedNumber value={value} locales={locale} format={count ? undefined : { minimumFractionDigits: 1, maximumFractionDigits: 1 }} />{count ? "" : "%"}</> : "--"}</strong></div>; }
