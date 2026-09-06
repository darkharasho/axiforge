// @ts-check
const path = require("path");
const os = require("os");

const VITE_PORT = 5199;

// Every worker runs its own Electron app, which is the expensive part — so the
// cap is memory, not CPU. Two workers is a safe default on a developer machine
// that is also running the app, a browser and a game; raise it with E2E_WORKERS
// when the machine is free. Each worker is fully isolated (its own sync server
// and its own profile directory) — see tests/e2e/helpers/ports.js.
const WORKERS = Number(process.env.E2E_WORKERS) || Math.max(1, Math.min(4, Math.floor(os.cpus().length / 6)));

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: path.join(__dirname, "specs"),
  timeout: 60_000,
  retries: 1,
  // Parallel across FILES only. Specs inside a file share an app and run in
  // order on purpose, so fullyParallel stays off.
  workers: WORKERS,
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
