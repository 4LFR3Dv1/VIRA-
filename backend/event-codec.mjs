import crypto from "node:crypto";

export function sha256Hex(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

export function sha256Json(value) {
  return sha256Hex(canonicalJson(value));
}

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      const item = value[key];
      if (item !== undefined) accumulator[key] = canonicalize(item);
      return accumulator;
    }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function eventHashInput(event) {
  const { eventHash, ...hashable } = event;
  return canonicalJson(hashable);
}

export function hashStoredEvent(event) {
  return sha256Hex(eventHashInput(event));
}

export function projectionHash(value) {
  return sha256Json(value);
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "headers",
  "sessiontoken",
  "sessiontokenhash",
  "txline_jwt",
  "txline_api_token",
  "x-api-token",
  "xapitoken",
]);

function sanitizeValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  return Object.keys(value).reduce((accumulator, key) => {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(normalizedKey)) return accumulator;
    if (key === "rawPayload" && typeof value[key] === "object") {
      accumulator[key] = "[redacted]";
      return accumulator;
    }
    accumulator[key] = sanitizeValue(value[key]);
    return accumulator;
  }, {});
}

export function redactInternalEvent(event) {
  if (event?.type === "answer.submitted") {
    return {
      ...event,
      payload: {
        roundId: String(event?.payload?.answer?.roundId ?? ""),
        state: "confirmed_private",
      },
    };
  }
  return {
    ...event,
    payload: sanitizeValue(event?.payload),
  };
}
