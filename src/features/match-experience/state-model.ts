export type CanonicalMatchState = "scheduled" | "live" | "finished" | "unavailable";
export type CanonicalRoomState = "closed" | "open" | "finished";
export type CanonicalRoundState = "none" | "preparing" | "open" | "locked" | "resolved" | "expired";
export type CanonicalSignalState = "unavailable" | "available" | "waiting" | "received";
export type CanonicalConnectionState = "healthy" | "reconnecting" | "unavailable";

export type CanonicalExperienceState = {
  match: CanonicalMatchState;
  room: CanonicalRoomState;
  round: CanonicalRoundState;
  signal: CanonicalSignalState;
  connection: CanonicalConnectionState;
};

type CanonicalStateInput = {
  matchStatus?: string | null;
  roomExists?: boolean;
  roundState?: string | null;
  currentRoundHasResolution?: boolean;
  hasSignal?: boolean;
  signalReceived?: boolean;
  connectionState?: string | null;
};

function normalizeMatch(value?: string | null): CanonicalMatchState {
  const status = String(value ?? "unknown").toLowerCase();
  if (status.includes("finish") || status.includes("complete") || status.includes("final")) return "finished";
  if (status.includes("live") || status.includes("play") || status === "in_progress") return "live";
  if (["scheduled", "paused", "postponed", "not_started"].includes(status)) return "scheduled";
  return "unavailable";
}

export function deriveCanonicalExperienceState(input: CanonicalStateInput): CanonicalExperienceState {
  const match = normalizeMatch(input.matchStatus);
  const connection: CanonicalConnectionState = input.connectionState === "offline"
    ? "unavailable"
    : input.connectionState === "reconnecting" || input.connectionState === "connecting"
      ? "reconnecting"
      : "healthy";
  const room: CanonicalRoomState = match === "finished" ? "finished" : input.roomExists === false ? "closed" : "open";
  let round: CanonicalRoundState = "none";
  if (input.roundState === "resolved") round = "resolved";
  else if (input.roundState === "expired") round = "expired";
  else if (input.roundState === "locked") round = "locked";
  else if (input.roundState === "open") round = "open";
  else if (input.roundState === "scheduled" || (match === "live" && input.hasSignal)) round = "preparing";
  else if (match === "finished" && input.currentRoundHasResolution) round = "resolved";
  const signal: CanonicalSignalState = input.signalReceived
    ? "received"
    : input.hasSignal
      ? round === "locked" ? "waiting" : "available"
      : "unavailable";
  return { match, room, round, signal, connection };
}

export const experienceCopy = {
  match: { scheduled: "Pré-jogo", live: "Ao vivo", finished: "Final", unavailable: "Partida indisponível" },
  room: { closed: "Sala fechada", open: "Sala aberta", finished: "Sala encerrada" },
  round: { none: "Sem rodada", preparing: "Preparando rodada", open: "Rodada aberta", locked: "Respostas encerradas", resolved: "Rodada resolvida", expired: "Rodada encerrada" },
  signal: { unavailable: "Aguardando mercado", available: "Mercado disponível", waiting: "Aguardando próximo sinal", received: "Sinal recebido" },
} as const;

export function resolutionBelongsToCurrentRound(currentRoundId?: string | null, resolutionRoundId?: string | null) {
  return Boolean(currentRoundId && resolutionRoundId && currentRoundId === resolutionRoundId);
}

export function participantAwaitsCurrentRoundResolution(roundState?: string | null, answerState?: string | null) {
  return answerState === "submitted" && ["open", "locked"].includes(String(roundState ?? ""));
}

export function formatMarketCount(count: number) {
  return `${count} ${count === 1 ? "mercado disponível" : "mercados disponíveis"}`;
}

export function formatObservedUpdateCount(count: number) {
  return `${new Intl.NumberFormat("pt-BR").format(count)} ${count === 1 ? "atualização TxLINE observada" : "atualizações TxLINE observadas"}`;
}
