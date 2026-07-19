import { ArrowRight, CalendarDays, Check, Clock3, LockKeyhole, Radio, Share2, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { fixtureAccent, useShellAtmosphere } from "../../app/shell/use-shell-atmosphere";
import type { RoomSnapshot } from "../../domain/types.ts";
import { useLocale } from "../../i18n/locale-context.tsx";
import { fetchPublicPlayback, fetchPublicRoomProjection } from "../../runtime/api.ts";
import { ViraLoader } from "../../shared/brand/ViraLoader";
import { TeamIcon } from "../../shared/team/team-icons";
import { fetchHome, presentShare, trackHome, type HomeProjection } from "../../social/share.ts";
import { fetchOwnerPicks, fetchPicksCatalog, sharePicks } from "../picks/api.ts";
import type { ViraPickResultV1, ViraPickSelectionV1, ViraPicksCardV1, ViraPicksCatalogV1 } from "../picks/contracts.ts";
import { VIRA_PICKS_ENABLED } from "../picks/feature-flags.ts";
import { TournamentJourney } from "../tournament-journey/TournamentJourney.tsx";
import { countdownParts, deriveExperienceMode, presentationStateForNarrative, selectHomeNarrativeFixture, selectedTeamFromPicks, type HomeFixturePresentationState, type HomeNarrativeFixture } from "./home-narrative.ts";

const copy = {
  en: {
    page: "The World Cup, through VIRA",
    acts: { now: "Match state", place: "Your pick", road: "Tournament path", live: "Live participation" },
    now: "World Cup now", active: "Tournament active", complete: "Tournament complete", finalToday: "Final today", live: "Live", paused: "Paused", scheduled: "Scheduled", awaitingOfficial: "Awaiting official update", finished: "Final", postponed: "Postponed", cancelled: "Cancelled", unknown: "Status unavailable",
    champion: (team: string) => `${team} are World Cup champions`,
    liveTitle: (home: string, away: string) => `${home} × ${away} is live`,
    pausedTitle: (home: string, away: string) => `${home} × ${away} is paused`,
    nextTitle: (home: string, away: string) => `${home} × ${away} is next`,
    awaitingTitle: (home: string, away: string) => `${home} × ${away} awaits official status`,
    finishedTitle: (home: string, away: string) => `${home} × ${away} has ended`,
    postponedTitle: (home: string, away: string) => `${home} × ${away} is postponed`,
    cancelledTitle: (home: string, away: string) => `${home} × ${away} is cancelled`,
    unknownTitle: (home: string, away: string) => `${home} × ${away} status is unavailable`,
    kickoff: "Kickoff", startsIn: "Starts in", score: "Official score", liveScore: "Live score", matchClock: "Match clock", consensus: "TxLINE consensus", consensusScope: "Regular-time result", consensusTeam: (team: string) => `${team} to win`, observed: "Observed", unavailableConsensus: "Consensus unavailable", nextEvent: "What happens next", nextScheduled: "Kickoff begins the next shared match journey.", nextLive: "The next eligible live signal can open a synchronized decision.", nextPaused: "Confirmed room state is preserved until play resumes.", nextFinished: "The official result advances the tournament path.", nextAwaiting: "VIRA is waiting for TxLINE to confirm the official fixture state.", nextExceptional: "VIRA preserves the official fixture state until TxLINE changes it.",
    yourPlace: "Your place in the World Cup", noPickTitle: "The tournament is underway. Choose how you'll follow it.", noPickBody: "VIRA Picks gives your next match a personal point of view before the synchronized live experience begins.", noPickCompleteTitle: "The World Cup is complete. Explore how it was decided.", noPickCompleteBody: "The official path remains available, while certified playback shows how VIRA turns live signals into shared decisions.", choiceOpen: "Choice open", matchUnderway: "Match underway", journeyArchive: "Journey archive", noActivePick: "No active pick", makePicks: "Make your VIRA Picks", explore: "Explore matches", confirmed: "Confirmed", locked: "Locked", partiallyResolved: "Resolving", resolved: "Resolved", void: "Void", selectionStatus: "Card status", confirmationSnapshot: "Confirmation snapshot", confirmedAt: "Confirmed", locksAt: "Locks", pathRelation: (team: string) => `${team}'s route is highlighted in the tournament path.`, drawRelation: "Your match-result pick does not select a team path.", share: "Share your picks", sharing: "Opening share options", snapshotProtected: "Market context persisted by hash at confirmation.",
    selections: { match_result: "Regular-time result", total_goals: "Regular-time goals", both_teams_score: "Both teams score" },
    result: { pending: "Pending", correct: "Correct", missed: "Missed", void: "Void" },
    values: { home: "Home", draw: "Draw", away: "Away", over: "Over 2.5", under: "Under 2.5", yes: "Yes", no: "No" },
    roadEyebrow: "The road ahead",
    experienceEyebrow: "Play it together", experienceTitle: "Experience how a live signal becomes a shared decision.", experienceLive: "This match has a public VIRA room synchronized to its current state.", experiencePlayback: "A complete VIRA journey is available using certified captured evidence.", experienceCatalog: "Choose an official fixture to see its current VIRA capabilities.", experienceChecking: "Checking the certified VIRA experience.", enterRoom: "Enter the Match Room", enterPlayback: "Enter guided experience", openMatches: "Open matches", checking: "Checking experience", liveDisclosure: "Current public room · official fixture state", playbackDisclosure: "Certified playback · sanitized captured TxLINE fixture · not a current live match", unavailableDisclosure: "No live room or certified playback is currently available.", checkingDisclosure: "Playback authority is being verified.",
    recent: { goal: "Goal signal", card: "Card signal", corner: "Corner signal", match_end: "Final whistle" },
    footerAuthority: "Fixture state and market context · TxLINE", footerStructure: "Tournament structure · versioned editorial manifest", footerPersonal: "Personal selections · VIRA Picks",
    retry: "Try again", loading: "Building the World Cup now", stage: { semi_final: "Semifinal", third_place: "Third place", final: "Final" },
  },
  "pt-BR": {
    page: "A Copa do Mundo, através do VIRA",
    acts: { now: "Estado da partida", place: "Seu palpite", road: "Caminho do torneio", live: "Participação ao vivo" },
    now: "A Copa agora", active: "Torneio em andamento", complete: "Torneio concluído", finalToday: "Final hoje", live: "Ao vivo", paused: "Pausada", scheduled: "Agendada", awaitingOfficial: "Aguardando atualização oficial", finished: "Final", postponed: "Adiada", cancelled: "Cancelada", unknown: "Status indisponível",
    champion: (team: string) => `${team} é campeã da Copa do Mundo`,
    liveTitle: (home: string, away: string) => `${home} × ${away} está ao vivo`,
    pausedTitle: (home: string, away: string) => `${home} × ${away} está pausada`,
    nextTitle: (home: string, away: string) => `${home} × ${away} é a próxima`,
    awaitingTitle: (home: string, away: string) => `${home} × ${away} aguarda status oficial`,
    finishedTitle: (home: string, away: string) => `${home} × ${away} terminou`,
    postponedTitle: (home: string, away: string) => `${home} × ${away} foi adiada`,
    cancelledTitle: (home: string, away: string) => `${home} × ${away} foi cancelada`,
    unknownTitle: (home: string, away: string) => `O status de ${home} × ${away} está indisponível`,
    kickoff: "Início", startsIn: "Começa em", score: "Placar oficial", liveScore: "Placar ao vivo", matchClock: "Tempo de jogo", consensus: "Consenso TxLINE", consensusScope: "Resultado em tempo regulamentar", consensusTeam: (team: string) => `${team} vence`, observed: "Observado", unavailableConsensus: "Consenso indisponível", nextEvent: "O que acontece agora", nextScheduled: "O início abre a próxima jornada compartilhada.", nextLive: "O próximo sinal elegível pode abrir uma decisão sincronizada.", nextPaused: "O estado confirmado da sala é preservado até o jogo continuar.", nextFinished: "O resultado oficial avança o caminho do torneio.", nextAwaiting: "O VIRA aguarda a TxLINE confirmar o estado oficial da partida.", nextExceptional: "O VIRA preserva o estado oficial até que a TxLINE o altere.",
    yourPlace: "Seu lugar na Copa do Mundo", noPickTitle: "O torneio está em andamento. Escolha como você vai acompanhá-lo.", noPickBody: "O VIRA Picks dá um ponto de vista pessoal à próxima partida antes do início da experiência sincronizada ao vivo.", noPickCompleteTitle: "A Copa do Mundo terminou. Explore como ela foi decidida.", noPickCompleteBody: "O caminho oficial permanece disponível, enquanto o playback certificado mostra como o VIRA transforma sinais ao vivo em decisões compartilhadas.", choiceOpen: "Escolha aberta", matchUnderway: "Partida em andamento", journeyArchive: "Arquivo da jornada", noActivePick: "Sem pick ativo", makePicks: "Fazer meus VIRA Picks", explore: "Explorar partidas", confirmed: "Confirmado", locked: "Fechado", partiallyResolved: "Resolvendo", resolved: "Resolvido", void: "Anulado", selectionStatus: "Status do card", confirmationSnapshot: "Snapshot da confirmação", confirmedAt: "Confirmado", locksAt: "Fecha", pathRelation: (team: string) => `O caminho de ${team} está destacado no chaveamento.`, drawRelation: "Seu palpite de resultado não seleciona o caminho de uma equipe.", share: "Compartilhar picks", sharing: "Abrindo compartilhamento", snapshotProtected: "Contexto de mercado persistido por hash na confirmação.",
    selections: { match_result: "Resultado no tempo regulamentar", total_goals: "Gols no tempo regulamentar", both_teams_score: "Ambas marcam" },
    result: { pending: "Pendente", correct: "Correto", missed: "Errou", void: "Anulado" },
    values: { home: "Casa", draw: "Empate", away: "Visitante", over: "Mais de 2,5", under: "Menos de 2,5", yes: "Sim", no: "Não" },
    roadEyebrow: "O caminho adiante",
    experienceEyebrow: "Jogue junto", experienceTitle: "Experimente como um sinal ao vivo se torna uma decisão compartilhada.", experienceLive: "Esta partida possui uma sala pública do VIRA sincronizada ao estado atual.", experiencePlayback: "Uma jornada completa do VIRA está disponível com evidência capturada e certificada.", experienceCatalog: "Escolha uma fixture oficial para ver suas capacidades atuais no VIRA.", experienceChecking: "Verificando a experiência certificada do VIRA.", enterRoom: "Entrar na Match Room", enterPlayback: "Entrar na experiência guiada", openMatches: "Abrir partidas", checking: "Verificando experiência", liveDisclosure: "Sala pública atual · estado oficial da fixture", playbackDisclosure: "Playback certificado · fixture TxLINE capturada e sanitizada · não é uma partida ao vivo atual", unavailableDisclosure: "Nenhuma sala ao vivo ou playback certificado está disponível agora.", checkingDisclosure: "A autoridade do playback está sendo verificada.",
    recent: { goal: "Sinal de gol", card: "Sinal de cartão", corner: "Sinal de escanteio", match_end: "Apito final" },
    footerAuthority: "Estado e contexto de mercado · TxLINE", footerStructure: "Estrutura do torneio · manifesto editorial versionado", footerPersonal: "Escolhas pessoais · VIRA Picks",
    retry: "Tentar novamente", loading: "Construindo a Copa agora", stage: { semi_final: "Semifinal", third_place: "Terceiro lugar", final: "Final" },
  },
} as const;

export function HomeScreen() {
  const navigate = useNavigate();
  const { locale, timeZone, formatDateTime, formatNumber, formatPercent, localizedHref, teamName } = useLocale();
  const c = copy[locale];
  const [home, setHome] = useState<HomeProjection | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [resourceFixtureId, setResourceFixtureId] = useState<string | null>(null);
  const [resourceCard, setResourceCard] = useState<ViraPicksCardV1 | null>(null);
  const [resourcePicksCatalog, setResourcePicksCatalog] = useState<ViraPicksCatalogV1 | null>(null);
  const [resourceRoom, setResourceRoom] = useState<RoomSnapshot | null>(null);
  const [playbackAvailable, setPlaybackAvailable] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = useCallback(() => void fetchHome({ locale, timeZone }).then((projection) => {
    setHome(projection); setStatus("ready");
    void trackHome("home.editorial_viewed", projection.editorial.kind, projection.editorial.fixture?.fixtureId).catch(() => undefined);
  }).catch(() => setStatus("error")), [locale, timeZone]);

  useEffect(() => {
    load(); const interval = window.setInterval(load, 15_000);
    const visible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [load]);

  const narrative = home ? selectHomeNarrativeFixture(home, nowMs) : null;
  const fixtureId = narrative?.fixtureId ?? null;
  const resourcesCurrent = Boolean(fixtureId && resourceFixtureId === fixtureId);
  const card = resourcesCurrent ? resourceCard : null;
  const picksCatalog = resourcesCurrent ? resourcePicksCatalog : null;
  const room = resourcesCurrent ? resourceRoom : null;
  useEffect(() => {
    setResourceFixtureId(fixtureId);
    setResourceCard(null);
    setResourcePicksCatalog(null);
    setResourceRoom(null);
    if (!fixtureId) return;
    let active = true;
    const refresh = () => {
      void Promise.all([
        VIRA_PICKS_ENABLED ? fetchOwnerPicks(fixtureId, locale).catch(() => ({ card: null })) : Promise.resolve({ card: null }),
        VIRA_PICKS_ENABLED ? fetchPicksCatalog(fixtureId, locale).catch(() => null) : Promise.resolve(null),
        fetchPublicRoomProjection(fixtureId).catch(() => null),
      ]).then(([owner, catalog, publicRoom]) => {
        if (!active) return;
        setResourceCard(owner.card); setResourcePicksCatalog(catalog); setResourceRoom(publicRoom);
      });
    };
    refresh(); const interval = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [fixtureId, locale]);

  useEffect(() => {
    let active = true;
    const refresh = () => { void fetchPublicPlayback().then((playback) => { if (active) setPlaybackAvailable(playback.available === true); }).catch(() => { if (active) setPlaybackAvailable(false); }); };
    refresh(); const interval = window.setInterval(refresh, 30_000);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, []);

  useEffect(() => { const interval = window.setInterval(() => setNowMs(Date.now()), 1_000); return () => window.clearInterval(interval); }, []);

  const selectedTeam = selectedTeamFromPicks(card, narrative);
  const homeAccent = narrative ? fixtureAccent(narrative.projection.fixture.homeTeam.name, "home") : undefined;
  const awayAccent = narrative ? fixtureAccent(narrative.projection.fixture.awayTeam.name, "away") : undefined;
  useShellAtmosphere("home", narrative ? {
    atmosphere: narrative.projection.fixture.status === "live" ? "live" : narrative.projection.fixture.status === "paused" ? "halftime" : narrative.projection.fixture.status === "finished" ? "finished" : "anticipation",
    context: narrative.projection.fixture.status === "finished" ? "post-match" : narrative.projection.fixture.status === "live" ? "match-room" : "discovery",
    fixtureId: narrative.fixtureId, homeAccent, awayAccent, fixtureFocus: selectedTeam ? .55 : .35, priority: 10,
  } : null);

  const go = (path: string) => { if (home) void trackHome("home.primary_action_clicked", home.editorial.kind, fixtureId ?? undefined).catch(() => undefined); navigate(localizedHref(path)); };
  const share = async () => { if (!card) return; setSharing(true); try { await presentShare(await sharePicks(card.id, locale)); } finally { setSharing(false); } };

  if (status === "loading") return <div className="grid min-h-[calc(100dvh-72px)] place-items-center"><ViraLoader label={c.loading} /></div>;
  if (status === "error" || !home) return <div className="grid min-h-[calc(100dvh-72px)] place-items-center"><button type="button" onClick={load} className="border border-white/20 px-5 py-3 text-xs font-black uppercase">{c.retry}</button></div>;

  const presentationState = narrative ? presentationStateForNarrative(narrative, nowMs) : "unknown";
  const canCreatePicks = Boolean(narrative && presentationState === "upcoming" && VIRA_PICKS_ENABLED && picksCatalog?.enabled);
  const experienceMode = deriveExperienceMode({ status: narrative?.projection.fixture.status ?? "unknown", publicRoomAvailable: Boolean(room), playbackAvailable });
  const actValues = {
    now: narrative ? presentationStatusLabel(presentationState, c) : c.unknown,
    place: card ? cardStatus(card.status, c) : personalStateLabel(presentationState, canCreatePicks, home.journey?.status === "complete", c),
    road: home.journey?.status === "complete" ? c.complete : c.active,
    live: experienceMode === "live_room" ? c.live : experienceMode === "guided_playback" ? locale === "pt-BR" ? "Experiência certificada" : "Certified experience" : experienceMode === "loading" ? c.checking : c.unknown,
  };

  return <main className="mx-auto min-h-[calc(100dvh-72px)] max-w-[1500px] px-5 py-8 sm:px-8 lg:px-14 lg:py-12">
    <header className="flex items-center justify-between border-b border-white/12 pb-5"><div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">VIRA</p><p className="mt-1 text-xs text-white/48">{c.page}</p></div><Link to={localizedHref("/matches")} className="inline-flex min-h-11 items-center gap-2 border border-white/20 px-4 text-[10px] font-black uppercase hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><CalendarDays className="size-4" /> {c.openMatches}</Link></header>

    <div className="relative before:absolute before:bottom-16 before:left-[11px] before:top-12 before:w-px before:bg-gradient-to-b before:from-primary/80 before:via-primary/35 before:to-primary/10 lg:before:left-[19px]">
      <ActShell index="01" label={c.acts.now} value={actValues.now} active={["live", "paused"].includes(presentationState)}><WorldCupNow narrative={narrative} home={home} room={room} nowMs={nowMs} /></ActShell>
      <ActShell index="02" label={c.acts.place} value={actValues.place}><YourPlace narrative={narrative} card={card} catalog={picksCatalog} selectedTeam={selectedTeam} tournamentComplete={home.journey?.status === "complete"} sharing={sharing} onShare={() => void share()} /></ActShell>
      <ActShell index="03" label={c.acts.road} value={actValues.road}><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.18em] text-primary">{c.roadEyebrow}</p>{home.journey ? <TournamentJourney journey={home.journey} highlightTeam={selectedTeam} nowMs={nowMs} /> : <p className="mt-5 text-sm text-white/48">{locale === "pt-BR" ? "O chaveamento oficial está indisponível." : "The official tournament path is unavailable."}</p>}</div></ActShell>
      <ActShell index="04" label={c.acts.live} value={actValues.live} active={experienceMode === "live_room"}><ExperienceAct mode={experienceMode} narrative={narrative} onGo={go} /></ActShell>
    </div>

    <footer className="grid gap-4 border-t border-white/12 pt-6 sm:grid-cols-3"><Authority icon={<Radio className="size-4 text-primary" />} value={c.footerAuthority} /><Authority icon={<Trophy className="size-4 text-primary" />} value={c.footerStructure} /><Authority icon={<Users className="size-4 text-primary" />} value={c.footerPersonal} /></footer>
  </main>;

  function WorldCupNow({ narrative, home, room, nowMs }: { narrative: HomeNarrativeFixture | null; home: HomeProjection; room: RoomSnapshot | null; nowMs: number }) {
    if (!narrative) return <section className="py-14"><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">{c.now}</p><h1 className="mt-5 font-['Chakra_Petch'] text-5xl font-black uppercase">{c.unknown}</h1></section>;
    const fixture = narrative.projection.fixture; const homeName = teamName(fixture.homeTeam.name); const awayName = teamName(fixture.awayTeam.name); const stage = narrative.journeyFixture ? c.stage[narrative.journeyFixture.stage] : fixture.competition.displayName;
    const state = presentationStateForNarrative(narrative, nowMs); const result = narrative.journeyFixture?.result;
    const officialScore = result?.authority === "txline_terminal_history" ? { home: result.homeScore, away: result.awayScore } : null;
    const liveScore = ["live", "paused"].includes(state) && room ? { home: room.match.homeScore, away: room.match.awayScore } : null;
    const score = officialScore ?? liveScore; const scoreLabel = officialScore ? c.score : c.liveScore;
    const countdown = state === "upcoming" ? countdownParts(fixture.kickoffAt, nowMs) : null;
    const market = state === "upcoming" && narrative.projection.availability.canShowMarket ? narrative.projection.market.canonical1X2 : null;
    const tournamentState = home.journey?.status === "complete" ? c.complete : state === "live" ? c.live : narrative.journeyFixture?.stage === "final" && narrative.projection.temporal.relation === "today" && state === "upcoming" ? c.finalToday : c.active;
    const title = home.journey?.champion ? c.champion(teamName(home.journey.champion.name)) : fixtureTitle(state, homeName, awayName, c);
    const recent = ["live", "paused"].includes(state) && room?.lastNormalizedEvent && ["goal", "card", "corner", "match_end"].includes(room.lastNormalizedEvent.type) && (room.lastNormalizedEvent.type !== "goal" || room.lastNormalizedEvent.confirmed === true || room.lastNormalizedEvent.confirmationState === "confirmed") ? room.lastNormalizedEvent : null;
    return <section aria-labelledby="world-cup-now" className="grid gap-9 py-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,.75fr)] lg:items-end lg:py-16">
      <div><div className="flex flex-wrap items-center gap-3"><span className="border border-primary/45 bg-primary/[.07] px-3 py-1.5 font-['DM_Mono'] text-[9px] font-black uppercase text-primary">{tournamentState}</span><span className="font-['DM_Mono'] text-[9px] font-bold uppercase text-white/58">{stage}</span><span className="font-['DM_Mono'] text-[9px] uppercase text-white/45">{presentationStatusLabel(state, c)}</span></div><h1 id="world-cup-now" className="mt-6 max-w-5xl font-['Chakra_Petch'] text-[clamp(3rem,7.2vw,7.4rem)] font-black uppercase leading-[.8]">{title}</h1><div className="mt-8 flex items-center gap-4"><TeamIcon name={fixture.homeTeam.name} size="lg" /><strong className="font-['Chakra_Petch'] text-lg font-black uppercase">{homeName}</strong><span className="text-primary">×</span><strong className="font-['Chakra_Petch'] text-lg font-black uppercase">{awayName}</strong><TeamIcon name={fixture.awayTeam.name} size="lg" /></div></div>
      <div className="border-y border-white/18 bg-[#050814]/38 py-5 lg:px-6"><Info label={c.kickoff} value={fixture.kickoffAt ? formatDateTime(fixture.kickoffAt, { timeZone: narrative.projection.temporal.timeZone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : c.unknown} />{countdown ? <div className="mt-5"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/45">{c.startsIn}</p><Countdown value={countdown} /></div> : null}{score ? <Info label={scoreLabel} value={`${formatNumber(score.home)}–${formatNumber(score.away)}`} strong /> : null}{room && ["live", "paused"].includes(state) ? <Info label={c.matchClock} value={`${formatNumber(Math.floor(room.match.matchClockSec / 60))}'`} /> : null}{market ? <Info label={c.consensus} context={c.consensusScope} value={`${market.leadingChoice === "draw" ? c.values.draw : c.consensusTeam(selectionLabel(market.leadingChoice, fixture, c, teamName))} · ${formatPercent(market.selections[market.leadingChoice] / 100, { maximumFractionDigits: 1 })}`} meta={market.observedAt ? `${c.observed} ${formatDateTime(market.observedAt, { timeZone, hour: "2-digit", minute: "2-digit" })}` : undefined} /> : null}{recent ? <Info label={c.nextEvent} value={c.recent[recent.type as keyof typeof c.recent]} meta={formatDateTime(recent.occurredAt, { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" })} /> : <Info label={c.nextEvent} value={nextEventCopy(state, c)} />}</div>
    </section>;
  }

  function YourPlace({ narrative, card, catalog, selectedTeam, tournamentComplete, sharing, onShare }: { narrative: HomeNarrativeFixture | null; card: ViraPicksCardV1 | null; catalog: ViraPicksCatalogV1 | null; selectedTeam: string | null; tournamentComplete: boolean; sharing: boolean; onShare: () => void }) {
    const canCreate = Boolean(narrative && VIRA_PICKS_ENABLED && catalog?.enabled && presentationStateForNarrative(narrative, nowMs) === "upcoming");
    if (!card) return <section aria-labelledby="your-place" className="grid gap-8 py-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:py-16"><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.18em] text-primary">{c.yourPlace}</p><h2 id="your-place" className="mt-5 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.5rem,5.5vw,5.5rem)] font-black uppercase leading-[.86]">{tournamentComplete ? c.noPickCompleteTitle : c.noPickTitle}</h2><p className="mt-6 max-w-2xl text-sm leading-6 text-white/52">{tournamentComplete ? c.noPickCompleteBody : c.noPickBody}</p></div><Link to={localizedHref(canCreate && narrative ? `/picks/${narrative.fixtureId}` : "/matches")} className="inline-flex min-h-14 items-center justify-center gap-4 bg-primary px-6 font-['Chakra_Petch'] text-xs font-black uppercase text-[#050814] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{canCreate ? c.makePicks : c.explore}<ArrowRight className="size-4" /></Link></section>;
    const resultByKind = new Map((card.results ?? []).map((result) => [result.selection.kind, result])); const snapshot = card.marketSnapshotRefs[0] ?? null;
    return <section aria-labelledby="your-place" className="grid gap-9 py-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:py-16"><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.18em] text-primary">{c.yourPlace}</p><h2 id="your-place" className="mt-5 font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6rem)] font-black uppercase leading-[.84]">{card.displayName},<br />{cardStatus(card.status, c)}</h2><p className="mt-6 max-w-2xl text-sm leading-6 text-white/52">{selectedTeam ? c.pathRelation(teamName(selectedTeam)) : c.drawRelation}</p><div className="mt-8 grid gap-2 sm:grid-cols-3">{card.selections.map((selection) => <PickLine key={selection.kind} selection={selection} result={resultByKind.get(selection.kind)} narrative={narrative} />)}</div></div><aside className="border border-primary/28 bg-primary/[.05] p-5"><div className="flex items-center justify-between"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/48">{c.selectionStatus}</p><Check className="size-5 text-primary" /></div><strong className="mt-2 block font-['Chakra_Petch'] text-xl font-black uppercase text-primary">{cardStatus(card.status, c)}</strong><dl className="mt-6 grid gap-4 border-t border-white/12 pt-5"><Meta label={c.confirmedAt} value={formatDateTime(card.confirmedAt, { timeZone: card.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} /><Meta label={c.locksAt} value={formatDateTime(card.locksAt, { timeZone: card.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} icon={<LockKeyhole className="size-3.5" />} />{snapshot ? <Meta label={c.confirmationSnapshot} value={snapshot.slice(0, 14)} /> : null}</dl>{snapshot ? <p className="mt-4 text-[10px] leading-4 text-white/38">{c.snapshotProtected}</p> : null}<button type="button" onClick={onShare} disabled={sharing} className="mt-6 flex min-h-12 w-full items-center justify-between border border-primary px-4 text-[10px] font-black uppercase text-primary disabled:opacity-50">{sharing ? c.sharing : c.share}<Share2 className="size-4" /></button></aside></section>;
  }

  function PickLine({ selection, result, narrative }: { selection: ViraPickSelectionV1; result?: ViraPickResultV1; narrative: HomeNarrativeFixture | null }) { return <article className="border border-white/16 bg-[#050814]/40 p-4"><p className="font-['DM_Mono'] text-[8px] uppercase text-white/42">{c.selections[selection.kind]}</p><strong className="mt-3 block font-['Chakra_Petch'] text-lg font-black uppercase">{pickValue(selection, narrative, c, teamName)}</strong><span className={`mt-4 inline-block font-['DM_Mono'] text-[8px] font-bold uppercase ${result?.status === "correct" ? "text-primary" : result?.status === "missed" ? "text-red-300" : "text-white/48"}`}>{c.result[result?.status ?? "pending"]}</span></article>; }

  function ExperienceAct({ mode, narrative, onGo }: { mode: ReturnType<typeof deriveExperienceMode>; narrative: HomeNarrativeFixture | null; onGo: (path: string) => void }) {
    const config = mode === "live_room" && narrative ? { body: c.experienceLive, disclosure: c.liveDisclosure, cta: c.enterRoom, path: `/match/${narrative.fixtureId}`, icon: <Radio className="size-5" />, disabled: false } : mode === "guided_playback" ? { body: c.experiencePlayback, disclosure: c.playbackDisclosure, cta: c.enterPlayback, path: "/match/judge-playback-france-spain-v2", icon: <ShieldCheck className="size-5" />, disabled: false } : mode === "loading" ? { body: c.experienceChecking, disclosure: c.checkingDisclosure, cta: c.checking, path: "/matches", icon: <Clock3 className="size-5" />, disabled: true } : { body: c.experienceCatalog, disclosure: c.unavailableDisclosure, cta: c.openMatches, path: "/matches", icon: <CalendarDays className="size-5" />, disabled: false };
    return <section aria-labelledby="experience-vira-live" className="grid gap-8 py-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:py-20"><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.18em] text-primary">{c.experienceEyebrow}</p><h2 id="experience-vira-live" className="mt-5 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.7rem,6vw,6.2rem)] font-black uppercase leading-[.84]">{c.experienceTitle}</h2><p className="mt-6 max-w-2xl text-sm leading-6 text-white/52">{config.body}</p><p className="mt-4 inline-flex items-center gap-2 font-['DM_Mono'] text-[8px] font-bold uppercase text-white/38">{config.icon}{config.disclosure}</p></div><button type="button" disabled={config.disabled} onClick={() => onGo(config.path)} className="inline-flex min-h-16 items-center justify-center gap-4 bg-primary px-7 font-['Chakra_Petch'] text-xs font-black uppercase text-[#050814] disabled:cursor-wait disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{config.cta}<ArrowRight className="size-5" /></button></section>;
  }
}

