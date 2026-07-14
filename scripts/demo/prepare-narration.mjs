import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAP_PATH = path.join(ROOT, "scripts", "demo", "voice-timeline.json");
const OUTPUT_DIR = path.join(ROOT, "artifacts", "submission", "audio");
const NORMALIZED_PATH = path.join(OUTPUT_DIR, "vira-demo-narration-global-48k-mono.wav");
const ALIGNED_PATH = path.join(OUTPUT_DIR, "vira-demo-narration-aligned-48k-mono.wav");
const REPORT_PATH = path.join(OUTPUT_DIR, "vira-demo-narration-report.json");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function run(args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(ffmpegPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`ffmpeg exited with ${code}\n${stderr.slice(-8000)}`)));
  });
}

function loudnessJson(stderr) {
  const matches = [...stderr.matchAll(/\{[\s\S]*?"input_i"[\s\S]*?\}/g)];
  if (!matches.length) throw new Error("Unable to read FFmpeg loudnorm analysis.");
  return JSON.parse(matches.at(-1)[0]);
}

async function analyze(input, targets) {
  const result = await run([
    "-hide_banner", "-i", input, "-vn",
    "-af", `loudnorm=I=${targets.integratedLufs}:TP=${targets.truePeakDbtp}:LRA=${targets.loudnessRangeLu}:print_format=json`,
    "-f", "null", "-",
  ]);
  return loudnessJson(result.stderr);
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function main() {
  const map = JSON.parse(await readFile(MAP_PATH, "utf8"));
  const source = path.resolve(ROOT, argument("input", map.source));
  const targets = map.normalization;
  await mkdir(OUTPUT_DIR, { recursive: true });

  const measuredOriginal = await analyze(source, targets);
  const loudnorm = [
    `loudnorm=I=${targets.integratedLufs}`,
    `TP=${targets.truePeakDbtp}`,
    `LRA=${targets.loudnessRangeLu}`,
    `measured_I=${measuredOriginal.input_i}`,
    `measured_TP=${measuredOriginal.input_tp}`,
    `measured_LRA=${measuredOriginal.input_lra}`,
    `measured_thresh=${measuredOriginal.input_thresh}`,
    `offset=${measuredOriginal.target_offset}`,
    "linear=true",
    "print_format=summary",
  ].join(":");

  // This is the only MP3 -> PCM conversion. A valid existing global master is reused.
  if (!existsSync(NORMALIZED_PATH)) {
    await run([
      "-y", "-hide_banner", "-i", source, "-vn", "-af", loudnorm,
      "-ar", String(map.audio.sampleRate), "-ac", String(map.audio.channels),
      "-c:a", map.audio.codec, NORMALIZED_PATH,
    ]);
  }

  const splitLabels = map.blocks.map((_, index) => `[s${index}]`).join("");
  const filters = [`[0:a]asplit=${map.blocks.length}${splitLabels}`];
  map.blocks.forEach((block, index) => {
    const delayMs = Math.round(block.timelineStart * 1000);
    filters.push(`[s${index}]atrim=start=${block.sourceStart}:end=${block.sourceEnd},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[b${index}]`);
  });
  const blockLabels = map.blocks.map((_, index) => `[b${index}]`).join("");
  filters.push(`[1:a]atrim=end=${map.durationSeconds},asetpts=PTS-STARTPTS[silence]`);
  filters.push(`${blockLabels}[silence]amix=inputs=${map.blocks.length + 1}:duration=longest:dropout_transition=0:normalize=0,atrim=end=${map.durationSeconds}[aligned]`);

  // Alignment only: no gain, loudnorm, compression or per-segment normalization is applied here.
  await run([
    "-y", "-hide_banner", "-i", NORMALIZED_PATH,
    "-f", "lavfi", "-t", String(map.durationSeconds), "-i", `anullsrc=r=${map.audio.sampleRate}:cl=mono`,
    "-filter_complex", filters.join(";"), "-map", "[aligned]",
    "-t", String(map.durationSeconds),
    "-ar", String(map.audio.sampleRate), "-ac", String(map.audio.channels),
    "-c:a", map.audio.codec, ALIGNED_PATH,
  ]);

  const [measuredNormalized, measuredAligned, normalizedStat, alignedStat] = await Promise.all([
    analyze(NORMALIZED_PATH, targets),
    analyze(ALIGNED_PATH, targets),
    stat(NORMALIZED_PATH),
    stat(ALIGNED_PATH),
  ]);
  const report = {
    schemaVersion: 1,
    source,
    policy: {
      mp3ToPcmConversions: 1,
      globalNormalizationPasses: 1,
      segmentNormalizationPasses: 0,
      alignmentChangesPlaybackRate: false,
      alignmentChangesPitch: false,
    },
    format: map.audio,
    normalization: targets,
    measuredOriginal,
    measuredNormalized,
    measuredAligned,
    durationSeconds: map.durationSeconds,
    blocks: map.blocks.map((block) => ({
      ...block,
      sourceDuration: Number((block.sourceEnd - block.sourceStart).toFixed(4)),
      availableTimelineDuration: block.timelineEnd - block.timelineStart,
    })),
    outputs: {
      normalized: { path: path.relative(ROOT, NORMALIZED_PATH).replaceAll("\\", "/"), bytes: normalizedStat.size, sha256: await sha256(NORMALIZED_PATH) },
      aligned: { path: path.relative(ROOT, ALIGNED_PATH).replaceAll("\\", "/"), bytes: alignedStat.size, sha256: await sha256(ALIGNED_PATH) },
    },
  };
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${NORMALIZED_PATH}\n${ALIGNED_PATH}\n${REPORT_PATH}\n`);
}

await main();
