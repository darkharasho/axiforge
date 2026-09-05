/**
 * Unit tests for src/main/autoUpdate.js — the auto-updater state machine.
 *
 * Mocks electron and electron-updater so we can drive every code path
 * without spawning a window or hitting the network.
 */

const EventEmitter = require("events");

// ── Mocks ──────────────────────────────────────────────────────────────────

let _isPackaged = true;
let _appVersion = "1.2.3";
let _ipcHandlers = {};
let _ipcInvokables = {};

jest.mock("electron", () => ({
  app: {
    get isPackaged() { return _isPackaged; },
    getVersion: () => _appVersion,
  },
  ipcMain: {
    on: (channel, handler) => { _ipcHandlers[channel] = handler; },
    handle: (channel, handler) => { _ipcInvokables[channel] = handler; },
  },
}));

let _autoUpdaterMock = null;
jest.mock("electron-updater", () => ({
  get autoUpdater() { return _autoUpdaterMock; },
}));

// Stub electron-log so updater logging is exercised without writing files or
// spamming the test console.
jest.mock("electron-log", () => ({
  info: jest.fn(),
  transports: { file: {} },
}));

// ── Test helpers ───────────────────────────────────────────────────────────

function makeAutoUpdaterMock() {
  const emitter = new EventEmitter();
  emitter.autoDownload = false;
  emitter.autoInstallOnAppQuit = false;
  emitter.checkForUpdates = jest.fn(() => Promise.resolve());
  emitter.quitAndInstall = jest.fn();
  return emitter;
}

function makeWindowMock({ loading = false } = {}) {
  const wc = new EventEmitter();
  wc.send = jest.fn();
  wc.isLoading = jest.fn(() => loading);
  return {
    webContents: wc,
    isDestroyed: jest.fn(() => false),
  };
}

function resetEnv() {
  delete process.env.AXIFORGE_FAKE_UPDATE;
  delete process.env.APPIMAGE;
  _isPackaged = true;
  _appVersion = "1.2.3";
  _ipcHandlers = {};
  _ipcInvokables = {};
  _autoUpdaterMock = makeAutoUpdaterMock();
}

function loadModule() {
  jest.resetModules();
  return require("../../src/main/autoUpdate");
}

function sentChannels(wc) {
  return wc.send.mock.calls.map(([ch]) => ch);
}

function sentData(wc, channel) {
  const call = wc.send.mock.calls.find(([ch]) => ch === channel);
  return call ? call[1] : undefined;
}

// ── Tests ──────────────────────────────────────────────────────────────────

// initAutoUpdate schedules a 3s auto-check via setTimeout. Run all tests under
// fake timers so we can advance/clear those timers and Jest exits cleanly.
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe("autoUpdate — unsupported environments", () => {
  beforeEach(resetEnv);

  test("dev mode sends update-unsupported with reason dev", () => {
    _isPackaged = false;
    const win = makeWindowMock();
    const { initAutoUpdate } = loadModule();

    initAutoUpdate(win);

    expect(sentChannels(win.webContents)).toContain("update-unsupported");
    expect(sentData(win.webContents, "update-unsupported")).toEqual({
      reason: "dev",
      version: "1.2.3",
    });
  });

  test("dev mode clicking updater:check re-emits update-unsupported", () => {
    _isPackaged = false;
    const win = makeWindowMock();
    const { initAutoUpdate } = loadModule();
    initAutoUpdate(win);

    win.webContents.send.mockClear();
    _ipcHandlers["updater:check"]();

    expect(sentChannels(win.webContents)).toEqual(["update-unsupported"]);
    expect(sentData(win.webContents, "update-unsupported").reason).toBe("dev");
  });

  test("non-AppImage Linux sends update-unsupported with reason linux-non-appimage", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    delete process.env.APPIMAGE;
    const win = makeWindowMock();
    const { initAutoUpdate } = loadModule();

    initAutoUpdate(win);

    expect(sentData(win.webContents, "update-unsupported")).toEqual({
      reason: "linux-non-appimage",
      version: "1.2.3",
    });
  });

  test("Linux WITH AppImage falls through to the normal flow", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.APPIMAGE = "/tmp/AxiForge.AppImage";
    const win = makeWindowMock();
    const { initAutoUpdate } = loadModule();

    initAutoUpdate(win);

    expect(sentChannels(win.webContents)).not.toContain("update-unsupported");
    expect(_autoUpdaterMock.autoDownload).toBe(true);
    expect(_autoUpdaterMock.autoInstallOnAppQuit).toBe(true);
  });
});

