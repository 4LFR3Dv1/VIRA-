export type CanonicalMatchState = "scheduled" | "live" | "finished" | "unavailable";
export type CanonicalRoomState = "closed" | "open" | "finished";
export type CanonicalRoundState = "none" | "preparing" | "open" | "locked" | "resolved";
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
  answerState?: string | null;
  hasResolution?: boolean;
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
  if (match === "finished" && input.hasResolution) round = "resolved";
  else if (match === "live") {
    if (input.hasResolution) round = "resolved";
    else if (input.answerState === "submitted") round = "locked";
    else if (input.roundState === "open") round = "open";
    else if (input.hasSignal) round = "preparing";
  }
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
  round: { none: "Sem rodada", preparing: "Preparando rodada", open: "Rodada aberta", locked: "Resposta confirmada", resolved: "Rodada resolvida" },
  signal: { unavailable: "Aguardando mercado", available: "Mercado disponível", waiting: "Aguardando próximo sinal", received: "Sinal recebido" },
} as const;

export function formatMarketCount(count: number) {
  return `${count} ${count === 1 ? "mercado disponível" : "mercados disponíveis"}`;
}

export function formatObservedUpdateCount(count: number) {
  return `${new Intl.NumberFormat("pt-BR").format(count)} ${count === 1 ? "atualização TxLINE observada" : "atualizações TxLINE observadas"}`;
}
