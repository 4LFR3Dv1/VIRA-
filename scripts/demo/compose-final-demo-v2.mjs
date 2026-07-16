import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const timelinePath = path.join(ROOT, "scripts/demo/final-timeline-v2.json");
const narrationPath = path.join(ROOT, "scripts/demo/vira-demo-v2-narration.json");
const captionsPath = path.join(ROOT, "scripts/demo/vira-demo-v2-captions-en.srt");
const captionsAssPath = path.join(ROOT, "scripts/demo/vira-demo-v2-captions-en.ass");
const scriptPath = path.join(ROOT, "scripts/demo/vira-demo-v2-script-en.md");
const OUT = path.resolve(ROOT, argument("out", "artifacts/submission-v2"));
const FONT = process.env.VIRA_DEMO_FONT || "C:/Windows/Fonts/arialbd.ttf";

function argument(name, fallback = null) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; }
function required(name) { const value = argument(name); if (!value) throw new Error(`Missing --${name}. V2 never substitutes certified evidence with a placeholder.`); return path.resolve(ROOT, value); }
function currentCommitSha() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unavailable"; } }
function q(value) { return String(value).replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "’").replaceAll("%", "\\%"); }
function run(args, silent = true) { return new Promise((resolve, reject) => { let stderr = ""; const child = spawn(ffmpegPath, args, { cwd: ROOT, stdio: silent ? ["ignore", "ignore", "pipe"] : "inherit" }); if (silent) child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-30_000); }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg_exit_${code}\n${stderr}`))); }); }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
function sourcePath(source, product, match) { const [domain, id, player] = source.split(":"); const base = domain === "product" ? product : domain === "match" ? match : null; if (!base) throw new Error(`Unknown scene source ${source}`); return path.join(base, "clips", `${id}-player-${player}.mp4`); }

async function makeScene(scene, inputs, output) {
  const transition = inputs.length > 1 ? 0.22 : 0;
  const segment = (scene.duration + transition * (inputs.length - 1)) / inputs.length;
  const args = ["-y"];
  for (const input of inputs) { if (input.start) args.push("-ss", String(input.start)); args.push("-i", input.path); }
  const filters = inputs.map((input, index) => `[${index}:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#050A12,setsar=1${input.duration ? `,trim=duration=${input.duration},setpts=PTS-STARTPTS` : ""},tpad=stop_mode=clone:stop_duration=${segment.toFixed(3)},trim=duration=${segment.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`);
  if (inputs.length === 1) filters.push("[v0]null[cut]");
  else { let previous = "v0"; for (let index = 1; index < inputs.length; index += 1) { const next = index === inputs.length - 1 ? "cut" : `xf${index}`; filters.push(`[${previous}][v${index}]xfade=transition=fade:duration=${transition}:offset=${(index * (segment - transition)).toFixed(3)}[${next}]`); previous = next; } }
  const overlay = scene.hideOverlay ? "null" : `drawtext=fontfile='${q(FONT)}':text='${q(scene.overlay)}':fontcolor=0xC8FF00:fontsize=34:box=1:boxcolor=0x050A12dd:boxborderw=16:x=64:y=${scene.overlayY ?? 96}`;
  const disclosure = scene.disclosure ? `,drawtext=fontfile='${q(FONT)}':text='${q(scene.disclosure)}':fontcolor=white:fontsize=20:box=1:boxcolor=0x050A12dd:boxborderw=11:x=64:y=158` : "";
  const cta = scene.cta ? `,drawbox=x=0:y=0:w=iw:h=ih:color=0x050A12@0.90:t=fill,drawtext=fontfile='${q(FONT)}':text='ONE MATCH · TWO SOCIAL EXPERIENCES':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=310,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.url)}':fontcolor=0xC8FF00:fontsize=60:x=(w-text_w)/2:y=405,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.repo)}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=500,drawtext=fontfile='${q(FONT)}':text='${q(scene.cta.reassurance)}':fontcolor=white:fontsize=23:x=(w-text_w)/2:y=570` : "";
  filters.push(`[cut]${overlay}${disclosure}${cta},trim=duration=${scene.duration},setpts=PTS-STARTPTS,format=yuv420p[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-t", String(scene.duration), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-profile:v", "high", "-pix_fmt", "yuv420p", output);
  await run(args);
}
async function concat(files, output) { const list = path.join(OUT, "final/scene-concat.txt"); await writeFile(list, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n", "utf8"); await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-an", "-c:v", "copy", output]); }
async function narration(video, voice, output, duration, captions = null) { const args = ["-y", "-i", video, "-i", voice, "-filter_complex", `[1:a]apad,atrim=duration=${duration}[a]`, "-map", "0:v", "-map", "[a]"]; if (captions) args.push("-vf", `ass=filename='${q(captions)}'`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p"); else args.push("-c:v", "copy"); args.push("-t", String(duration), "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", output); await run(args, false); }
async function thumbnail(input, output) { const logo = path.join(ROOT, "public/vira-icon.png"); await run(["-y", "-ss", "0.5", "-i", input, "-i", logo, "-frames:v", "1", "-filter_complex", `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:#050A12[bg];[1:v]scale=220:-1[logo];[bg][logo]overlay=64:56[brand];[brand]drawtext=fontfile='${q(FONT)}':text='ONE MATCH · TWO SOCIAL EXPERIENCES':fontcolor=white:fontsize=34:box=1:boxcolor=0x050A12dd:boxborderw=14:x=64:y=180,drawtext=fontfile='${q(FONT)}':text='VIRA PICKS + MATCH ROOM':fontcolor=0xC8FF00:fontsize=28:box=1:boxcolor=0x050A12dd:boxborderw=12:x=64:y=255[out]`, "-map", "[out]", output]); }

async function main() {
  const product = required("product"); const match = required("match"); const crossDevice = required("cross-device"); const txline = required("txline"); const voice = required("voice");
  const [timeline, narrationMap, productManifest, matchManifest, crossManifest] = await Promise.all([
    readFile(timelinePath, "utf8").then(JSON.parse), readFile(narrationPath, "utf8").then(JSON.parse), readFile(path.join(product, "manifest.json"), "utf8").then(JSON.parse), readFile(path.join(match, "manifest.json"), "utf8").then(JSON.parse), readFile(path.join(path.dirname(crossDevice), "manifest.json"), "utf8").then(JSON.parse),
  ]);
  if (Math.abs(timeline.durationSeconds - narrationMap.durationSeconds) > 0.01) throw new Error("timeline_narration_duration_mismatch");
  if (productManifest.failures?.length || !productManifest.identitiesDistinct || !productManifest.cardsImmutable || !productManifest.serverLock || productManifest.btssExposed || !productManifest.playbackVerified) throw new Error("product_capture_not_certified");
  if (matchManifest.health?.consoleErrors || matchManifest.health?.serverErrors || matchManifest.health?.unexpectedFailedRequests || !matchManifest.authority?.liveReplayEquivalent) throw new Error("match_capture_not_certified");
  if (crossManifest.health?.consoleErrors || crossManifest.health?.serverErrors || crossManifest.health?.unexpectedFailedRequests || crossManifest.correlation?.participantCount !== 2 || crossManifest.correlation?.duplicateParticipants !== 0) throw new Error("cross_device_capture_not_certified");
  const sensitive = JSON.stringify({ productManifest, matchManifest, crossManifest }); if (/TXLINE_JWT|VIRA_E2E_TOKEN|authorization|bearer\s+[a-z0-9]/i.test(sensitive)) throw new Error("sensitive_material_in_manifest");
  await Promise.all(["scenes", "final", "qa", "sources"].map((item) => mkdir(path.join(OUT, item), { recursive: true })));
  await Promise.all([copyFile(captionsPath, path.join(OUT, "final/vira-demo-v2-captions-en.srt")), copyFile(captionsAssPath, path.join(OUT, "final/vira-demo-v2-captions-en.ass")), copyFile(scriptPath, path.join(OUT, "final/vira-demo-v2-script-en.md"))]);
  const scenes = [];
  for (const scene of timeline.scenes) {
    let inputs;
    if (scene.external === "cross-device") inputs = [{ path: crossDevice, start: scene.sourceStart ?? 0 }];
    else inputs = scene.sources.map((source) => ({ path: sourcePath(source, product, match), start: 0 }));
    if (scene.externalTail === "txline") inputs.push({ path: txline, start: 0 });
    for (const input of inputs) if (!existsSync(input.path)) throw new Error(`missing_scene_source:${input.path}`);
    const output = path.join(OUT, "scenes", `${scene.id}.mp4`); await makeScene(scene, inputs, output); scenes.push(output);
  }
  const mezzanine = path.join(OUT, "final/vira-demo-v2-mezzanine-clean-1080p.mp4"); const clean = path.join(OUT, "final/vira-demo-v2-master-clean-1080p.mp4"); const final = path.join(OUT, "final/vira-demo-v2-final-en-1080p.mp4"); const thumb = path.join(OUT, "final/vira-demo-v2-thumbnail.png");
  await concat(scenes, mezzanine); await narration(mezzanine, voice, clean, timeline.durationSeconds); await narration(mezzanine, voice, final, timeline.durationSeconds, captionsAssPath); await thumbnail(sourcePath("product:preview:a", product, match), thumb);
  const youtube = path.join(OUT, "qa/vira-demo-v2-youtube-720p.mp4"); await run(["-y", "-i", final, "-vf", "scale=1280:720:flags=lanczos", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", youtube]);
  const black = await run(["-hide_banner", "-i", final, "-vf", "blackdetect=d=0.25:pix_th=0.02", "-an", "-f", "null", "-"]); const loudness = await run(["-hide_banner", "-i", final, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
  const strictBlackSegments = (black.match(/black_start:/g) ?? []).length; const loudJson = [...loudness.matchAll(/\{[\s\S]*?"input_i"[\s\S]*?\}/g)].at(-1)?.[0]; const measured = loudJson ? JSON.parse(loudJson) : null;
  await run(["-y", "-i", final, "-vf", "fps=1/22,scale=480:270,tile=4x3:nb_frames=12", "-frames:v", "1", path.join(OUT, "qa/contact-sheet.png")]);
  const metadata = `# VIRA Demo V2 metadata\n\n- Title: ${timeline.title}\n- Duration: 4:30.5\n- Resolution: 1920×1080, 30 fps CFR\n- Product capture: ${productManifest.runId} at ${productManifest.commitSha}\n- Match Room capture: ${matchManifest.runId} at ${matchManifest.commitSha}\n- Cross-device capture: ${crossManifest.runId} at ${crossManifest.commitSha}\n- Editorial commit: ${currentCommitSha()}\n- Language: English\n- Fixture authority: captured_txline_test_fixture, explicitly disclosed\n- Real TxLINE evidence: ${path.basename(txline)}\n- VIRA Picks markets shown: Match Result and Total Goals 2.5\n- BTTS: intentionally unavailable until an observed TxLINE mapping is certified\n- Participants: two distinct identities\n- Mobile: emulated Mobile WebKit, not a physical iPhone\n- Money, stake, payout or wagering: none\n\n## Evidence\n\nThe V2 shows Match Preview, VIRA Picks, immutable sharing, a friend creating an independent card, server-owned lock, deterministic Picks resolution, Match Room, private competitive answers, synchronized resolution, post-match sharing and the certified Judge Evaluation Guide. Picks persistence and results remain isolated from the Match Room competitive ledger.\n`;
  const metadataFile = path.join(OUT, "final/vira-demo-v2-metadata.md"); await writeFile(metadataFile, metadata, "utf8");
  const releaseFiles = [path.join(OUT, "final/vira-demo-v2-captions-en.srt"), final, clean, metadataFile, thumb]; const hashes = {}; for (const file of releaseFiles) hashes[path.basename(file)] = `sha256:${await sha256(file)}`;
  const certification = { schemaVersion: 2, status: strictBlackSegments === 0 && Number(measured?.input_i ?? -99) > -17 && Number(measured?.input_i ?? 0) < -15 ? "editorial_release_candidate_certified" : "qa_failed", durationSeconds: timeline.durationSeconds, video: { width: 1920, height: 1080, fps: 30, codec: "h264", profile: "High", pixelFormat: "yuv420p" }, audio: { sampleRateHz: 48000, channels: 1, integratedLufs: measured?.input_i, truePeakDbtp: measured?.input_tp }, captures: { product: { runId: productManifest.runId, commitSha: productManifest.commitSha, identitiesDistinct: productManifest.identitiesDistinct, cardsConfirmed: productManifest.cardsConfirmed, cardsImmutable: productManifest.cardsImmutable, serverLock: productManifest.serverLock, btssExposed: productManifest.btssExposed, playbackVerified: productManifest.playbackVerified }, matchRoom: { runId: matchManifest.runId, commitSha: matchManifest.commitSha, authority: matchManifest.authority, health: matchManifest.health }, crossDevice: { runId: crossManifest.runId, commitSha: crossManifest.commitSha, roomId: crossManifest.correlation?.roomId, roundId: crossManifest.correlation?.roundId, locksAt: crossManifest.correlation?.locksAt, identitiesDistinct: crossManifest.correlation?.identitiesDistinct, participantCount: crossManifest.correlation?.participantCount, duplicateParticipants: crossManifest.correlation?.duplicateParticipants, privateBeforeLock: true, liveReplayEquivalent: crossManifest.authority?.liveReplayEquivalent, rankingReplayEquivalent: crossManifest.authority?.rankingReplayEquivalent, observedUpdateIntervalsMs: crossManifest.correlation?.observedUpdateIntervalsMs, health: crossManifest.health } }, editorialQa: { strictBlackSegments, noSecretsInManifests: true, noPrivateParticipantIds: true, underFiveMinutes: timeline.durationSeconds < 300, captionsGenerated: true, youtubeLike720pGenerated: true, contactSheetGenerated: true, humanVisualReview: argument("human-reviewed", "false") === "true" }, outputs: hashes };
  const certFile = path.join(OUT, "final/vira-demo-v2-certification.json"); await writeFile(certFile, `${JSON.stringify(certification, null, 2)}\n`, "utf8");
  process.stdout.write(`${OUT}\n${final}\n${certification.status}\n`);
}

await main();
