import fs from "node:fs";
import path from "node:path";

import {
  fetchFixturesSnapshot,
  fetchHistoricalScores,
  fetchOddsSnapshot,
  fetchScoresSnapshot,
  fetchScoresUpdates,
  normalizeTxlineFixture,
} from "./txline-client.mjs";

const ENDPOINTS = [
  ["scores", fetchScoresSnapshot, "/api/scores/snapshot/:fixtureId"],
  ["updates", fetchScoresUpdates, "/api/scores/updates/:fixtureId"],
  ["historical", fetchHistoricalScores, "/api/scores/historical/:fixtureId"],
  ["odds", fetchOddsSnapshot, "/api/odds/snapshot/:fixtureId"],
];

function asRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return [];

  const directArray = Object.values(payload).find((value) => Array.isArray(value));
  if (directArray) return directArray;
  return [payload];
}

function firstDefined(record, keys) {
  for (const key of keys) {
    if (record && typeof record === "object" && record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return null;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

function eventTypeOf(record) {
  const value = firstDefined(record, [
    "Action",
    "action",
    "SuperOddsType",
    "superOddsType",
    "EventType",
    "eventType",
    "type",
    "Type",
    "GameState",
    "gameState",
    "MarketType",
    "marketType",
    "Status",
    "status",
  ]);
  return value === null ? "unknown" : String(value).toLowerCase();
}

function flattenKeys(value, prefix = "", output = new Set()) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    const firstObject = value.find((item) => item && typeof item === "object");
    if (firstObject) flattenKeys(firstObject, `${prefix}[]`, output);
    return output;
  }
  for (const [key, nested] of Object.entries(value)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    output.add(pathKey);
    if (nested && typeof nested === "object") flattenKeys(nested, pathKey, output);
  }
  return output;
}

function compactRecord(record) {
  if (!record || typeof record !== "object") return record ?? null;
  const keys = [
    "FixtureId",
    "Seq",
    "Ts",
    "MessageId",
    "Action",
    "EventType",
    "Type",
    "Status",
    "StatusId",
    "GameState",
    "Period",
    "Minute",
    "Second",
    "ParticipantId",
    "ParticipantName",
    "TeamId",
    "PlayerId",
    "PlayerName",
    "HomeScore",
    "AwayScore",
    "Score",
    "StatKey",
    "StatKey2",
    "StatName",
    "Stats",
    "SuperOddsType",
    "Bookmaker",
    "PriceNames",
    "Pct",
    "Price",
  ];
  const compact = {};
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) compact[key] = record[key];
  }
  if (Object.keys(compact).length) return compact;
  return Object.fromEntries(Object.entries(record).slice(0, 12));
}

function collectValues(records, keys, limit = 30) {
  const values = new Set();
  for (const record of records) {
    for (const key of keys) {
      const value = firstDefined(record, [key]);
      if (value !== null && value !== undefined && value !== "") values.add(String(value));
      if (values.size >= limit) return [...values].sort();
    }
  }
  return [...values].sort();
}

function collectStatKeys(records) {
  const values = new Set();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (/stat/i.test(key) && (typeof nested === "string" || typeof nested === "number")) {
        values.add(`${key}:${nested}`);
      }
      visit(nested);
    }
  }
  for (const record of records) visit(record);
  return [...values].sort().slice(0, 50);
}

function inspectSchema(payload) {
  const records = asRecords(payload);
  const keySet = new Set();
  for (const record of records.slice(0, 50)) flattenKeys(record, "", keySet);
  return {
    keys: [...keySet].sort(),
    actions: collectValues(records, ["Action", "action", "EventType", "eventType", "Type", "type"], 40),
    statuses: collectValues(records, ["Status", "status", "StatusId", "statusId", "GameState", "gameState"], 40),
    periods: collectValues(records, ["Period", "period"], 40),
    statKeys: collectStatKeys(records),
    sample: records.slice(0, 3).map(compactRecord),
  };
}

