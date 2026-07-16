const POSITIONS = new Set(["semi_final:1", "semi_final:2", "third_place:1", "final:1"]);

export const WORLD_CUP_JOURNEY_MANIFEST_V1 = deepFreeze({
  schemaVersion: 1,
  tournamentId: "world-cup-2026",
  manifestVersion: "world-cup-2026-v1",
  fixtures: [
    { fixtureId: "18237038", stage: "semi_final", slot: 1 },
    { fixtureId: "18241006", stage: "semi_final", slot: 2 },
    { fixtureId: "18257865", stage: "third_place", slot: 1 },
    { fixtureId: "18257739", stage: "final", slot: 1 },
  ],
});

export function validateTournamentJourneyManifestV1(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.manifestVersion !== "string") throw new Error("invalid_tournament_manifest");
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 4) throw new Error("invalid_tournament_positions");
  const ids = new Set();
  const positions = new Set();
  for (const item of manifest.fixtures) {
    const keys = Object.keys(item).sort().join(",");
    if (keys !== "fixtureId,slot,stage") throw new Error("manifest_contains_result_data");
    const fixtureId = String(item.fixtureId ?? "");
    const position = `${item.stage}:${item.slot}`;
    if (!fixtureId || ids.has(fixtureId) || positions.has(position) || !POSITIONS.has(position)) throw new Error("invalid_tournament_position");
    ids.add(fixtureId); positions.add(position);
  }
  if ([...POSITIONS].some((position) => !positions.has(position))) throw new Error("missing_tournament_position");
  return manifest;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

validateTournamentJourneyManifestV1(WORLD_CUP_JOURNEY_MANIFEST_V1);
