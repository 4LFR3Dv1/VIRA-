import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TIMELINE_PATH = path.join(ROOT, "scripts", "demo", "final-timeline.json");
const SCRIPT_PATH = path.join(ROOT, "scripts", "demo", "vira-demo-script-en.md");
const CAPTIONS_PATH = path.join(ROOT, "scripts", "demo", "vira-demo-captions-en.srt");
const CAPTIONS_ASS_PATH = path.join(ROOT, "scripts", "demo", "vira-demo-captions-en.ass");
const OUT = path.resolve(ROOT, argument("out", "artifacts/submission"));
const FONT = process.env.VIRA_DEMO_FONT || "C:/Windows/Fonts/arialbd.ttf";

function argument(name, fallback = null) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; }
function currentCommitSha() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unavailable"; } }
function required(name) { const value = argument(name); if (!value) throw new Error(`Missing --${name}. Final composition never substitutes external evidence with a placeholder.`); return path.resolve(ROOT, value); }
function run(args, silent = false) { return new Promise((resolve, reject) => { let stderr = ""; const child = spawn(ffmpegPath, args, { cwd: ROOT, stdio: silent ? ["ignore", "ignore", "pipe"] : "inherit" }); if (silent) child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}\n${stderr}`))); }); }
function q(value) { return String(value).replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "’").replaceAll("%", "\\%"); }
function sourcePath(capture, source, clipPatch = null) { const [id, player] = source.split(":"); const relative = path.join("clips", `${id}-player-${player.toLowerCase()}.mp4`); const corrected = clipPatch ? path.join(clipPatch, relative) : null; return corrected && existsSync(corrected) ? corrected : path.join(capture, relative); }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function latestCapture() {
  const base = path.join(ROOT, "artifacts", "demo", "en", "desktop");
  const entries = await readdir(base, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) if (entry.isDirectory()) { const dir = path.join(base, entry.name); try { const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")); if (manifest.schemaVersion >= 3) candidates.push({ dir, capturedAt: manifest.capturedAtUtc }); } catch {} }
  candidates.sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
  if (!candidates[0]) throw new Error("No successful schema v3 English desktop capture found. Run npm run demo:capture first.");
  return candidates[0].dir;
}
async function makeScene(scene, inputs, output) {
  const transitionDuration = inputs.length > 1 ? 0.18 : 0;
  const segmentDuration = (scene.duration + transitionDuration * (inputs.length - 1)) / inputs.length;
  const args = ["-y"];
  const normalizedInputs = inputs.map((input) => typeof input === "string" ? { path: input, start: 0 } : input);
  for (const input of normalizedInputs) {
    if (input.start > 0) args.push("-ss", String(input.start));
    args.push("-i", input.path);
  }
  const focus = scene.editorialFocus ?? { x: 0.5, y: 0.5, zoom: 1 };
  const zoom = Math.max(1, focus.zoom ?? 1);
  const filters = normalizedInputs.map((input, index) => `[${index}:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#050A12,setsar=1${input.duration ? `,trim=duration=${input.duration},setpts=PTS-STARTPTS` : ""},tpad=stop_mode=clone:stop_duration=${segmentDuration.toFixed(3)},trim=duration=${segmentDuration.toFixed(3)},setpts=PTS-STARTPTS,crop=w='iw/${zoom}':h='ih/${zoom}':x='max(0,min(iw-ow,iw*${focus.x}-ow/2))':y='max(0,min(ih-oh,ih*${focus.y}-oh/2))',scale=1920:1080:flags=lanczos[v${index}]`);
  if (inputs.length === 1) {
    filters.push("[v0]null[cut]");
  } else {
    let previous = "v0";
    for (let index = 1; index < inputs.length; index += 1) {
      const next = index === inputs.length - 1 ? "cut" : `xf${index}`;
      const offset = (index * (segmentDuration - transitionDuration)).toFixed(3);
      filters.push(`[${previous}][v${index}]xfade=transition=fade:duration=${transitionDuration}:offset=${offset}[${next}]`);
      previous = next;
    }
  }
  const label = scene.hideOverlay ? "null" : `drawtext=fontfile='${q(FONT)}':text='${q(scene.overlay)}':fontcolor=0xC8FF00:fontsize=34:box=1:boxcolor=0x050A12dd:boxborderw=16:x=64:y=${scene.overlayY ?? 96}`;
  const disclosure = scene.disclosure ? `,drawtext=fontfile='${q(FONT)}':text='${q(scene.disclosure)}':fontcolor=white:fontsize=22:box=1:boxcolor=0x050A12dd:boxborderw=12:x=(w-text_w)/2:y=${scene.disclosureY ?? "h-94"}` : "";
  const pushFlow = scene.pushFlow ? `,drawbox=x=225:y=345:w=1470:h=330:color=0x050A12@0.92:t=fill,drawbox=x=250:y=370:w=400:h=210:color=0x0B1422@1:t=fill,drawbox=x=760:y=370:w=400:h=210:color=0x0B1422@1:t=fill,drawbox=x=1270:y=370:w=400:h=210:color=0x0B1422@1:t=fill,drawtext=fontfile='${q(FONT)}':text='ROUND OPENS':fontcolor=0xC8FF00:fontsize=30:x=330:y=425,drawtext=fontfile='${q(FONT)}':text='Authoritative event':fontcolor=white:fontsize=20:x=326:y=495,drawtext=fontfile='${q(FONT)}':text='VIRA BACKEND':fontcolor=0xC8FF00:fontsize=30:x=845:y=425,drawtext=fontfile='${q(FONT)}':text='VAPID delivery':fontcolor=white:fontsize=20:x=872:y=495,drawtext=fontfile='${q(FONT)}':text='BROWSER PUSH':fontcolor=0xC8FF00:fontsize=30:x=1350:y=425,drawtext=fontfile='${q(FONT)}':text='Return to the room':fontcolor=white:fontsize=20:x=1350:y=495,drawtext=fontfile='${q(FONT)}':text='→':fontcolor=0xC8FF00:fontsize=58:x=680:y=435,drawtext=fontfile='${q(FONT)}':text='→':fontcolor=0xC8FF00:fontsize=58:x=1190:y=435,drawtext=fontfile='${q(FONT)}':text='PRODUCTION-ENABLED · OPTIONAL · TOKEN-FREE DEEP LINK':fontcolor=white:fontsize=22:x=(w-text_w)/2:y=625` : "";
  const cta = scene.cta ? `,drawbox=x=0:y=0:w=iw:h=ih:color=0x050A12@0.88:t=fill,drawtext=fontfile='${q(FONT)}':text='PLAY THE MATCH LIVE':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=330,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.url)}':fontcolor=0xC8FF00:fontsize=58:x=(w-text_w)/2:y=410,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.repo)}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=500,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.reassurance)}':fontcolor=white:fontsize=25:x=(w-text_w)/2:y=570` : "";
  filters.push(`[cut]${label}${pushFlow}${disclosure}${cta},trim=duration=${scene.duration},setpts=PTS-STARTPTS,format=yuv420p[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-t", String(scene.duration), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-profile:v", "high", "-pix_fmt", "yuv420p", output);
  await run(args, true);
}
async function concatScenes(files, output) {
  const list = path.join(OUT, "final", "scene-concat.txt");
  await writeFile(list, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n", "utf8");
  await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-an", "-c:v", "copy", output], true);
}
async function addNarration(clean, voice, output, duration, captions = null) {
  const cue = `aevalsrc=0.035*sin(2*PI*620*t)*between(t\\,77\\,77.16)+0.025*sin(2*PI*820*t)*between(t\\,101\\,101.12)+0.04*sin(2*PI*180*t)*between(t\\,125.8\\,126.05)+0.035*sin(2*PI*740*t)*between(t\\,127\\,127.2)+0.03*sin(2*PI*920*t)*between(t\\,149\\,149.18):s=48000:d=${duration}[cue]`;
  const args = ["-y", "-i", clean, "-i", voice, "-filter_complex", `${cue};[1:a]apad,atrim=duration=${duration},volume=1.0[voice];[voice][cue]amix=inputs=2:duration=longest:normalize=0[a]`, "-map", "0:v", "-map", "[a]"];
  if (captions) args.push("-vf", `ass=filename='${q(captions)}'`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p");
  else args.push("-c:v", "copy");
  args.push("-t", String(duration), "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", output);
  await run(args);
}
async function thumbnail(homeClip, output) {
  const logo = path.join(ROOT, "public", "vira-icon.png");
  await run(["-y", "-ss", "0.7", "-i", homeClip, "-i", logo, "-frames:v", "1", "-filter_complex", `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:#050A12[bg];[1:v]scale=250:-1[logo];[bg][logo]overlay=64:58[brand];[brand]drawtext=fontfile='${q(FONT)}':text='LIVE MULTIPLAYER FOOTBALL':fontcolor=white:fontsize=34:box=1:boxcolor=0x050A12dd:boxborderw=14:x=64:y=180[out]`, "-map", "[out]", output], true);
}

async function main() {
  const capture = path.resolve(ROOT, argument("capture", await latestCapture()));
  const clipPatchArg = argument("clip-patch");
  const clipPatch = clipPatchArg ? path.resolve(ROOT, clipPatchArg) : null;
  const txline = required("txline");
  const crossDevice = required("cross-device");
  const voiceArg = argument("voice");
  const voice = voiceArg ? path.resolve(ROOT, voiceArg) : null;
  const publicationUrl = argument("publication-url", "pending");
  const editorialCommitSha = currentCommitSha();
  const timeline = JSON.parse(await readFile(TIMELINE_PATH, "utf8"));
  const manifest = JSON.parse(await readFile(path.join(capture, "manifest.json"), "utf8"));
  const crossDeviceManifest = JSON.parse(await readFile(path.join(path.dirname(crossDevice), "manifest.json"), "utf8"));
  const clipPatchManifest = clipPatch ? JSON.parse(await readFile(path.join(clipPatch, "manifest.json"), "utf8")) : null;
  if (manifest.video?.width !== 1920 || manifest.video?.height !== 1080 || manifest.locale !== "en") throw new Error("Capture must be the final English 1920x1080 run.");
  if (!manifest.authority?.liveReplayEquivalent || !manifest.authority?.rankingReplayEquivalent) throw new Error("Capture replay/ranking equivalence is not certified.");
  if (crossDeviceManifest.captureMode !== "hybrid-cross-device" || crossDeviceManifest.correlation?.participantCount !== 2 || crossDeviceManifest.correlation?.duplicateParticipants !== 0) throw new Error("Cross-device evidence must be one certified two-participant hybrid run without duplicates.");
  if (!crossDeviceManifest.authority?.liveReplayEquivalent || !crossDeviceManifest.authority?.rankingReplayEquivalent) throw new Error("Cross-device replay/ranking equivalence is not certified.");
  if (crossDeviceManifest.health?.consoleErrors !== 0 || crossDeviceManifest.health?.serverErrors !== 0 || crossDeviceManifest.health?.unexpectedFailedRequests !== 0) throw new Error("Cross-device capture contains browser or HTTP failures.");
  const dirs = ["sources/player-a", "sources/player-b", "sources/txline", "scenes", "final"].map((item) => path.join(OUT, item));
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
  await Promise.all([
    copyFile(path.join(capture, manifest.outputs.playerA), path.join(OUT, "sources/player-a/player-a-master-1080p30.mp4")),
    copyFile(path.join(capture, manifest.outputs.playerB), path.join(OUT, "sources/player-b/player-b-master-1080p30.mp4")),
    copyFile(txline, path.join(OUT, `sources/txline/${path.basename(txline)}`)),
    copyFile(SCRIPT_PATH, path.join(OUT, "final/vira-demo-script-en.md")),
    copyFile(CAPTIONS_PATH, path.join(OUT, "final/vira-demo-captions-en.srt")),
    copyFile(CAPTIONS_ASS_PATH, path.join(OUT, "final/vira-demo-captions-en.ass")),
  ]);
  const outputs = [];
  for (const scene of timeline.scenes) {
    const inputs = scene.external === "txline"
      ? [txline]
      : scene.external === "cross-device"
        ? [{ path: crossDevice, start: scene.sourceStart ?? 0, duration: scene.sourceDuration ?? null }]
        : scene.sources.map((source) => sourcePath(capture, source, clipPatch));
    const output = path.join(OUT, "scenes", `${scene.id}.mp4`);
    await makeScene(scene, inputs, output); outputs.push(output);
  }
  const rough = path.join(OUT, "final/vira-demo-rough-cut.mp4");
  const mezzanine = path.join(OUT, "final/vira-demo-mezzanine-clean-1080p.mp4");
  const clean = path.join(OUT, "final/vira-demo-master-clean-1080p.mp4");
  await concatScenes(outputs, rough); await copyFile(rough, mezzanine);
  await thumbnail(sourcePath(capture, "home:A", clipPatch), path.join(OUT, "final/vira-demo-thumbnail.png"));
  const finalPath = path.join(OUT, "final/vira-demo-final-en-1080p.mp4");
  if (voice) {
    await addNarration(mezzanine, voice, clean, timeline.durationSeconds);
    await addNarration(mezzanine, voice, finalPath, timeline.durationSeconds, CAPTIONS_ASS_PATH);
  } else await copyFile(mezzanine, clean);
  const metadata = `# VIRA demo metadata\n\n- Title: ${timeline.title}\n- Product capture commit SHA: ${manifest.commitSha}\n- Corrected clip commit SHA: ${clipPatchManifest?.commitSha ?? "none"}\n- Cross-device capture commit SHA: ${crossDeviceManifest.commitSha}\n- Editorial composition commit SHA: ${editorialCommitSha}\n- Build ID: ${manifest.buildId}\n- Deployment: ${manifest.deployment}\n- Capture UTC: ${manifest.capturedAtUtc}\n- Cross-device capture UTC: ${crossDeviceManifest.capturedAtUtc}\n- Cross-device run: ${crossDeviceManifest.runId}\n- Cross-device room / round / deadline: ${crossDeviceManifest.correlation.roomId} / ${crossDeviceManifest.correlation.roundId} / ${crossDeviceManifest.correlation.locksAt}\n- Cross-device observed update intervals: open ${crossDeviceManifest.correlation.observedUpdateIntervalsMs.open} ms; confirmed ${crossDeviceManifest.correlation.observedUpdateIntervalsMs.confirmed} ms; locked ${crossDeviceManifest.correlation.observedUpdateIntervalsMs.locked} ms; resolved ${crossDeviceManifest.correlation.observedUpdateIntervalsMs.resolved} ms\n- Duration: ${timeline.durationSeconds}s\n- Resolution: 1920×1080\n- FPS: 30 CFR\n- Mezzanine: H.264 High Profile, CRF 15, yuv420p, assembled directly from certified scene sources\n- Language: English\n- Timezone: ${manifest.timeZone}\n- Fixture authority: ${manifest.inputAuthority}\n- Competitive fixture scene: captured TxLINE test fixture, explicitly disclosed\n- Real TxLINE evidence: ${path.basename(txline)}\n- Playwright method: Chromium desktop + Mobile WebKit emulation, isolated identities, shared authoritative runtime\n- Frame-perfect simultaneity: not claimed\n- Web Push representation: real in-product alerts control plus a labeled 8-second editorial delivery-flow visualization\n- Native notification capture: not included\n- Web Push operational status: reported tested successfully in production by the operator; not independently evidenced by this video\n- Publication: ${publicationUrl}\n\n## TxLINE endpoints used\n\n- GET /txline/fixtures\n- GET /txline/scores\n- GET /txline/scores/updates\n- GET /txline/scores/historical\n- GET /txline/odds\n\n## Limitations\n\n- Competitive walkthrough uses a captured TxLINE test fixture for deterministic replay.\n- The Web Push scene is an editorial visualization, not a native operating-system notification capture.\n- Mobile WebKit is emulated, not a native iOS device.\n- PWA intentionally does not serve stale competitive state from an offline shell.\n`;
  await writeFile(path.join(OUT, "final/vira-demo-metadata.md"), metadata, "utf8");
  const certification = { schemaVersion: 2, status: voice ? "assembled_pending_human_review" : "rough_cut_pending_voice", captureRunId: manifest.runId, captureCommitSha: manifest.commitSha, clipPatchRunId: clipPatchManifest?.runId ?? null, clipPatchCommitSha: clipPatchManifest?.commitSha ?? null, crossDevice: { runId: crossDeviceManifest.runId, commitSha: crossDeviceManifest.commitSha, buildId: crossDeviceManifest.buildId, correlation: crossDeviceManifest.correlation, authority: crossDeviceManifest.authority, health: crossDeviceManifest.health }, editorialCommitSha, buildId: manifest.buildId, durationSeconds: timeline.durationSeconds, video: { width: 1920, height: 1080, fps: 30, mezzanineCrf: 15 }, authority: manifest.authority, health: manifest.health, externalEvidence: { push: { nativeCaptureSupplied: false, representation: "editorial_flow_over_real_product_control", reportedProductionOperational: true, independentlyCertifiedByVideo: false }, txline: { supplied: true, file: path.basename(txline), realPathHumanCertified: false } }, narration: { supplied: Boolean(voice), humanCertified: false }, publication: { url: publicationUrl, anonymousAccessCertified: false }, finalReview: { noCompanion: false, noMixedLanguage: false, noSecrets: false, underFiveMinutes: true }, outputs: {} };
  for (const file of [mezzanine, clean, finalPath, path.join(OUT, "final/vira-demo-captions-en.srt")]) if (existsSync(file)) certification.outputs[path.basename(file)] = { sha256: await sha256(file) };
  await writeFile(path.join(OUT, "final/vira-demo-certification.json"), JSON.stringify(certification, null, 2) + "\n", "utf8");
  process.stdout.write(`${OUT}\n${voice ? finalPath : "Voice not supplied: clean master and rough cut generated; final EN master intentionally withheld."}\n`);
}

await main();
