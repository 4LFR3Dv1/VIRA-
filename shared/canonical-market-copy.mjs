const SUPPORTED_SELECTIONS = new Set(["part1", "draw", "part2", "over", "under"]);

export function canonicalMarketSelection(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return SUPPORTED_SELECTIONS.has(normalized) ? normalized : null;
}

export function canonicalMarketSelectionLabel(selection, { locale = "en", homeTeam = null, awayTeam = null } = {}) {
  const canonical = canonicalMarketSelection(selection);
  const portuguese = locale === "pt-BR";
  if (canonical === "part1") return homeTeam || (portuguese ? "Casa" : "Home");
  if (canonical === "part2") return awayTeam || (portuguese ? "Visitante" : "Away");
  if (canonical === "draw") return portuguese ? "Empate" : "Draw";
  if (canonical === "over") return portuguese ? "Mais" : "Over";
  if (canonical === "under") return portuguese ? "Menos" : "Under";
  return null;
}

export function canonicalOutcomeSelection(value) {
  if (value === "home") return "part1";
  if (value === "away") return "part2";
  return value === "draw" ? "draw" : null;
}
