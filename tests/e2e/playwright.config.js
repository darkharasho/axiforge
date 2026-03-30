// @ts-check
const path = require("path");

const VITE_PORT = 5199;

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: path.join(__dirname, "specs"),
  timeout: 30_000,
  retries: 1,
  workers: 1,
  globalSetup: path.join(__dirname, "global-setup.js"),
  globalTeardown: path.join(__dirname, "global-teardown.js"),
  use: {
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx vite --port ${VITE_PORT}`,
    port: VITE_PORT,
    reuseExistingServer: !process.env.CI,
    cwd: path.resolve(__dirname, "../.."),
  },
};
