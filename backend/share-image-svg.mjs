import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveShareLocaleContext } from "../shared/share-copy.mjs";
import { canonicalMarketSelectionLabel, canonicalOutcomeSelection } from "../shared/canonical-market-copy.mjs";

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

function textLines(value, x, y, { limit = 24, maxLines = 3, size = 64, lineHeight = 0.92, color = COLORS.white, weight = 700, anchor = "start", className = "display" } = {}) {
  return words(value, limit, maxLines).map((line, index) => `<text class="${className}" x="${x}" y="${y + index * size * lineHeight}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(line)}</text>`).join("");
}

function dictionary(locale) {
  return locale === "en" ? {
    prediction: "MATCH PICK", invite: "LIVE ROOM", result: "MATCH RESULT", playbackResult: "CERTIFIED PLAYBACK", picks: "VIRA PICKS", picksResult: "PICKS RESULT", socialCard: "SOCIAL CARD", noMoney: "NO MONEY INVOLVED", makePicks: "MAKE YOUR PICKS", locks: "LOCKS AT KICKOFF", noGate: "NO ACCOUNT · NO X · NO WALLET", powered: "SPORTS DATA BY TxLINE", kickoff: "KICKOFF", players: "FANS IN", join: "JOIN NOW", correct: "CORRECT", missed: "MISSED", void: "VOID", pending: "PENDING", points: "POINTS", rank: "RANK", verified: "REPRODUCIBLE RESULT", pick: "PICK", backing: "IS BACKING", whoWith: "WHO ARE YOU WITH?", seesDraw: "SEES A DRAW", yourCall: "WHAT'S YOUR CALL?", opened: "OPENED THIS MATCH", areYouIn: "ARE YOU IN?", called: "CALLED", readNext: "CAN YOU READ THE NEXT ONE?", oneSignal: "ONE SIGNAL. ONE LOCK.", sameResult: "ONE REPRODUCIBLE RESULT.", replayRound: "REPLAY THE ROUND",
  } : {
    prediction: "PALPITE", invite: "SALA AO VIVO", result: "RESULTADO", playbackResult: "PLAYBACK CERTIFICADO", picks: "VIRA PICKS", picksResult: "RESULTADO PICKS", socialCard: "CARD SOCIAL", noMoney: "SEM DINHEIRO ENVOLVIDO", makePicks: "FAÇA SUAS PREVISÕES", locks: "FECHA NO INÍCIO", noGate: "SEM CONTA · SEM X · SEM WALLET", powered: "DADOS ESPORTIVOS TxLINE", kickoff: "INÍCIO", players: "FÃS NA SALA", join: "ENTRE AGORA", correct: "CORRETA", missed: "INCORRETA", void: "ANULADA", pending: "PENDENTE", points: "PONTOS", rank: "POSIÇÃO", verified: "RESULTADO REPRODUZÍVEL", pick: "ESCOLHA", backing: "APOIA", whoWith: "DE QUE LADO VOCÊ ESTÁ?", seesDraw: "VÊ UM EMPATE", yourCall: "QUAL É O SEU PALPITE?", opened: "ABRIU ESTA PARTIDA", areYouIn: "VOCÊ VEM?", called: "ACERTOU", readNext: "CONSEGUE ACERTAR A PRÓXIMA?", oneSignal: "UM SINAL. UM LOCK.", sameResult: "UM RESULTADO REPRODUZÍVEL.", replayRound: "REPRODUZIR A RODADA",
  };
}

function brandLogo() {
  return logoData
    ? `<image href="${logoData}" x="54" y="42" width="224" height="70" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="54" y="91" fill="${COLORS.white}" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="900" letter-spacing="5">VIRA</text>`;
}

function base(kindLabel) {
  return `<rect width="1200" height="630" fill="${COLORS.midnight}"/><path d="M0 0H1200V630H0Z" fill="url(#grid)" opacity=".18"/>${brandLogo()}<text class="display eyebrow" x="1146" y="76" text-anchor="end" fill="${COLORS.lime}" font-size="18">${kindLabel}</text>`;
}

