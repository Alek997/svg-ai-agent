import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
import { requireLiveSmokeApproval } from "./tests/e2e/live/settings";

requireLiveSmokeApproval();
if (
  process.argv.some((argument) =>
    /^--(?:repeat-each|retries|workers|project|shard)(?:=|$)/.test(argument),
  )
)
  throw new Error(
    "Live smoke forbids CLI options that can multiply runs. It always runs one test, one worker, no retries.",
  );

export default defineConfig({
  ...config,
  testMatch: "**/live/live.spec.ts",
  outputDir: "test-results/live",
  workers: 1,
  retries: 0,
  repeatEach: 1,
  timeout: 105_000,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    ...config.use,
    baseURL: "http://127.0.0.1:4322",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "live-chromium" }],
  webServer: {
    command: "npm run test:e2e:fixture",
    url: "http://127.0.0.1:4322",
    env: { E2E_LIVE_MODE: "1" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
