import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const narration = JSON.parse(await readFile(path.join(ROOT, "scripts/demo/vira-demo-v2-narration.json"), "utf8"));
const stamp = (seconds, srt = true) => { const ms = Math.round(seconds * 1000); const h = Math.floor(ms / 3_600_000); const m = Math.floor(ms % 3_600_000 / 60_000); const sec = Math.floor(ms % 60_000 / 1000); const milli = ms % 1000; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${srt ? "," : "."}${String(milli).padStart(3, "0")}`; };
const words = (value) => value.match(/[\p{L}\p{N}’'-]+/gu)?.length ?? 1;
const cues = [];
for (const section of narration.sections) {
  const tokens = section.text.split(/\s+/); const chunks = [];
  for (let index = 0; index < tokens.length; index += 10) chunks.push(tokens.slice(index, index + 10).join(" "));
  const weights = chunks.map(words); const total = weights.reduce((sum, value) => sum + value, 0); let cursor = section.start;
  chunks.forEach((text, index) => { const end = index === chunks.length - 1 ? section.end : cursor + (section.end - section.start) * weights[index] / total; cues.push({ start: cursor + 0.08, end: end - 0.08, text }); cursor = end; });
}
const srt = cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n");
const assHeader = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,34,&H00FFFFFF,&H000000FF,&HCC050A12,&HCC050A12,-1,0,0,0,100,100,0,0,3,2,0,2,180,180,68,1\nStyle: LiveMoment,Arial,34,&H00FFFFFF,&H000000FF,&HCC050A12,&HCC050A12,-1,0,0,0,100,100,0,0,3,2,0,2,180,180,235,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
const ass = assHeader + cues.map((cue) => {
  const style = cue.start >= 127 && cue.start < 140 ? "LiveMoment" : "Default";
  return `Dialogue: 0,${stamp(cue.start, false).slice(1, -1)},${stamp(cue.end, false).slice(1, -1)},${style},,0,0,0,,${cue.text.replaceAll("—", "-")}`;
}).join("\n") + "\n";
await writeFile(path.join(ROOT, "scripts/demo/vira-demo-v2-captions-en.srt"), srt, "utf8");
await writeFile(path.join(ROOT, "scripts/demo/vira-demo-v2-captions-en.ass"), ass, "utf8");
process.stdout.write(`${cues.length} cues\n`);
