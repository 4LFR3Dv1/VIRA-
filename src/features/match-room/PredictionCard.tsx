import { Check, Lock, Send } from "lucide-react";

import { formatMatchClock } from "../../domain/contracts";
import type { MatchRoomUiState, PredictionRound, UserAnswerState } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";

interface PredictionCardProps {
  round: PredictionRound | null;
  matchClockSec: number;
  selectedOptionId: string | null;
  answerState: UserAnswerState;
  uiState: MatchRoomUiState;
  answerSummary: Record<string, number>;
  onSelect: (optionId: string) => void;
  onSubmit: () => void;
}

function toneForUiState(currentUiState: MatchRoomUiState) {
  if (currentUiState === "resolved_success") {
    return "border-emerald-400/60 bg-emerald-500/10";
  }
  if (currentUiState === "resolved_failure") {
    return "border-destructive/60 bg-destructive/10";
  }
  return "border-border bg-card";
}

function fanStatus(answerState: UserAnswerState, uiState: MatchRoomUiState) {
  if (uiState === "match_finished") return "Partida encerrada";
  if (uiState === "resolved_success") return "Voce acertou";
  if (uiState === "resolved_failure") return "Resultado recebido";
  if (answerState === "submitted") return "Palpite registrado";
  if (answerState === "selected") return "Opcao selecionada";
  return "Escolha uma opcao";
}

export function PredictionCard({
  round,
  matchClockSec,
  selectedOptionId,
  answerState,
  uiState,
  answerSummary,
  onSelect,
  onSubmit,
}: PredictionCardProps) {
  const isMatchFinished = uiState === "match_finished";
  const isSubmitted = answerState === "submitted" || answerState === "correct" || answerState === "incorrect";
  const isLocked = isMatchFinished || !round || round.state !== "open" || isSubmitted;
  const answerCount = Object.values(answerSummary).reduce((sum, value) => sum + value, 0);
  const statusLabel = round?.state === "awaiting_event"
    ? "Aguardando evento"
    : round?.state === "locked"
      ? "Rodada travada"
      : round?.state === "resolved"
        ? "Rodada resolvida"
        : isMatchFinished
          ? "A sala foi fechada para novos palpites"
          : round?.contextLabel ?? "Aguardando proxima rodada";

  return (
    <section className={`overflow-hidden border p-4 shadow-[0_24px_70px_rgba(0,0,0,.32)] ${toneForUiState(uiState)}`}>
      <div className="flex items-start gap-4 border-b border-border pb-4">
        <div className="flex-1">
          <p className="font-['DM_Mono'] text-[10px] uppercase text-primary">{isMatchFinished ? "Partida encerrada" : "Primary round"}</p>
          <h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase leading-[.92] sm:text-4xl">
            {isMatchFinished ? "Ranking final confirmado" : round?.title ?? "Sem rodada ativa"}
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">{statusLabel}</p>
        </div>
        <div className="grid size-16 shrink-0 place-items-center border border-primary/30 bg-background">
          <div className="text-center">
            <span className="block font-['DM_Mono'] text-xs text-primary">
              {isMatchFinished ? "00:00" : round ? formatMatchClock(Math.max(round.locksAtClockSec - matchClockSec, 0)) : "--:--"}
            </span>
            <span className="text-[9px] text-muted-foreground">{isMatchFinished ? "final" : "restante"}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
        <b className="text-foreground">
          <AnimatedNumber value={answerCount} /> {answerCount === 1 ? "pessoa respondeu" : "pessoas responderam"}
        </b>
        <span> · seu estado: </span>
        <span className="text-primary">{fanStatus(answerState, uiState)}</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {!isMatchFinished && round?.options.map((option) => {
          const isSelected = selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              disabled={isLocked}
              onClick={() => onSelect(option.id)}
              className={`flex min-h-16 items-center justify-between border px-4 text-left font-['Chakra_Petch'] text-xl font-black uppercase transition ${
                isSelected ? "border-primary bg-primary/12 ring-1 ring-primary" : "border-white/[.065] bg-background/80 hover:border-primary/50"
              } ${isLocked ? "opacity-70" : ""}`}
            >
              <span>{option.label}</span>
              <span className="flex items-center gap-2 font-['DM_Mono'] text-xs text-muted-foreground">
                <AnimatedNumber value={answerSummary[option.id] ?? 0} />
                {isSelected ? <Check className="size-4 text-primary" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      {answerState === "selected" && !isMatchFinished ? (
        <button
          onClick={onSubmit}
          className="mt-4 flex w-full items-center justify-center gap-2 bg-primary py-4 font-['Chakra_Petch'] text-sm font-black uppercase text-primary-foreground shadow-[0_8px_24px_rgba(202,255,40,.18)]"
        >
          <Send className="size-4" />
          Confirme seu palpite
        </button>
      ) : null}

      {answerState !== "selected" && !isSubmitted && !isMatchFinished ? (
        <div className="mt-4 flex items-center justify-between border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
          <span>Selecione uma opcao para registrar seu palpite.</span>
          <button disabled className="bg-secondary px-3 py-1 text-[11px]">
            Confirmar
          </button>
        </div>
      ) : null}

      {answerState === "submitted" && !isMatchFinished ? (
        <p aria-live="polite" className="mt-4 flex items-center gap-2 bg-background px-3 py-3 text-sm text-muted-foreground">
          <Lock className="size-4 text-primary" />
          <span><b className="text-foreground">Palpite registrado:</b> aguardando o proximo sinal da TxLINE.</span>
        </p>
      ) : null}

      {answerState === "late" ? (
        <p aria-live="polite" className="mt-4 bg-background px-3 py-3 text-sm text-muted-foreground">
          <b className="text-foreground">Rodada encerrada:</b> o tempo terminou antes do envio.
        </p>
      ) : null}
    </section>
  );
}
