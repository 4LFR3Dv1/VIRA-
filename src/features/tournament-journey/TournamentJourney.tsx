import { ArrowRight, Trophy } from "lucide-react";
import { Link } from "react-router";

import { useLocale } from "../../i18n/locale-context.tsx";
import { TeamIcon } from "../../shared/team/team-icons";
import type { TournamentJourneyFixture, TournamentJourneyProjection } from "../../social/share";
import { deriveHomeFixturePresentationState } from "../home/home-narrative.ts";

const copy = {
  en: {
    kicker: "World Cup journey", title: "Road to the final", active: "Tournament active", complete: "Tournament complete",
    intro: "Follow the four matches that decide the champion. Results and schedules come from TxLINE.",
    stages: { semi_final: "Semifinal", semi_finals: "Semifinals", third_place: "Third place", final: "Final" },
    scheduled: "Scheduled", awaitingOfficial: "Awaiting official update", live: "Live now", paused: "Paused", finished: "Final", postponed: "Postponed", cancelled: "Cancelled", unknown: "Status unavailable",
    unavailable: "Result unavailable", open: "Open match", inspect: "View match status", viewResult: "View result", archive: "Match archive", verified: "Official result", champion: "Official champion", roadComplete: "The road is complete.", decided: "Explore how the World Cup was decided.",
    yourPath: "Your path", championPath: "Champion's path",
    authority: "Bracket structure: editorial manifest · Match data: TxLINE",
  },
  "pt-BR": {
    kicker: "Jornada da Copa do Mundo", title: "Caminho até a final", active: "Torneio em andamento", complete: "Torneio concluído",
    intro: "Acompanhe as quatro partidas que definem o campeão. Resultados e horários vêm da TxLINE.",
    stages: { semi_final: "Semifinal", semi_finals: "Semifinais", third_place: "Terceiro lugar", final: "Final" },
    scheduled: "Agendada", awaitingOfficial: "Aguardando atualização oficial", live: "Ao vivo", paused: "Pausada", finished: "Final", postponed: "Adiada", cancelled: "Cancelada", unknown: "Status indisponível",
    unavailable: "Resultado indisponível", open: "Abrir partida", inspect: "Ver status da partida", viewResult: "Ver resultado", archive: "Arquivo da partida", verified: "Resultado oficial", champion: "Campeão oficial", roadComplete: "O caminho está completo.", decided: "Explore como a Copa do Mundo foi decidida.",
    yourPath: "Seu caminho", championPath: "Caminho do campeão",
    authority: "Estrutura: manifesto editorial · Dados das partidas: TxLINE",
  },
} as const;

