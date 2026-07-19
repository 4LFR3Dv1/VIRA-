import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Eye,
  Radio,
  ShieldCheck,
  Trophy,
  UserRound,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import type { MatchCatalogEntry, MatchTxlineContext, TxlineAvailableMarket } from "../../runtime/api";
import { fetchMatchCatalog, fetchMatchTxlineContext, fetchPublicRoomProjection, fetchRoomVerification } from "../../runtime/api";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { ViraLoader } from "../../shared/brand/ViraLoader";
import { AppShell } from "../../shared/shell/AppShell";
import { TeamIcon } from "../../shared/team/team-icons";
import { JoinRoomDialog } from "../lobby/JoinRoomDialog";
import { deriveCanonicalExperienceState } from "../match-experience/state-model";
import { PredictionSharePanel } from "../../social/PredictionSharePanel";
import { fixtureAccent, useShellAtmosphere } from "../../app/shell/use-shell-atmosphere";
import { useLocale } from "../../i18n/locale-context.tsx";
import type { StaticTranslationKey, TranslateFunction } from "../../i18n/translate.ts";
import { competitionDisplayName } from "../../i18n/semantic-copy.ts";
import { VIRA_PICKS_ENABLED } from "../picks/feature-flags.ts";
import { fetchOwnerPicks } from "../picks/api.ts";
import { fetchTournamentJourney, type TournamentJourneyFixture } from "../../social/share";
import { canonicalMarketSelectionLabel } from "../../../shared/canonical-market-copy.mjs";

type ContextState = "idle" | "loading" | "ready" | "empty" | "error";
type FinishedCapabilities = { room: boolean; ranking: boolean; verifiedRounds: boolean; picks: boolean };
const CONTEXT_CACHE_TTL_MS = 60_000;
const roomStateKeys = { closed: "state.room.closed", open: "state.room.open", finished: "state.room.finished" } as const satisfies Record<string, StaticTranslationKey>;

function contextCacheKey(fixtureId: string) {
  return `vira:txline-context:${fixtureId}`;
}

