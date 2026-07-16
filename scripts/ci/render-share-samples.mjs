import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderSharePng } from "../../backend/share-image-png.mjs";

const outputDirectory = resolve(process.argv[2] ?? "artifacts/share-visual-check");
await mkdir(outputDirectory, { recursive: true });

const base = {
  publicCode: "visual-check",
  editorialContext: {
    locale: "en",
    timeZone: "America/Sao_Paulo",
    localKickoffDate: "14 JUL",
    localKickoffTime: "16:00",
  },
};

const samples = [
  {
    ...base,
    kind: "prediction",
    metadata: { title: "Ana picked France", description: "France vs Spain" },
    destination: { ctaLabel: "Make my pick" },
    payload: { displayName: "Ana", homeTeam: "France", awayTeam: "Spain", choiceLabel: "France" },
  },
  {
    ...base,
    kind: "room",
    metadata: { title: "Join Ana's live room", description: "France vs Spain" },
    destination: { ctaLabel: "Join the room" },
    payload: { displayName: "Ana", homeTeam: "France", awayTeam: "Spain", participantCount: 8, fixtureStatus: "live" },
  },
  {
    ...base,
    kind: "result",
    metadata: { title: "Ana read the match right", description: "France vs Spain" },
    destination: { ctaLabel: "Make your pick" },
    payload: { displayName: "Ana", homeTeam: "France", awayTeam: "Spain", homeScore: 2, awayScore: 1, points: 100, rank: 1, correct: true, verified: true },
  },
  {
    ...base,
    publicCode: "visual-picks-en",
    kind: "picks",
    metadata: { title: "Ana · VIRA Picks", description: "Social predictions. No money involved." },
    destination: { ctaLabel: "Make your picks" },
    payload: { displayName: "Ana", homeTeam: "France", awayTeam: "Spain", selections: [{ kind: "match_result", selection: "home" }, { kind: "total_goals", selection: "over" }, { kind: "both_teams_score", selection: "yes" }] },
  },
  {
    ...base,
    publicCode: "visual-picks-result-pt",
    kind: "picks_result",
    editorialContext: { ...base.editorialContext, locale: "pt-BR" },
    metadata: { title: "Ana · 2/3", description: "Previsões sociais. Sem dinheiro envolvido." },
    destination: { ctaLabel: "Faça suas previsões" },
    payload: { displayName: "Ana", homeTeam: "France", awayTeam: "Spain", homeScore: 2, awayScore: 1, selections: [{ kind: "match_result", selection: "home" }, { kind: "total_goals", selection: "over" }, { kind: "both_teams_score", selection: "no" }], results: [{ status: "correct" }, { status: "correct" }, { status: "missed" }] },
  },
];

for (const sample of samples) {
  await writeFile(resolve(outputDirectory, `${sample.kind}.png`), renderSharePng(sample));
}

process.stdout.write(`${outputDirectory}\n`);
