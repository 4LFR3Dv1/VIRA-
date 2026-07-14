import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TIMELINE_PATH = path.join(ROOT, "scripts", "demo", "final-timeline.json");
const SCRIPT_PATH = path.join(ROOT, "scripts", "demo", "vira-demo-script-en.md");
const CAPTIONS_PATH = path.join(ROOT, "scripts", "demo", "vira-demo-captions-en.srt");
const OUT = path.resolve(ROOT, argument("out", "artifacts/submission"));
const FONT = process.env.VIRA_DEMO_FONT || "C:/Windows/Fonts/arialbd.ttf";

function argument(name, fallback = null) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; }
function currentCommitSha() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unavailable"; } }
function required(name) { const value = argument(name); if (!value) throw new Error(`Missing --${name}. Final composition never substitutes external evidence with a placeholder.`); return path.resolve(ROOT, value); }
function run(args, silent = false) { return new Promise((resolve, reject) => { let stderr = ""; const child = spawn(ffmpegPath, args, { cwd: ROOT, stdio: silent ? ["ignore", "ignore", "pipe"] : "inherit" }); if (silent) child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}\n${stderr}`))); }); }
function q(value) { return String(value).replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "’").replaceAll("%", "\\%"); }
function sourcePath(capture, source, clipPatch = null) { const [id, player] = source.split(":"); const relative = path.join("clips", `${id}-player-${player.toLowerCase()}.mp4`); const corrected = clipPatch ? path.join(clipPatch, relative) : null; return corrected && existsSync(corrected) ? corrected : path.join(capture, relative); }
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
  const segmentDuration = scene.duration / inputs.length;
  const args = ["-y"];
  for (const input of inputs) args.push("-stream_loop", "-1", "-i", input);
  const focus = scene.editorialFocus ?? { x: 0.5, y: 0.5, zoom: 1.035 };
  const zoomStep = focus.step ?? 0.00012;
  const zoomExpression = focus.startZoom ? `if(eq(on,0),${focus.startZoom},min(pzoom+${zoomStep},${focus.zoom}))` : `min(max(zoom,pzoom)+${zoomStep},${focus.zoom})`;
  const filters = inputs.map((_, index) => `[${index}:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#050A12,setsar=1,trim=duration=${segmentDuration.toFixed(3)},setpts=PTS-STARTPTS,zoompan=z='${zoomExpression}':x='iw*${focus.x}-(iw/zoom/2)':y='ih*${focus.y}-(ih/zoom/2)':d=1:s=1920x1080:fps=30[v${index}]`);
  filters.push(`${inputs.map((_, index) => `[v${index}]`).join("")}concat=n=${inputs.length}:v=1:a=0[cut]`);
  const label = `drawtext=fontfile='${q(FONT)}':text='${q(scene.overlay)}':fontcolor=0xC8FF00:fontsize=34:box=1:boxcolor=0x050A12dd:boxborderw=16:x=64:y=96`;
  const disclosure = scene.disclosure ? `,drawtext=fontfile='${q(FONT)}':text='${q(scene.disclosure)}':fontcolor=white:fontsize=22:box=1:boxcolor=0x050A12dd:boxborderw=12:x=(w-text_w)/2:y=h-94` : "";
  const cta = scene.cta ? `,drawbox=x=0:y=0:w=iw:h=ih:color=0x050A12@0.88:t=fill,drawtext=fontfile='${q(FONT)}':text='PLAY THE MATCH LIVE':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=330,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.url)}':fontcolor=0xC8FF00:fontsize=58:x=(w-text_w)/2:y=410,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.repo)}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=500,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.reassurance)}':fontcolor=white:fontsize=25:x=(w-text_w)/2:y=570` : "";
  filters.push(`[cut]${label}${disclosure}${cta},fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0, scene.duration - 0.25)}:d=0.25,format=yuv420p[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-t", String(scene.duration), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", output);
  await run(args, true);
}
async function concatScenes(files, output) {
  const list = path.join(OUT, "final", "scene-concat.txt");
  await writeFile(list, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n", "utf8");
  await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-an", "-c:v", "copy", output], true);
}
async function addNarrationAndCaptions(clean, voice, captions, output) {
  const subtitle = q(captions);
  const cue = "aevalsrc=0.035*sin(2*PI*620*t)*between(t,88,88.16)+0.025*sin(2*PI*820*t)*between(t,114,114.12)+0.04*sin(2*PI*180*t)*between(t,141.8,142.05)+0.035*sin(2*PI*740*t)*between(t,143,143.2)+0.03*sin(2*PI*920*t)*between(t,168,168.18):s=48000:d=248[cue]";
  await run(["-y", "-i", clean, "-i", voice, "-filter_complex", `${cue};[1:a]apad,atrim=duration=248,volume=1.0[voice];[voice][cue]amix=inputs=2:duration=longest:normalize=0[a]`, "-map", "0:v", "-map", "[a]", "-vf", `subtitles=filename='${subtitle}':force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00F5F7F2,OutlineColour=&HCC050A12,BorderStyle=3,Outline=1,Shadow=0,MarginV=36,Alignment=2'`, "-t", "248", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
}
async function thumbnail(homeClip, output) {
  const logo = path.join(ROOT, "public", "vira-icon.png");
  await run(["-y", "-ss", "0.7", "-i", homeClip, "-i", logo, "-frames:v", "1", "-filter_complex", `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:#050A12[bg];[1:v]scale=250:-1[logo];[bg][logo]overlay=64:58[brand];[brand]drawtext=fontfile='${q(FONT)}':text='LIVE MULTIPLAYER FOOTBALL':fontcolor=white:fontsize=34:box=1:boxcolor=0x050A12dd:boxborderw=14:x=64:y=180[out]`, "-map", "[out]", output], true);
}

async function main() {
  const capture = path.resolve(ROOT, argument("capture", await latestCapture()));
  const clipPatchArg = argument("clip-patch");
  const clipPatch = clipPatchArg ? path.resolve(ROOT, clipPatchArg) : null;
  const push = required("push");
  const txline = required("txline");
  const voiceArg = argument("voice");
  const voice = voiceArg ? path.resolve(ROOT, voiceArg) : null;
  const pushBrowser = argument("push-browser", "not supplied");
  const pushMethod = argument("push-method", "external desktop capture");
  const publicationUrl = argument("publication-url", "pending");
  const editorialCommitSha = currentCommitSha();
  const timeline = JSON.parse(await readFile(TIMELINE_PATH, "utf8"));
  const manifest = JSON.parse(await readFile(path.join(capture, "manifest.json"), "utf8"));
  const clipPatchManifest = clipPatch ? JSON.parse(await readFile(path.join(clipPatch, "manifest.json"), "utf8")) : null;
  if (manifest.video?.width !== 1920 || manifest.video?.height !== 1080 || manifest.locale !== "en") throw new Error("Capture must be the final English 1920x1080 run.");
  if (!manifest.authority?.liveReplayEquivalent || !manifest.authority?.rankingReplayEquivalent) throw new Error("Capture replay/ranking equivalence is not certified.");
  const dirs = ["sources/player-a", "sources/player-b", "sources/push-external", "sources/txline", "scenes", "final"].map((item) => path.join(OUT, item));
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
  await Promise.all([
    copyFile(path.join(capture, manifest.outputs.playerA), path.join(OUT, "sources/player-a/player-a-master-1080p30.mp4")),
    copyFile(path.join(capture, manifest.outputs.playerB), path.join(OUT, "sources/player-b/player-b-master-1080p30.mp4")),
    copyFile(push, path.join(OUT, `sources/push-external/${path.basename(push)}`)),
    copyFile(txline, path.join(OUT, `sources/txline/${path.basename(txline)}`)),
    copyFile(SCRIPT_PATH, path.join(OUT, "final/vira-demo-script-en.md")),
    copyFile(CAPTIONS_PATH, path.join(OUT, "final/vira-demo-captions-en.srt")),
  ]);
  const outputs = [];
  for (const scene of timeline.scenes) {
    const inputs = scene.external === "push" || scene.external === "push-prelude" ? [push] : scene.external === "txline" ? [txline] : scene.sources.map((source) => sourcePath(capture, source, clipPatch));
    const output = path.join(OUT, "scenes", `${scene.id}.mp4`);
    await makeScene(scene, inputs, output); outputs.push(output);
  }
  const rough = path.join(OUT, "final/vira-demo-rough-cut.mp4");
  const clean = path.join(OUT, "final/vira-demo-master-clean-1080p.mp4");
  await concatScenes(outputs, rough); await copyFile(rough, clean);
  await thumbnail(sourcePath(capture, "home:A", clipPatch), path.join(OUT, "final/vira-demo-thumbnail.png"));
  const finalPath = path.join(OUT, "final/vira-demo-final-en-1080p.mp4");
  if (voice) await addNarrationAndCaptions(clean, voice, path.join(OUT, "final/vira-demo-captions-en.srt"), finalPath);
  const metadata = `# VIRA demo metadata\n\n- Title: ${timeline.title}\n- Product capture commit SHA: ${manifest.commitSha}\n- Corrected clip commit SHA: ${clipPatchManifest?.commitSha ?? "none"}\n- Editorial composition commit SHA: ${editorialCommitSha}\n- Build ID: ${manifest.buildId}\n- Deployment: ${manifest.deployment}\n- Capture UTC: ${manifest.capturedAtUtc}\n- Corrected clip capture UTC: ${clipPatchManifest?.capturedAtUtc ?? "none"}\n- Duration: ${timeline.durationSeconds}s\n- Resolution: 1920×1080\n- FPS: 30\n- Codec: H.264${voice ? " / AAC" : ""}\n- Language: English\n- Timezone: ${manifest.timeZone}\n- Fixture authority: ${manifest.inputAuthority}\n- Competitive fixture scene: captured TxLINE test fixture, explicitly disclosed\n- Real TxLINE evidence: ${path.basename(txline)}\n- Playwright method: two isolated Chromium contexts, authoritative local runtime, native 1080p source\n- External Push method: ${pushMethod}\n- Push browser: ${pushBrowser}\n- Web Push delivery: externally supplied real capture; final human certification required\n- Publication: ${publicationUrl}\n\n## TxLINE endpoints used\n\n- GET /txline/fixtures\n- GET /txline/scores\n- GET /txline/scores/updates\n- GET /txline/scores/historical\n- GET /txline/odds\n\n## Limitations\n\n- Competitive walkthrough uses a captured TxLINE test fixture for deterministic replay.\n- WebKit mobile is emulated unless a physical-device certificate is attached.\n- PWA intentionally does not serve stale competitive state from an offline shell.\n`;
  await writeFile(path.join(OUT, "final/vira-demo-metadata.md"), metadata, "utf8");
  const certification = { schemaVersion: 1, status: voice ? "assembled_pending_human_review" : "rough_cut_pending_voice", captureRunId: manifest.runId, captureCommitSha: manifest.commitSha, clipPatchRunId: clipPatchManifest?.runId ?? null, clipPatchCommitSha: clipPatchManifest?.commitSha ?? null, editorialCommitSha, buildId: manifest.buildId, durationSeconds: timeline.durationSeconds, video: { width: 1920, height: 1080, fps: 30 }, authority: manifest.authority, health: manifest.health, externalEvidence: { push: { supplied: true, browser: pushBrowser, method: pushMethod, realDeliveryHumanCertified: false }, txline: { supplied: true, file: path.basename(txline), realPathHumanCertified: false } }, narration: { supplied: Boolean(voice), humanCertified: false }, publication: { url: publicationUrl, anonymousAccessCertified: false }, finalReview: { noCompanion: false, noMixedLanguage: false, noSecrets: false, underFiveMinutes: true } };
  await writeFile(path.join(OUT, "final/vira-demo-certification.json"), JSON.stringify(certification, null, 2) + "\n", "utf8");
  process.stdout.write(`${OUT}\n${voice ? finalPath : "Voice not supplied: clean master and rough cut generated; final EN master intentionally withheld."}\n`);
}

await main();
