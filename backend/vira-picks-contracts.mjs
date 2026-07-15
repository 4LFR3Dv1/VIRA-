export const VIRA_PICKS_SCHEMA_VERSION = 1;
const kinds = new Set(["match_result", "total_goals", "both_teams_score"]);
const selections = { match_result: new Set(["home", "draw", "away"]), total_goals: new Set(["over", "under"]), both_teams_score: new Set(["yes", "no"]) };

export function cloneFrozen(value) {
  const cloned = structuredClone(value);
  const freeze = (item) => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
    return item;
  };
  return freeze(cloned);
}

export function canonicalSelectionId(selection) {
  if (selection.kind === "match_result") return `match_result:${selection.selection}`;
  if (selection.kind === "total_goals") return `total_goals:2.5:${selection.selection}`;
  return `both_teams_score:${selection.selection}`;
}

export function selectionFromCanonicalId(value) {
  const parts = String(value).split(":");
  if (parts[0] === "match_result" && parts.length === 2) return validateSelection({ kind: parts[0], period: "regular_time", selection: parts[1], resolverVersion: 1 });
  if (parts[0] === "total_goals" && parts[1] === "2.5" && parts.length === 3) return validateSelection({ kind: parts[0], period: "regular_time", line: 2.5, selection: parts[2], resolverVersion: 1 });
  if (parts[0] === "both_teams_score" && parts.length === 2) return validateSelection({ kind: parts[0], period: "regular_time", selection: parts[1], resolverVersion: 1 });
  throw Object.assign(new Error("unknown_pick_selection"), { status: 400 });
}

export function validateSelection(input) {
  if (!input || typeof input !== "object" || !kinds.has(input.kind)) throw Object.assign(new Error("unknown_pick_kind"), { status: 400 });
  if (input.period !== "regular_time" || input.resolverVersion !== 1 || !selections[input.kind].has(input.selection)) throw Object.assign(new Error("invalid_pick_selection"), { status: 400 });
  const keys = Object.keys(input).sort().join(",");
  const expected = input.kind === "total_goals" ? "kind,line,period,resolverVersion,selection" : "kind,period,resolverVersion,selection";
  if (keys !== expected || (input.kind === "total_goals" && input.line !== 2.5)) throw Object.assign(new Error("invalid_pick_contract"), { status: 400 });
  return cloneFrozen(input);
}

export function validateSelections(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) throw Object.assign(new Error("picks_count_out_of_range"), { status: 400 });
  const parsed = input.map((item) => typeof item === "string" ? selectionFromCanonicalId(item) : validateSelection(item));
  if (new Set(parsed.map((item) => item.kind)).size !== parsed.length) throw Object.assign(new Error("duplicate_pick_kind"), { status: 400 });
  return cloneFrozen(parsed);
}

export function publicPicksCard(card, { revealSelections = true } = {}) {
  return cloneFrozen({
    schemaVersion: 1, id: card.id, publicCode: card.publicCode, fixtureId: card.fixtureId,
    publicId: card.publicId, displayName: card.displayName,
    selections: revealSelections ? card.selections : [], selectionsHiddenUntilLock: !revealSelections,
    status: card.status, confirmedAt: card.confirmedAt, locksAt: card.locksAt,
    ...(card.resolvedAt ? { resolvedAt: card.resolvedAt } : {}), locale: card.locale,
    timeZone: card.timeZone, resolutionPolicyVersion: 1,
    ...(revealSelections && card.results ? { results: card.results } : {}),
  });
}
