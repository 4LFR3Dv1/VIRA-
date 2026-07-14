import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PWA manifest is installable without making installation a gate", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/?lang=en");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable")));
});

test("Service Worker cannot cache competitive state and sanitizes notification destinations", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("push"/);
  assert.match(source, /showNotification/);
  assert.match(source, /notificationclick/);
  assert.match(source, /sessionToken/);
  assert.match(source, /participantToken/);
  assert.doesNotMatch(source, /addEventListener\(["']fetch["']/);
  assert.doesNotMatch(source, /caches\.(open|match|put|delete)/);
  assert.doesNotMatch(source, /new\s+Cache/);
  assert.doesNotMatch(source, /silent/i);
});

test("Consumer fonts are bundled locally without a Google Fonts runtime dependency", async () => {
  const source = await readFile(new URL("../src/styles/fonts.css", import.meta.url), "utf8");
  assert.match(source, /@fontsource\/chakra-petch/);
  assert.match(source, /@fontsource\/dm-sans/);
  assert.match(source, /@fontsource\/dm-mono/);
  assert.doesNotMatch(source, /fonts\.(googleapis|gstatic)\.com/);
  assert.doesNotMatch(source, /https?:\/\//);
});
