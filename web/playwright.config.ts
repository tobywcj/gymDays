import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/global-setup.ts", "**/helpers/**"],
  globalSetup: "./tests/global-setup.ts",
  timeout: 60000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3478",
    trace: "off",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npx next dev --port 3478",
    url: "http://localhost:3478",
    timeout: 60000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
