import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/workspace.spec.ts",
  outputDir: "test-results/workspace",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { slowMo: Number(process.env.PW_SLOW_MO ?? 0) },
    channel: process.env.PW_CHANNEL,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command:
      "node --conditions=react-server --import tsx tests/e2e/fixture/server.mts",
    url: "http://127.0.0.1:4321",
    env: { E2E_LIVE_MODE: "0" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