const TEAM_VISUALS = {
  argentina: ["#74ACDF", "#FFFFFF", "argentina"], brazil: ["#009739", "#FEDD00", "brazil"], england: ["#FFFFFF", "#CE1124", "england"], france: ["#002395", "#ED2939", "france"], "frança": ["#002395", "#ED2939", "france"], spain: ["#AA151B", "#F1BF00", "spain"], "espanha": ["#AA151B", "#F1BF00", "spain"],
  germany: ["#000000", "#DD0000", "horizontal"], italy: ["#009246", "#CE2B37", "vertical"], portugal: ["#046A38", "#DA291C", "vertical"], netherlands: ["#AE1C28", "#21468B", "horizontal"], belgium: ["#000000", "#FDDA24", "vertical"],
  mexico: ["#006847", "#CE1126", "vertical"], uruguay: ["#FFFFFF", "#5CBFEB", "horizontal"], japan: ["#FFFFFF", "#BC002D", "japan"], morocco: ["#C1272D", "#006233", "morocco"], "united states": ["#B22234", "#3C3B6E", "usa"], usa: ["#B22234", "#3C3B6E", "usa"],
};

function teamCode(name) { return String(name ?? "TEAM").replace(/[^a-z0-9\s]/gi, "").trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase() || "FC"; }
function teamVisual(name) { const key = String(name ?? "").trim().toLowerCase(); if (TEAM_VISUALS[key]) return TEAM_VISUALS[key]; const palette = [["#552583", "#FDB927"], ["#0057B8", "#FFD700"], ["#A71930", "#FFFFFF"], ["#007A33", "#FFFFFF"]]; const seed = [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0); return [...palette[seed % palette.length], "fallback"]; }
function teamFlag(name, x, y, width = 126, height = 78) {
  const [primary, secondary, kind] = teamVisual(name); const code = teamCode(name); const clip = `flag-${code}-${x}-${y}`;
  const common = `<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5"/></clipPath></defs><g data-team-flag="${escapeXml(name)}" clip-path="url(#${clip})"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${primary}"/>`;
  let art = "";
  if (kind === "france" || kind === "vertical") art = `<rect x="${x + width / 3}" y="${y}" width="${width / 3}" height="${height}" fill="#FFFFFF"/><rect x="${x + width * 2 / 3}" y="${y}" width="${width / 3}" height="${height}" fill="${secondary}"/>`;
  else if (kind === "spain") art = `<rect x="${x}" y="${y + height * .25}" width="${width}" height="${height * .5}" fill="${secondary}"/>`;
  else if (kind === "england") art = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#FFFFFF"/><rect x="${x + width * .43}" y="${y}" width="${width * .14}" height="${height}" fill="${secondary}"/><rect x="${x}" y="${y + height * .4}" width="${width}" height="${height * .2}" fill="${secondary}"/>`;
  else if (kind === "argentina") art = `<rect x="${x}" y="${y + height / 3}" width="${width}" height="${height / 3}" fill="#FFFFFF"/><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${height * .08}" fill="#F6B40E"/>`;
  else if (kind === "brazil") art = `<path d="M${x + width / 2} ${y + 8}L${x + width - 10} ${y + height / 2}L${x + width / 2} ${y + height - 8}L${x + 10} ${y + height / 2}Z" fill="${secondary}"/><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${height * .18}" fill="#012169"/>`;
  else if (kind === "japan") art = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#FFFFFF"/><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${height * .23}" fill="${secondary}"/>`;
  else if (kind === "morocco") art = `<text x="${x + width / 2}" y="${y + height * .68}" text-anchor="middle" fill="${secondary}" font-size="${height * .52}">★</text>`;
  else if (kind === "horizontal") art = `<rect x="${x}" y="${y + height / 3}" width="${width}" height="${height / 3}" fill="#FFFFFF"/><rect x="${x}" y="${y + height * 2 / 3}" width="${width}" height="${height / 3}" fill="${secondary}"/>`;
  else if (kind === "usa") art = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#FFFFFF"/>${[0,2,4,6].map((index) => `<rect x="${x}" y="${y + index * height / 7}" width="${width}" height="${height / 7}" fill="${primary}"/>`).join("")}<rect x="${x}" y="${y}" width="${width * .45}" height="${height * .55}" fill="${secondary}"/>`;
  else art = `<path d="M${x} ${y + height}L${x + width} ${y}V${y + height}Z" fill="${secondary}"/><text class="display" x="${x + width / 2}" y="${y + height * .66}" text-anchor="middle" fill="#FFFFFF" font-size="${height * .3}">${code}</text>`;
  return `${common}${art}</g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="none" stroke="#FFFFFF" stroke-opacity=".28"/>`;
}
function matchupIdentity(payload) {
  const home = payload.homeTeam ?? "HOME"; const away = payload.awayTeam ?? "AWAY";
  const [homeColor] = teamVisual(home); const [awayColor] = teamVisual(away);
  return `<path d="M0 126H600V252H0Z" fill="${homeColor}" opacity=".13"/><path d="M600 126H1200V252H600Z" fill="${awayColor}" opacity=".13"/><path d="M0 126H1200" stroke="#FFFFFF" stroke-opacity=".15"/>${teamFlag(home, 58, 150)}<text class="display" x="206" y="198" fill="${COLORS.white}" font-size="30">${escapeXml(String(home).toUpperCase())}</text><text class="display" x="574" y="198" text-anchor="middle" fill="${COLORS.muted}" font-size="18" letter-spacing="3">VS</text>${teamFlag(away, 630, 150)}<text class="display" x="778" y="198" fill="${COLORS.white}" font-size="30">${escapeXml(String(away).toUpperCase())}</text>`;
}
function activationCta(share, copy, y = 432) { const label = String(share.destination?.ctaLabel || copy.join).toUpperCase(); return `<rect x="842" y="${y}" width="308" height="122" fill="${COLORS.lime}"/><text class="display" x="878" y="${y + 52}" fill="${COLORS.midnight}" font-size="17" letter-spacing="1.2">${escapeXml(label)}</text><text class="display" x="1110" y="${y + 86}" text-anchor="end" fill="${COLORS.midnight}" font-size="38">→</text>`; }

