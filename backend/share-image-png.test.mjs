import assert from "node:assert/strict";
import test from "node:test";
import { renderSharePng } from "./share-image-png.mjs";

test("share renderer produces a real 1200x630 PNG", () => {
  const png = renderSharePng({ kind: "prediction", metadata: { title: "Bob escolheu France" }, destination: { ctaLabel: "Fazer meu palpite" }, payload: { homeTeam: "France", awayTeam: "Spain" } });
  assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length > 5_000);
});
