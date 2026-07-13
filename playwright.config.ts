import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.VIRA_BROWSER_SMOKE_TARGET ?? "https://vira.snelabs.space";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(?:deployment-readonly-smoke|consumer-happy-path)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "artifacts/playwright-results",
  reporter: [["list"], ["html", { outputFolder: "artifacts/playwright-report", open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    video: "off",
    // Network traces contain request headers. The smoke emits a sanitized JSON
    // artifact instead so public identity tokens can never be archived.
    trace: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "chromium-mobile-viewport",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