function defs() {
  return `<defs><style>text{font-family:"DM Sans",sans-serif;font-weight:650}.display{font-family:"Chakra Petch",sans-serif;font-weight:700}.eyebrow{letter-spacing:4px}</style><pattern id="grid" width="90" height="90" patternUnits="userSpaceOnUse"><path d="M90 0H0V90" fill="none" stroke="#F5F7F2" stroke-opacity=".12"/></pattern></defs>`;
}

function predictionCard(share, copy) {
  const payload = share.payload ?? {};
  const kickoff = share.editorialContext?.localKickoffDate ? `${share.editorialContext.localKickoffDate} · ${share.editorialContext.localKickoffTime ?? ""}` : "—";
  const locale = resolveShareLocaleContext(share).locale;
  const choiceLabel = canonicalMarketSelectionLabel(canonicalOutcomeSelection(payload.choice), { locale, homeTeam: payload.homeTeam, awayTeam: payload.awayTeam });
  const name = String(payload.displayName ?? "A FAN").toUpperCase(); const choice = String(choiceLabel ?? (locale === "en" ? "THE MATCH" : "A PARTIDA")).toUpperCase();
  return `${base(copy.prediction)}${matchupIdentity(payload)}${textLines(`${name} ${copy.backing} ${choice}.`, 58, 328, { limit: 22, maxLines: 2, size: 54 })}<text class="display" x="58" y="475" fill="${COLORS.lime}" font-size="31" letter-spacing=".5">${copy.whoWith}</text><text x="58" y="538" fill="${COLORS.muted}" font-size="15" letter-spacing="2">${copy.kickoff} · ${escapeXml(kickoff)}</text>${activationCta(share, copy)}`;
}

