import { Signal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { MatchCatalogEntry, MatchSummary, MatchTxlineContext, TxlineProbeKind, TxlineProbeResult } from "../../runtime/api";
import { fetchMatchCatalog, fetchTxlineProbe } from "../../runtime/api";
import { AppShell } from "../../shared/shell/AppShell";
import { ViraLoader } from "../../shared/brand/ViraLoader";
import { useShellExperience } from "../../app/shell/ShellContext";
import { openOfficialReview } from "../../app/shell/shell-events";
import { FeaturedMatchStage } from "./FeaturedMatchStage";
import { FixtureAgenda } from "./FixtureAgenda";
import { createFeaturedMatchModel } from "./featured-match-model";
import { selectCatalogMatch, selectSuggestedMatch } from "./fixture-selection";
import { TxlineTechnicalInspector } from "./TxlineTechnicalInspector";
import { TxlineVerificationRail } from "./TxlineVerificationRail";
import { fixtureAccent, useShellAtmosphere } from "../../app/shell/use-shell-atmosphere";
import { useLocale } from "../../i18n/locale-context.tsx";
import { competitionDisplayName } from "../../i18n/semantic-copy.ts";

export function LobbyScreen() {
  const navigate = useNavigate();
  const { t, localizedHref } = useLocale();
  const shell = useShellExperience();
  const [matches, setMatches] = useState<MatchCatalogEntry[]>([]);
  const [source, setSource] = useState<"txline">("txline");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [fixtureContexts, setFixtureContexts] = useState<Record<string, MatchTxlineContext | null>>({});
  const [fixtureContextStates, setFixtureContextStates] = useState<Record<string, "loading" | "ready" | "error">>({});
  const [probeKind, setProbeKind] = useState<TxlineProbeKind>("scores");
  const [probeState, setProbeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [probe, setProbe] = useState<TxlineProbeResult | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [competitionFilter, setCompetitionFilter] = useState("world_cup");
  const manuallySelectedMatchId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const applyCatalog = (response: Awaited<ReturnType<typeof fetchMatchCatalog>>) => {
        if (cancelled) return;
        const nextMatches = response.matches;
        setMatches(nextMatches);
        setSource(response.source);
        setSelectedMatchId((current) => selectCatalogMatch(nextMatches, current, response.featuredFixtureId, manuallySelectedMatchId.current));
        setFixtureContexts(Object.fromEntries(response.matches.map((match) => [match.fixtureId, match.context])));
        setFixtureContextStates(Object.fromEntries(response.matches.map((match) => [match.fixtureId, match.availability.contextStatus === "unavailable" ? "error" : "ready"])));
        setLoadState("ready");
    };
    const loadCatalog = (initial = false) => void fetchMatchCatalog().then(applyCatalog).catch(() => {
        if (cancelled) return;
        if (initial) {
          setLoadState("error");
          setSelectedMatchId(null);
        }
      });
    loadCatalog(true);
    const interval = window.setInterval(() => loadCatalog(false), 15_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadCatalog(false);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const competitionFilters = useMemo(() => Array.from(new Map(matches.map((match) => [match.competition?.canonicalCompetitionId ?? `label:${match.competitionLabel}`, { id: match.competition?.canonicalCompetitionId ?? `label:${match.competitionLabel}`, label: competitionDisplayName(t, match), kind: match.competition?.kind ?? "unknown" }])).values()), [matches, t]);
  const activeCompetitionId = competitionFilter === "world_cup" && !competitionFilters.some((item) => item.kind === "world_cup") ? "all" : competitionFilter;
  const visibleMatches = useMemo(() => activeCompetitionId === "all" ? matches : matches.filter((match) => activeCompetitionId === "world_cup" ? match.competition?.kind === "world_cup" : (match.competition?.canonicalCompetitionId ?? `label:${match.competitionLabel}`) === activeCompetitionId), [activeCompetitionId, matches]);
  const selectedMatch = useMemo(
    () => visibleMatches.find((match) => match.fixtureId === selectedMatchId) ?? selectSuggestedMatch(visibleMatches),
    [selectedMatchId, visibleMatches],
  );
  const selectedContext = selectedMatch ? fixtureContexts[selectedMatch.fixtureId] ?? null : null;
  const contextState: "idle" | "loading" | "ready" | "error" = selectedMatch
    ? fixtureContextStates[selectedMatch.fixtureId] ?? "loading"
    : "idle";
  const featuredModel = useMemo(
    () => selectedMatch ? createFeaturedMatchModel(selectedMatch, selectedContext, contextState) : null,
    [contextState, selectedContext, selectedMatch],
  );
  useShellAtmosphere("route:lobby", {
    atmosphere: "idle",
    context: "discovery",
    fixtureId: selectedMatch?.fixtureId,
    homeAccent: selectedMatch ? fixtureAccent(selectedMatch.homeTeam, "home") : undefined,
    awayAccent: selectedMatch ? fixtureAccent(selectedMatch.awayTeam, "away") : undefined,
    fixtureFocus: selectedMatch ? .25 : .08,
    priority: 10,
  });

  useEffect(() => {
    setProbe(null);
    setProbeState("idle");
  }, [selectedMatchId]);

  const runProbe = async (kind: TxlineProbeKind) => {
    if (!selectedMatch) return;
    setProbeKind(kind);
    setProbeState("loading");
    try {
      const result = await fetchTxlineProbe(kind, selectedMatch.fixtureId);
      setProbe(result);
      setProbeState(result.ok ? "ready" : "error");
    } catch {
      setProbe(null);
      setProbeState("error");
    }
  };

  const openPreview = (fixtureId?: string) => {
    const targetId = fixtureId ?? selectedMatch?.fixtureId;
    if (!targetId) return;
    const path = localizedHref(`/match/${targetId}/preview`);
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };
    if (transitionDocument.startViewTransition) {
      transitionDocument.startViewTransition(() => navigate(path));
      return;
    }
    navigate(path);
  };

  return (
    <AppShell>
      <main className="relative overflow-hidden">
        <EditorialGrid />

        <section className="relative mx-auto max-w-7xl px-4 pb-12 pt-7 lg:pb-16 lg:pt-10">
          <div className="mb-7 flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <span className="size-2 rounded-full bg-primary shadow-[0_0_18px_rgba(202,255,40,.8)]" />
              <span className="font-['DM_Mono'] text-[10px] uppercase text-primary">{t("lobby.liveData")}</span>
            </div>

            <span className="inline-flex items-center gap-2 font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">
              <Signal className={source === "txline" ? "size-4 text-primary" : "size-4"} />
              {matches.length ? t("lobby.fixtureCount", { count: matches.length }) : "--"}
            </span>
          </div>

          {loadState === "loading" ? (
            <div className="grid min-h-[60vh] place-items-center">
              <ViraLoader label={t("lobby.loading")} />
            </div>
          ) : null}

          {loadState === "error" ? (
            <div className="grid min-h-[60vh] place-items-center text-sm text-destructive">
              {t("lobby.error")}
            </div>
          ) : null}

          {loadState === "ready" && selectedMatch ? (
            <>
              <nav aria-label={t("lobby.filterLabel")} className="mb-7 flex gap-2 overflow-x-auto pb-2"><button type="button" onClick={() => { manuallySelectedMatchId.current = null; setCompetitionFilter("all"); setSelectedMatchId(null); }} aria-pressed={activeCompetitionId === "all"} className={`min-h-10 shrink-0 border px-4 font-['DM_Mono'] text-[9px] font-black uppercase ${activeCompetitionId === "all" ? "border-primary bg-primary text-[#050814]" : "border-white/15 text-white/50"}`}>{t("lobby.filterAll")}</button>{competitionFilters.map((competition) => <button key={competition.id} type="button" onClick={() => { manuallySelectedMatchId.current = null; setCompetitionFilter(competition.kind === "world_cup" ? "world_cup" : competition.id); setSelectedMatchId(null); }} aria-pressed={activeCompetitionId === competition.id || (activeCompetitionId === "world_cup" && competition.kind === "world_cup")} className={`min-h-10 shrink-0 border px-4 font-['DM_Mono'] text-[9px] font-black uppercase ${(activeCompetitionId === competition.id || (activeCompetitionId === "world_cup" && competition.kind === "world_cup")) ? "border-primary bg-primary text-[#050814]" : "border-white/15 text-white/50"}`}>{competition.label}</button>)}</nav>
              {featuredModel ? <FeaturedMatchStage model={featuredModel} onOpen={() => openPreview()} /> : null}

              <FixtureAgenda
                matches={visibleMatches}
                selectedId={selectedMatch.fixtureId}
                selectedContext={selectedContext}
                contexts={fixtureContexts}
                contextStates={fixtureContextStates}
                onSelect={(fixtureId) => { manuallySelectedMatchId.current = fixtureId; setSelectedMatchId(fixtureId); }}
                onOpen={openPreview}
              />

              <TxlineVerificationRail
                signalCount={featuredModel?.signalCount ?? 0}
                reviewAvailable={shell.review.kind === "available"}
                onOpenReview={openOfficialReview}
                onOpenInspector={() => setTechnicalOpen(true)}
              />
              <TxlineTechnicalInspector open={technicalOpen} selectedMatch={selectedMatch} probeKind={probeKind} probeState={probeState} probe={probe} onClose={() => setTechnicalOpen(false)} onRunProbe={(kind) => void runProbe(kind)} />
            </>
          ) : null}
        </section>
      </main>
    </AppShell>
  );
}

function EditorialGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-55"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.025) 1px, transparent 1px)",
        backgroundSize: "150px 100%, 100% 88px",
      }}
    />
  );
}