describe("autoUpdate — normal packaged flow", () => {
  beforeEach(() => {
    resetEnv();
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  test("registers autoUpdater event handlers and ipc handlers", () => {
    const win = makeWindowMock();
    const { initAutoUpdate } = loadModule();
    initAutoUpdate(win);

    // Event handlers
    expect(_autoUpdaterMock.listenerCount("checking-for-update")).toBe(1);
    expect(_autoUpdaterMock.listenerCount("update-available")).toBe(1);
    expect(_autoUpdaterMock.listenerCount("update-not-available")).toBe(1);
    expect(_autoUpdaterMock.listenerCount("error")).toBe(1);
    expect(_autoUpdaterMock.listenerCount("download-progress")).toBe(1);
    expect(_autoUpdaterMock.listenerCount("update-downloaded")).toBe(1);

    // IPC handlers
    expect(_ipcHandlers["updater:check"]).toBeInstanceOf(Function);
    expect(_ipcHandlers["updater:restart"]).toBeInstanceOf(Function);
    expect(_ipcInvokables["updater:get-version"]).toBeInstanceOf(Function);
  });

  test("checking-for-update emits update-checking", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    _autoUpdaterMock.emit("checking-for-update");

    expect(sentChannels(win.webContents)).toContain("update-checking");
  });

  test("update-available emits update-available with version and date", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    _autoUpdaterMock.emit("update-available", { version: "1.2.4", releaseDate: "2026-01-01" });

    expect(sentData(win.webContents, "update-available")).toEqual({
      version: "1.2.4",
      releaseDate: "2026-01-01",
    });
  });

  test("download-progress forwards percent + bytes", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    _autoUpdaterMock.emit("download-progress", { percent: 42.3, transferred: 100, total: 250 });

    expect(sentData(win.webContents, "download-progress")).toEqual({
      percent: 42.3,
      transferred: 100,
      total: 250,
    });
  });

  test("update-downloaded forwards version + release notes", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    _autoUpdaterMock.emit("update-downloaded", { version: "1.2.4", releaseNotes: "fixed bugs" });

    expect(sentData(win.webContents, "update-downloaded")).toEqual({
      version: "1.2.4",
      releaseNotes: "fixed bugs",
    });
  });

  test("non-retryable error emits update-error immediately", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);
    win.webContents.send.mockClear();

    _autoUpdaterMock.emit("error", new Error("boom"));

    expect(sentData(win.webContents, "update-error")).toEqual({ message: "boom" });
  });

  test("error AFTER a completed download emits update-install-error, not update-error", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    // Download finished, then the install/apply step fails.
    _autoUpdaterMock.emit("update-downloaded", { version: "1.2.4" });
    win.webContents.send.mockClear();
    _autoUpdaterMock.emit("error", new Error("Cannot run installer"));

    expect(sentData(win.webContents, "update-install-error")).toEqual({
      message: "Cannot run installer",
    });
    expect(sentChannels(win.webContents)).not.toContain("update-error");
  });

  test("retryable network error retries once before emitting update-error", async () => {
    jest.useFakeTimers();
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);
    _autoUpdaterMock.checkForUpdates.mockClear();

    _autoUpdaterMock.emit("error", new Error("ECONNRESET while fetching"));
    // First error -> no update-error yet, retry scheduled
    expect(sentChannels(win.webContents)).not.toContain("update-error");

    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    expect(_autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    // Second retryable error -> now emits update-error (retry budget exhausted)
    _autoUpdaterMock.emit("error", new Error("ECONNRESET again"));
    expect(sentData(win.webContents, "update-error")).toEqual({ message: "ECONNRESET again" });

    jest.useRealTimers();
  });

  test("HTTP 503 is treated as retryable", async () => {
    jest.useFakeTimers();
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);
    _autoUpdaterMock.checkForUpdates.mockClear();

    _autoUpdaterMock.emit("error", new Error("Request failed with 503 Service Unavailable"));
    expect(sentChannels(win.webContents)).not.toContain("update-error");

    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    expect(_autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  test("updater:check ipc handler resets retry budget and re-checks", async () => {
    jest.useFakeTimers();
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    // Clear the 3s auto-check that init schedules so it doesn't fire mid-test.
    jest.advanceTimersByTime(3100);
    await Promise.resolve();
    _autoUpdaterMock.checkForUpdates.mockClear();

    // Exhaust the retry budget
    _autoUpdaterMock.emit("error", new Error("ECONNRESET"));
    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    _autoUpdaterMock.emit("error", new Error("ECONNRESET again"));

    _autoUpdaterMock.checkForUpdates.mockClear();
    _ipcHandlers["updater:check"]();
    expect(_autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    // Retry budget reset: a fresh retryable error should retry again
    _autoUpdaterMock.checkForUpdates.mockClear();
    _autoUpdaterMock.emit("error", new Error("ETIMEDOUT"));
    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    expect(_autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  test("a failed download does not escape as an unhandled rejection", async () => {
    // With autoDownload on, checkForUpdates() resolves as soon as the manifest
    // is read and hands back a downloadPromise that is already in flight. If
    // nothing ever attaches a handler to it, a failed download — the ordinary
    // outcome on a flaky connection — takes the whole main process down.
    // Fake the clock (so the 30s race timer stays fake and afterEach clears it)
    // but leave process.nextTick real — unhandledRejection is emitted from the
    // tick queue, and a faked nextTick would never drain it.
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    const rejections = [];
    const onUnhandled = (err) => rejections.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      const win = makeWindowMock();
      _autoUpdaterMock.checkForUpdates = jest.fn(() =>
        Promise.resolve({
          isUpdateAvailable: true,
          downloadPromise: Promise.reject(new Error("net::ERR_CONNECTION_RESET")),
        })
      );
      loadModule().initAutoUpdate(win);
      _ipcHandlers["updater:check"]();
      // unhandledRejection is emitted once the microtask queue drains, which is
      // independent of the fake clock — so the 30s race timer stays fake and
      // afterEach can clear it.
      await new Promise((resolve) => process.nextTick(resolve));
      await new Promise((resolve) => process.nextTick(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a check that never answers reports the timeout instead of hanging", async () => {
    // The 30s race rejects inside this module, so it never reaches
    // autoUpdater.on("error"). Swallowed, it leaves the pill on "Checking..."
    // forever with nothing written to the log.
    jest.useFakeTimers();
    const win = makeWindowMock();
    _autoUpdaterMock.checkForUpdates = jest.fn(() => new Promise(() => {}));
    loadModule().initAutoUpdate(win);

    jest.advanceTimersByTime(3100);
    await Promise.resolve();
    expect(sentChannels(win.webContents)).not.toContain("update-error");

    jest.advanceTimersByTime(30100);
    await Promise.resolve();
    await Promise.resolve();
    expect(sentData(win.webContents, "update-error")).toEqual({
      message: "Update check timed out",
    });

    jest.useRealTimers();
  });

  test("updater:restart calls autoUpdater.quitAndInstall", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    _ipcHandlers["updater:restart"]();
    expect(_autoUpdaterMock.quitAndInstall).toHaveBeenCalled();
  });

  test("updater:get-version returns the app version", async () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    const v = await _ipcInvokables["updater:get-version"]();
    expect(v).toBe("1.2.3");
  });
});

describe("autoUpdate — send() defers while renderer is loading", () => {
  beforeEach(() => {
    resetEnv();
    _isPackaged = false; // dev mode triggers an immediate send on init
  });

  test("queues until did-finish-load when webContents.isLoading() is true", () => {
    const win = makeWindowMock({ loading: true });
    loadModule().initAutoUpdate(win);

    // Nothing sent yet — the message is queued behind did-finish-load
    expect(win.webContents.send).not.toHaveBeenCalled();

    win.webContents.emit("did-finish-load");
    expect(sentData(win.webContents, "update-unsupported")).toEqual({
      reason: "dev",
      version: "1.2.3",
    });
  });

  test("sends immediately when webContents.isLoading() is false", () => {
    const win = makeWindowMock({ loading: false });
    loadModule().initAutoUpdate(win);

    expect(sentChannels(win.webContents)).toContain("update-unsupported");
  });

  test("never sends if the window is destroyed before load completes", () => {
    const win = makeWindowMock({ loading: true });
    loadModule().initAutoUpdate(win);
    win.isDestroyed.mockReturnValue(true);

    win.webContents.emit("did-finish-load");
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

describe("autoUpdate — fake update sequence (dev tester)", () => {
  beforeEach(() => {
    resetEnv();
    _isPackaged = false;
    process.env.AXIFORGE_FAKE_UPDATE = "1";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("kicks off update-available -> download-progress -> update-downloaded over time", () => {
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    // The sequence starts after CHECK_DELAY_MS (3s)
    jest.advanceTimersByTime(3000);
    expect(sentData(win.webContents, "update-available")).toMatchObject({ version: "99.0.0" });

    // Progress ticks fire every 300ms; advance enough to reach 100%
    jest.advanceTimersByTime(300 * 10);
    const progressCalls = win.webContents.send.mock.calls
      .filter(([ch]) => ch === "download-progress")
      .map(([, data]) => data.percent);
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1]).toBe(100);

    // update-downloaded fires shortly after 100%
    jest.advanceTimersByTime(400);
    expect(sentData(win.webContents, "update-downloaded")).toMatchObject({ version: "99.0.0" });
  });

  test("get-version returns the REAL version, not the fake", async () => {
    _appVersion = "0.6.27";
    const win = makeWindowMock();
    loadModule().initAutoUpdate(win);

    const v = await _ipcInvokables["updater:get-version"]();
    expect(v).toBe("0.6.27");
  });
});
