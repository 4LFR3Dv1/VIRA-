import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import { renderShareSvg } from "./share-image-svg.mjs";

const shareFontCandidates = [
  new URL("./assets/fonts/ChakraPetch-Bold.ttf", import.meta.url),
  new URL("./assets/fonts/DMSans-Variable.ttf", import.meta.url),
];

export function resolveShareFontFiles(candidates = shareFontCandidates, fileExists = existsSync) {
  const files = candidates
    .map((candidate) => candidate instanceof URL ? fileURLToPath(candidate) : candidate)
    .filter((candidate) => fileExists(candidate));

  if (files.length !== candidates.length) {
    throw new Error("share_image_fonts_missing");
  }

  return files;
}

export function renderSharePng(share) {
  return Buffer.from(new Resvg(renderShareSvg(share), {
    fitTo: { mode: "width", value: 1200 },
    background: "#050A12",
    font: {
      loadSystemFonts: false,
      fontFiles: resolveShareFontFiles(),
      defaultFontFamily: "DM Sans",
      sansSerifFamily: "DM Sans",
    },
  }).render().asPng());
}
