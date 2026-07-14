import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveShareLocaleContext } from "../shared/share-copy.mjs";

const logoCandidates = [
  new URL("../public/vira-icon.png", import.meta.url),
  new URL("../dist/vira-icon.png", import.meta.url),
];

export function resolveShareLogoFile(candidates = logoCandidates, fileExists = existsSync) {
  return candidates
    .map((candidate) => candidate instanceof URL ? fileURLToPath(candidate) : candidate)
    .find((candidate) => fileExists(candidate)) ?? null;
}

const logoFile = resolveShareLogoFile();
const logoData = logoFile ? `data:image/png;base64,${readFileSync(logoFile).toString("base64")}` : null;
const COLORS = { midnight: "#050A12", lime: "#C8FF00", white: "#F5F7F2", panel: "#0B1320", muted: "#9DA8B8" };

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

function words(value, limit, maxLines = 3) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = []; let line = "";
  for (const word of parts) {
    const next = `${line} ${word}`.trim();
    if (next.length > limit && line) { lines.push(line); line = word; } else line = next;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function textLines(value, x, y, { limit = 24, maxLines = 3, size = 64, lineHeight = 0.92, color = COLORS.white, weight = 800, anchor = "start" } = {}) {
  return words(value, limit, maxLines).map((line, index) => `<text x="${x}" y="${y + index * size * lineHeight}" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(line)}</text>`).join("");
}

function dictionary(locale) {
  return locale === "en" ? {
    prediction: "MATCH PICK", invite: "LIVE ROOM", result: "MATCH RESULT", noGate: "NO ACCOUNT · NO X · NO WALLET", powered: "SPORTS DATA BY TxLINE", kickoff: "KICKOFF", players: "PLAYERS IN", join: "JOIN NOW", correct: "CORRECT", missed: "MISSED", points: "POINTS", rank: "RANK", verified: "REPRODUCIBLE RESULT", pick: "PICK",
  } : {
    prediction: "PALPITE", invite: "SALA AO VIVO", result: "RESULTADO", noGate: "SEM CONTA · SEM X · SEM WALLET", powered: "DADOS ESPORTIVOS TxLINE", kickoff: "INÍCIO", players: "NA SALA", join: "ENTRE AGORA", correct: "ACERTOU", missed: "ERROU", points: "PONTOS", rank: "POSIÇÃO", verified: "RESULTADO REPRODUZÍVEL", pick: "ESCOLHA",
  };
}

function brandLogo() {
  return logoData
    ? `<image href="${logoData}" x="54" y="42" width="224" height="70" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="54" y="91" fill="${COLORS.white}" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="900" letter-spacing="5">VIRA</text>`;
}

function base(kindLabel) {
  return `<rect width="1200" height="630" fill="${COLORS.midnight}"/><path d="M0 0H1200V630H0Z" fill="url(#grid)" opacity=".18"/>${brandLogo()}<text x="1146" y="76" text-anchor="end" fill="${COLORS.lime}" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700" letter-spacing="4">${kindLabel}</text>`;
}

function defs() {
  return `<defs><style>text{font-family:"DM Sans",sans-serif!important}</style><pattern id="grid" width="90" height="90" patternUnits="userSpaceOnUse"><path d="M90 0H0V90" fill="none" stroke="#F5F7F2" stroke-opacity=".12"/></pattern></defs>`;
}

function predictionCard(share, copy) {
  const payload = share.payload ?? {};
  const matchup = `${payload.homeTeam ?? ""} × ${payload.awayTeam ?? ""}`;
  const kickoff = share.editorialContext?.localKickoffDate ? `${share.editorialContext.localKickoffDate} · ${share.editorialContext.localKickoffTime ?? ""}` : "—";
  return `${base(copy.prediction)}<rect x="50" y="136" width="720" height="430" fill="${COLORS.panel}" stroke="#F5F7F2" stroke-opacity=".14"/><rect x="790" y="136" width="360" height="430" fill="${COLORS.lime}"/>${textLines(share.metadata.title, 86, 232, { limit: 18, maxLines: 3, size: 62 })}<text x="86" y="500" fill="${COLORS.muted}" font-family="Arial" font-size="18" font-weight="700" letter-spacing="3">${copy.kickoff}</text><text x="86" y="536" fill="${COLORS.white}" font-family="Arial" font-size="24" font-weight="700">${escapeXml(kickoff)}</text><text x="826" y="194" fill="${COLORS.midnight}" font-family="Arial" font-size="17" font-weight="800" letter-spacing="3">${copy.pick}</text>${textLines(payload.choiceLabel ?? "—", 826, 290, { limit: 12, maxLines: 2, size: 54, color: COLORS.midnight })}<path d="M826 438H1114" stroke="#050A12" stroke-opacity=".28"/><text x="826" y="482" fill="${COLORS.midnight}" font-family="Arial" font-size="20" font-weight="800">${escapeXml(matchup)}</text>`;
}

function inviteCard(share, copy) {
  const payload = share.payload ?? {};
  const matchup = `${payload.homeTeam ?? ""} × ${payload.awayTeam ?? ""}`;
  const count = Number(payload.participantCount ?? 0);
  return `${base(copy.invite)}<path d="M0 148H1200V630H0Z" fill="${COLORS.panel}"/><path d="M0 148H22V630H0Z" fill="${COLORS.lime}"/><text x="62" y="208" fill="${COLORS.muted}" font-family="Arial" font-size="18" font-weight="700" letter-spacing="3">${escapeXml(String(payload.fixtureStatus ?? "LIVE").toUpperCase())}</text>${textLines(matchup, 62, 322, { limit: 24, maxLines: 2, size: 78 })}<rect x="62" y="468" width="250" height="92" fill="${COLORS.lime}"/><text x="88" y="505" fill="${COLORS.midnight}" font-family="Arial" font-size="15" font-weight="800" letter-spacing="2">${copy.players}</text><text x="88" y="548" fill="${COLORS.midnight}" font-family="Arial" font-size="38" font-weight="900">${count}</text><text x="350" y="505" fill="${COLORS.lime}" font-family="Arial" font-size="20" font-weight="900">${copy.join}</text><text x="350" y="542" fill="${COLORS.white}" font-family="Arial" font-size="18" font-weight="700" letter-spacing="1.5">${copy.noGate}</text><text x="1138" y="582" text-anchor="end" fill="${COLORS.muted}" font-family="Arial" font-size="14" font-weight="700" letter-spacing="2">${copy.powered}</text>`;
}

function resultCard(share, copy) {
  const payload = share.payload ?? {};
  const correct = payload.correct === true;
  const score = Number.isFinite(payload.homeScore) && Number.isFinite(payload.awayScore) ? `${payload.homeTeam ?? ""} ${payload.homeScore} : ${payload.awayScore} ${payload.awayTeam ?? ""}` : `${payload.homeTeam ?? ""} × ${payload.awayTeam ?? ""}`;
  return `${base(copy.result)}<rect x="50" y="136" width="420" height="430" fill="${correct ? COLORS.lime : COLORS.white}"/><text x="84" y="210" fill="${COLORS.midnight}" font-family="Arial" font-size="18" font-weight="800" letter-spacing="3">${correct ? copy.correct : copy.missed}</text><text x="84" y="340" fill="${COLORS.midnight}" font-family="Arial" font-size="102" font-weight="900">${Number(payload.points ?? 0) > 0 ? "+" : ""}${Number(payload.points ?? 0)}</text><text x="84" y="380" fill="${COLORS.midnight}" font-family="Arial" font-size="18" font-weight="800" letter-spacing="3">${copy.points}</text><text x="84" y="508" fill="${COLORS.midnight}" font-family="Arial" font-size="18" font-weight="800">#${payload.rank ?? "—"} ${copy.rank}</text><rect x="490" y="136" width="660" height="430" fill="${COLORS.panel}" stroke="#F5F7F2" stroke-opacity=".14"/>${textLines(share.metadata.title, 530, 230, { limit: 22, maxLines: 2, size: 58 })}<text x="530" y="394" fill="${COLORS.white}" font-family="Arial" font-size="29" font-weight="800">${escapeXml(score)}</text><path d="M530 438H1106" stroke="#F5F7F2" stroke-opacity=".14"/><text x="530" y="492" fill="${COLORS.lime}" font-family="Arial" font-size="17" font-weight="800" letter-spacing="2">${payload.verified ? copy.verified : copy.powered}</text>`;
}

export function renderShareSvg(share) {
  const { locale } = resolveShareLocaleContext(share);
  const copy = dictionary(locale);
  const content = share.kind === "prediction" ? predictionCard(share, copy) : share.kind === "room" ? inviteCard(share, copy) : resultCard(share, copy);
  const brandOverlay = share.kind === "room" ? brandLogo() : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${defs()}${content}${brandOverlay}</svg>`;
}
