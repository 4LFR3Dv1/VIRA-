import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const labelIndex = args.indexOf("--label");
const label = String(labelIndex >= 0 ? args[labelIndex + 1] : "after").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "profile";
const npmExecPath = process.env.npm_execpath;

function run(commandArgs, env = process.env) {
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...commandArgs], { cwd: process.cwd(), env, stdio: "inherit" })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", commandArgs, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["run", "build"]);
run(["run", "test:browser:consumer"], { ...process.env, VIRA_COMPANION_PROFILE: label });
