import os from "node:os";
import path from "node:path";

const BLOCKED_HOSTS = new Set(["vira.snelabs.space"]);
function inside(parent, child) { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }

export function e2eModeFromEnv(env = process.env) {
  if (String(env.VIRA_E2E_ENABLED ?? "false").toLowerCase() !== "true") return Object.freeze({ enabled: false });
  const token = String(env.VIRA_E2E_TOKEN ?? "");
  const dataDir = path.resolve(String(env.VIRA_DATA_DIR ?? ""));
  const allowedHosts = String(env.VIRA_E2E_ALLOWED_HOSTS ?? "127.0.0.1,localhost").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (token.length < 32) throw new Error("e2e_ephemeral_token_required");
  if (!dataDir || !inside(os.tmpdir(), dataDir)) throw new Error("e2e_data_dir_must_be_temporary");
  if (!allowedHosts.length || allowedHosts.some((host) => BLOCKED_HOSTS.has(host))) throw new Error("e2e_host_blocked");
  return Object.freeze({ enabled: true, token, dataDir, catalogSnapshotPath: path.join(dataDir, "txline-catalog.json"), allowedHosts: new Set(allowedHosts), inputAuthority: "captured_txline_test_fixture" });
}

export function authorizeE2eRequest(mode, request) {
  if (!mode.enabled) return { ok: false, status: 404, error: "not_found" };
  const host = String(request.headers.host ?? "").split(":")[0].toLowerCase();
  if (BLOCKED_HOSTS.has(host) || !mode.allowedHosts.has(host)) return { ok: false, status: 403, error: "e2e_host_blocked" };
  if (String(request.headers["x-vira-e2e-token"] ?? "") !== mode.token) return { ok: false, status: 401, error: "e2e_token_required" };
  return { ok: true };
}