function inviteCard(share, copy) {
  const payload = share.payload ?? {};
  const count = Number(payload.participantCount ?? 0);
  const name = String(payload.displayName ?? "A FAN").toUpperCase();
  return `${base(copy.invite)}${matchupIdentity(payload)}${textLines(`${name} ${copy.opened}.`, 58, 330, { limit: 22, maxLines: 2, size: 54 })}<text class="display" x="58" y="476" fill="${COLORS.lime}" font-size="34">${copy.areYouIn}</text><text x="58" y="538" fill="${COLORS.muted}" font-size="16" letter-spacing="2">${escapeXml(String(payload.fixtureStatus ?? "LIVE").toUpperCase())} · ${count} ${copy.players} · ${copy.noGate}</text>${activationCta(share, copy)}`;
}

function resultCard(share, copy) {
  const payload = share.payload ?? {};
  const correct = payload.correct === true;
  const score = Number.isFinite(payload.homeScore) && Number.isFinite(payload.awayScore) ? `${payload.homeTeam ?? ""} ${payload.homeScore} : ${payload.awayScore} ${payload.awayTeam ?? ""}` : `${payload.homeTeam ?? ""} × ${payload.awayTeam ?? ""}`;
  const name = String(payload.displayName ?? "A FAN").toUpperCase();
  const outcome = correct ? `${name} ${copy.called} IT.` : `${name} MADE THE CALL.`;
  const context = `${correct ? copy.correct : copy.missed} · ${Number(payload.points ?? 0) > 0 ? "+" : ""}${Number(payload.points ?? 0)} ${copy.points} · #${payload.rank ?? "—"} ${copy.rank}`;
  return `${base(copy.result)}${matchupIdentity(payload)}${textLines(outcome, 58, 334, { limit: 22, maxLines: 2, size: 56 })}<text class="display" x="58" y="442" fill="${COLORS.lime}" font-size="30">${escapeXml(score)}</text><text class="display" x="58" y="486" fill="${COLORS.white}" font-size="22">${copy.readNext}</text><text x="58" y="538" fill="${COLORS.muted}" font-size="15" letter-spacing="1.5">${escapeXml(context)} · ${payload.verified ? copy.verified : copy.powered}</text>${activationCta(share, copy)}`;
}

function pickLabel(selection, locale) {
  const en = locale === "en";
  if (selection.kind === "match_result") return canonicalMarketSelectionLabel(canonicalOutcomeSelection(selection.selection), { locale }) ?? "—";
  if (selection.kind === "total_goals") return `${canonicalMarketSelectionLabel(selection.selection, { locale }) ?? "—"} ${en ? "2.5" : "de 2,5"}`;
  return selection.selection === "yes" ? (en ? "Both score: Yes" : "Ambas marcam: Sim") : (en ? "Both score: No" : "Ambas marcam: Não");
}

function picksRows(payload, copy, locale, resultMode) {
  return (payload.selections ?? []).slice(0, 3).map((selection, index) => {
    const y = 268 + index * 82; const status = payload.results?.[index]?.status ?? "pending";
    const statusLabel = status === "correct" ? copy.correct : status === "missed" ? copy.missed : status === "void" ? copy.void : copy.pending;
    const statusColor = status === "correct" ? COLORS.lime : status === "missed" ? "#FF8A8A" : COLORS.muted;
    return `<text x="82" y="${y}" fill="${COLORS.white}" font-family="Arial" font-size="27" font-weight="800">${escapeXml(pickLabel(selection, locale))}</text>${resultMode ? `<text x="760" y="${y}" fill="${statusColor}" font-family="Arial" font-size="17" font-weight="800" letter-spacing="2">${statusLabel}</text>` : ""}<path d="M82 ${y + 28}H820" stroke="#F5F7F2" stroke-opacity=".12"/>`;
  }).join("");
}