export function TournamentJourney({ journey, highlightTeam = null, nowMs = Date.now() }: { journey: TournamentJourneyProjection; highlightTeam?: string | null; nowMs?: number }) {
  const { locale, formatDateTime, localizedHref, teamName } = useLocale();
  const c = copy[locale];
  const semis = journey.fixtures.filter((item) => item.stage === "semi_final").sort((a, b) => a.slot - b.slot);
  const third = journey.fixtures.find((item) => item.stage === "third_place");
  const final = journey.fixtures.find((item) => item.stage === "final");
  const pathTeam = journey.champion?.name ?? highlightTeam ?? null;
  const pathLabel = journey.champion && pathTeam === journey.champion.name ? c.championPath : c.yourPath;

  return <section aria-labelledby="tournament-journey-title" className="my-12 border-y border-white/12 py-10 lg:my-16 lg:py-14">
    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
      <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">{c.kicker}</p><h2 id="tournament-journey-title" className="mt-3 font-['Chakra_Petch'] text-4xl font-black uppercase sm:text-5xl">{c.title}</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-white/48">{c.intro}</p></div>
      <div className={journey.status === "complete" ? "border border-primary/50 bg-primary/[.08] px-5 py-4 shadow-[inset_3px_0_0_#c7ff18]" : "border-l-2 border-primary pl-4"}><p className={`font-['DM_Mono'] text-[9px] font-bold uppercase ${journey.status === "complete" ? "text-primary" : "text-white/48"}`}>{journey.status === "complete" ? c.complete : c.active}</p>{journey.champion ? <p className="mt-2 flex items-center gap-2 font-['Chakra_Petch'] text-xl font-black uppercase"><Trophy className="size-5 text-primary" /> {teamName(journey.champion.name)}</p> : null}</div>
    </div>

    <div data-desktop-bracket className="mt-9 hidden grid-cols-[minmax(0,1fr)_52px_minmax(0,1fr)] items-stretch gap-y-4 md:grid" aria-label={c.title}>
      <div className="grid gap-4">{semis.map((fixture) => <JourneyCard key={fixture.fixtureId} item={fixture} label={`${c.stages.semi_final} ${fixture.slot}`} c={c} formatDateTime={formatDateTime} teamName={teamName} href={localizedHref(`/match/${fixture.fixtureId}/preview`)} highlightTeam={pathTeam} pathLabel={pathLabel} nowMs={nowMs} />)}</div>
      <div aria-hidden="true" className="relative"><span className="absolute left-0 top-1/4 h-px w-full bg-white/18" /><span className="absolute left-1/2 top-1/4 h-1/2 w-px bg-white/18" /><span className="absolute left-1/2 top-3/4 h-px w-1/2 bg-white/18" /></div>
      <div className="grid gap-4"><JourneyCard item={final} label={c.stages.final} c={c} formatDateTime={formatDateTime} teamName={teamName} href={final ? localizedHref(`/match/${final.fixtureId}/preview`) : "#"} emphasis highlightTeam={pathTeam} pathLabel={pathLabel} nowMs={nowMs} /><JourneyCard item={third} label={c.stages.third_place} c={c} formatDateTime={formatDateTime} teamName={teamName} href={third ? localizedHref(`/match/${third.fixtureId}/preview`) : "#"} highlightTeam={pathTeam} pathLabel={pathLabel} nowMs={nowMs} /></div>
    </div>

    <div data-mobile-bracket className="mt-8 grid gap-7 md:hidden" aria-label={c.title}>
      <MobileStage label={c.stages.semi_finals}>{semis.map((fixture) => <JourneyCard key={fixture.fixtureId} item={fixture} label={`${c.stages.semi_final} ${fixture.slot}`} c={c} formatDateTime={formatDateTime} teamName={teamName} href={localizedHref(`/match/${fixture.fixtureId}/preview`)} highlightTeam={pathTeam} pathLabel={pathLabel} nowMs={nowMs} />)}</MobileStage>
      <MobileStage label={c.stages.third_place}>{third ? <JourneyCard item={third} label={c.stages.third_place} c={c} formatDateTime={formatDateTime} teamName={teamName} href={localizedHref(`/match/${third.fixtureId}/preview`)} highlightTeam={pathTeam} pathLabel={pathLabel} nowMs={nowMs} /> : null}</MobileStage>
      <MobileStage label={c.stages.final}>{final ? <JourneyCard item={final} label={c.stages.final} c={c} formatDateTime={formatDateTime} teamName={teamName} href={localizedHref(`/match/${final.fixtureId}/preview`)} emphasis highlightTeam={pathTeam} pathLabel={pathLabel} nowMs={nowMs} /> : null}</MobileStage>
    </div>

    {journey.status === "complete" && final?.result && final.fixture ? <div className="mt-8 border border-primary/45 bg-primary/[.06] p-5"><p className="font-['Chakra_Petch'] text-2xl font-black uppercase">{c.roadComplete}</p><p className="mt-2 font-['DM_Mono'] text-sm font-bold text-primary">{teamName(final.fixture.fixture.homeTeam.name)} {final.result.homeScore}–{final.result.awayScore} {teamName(final.fixture.fixture.awayTeam.name)}</p><p className="mt-2 text-sm text-white/50">{c.decided}</p></div> : null}

    <p className="mt-4 font-['DM_Mono'] text-[8px] uppercase tracking-[.12em] text-white/25">{c.authority} · {journey.manifestVersion}</p>
  </section>;
}

