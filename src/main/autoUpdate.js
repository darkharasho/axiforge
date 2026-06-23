const { app, ipcMain } = require("electron");

// Lazy-load autoUpdater to avoid initialization order issues with Electron 37+
// (electron-updater accesses app.getVersion() at require time, which fails if the
// Electron built-in module override hasn't run yet)
let _autoUpdater = null;
function getAutoUpdater() {
  if (!_autoUpdater) {
    ({ autoUpdater: _autoUpdater } = require("electron-updater"));
  }
  return _autoUpdater;
}

// Persistent updater log. Writes to the app's userData/logs directory so users can
// share it when an update silently fails to install (e.g. ~/AppData/Roaming/AxiForge/
// logs/auto-update.log on Windows). Lazy-loaded for the same init-order reason above.
let _log = null;
function getLog() {
  if (!_log) {
    _log = require("electron-log");
    try {
      _log.transports.file.fileName = "auto-update.log";
      _log.transports.file.level = "info";
    } catch { /* electron-log not fully initialized in some test envs */ }
  }
  return _log;
}
function log(...args) {
  try { getLog().info("[auto-update]", ...args); } catch { /* never let logging throw */ }
}

const RETRY_ERRORS = [
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE",
  "socket hang up", "ERR_HTTP2_SERVER_REFUSED_STREAM",
];
const RETRY_HTTP_CODES = [502, 503, 504];
const CHECK_DELAY_MS = 3000;
const CHECK_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 2000;

// Late-bound window getter so windows created after init (headless adoption,
// macOS activate reopen) are picked up automatically. Set once by initAutoUpdate.
let getWin = () => null;
let retryAttempts = 0;

function send(channel, data) {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (wc.isLoading()) {
    wc.once("did-finish-load", () => {
      if (!win.isDestroyed()) wc.send(channel, data);
    });
  } else {
    wc.send(channel, data);
  }
}

function isRetryableError(err) {
  const msg = String(err?.message || err || "");
  const code = err?.code || "";
  if (RETRY_ERRORS.some((e) => msg.includes(e) || code.includes(e))) return true;
  if (RETRY_HTTP_CODES.some((c) => msg.includes(String(c)))) return true;
  return false;
}

function checkWithTimeout() {
  const autoUpdater = getAutoUpdater();
  return Promise.race([
    autoUpdater.checkForUpdates(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Update check timed out")), CHECK_TIMEOUT_MS)
    ),
  ]);
}

// Call once per process with a getter that returns the current main window
// (or null). Registers ipcMain handlers and autoUpdater listeners exactly once;
// later windows are reached through the getter, never by re-initializing.
function initAutoUpdate(getWindow) {
  getWin = typeof getWindow === "function" ? getWindow : () => getWindow;

  // Dev fake-update tester — simulate the update lifecycle so the titlebar UI
  // and What's New modal can be exercised without a real release.
  // Enable with `npm run dev:fake-update` (sets AXIFORGE_FAKE_UPDATE=1).
  if (!app.isPackaged && process.env.AXIFORGE_FAKE_UPDATE) {
    const fakeVersion = "99.0.0";
    const realVersion = app.getVersion();
    ipcMain.handle("updater:get-version", () => realVersion);
    ipcMain.on("updater:check", () => runFakeUpdateSequence(fakeVersion));
    ipcMain.on("updater:restart", () => {
      send("update-not-available", { version: realVersion });
    });
    setTimeout(() => runFakeUpdateSequence(fakeVersion), CHECK_DELAY_MS);
    return;
  }

  // Dev mode — auto-updates can't run
  if (!app.isPackaged) {
    ipcMain.handle("updater:get-version", () => app.getVersion());
    ipcMain.on("updater:check", () => {
      send("update-unsupported", { reason: "dev", version: app.getVersion() });
    });
    send("update-unsupported", { reason: "dev", version: app.getVersion() });
    return;
  }

  // Linux without AppImage — auto-update will error
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    ipcMain.handle("updater:get-version", () => app.getVersion());
    ipcMain.on("updater:check", () => {
      send("update-unsupported", { reason: "linux-non-appimage", version: app.getVersion() });
    });
    send("update-unsupported", { reason: "linux-non-appimage", version: app.getVersion() });
    return;
  }

  const autoUpdater = getAutoUpdater();

  autoUpdater.logger = getLog();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  log(`initialized — current version ${app.getVersion()}, platform ${process.platform}`);

  // Tracks whether a download finished this session. An error AFTER this point is an
  // install/apply failure (the download succeeded), not a check/download failure — the
  // two are surfaced differently so a post-download failure isn't silently swallowed.
  let downloadCompleted = false;

  autoUpdater.on("checking-for-update", () => {
    log("checking for update");
    send("update-checking", {});
  });

  autoUpdater.on("update-available", (info) => {
    log(`update available: ${info.version}`);
    send("update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    log(`no update available (latest is ${info.version})`);
    send("update-not-available", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    const message = String(err?.message || err);
    if (isRetryableError(err) && retryAttempts < 1) {
      retryAttempts++;
      log(`retryable error, retrying once: ${message}`);
      setTimeout(() => {
        checkWithTimeout().catch(() => {});
      }, RETRY_DELAY_MS);
      return;
    }
    if (downloadCompleted) {
      // Download succeeded but install/apply failed — this is the silent
      // "downloads then does nothing, re-downloads next launch" failure mode.
      log(`install failed after successful download: ${message}`);
      send("update-install-error", { message });
      return;
    }
    log(`update error: ${message}`);
    send("update-error", { message });
  });

  autoUpdater.on("download-progress", (progress) => {
    send("download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadCompleted = true;
    log(`update downloaded: ${info.version} — staged for install on quit/restart`);
    send("update-downloaded", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  // IPC handlers
  ipcMain.on("updater:check", () => {
    retryAttempts = 0;
    checkWithTimeout().catch(() => {});
  });

  ipcMain.on("updater:restart", () => {
    log("user requested restart-to-install — calling quitAndInstall()");
    getAutoUpdater().quitAndInstall();
  });

  ipcMain.handle("updater:get-version", () => {
    return app.getVersion();
  });

  // Auto-check after delay
  setTimeout(() => {
    checkWithTimeout().catch(() => {});
  }, CHECK_DELAY_MS);
}

function runFakeUpdateSequence(fakeVersion) {
  send("update-available", { version: fakeVersion, releaseDate: new Date().toISOString() });
  let percent = 0;
  const tick = setInterval(() => {
    percent = Math.min(100, percent + 12);
    send("download-progress", { percent, transferred: percent * 1024, total: 100 * 1024 });
    if (percent >= 100) {
      clearInterval(tick);
      setTimeout(() => send("update-downloaded", { version: fakeVersion }), 300);
    }
  }, 300);
}

module.exports = { initAutoUpdate };
