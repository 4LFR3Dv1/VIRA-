import { ArrowUpRight, Loader2, Radio, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";

import { useLocale } from "../../i18n/locale-context.tsx";
import { competitionDisplayName, fixtureMarketStatement, fixtureSchedule } from "../../i18n/semantic-copy.ts";
import type { StaticTranslationKey } from "../../i18n/translate.ts";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { TeamIcon } from "../../shared/team/team-icons";
import { deriveCanonicalExperienceState } from "../match-experience/state-model";
import type { FeaturedMatchModel, FeaturedSignal } from "./featured-match-model";

type Props = { model: FeaturedMatchModel; onOpen: () => void };
const matchStateKeys = { scheduled: "state.match.scheduled", live: "state.match.live", finished: "state.match.finished", unavailable: "state.match.unavailable" } as const satisfies Record<string, StaticTranslationKey>;
const roomStateKeys = { closed: "state.room.closed", open: "state.room.open", finished: "state.room.finished" } as const satisfies Record<string, StaticTranslationKey>;

function teamNameScale(name: string) {
  if (name.length >= 18) return "text-[clamp(2rem,2.8vw,3.7rem)] whitespace-normal";
  if (name.length >= 12) return "text-[clamp(2.2rem,3.2vw,4.2rem)] whitespace-nowrap";
  if (name.length >= 9) return "text-[clamp(2.45rem,3.6vw,4.7rem)] whitespace-nowrap";
  return "text-[clamp(2.7rem,4vw,5.2rem)] whitespace-nowrap";
}

export function FeaturedMatchStage({ model, onOpen }: Props) {
  const reduceMotion = useReducedMotion();
  const { fixture } = model;
  const { locale, t, formatDateTime } = useLocale();
  const projection = fixture.consumerProjection;
  const canonical = deriveCanonicalExperienceState({ matchStatus: projection?.fixture.status ?? fixture.status, roomExists: projection?.availability.canEnterRoom ?? false, hasSignal: model.signal.kind === "available", connectionState: "live" });
  const finished = canonical.match === "finished";
  const formattedKickoff = projection?.fixture.kickoffAt ? formatDateTime(projection.fixture.kickoffAt, { timeZone: projection.temporal.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const kickoff = projection ? fixtureSchedule(t, projection, formattedKickoff) : t("lobby.timeToConfirm");
  const countdown = projection?.fixture.status === "scheduled" ? kickoffCountdown(projection.fixture.kickoffAt, t) : null;
  return <AnimatePresence mode="wait"><motion.section key={fixture.fixtureId} style={{ viewTransitionName: "featured-match" } as CSSProperties} initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -10 }} transition={{ duration: reduceMotion ? 0 : .34, ease: [.22, 1, .36, 1] }} className="relative w-[calc(100vw-2rem)] min-w-0 max-w-full overflow-hidden border-y border-white/12 bg-[#080d19] sm:w-full">
    <StageBackdrop home={fixture.homeTeam} away={fixture.awayTeam} />
    <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/12 px-4 py-4 sm:px-7 lg:px-10"><div className="flex items-center gap-3 font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-white/50"><span>{competitionDisplayName(t, fixture)}</span><span className="text-white/20">/</span><span>{kickoff}</span></div><div className="font-['DM_Mono'] text-[9px] uppercase tracking-[.14em]"><span className="inline-flex items-center gap-2 text-primary"><Radio className="size-3" />{t(matchStateKeys[canonical.match])}</span></div></header>
    <div className="relative z-10 hidden min-h-[28rem] grid-cols-[minmax(0,1fr)_minmax(280px,.72fr)_minmax(0,1fr)] lg:grid"><TeamField name={fixture.homeTeam} side="home" />{finished ? <FinalScoreboard /> : <MarketScoreboard model={model} />}<TeamField name={fixture.awayTeam} side="away" /></div>
    <div className="relative z-10 lg:hidden"><MobileMatchIdentity home={fixture.homeTeam} away={fixture.awayTeam} />{finished ? <FinalScoreboard mobile /> : <MarketScoreboard model={model} mobile />}</div>
    <footer className="relative z-10 grid border-t border-white/12 bg-[#050814]/94 lg:grid-cols-[1fr_auto]"><div className="flex flex-wrap items-center gap-x-7 gap-y-2 px-4 py-4 sm:px-7 lg:px-10"><span className="inline-flex items-center gap-2 font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-primary"><ShieldCheck className="size-4" />{t(roomStateKeys[canonical.room])}</span><span className="font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-white/55">{finished ? t("lobby.resultAvailable") : t("market.observedCount", { count: model.signalCount })}</span>{!finished && model.signal.kind === "available" && model.signal.value.ageSeconds !== null ? <span className="font-['DM_Mono'] text-[10px] uppercase tracking-[.12em] text-white/45">{t("lobby.marketUpdated", { age: signalAge(model.signal.value.ageSeconds, t) })}</span> : null}</div><button type="button" onClick={onOpen} className="group flex min-h-16 items-center justify-between gap-12 bg-primary px-6 font-['Chakra_Petch'] text-sm font-black uppercase text-primary-foreground sm:px-8">{finished ? t("lobby.viewResult") : t("lobby.enterMatch")} <ArrowUpRight className="size-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" /></button></footer>
  </motion.section></AnimatePresence>;

  function FinalScoreboard({ mobile = false }: { mobile?: boolean }) {
    const scoreAvailable = Number.isFinite(Number(fixture.homeScore)) && Number.isFinite(Number(fixture.awayScore));
    return <div className={`${mobile ? "border-t" : "border-x"} flex min-w-0 flex-col items-center justify-center border-white/12 bg-[#050814]/62 px-5 py-10 text-center backdrop-blur-sm`}><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.2em] text-primary">{t("postMatch.finalScore")}</p><strong className={`${mobile ? "text-[clamp(4.5rem,21vw,6.5rem)]" : "text-[clamp(4.75rem,6.3vw,7rem)]"} mt-5 flex items-center gap-3 font-['Chakra_Petch'] font-black leading-none text-white`}>{scoreAvailable ? <><AnimatedNumber value={Number(fixture.homeScore)} locales={locale} /><span className="text-primary">-</span><AnimatedNumber value={Number(fixture.awayScore)} locales={locale} /></> : "--"}</strong><p className="mt-6 text-sm text-white/45">{t("postMatch.integrityDescription")}</p></div>;
  }

  function MarketScoreboard({ model: current, mobile = false }: { model: FeaturedMatchModel; mobile?: boolean }) {
    const signal = current.signal;
    return <div className={`${mobile ? "border-t" : "border-x"} flex min-w-0 flex-col items-center justify-center border-white/12 bg-[#050814]/62 px-5 py-10 text-center backdrop-blur-sm`}><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.2em] text-primary">{t("lobby.marketScore")}</p>{signal.kind === "loading" ? <div className="grid min-h-56 place-items-center"><span className="inline-flex items-center gap-3 text-sm text-white/45"><Loader2 className="size-5 animate-spin text-primary" />{t("lobby.fetchingSignal")}</span></div> : signal.kind === "unavailable" ? <div className="flex min-h-56 flex-col items-center justify-center"><strong className="font-['Chakra_Petch'] text-4xl font-black uppercase leading-none">{t("lobby.waitingSignal")}</strong><p className="mt-5 max-w-xs text-sm text-white/45">{t("lobby.noSubstitute")}</p></div> : <SignalContent signal={signal.value} mobile={mobile} />}</div>;
  }

  function SignalContent({ signal, mobile }: { signal: FeaturedSignal; mobile: boolean }) {
    const { teamName } = useLocale();
    const labels = { home: teamName(fixture.homeTeam), draw: t("lobby.draw"), away: teamName(fixture.awayTeam) };
    const label = labels[signal.leadingChoice];
    const statement = projection ? fixtureMarketStatement(t, projection, label) : t("lobby.lastConfirmedSignal");
    return <><p className="mt-5 font-['Chakra_Petch'] text-sm font-black uppercase text-white/65">{label}</p><div style={{ viewTransitionName: "market-value" } as CSSProperties} className={`${mobile ? "text-[clamp(4.25rem,20vw,5.8rem)]" : "text-[clamp(4.25rem,5.7vw,6rem)]"} mt-2 flex items-start font-['Chakra_Petch'] font-black leading-none text-primary`}><AnimatedNumber value={signal.value} locales={locale} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /><span className="ml-1 mt-1 text-[.2em]">%</span></div><p className="mt-4 max-w-xs text-sm text-white/50">{statement}</p><Distribution options={signal.distribution} labels={labels} />{countdown ? <div className="mt-5 border-t border-white/12 pt-4"><strong className="font-['Chakra_Petch'] text-sm font-black uppercase text-white/80">{countdown}</strong><p className="mt-2 text-xs leading-5 text-white/40">{projection?.availability.canPredict ? t("lobby.predictionsOpen") : t("lobby.predictionsLater")}</p></div> : null}</>;
  }

  function Distribution({ options, labels }: { options: FeaturedSignal["distribution"]; labels: Record<"home" | "draw" | "away", string> }) {
    if (options.length < 2) return null;
    const colorByOutcome = { home: "bg-primary", draw: "bg-white/45", away: "bg-[#7aa7ff]" } as const;
    return <div className="mt-8 w-full border-t border-white/12 pt-4"><div className="flex h-1.5 w-full overflow-hidden bg-white/10">{options.map((option) => <motion.span key={option.id} initial={{ width: 0 }} animate={{ width: `${option.value}%` }} className={colorByOutcome[option.id]} />)}</div><div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))` }}>{options.map((option) => <div key={option.id} className="min-w-0"><span className="block truncate font-['DM_Mono'] text-[10px] uppercase text-white/50">{labels[option.id]}</span><strong className="mt-1 block text-xs"><AnimatedNumber value={option.value} locales={locale} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />%</strong></div>)}</div></div>;
  }
}

function signalAge(ageSeconds: number, t: ReturnType<typeof useLocale>["t"]): string {
  const seconds = Math.max(0, Math.round(ageSeconds));
  if (seconds < 60) return t("lobby.age.seconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("lobby.age.minutes", { count: minutes });
  return t("lobby.age.hours", { count: Math.floor(minutes / 60) });
}

function kickoffCountdown(kickoffAt: string | null, t: ReturnType<typeof useLocale>["t"]): string | null {
  const kickoffMs = Date.parse(kickoffAt ?? "");
  if (!Number.isFinite(kickoffMs)) return null;
  const remainingMinutes = Math.ceil((kickoffMs - Date.now()) / 60_000);
  if (remainingMinutes <= 0) return null;
  if (remainingMinutes >= 48 * 60) return t("lobby.kickoff.days", { count: Math.floor(remainingMinutes / (24 * 60)) });
  if (remainingMinutes >= 120) return t("lobby.kickoff.hours", { count: Math.floor(remainingMinutes / 60) });
  return t("lobby.kickoff.minutes", { count: remainingMinutes });
}

function StageBackdrop({ home, away }: { home: string; away: string }) { return <div aria-hidden className="absolute inset-0 overflow-hidden"><div className="absolute inset-y-0 left-0 w-[58%] bg-[linear-gradient(135deg,rgba(202,255,40,.18),transparent_70%)] [clip-path:polygon(0_0,100%_0,70%_100%,0_100%)]" /><div className="absolute inset-y-0 right-0 w-[58%] bg-[linear-gradient(225deg,rgba(122,167,255,.18),transparent_70%)] [clip-path:polygon(30%_0,100%_0,100%_100%,0_100%)]" /><span className="absolute -left-7 bottom-0 font-['Chakra_Petch'] text-[18rem] font-black leading-none text-white/[.045]">{home[0]}</span><span className="absolute -right-4 top-8 font-['Chakra_Petch'] text-[18rem] font-black leading-none text-white/[.045]">{away[0]}</span></div>; }
function TeamField({ name, side }: { name: string; side: "home" | "away" }) { const { t, teamName } = useLocale(); const away = side === "away"; const displayName = teamName(name); return <motion.div initial={{ opacity: 0, x: away ? 36 : -36 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .42, ease: [.22, 1, .36, 1] }} className={`relative flex min-w-0 flex-col justify-center overflow-hidden px-8 py-10 ${away ? "items-end text-right" : "items-start"}`}><TeamIcon name={name} side={side} size="xl" /><p className="mt-3 font-['DM_Mono'] text-[10px] uppercase tracking-[.18em] text-white/50">{t(away ? "lobby.awaySide" : "lobby.homeSide")}</p><h2 style={{ viewTransitionName: away ? "away-team" : "home-team" } as CSSProperties} className={`mt-1 max-w-full font-['Chakra_Petch'] font-black uppercase leading-[.82] ${teamNameScale(displayName)}`}>{displayName}</h2></motion.div>; }
function MobileMatchIdentity({ home, away }: { home: string; away: string }) { return <div className="relative min-h-56 overflow-hidden px-4 pb-8 pt-12 sm:px-7"><div className="absolute bottom-8 left-4 w-[40%] min-w-0 sm:left-7"><TeamCompact name={home} side="home" /></div><span className="absolute bottom-10 left-1/2 -translate-x-1/2 font-['DM_Mono'] text-[10px] font-black text-primary">VS</span><div className="absolute bottom-8 right-4 w-[40%] min-w-0 sm:right-7"><TeamCompact name={away} side="away" /></div></div>; }
function TeamCompact({ name, side }: { name: string; side: "home" | "away" }) { const { teamName } = useLocale(); const displayName = teamName(name); const scale = displayName.length >= 11 ? "text-[clamp(1rem,4.6vw,1.35rem)]" : displayName.length >= 9 ? "text-[clamp(1.15rem,5.2vw,1.55rem)]" : "text-[clamp(1.3rem,6vw,1.8rem)]"; return <div className={side === "away" ? "min-w-0 text-right" : "min-w-0"}><div className={side === "away" ? "flex justify-end" : ""}><TeamIcon name={name} side={side} size="md" /></div><h2 style={{ viewTransitionName: side === "home" ? "home-team" : "away-team" } as CSSProperties} className={`mt-3 whitespace-nowrap font-['Chakra_Petch'] font-black uppercase leading-[.86] ${scale}`}>{displayName}</h2></div>; }
