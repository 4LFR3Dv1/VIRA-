const KNOWN = new Map([
  ["72", { canonicalCompetitionId: "world-cup", name: "World Cup", displayName: "Copa do Mundo", kind: "world_cup" }],
  ["430", { canonicalCompetitionId: "international-friendlies", name: "Friendlies", displayName: "Amistosos internacionais", kind: "friendly" }],
]);

function slug(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function inferKind(name) {
  const value = String(name).toLowerCase();
  if (/world cup/.test(value) && !/qualif/.test(value)) return "world_cup";
  if (/friendl|amistos/.test(value)) return "friendly";
  if (/qualif/.test(value)) return "qualifier";
  if (/champions|libertadores|continental/.test(value)) return "continental_cup";
  if (/league|liga|serie|division/.test(value)) return "domestic_league";
  if (/cup|copa|taça|taca/.test(value)) return "domestic_cup";
  if (/u-?\d+|youth|junior/.test(value)) return "youth";
  return value ? "other" : "unknown";
}

export function classifyCompetition(raw) {
  const providerCompetitionId = raw?.CompetitionId ?? raw?.competitionId ?? null;
  const providerName = String(raw?.Competition ?? raw?.competition ?? "").trim();
  const groupName = String(raw?.FixtureGroup ?? raw?.fixtureGroup ?? "").trim();
  const known = providerCompetitionId === null ? null : KNOWN.get(String(providerCompetitionId));
  if (known) return { providerCompetitionId: String(providerCompetitionId), ...known, authority: "registry", mapped: true, providerName: providerName || known.name };
  const name = providerName || groupName;
  if (name) return { providerCompetitionId: providerCompetitionId === null ? null : String(providerCompetitionId), canonicalCompetitionId: `provider:${providerCompetitionId ?? slug(name)}`, name, displayName: name, kind: inferKind(name), authority: "provider", mapped: false, providerName };
  return { providerCompetitionId: null, canonicalCompetitionId: null, name: "Competition not identified", displayName: "Competição não identificada", kind: "unknown", authority: "unmapped", mapped: false, providerName: "" };
}

export const competitionRegistryInternals = { inferKind, slug };
