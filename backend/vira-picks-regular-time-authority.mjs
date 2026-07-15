import { canonicalHash } from "./vira-picks-market.mjs";
import { cloneFrozen } from "./vira-picks-contracts.mjs";

const TERMINAL_STATUS_IDS = new Set([5, 10, 13]);
const REGULAR_TIME_BOUNDARY_STATUS_IDS = new Set([6, 7, 11, 12]);

function statusIdOf(record) {
  const value = record?.Data?.StatusId ?? record?.data?.statusId ?? record?.StatusId ?? record?.statusId;
  return Number.isInteger(Number(value)) ? Number(value) : null;
}

function sequenceOf(record, fallback) {
  const value = record?.RevId ?? record?.RevisionId ?? record?.Sequence ?? record?.sequence;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function timestampOf(record) {
  const value = record?.Ts ?? record?.timestamp ?? record?.Data?.Ts;
  if (typeof value === "number") return new Date(value).toISOString();
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function scoreOf(record) {
  const source = record?.Data?.Score?.AbsoluteScore ?? record?.Data?.AbsoluteScore ?? record?.absoluteScore ?? record?.score;
  if (!source || typeof source !== "object") return null;
  const home = source.Participant1 ?? source.Home ?? source.home;
  const away = source.Participant2 ?? source.Away ?? source.away;
  if (!Number.isInteger(Number(home)) || !Number.isInteger(Number(away)) || Number(home) < 0 || Number(away) < 0) return null;
  return { home: Number(home), away: Number(away) };
}

export function deriveRegularTimeScoreAuthorityV1({ fixtureId, records, historyComplete, freshness, receivedAt, acquisitionOrigin = "txline:scores?Ts=0" }) {
  if (!historyComplete || freshness !== "fresh" || !Array.isArray(records) || records.length === 0) return null;
  const ordered = records.map((record, index) => ({ record, sequence: sequenceOf(record, index), index })).sort((a, b) => a.sequence - b.sequence || a.index - b.index);
  const terminal = [...ordered].reverse().find(({ record }) => TERMINAL_STATUS_IDS.has(statusIdOf(record)));
  if (!terminal) return null;
  const terminalStatusId = statusIdOf(terminal.record);
  const boundary = ordered.find(({ record }) => REGULAR_TIME_BOUNDARY_STATUS_IDS.has(statusIdOf(record)));
  let scoreRecord;
  let path;
  if (terminalStatusId === 5 && !boundary) {
    scoreRecord = terminal;
    path = "finished_in_regular_time";
  } else {
    if (!boundary) return null;
    scoreRecord = [...ordered].reverse().find((item) => item.sequence <= boundary.sequence && scoreOf(item.record));
    path = terminalStatusId === 13 ? "historical_before_penalties" : "historical_before_extra_time";
  }
  const regularTimeScore = scoreRecord ? scoreOf(scoreRecord.record) : null;
  const observedAt = timestampOf(terminal.record);
  if (!regularTimeScore || !observedAt || !receivedAt || !Number.isFinite(Date.parse(receivedAt))) return null;
  const body = {
    schemaVersion: 1,
    authority: "txline_regular_time_score",
    fixtureId: String(fixtureId),
    status: "final",
    path,
    regularTimeScore,
    terminalStatusId,
    scoreEventSequence: scoreRecord.sequence,
    boundaryEventSequence: boundary?.sequence ?? terminal.sequence,
    providerSequence: terminal.sequence,
    observedAt,
    receivedAt: new Date(receivedAt).toISOString(),
    acquisitionOrigin,
    freshness: "fresh",
    historyComplete: true,
  };
  const hash = canonicalHash(body);
  return cloneFrozen({ ...body, id: `regular_time_${hash.slice(0, 24)}`, canonicalHash: hash });
}

export function verifyRegularTimeScoreAuthorityV1(authority, fixtureId, { now = Date.now(), freshMs = 5 * 60 * 1000 } = {}) {
  if (!authority || authority.authority !== "txline_regular_time_score" || authority.schemaVersion !== 1 || authority.status !== "final" || authority.freshness !== "fresh" || authority.historyComplete !== true || String(authority.fixtureId) !== String(fixtureId)) return false;
  const body = Object.fromEntries(Object.entries(authority).filter(([key]) => !["id", "canonicalHash"].includes(key)));
  const age = now - Date.parse(authority.receivedAt);
  return Number.isFinite(age) && age >= -60_000 && age <= freshMs && /^[a-f0-9]{64}$/.test(String(authority.canonicalHash ?? "")) && canonicalHash(body) === authority.canonicalHash;
}
