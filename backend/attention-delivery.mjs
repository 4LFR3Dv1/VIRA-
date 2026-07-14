const copy = {
  en: {
    match_starting: ["Match starting soon", "Your VIRA room is ready."], match_live: ["The match is live", "Open VIRA to follow live challenges."], round_open: ["New round open", "A live match decision is waiting. Answer before the clock closes."], round_locked: ["Your prediction is locked", "Your choice stays private while the match decides the result."], round_resolved: ["Round resolved", "Your points and position are ready."], rank_changed: ["Your position changed", "Open VIRA to see the synchronized ranking."],
  },
  "pt-BR": {
    match_starting: ["A partida vai começar", "Sua sala VIRA está pronta."], match_live: ["A partida está ao vivo", "Abra o VIRA para acompanhar os desafios."], round_open: ["Nova rodada aberta", "Uma decisão ao vivo espera por você. Responda antes do relógio fechar."], round_locked: ["Seu palpite foi fechado", "Sua escolha permanece privada enquanto a partida decide o resultado."], round_resolved: ["Rodada resolvida", "Seus pontos e posição estão prontos."], rank_changed: ["Sua posição mudou", "Abra o VIRA para ver o ranking sincronizado."],
  },
};

export function attentionDeliveryPayload(event, context) {
  const locale = context.locale === "pt-BR" ? "pt-BR" : "en";
  const [title, body] = copy[locale][event.type];
  const params = new URLSearchParams({ lang: locale });
  if (context.inviteCode) params.set("invite", context.inviteCode);
  const roomId = encodeURIComponent(context.roomId || event.roomId || event.fixtureId);
  return { version: 1, eventId: event.eventId, type: event.type, title, body, url: `/match/${roomId}?${params}`, tag: `vira-${event.type}-${event.roundId ?? event.fixtureId}`, occurredAt: event.occurredAt, expiresAt: event.expiresAt ?? null };
}

export function deliveryTtlSeconds(event) {
  if (event.expiresAt) return Math.max(1, Math.min(300, Math.floor((Date.parse(event.expiresAt) - Date.now()) / 1_000)));
  if (event.type === "round_resolved" || event.type === "rank_changed") return 300;
  return 120;
}