function readCachedContext(fixtureId: string): MatchTxlineContext | null {
  try {
    const raw = window.sessionStorage.getItem(contextCacheKey(fixtureId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; context: MatchTxlineContext };
    if (!parsed.context || Date.now() - parsed.savedAt > CONTEXT_CACHE_TTL_MS) return null;
    return parsed.context;
  } catch {
    return null;
  }
}

function writeCachedContext(fixtureId: string, context: MatchTxlineContext) {
  try {
    window.sessionStorage.setItem(contextCacheKey(fixtureId), JSON.stringify({ savedAt: Date.now(), context }));
  } catch {
    // The cache is optional.
  }
}

function marketTitle(market: TxlineAvailableMarket, t: TranslateFunction) {
  if (market.marketType === "1X2_PARTICIPANT_RESULT") return t("preview.market.result");
  if (market.marketType === "OVERUNDER_PARTICIPANT_GOALS") return t("preview.market.totalGoals");
  if (market.marketType === "ASIANHANDICAP_PARTICIPANT_GOALS") return t("preview.market.goalHandicap");
  return market.label || market.marketType.replaceAll("_", " ").toLowerCase();
}

function marketSubtitle(market: TxlineAvailableMarket, t: TranslateFunction) {
  const raw = market.marketParameters ?? "";
  const line = raw.match(/(?:^|[,;\s])line=(-?\d+(?:\.\d+)?)/i)?.[1] ?? null;
  const half = raw.match(/(?:^|[,;\s])half=(\d+)/i)?.[1] ?? null;
  const period = half === "1" || market.marketPeriod === "half=1"
    ? t("preview.market.firstHalf")
    : half === "2" || market.marketPeriod === "half=2"
      ? t("preview.market.secondHalf")
      : t("preview.market.fullMatch");
  return [line ? t("preview.market.line", { line }) : null, period].filter(Boolean).join(" · ");
}

function canonicalMarketOptionLabel(option: TxlineAvailableMarket["options"][number], match: MatchCatalogEntry | null, locale: "en" | "pt-BR", t: TranslateFunction, teamName: (name: string) => string) {
  return canonicalMarketSelectionLabel(option.priceName, { locale, homeTeam: match ? teamName(match.homeTeam) : null, awayTeam: match ? teamName(match.awayTeam) : null }) ?? t("common.unavailable");
}

function strongestMarketValue(market: TxlineAvailableMarket, match: MatchCatalogEntry | null, locale: "en" | "pt-BR", t: TranslateFunction, teamName: (name: string) => string) {
  const option = market.leadingOption ?? market.options.reduce<TxlineAvailableMarket["options"][number] | null>((leading, item) => {
    if (item.pct === null) return leading;
    return !leading || leading.pct === null || item.pct > leading.pct ? item : leading;
  }, null);
  return option?.pct == null ? null : { label: canonicalMarketOptionLabel(option, match, locale, t, teamName), value: option.pct };
}

function TeamHeading({ name, side }: { name: string; side: "home" | "away" }) {
  const { teamName } = useLocale();
  return (
    <div className={`min-w-0 ${side === "away" ? "text-right" : "text-left"}`}>
      <div className={`mb-4 flex ${side === "away" ? "justify-end" : "justify-start"}`}>
        <TeamIcon name={name} side={side} size="lg" />
      </div>
      <p style={{ viewTransitionName: side === "home" ? "home-team" : "away-team" } as CSSProperties} className="break-words font-['Chakra_Petch'] text-[clamp(1.75rem,4.8vw,4.75rem)] font-black uppercase leading-[.88] text-white">
        {teamName(name)}
      </p>
    </div>
  );
}

function Principle({ number, icon, title, children }: { number: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <article className="min-h-64 border-b border-white/15 p-7 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 lg:p-10">
      <div className="flex items-center justify-between text-primary">
        <span className="font-['DM_Mono'] text-xs font-bold">{number}</span>
        {icon}
      </div>
      <h3 className="mt-16 font-['Chakra_Petch'] text-3xl font-black uppercase leading-none">{title}</h3>
      <p className="mt-4 max-w-sm text-sm leading-6 text-white/50">{children}</p>
    </article>
  );
}

function FootballPrompt({ label, prompt }: { label: string; prompt: string }) {
  return <article className="min-h-40 bg-[#0a0e1a] p-5 sm:p-6"><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.16em] text-primary">{label}</p><h3 className="mt-8 font-['Chakra_Petch'] text-xl font-black uppercase leading-[.95]">{prompt}</h3></article>;
}

function archivedJourneyMatch(item: TournamentJourneyFixture | undefined): MatchCatalogEntry | null {
  const projection = item?.fixture;
  if (!item || !projection) return null;
  const fixture = projection.fixture;
  return {
    id: fixture.fixtureId,
    fixtureId: fixture.fixtureId,
    title: `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`,
    competitionLabel: fixture.competition.displayName,
    competition: fixture.competition,
    startTime: fixture.kickoffAt,
    status: fixture.status,
    homeTeam: fixture.homeTeam.name,
    awayTeam: fixture.awayTeam.name,
    homeScore: item.result?.homeScore,
    awayScore: item.result?.awayScore,
    source: "txline-journey-archive",
    archiveResultAuthority: item.result?.authority,
    consumerProjection: projection,
    context: null,
    availability: {
      marketCount: 0,
      observedMarketCount: 0,
      focusMarketCount: 0,
      canonical1X2Available: Boolean(projection.market.canonical1X2),
      hasMarket: false,
      hasPlayablePrediction: false,
      ...projection.availability,
      contextStatus: "unavailable",
    },
  };
}