type Copy = typeof copy.en | typeof copy["pt-BR"];
function JourneyCard({ item, label, c, formatDateTime, teamName, href, emphasis = false, highlightTeam = null, pathLabel, nowMs }: { item?: TournamentJourneyFixture; label: string; c: Copy; formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions & { timeZone?: string }) => string; teamName: (name: string) => string; href: string; emphasis?: boolean; highlightTeam?: string | null; pathLabel: string; nowMs: number }) {
  const fixture = item?.fixture?.fixture;
  const status = fixture?.status ?? "unknown";
  const result = item?.result;
  const presentation = deriveHomeFixturePresentationState({ status, kickoffAt: fixture?.kickoffAt ?? null, officialResultAvailable: result?.authority === "txline_terminal_history", nowMs });
  const highlighted = Boolean(highlightTeam && fixture && [fixture.homeTeam.name, fixture.awayTeam.name].some((name) => normalizeTeam(name) === normalizeTeam(highlightTeam)));
  const kickoff = fixture?.kickoffAt ? formatDateTime(fixture.kickoffAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: item?.fixture?.temporal.timeZone }) : null;
  const action = presentation === "finished" ? result ? c.viewResult : c.archive : presentation === "upcoming" || presentation === "live" || presentation === "paused" ? c.open : c.inspect;
  const statusCopy = presentation === "upcoming" ? c.scheduled : presentation === "awaiting_official_state" ? c.awaitingOfficial : c[presentation];
  const card = <article data-highlighted-path={highlighted ? "true" : undefined} className={`relative min-h-44 overflow-hidden border p-5 transition-colors duration-500 motion-reduce:transition-none ${highlighted ? "border-primary bg-primary/[.09] shadow-[inset_3px_0_0_#c7ff18]" : emphasis ? "border-primary/55 bg-primary/[.055]" : "border-white/18 bg-[#050814]/40"}`}>
    {highlighted ? <span className="absolute right-0 top-0 bg-primary px-3 py-1 font-['DM_Mono'] text-[8px] font-black uppercase text-[#050814]">{pathLabel}</span> : null}
    <div className="flex items-start justify-between gap-4"><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase text-primary">{label}</p><p className="mt-1 font-['DM_Mono'] text-[8px] font-medium uppercase text-white/48">{fixture ? statusCopy : c.unavailable}{kickoff ? ` · ${kickoff}` : ""}</p></div>{result ? <span className="font-['Chakra_Petch'] text-2xl font-black">{result.homeScore}–{result.awayScore}</span> : null}</div>
    {fixture ? <div className="mt-5 grid gap-2"><TeamLine providerName={fixture.homeTeam.name} displayName={teamName(fixture.homeTeam.name)} score={result?.homeScore} /><TeamLine providerName={fixture.awayTeam.name} displayName={teamName(fixture.awayTeam.name)} score={result?.awayScore} /></div> : <p role="status" className="mt-8 text-sm font-bold uppercase text-white/38">{c.unavailable}</p>}
    {result?.authority === "txline_terminal_history" ? <div className="mt-4 flex items-center gap-2 text-white/58"><img src="/txline-logo.svg" alt="TxLINE" className="h-2.5 w-auto opacity-75" /><span className="font-['DM_Mono'] text-[8px] font-bold uppercase">{c.verified}</span></div> : null}
    {fixture ? <span className="mt-4 inline-flex items-center gap-2 text-[10px] font-black uppercase text-white/70 group-hover:text-primary">{action} <ArrowRight className="size-3.5" /></span> : null}
  </article>;
  return fixture ? <Link aria-label={`${action}: ${teamName(fixture.homeTeam.name)} vs ${teamName(fixture.awayTeam.name)}`} to={href} className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-[#050814]">{card}</Link> : card;
}

function MobileStage({ label, children }: { label: string; children: React.ReactNode }) {
  return <section aria-label={label}><div className="mb-3 flex items-center gap-3"><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.16em] text-white/60">{label}</p><span className="h-px flex-1 bg-white/16" /></div><div className="grid gap-3">{children}</div></section>;
}

function TeamLine({ providerName, displayName, score }: { providerName: string; displayName: string; score?: number }) { return <div className="flex min-h-8 items-center gap-3"><TeamIcon name={providerName} size="sm" /><span className="flex-1 font-['Chakra_Petch'] text-sm font-black uppercase">{displayName}</span>{Number.isFinite(score) ? <strong className="font-['DM_Mono'] text-sm">{score}</strong> : null}</div>; }

function normalizeTeam(name: string) {
  return name.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
}
