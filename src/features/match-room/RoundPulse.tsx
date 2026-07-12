import { percentageFromDistribution } from "../../domain/contracts";
import type { ConnectionState, MatchState, PredictionRound, PresentationEvent } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";

interface RoundPulseProps {
  round: PredictionRound | null;
  connectionState: ConnectionState;
  matchStatus: MatchState;
  marketDistribution: Record<string, number>;
  roomDistribution: Record<string, number>;
  latestPresentationEvent?: PresentationEvent | null;
}

function statusLabel({
  round,
  connectionState,
  matchStatus,
  latestPresentationEvent,
  hasRoundSignal,
  currentMarketValue,
}: {
  round: PredictionRound | null;
  connectionState: ConnectionState;
  matchStatus: MatchState;
  latestPresentationEvent?: PresentationEvent | null;
  hasRoundSignal: boolean;
  currentMarketValue: number | null;
}) {
  if (matchStatus === "finished") return "match_finished";
  if (connectionState === "offline" || connectionState === "reconnecting") return "stream_disconnected";
  if (latestPresentationEvent?.kind === "round_resolved") return "round_resolved";
  if (latestPresentationEvent?.kind === "txline_update" && currentMarketValue !== null) return "update_received";
  if (!hasRoundSignal) return "waiting_for_baseline";
  if (round?.state === "open") return "round_open";
  return round?.state ?? "waiting_for_baseline";
}

