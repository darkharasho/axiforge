// @ts-check
const path = require("path");

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
};
