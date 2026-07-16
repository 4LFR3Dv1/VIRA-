import { ArrowRight, Play, Trophy } from "lucide-react";
import { Link } from "react-router";

import { useLocale } from "../../i18n/locale-context.tsx";
import { TeamIcon } from "../../shared/team/team-icons";
import type { TournamentJourneyFixture, TournamentJourneyProjection } from "../../social/share";

const copy = {
  en: {
    kicker: "World Cup journey", title: "Road to the final", active: "Tournament active", complete: "Tournament complete",
    intro: "Follow the four matches that decide the champion. Results and schedules come from TxLINE.",
    stages: { semi_final: "Semifinal", third_place: "Third place", final: "Final" },
    scheduled: "Scheduled", live: "Live now", paused: "Paused", finished: "Final", postponed: "Postponed", cancelled: "Cancelled", unknown: "Status unavailable",
    unavailable: "Result unavailable", open: "Open match", champion: "Official champion", roadComplete: "The road is complete.", decided: "Explore how the World Cup was decided.",
    playbackTitle: "See how VIRA works during a live match", playbackBody: "Guided playback using a sanitized captured TxLINE fixture.", playbackCta: "Start guided playback",
    authority: "Bracket structure: editorial manifest · Match data: TxLINE",
  },
  "pt-BR": {
    kicker: "Jornada da Copa do Mundo", title: "Caminho até a final", active: "Torneio em andamento", complete: "Torneio concluído",
    intro: "Acompanhe as quatro partidas que definem o campeão. Resultados e horários vêm da TxLINE.",
    stages: { semi_final: "Semifinal", third_place: "Terceiro lugar", final: "Final" },
    scheduled: "Agendada", live: "Ao vivo", paused: "Pausada", finished: "Final", postponed: "Adiada", cancelled: "Cancelada", unknown: "Status indisponível",
    unavailable: "Resultado indisponível", open: "Abrir partida", champion: "Campeão oficial", roadComplete: "O caminho está completo.", decided: "Explore como a Copa do Mundo foi decidida.",
    playbackTitle: "Veja como o VIRA funciona durante uma partida ao vivo", playbackBody: "Playback guiado com uma fixture TxLINE capturada e sanitizada.", playbackCta: "Iniciar playback guiado",
    authority: "Estrutura: manifesto editorial · Dados das partidas: TxLINE",
  },
} as const;