function FinishedMatchPreview({ match, context }: { match: MatchCatalogEntry; context: MatchTxlineContext | null }) {
  const { locale, localizedHref, t, teamName } = useLocale();
  const [capabilities, setCapabilities] = useState<FinishedCapabilities>({ room: false, ranking: false, verifiedRounds: false, picks: false });
  useEffect(() => {
    let active = true;
    const room = fetchPublicRoomProjection(match.fixtureId).catch(() => null);
    const verification = fetchRoomVerification(match.fixtureId).catch(() => null);
    const picks = VIRA_PICKS_ENABLED ? fetchOwnerPicks(match.fixtureId, locale).catch(() => ({ card: null })) : Promise.resolve({ card: null });
    void Promise.all([room, verification, picks]).then(([projection, proof, owner]) => {
      if (!active) return;
      const resolvedRound = Boolean(projection?.lastResolution || projection?.evidenceHistory.some((item) => item.resolution));
      setCapabilities({
        room: Boolean(projection),
        ranking: Boolean(projection?.leaderboard.length),
        verifiedRounds: Boolean(projection && resolvedRound && proof?.status === "verified" && proof.hashChainValid && proof.replaySucceeded),
        picks: Boolean(owner.card),
      });
    });
    return () => { active = false; };
  }, [locale, match.fixtureId]);
  const score = context?.fixtureState?.score ?? {
    home: Number.isFinite(Number(match.homeScore)) ? Number(match.homeScore) : null,
    away: Number.isFinite(Number(match.awayScore)) ? Number(match.awayScore) : null,
  };
  const scoreAvailable = typeof score.home === "number" && typeof score.away === "number";
  const capabilityCopy = locale === "pt-BR" ? {
    description: capabilities.verifiedRounds && capabilities.ranking
      ? "A partida terminou. O placar oficial, o ranking final da sala e as rodadas verificadas continuam disponíveis."
      : capabilities.verifiedRounds
        ? "A partida terminou. O placar oficial e as rodadas verificadas continuam disponíveis na sala final."
        : capabilities.room
          ? "A partida terminou. O placar oficial e a sala final continuam disponíveis."
          : "A partida terminou. O placar oficial e sua autoridade terminal TxLINE continuam disponíveis.",
    archive: capabilities.picks
      ? "Nenhuma nova rodada ou previsão será aberta. Consulte o resultado oficial ou compare seu card VIRA Picks."
      : capabilities.room
        ? "Nenhuma nova rodada ou previsão será aberta. Consulte o resultado oficial e a sala final preservada."
        : "Nenhuma nova rodada ou previsão será aberta. Este arquivo preserva o resultado oficial da partida.",
  } : {
    description: capabilities.verifiedRounds && capabilities.ranking
      ? "The match is over. The official score, final room ranking and verified rounds remain available."
      : capabilities.verifiedRounds
        ? "The match is over. The official score and verified rounds remain available in the final room."
        : capabilities.room
          ? "The match is over. The official score and final room remain available."
          : "The match is over. The official score and its TxLINE terminal authority remain available.",
    archive: capabilities.picks
      ? "No new rounds or predictions will open. Review the official result or compare your VIRA Picks card."
      : capabilities.room
        ? "No new rounds or predictions will open. Review the official result and the preserved final room."
        : "No new rounds or predictions will open. This archive preserves the official match result.",
  };

  return <AppShell><main className="min-h-[calc(100vh-68px)] overflow-hidden bg-[#070a13]/55 text-white">
    <section className="relative isolate border-b border-white/15">
      <div aria-hidden className="absolute inset-0 -z-10 grid grid-cols-2 opacity-80"><div className="bg-[linear-gradient(135deg,#263d20_0%,#101a17_56%,#070a13_100%)]" /><div className="bg-[linear-gradient(225deg,#24335c_0%,#11172a_56%,#070a13_100%)]" /></div>
      <div aria-hidden className="absolute inset-0 -z-10 bg-[url('/textures/vira-carbon.webp')] bg-[length:640px_640px] opacity-[.09] mix-blend-screen" />
      <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-14 lg:py-20">
        <div className="flex items-center gap-3 text-primary"><Trophy className="size-5" /><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em]">{t("postMatch.eyebrow")}</p></div>
        <h1 className="mt-7 max-w-5xl font-['Chakra_Petch'] text-[clamp(2.8rem,7vw,7rem)] font-black uppercase leading-[.78]">{t("fixture.headline.matchFinished", { homeTeam: teamName(match.homeTeam), awayTeam: teamName(match.awayTeam) })}</h1>
        <p className="mt-7 max-w-2xl text-sm leading-6 text-white/58 md:text-base">{capabilityCopy.description}</p>

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-4 border-y border-white/15 py-8 sm:gap-8">
          <TeamHeading name={match.homeTeam} side="home" />
          <div className="px-2 text-center"><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">{t("postMatch.finalScore")}</p><strong data-testid="finished-score" aria-label={scoreAvailable ? `${t("postMatch.finalScore")} ${score.home}-${score.away}` : t("postMatch.finalScore")} className="mt-3 block font-['Chakra_Petch'] text-[clamp(2.8rem,7vw,6rem)] font-black leading-none">{scoreAvailable ? <><AnimatedNumber value={score.home as number} locales={locale} />-<AnimatedNumber value={score.away as number} locales={locale} /></> : "--"}</strong></div>
          <TeamHeading name={match.awayTeam} side="away" />
        </div>
      </div>
    </section>

    <section className="mx-auto grid max-w-[1440px] gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-14 lg:py-16">
      <div className="border-y border-white/15 py-7"><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">{t("preview.finished.archiveTitle")}</p><h2 className="mt-4 font-['Chakra_Petch'] text-4xl font-black uppercase">{t("preview.finished.official")}</h2><p className="mt-5 max-w-2xl text-sm leading-6 text-white/52">{capabilityCopy.archive}</p><div className="mt-7 flex flex-wrap gap-3">{capabilities.room ? <Link to={localizedHref(`/match/${match.fixtureId}`)} className="inline-flex min-h-14 items-center gap-3 bg-primary px-5 font-['Chakra_Petch'] text-xs font-black uppercase text-[#070a13]">{t("preview.finished.roomCta")}<ArrowRight className="size-4" /></Link> : null}{capabilities.picks ? <Link to={localizedHref(`/picks/${match.fixtureId}`)} className="inline-flex min-h-14 items-center border border-white/25 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary">VIRA Picks</Link> : null}{!capabilities.room && !capabilities.picks ? <Link to={localizedHref("/matches")} className="inline-flex min-h-14 items-center gap-3 bg-primary px-5 font-['Chakra_Petch'] text-xs font-black uppercase text-[#070a13]">{t("preview.backToMatches")}<ArrowRight className="size-4" /></Link> : null}</div></div>
      <aside className="border border-primary/30 bg-primary/[.055] p-6"><ShieldCheck className="size-5 text-primary" /><img src="/txline-logo.svg" alt="TxLINE" className="mt-5 h-4 w-auto opacity-80" /><strong className="mt-4 block font-['Chakra_Petch'] text-2xl font-black uppercase">{t("preview.finished.txlineFinal")}</strong><p className="mt-4 text-xs leading-5 text-white/48">{context?.fixtureState || match.archiveResultAuthority ? t("preview.finished.authorityConfirmed") : t("preview.finished.authorityPending")}</p><Link to={localizedHref("/matches")} className="mt-8 inline-flex items-center gap-2 text-xs font-bold uppercase text-white/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft className="size-4" />{t("preview.backToMatches")}</Link></aside>
    </section>
  </main></AppShell>;
}

