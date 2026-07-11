import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { canonicalJson, hashStoredEvent, sha256Json } from "./event-codec.mjs";

const DEFAULT_SCHEMA_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function defaultDataDir() {
  return process.env.VIRA_DATA_DIR || path.join(process.cwd(), "data", "vira");
}

function compareByGlobalPosition(left, right) {
  return left.globalPosition - right.globalPosition;
}

export class ConcurrencyConflictError extends Error {
  constructor({ streamId, expectedStreamVersion, actualStreamVersion }) {
    super("event_stream_concurrency_conflict");
    this.status = 409;
    this.body = { streamId, expectedStreamVersion, actualStreamVersion };
  }
}

export class FileEventStore {
  constructor({ dataDir = defaultDataDir(), eventsFile = "events.jsonl" } = {}) {
    this.dataDir = dataDir;
    this.eventsPath = path.join(dataDir, eventsFile);
    this.snapshotDir = path.join(dataDir, "snapshots");
    this.quarantineDir = path.join(dataDir, "quarantine");
    this.metadataPath = path.join(dataDir, "metadata.json");
    this.events = [];
    this.eventsByStream = new Map();
    this.idempotencyByStream = new Map();
    this.streamMetadata = new Map();
    this.globalPosition = 0;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.snapshotDir, { recursive: true });
    await fs.mkdir(this.quarantineDir, { recursive: true });
    await fs.writeFile(this.eventsPath, "", { flag: "a" });
    await this.loadFromDisk();
    await this.validateOrRefreshMetadata();
    return this;
  }

  async loadFromDisk() {
    const raw = await fs.readFile(this.eventsPath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const lines = raw.split(/\r?\n/);
    const validLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      let batch;
      try {
        batch = JSON.parse(line);
      } catch (error) {
        if (index >= lines.length - 2) {
          await this.quarantineLine(line, "truncated-last-line");
          await fs.writeFile(this.eventsPath, `${validLines.join("\n")}${validLines.length ? "\n" : ""}`, "utf8");
          break;
        }
        error.message = `event_store_corrupt_line:${index + 1}:${error.message}`;
        throw error;
      }
      this.ingestPersistedBatch(batch);
      validLines.push(line);
    }
  }

  metadataFromMemory() {
    return {
      schemaVersion: DEFAULT_SCHEMA_VERSION,
      updatedAt: nowIso(),
      globalPosition: this.globalPosition,
      streams: Object.fromEntries([...this.streamMetadata.entries()].map(([streamId, metadata]) => [
        streamId,
        {
          version: metadata.version,
          headHash: metadata.headHash,
        },
      ])),
    };
  }

  async readMetadata() {
    const raw = await fs.readFile(this.metadataPath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return raw ? JSON.parse(raw) : null;
  }

  async writeMetadata() {
    const metadata = this.metadataFromMemory();
    const tmpPath = `${this.metadataPath}.tmp`;
    const handle = await fs.open(tmpPath, "w");
    try {
      await handle.writeFile(JSON.stringify(metadata, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, this.metadataPath);
    await this.syncDirectory(this.dataDir);
  }

  async validateOrRefreshMetadata() {
    const metadata = await this.readMetadata();
    if (!metadata) {
      await this.writeMetadata();
      return;
    }
    for (const [streamId, expected] of Object.entries(metadata.streams ?? {})) {
      const actual = this.streamMetadata.get(streamId) ?? { version: 0, headHash: null };
      if (actual.version < Number(expected.version ?? 0)) {
        throw new Error(`event_store_metadata_ahead_of_ledger:${streamId}`);
      }
      if (actual.version === Number(expected.version ?? 0) && actual.headHash !== (expected.headHash ?? null)) {
        throw new Error(`event_store_metadata_head_mismatch:${streamId}`);
      }
    }
    await this.writeMetadata();
  }

  async quarantineLine(line, reason) {
    const file = path.join(this.quarantineDir, `${reason}-${Date.now()}.jsonl`);
    await fs.writeFile(file, `${line}\n`);
  }

  ingestPersistedBatch(batch) {
    if (!batch || typeof batch !== "object" || !Array.isArray(batch.events)) {
      throw new Error("invalid_event_batch");
    }
    for (const event of batch.events) {
      this.ingestPersistedEvent(event);
    }
  }

  ingestPersistedEvent(event) {
    if (!event?.streamId || !event?.eventId || !event?.type) {
      throw new Error("invalid_stored_event");
    }
    const expectedHash = hashStoredEvent(event);
    if (event.eventHash !== expectedHash) {
      throw new Error(`event_hash_mismatch:${event.streamId}:${event.streamVersion}`);
    }
    const streamEvents = this.eventsByStream.get(event.streamId) ?? [];
    const previous = streamEvents[streamEvents.length - 1] ?? null;
    if ((previous?.eventHash ?? null) !== (event.previousStreamEventHash ?? null)) {
      throw new Error(`stream_hash_chain_mismatch:${event.streamId}:${event.streamVersion}`);
    }
    if (event.streamVersion !== streamEvents.length + 1) {
      throw new Error(`stream_version_gap:${event.streamId}:${event.streamVersion}`);
    }

    const storedEvent = cloneJson(event);
    this.events.push(storedEvent);
    streamEvents.push(storedEvent);
    this.eventsByStream.set(event.streamId, streamEvents);
    const idempotency = this.idempotencyByStream.get(event.streamId) ?? new Map();
    idempotency.set(event.idempotencyKey, storedEvent);
    this.idempotencyByStream.set(event.streamId, idempotency);
    this.streamMetadata.set(event.streamId, {
      version: event.streamVersion,
      headHash: event.eventHash,
    });
    this.globalPosition = Math.max(this.globalPosition, Number(event.globalPosition ?? 0));
  }

  async append(request) {
    const run = async () => this.appendLocked(request);
    const result = this.writeQueue.then(run, run);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }

  async appendLocked({ streamId, expectedStreamVersion, events }) {
    const safeStreamId = String(streamId || "");
    if (!safeStreamId) throw new Error("missing_stream_id");
    if (!Array.isArray(events) || events.length === 0) {
      const metadata = await this.getStreamMetadata(safeStreamId);
      return {
        streamId: safeStreamId,
        previousVersion: metadata.version,
        currentVersion: metadata.version,
        firstGlobalPosition: this.globalPosition,
        lastGlobalPosition: this.globalPosition,
        persistedEvents: [],
        lastEventHash: metadata.headHash,
      };
    }

    const metadata = await this.getStreamMetadata(safeStreamId);
    const expected = Number(expectedStreamVersion);
    if (!Number.isFinite(expected) || expected !== metadata.version) {
      throw new ConcurrencyConflictError({
        streamId: safeStreamId,
        expectedStreamVersion,
        actualStreamVersion: metadata.version,
      });
    }

    const previousVersion = metadata.version;
    let previousHash = metadata.headHash;
    let nextStreamVersion = previousVersion;
    let nextGlobalPosition = this.globalPosition;
    const persistedEvents = [];

    for (const pending of events) {
      const duplicate = this.idempotencyByStream.get(safeStreamId)?.get(pending.idempotencyKey);
      if (duplicate) {
        persistedEvents.push(duplicate);
        continue;
      }
      nextStreamVersion += 1;
      nextGlobalPosition += 1;
      const storedWithoutHash = {
        eventId: pending.eventId || createId("evt"),
        streamId: safeStreamId,
        roomId: String(pending.roomId || safeStreamId),
        type: pending.type,
        globalPosition: nextGlobalPosition,
        streamVersion: nextStreamVersion,
        idempotencyKey: pending.idempotencyKey,
        causationId: pending.causationId,
        correlationId: pending.correlationId || createId("corr"),
        createdAt: pending.createdAt || nowIso(),
        schemaVersion: pending.schemaVersion || DEFAULT_SCHEMA_VERSION,
        previousStreamEventHash: previousHash,
        payload: cloneJson(pending.payload ?? {}),
      };
      const stored = {
        ...storedWithoutHash,
        eventHash: hashStoredEvent(storedWithoutHash),
      };
      previousHash = stored.eventHash;
      persistedEvents.push(stored);
    }

    const newEvents = persistedEvents.filter((event) => event.globalPosition > this.globalPosition);
    if (!newEvents.length) {
      return {
        streamId: safeStreamId,
        previousVersion,
        currentVersion: metadata.version,
        firstGlobalPosition: this.globalPosition,
        lastGlobalPosition: this.globalPosition,
        persistedEvents,
        lastEventHash: metadata.headHash,
      };
    }

    const batch = {
      batchId: createId("batch"),
      streamId: safeStreamId,
      expectedStreamVersion: expected,
      previousVersion,
      currentVersion: newEvents[newEvents.length - 1].streamVersion,
      firstGlobalPosition: newEvents[0].globalPosition,
      lastGlobalPosition: newEvents[newEvents.length - 1].globalPosition,
      createdAt: nowIso(),
      schemaVersion: DEFAULT_SCHEMA_VERSION,
      events: newEvents,
    };
    const batchWithHash = {
      ...batch,
      batchHash: sha256Json(batch),
    };
    await this.appendLine(`${canonicalJson(batchWithHash)}\n`);
    this.ingestPersistedBatch(batchWithHash);
    await this.writeMetadata();

    return {
      streamId: safeStreamId,
      previousVersion,
      currentVersion: batchWithHash.currentVersion,
      firstGlobalPosition: batchWithHash.firstGlobalPosition,
      lastGlobalPosition: batchWithHash.lastGlobalPosition,
      persistedEvents,
      lastEventHash: newEvents[newEvents.length - 1].eventHash,
    };
  }

  async appendLine(line) {
    const handle = await fs.open(this.eventsPath, "a");
    try {
      await handle.writeFile(line, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.syncDirectory(this.dataDir);
  }

  async syncDirectory(directoryPath) {
    const handle = await fs.open(directoryPath, "r").catch(() => null);
    if (!handle) return;
    try {
      await handle.sync().catch(() => undefined);
    } finally {
      await handle.close();
    }
  }

  async *readAll(afterGlobalPosition = 0) {
    const after = Number(afterGlobalPosition) || 0;
    for (const event of [...this.events].sort(compareByGlobalPosition)) {
      if (event.globalPosition > after) yield event;
    }
  }

  async *readStream(streamId, afterVersion = 0) {
    const after = Number(afterVersion) || 0;
    for (const event of [...(this.eventsByStream.get(String(streamId)) ?? [])].sort((left, right) => left.streamVersion - right.streamVersion)) {
      if (event.streamVersion > after) yield event;
    }
  }

  async findByIdempotencyKey(streamId, key) {
    return this.idempotencyByStream.get(String(streamId))?.get(String(key)) ?? null;
  }

  async getStreamMetadata(streamId) {
    return this.streamMetadata.get(String(streamId)) ?? {
      version: 0,
      headHash: null,
    };
  }

  async checkWritable() {
    const probePath = path.join(this.dataDir, `.readiness-${process.pid}-${crypto.randomUUID()}`);
    try {
      const handle = await fs.open(probePath, "wx");
      try {
        await handle.writeFile("ready", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.unlink(probePath);
      return { ok: true, dataDir: this.dataDir };
    } catch (error) {
      await fs.unlink(probePath).catch(() => undefined);
      return { ok: false, dataDir: this.dataDir, error: error.message || "event_store_not_writable" };
    }
  }

  info() {
    return {
      adapter: "file",
      dataDir: this.dataDir,
      eventsPath: this.eventsPath,
      metadataPath: this.metadataPath,
      globalPosition: this.globalPosition,
      streamCount: this.streamMetadata.size,
    };
  }
}

export async function createFileEventStore(options = {}) {
  return new FileEventStore(options).init();
}
