const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PORT: MOCK_PORT } = require("../mock-server/server");

const VITE_PORT = 5199;
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

  // Build env without ELECTRON_RUN_AS_NODE which VS Code/Claude sets in its shell
  // environment. When set, Electron skips its Chromium initialization and runs as
  // plain Node.js (process.type=undefined, no browser context, no windows).
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: ["."],
    env: {
      ...env,
      APP_PROFILE: "e2e-test",
      GW2_API_ROOT: `http://localhost:${MOCK_PORT}/v2`,
      VITE_DEV_SERVER_URL: `http://localhost:${VITE_PORT}`,
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  // Wait for init() to fully complete — specifically for setProfession() to have fetched the
  // profession catalog and populated #specializationsHost with real spec cards.
  // This proves the full async init chain has finished:
  //   listProfessions() → renderEditorForm() → refreshOnboardingStatus() → initLibrary() →
  //   loadComps() → setProfession() → getCatalog() → renderEditor() → renderSpecializations()
  // Without this wait, tests race against the background setProfession() call from init(),
  // which can overwrite state.activeCatalog and state.editor.specializations mid-test.
  // We wait for article.spec-card (real spec cards) rather than any children, since the
  // static HTML already contains skeleton markup (div.skel-spec-card) that would satisfy
  // a naive children.length > 0 check before init() has run at all.
  await window.waitForFunction(
    () => !!document.querySelector("#specializationsHost article.spec-card"),
    null,
    { timeout: 30_000 }
  );
  return { app, window };
}

async function closeApp(app) {
  if (app) await app.close();
}

module.exports = { launchApp, closeApp, cleanDataDir, DATA_DIR };
