import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => JSON.stringify(sortValue(value));
const hash = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

export class TournamentJourneyStore {
  constructor({ dataDir = process.env.VIRA_DATA_DIR || path.join(process.cwd(), "data", "vira") } = {}) {
    this.filePath = path.join(dataDir, "tournament-journey.json");
    this.tempPath = `${this.filePath}.tmp`;
    this.state = { schemaVersion: 1, fixtures: {} };
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const raw = await fs.readFile(this.filePath, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.schemaVersion !== 1 || !parsed.fixtures) throw new Error("invalid_tournament_journey_store");
      this.state = parsed;
    }
    return this;
  }

  async record({ fixtureId, payload, origin, observedAt, receivedAt = new Date().toISOString(), providerSequence = null, freshness = "unknown", projection = null, result = null }) {
    const id = String(fixtureId);
    if (!id || !payload || !origin) throw new Error("invalid_tournament_fixture_observation");
    const observation = { payload: clone(payload), origin: String(origin), observedAt: observedAt ?? null, receivedAt, providerSequence, freshness, canonicalHash: hash(payload) };
    return this.mutate((state) => {
      const previous = state.fixtures[id] ?? { fixtureId: id, observations: [] };
      const duplicate = previous.observations?.some((item) => item.canonicalHash === observation.canonicalHash && item.origin === observation.origin);
      const observations = duplicate ? previous.observations : [...(previous.observations ?? []), observation].slice(-24);
      state.fixtures[id] = {
        ...previous,
        fixtureId: id,
        projection: projection ? clone(projection) : previous.projection ?? null,
        result: result ? clone(result) : previous.result ?? null,
        observations,
        updatedAt: duplicate && !projection && !result ? previous.updatedAt : receivedAt,
      };
      return state.fixtures[id];
    });
  }

  get(fixtureId) { return clone(this.state.fixtures[String(fixtureId)] ?? null); }
  all() { return clone(this.state.fixtures); }

  async mutate(operation) {
    const run = this.queue.then(async () => {
      const draft = clone(this.state);
      const result = await operation(draft);
      await fs.writeFile(this.tempPath, JSON.stringify(draft), "utf8");
      await fs.rename(this.tempPath, this.filePath);
      this.state = draft;
      return clone(result);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export async function createTournamentJourneyStore(options) { return new TournamentJourneyStore(options).init(); }
export const tournamentJourneyHash = hash;
