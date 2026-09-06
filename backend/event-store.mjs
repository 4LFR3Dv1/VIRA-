import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { canonicalJson, hashStoredEvent, sha256Json } from "./event-codec.mjs";

const DEFAULT_SCHEMA_VERSION = 1;
const DEFAULT_BLOOM_BYTES = 8 * 1024 * 1024;
const MIN_BLOOM_BYTES = 1024 * 1024;
const MAX_BLOOM_BYTES = 32 * 1024 * 1024;
const DEFAULT_RECENT_IDEMPOTENCY_LIMIT = 2048;

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

function boundedInteger(raw, fallback, min, max) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function bloomBytesFromEnv() {
  return boundedInteger(
    process.env.VIRA_IDEMPOTENCY_BLOOM_BYTES,
    DEFAULT_BLOOM_BYTES,
    MIN_BLOOM_BYTES,
    MAX_BLOOM_BYTES,
  );
}

function recentIdempotencyLimitFromEnv() {
  return boundedInteger(
    process.env.VIRA_RECENT_IDEMPOTENCY_LIMIT,
    DEFAULT_RECENT_IDEMPOTENCY_LIMIT,
    128,
    16384,
  );
}

function idempotencyFingerprint(streamId, key) {
  return `${String(streamId)}\u0000${String(key ?? "")}`;
}

