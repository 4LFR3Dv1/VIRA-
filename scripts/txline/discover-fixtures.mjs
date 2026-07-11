import { loadLocalEnv } from "../../backend/env.mjs";
import { discoverTxlineFixtures } from "../../backend/txline-discovery.mjs";
import { txlineConfigFromEnv } from "../../backend/txline-client.mjs";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
    } else {
      args.set(key, next);
      index += 1;
    }
  }
  return args;
}

function printTable(rows) {
  const table = rows.map((row) => ({
    fixture: row.fixtureId,
    status: row.status,
    competition: row.competitionLabel,
    title: row.title,
    scores: row.scores,
    updates: row.updates,
    historical: row.historical,
    odds: row.odds,
    useful: row.usefulEvents,
  }));
  console.table(table);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const config = txlineConfigFromEnv();
  const report = await discoverTxlineFixtures(config, {
    limit: Number(args.get("limit") ?? 20),
    fixtureId: args.get("fixture"),
    savePayloads: args.has("save-payloads") || args.has("save"),
  });

  printTable(report.rows);
  if (report.captureDir) {
    console.log(`Saved discovery report and payloads: ${report.captureDir}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  if (error.body) console.error(JSON.stringify(error.body, null, 2));
  process.exitCode = 1;
});