function ActShell({ index, label, value, active = false, children }: { index: string; label: string; value: string; active?: boolean; children: React.ReactNode }) { return <section className="relative border-b border-white/10 pl-10 lg:pl-16"><div className={`absolute left-0 top-12 z-10 grid size-6 place-items-center rounded-full border bg-[#050814] font-['DM_Mono'] text-[7px] font-black lg:left-2 lg:size-7 ${active ? "border-primary text-primary shadow-[0_0_18px_rgb(199_255_24_/_35%)] motion-safe:animate-pulse" : "border-white/25 text-white/55"}`}>{index}</div><div className="flex flex-wrap items-center justify-between gap-2 pt-8"><p className="font-['DM_Mono'] text-[8px] font-black uppercase tracking-[.18em] text-white/45">{label}</p><p className="font-['DM_Mono'] text-[8px] font-bold uppercase text-primary">{value}</p></div>{children}</section>; }
function Countdown({ value }: { value: NonNullable<ReturnType<typeof countdownParts>> }) { const { formatNumber, locale } = useLocale(); const units = locale === "pt-BR" ? ["d", "h", "min", "s"] : ["d", "h", "m", "s"]; return <div aria-label={`${value.days}${units[0]} ${value.hours}${units[1]} ${value.minutes}${units[2]} ${value.seconds}${units[3]}`} className="mt-2 flex gap-3 font-['Chakra_Petch'] text-2xl font-black tabular-nums text-primary">{[value.days, value.hours, value.minutes, value.seconds].map((item, index) => <span key={units[index]}>{formatNumber(item, { minimumIntegerDigits: 2 })}<small className="ml-0.5 text-[.38em] text-white/40">{units[index]}</small></span>)}</div>; }
function Info({ label, value, context, meta, strong = false }: { label: string; value: string; context?: string; meta?: string; strong?: boolean }) { return <div className="mt-5 first:mt-0"><p className="font-['DM_Mono'] text-[8px] font-bold uppercase text-white/42">{label}</p>{context ? <p className="mt-1 text-[11px] text-white/52">{context}</p> : null}<p className={`mt-1 font-['Chakra_Petch'] font-black uppercase ${strong ? "text-4xl text-primary" : "text-sm text-white/82"}`}>{value}</p>{meta ? <p className="mt-1 font-['DM_Mono'] text-[8px] uppercase text-white/32">{meta}</p> : null}</div>; }
function Meta({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) { return <div><dt className="flex items-center gap-2 font-['DM_Mono'] text-[8px] uppercase text-white/38">{icon}{label}</dt><dd className="mt-1 font-['DM_Mono'] text-[9px] font-bold uppercase text-white/70">{value}</dd></div>; }
function Authority({ icon, value }: { icon: React.ReactNode; value: string }) { return <p className="flex items-center gap-3 font-['DM_Mono'] text-[8px] font-bold uppercase text-white/40">{icon}{value}</p>; }

function presentationStatusLabel(status: HomeFixturePresentationState, c: typeof copy.en | typeof copy["pt-BR"]) { if (status === "upcoming") return c.scheduled; if (status === "awaiting_official_state") return c.awaitingOfficial; return c[status as keyof Pick<typeof c, "live" | "paused" | "finished" | "postponed" | "cancelled" | "unknown">] ?? c.unknown; }
function cardStatus(status: ViraPicksCardV1["status"], c: typeof copy.en | typeof copy["pt-BR"]) { return status === "partially_resolved" ? c.partiallyResolved : c[status as "confirmed" | "locked" | "resolved" | "void"]; }
function personalStateLabel(status: HomeFixturePresentationState, canCreate: boolean, tournamentComplete: boolean, c: typeof copy.en | typeof copy["pt-BR"]) { if (tournamentComplete || status === "finished") return c.journeyArchive; if (["live", "paused"].includes(status)) return c.matchUnderway; if (canCreate) return c.choiceOpen; return c.noActivePick; }
function fixtureTitle(status: HomeFixturePresentationState, home: string, away: string, c: typeof copy.en | typeof copy["pt-BR"]) { if (status === "live") return c.liveTitle(home, away); if (status === "paused") return c.pausedTitle(home, away); if (status === "finished") return c.finishedTitle(home, away); if (status === "postponed") return c.postponedTitle(home, away); if (status === "cancelled") return c.cancelledTitle(home, away); if (status === "awaiting_official_state") return c.awaitingTitle(home, away); if (status === "unknown") return c.unknownTitle(home, away); return c.nextTitle(home, away); }
function nextEventCopy(status: HomeFixturePresentationState, c: typeof copy.en | typeof copy["pt-BR"]) { if (status === "live") return c.nextLive; if (status === "paused") return c.nextPaused; if (status === "finished") return c.nextFinished; if (status === "awaiting_official_state") return c.nextAwaiting; if (["postponed", "cancelled", "unknown"].includes(status)) return c.nextExceptional; return c.nextScheduled; }
function selectionLabel(selection: "home" | "draw" | "away", fixture: HomeNarrativeFixture["projection"]["fixture"], c: typeof copy.en | typeof copy["pt-BR"], teamName: (name: string) => string) { return selection === "home" ? teamName(fixture.homeTeam.name) : selection === "away" ? teamName(fixture.awayTeam.name) : c.values.draw; }
function pickValue(selection: ViraPickSelectionV1, narrative: HomeNarrativeFixture | null, c: typeof copy.en | typeof copy["pt-BR"], teamName: (name: string) => string) { if (selection.kind === "match_result" && narrative) return selectionLabel(selection.selection, narrative.projection.fixture, c, teamName); if (selection.kind === "total_goals") return c.values[selection.selection]; return c.values[selection.selection]; }