export function MatchPreviewScreen() {
  const { matchId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { locale, t, formatDateTime, formatPercent, localizedHref, teamName } = useLocale();
  const [matches, setMatches] = useState<MatchCatalogEntry[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [contextState, setContextState] = useState<ContextState>("idle");
  const [context, setContext] = useState<MatchTxlineContext | null>(null);
  const [playerName, setPlayerName] = useState(() => window.localStorage.getItem("vira:displayName") ?? "");
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [inspectOnJoin, setInspectOnJoin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMatchCatalog().then(async (response) => {
      let nextMatches = response.matches;
      if (!nextMatches.some((item) => item.fixtureId === matchId)) {
        const journey = await fetchTournamentJourney({ locale, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }).catch(() => null);
        const archived = archivedJourneyMatch(journey?.fixtures.find((item) => item.fixtureId === matchId));
        if (archived) nextMatches = [...nextMatches, archived];
      }
      if (!cancelled) { setMatches(nextMatches); setLoadState("ready"); }
    }).catch(() => !cancelled && setLoadState("error"));
    return () => { cancelled = true; };
  }, [locale, matchId]);

  const match = useMemo(() => matches.find((item) => item.fixtureId === matchId) ?? null, [matchId, matches]);
  const projection = match?.consumerProjection ?? null;
  useShellAtmosphere("route:preview", match ? {
    atmosphere: projection?.fixture.status === "finished" ? "finished" : "anticipation",
    context: projection?.fixture.status === "finished" ? "post-match" : "fixture-preview",
    fixtureId: match.fixtureId,
    homeAccent: fixtureAccent(match.homeTeam, "home"),
    awayAccent: fixtureAccent(match.awayTeam, "away"),
    fixtureFocus: .42,
    priority: 20,
  } : null);

  useEffect(() => {
    if (!match) return;
    if (match.archiveResultAuthority) { setContext(null); setContextState("empty"); return; }
    let cancelled = false;
    const cached = readCachedContext(match.fixtureId);
    if (cached) {
      setContext(cached);
      setContextState(cached.availableMarkets.length ? "ready" : "empty");
    } else {
      setContext(null);
      setContextState("loading");
    }
    fetchMatchTxlineContext(match.fixtureId).then((nextContext) => {
      if (cancelled) return;
      writeCachedContext(match.fixtureId, nextContext);
      setContext(nextContext);
      setContextState(nextContext.availableMarkets.length ? "ready" : "empty");
    }).catch(() => !cancelled && setContextState("error"));
    return () => { cancelled = true; };
  }, [match?.fixtureId]);

  const prediction = context?.suggestedPrediction ?? null;
  const probability = projection?.availability.canShowMarket ? projection.market.canonical1X2?.selections ?? null : null;
  const markets = useMemo(() => {
    const all = context?.availableMarkets ?? [];
    return [...all].sort((left, right) => {
      if (left.signature === prediction?.marketSignature) return -1;
      if (right.signature === prediction?.marketSignature) return 1;
      return Number(right.hasProbabilities) - Number(left.hasProbabilities);
    }).slice(0, 5);
  }, [context?.availableMarkets, prediction?.marketSignature]);

  const leadingChoice = projection?.market.canonical1X2?.leadingChoice ?? null;
  const leadingLabel = leadingChoice === "home" ? teamName(match?.homeTeam ?? "") : leadingChoice === "away" ? teamName(match?.awayTeam ?? "") : leadingChoice === "draw" ? t("lobby.draw") : null;
  const leadingOutcomeLabel = leadingLabel && leadingChoice !== "draw" ? t("preview.market.teamToWin", { team: leadingLabel }) : leadingLabel;
  const formatPercentage = (value: number) => formatPercent(value <= 1 ? value : value / 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const currentSignal = probability && leadingChoice && leadingOutcomeLabel
    ? projection?.availability.canMakeDirectionalClaim
      ? t("preview.market.currentValue", { selection: leadingOutcomeLabel, percentage: formatPercentage(probability[leadingChoice]) })
      : t("preview.market.lastValue", { percentage: formatPercentage(probability[leadingChoice]) })
    : t("preview.market.unavailable");
  const signalCount = context?.marketTaxonomy?.observed ?? 0;
  const loadingContext = contextState === "idle" || contextState === "loading";
  const roomReady = projection?.availability.canEnterRoom === true;
  const canonical = deriveCanonicalExperienceState({ matchStatus: projection?.fixture.status, roomExists: roomReady, hasSignal: projection?.availability.canShowMarket === true, connectionState: contextState === "error" ? "reconnecting" : "live" });
  const kickoffLabel = projection?.fixture.kickoffAt ? formatDateTime(projection.fixture.kickoffAt, { timeZone: projection.temporal.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : t("lobby.timeToConfirm");

  const openRoom = (inspect = false) => {
    setInspectOnJoin(inspect);
    setJoinDialogOpen(true);
  };

  const confirmOpenRoom = () => {
    if (!match || !playerName.trim()) return;
    const safeName = playerName.trim();
    window.localStorage.setItem("vira:displayName", safeName);
    window.localStorage.setItem(`vira:${match.fixtureId}:displayName`, safeName);
    const params = new URLSearchParams();
    const inviteCode = searchParams.get("invite");
    if (inviteCode) params.set("invite", inviteCode);
    if (inspectOnJoin) params.set("inspect", "true");
    navigate(localizedHref(`/match/${match.fixtureId}${params.size ? `?${params.toString()}` : ""}`));
  };

  if (loadState === "loading") {
    return <AppShell><main className="grid min-h-[calc(100vh-68px)] place-items-center"><ViraLoader label={t("preview.loading")} /></main></AppShell>;
  }

  if (loadState === "error" || !match) {
    return (
      <AppShell>
        <main className="mx-auto max-w-2xl px-6 py-20">
          <Link to={localizedHref("/matches")} className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-primary"><ArrowLeft className="size-4" /> {t("preview.backToMatches")}</Link>
          <h1 className="mt-8 font-['Chakra_Petch'] text-5xl font-black uppercase">{t("preview.unavailable")}</h1>
          <p className="mt-4 text-white/50">{t("preview.loadError")}</p>
        </main>
      </AppShell>
    );
  }

  if (projection?.fixture.status === "finished" || match.status === "finished") {
    return <FinishedMatchPreview match={match} context={context} />;
  }

  const outcomes = probability ? [
    { id: "home", label: teamName(match.homeTeam), value: probability.home, active: prediction?.priceName === "part1" },
    { id: "draw", label: t("lobby.draw"), value: probability.draw, active: prediction?.priceName === "draw" },
    { id: "away", label: teamName(match.awayTeam), value: probability.away, active: prediction?.priceName === "part2" },
  ] : [];

  return (
    <AppShell>
      <main className="overflow-hidden bg-[#070a13]/55 text-white">
        <section style={{ viewTransitionName: "featured-match" } as CSSProperties} className="relative isolate overflow-hidden border-b border-white/15">
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute inset-0 grid grid-cols-2 opacity-80">
              <div className="bg-[linear-gradient(135deg,#263d20_0%,#101a17_56%,#070a13_100%)]" />
              <div className="bg-[linear-gradient(225deg,#24335c_0%,#11172a_56%,#070a13_100%)]" />
            </div>
            <div className="absolute inset-0 bg-[url('/textures/vira-carbon.webp')] bg-[length:640px_640px] bg-center opacity-[.11] mix-blend-screen [mask-image:linear-gradient(to_bottom,black,rgba(0,0,0,.5))]" />
          </div>
          <div className="absolute inset-y-0 left-1/2 -z-10 w-px rotate-[14deg] bg-white/10" />
          <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-14 lg:py-8">
            <div className="flex flex-wrap items-center justify-end gap-4 border-b border-white/15 pb-4">
              <div className="flex flex-wrap items-center gap-3 font-['DM_Mono'] text-[10px] uppercase text-white/50">
                <span>{competitionDisplayName(t, match)} · {kickoffLabel}</span>
                <span className="inline-flex items-center gap-2 text-primary"><Radio className="size-3.5" /> {loadingContext ? t("preview.syncingTxline") : projection?.availability.canShowMarket ? t("preview.marketObserved") : t("preview.waitingEligibleMarket")}</span>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 sm:gap-8 lg:mt-10">
              <TeamHeading name={match.homeTeam} side="home" />
              <span className="pb-2 font-['DM_Mono'] text-xs font-black text-primary sm:pb-5">VS</span>
              <TeamHeading name={match.awayTeam} side="away" />
            </div>

            <div className="mt-8 border-t border-white/15 pt-5 lg:mt-10">
              <p className="font-['DM_Mono'] text-[10px] font-bold uppercase text-white/45">{projection?.availability.canMakeDirectionalClaim ? t("preview.market.currentLeader") : projection?.availability.canShowMarket ? t("preview.market.lastObserved") : t("preview.market.context")}</p>
              {projection?.availability.canMakeDirectionalClaim ? <p className="mt-1 text-xs text-white/52">{t("preview.market.regularTimeResult")}</p> : null}
              <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-10">
                <h1 style={{ viewTransitionName: "market-value" } as CSSProperties} className="max-w-3xl font-['Chakra_Petch'] text-[clamp(1.8rem,3.4vw,3.6rem)] font-black uppercase leading-[.9]">
                  {loadingContext && !context ? t("preview.market.reading") : currentSignal}
                </h1>
                <p className="max-w-sm text-sm leading-6 text-white/50 lg:pb-0.5">{t("preview.market.explanation")}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1440px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-14 lg:py-24">
          <div className="min-w-0">
            <p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("preview.challenges.kicker")}</p>
            <h2 className="mt-5 max-w-5xl break-words font-['Chakra_Petch'] text-[clamp(2.15rem,4.8vw,5rem)] font-black uppercase leading-[.9]">{t("preview.challenges.title")}</h2>
            <p className="mt-6 max-w-3xl text-base leading-7 text-white/55">{t("preview.challenges.description")}</p>

            <p className="mt-10 font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.16em] text-white/35">{t("preview.challenges.examples")}</p><div className="mt-3 grid gap-px bg-white/15 sm:grid-cols-3">
              <FootballPrompt label={t("preview.prompt.goalLabel")} prompt={t("preview.prompt.teamScores", { team: teamName(match.homeTeam), minutes: 10 })} />
              <FootballPrompt label={t("preview.prompt.shotLabel")} prompt={t("preview.prompt.teamShot", { team: teamName(match.awayTeam), minutes: 5 })} />
              <FootballPrompt label={t("preview.prompt.momentLabel")} prompt={t("preview.prompt.goalBeforePeriodEnd")} />
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#pre-match-prediction" className="inline-flex min-h-14 items-center border border-white/20 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary">{t("preview.predictBeforeMatch")}</a>
              {VIRA_PICKS_ENABLED ? <Link to={localizedHref(`/picks/${match.fixtureId}`)} className="inline-flex min-h-14 items-center gap-3 bg-primary px-5 font-['Chakra_Petch'] text-xs font-black uppercase text-[#070a13]">VIRA Picks <ArrowRight className="size-4" /></Link> : null}
            </div>
          </div>

          <aside className="self-start border border-primary/35 bg-primary/[.055] p-6 lg:sticky lg:top-24">
            <div className="flex items-center justify-between text-primary"><p className="font-['DM_Mono'] text-[10px] font-black uppercase">{t(roomStateKeys[canonical.room])}</p><Zap className="size-4" /></div>
            <h3 className="mt-5 font-['Chakra_Petch'] text-3xl font-black uppercase leading-[.9]">{t("preview.enterFixture", { homeTeam: teamName(match.homeTeam), awayTeam: teamName(match.awayTeam) })}</h3>
            <dl className="mt-8 divide-y divide-white/15 border-y border-white/15 text-sm">
              {[[t("preview.participants"), t("preview.realPeople")], [t("preview.answer"), t("preview.onePerMoment")], [t("preview.resolution"), t("preview.officialFacts")]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-4"><dt className="text-white/40">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}
            </dl>
            <button type="button" disabled={!roomReady} onClick={() => openRoom(false)} className="mt-6 flex min-h-14 w-full items-center justify-between bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-[#070a13] disabled:opacity-40">{t("preview.enterRoom")} <ArrowRight className="size-4" /></button>
            <button type="button" onClick={() => openRoom(true)} className="mt-3 flex w-full items-center justify-center gap-2 py-3 text-xs font-bold uppercase text-white/45 hover:text-white"><Eye className="size-4" /> {t("preview.viewReview")}</button>
          </aside>
        </section>

        <PredictionSharePanel fixture={match} projection={match.consumerProjection} displayName={playerName} onChangeDisplayName={setPlayerName} />

        <section className="border-y border-white/15 bg-[#0a0e1a]">
          <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-14">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">{t("preview.marketSignal")}</p><h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase">{t("preview.distribution1X2")}</h2></div>
              <span className="font-['DM_Mono'] text-[10px] uppercase text-white/35">{t("preview.txlineRecord")}</span>
            </div>
            {outcomes.length ? <div className="mt-8 flex min-h-24 overflow-hidden border border-white/10">{outcomes.map((outcome) => <div key={outcome.id} style={{ width: `${Math.max(15, outcome.value)}%` }} className={`relative min-w-[86px] border-r border-[#070a13] p-3 last:border-r-0 ${outcome.active ? "bg-primary text-[#070a13]" : "bg-white/[.07]"}`}><span className="block truncate text-[10px] font-black uppercase">{outcome.label}</span><strong className="absolute bottom-3 left-3 font-['Chakra_Petch'] text-2xl font-black"><AnimatedNumber value={outcome.value} locales={locale} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></strong></div>)}</div> : <p className="mt-8 border-t border-white/15 py-8 text-sm text-white/45">{t("preview.waitingDistribution")}</p>}
            <p className="mt-5 font-['DM_Mono'] text-[10px] uppercase text-white/35">{t("preview.marketFocusSummary", { focusCount: markets.length, observedCount: signalCount })}</p>
          </div>
        </section>

        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-14 lg:py-24">
          <p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("preview.monitoredMarkets")}</p>
          <h2 className="mt-3 font-['Chakra_Petch'] text-4xl font-black uppercase">{t("preview.roundDirectorContext")}</h2>
          <div className="mt-8 border-t border-white/15">
            {markets.length ? markets.map((market, index) => {
              const strongest = strongestMarketValue(market, match, locale, t, teamName);
              return <div key={market.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-4 border-b border-white/15 py-6 transition hover:bg-white/[.025] sm:grid-cols-[48px_minmax(0,1fr)_180px]"><span className="font-['DM_Mono'] text-xs text-white/30">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><p className="truncate font-['Chakra_Petch'] font-black uppercase">{marketTitle(market, t)}</p><p className="mt-1 truncate text-sm text-white/40">{marketSubtitle(market, t)}</p></div><div className="text-right"><strong className="block truncate text-sm text-primary sm:text-lg">{strongest ? `${strongest.label} ${formatPercentage(strongest.value)}` : t("preview.market.waiting")}</strong><span className="font-['DM_Mono'] text-[9px] uppercase text-white/30">{market.signature === prediction?.marketSignature ? t("preview.market.active") : market.sourceEndpoint.includes("updates") ? t("preview.market.updated") : t("preview.market.available")}</span></div></div>;
            }) : <p className="border-b border-white/15 py-8 text-sm text-white/45">{t("preview.market.noneEligible")}</p>}
          </div>
        </section>

        <section className="border-y border-white/15 bg-[#0a0e1a]">
          <div className="mx-auto grid max-w-[1440px] md:grid-cols-3">
            <Principle number="01" icon={<Database className="size-4" />} title={t("preview.principle.realData.title")}>{t("preview.principle.realData.description")}</Principle>
            <Principle number="02" icon={<UserRound className="size-4" />} title={t("preview.principle.realPeople.title")}>{t("preview.principle.realPeople.description")}</Principle>
            <Principle number="03" icon={<ShieldCheck className="size-4" />} title={t("preview.principle.noBet.title")}>{t("preview.principle.noBet.description")}</Principle>
          </div>
        </section>

        <section className="mx-auto flex max-w-[1440px] flex-col gap-7 px-5 py-14 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-14">
          <div className="flex items-start gap-4"><span aria-hidden className="flex h-10 w-28 shrink-0 items-center justify-center border border-primary/30 bg-white/[.025] px-3"><img src="/txline-logo.svg" alt="" className="h-4 w-auto opacity-90" /></span><div><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">{t("preview.verifiedByTxline")}</p><p className="mt-2 max-w-xl text-sm leading-6 text-white/45">{t("preview.auditDescription")}</p></div></div>
          <button type="button" onClick={() => openRoom(true)} className="inline-flex min-h-12 items-center justify-between gap-8 border border-white/20 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary">{t("preview.openReview")} <Eye className="size-4" /></button>
        </section>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/15 bg-[#070a13]/95 p-3 backdrop-blur md:hidden">
          <button type="button" disabled={!roomReady} onClick={() => openRoom(false)} className="flex min-h-13 w-full items-center justify-between bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-[#070a13] disabled:opacity-40">{t("preview.enterRoom")} <ArrowRight className="size-4" /></button>
        </div>
      </main>

      <JoinRoomDialog open={joinDialogOpen} subtitle={`${teamName(match.homeTeam)} × ${teamName(match.awayTeam)}`} name={playerName} onChangeName={setPlayerName} onClose={() => setJoinDialogOpen(false)} onConfirm={confirmOpenRoom} />
    </AppShell>
  );
}
