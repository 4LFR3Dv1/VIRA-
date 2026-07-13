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
    payload: { homeTeam: "France", awayTeam: "Spain", choiceLabel: "France" },
  },
  {
    ...base,
    kind: "room",
    metadata: { title: "Join Ana's live room", description: "France vs Spain" },
    payload: { homeTeam: "France", awayTeam: "Spain", participantCount: 8, fixtureStatus: "live" },
  },
  {
    ...base,
    kind: "result",
    metadata: { title: "Ana read the match right", description: "France vs Spain" },
    payload: { homeTeam: "France", awayTeam: "Spain", homeScore: 2, awayScore: 1, points: 100, rank: 1, correct: true, verified: true },
  },
];

for (const sample of samples) {
  await writeFile(resolve(outputDirectory, `${sample.kind}.png`), renderSharePng(sample));
}

process.stdout.write(`${outputDirectory}\n`);
