import { Activity, Radio } from "lucide-react";

import type { ReplayState } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";

interface LiveFieldProps {
  state: ReplayState;
}

const homeSpots = [
  ["12%", "48%"],
  ["20%", "33%"],
  ["28%", "62%"],
  ["36%", "42%"],
  ["44%", "55%"],
  ["52%", "36%"],
] as const;

const awaySpots = [
  ["88%", "52%"],
  ["80%", "35%"],
  ["73%", "64%"],
  ["64%", "44%"],
  ["58%", "58%"],
  ["48%", "30%"],
] as const;

function pct(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value);
}

function sourceName(value?: string | null) {
  if (!value) return "Aguardando";
  if (value === "txline-snapshot") return "Snapshot";
  if (value === "txline-live") return "Live";
  if (value === "txline-history") return "Historico";
  return value;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signalNameFromRoundTitle(title?: string) {
  if (!title) return "mercado";
  const thresholdIndex = title.includes(" chega a") ? title.indexOf(" chega a") : title.indexOf(" ultrapassa");
  if (thresholdIndex > 0) return title.slice(0, thresholdIndex);
  const directionPrefix = "A probabilidade de ";
  if (title.startsWith(directionPrefix)) return title.slice(directionPrefix.length).replace(" sobe na proxima atualizacao?", "").replace(" sobe no proximo sinal?", "");
  return "mercado";
}

export function LiveField({ state }: LiveFieldProps) {
  const match = state.snapshot.match;
  const finished = match.status === "finished";
  const evidence = state.snapshot.latestEvidence;
  const event = state.snapshot.lastNormalizedEvent;
  const homeProbability = pct(evidence?.normalization.normalizedValues.homeProbability);
  const roundPredicate = state.snapshot.currentRound?.resolution.predicate ?? {};
  const isDirectionRound = roundPredicate.direction === "up";
  const openingValue = numberValue(roundPredicate.openingValue);
  const threshold = isDirectionRound ? null : numberValue(roundPredicate.pctGte);
  const activeMarketValue = numberValue(state.snapshot.marketDistribution.yes);
  const visibleMarketValue = activeMarketValue !== null ? Math.round(activeMarketValue) : homeProbability ?? (openingValue !== null ? Math.round(openingValue) : null);
  const homePressure = visibleMarketValue ?? 50;
  const sourceLabel = finished ? "ENCERRADO" : state.snapshot.source === "txline-snapshot" ? "TXLINE SNAPSHOT" : state.snapshot.connectionState === "live" ? "AO VIVO" : state.snapshot.connectionState.toUpperCase();
  const signalLabel = signalNameFromRoundTitle(state.snapshot.currentRound?.title);
  const headline = finished
    ? "Partida encerrada pela TxLINE"
    : visibleMarketValue !== null
    ? `Mercado TxLINE: ${signalLabel} agora em ${visibleMarketValue}%${isDirectionRound && openingValue !== null ? ` · abertura ${openingValue.toFixed(1)}%` : threshold !== null ? ` · alvo ${threshold}%` : ""}`
    : "Aguardando o proximo sinal real da TxLINE";

  return (
    <section className="mt-4 overflow-hidden rounded-[1.15rem] border border-border bg-card shadow-[0_22px_60px_rgba(0,0,0,.28)]">
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div>
          <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.18em] text-muted-foreground">Campo ao vivo</p>
          <h1 className="mt-1 font-['Chakra_Petch'] text-[1.35rem] font-bold leading-tight">{headline}</h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Visual da sala alimentado por estado da partida, participantes reais e ultimo evento normalizado.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-['DM_Mono'] text-[10px] text-primary">
          <Radio className="size-3" />
          {sourceLabel}
        </span>
      </div>

      <div className="px-3">
        <div className="relative aspect-[1.95/1] overflow-hidden rounded-xl border border-emerald-300/20 bg-[#176b2b] shadow-inner">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,.04)_0,rgba(255,255,255,.04)_12.5%,transparent_12.5%,transparent_25%)]" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
          <div className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25" />
          <div className="absolute inset-y-[18%] left-0 w-[16%] rounded-r-lg border-y border-r border-white/25" />
          <div className="absolute inset-y-[18%] right-0 w-[16%] rounded-l-lg border-y border-l border-white/25" />
          <div className="absolute left-0 top-1/2 h-[28%] w-[6%] -translate-y-1/2 rounded-r-md border-y border-r border-white/25" />
          <div className="absolute right-0 top-1/2 h-[28%] w-[6%] -translate-y-1/2 rounded-l-md border-y border-l border-white/25" />

          <div
            className="absolute top-0 h-full rounded-full bg-primary/20 blur-2xl"
            style={{ left: `${Math.min(homePressure, 70)}%`, width: "22%" }}
          />

          {homeSpots.map(([left, top], index) => (
            <span
              key={`home-${left}-${top}`}
              className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/50 text-[9px] font-bold text-white shadow-[0_0_16px_rgba(92,124,255,.75)]"
              style={{ left, top, backgroundColor: match.homeTeam.accent }}
            >
              {index + 1}
            </span>
          ))}
          {awaySpots.map(([left, top], index) => (
            <span
              key={`away-${left}-${top}`}
              className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-black/20 bg-white text-[9px] font-bold text-[#111]"
              style={{ left, top }}
            >
              {index + 7}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 px-3 py-3">
        {[
          ["Fonte", sourceName(event?.source ?? state.snapshot.source)],
          ["Evento", event?.type ?? "Aguard."],
          ["Mercado", visibleMarketValue !== null ? <AnimatedNumber value={visibleMarketValue} suffix="%" /> : "--"],
          ["Seq", event?.sequence ? <AnimatedNumber value={event.sequence} /> : "--"],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-background/75 px-2 py-2 text-center">
            <p className="font-['DM_Mono'] text-[9px] text-muted-foreground">{label}</p>
            <p className="mt-1 truncate font-['Chakra_Petch'] text-lg font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <Activity className="size-3.5 text-primary" />
        {finished
          ? "Fim de jogo recebido da TxLINE; ranking final bloqueado."
          : evidence?.status === "resolved"
          ? "Mercado TxLINE acabou de resolver a rodada."
          : openingValue !== null
            ? "Baseline TxLINE carregado; aguardando o proximo odds event elegivel."
            : "Aguardando o proximo sinal da TxLINE."}
      </div>
    </section>
  );
}