export function TournamentJourney({ journey }: { journey: TournamentJourneyProjection }) {
  const { locale, formatDateTime, localizedHref, teamName } = useLocale();
  const c = copy[locale];
  const semis = journey.fixtures.filter((item) => item.stage === "semi_final").sort((a, b) => a.slot - b.slot);
  const third = journey.fixtures.find((item) => item.stage === "third_place");
  const final = journey.fixtures.find((item) => item.stage === "final");

  return <section aria-labelledby="tournament-journey-title" className="my-12 border-y border-white/12 py-10 lg:my-16 lg:py-14">
    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
      <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">{c.kicker}</p><h2 id="tournament-journey-title" className="mt-3 font-['Chakra_Petch'] text-4xl font-black uppercase sm:text-5xl">{c.title}</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-white/48">{c.intro}</p></div>
      <div className="border-l-2 border-primary pl-4"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{journey.status === "complete" ? c.complete : c.active}</p>{journey.champion ? <p className="mt-2 flex items-center gap-2 font-['Chakra_Petch'] text-xl font-black uppercase"><Trophy className="size-5 text-primary" /> {journey.champion.name}</p> : null}</div>
    </div>

    <div className="mt-9 hidden grid-cols-[1fr_52px_1fr] items-stretch gap-y-4 lg:grid" aria-label={c.title}>
      <div className="grid gap-4">{semis.map((fixture) => <JourneyCard key={fixture.fixtureId} item={fixture} label={`${c.stages.semi_final} ${fixture.slot}`} c={c} formatDateTime={formatDateTime} teamName={teamName} href={localizedHref(`/match/${fixture.fixtureId}/preview`)} />)}</div>
      <div aria-hidden="true" className="relative"><span className="absolute left-0 top-1/4 h-px w-full bg-white/18" /><span className="absolute left-1/2 top-1/4 h-1/2 w-px bg-white/18" /><span className="absolute left-1/2 top-3/4 h-px w-1/2 bg-white/18" /></div>
      <div className="grid gap-4"><JourneyCard item={final} label={c.stages.final} c={c} formatDateTime={formatDateTime} teamName={teamName} href={final ? localizedHref(`/match/${final.fixtureId}/preview`) : "#"} emphasis /><JourneyCard item={third} label={c.stages.third_place} c={c} formatDateTime={formatDateTime} teamName={teamName} href={third ? localizedHref(`/match/${third.fixtureId}/preview`) : "#"} /></div>
    </div>

    <ol className="mt-8 grid gap-3 lg:hidden" aria-label={c.title}>{[...semis, third, final].filter(Boolean).map((fixture) => <li key={fixture!.fixtureId}><JourneyCard item={fixture} label={fixture!.stage === "semi_final" ? `${c.stages.semi_final} ${fixture!.slot}` : c.stages[fixture!.stage]} c={c} formatDateTime={formatDateTime} teamName={teamName} href={localizedHref(`/match/${fixture!.fixtureId}/preview`)} emphasis={fixture!.stage === "final"} /></li>)}</ol>

    {journey.status === "complete" && final?.result && final.fixture ? <div className="mt-8 border border-primary/45 bg-primary/[.06] p-5"><p className="font-['Chakra_Petch'] text-2xl font-black uppercase">{c.roadComplete}</p><p className="mt-2 font-['DM_Mono'] text-sm font-bold text-primary">{teamName(final.fixture.fixture.homeTeam.name)} {final.result.homeScore}–{final.result.awayScore} {teamName(final.fixture.fixture.awayTeam.name)}</p><p className="mt-2 text-sm text-white/50">{c.decided}</p></div> : null}

    <div className="mt-8 flex flex-col justify-between gap-5 border border-white/12 bg-[#050814]/45 p-5 sm:flex-row sm:items-center"><div><p className="font-['Chakra_Petch'] text-lg font-black uppercase">{c.playbackTitle}</p><p className="mt-2 text-xs text-white/42">{c.playbackBody}</p></div><Link to={localizedHref("/match/judge-playback-france-spain-v2")} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-3 border border-primary px-5 text-xs font-black uppercase text-primary hover:bg-primary hover:text-[#050814]"><Play className="size-4" /> {c.playbackCta}</Link></div>
    <p className="mt-4 font-['DM_Mono'] text-[8px] uppercase tracking-[.12em] text-white/25">{c.authority} · {journey.manifestVersion}</p>
  </section>;
}

type Copy = typeof copy.en | typeof copy["pt-BR"];
function JourneyCard({ item, label, c, formatDateTime, teamName, href, emphasis = false }: { item?: TournamentJourneyFixture; label: string; c: Copy; formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions & { timeZone?: string }) => string; teamName: (name: string) => string; href: string; emphasis?: boolean }) {
  const fixture = item?.fixture?.fixture;
  const status = fixture?.status ?? "unknown";
  const result = item?.result;
  const kickoff = fixture?.kickoffAt ? formatDateTime(fixture.kickoffAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: item?.fixture?.temporal.timeZone }) : null;
  return <article className={`relative min-h-40 border p-5 ${emphasis ? "border-primary/55 bg-primary/[.055]" : "border-white/14 bg-[#050814]/40"}`}>
    <div className="flex items-start justify-between gap-4"><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase text-primary">{label}</p><p className="mt-1 font-['DM_Mono'] text-[8px] uppercase text-white/30">{fixture ? c[status] : c.unavailable}{kickoff ? ` · ${kickoff}` : ""}</p></div>{result ? <span className="font-['Chakra_Petch'] text-2xl font-black">{result.homeScore}–{result.awayScore}</span> : null}</div>
    {fixture ? <div className="mt-5 grid gap-2"><TeamLine providerName={fixture.homeTeam.name} displayName={teamName(fixture.homeTeam.name)} score={result?.homeScore} /><TeamLine providerName={fixture.awayTeam.name} displayName={teamName(fixture.awayTeam.name)} score={result?.awayScore} /></div> : <p role="status" className="mt-8 text-sm font-bold uppercase text-white/38">{c.unavailable}</p>}
    {fixture ? <Link aria-label={`${c.open}: ${teamName(fixture.homeTeam.name)} vs ${teamName(fixture.awayTeam.name)}`} to={href} className="mt-5 inline-flex items-center gap-2 text-[10px] font-black uppercase text-white/55 hover:text-primary">{c.open} <ArrowRight className="size-3.5" /></Link> : null}
  </article>;
}

function TeamLine({ providerName, displayName, score }: { providerName: string; displayName: string; score?: number }) { return <div className="flex min-h-8 items-center gap-3"><TeamIcon name={providerName} size="sm" /><span className="flex-1 font-['Chakra_Petch'] text-sm font-black uppercase">{displayName}</span>{Number.isFinite(score) ? <strong className="font-['DM_Mono'] text-sm">{score}</strong> : null}</div>; }
