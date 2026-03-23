const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PORT: MOCK_PORT } = require("../mock-server/server");

const APP_NAME = "axiforge-desktop";
const DATA_DIR = getDataDir();

function getDataDir() {
  const appData = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(appData, `${APP_NAME}-e2e-test`, "data");
}

function cleanDataDir() {
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function launchApp({ clean = true } = {}) {
  if (clean) cleanDataDir();

  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      APP_PROFILE: "e2e-test",
      GW2_API_ROOT: `http://localhost:${MOCK_PORT}/v2`,
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector("#professionSelect", { timeout: 15_000 });
  return { app, window };
}

async function closeApp(app) {
  if (app) await app.close();
}

module.exports = { launchApp, closeApp, cleanDataDir, DATA_DIR };
