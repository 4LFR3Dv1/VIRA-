import { hasTxlineCredentials, normalizeTxlineOdds, normalizeTxlineScore } from "./txline-client.mjs";

function parseSseBlock(block) {
  const message = { data: "" };
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? "" : rawLine.slice(separatorIndex + 1).replace(/^ /, "");
    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }
  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

function parseSseData(data) {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

async function* readSseMessages(response) {
  if (!response.body) throw new Error("stream_response_has_no_body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const message = parseSseBlock(block);
        if (message) yield message;
        separator = buffer.match(/\r?\n\r?\n/);
      }
    }

    buffer += decoder.decode();
    const message = parseSseBlock(buffer);
    if (message) yield message;
  } finally {
    reader.releaseLock();
  }
}

export function createTxlineStreamManager({ config, runtime }) {
  const streams = new Map();

  function streamKey(roomId, kind) {
    return `${roomId}:${kind}`;
  }

  function singleStatus(roomId, kind) {
    const stream = streams.get(streamKey(roomId, kind));
    if (!stream) {
      return {
        connected: false,
        status: "idle",
        kind,
      };
    }
    return {
      connected: stream.status === "running",
      status: stream.status,
      kind: stream.kind,
      fixtureId: stream.fixtureId,
      endpoint: stream.endpoint,
      acceptedMessages: stream.acceptedMessages,
      ignoredMessages: stream.ignoredMessages,
      lastMessageAt: stream.lastMessageAt,
      lastError: stream.lastError,
      startedAt: stream.startedAt,
    };
  }

  function status(roomId) {
    return {
      scores: singleStatus(roomId, "scores"),
      odds: singleStatus(roomId, "odds"),
    };
  }

  function stop(roomId, kind = null) {
    if (!kind) {
      for (const streamKind of ["scores", "odds"]) stop(roomId, streamKind);
      return status(roomId);
    }
    const key = streamKey(roomId, kind);
    const stream = streams.get(key);
    if (!stream) return singleStatus(roomId, kind);
    stream.status = "stopped";
    stream.controller.abort();
    streams.delete(key);
    runtime.emit(roomId, "txline.stream_stopped", { roomId, kind });
    return singleStatus(roomId, kind);
  }

  async function startStream(roomId, {
    kind,
    fixtureId = config.fixtureId,
    endpointPath,
    normalize,
  }) {
    if (!hasTxlineCredentials(config)) {
      const error = new Error("missing_txline_credentials");
      error.status = 503;
      throw error;
    }
    const key = streamKey(roomId, kind);
    if (streams.has(key)) {
      return singleStatus(roomId, kind);
    }

    const controller = new AbortController();
    const endpoint = `${config.origin}${endpointPath}`;
    const streamState = {
      kind,
      status: "running",
      fixtureId: fixtureId || null,
      endpoint,
      controller,
      startedAt: new Date().toISOString(),
      lastMessageAt: null,
      lastError: null,
      acceptedMessages: 0,
      ignoredMessages: 0,
    };
    streams.set(key, streamState);
    runtime.emit(roomId, "txline.stream_started", singleStatus(roomId, kind));

    void (async () => {
      try {
        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${config.jwt}`,
            "X-Api-Token": config.apiToken,
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`txline_${kind}_stream_failed:${response.status}`);
        }

        for await (const message of readSseMessages(response)) {
          if (streamState.status !== "running") break;
          const parsed = parseSseData(message.data);
          const events = Array.isArray(parsed) ? parsed : [parsed];
          for (const rawEvent of events) {
            if (!rawEvent || typeof rawEvent !== "object") continue;
            const normalized = normalize(rawEvent, { matchId: fixtureId || roomId, sequenceFallback: Number(message.id || 0) });
            if (fixtureId && String(normalized.matchId) !== String(fixtureId)) continue;
            streamState.lastMessageAt = new Date().toISOString();
            streamState.acceptedMessages += 1;
            await runtime.applyNormalizedEvent(roomId, {
              ...normalized,
              payload: {
                ...normalized.payload,
                txlineEndpoint: endpointPath,
                txlineStreamKind: kind,
              },
            }, {
              endpoint: endpointPath,
              httpMethod: "GET",
              httpStatus: 200,
              receivedAt: streamState.lastMessageAt,
              rawPayload: rawEvent,
            });
          }
        }
      } catch (error) {
        if (streamState.status !== "stopped") {
          streamState.status = "failed";
          streamState.lastError = error.message || "txline_stream_error";
          runtime.emit(roomId, "txline.stream_failed", singleStatus(roomId, kind));
        }
      }
    })();

    return singleStatus(roomId, kind);
  }

  async function startScores(roomId, { fixtureId = config.fixtureId } = {}) {
    return startStream(roomId, {
      kind: "scores",
      fixtureId,
      endpointPath: "/api/scores/stream",
      normalize: (rawEvent, options) => normalizeTxlineScore(rawEvent, { ...options, source: "txline-live" }),
    });
  }

  async function startOdds(roomId, { fixtureId = config.fixtureId } = {}) {
    return startStream(roomId, {
      kind: "odds",
      fixtureId,
      endpointPath: "/api/odds/stream",
      normalize: (rawEvent, options) => normalizeTxlineOdds(rawEvent, { ...options, source: "txline-live" }),
    });
  }

  return {
    startScores,
    startOdds,
    stop,
    status,
  };
}