function summarizePayload(payload) {
  const records = asRecords(payload);
  const timestamps = records
    .map((record) => firstDefined(record, ["Ts", "ts", "Timestamp", "timestamp", "OccurredAt", "occurredAt", "StartTime", "startTime"]))
    .map(normalizeTimestamp)
    .filter(Boolean)
    .sort();
  const sequences = records
    .map((record) => Number(firstDefined(record, ["Seq", "seq", "Sequence", "sequence"])))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const types = new Map();
  for (const record of records) {
    const type = eventTypeOf(record);
    types.set(type, (types.get(type) ?? 0) + 1);
  }

  return {
    count: records.length,
    firstTimestamp: timestamps[0] ?? null,
    lastTimestamp: timestamps[timestamps.length - 1] ?? null,
    firstSequence: sequences[0] ?? null,
    lastSequence: sequences[sequences.length - 1] ?? null,
    eventTypes: Object.fromEntries([...types.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function usefulEventCount(endpointSummaries) {
  const scoreTypes = ["goal", "card", "red", "yellow", "period", "corner", "penalty", "substitution", "coverage", "comment"];
  const oddsTypes = ["participant_result", "participant_goals", "overunder", "asianhandicap"];
  let total = 0;
  for (const endpoint of [endpointSummaries.scores, endpointSummaries.updates, endpointSummaries.historical]) {
    if (!endpoint?.summary?.eventTypes) continue;
    for (const [type, count] of Object.entries(endpoint.summary.eventTypes)) {
      if (scoreTypes.some((candidate) => type.includes(candidate))) total += count;
    }
  }
  if (endpointSummaries.odds?.summary?.eventTypes) {
    for (const [type, count] of Object.entries(endpointSummaries.odds.summary.eventTypes)) {
      if (oddsTypes.some((candidate) => type.includes(candidate))) total += count;
    }
  }
  return total;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function inspectEndpoint({ config, fixtureId, endpointName, endpointPath, fetcher, savePayloads, captureDir }) {
  const startedAt = new Date().toISOString();
  try {
    const payload = await fetcher(config, fixtureId);
    const summary = summarizePayload(payload);
    let capturePath = null;
    if (savePayloads) {
      capturePath = path.join(captureDir, `${fixtureId}-${endpointName}.json`);
      writeJson(capturePath, {
        endpoint: endpointPath.replace(":fixtureId", fixtureId),
        fixtureId,
        capturedAt: new Date().toISOString(),
        payload,
      });
    }
    return {
      ok: true,
      status: 200,
      endpoint: endpointPath.replace(":fixtureId", fixtureId),
      startedAt,
      completedAt: new Date().toISOString(),
      summary,
      schema: inspectSchema(payload),
      capturePath,
    };
  } catch (error) {
    return {
      ok: false,
      status: error.status ?? 500,
      endpoint: endpointPath.replace(":fixtureId", fixtureId),
      startedAt,
      completedAt: new Date().toISOString(),
      error: error.message ?? "unknown_error",
      details: error.body ?? null,
      summary: {
        count: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        firstSequence: null,
        lastSequence: null,
        eventTypes: {},
      },
      schema: {
        keys: [],
        actions: [],
        statuses: [],
        periods: [],
        statKeys: [],
        sample: [],
      },
      capturePath: null,
    };
  }
}

function markdownTable(rows) {
  const lines = [
    "| Fixture | Status | Scores | Updates | Historical | Odds | Useful |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(`| ${row.fixtureId} ${row.title} | ${row.status} | ${row.scores} | ${row.updates} | ${row.historical} | ${row.odds} | ${row.usefulEvents} |`);
  }
  return lines.join("\n");
}

function endpointSchemaSection(row, endpointName) {
  const endpoint = row.endpoints[endpointName];
  const schema = endpoint?.schema;
  if (!endpoint || !schema) return "";
  return [
    `### ${row.fixtureId} ${row.title} · ${endpointName}`,
    "",
    `- Endpoint: \`${endpoint.endpoint}\``,
    `- OK: \`${endpoint.ok}\``,
    `- Records: \`${endpoint.summary.count}\``,
    `- Event types: \`${Object.entries(endpoint.summary.eventTypes).map(([type, count]) => `${type}:${count}`).join(", ") || "none"}\``,
    `- Actions: \`${schema.actions.join(", ") || "none"}\``,
    `- Statuses: \`${schema.statuses.join(", ") || "none"}\``,
    `- Periods: \`${schema.periods.join(", ") || "none"}\``,
    `- Stat keys: \`${schema.statKeys.join(", ") || "none"}\``,
    `- Keys: \`${schema.keys.slice(0, 80).join(", ") || "none"}${schema.keys.length > 80 ? ", ..." : ""}\``,
    "",
    "Sample:",
    "",
    "```json",
    JSON.stringify(schema.sample, null, 2),
    "```",
    "",
  ].join("\n");
}

function writeMarkdownReport(filePath, report) {
  const sections = [
    "# TxLINE Payload Inspection",
    "",
    `Generated at: ${report.completedAt}`,
    `Network: ${report.network}`,
    `Origin: ${report.origin}`,
    "",
    "## Fixture Matrix",
    "",
    markdownTable(report.rows),
    "",
    "## Endpoint Schemas",
    "",
    ...report.rows.flatMap((row) => ["scores", "updates", "historical", "odds"].map((endpointName) => endpointSchemaSection(row, endpointName))),
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${sections.join("\n")}\n`);
}

export async function discoverTxlineFixtures(config, options = {}) {
  const startedAt = new Date().toISOString();
  const limit = Number(options.limit ?? 20);
  const fixtureFilter = options.fixtureId ? String(options.fixtureId) : null;
  const savePayloads = Boolean(options.savePayloads);
  const captureRoot = options.captureRoot ?? path.resolve(process.cwd(), ".txline", "captures");
  const runId = options.runId ?? startedAt.replace(/[:.]/g, "-");
  const captureDir = path.join(captureRoot, runId);

  const fixturesPayload = await fetchFixturesSnapshot(config);
  const fixtures = (Array.isArray(fixturesPayload) ? fixturesPayload : [])
    .map(normalizeTxlineFixture)
    .filter((fixture) => !fixtureFilter || fixture.fixtureId === fixtureFilter)
    .slice(0, limit);

  const rows = [];
  for (const fixture of fixtures) {
    const endpoints = {};
    for (const [endpointName, fetcher, endpointPath] of ENDPOINTS) {
      endpoints[endpointName] = await inspectEndpoint({
        config,
        fixtureId: fixture.fixtureId,
        endpointName,
        endpointPath,
        fetcher,
        savePayloads,
        captureDir,
      });
    }

    rows.push({
      fixtureId: fixture.fixtureId,
      title: fixture.title,
      competitionId: fixture.raw?.CompetitionId ?? null,
      competitionLabel: fixture.competitionLabel,
      status: fixture.status,
      startTime: fixture.startTime,
      scores: endpoints.scores.summary.count,
      updates: endpoints.updates.summary.count,
      historical: endpoints.historical.summary.count,
      odds: endpoints.odds.summary.count,
      usefulEvents: usefulEventCount(endpoints),
      endpoints,
    });
  }

  const report = {
    source: "txline",
    network: config.network,
    origin: config.origin,
    startedAt,
    completedAt: new Date().toISOString(),
    fixtureCount: rows.length,
    captureDir: savePayloads ? captureDir : null,
    rows,
  };

  if (savePayloads) {
    writeJson(path.join(captureDir, "discovery-report.json"), report);
    writeMarkdownReport(path.join(captureDir, "payload-inspection.md"), report);
    writeJson(path.join(captureRoot, "latest.json"), report);
    writeMarkdownReport(path.join(captureRoot, "latest.md"), report);
  }

  return report;
}
