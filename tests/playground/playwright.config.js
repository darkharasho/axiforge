const path = require("path");

/** @type {import('playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: path.join(__dirname, "specs"),
  timeout: 30_000,
  retries: 1,
  workers: undefined,
  use: {
    trace: "on-first-retry",
    baseURL: "http://localhost:5180",
  },
  webServer: {
    command: "npm run gen:web-html && npx vite --config src/web/vite.config.js --port 5180",
    port: 5180,
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
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
};