function humanStatus(value: string) {
  const labels: Record<string, string> = {
    waiting_for_baseline: "Aguardando baseline",
    round_open: "Rodada aberta",
    update_received: "Atualizacao recebida",
    threshold_not_crossed: "Alvo ainda nao cruzado",
    round_resolved: "Rodada resolvida",
    stream_disconnected: "Stream desconectado",
    match_finished: "Partida encerrada",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function signalLabelFromRound(round: PredictionRound | null) {
  const title = round?.title ?? "";
  const thresholdIndex = title.includes(" chega a") ? title.indexOf(" chega a") : title.indexOf(" ultrapassa");
  if (thresholdIndex > 0) return title.slice(0, thresholdIndex);
  const directionPrefix = "A probabilidade de ";
  if (title.startsWith(directionPrefix)) return title.slice(directionPrefix.length).replace(" sobe na proxima atualizacao?", "").replace(" sobe no proximo sinal?", "");
  return "Mercado";
}

function Pct({ value, muted = false }: { value: number | null; muted?: boolean }) {
  return (
    <span className={muted ? "text-muted-foreground" : "text-primary"}>
      {value === null ? "--" : <AnimatedNumber value={value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />}
    </span>
  );
}

export function RoundPulse({
  round,
  connectionState,
  matchStatus,
  marketDistribution,
  roomDistribution,
  latestPresentationEvent,
}: RoundPulseProps) {
  const hasMarketSignal = round?.resolution.domain === "football" || Object.values(marketDistribution).some((value) => value > 0);
  const predicate = round?.resolution.predicate ?? {};
  const openingValue = typeof predicate.openingValue === "number" ? predicate.openingValue : null;
  const isDirectionRound = predicate.direction === "up";
  const threshold = !isDirectionRound && typeof predicate.pctGte === "number" ? predicate.pctGte : null;
  const minimumProviderSequence = typeof predicate.minimumProviderSequence === "number" ? predicate.minimumProviderSequence : null;
  const hasRoundSignal = openingValue !== null || threshold !== null;
  const currentMarketValue = typeof marketDistribution.yes === "number" && marketDistribution.yes > 0 ? marketDistribution.yes : null;
  const presentationCurrentValue = latestPresentationEvent?.kind === "txline_update" ? latestPresentationEvent.currentValue : null;
  const presentationPreviousValue = latestPresentationEvent?.kind === "txline_update" ? latestPresentationEvent.previousValue : null;
  const signalValue = presentationCurrentValue ?? currentMarketValue ?? openingValue ?? (hasMarketSignal ? Math.max(...Object.values(marketDistribution)) : null);
  const openingDisplayValue = openingValue ?? presentationPreviousValue ?? null;
  const signalProgress = signalValue !== null ? Math.max(4, Math.min(100, signalValue)) : 0;
  const thresholdProgress = threshold !== null ? Math.max(0, Math.min(100, threshold)) : null;
  const totalAnswers = Object.values(roomDistribution).reduce((sum, value) => sum + value, 0);
  const status = statusLabel({ round, connectionState, matchStatus, latestPresentationEvent, hasRoundSignal, currentMarketValue });
  const signalName = signalLabelFromRound(round);
  const movement = openingDisplayValue !== null && signalValue !== null
    ? signalValue > openingDisplayValue
      ? "subiu"
      : signalValue < openingDisplayValue
        ? "caiu"
        : "igual"
    : "aguardando";

  return (
    <div className="overflow-hidden border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="font-['DM_Mono'] text-[10px] uppercase text-primary">TxLINE signal</p>
          <h2 className="font-['Chakra_Petch'] text-xl font-black uppercase leading-none">{signalName}</h2>
        </div>
        <span className="border border-border bg-background px-2 py-1 font-['DM_Mono'] text-[9px] uppercase text-muted-foreground">
          {humanStatus(status)}
        </span>
      </div>

      <section className="px-4 py-4">
        {hasRoundSignal || hasMarketSignal ? (
          <div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
              <div className="min-w-0 border-l border-border pl-3">
                <p className="font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">Opening</p>
                <p className="mt-1 font-['Chakra_Petch'] text-4xl font-black leading-none sm:text-5xl">
                  <Pct value={openingDisplayValue} muted={openingDisplayValue === null} />
                </p>
              </div>
              <div className="pb-2 text-center font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">
                <span className="block text-2xl text-primary">{movement === "subiu" ? "↑" : movement === "caiu" ? "↓" : "→"}</span>
                {movement}
              </div>
              <div className="min-w-0 border-r border-border pr-3 text-right">
                <p className="font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">Now</p>
                <p className="mt-1 font-['Chakra_Petch'] text-4xl font-black leading-none sm:text-5xl">
                  <Pct value={signalValue} muted={signalValue === null} />
                </p>
              </div>
            </div>

            <div className="relative mt-5 h-2 bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${signalProgress}%` }} />
              {thresholdProgress !== null ? (
                <span className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${thresholdProgress}%` }} />
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">
              <span>{minimumProviderSequence ? `seq >= ${minimumProviderSequence}` : "proximo sinal elegivel"}</span>
              <span>{isDirectionRound ? "SIM vence se subir" : threshold !== null ? `alvo ${threshold}%` : "sem alvo"}</span>
            </div>

            <div className="mt-4 border border-border bg-background/70 px-3 py-3">
              <p className="font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">Question</p>
              <p className="mt-1 text-sm font-semibold leading-5 text-foreground">{round?.title ?? "Mercado monitorado"}</p>
            </div>
          </div>
        ) : (
          <div className="min-h-40 border border-border bg-background/70 p-4">
            <p className="font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">Sinal TxLINE</p>
            <p className="mt-4 font-['Chakra_Petch'] text-4xl font-black text-primary">--</p>
            <p className="mt-2 text-sm text-muted-foreground">Aguardando mercado elegivel. Sem valor substituto.</p>
          </div>
        )}
      </section>

      <section className="border-t border-border px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-['DM_Mono'] text-[10px] uppercase text-muted-foreground">Room sentiment</p>
          <span className="font-['DM_Mono'] text-[10px] text-muted-foreground">
            <AnimatedNumber value={totalAnswers} /> {totalAnswers === 1 ? "palpite" : "palpites"}
          </span>
        </div>
        <div className="grid gap-2">
          {round?.options.map((option) => {
            const room = percentageFromDistribution(roomDistribution, option.id);
            return (
              <div key={option.id} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-3">
                <span className="truncate text-sm font-semibold">{option.label}</span>
                <div className="h-2 bg-secondary">
                  <div className="h-full bg-primary" style={{ width: `${room}%` }} />
                </div>
                <span className="text-right font-['DM_Mono'] text-xs text-primary">
                  <AnimatedNumber value={room} suffix="%" />
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
