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

const RETRY_ERRORS = [
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE",
  "socket hang up", "ERR_HTTP2_SERVER_REFUSED_STREAM",
];
const RETRY_HTTP_CODES = [502, 503, 504];
const CHECK_DELAY_MS = 3000;
const CHECK_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 2000;

let mainWindow = null;
let retryAttempts = 0;

function send(channel, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (wc.isLoading()) {
    wc.once("did-finish-load", () => {
      if (!mainWindow.isDestroyed()) wc.send(channel, data);
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

function initAutoUpdate(win) {
  mainWindow = win;

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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    send("update-checking", {});
  });

  autoUpdater.on("update-available", (info) => {
    send("update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    send("update-not-available", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    if (isRetryableError(err) && retryAttempts < 1) {
      retryAttempts++;
      setTimeout(() => {
        checkWithTimeout().catch(() => {});
      }, RETRY_DELAY_MS);
      return;
    }
    send("update-error", { message: String(err?.message || err) });
  });

  autoUpdater.on("download-progress", (progress) => {
    send("download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
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
