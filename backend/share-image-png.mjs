import { Resvg } from "@resvg/resvg-js";

import { renderShareSvg } from "./share-image-svg.mjs";

export function renderSharePng(share) {
  return Buffer.from(new Resvg(renderShareSvg(share), { fitTo: { mode: "width", value: 1200 }, background: "#050A12" }).render().asPng());
}
