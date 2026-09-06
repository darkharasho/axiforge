const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PORT: MOCK_PORT } = require("../mock-server/server");
const { workerIndex, syncPort } = require("./ports");

// Per worker, not per suite: several Electron apps run at once and each needs a
// sync server and a profile directory nobody else touches. @see ports.js
const SYNC_PORT = syncPort();

const VITE_PORT = 5199;

// Wiki fact resolution is off by default (see AXIFORGE_DISABLE_WIKI below). Specs that
// assert PvE/WvW split behaviour need it on, pointed at the mock's stand-in wiki:
//   launchApp({ env: WIKI_ENABLED_ENV })
const WIKI_ENABLED_ENV = {
  AXIFORGE_DISABLE_WIKI: "0",
  AXIFORGE_WIKI_API_ROOT: `http://localhost:${MOCK_PORT}/wiki-api.php`,
};
const APP_NAME = "axiforge-desktop";
const DATA_DIR = getDataDir();

function getDataDir() {
  const appData = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  // Suffixed with the worker slot. Every spec calls cleanDataDir(), which wipes
  // the directory outright — shared between parallel workers that is one spec
  // deleting another's library mid-run.
  return path.join(appData, `${APP_NAME}-e2e-test-w${workerIndex()}`, "data");
}

function cleanDataDir() {
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function launchApp({ clean = true, env: envOverride = {} } = {}) {
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
      // Distinct per worker, so two apps never share an Electron userData dir.
      APP_PROFILE: `e2e-test-w${workerIndex()}`,
      GW2_API_ROOT: `http://localhost:${MOCK_PORT}/v2`,
      VITE_DEV_SERVER_URL: `http://localhost:${VITE_PORT}`,
      AXIFORGE_SYNC_BASE: `http://localhost:${SYNC_PORT}/api/sync`,
      // Reuses the sync mock server (it's the same process, just an unprefixed
      // `/user` route) instead of spinning up a third server for one endpoint.
      // getSession()'s getViewer() call is the only real-GitHub-API hop that
      // `teams:enable` makes; everything else it does goes through AXIFORGE_SYNC_BASE.
      AXIFORGE_GITHUB_API_ROOT: `http://localhost:${SYNC_PORT}`,
      // Keep catalog builds offline and fast: the wiki fact pass and the remote
      // data snapshot are both network-bound and would outrun the readiness wait
      // below on a freshly wiped DATA_DIR.
      AXIFORGE_DISABLE_WIKI: "1",
      AXIFORGE_DISABLE_REMOTE_DATA: "1",
      // Never map the window: without this every spec's launch steals desktop focus.
      // Playwright drives the renderer over CDP, which does not need a visible window.
      AXIFORGE_HIDE_WINDOW: "1",
      ...envOverride,
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  // Wait for init() to fully complete — specifically for listProfessions() to have
  // resolved and renderEditorForm() to have populated the profession selector.
  // This proves the full async init chain has finished:
  //   listBuilds()/listProfessions() -> renderEditorForm() -> refreshOnboardingStatus() ->
  //   initLibrary() -> loadComps() -> render()
  // We wait on the profession selector's real options (.cselect__option) rather than on
  // spec cards: the app opens on the library page with NO profession selected, so
  // #specializationsHost legitimately stays in its empty state until a test picks one.
  await window.waitForFunction(
    () => document.querySelectorAll("#professionSelect .cselect__option").length > 0,
    null,
    { timeout: 30_000 }
  );
  return { app, window };
}

async function closeApp(app) {
  if (app) await app.close();
}

module.exports = { WIKI_ENABLED_ENV, launchApp, closeApp, cleanDataDir, DATA_DIR };
