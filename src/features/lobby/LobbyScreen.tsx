import { Signal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import type { MatchSummary, MatchTxlineContext, TxlineProbeKind, TxlineProbeResult } from "../../runtime/api";
import { fetchMatchCatalog, fetchTxlineProbe } from "../../runtime/api";
import { AppShell } from "../../shared/shell/AppShell";
import { ViraLoader } from "../../shared/brand/ViraLoader";
import { useShellExperience } from "../../app/shell/ShellContext";
import { openOfficialReview } from "../../app/shell/shell-events";
import { FeaturedMatchStage } from "./FeaturedMatchStage";
import { FixtureAgenda } from "./FixtureAgenda";
import { createFeaturedMatchModel } from "./featured-match-model";
import { TxlineTechnicalInspector } from "./TxlineTechnicalInspector";
import { TxlineVerificationRail } from "./TxlineVerificationRail";

function selectSuggestedMatch(matches: MatchSummary[]) {
  return (
    matches.find((match) => match.competitionLabel.toLowerCase().includes("world cup") && match.status.toLowerCase().includes("live"))
    ?? matches.find((match) => match.competitionLabel.toLowerCase().includes("world cup"))
    ?? matches.find((match) => match.status.toLowerCase().includes("live"))
    ?? matches[0]
    ?? null
  );
}

export function LobbyScreen() {
  const navigate = useNavigate();
  const shell = useShellExperience();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [source, setSource] = useState<"txline">("txline");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [fixtureContexts, setFixtureContexts] = useState<Record<string, MatchTxlineContext | null>>({});
  const [fixtureContextStates, setFixtureContextStates] = useState<Record<string, "loading" | "ready" | "error">>({});
  const [probeKind, setProbeKind] = useState<TxlineProbeKind>("scores");
  const [probeState, setProbeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [probe, setProbe] = useState<TxlineProbeResult | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const applyCatalog = (response: Awaited<ReturnType<typeof fetchMatchCatalog>>) => {
        if (cancelled) return;
        const nextMatches: MatchSummary[] = response.matches.map(({ context: _context, availability: _availability, contextError: _contextError, ...match }) => match);
        setMatches(nextMatches);
        setSource(response.source);
        setSelectedMatchId((current) => nextMatches.some((match) => match.fixtureId === current) ? current : selectSuggestedMatch(nextMatches)?.fixtureId ?? null);
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

  const selectedMatch = useMemo(
    () => matches.find((match) => match.fixtureId === selectedMatchId) ?? matches[0] ?? null,
    [matches, selectedMatchId],
  );
  const selectedContext = selectedMatch ? fixtureContexts[selectedMatch.fixtureId] ?? null : null;
  const contextState: "idle" | "loading" | "ready" | "error" = selectedMatch
    ? fixtureContextStates[selectedMatch.fixtureId] ?? "loading"
    : "idle";
  const featuredModel = useMemo(
    () => selectedMatch ? createFeaturedMatchModel(selectedMatch, selectedContext, contextState) : null,
    [contextState, selectedContext, selectedMatch],
  );

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

  const enterRoom = () => {
    if (!selectedMatch) return;
    const path = `/match/${selectedMatch.fixtureId}/preview`;
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
              <span className="font-['DM_Mono'] text-[10px] uppercase text-primary">TxLINE live data</span>
            </div>

            <span className="inline-flex items-center gap-2 font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">
              <Signal className={source === "txline" ? "size-4 text-primary" : "size-4"} />
              {matches.length || "--"} fixtures
            </span>
          </div>

          {loadState === "loading" ? (
            <div className="grid min-h-[60vh] place-items-center">
              <ViraLoader label="Carregando partidas TxLINE" />
            </div>
          ) : null}

          {loadState === "error" ? (
            <div className="grid min-h-[60vh] place-items-center text-sm text-destructive">
              Nao foi possivel carregar partidas.
            </div>
          ) : null}

          {loadState === "ready" && selectedMatch ? (
            <>
              {featuredModel ? <FeaturedMatchStage model={featuredModel} onOpen={enterRoom} /> : null}

              <FixtureAgenda
                matches={matches}
                selectedId={selectedMatch.fixtureId}
                selectedContext={selectedContext}
                contexts={fixtureContexts}
                contextStates={fixtureContextStates}
                onSelect={setSelectedMatchId}
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
