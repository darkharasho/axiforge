const path = require("path");

/** @type {import('playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: path.join(__dirname, "specs"),
  timeout: 30_000,
  retries: 1,
  workers: undefined,
  use: {
    trace: "on-first-retry",
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "npx vite --config src/site/vite.config.js --port 3100",
    port: 3100,
    reuseExistingServer: !process.env.CI,
    cwd: path.join(__dirname, "../.."),
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 375, height: 667 }, hasTouch: true },
    },
    {
      name: "tablet",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
  ],
};