function hash32(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

class IdempotencyBloom {
  constructor(byteLength = DEFAULT_BLOOM_BYTES) {
    this.bytes = new Uint8Array(byteLength);
    this.bitCount = this.bytes.byteLength * 8;
  }

  reset() {
    this.bytes.fill(0);
  }

  positions(value) {
    const first = hash32(value, 0x811c9dc5);
    const second = (hash32(value, 0x9e3779b9) | 1) >>> 0;
    const positions = [];
    for (let index = 0; index < 4; index += 1) {
      positions.push(((first + Math.imul(index, second)) >>> 0) % this.bitCount);
    }
    return positions;
  }

  add(value) {
    for (const position of this.positions(value)) {
      this.bytes[position >>> 3] |= 1 << (position & 7);
    }
  }

  mightContain(value) {
    for (const position of this.positions(value)) {
      if ((this.bytes[position >>> 3] & (1 << (position & 7))) === 0) return false;
    }
    return true;
  }
}

async function* readLines(filePath) {
  const stream = createReadStream(filePath);
  let remainder = Buffer.alloc(0);
  let baseOffset = 0;
  let lineNumber = 0;

  for await (const chunk of stream) {
    const buffer = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
    let start = 0;
    while (start < buffer.length) {
      const newline = buffer.indexOf(0x0a, start);
      if (newline < 0) break;
      let line = buffer.subarray(start, newline);
      if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
      lineNumber += 1;
      yield {
        lineNumber,
        startOffset: baseOffset + start,
        endOffset: baseOffset + newline + 1,
        terminated: true,
        text: line.toString("utf8"),
      };
      start = newline + 1;
    }
    baseOffset += start;
    remainder = buffer.subarray(start);
  }

  if (remainder.length) {
    lineNumber += 1;
    let line = remainder;
    if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
    yield {
      lineNumber,
      startOffset: baseOffset,
      endOffset: baseOffset + remainder.length,
      terminated: false,
      text: line.toString("utf8"),
    };
  }
}

export class ConcurrencyConflictError extends Error {
  constructor({ streamId, expectedStreamVersion, actualStreamVersion }) {
    super("event_stream_concurrency_conflict");
    this.status = 409;
    this.body = { streamId, expectedStreamVersion, actualStreamVersion };
  }
}

export class FileEventStore {
  constructor({
    dataDir = defaultDataDir(),
    eventsFile = "events.jsonl",
    bloomBytes = bloomBytesFromEnv(),
    recentIdempotencyLimit = recentIdempotencyLimitFromEnv(),
  } = {}) {
    this.dataDir = dataDir;
    this.eventsPath = path.join(dataDir, eventsFile);
    this.snapshotDir = path.join(dataDir, "snapshots");
    this.quarantineDir = path.join(dataDir, "quarantine");
    this.metadataPath = path.join(dataDir, "metadata.json");
    this.streamMetadata = new Map();
    this.globalPosition = 0;
    this.writeQueue = Promise.resolve();
    this.idempotencyBloom = new IdempotencyBloom(boundedInteger(
      bloomBytes,
      DEFAULT_BLOOM_BYTES,
      MIN_BLOOM_BYTES,
      MAX_BLOOM_BYTES,
    ));
    this.recentIdempotencyLimit = boundedInteger(
      recentIdempotencyLimit,
      DEFAULT_RECENT_IDEMPOTENCY_LIMIT,
      128,
      16384,
    );
    this.recentIdempotency = new Map();
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

  resetIndexes() {
    this.streamMetadata.clear();
    this.globalPosition = 0;
    this.idempotencyBloom.reset();
    this.recentIdempotency.clear();
  }

  async loadFromDisk() {
    this.resetIndexes();
    let pending = null;

    for await (const record of readLines(this.eventsPath)) {
      if (pending) await this.ingestLine(pending, false);
      pending = record;
    }

    if (pending) await this.ingestLine(pending, true);
  }

  async ingestLine(record, terminal) {
    if (!record.text.trim()) return;
    let batch;
    try {
      batch = JSON.parse(record.text);
    } catch (error) {
      if (terminal) {
        await this.quarantineLine(record.text, "truncated-last-line");
        await fs.truncate(this.eventsPath, record.startOffset);
        await this.syncDirectory(this.dataDir);
        return;
      }
      error.message = `event_store_corrupt_line:${record.lineNumber}:${error.message}`;
      throw error;
    }
    this.ingestPersistedBatch(batch);
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
    for (const event of batch.events) this.ingestPersistedEvent(event);
  }

  ingestPersistedEvent(event) {
    if (!event?.streamId || !event?.eventId || !event?.type) {
      throw new Error("invalid_stored_event");
    }
    const expectedHash = hashStoredEvent(event);
    if (event.eventHash !== expectedHash) {
      throw new Error(`event_hash_mismatch:${event.streamId}:${event.streamVersion}`);
    }
    const metadata = this.streamMetadata.get(event.streamId) ?? { version: 0, headHash: null };
    if (metadata.headHash !== (event.previousStreamEventHash ?? null)) {
      throw new Error(`stream_hash_chain_mismatch:${event.streamId}:${event.streamVersion}`);
    }
    if (event.streamVersion !== metadata.version + 1) {
      throw new Error(`stream_version_gap:${event.streamId}:${event.streamVersion}`);
    }
    const globalPosition = Number(event.globalPosition ?? 0);
    if (!Number.isSafeInteger(globalPosition) || globalPosition <= this.globalPosition) {
      throw new Error(`global_position_invalid:${event.streamId}:${event.streamVersion}:${event.globalPosition}`);
    }
    this.streamMetadata.set(event.streamId, {
      version: event.streamVersion,
      headHash: event.eventHash,
    });
    this.globalPosition = globalPosition;
    this.idempotencyBloom.add(idempotencyFingerprint(event.streamId, event.idempotencyKey));
  }

  rememberIdempotency(event) {
    const key = idempotencyFingerprint(event.streamId, event.idempotencyKey);
    if (this.recentIdempotency.has(key)) this.recentIdempotency.delete(key);
    this.recentIdempotency.set(key, cloneJson(event));
    while (this.recentIdempotency.size > this.recentIdempotencyLimit) {
      const oldest = this.recentIdempotency.keys().next().value;
      this.recentIdempotency.delete(oldest);
    }
  }

  recentIdempotencyEvent(streamId, key) {
    const fingerprint = idempotencyFingerprint(streamId, key);
    const event = this.recentIdempotency.get(fingerprint);
    if (!event) return null;
    this.recentIdempotency.delete(fingerprint);
    this.recentIdempotency.set(fingerprint, event);
    return cloneJson(event);
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
    const newEvents = [];
    const batchIdempotency = new Map();

    for (const pending of events) {
      const idempotencyKey = String(pending.idempotencyKey ?? "");
      let duplicate = batchIdempotency.get(idempotencyKey) ?? null;
      if (!duplicate) duplicate = await this.findByIdempotencyKey(safeStreamId, idempotencyKey);
      if (duplicate) {
        persistedEvents.push(duplicate);
        batchIdempotency.set(idempotencyKey, duplicate);
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
      newEvents.push(stored);
      batchIdempotency.set(idempotencyKey, stored);
    }

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
    for (const event of newEvents) this.rememberIdempotency(event);
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

  async *readBatches() {
    for await (const record of readLines(this.eventsPath)) {
      if (!record.text.trim()) continue;
      let batch;
      try {
        batch = JSON.parse(record.text);
      } catch (error) {
        error.message = `event_store_corrupt_line:${record.lineNumber}:${error.message}`;
        throw error;
      }
      if (!batch || typeof batch !== "object" || !Array.isArray(batch.events)) {
        throw new Error(`invalid_event_batch:${record.lineNumber}`);
      }
      yield batch;
    }
  }

  async *readAll(afterGlobalPosition = 0) {
    const after = Number(afterGlobalPosition) || 0;
    for await (const batch of this.readBatches()) {
      for (const event of batch.events) {
        if (Number(event.globalPosition) > after) yield cloneJson(event);
      }
    }
  }

  async *readStream(streamId, afterVersion = 0) {
    const safeStreamId = String(streamId);
    const after = Number(afterVersion) || 0;
    for await (const batch of this.readBatches()) {
      for (const event of batch.events) {
        if (event.streamId === safeStreamId && Number(event.streamVersion) > after) yield cloneJson(event);
      }
    }
  }

  async findByIdempotencyKey(streamId, key) {
    const safeStreamId = String(streamId);
    const safeKey = String(key ?? "");
    const recent = this.recentIdempotencyEvent(safeStreamId, safeKey);
    if (recent) return recent;
    const fingerprint = idempotencyFingerprint(safeStreamId, safeKey);
    if (!this.idempotencyBloom.mightContain(fingerprint)) return null;
    for await (const event of this.readStream(safeStreamId)) {
      if (String(event.idempotencyKey ?? "") !== safeKey) continue;
      this.rememberIdempotency(event);
      return event;
    }
    return null;
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
      retention: "disk_streamed",
      dataDir: this.dataDir,
      eventsPath: this.eventsPath,
      metadataPath: this.metadataPath,
      globalPosition: this.globalPosition,
      streamCount: this.streamMetadata.size,
      bloomBytes: this.idempotencyBloom.bytes.byteLength,
      recentIdempotencyEntries: this.recentIdempotency.size,
    };
  }
}

export async function createFileEventStore(options = {}) {
  return new FileEventStore(options).init();
}