function picksCard(share, copy, locale, resultMode = false) {
  const payload = share.payload ?? {}; const matchup = `${payload.homeTeam ?? ""} × ${payload.awayTeam ?? ""}`;
  const correct = (payload.results ?? []).filter((item) => item.status === "correct").length; const total = (payload.selections ?? []).length;
  const score = Number.isFinite(payload.homeScore) && Number.isFinite(payload.awayScore) ? `${payload.homeTeam} ${payload.homeScore} : ${payload.awayScore} ${payload.awayTeam}` : matchup;
  if (resultMode) return `${base(copy.picksResult)}${matchupIdentity(payload)}${textLines(`${String(payload.displayName ?? "A FAN").toUpperCase()} ${copy.called} ${correct}/${total}.`, 58, 334, { limit: 22, maxLines: 2, size: 56 })}<text class="display" x="58" y="445" fill="${COLORS.lime}" font-size="28">${escapeXml(score)}</text><text x="58" y="530" fill="${COLORS.muted}" font-size="15" letter-spacing="2">${copy.verified} · ${copy.noMoney}</text>${activationCta({ ...share, destination: { ...share.destination, ctaLabel: locale === "en" ? "See the picks" : "Ver previsões" } }, copy)}`;
  const matchPick = (payload.selections ?? []).find((selection) => selection.kind === "match_result");
  const side = matchPick?.selection === "home" ? payload.homeTeam : matchPick?.selection === "away" ? payload.awayTeam : null;
  const headline = side ? `${String(payload.displayName ?? "A FAN").toUpperCase()} ${copy.backing} ${String(side).toUpperCase()}.` : `${String(payload.displayName ?? "A FAN").toUpperCase()} ${copy.seesDraw}.`;
  const secondary = (payload.selections ?? []).filter((selection) => selection.kind !== "match_result").slice(0, 2).map((selection) => pickLabel(selection, locale)).join(" · ");
  return `${base(copy.picks)}${matchupIdentity(payload)}${textLines(headline, 58, 326, { limit: 22, maxLines: 2, size: 54 })}<text class="display" x="58" y="465" fill="${COLORS.lime}" font-size="30">${side ? copy.whoWith : copy.yourCall}</text><text x="58" y="530" fill="${COLORS.muted}" font-size="16" letter-spacing="1.5">${escapeXml(secondary || copy.locks)} · ${copy.noMoney}</text>${activationCta(share, copy)}`;
}

function playbackResultCard(share, copy) {
  const payload = share.payload ?? {};
  const score = `${payload.homeTeam ?? ""} ${payload.homeScore ?? "—"} : ${payload.awayScore ?? "—"} ${payload.awayTeam ?? ""}`;
  return `${base(copy.playbackResult)}${matchupIdentity(payload)}<text class="display" x="58" y="342" fill="${COLORS.white}" font-size="58">${escapeXml(copy.oneSignal)}</text><text class="display" x="58" y="408" fill="${COLORS.lime}" font-size="48">${escapeXml(copy.sameResult)}</text><text class="display" x="58" y="484" fill="${COLORS.white}" font-size="28">${escapeXml(score)}</text><text x="58" y="538" fill="${COLORS.muted}" font-size="15" letter-spacing="1.5">TxLINE · ${escapeXml(copy.verified)}</text>${activationCta({ ...share, destination: { ...share.destination, ctaLabel: copy.replayRound } }, copy)}`;
}

export function renderShareSvg(share) {
  const { locale } = resolveShareLocaleContext(share);
  const copy = dictionary(locale);
  const content = share.kind === "prediction" ? predictionCard(share, copy) : share.kind === "room" ? inviteCard(share, copy) : share.kind === "picks" ? picksCard(share, copy, locale) : share.kind === "picks_result" ? picksCard(share, copy, locale, true) : share.kind === "playback_result" ? playbackResultCard(share, copy) : resultCard(share, copy);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${defs()}${content}</svg>`;
}
