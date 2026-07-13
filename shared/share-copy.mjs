export const LEGACY_SHARE_LOCALE = "pt-BR";
export const LEGACY_SHARE_TIME_ZONE = "America/Sao_Paulo";

export function normalizeShareLocale(value, fallback = LEGACY_SHARE_LOCALE) {
  const normalized = String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "pt" || normalized === "pt-br") return "pt-BR";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return fallback;
}

export function resolveShareLocaleContext(share) {
  const stored = share?.editorialContext;
  return {
    locale: normalizeShareLocale(stored?.locale),
    timeZone: stored?.timeZone || LEGACY_SHARE_TIME_ZONE,
    source: stored?.locale ? stored.source || "share_creator" : "legacy_default",
  };
}

function dictionary(locale) {
  return locale === "en" ? {
    draw: "Draw", timePending: "time to be confirmed", at: "at", predictionCta: "Make my prediction", resultCta: "View result", roomCta: "Join room", roomResultCta: "View group result", nextCta: "Play the next one", matchCta: "View match",
    live: "Live match", roomOpen: "Room open", inRoom: (count) => `${count} in the room`, joinBody: "Join and play together.",
    picked: (name, choice) => `${name} picked ${choice}`, predictBody: (headline, schedule) => `${headline} · ${schedule}. Make your prediction.`,
    headlineToday: "Who wins today?", headlineTomorrow: "Who wins tomorrow?", headlineFixture: (home, away) => `Who wins ${home} x ${away}?`,
    correct: "was right", played: "played", yes: "YES", no: "NO", won: "won", points: (value) => `+${value} points`, recorded: "result recorded",
    resultTitle: (name, action) => `${name} ${action} on VIRA`, resultBody: (winner, result) => `${winner} won · ${result}.`, predictionResultTitle: (name, correct) => `${name} ${correct ? "was right" : "made a prediction"}`,
    predictionResultBody: (home, homeScore, awayScore, away, choice) => `${home} ${homeScore} x ${awayScore} ${away} · pick: ${choice}.`,
    kinds: { room: "ROOM", result: "RESULT", prediction: "PREDICTION" },
  } : {
    draw: "Empate", timePending: "horário a confirmar", at: "às", predictionCta: "Fazer meu palpite", resultCta: "Ver resultado", roomCta: "Entrar na sala", roomResultCta: "Ver resultado do grupo", nextCta: "Jogar a próxima", matchCta: "Ver partida",
    live: "Partida ao vivo", roomOpen: "Sala aberta", inRoom: (count) => `${count} na sala`, joinBody: "Entre para jogar junto.",
    picked: (name, choice) => `${name} escolheu ${choice}`, predictBody: (headline, schedule) => `${headline} · ${schedule}. Faça o seu palpite.`,
    headlineToday: "Quem vence hoje?", headlineTomorrow: "Quem vence amanhã?", headlineFixture: (home, away) => `Quem vence ${home} x ${away}?`,
    correct: "acertou", played: "jogou", yes: "SIM", no: "NÃO", won: "venceu", points: (value) => `+${value} pontos`, recorded: "resultado registrado",
    resultTitle: (name, action) => `${name} ${action} no VIRA`, resultBody: (winner, result) => `${winner} venceu · ${result}.`, predictionResultTitle: (name, correct) => `${name} ${correct ? "acertou" : "fez seu palpite"}`,
    predictionResultBody: (home, homeScore, awayScore, away, choice) => `${home} ${homeScore} x ${awayScore} ${away} · escolha: ${choice}.`,
    kinds: { room: "SALA", result: "RESULTADO", prediction: "PALPITE" },
  };
}

export function shareKindLabel(kind, locale) { return dictionary(normalizeShareLocale(locale)).kinds[kind] ?? "VIRA"; }
export function shareChoiceLabel(choice, fixture, locale) { const copy = dictionary(normalizeShareLocale(locale)); return choice === "home" ? fixture.homeTeam : choice === "away" ? fixture.awayTeam : copy.draw; }

export function predictionShareCopy({ fixture, displayName, choiceLabel, editorialContext, resolvedPrediction = null }) {
  const locale = normalizeShareLocale(editorialContext?.locale);
  const copy = dictionary(locale);
  if (resolvedPrediction) return {
    metadata: { title: copy.predictionResultTitle(displayName, resolvedPrediction.correct), description: copy.predictionResultBody(fixture.homeTeam, resolvedPrediction.finalScore?.home ?? "", resolvedPrediction.finalScore?.away ?? "", fixture.awayTeam, choiceLabel), imagePath: "dynamic" },
    ctaLabel: copy.resultCta,
  };
  const relation = editorialContext?.temporalRelationAtCreation;
  const headline = relation === "today" ? copy.headlineToday : relation === "tomorrow" ? copy.headlineTomorrow : copy.headlineFixture(fixture.homeTeam, fixture.awayTeam);
  const schedule = editorialContext?.localKickoffDate ? `${editorialContext.localKickoffDate} ${copy.at} ${editorialContext.localKickoffTime}` : copy.timePending;
  return { metadata: { title: copy.picked(displayName, choiceLabel), description: copy.predictBody(headline, schedule), imagePath: "dynamic" }, ctaLabel: copy.predictionCta };
}

export function roomShareCopy({ snapshot, participant, locale, kind }) {
  const normalizedLocale = normalizeShareLocale(locale);
  const copy = dictionary(normalizedLocale);
  if (kind === "room") return {
    metadata: { title: normalizedLocale === "en" ? `${participant.displayName} is in ${snapshot.match.homeTeam.name} x ${snapshot.match.awayTeam.name}` : `${participant.displayName} está em ${snapshot.match.homeTeam.name} x ${snapshot.match.awayTeam.name}`, description: `${snapshot.match.status === "live" ? copy.live : copy.roomOpen} · ${copy.inRoom(snapshot.roomPopulation)}. ${copy.joinBody}`, imagePath: "dynamic" },
    ctaLabel: snapshot.match.status === "finished" ? copy.roomResultCta : copy.roomCta,
  };
  const result = snapshot.lastResolution;
  const winner = result?.winningOptionId === "yes" ? copy.yes : copy.no;
  return {
    metadata: { title: copy.resultTitle(participant.displayName, result?.wasCurrentUserCorrect ? copy.correct : copy.played), description: copy.resultBody(winner, result?.pointsAwarded > 0 ? copy.points(result.pointsAwarded) : copy.recorded), imagePath: "dynamic" },
    ctaLabel: snapshot.match.status === "finished" ? copy.matchCta : copy.nextCta,
  };
}
