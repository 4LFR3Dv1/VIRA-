import { ArrowLeft, CheckCircle2, Database, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { EvidenceChain, PredictionRound, PublicDomainEvent, ReplayState, RoomSnapshot, RoomVerification } from "../../domain/types";
import { fetchPublicRoomEvents, fetchPublicRoomProjection, fetchRoomVerification, type TxlineStreamStatus } from "../../runtime/api";

interface InspectorPanelProps {
  open: boolean;
  state: ReplayState;
  currentRound: PredictionRound | null;
  txlineFetchState: "idle" | "loading" | "accepted" | "error";
  txlineStreamStatus: TxlineStreamStatus | null;
  onClose: () => void;
  onFetchLatestTxlineOdds: () => Promise<void>;
  onConnectOddsStream: () => Promise<void>;
  onDisconnectOddsStream: () => Promise<void>;
}

function compactHash(hash?: string) {
  if (!hash) return "none";
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function formatMaybeNumber(value: unknown, suffix = "") {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(3)}${suffix}`;
}

function statusTone(status?: EvidenceChain["status"]) {
  if (status === "resolved") return "border-primary/50 bg-primary/10 text-primary";
  if (status === "ignored") return "border-amber-400/50 bg-amber-400/10 text-amber-200";
  if (status === "failed") return "border-destructive/50 bg-destructive/10 text-destructive";
  return "border-border bg-card text-muted-foreground";
}

type PublicInspectorState = "idle" | "loading" | "ready" | "error";
type PublicInspectorView = "verification" | "causality" | "ledger" | "projection";

const CAUSAL_EVENT_TYPES = new Set([
  "answer.submitted",
  "txline.event.received",
  "txline.event.accepted",
  "txline.event.ignored",
  "round.resolved",
  "round.opened",
  "match.finished",
]);

function verificationTone(verification: RoomVerification | null, state: PublicInspectorState) {
  if (state === "loading") return "border-border bg-card text-muted-foreground";
  if (!verification) return "border-amber-400/50 bg-amber-400/10 text-amber-200";
  if (verification.hashChainValid && verification.projectionMatches && verification.rankingMatches) {
    return "border-primary/50 bg-primary/10 text-primary";
  }
  return "border-destructive/50 bg-destructive/10 text-destructive";
}

function verificationLabel(verification: RoomVerification | null, state: PublicInspectorState) {
  if (state === "loading") return "LOADING";
  if (!verification) return state === "error" ? "UNAVAILABLE" : "WAITING";
  return verification.status.toUpperCase();
}

function eventTitle(type: string) {
  const titles: Record<string, string> = {
    "room.configured": "Sala configurada",
    "participant.joined": "Participante entrou",
    "round.opened": "Rodada aberta",
    "answer.submitted": "Palpite registrado",
    "txline.event.received": "TxLINE recebido",
    "txline.event.accepted": "TxLINE aceito",
    "txline.event.ignored": "TxLINE ignorado",
    "round.resolved": "Rodada resolvida",
    "match.finished": "Partida encerrada",
  };
  return titles[type] ?? type;
}

function eventTone(type: string) {
  if (type === "round.resolved" || type === "txline.event.accepted") return "border-primary/35 bg-primary/8 text-primary";
  if (type === "txline.event.ignored") return "border-amber-400/40 bg-amber-400/10 text-amber-200";
  if (type === "match.finished") return "border-sky-400/40 bg-sky-400/10 text-sky-200";
  return "border-border bg-background/70 text-foreground";
}

function payloadText(payload: Record<string, unknown>) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return "{}";
  }
}

function stringValue(value: unknown, fallback = "n/a") {
  if (typeof value === "string" && value.length) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function eventSummary(event: PublicDomainEvent) {
  if (event.type === "answer.submitted") {
    return `${stringValue(event.payload.participantId, "participant")} -> ${stringValue(event.payload.optionId, "option")}`;
  }
  if (event.type === "txline.event.received") {
    return `provider seq ${stringValue(event.payload.providerSequence)} · ${stringValue(event.payload.providerEventId, "provider event")}`;
  }
  if (event.type === "txline.event.ignored") {
    return stringValue(event.payload.reason, "ignored");
  }
  if (event.type === "round.resolved") {
    return `winner ${stringValue(event.payload.winningOptionId)} · round ${stringValue(event.payload.roundId)}`;
  }
  if (event.type === "round.opened") {
    return stringValue(event.payload.roundId, "round opened");
  }
  if (event.type === "match.finished") {
    return stringValue(event.payload.reason, "finished");
  }
  return stringValue(event.payload.roundId ?? event.payload.fixtureId ?? event.payload.roomId, event.type);
}

function Step({
  index,
  title,
  complete,
  children,
}: {
  index: number;
  title: string;
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border p-3 ${complete ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-2">
        {complete ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-muted-foreground" />}
        <h3 className="font-['Chakra_Petch'] text-sm font-bold uppercase tracking-[.08em]">
          {index}. {title}
        </h3>
      </div>
      <div className="mt-3 space-y-2 font-['DM_Mono'] text-[11px]">{children}</div>
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-bold text-primary" : "truncate text-foreground"}>{value}</span>
    </div>
  );
}

export function InspectorPanel({
  open,
  state,
  currentRound,
  txlineFetchState,
  txlineStreamStatus,
  onClose,
  onFetchLatestTxlineOdds,
  onConnectOddsStream,
  onDisconnectOddsStream,
}: InspectorPanelProps) {
  const [publicState, setPublicState] = useState<PublicInspectorState>("idle");
  const [publicError, setPublicError] = useState<string | null>(null);
  const [verification, setVerification] = useState<RoomVerification | null>(null);
  const [publicEvents, setPublicEvents] = useState<PublicDomainEvent[]>([]);
  const [publicProjection, setPublicProjection] = useState<RoomSnapshot | null>(null);
  const [view, setView] = useState<PublicInspectorView>("verification");

  const roomId = state.snapshot.roomId;
  const streamVersion = state.snapshot.ledger?.streamVersion ?? state.snapshot.version;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPublicState("loading");
    setPublicError(null);

    Promise.all([
      fetchRoomVerification(roomId),
      fetchPublicRoomEvents(roomId),
      fetchPublicRoomProjection(roomId),
    ])
      .then(([nextVerification, eventsResponse, nextProjection]) => {
        if (cancelled) return;
        setVerification(nextVerification);
        setPublicEvents(eventsResponse.events);
        setPublicProjection(nextProjection);
        setPublicState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPublicState("error");
        setPublicError(error instanceof Error ? error.message : "public_api_failed");
      });

    return () => {
      cancelled = true;
    };
  }, [open, roomId, streamVersion]);

  const evidence = state.snapshot.latestEvidence ?? null;
  const scoreOutputs = evidence?.outputs.filter((output) => output.type === "score.updated") ?? [];
  const leaderboardOutput = evidence?.outputs.find((output) => output.type === "leaderboard.updated");
  const timelineOutput = evidence?.outputs.find((output) => output.type === "timeline.created");
  const sseOutputs = evidence?.outputs.filter((output) => output.type === "sse.emitted") ?? [];
  const totalClients = sseOutputs.reduce((max, output) => Math.max(max, output.clientCount), 0);
  const percentages = evidence?.input.excerpt.percentages ?? [];
  const priceNames = evidence?.input.excerpt.priceNames ?? evidence?.normalization.normalizedValues.priceNames ?? [];
  const oddsStream = txlineStreamStatus?.odds;
  const causalEvents = useMemo(
    () => publicEvents.filter((event) => CAUSAL_EVENT_TYPES.has(event.type)).slice(-8).reverse(),
    [publicEvents],
  );
  const recentLedgerEvents = useMemo(() => publicEvents.slice(-12).reverse(), [publicEvents]);
  const inspectedProjection = publicProjection ?? state.snapshot;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/60">
      <aside className="h-full w-full max-w-[28rem] overflow-y-auto border-l border-border bg-[#111310] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.15em] text-primary">Revisao oficial VIRA</p>
            <h2 className="font-['Chakra_Petch'] text-2xl font-bold">Cadeia de evidencia</h2>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Como um payload especifico da TxLINE causou uma resolucao especifica.
            </p>
          </div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary" aria-label="Fechar revisao oficial">
            <ArrowLeft className="size-4" />
          </button>
        </div>

        <div className={`mt-5 rounded-xl border p-3 ${statusTone(evidence?.status)}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em]">Evidence chain</span>
            <b className="font-['DM_Mono'] text-xs">{evidence?.status?.toUpperCase() ?? "WAITING"}</b>
          </div>
          <div className="mt-2 font-['DM_Mono'] text-[11px] text-muted-foreground">
            Correlation: <span className="text-foreground">{evidence?.correlationId ?? "none"}</span>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.045] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Public verification API</p>
              <h3 className="mt-1 font-['Chakra_Petch'] text-lg font-bold">Replay publico do ledger</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Este painel consulta /verification, /events e /projection. O latestEvidence abaixo e apenas detalhe operacional.
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 font-['DM_Mono'] text-[10px] uppercase ${verificationTone(verification, publicState)}`}>
              {verificationLabel(verification, publicState)}
            </span>
          </div>

          {publicError ? <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{publicError}</p> : null}

          <div className="mt-3 grid grid-cols-2 gap-2 font-['DM_Mono'] text-[11px]">
            <div className="rounded-lg bg-background/70 px-3 py-2">
              <span className="block text-muted-foreground">Hash chain</span>
              <b className={verification?.hashChainValid ? "text-primary" : "text-muted-foreground"}>
                {verification ? (verification.hashChainValid ? "VALID" : "INVALID") : "--"}
              </b>
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2">
              <span className="block text-muted-foreground">Projection</span>
              <b className={verification?.projectionMatches ? "text-primary" : "text-muted-foreground"}>
                {verification ? (verification.projectionMatches ? "MATCH" : "DIVERGED") : "--"}
              </b>
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2">
              <span className="block text-muted-foreground">Stream version</span>
              <b>{verification?.streamVersion ?? inspectedProjection.ledger?.streamVersion ?? "--"}</b>
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2">
              <span className="block text-muted-foreground">Events</span>
              <b>{verification?.eventCount ?? publicEvents.length}</b>
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-background/70 px-3 py-2 font-['DM_Mono'] text-[11px]">
            <span className="block text-muted-foreground">Ledger head</span>
            <b className="break-all text-primary">{compactHash(verification?.ledgerHeadHash ?? inspectedProjection.ledger?.headHash ?? null)}</b>
          </div>

          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {([
              ["verification", "Verification"],
              ["causality", "Causalidade"],
              ["ledger", "Ledger"],
              ["projection", "Projection"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 font-['DM_Mono'] text-[10px] uppercase tracking-[.1em] transition ${
                  view === id ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/70 text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-border bg-card p-3">
            {publicState === "loading" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Consultando APIs publicas...
              </div>
            ) : null}

            {view === "verification" && publicState !== "loading" ? (
              <div className="space-y-2 font-['DM_Mono'] text-[11px]">
                <Row label="Status" value={verificationLabel(verification, publicState)} strong={verification?.status === "verified"} />
                <Row label="Ranking replay" value={verification ? (verification.rankingMatches ? "MATCH" : "DIVERGED") : "n/a"} strong={verification?.rankingMatches} />
                <Row label="Replay" value={verification ? (verification.replaySucceeded ? "SUCCEEDED" : "FAILED") : "n/a"} strong={verification?.replaySucceeded} />
                <Row label="Live hash" value={compactHash(verification?.liveProjectionHash)} />
                <Row label="Replay hash" value={compactHash(verification?.replayedProjectionHash)} />
                <Row label="Schema" value={verification?.schemaVersion ?? "n/a"} />
              </div>
            ) : null}

            {view === "causality" && publicState !== "loading" ? (
              <div className="space-y-2">
                {causalEvents.map((event) => (
                  <div key={event.eventId} className={`rounded-lg border px-3 py-2 ${eventTone(event.type)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <b className="font-['Chakra_Petch'] text-sm">{eventTitle(event.type)}</b>
                      <span className="font-['DM_Mono'] text-[10px] text-muted-foreground">v{event.streamVersion}</span>
                    </div>
                    <p className="mt-1 truncate font-['DM_Mono'] text-[11px] text-muted-foreground">{eventSummary(event)}</p>
                  </div>
                ))}
                {!causalEvents.length ? <p className="text-xs text-muted-foreground">Nenhum evento causal publico ainda.</p> : null}
              </div>
            ) : null}

            {view === "ledger" && publicState !== "loading" ? (
              <div className="space-y-2">
                {recentLedgerEvents.map((event) => (
                  <details key={event.eventId} className="rounded-lg border border-border bg-background/70 px-3 py-2">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-['DM_Mono'] text-[11px] text-foreground">{event.type}</span>
                        <span className="font-['DM_Mono'] text-[10px] text-muted-foreground">#{event.globalPosition} · v{event.streamVersion}</span>
                      </div>
                      <p className="mt-1 truncate font-['DM_Mono'] text-[10px] text-muted-foreground">{compactHash(event.eventHash)}</p>
                    </summary>
                    <div className="mt-2 space-y-1 border-t border-border pt-2 font-['DM_Mono'] text-[10px] text-muted-foreground">
                      <Row label="Event" value={event.eventId} />
                      <Row label="Cause" value={event.causationId ?? "none"} />
                      <Row label="Corr." value={event.correlationId} />
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-black/25 p-2 text-[10px] leading-4">
                        {payloadText(event.payload)}
                      </pre>
                    </div>
                  </details>
                ))}
                {!recentLedgerEvents.length ? <p className="text-xs text-muted-foreground">Ledger publico vazio.</p> : null}
              </div>
            ) : null}

            {view === "projection" && publicState !== "loading" ? (
              <div className="space-y-3 font-['DM_Mono'] text-[11px]">
                <Row label="Room" value={inspectedProjection.roomId} />
                <Row label="Population" value={inspectedProjection.roomPopulation} />
                <Row label="Match" value={`${inspectedProjection.match.homeScore}-${inspectedProjection.match.awayScore} · ${inspectedProjection.match.status}`} />
                <Row label="Round" value={inspectedProjection.currentRound?.id ?? "none"} />
                <Row label="Version" value={inspectedProjection.version} />
                <div className="rounded-lg bg-background/70 p-2">
                  <span className="block text-muted-foreground">Top ranking</span>
                  <div className="mt-2 space-y-1">
                    {inspectedProjection.leaderboard.slice(0, 3).map((entry) => (
                      <div key={entry.participantId} className="flex items-center justify-between gap-3">
                        <span className="truncate">{entry.rank}. {entry.displayName}</span>
                        <b className="text-primary">{entry.points} pts</b>
                      </div>
                    ))}
                    {!inspectedProjection.leaderboard.length ? <span className="text-muted-foreground">Sem ranking.</span> : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <button
          onClick={() => void onFetchLatestTxlineOdds()}
          disabled={txlineFetchState === "loading"}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-['Chakra_Petch'] text-sm font-bold uppercase tracking-[.06em] text-primary-foreground disabled:opacity-50"
        >
          {txlineFetchState === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
          {txlineFetchState === "loading" ? "Buscando na TxLINE..." : "Buscar odds atuais na TxLINE"}
        </button>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          O VIRA buscará um snapshot real. Qualquer resolução será executada automaticamente pela engine.
        </p>

        <div className="mt-4 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Odds stream</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {oddsStream?.connected ? "Conectado ao stream real de odds." : "Stream de odds desconectado."}
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 font-['DM_Mono'] text-[10px] uppercase ${
              oddsStream?.connected ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"
            }`}>
              {oddsStream?.status ?? "idle"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 font-['DM_Mono'] text-[11px]">
            <div className="rounded-lg bg-background/70 px-3 py-2">
              <span className="block text-muted-foreground">Accepted</span>
              <b>{oddsStream?.acceptedMessages ?? 0}</b>
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2">
              <span className="block text-muted-foreground">Last</span>
              <b className="truncate">{oddsStream?.lastMessageAt ? new Date(oddsStream.lastMessageAt).toLocaleTimeString() : "none"}</b>
            </div>
          </div>
          {oddsStream?.lastError ? <p className="mt-2 text-xs text-destructive">{oddsStream.lastError}</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => void onConnectOddsStream()}
              disabled={oddsStream?.connected}
              className="rounded-xl border border-primary/35 bg-primary/10 px-3 py-2 font-['Chakra_Petch'] text-xs font-bold uppercase tracking-[.06em] text-primary disabled:opacity-45"
            >
              Conectar odds
            </button>
            <button
              onClick={() => void onDisconnectOddsStream()}
              disabled={!oddsStream?.connected}
              className="rounded-xl border border-border bg-background px-3 py-2 font-['Chakra_Petch'] text-xs font-bold uppercase tracking-[.06em] text-muted-foreground disabled:opacity-45"
            >
              Desconectar
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <Step index={1} title="TxLINE input" complete={Boolean(evidence?.input)}>
            <Row label="Fixture" value={evidence?.input.fixtureId ?? state.snapshot.match.id} />
            <Row label="Match" value={state.snapshot.match.title} />
            <Row label="Endpoint" value={evidence?.input.endpoint ?? "not requested"} />
            <Row label="HTTP" value={evidence ? `${evidence.input.httpMethod} ${evidence.input.httpStatus}` : "n/a"} strong={Boolean(evidence)} />
            <Row label="Market" value={evidence?.input.excerpt.market ?? "n/a"} />
            <Row label="Line" value={evidence?.input.excerpt.line ?? "n/a"} />
            <Row label="Period" value={evidence?.input.excerpt.period ?? "n/a"} />
            <Row label="Price names" value={priceNames.length ? priceNames.join(" · ") : "n/a"} />
            <Row label="Values" value={percentages.length ? percentages.map((value) => formatMaybeNumber(value)).join(" · ") : "n/a"} />
            <Row label="SHA-256" value={compactHash(evidence?.input.rawPayloadHash)} />
          </Step>

          <Step index={2} title="Normalized event" complete={Boolean(evidence?.normalization)}>
            <Row label="Event ID" value={evidence?.normalization.eventId ?? "n/a"} />
            <Row label="Type" value={evidence?.normalization.type ?? "n/a"} strong={evidence?.normalization.type === "odds_shift"} />
            <Row label="Source" value={evidence?.normalization.source ?? state.snapshot.source ?? "n/a"} />
            <Row label="Local seq" value={evidence?.normalization.localSequence ?? state.snapshot.lastSequence} />
            <Row label="Market type" value={evidence?.normalization.normalizedValues.marketType ?? evidence?.input.excerpt.market ?? "n/a"} />
            <Row label="Line" value={evidence?.normalization.normalizedValues.line ?? "n/a"} />
            <Row label={state.snapshot.match.homeTeam.name} value={formatMaybeNumber(evidence?.normalization.normalizedValues.homeProbability, "%")} />
            <Row label="Draw" value={formatMaybeNumber(evidence?.normalization.normalizedValues.drawProbability, "%")} />
            <Row label={state.snapshot.match.awayTeam.name} value={formatMaybeNumber(evidence?.normalization.normalizedValues.awayProbability, "%")} />
          </Step>

          <Step index={3} title="Rule evaluation" complete={Boolean(evidence?.ruleEvaluation)}>
            <Row label="Round" value={evidence?.ruleEvaluation.roundPrompt ?? currentRound?.title ?? "n/a"} />
            <Row label="Expression" value={evidence?.ruleEvaluation.expression ?? "n/a"} />
            <Row label="Actual" value={formatMaybeNumber(evidence?.ruleEvaluation.actualValue)} strong={evidence?.ruleEvaluation.predicateResult} />
            <Row label="Expected" value={`${evidence?.ruleEvaluation.expectedOperator ?? ""} ${evidence?.ruleEvaluation.expectedValue ?? "n/a"}`} />
            <Row label="Window valid" value={evidence?.ruleEvaluation.windowValid ? "Yes" : "No"} />
            <Row label="Result" value={evidence ? String(evidence.ruleEvaluation.predicateResult).toUpperCase() : "n/a"} strong={evidence?.ruleEvaluation.predicateResult} />
          </Step>

          <Step index={4} title="Resolution" complete={Boolean(evidence?.resolution)}>
            <Row label="Winning" value={evidence?.resolution?.winningOptionId ?? "not resolved"} strong={Boolean(evidence?.resolution)} />
            <Row label="Answers" value={evidence?.resolution ? `${evidence.resolution.answersCorrect}/${evidence.resolution.answersEvaluated} correct` : "n/a"} />
            <Row label="Points" value={evidence?.resolution ? `+${evidence.resolution.totalPointsApplied}` : "n/a"} />
            <Row label="Resolved by" value={evidence?.resolution?.resolvedBy ?? "n/a"} />
            <Row label="Idempotency" value={evidence?.resolution?.idempotencyKey ?? evidence?.ruleEvaluation.ignoredReason ?? "n/a"} />
          </Step>

          <Step index={5} title="Runtime output" complete={Boolean(evidence?.outputs.length)}>
            {scoreOutputs.slice(0, 3).map((output) => (
              <Row
                key={output.participantId}
                label={output.displayName ?? output.participantId}
                value={`${output.previousScore} -> ${output.currentScore} (+${output.delta})`}
                strong
              />
            ))}
            <Row label="Leaderboard" value={leaderboardOutput ? `v${leaderboardOutput.previousVersion} -> v${leaderboardOutput.currentVersion}` : "n/a"} />
            <Row label="Timeline" value={timelineOutput?.timelineEntryId ?? "n/a"} />
            <Row label="SSE clients" value={String(totalClients)} />
          </Step>
        </div>

        <div className="mt-5 rounded-xl border border-border bg-card p-3">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h3 className="font-['Chakra_Petch'] text-sm font-bold uppercase tracking-[.08em]">Recent evidence</h3>
          </div>
          <div className="space-y-2 font-['DM_Mono'] text-[11px]">
            {(state.snapshot.evidenceHistory ?? []).slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2">
                <span className="truncate">{item.id}</span>
                <b className={item.status === "resolved" ? "text-primary" : "text-muted-foreground"}>{item.status}</b>
              </div>
            ))}
            {!state.snapshot.evidenceHistory?.length ? <p className="text-muted-foreground">Nenhuma evidência ainda.</p> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
