const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

// Ignore EPIPE errors on stdout/stderr — AppImage launches may close the
// parent pipe, and writing to it would crash the main process.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.("error", (err) => { if (err.code !== "EPIPE") throw err; });
}
const { app, BrowserWindow, ipcMain, dialog, clipboard, screen, shell } = require("electron");

// Taskbar identity on X11 — give AxiForge its own WM_CLASS so KDE/GNOME
// don't group it with whatever process launched electron (e.g. a VS Code
// terminal). Do NOT use app.setName() here: that would change app.getName()
// and move userData to a new path, orphaning existing users' builds.
app.commandLine.appendSwitch("class", "AxiForge");
const { BuildStore } = require("./buildStore");
const { FolderStore } = require("./folderStore");
const { CompStore } = require("./compStore");
const { SyncStore } = require("./syncStore");
const { BuildHistoryStore, summarizeBuildChange } = require("./buildHistoryStore");
const { TeamSync } = require("./teamSync");
const { beginGitHubDeviceAuth, completeGitHubDeviceAuth } = require("./githubAuth");
const {
  TARGET_REPO,
  getViewer,
  listTargets,
  ensureAxiForgeRepo,
  ensurePages,
  getPagesBuildStatus,
  getRepo,
  ensurePagesWorkflow,
  triggerPagesWorkflow,
  publishSiteBundle,
  deleteFile,
  pollUrlLive,
} = require("./githubApi");
const { getProfessionList, getProfessionCatalog, getUpgradeCatalog, getWikiSummary, getWikiRelatedData, initDiskCache, clearDiskCache, initWikiClient, clearCatalogCache } = require("./gw2Data");
const { slugifyBuildName, generateFileId, generateEncryptionKey, getDefaultBuildName } = require("./buildEncryption");
const { buildSpaBundle, buildEncryptedBuildFile, buildEncryptedCompFile, buildRedirectFile } = require("./siteBundle");
const { snapshotDaily } = require("./jsonFile");
const { serializeForPublish, loadCrossProfessionCatalogs } = require("./buildPublish");
const { serializeCompForPublish, getCompPublishBuildIds } = require("./compPublish");
const { initAutoUpdate } = require("./autoUpdate");
const { registerAxicodeFileHandlers } = require("./axicodeFile");
const { createLocalApi, generateToken, httpError } = require("./localApi");
const { writeDiscoveryFile, removeDiscoveryFileSync } = require("./localApiDiscovery");
const { parseCliFlags } = require("./cliFlags");
const { shareRejectionReason } = require("./shareGate");
const { shortUrl, publishedOwnerFor } = require("./shortUrl");
const { assertCanMoveOutOfTeam, assertFolderTreeFits, decideCompBuildPublish } = require("./teamGuards");

const PROFESSION_THEME_IDS = {
  Guardian: "prof-guardian", Warrior: "prof-warrior", Necromancer: "prof-necromancer",
  Engineer: "prof-engineer", Ranger: "prof-ranger", Thief: "prof-thief",
  Mesmer: "prof-mesmer", Elementalist: "prof-elementalist", Revenant: "prof-revenant",
};

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";
const APP_PROFILE = process.env.APP_PROFILE;
if (APP_PROFILE && !app.isPackaged) {
  const profileUserData = path.join(app.getPath("appData"), `${app.getName()}-${APP_PROFILE}`);
  app.setPath("userData", profileUserData);
}

// Note: --headless is also a Chromium switch; Electron forwards unknown
// switches to Chromium. In practice the main process controls window creation
// so this is benign, but if platform quirks appear, rename to --no-window
// (coordinate with AxiVale's launcher).
const cliFlags = parseCliFlags(process.argv);

// Single instance: a second launch hands its argv to the running instance and
// exits. A later *windowed* launch against a running headless instance opens
// the window in the existing process (see "second-instance" below).
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  if (parseCliFlags(argv).headless) return; // services already running — nothing to show
  // A windowed launch is being adopted by this instance. Claim it synchronously
  // so a pending headless quit (quitIfHeadless) aborts instead of killing the
  // process before the window opens.
  windowPending = true;
  // Wait for startup init (stores, IPC handlers) so an adopted window never
  // opens against a half-initialized process.
  readyWork.then(() => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    } else {
      openMainWindow();
    }
  }).catch((err) => console.error("[startup] adoption failed:", err))
    .finally(() => { windowPending = false; });
});

const dataDir = path.join(app.getPath("userData"), "data");
const store = new BuildStore(dataDir);
const folderStore = new FolderStore(dataDir);
const compStore = new CompStore(dataDir);
const syncStore = new SyncStore(dataDir);
const buildHistoryStore = new BuildHistoryStore(dataDir);

// Publishing infrastructure (repo, Pages workflow file, Pages config) only needs
// verifying once per owner per process. Re-checking it on every publish cost
// several round trips (~2-4s) for no benefit. If a later publish hits a 404
// (repo deleted, Pages disabled) the cache is cleared and the full check reruns.
const _publishInfraVerified = new Set();
async function ensurePublishInfra(token, owner, ownerType, branch) {
  const key = `${owner}/${branch}`;
  if (_publishInfraVerified.has(key)) return;
  await ensureAxiForgeRepo(token, owner, ownerType);
  await ensurePagesWorkflow(token, owner, branch, TARGET_REPO);
  await ensurePages(token, owner, branch, TARGET_REPO);
  _publishInfraVerified.add(key);
}
function invalidatePublishInfra(owner, branch) {
  _publishInfraVerified.delete(`${owner}/${branch}`);
}

// Publishes from this process are serialized. Two overlapping publishes (a comp
// and one of its builds, or two quick clicks) both read HEAD, build a commit on
// it, and race to move the ref — the loser's files vanish from the site.
let _publishQueue = Promise.resolve();
function enqueuePublish(fn) {
  const next = _publishQueue.then(() => fn());
  _publishQueue = next.catch(() => {});
  return next;
}

// Walk up the folder parentId chain to find the root folder with shared:true.
// Returns the shared folder object (with orgName) or null if the build is personal.
// Team root for a folder from an already-loaded folder list (walks parentId).
function _findTeamRoot(folderId, folders) {
  let current = folderId ? folders.find((f) => f.id === folderId) : null;
  while (current) {
    if (current.teamId) return current;
    if (!current.parentId) return null;
    current = folders.find((f) => f.id === current.parentId);
  }
  return null;
}

function getIconPath() {
  return path.join(__dirname, "../../public/favicon.png");
}

// E2E runs launch a fresh Electron process per spec file. Mapping and focusing a
// real window each time steals the desktop's focus dozens of times per suite, so
// AXIFORGE_HIDE_WINDOW=1 keeps the window unmapped. Playwright drives the page over
// CDP, which does not require the window to be visible.
const HIDE_WINDOW = process.env.AXIFORGE_HIDE_WINDOW === "1";

function createWindow(savedBounds) {
  const win = new BrowserWindow({
    width: savedBounds?.width ?? 1600,
    height: savedBounds?.height ?? 980,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 1120,
    minHeight: 740,
    show: false,
    frame: false,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden", trafficLightPosition: { x: -20, y: -20 } }
      : {}),
    backgroundColor: "#050910",
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });

  win.on("close", () => {
    store.setSetting("windowBounds", win.getBounds());
  });

  win.once("ready-to-show", () => {
    if (!HIDE_WINDOW) win.show();
  });

  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    // Strip any preload the renderer tries to attach — prevents privilege escalation
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    // Enforce sandbox isolation on the webview process
    webPreferences.sandbox = true;
    // Block any webview whose initial src is not the GW2 wiki
    if (!params.src.startsWith("https://wiki.guildwars2.com/")) {
      event.preventDefault();
    }
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    // E2E tests set APP_PROFILE="e2e-test" and run against the built renderer
    // (src/renderer uses bare module specifiers that require Vite to resolve).
    const useDistRenderer = app.isPackaged || (APP_PROFILE && APP_PROFILE.startsWith("e2e"));
    const rendererPath = useDistRenderer
      ? path.join(__dirname, "../../dist/renderer/index.html")
      : path.join(__dirname, "../renderer/index.html");
    win.loadFile(rendererPath);
  }

  return win;
}

async function getSession() {
  const auth = await store.getAuth();
  if (!auth.token) return null;
  try {
    const viewer = await getViewer(auth.token);
    return { token: auth.token, viewer };
  } catch (err) {
    if (err?.status === 401) {
      await store.clearAuth();
      return null;
    }
    // Network error or transient GitHub failure — keep the token,
    // fall back to the cached viewer so the session stays alive.
    if (auth.viewer) {
      return { token: auth.token, viewer: auth.viewer };
    }
    return null;
  }
}

async function getAuthRecord() {
  return store.getAuth();
}

async function patchAuthRecord(patch) {
  // updateAuth serializes the read-modify-write against every other auth writer
  // (team sync's 401 handler, the legacy migration, login).
  return store.updateAuth((current) => ({
    ...current,
    ...patch,
    onboarding: {
      ...(current.onboarding || {}),
      ...((patch && patch.onboarding) || {}),
    },
  }));
}

async function getOnboardingStatus() {
  const auth = await getAuthRecord();
  const session = await getSession();
  const onboarding = auth.onboarding || {};
  const pagesUrl = onboarding.pagesUrl || null;
  const reachable = pagesUrl ? await isPagesUrlReachable(pagesUrl) : false;
  const repoReady = Boolean(onboarding.repoReady || onboarding.forkReady);
  const pagesReady = Boolean(onboarding.pagesReady || reachable);
  const buildStatus = String(onboarding.pagesBuildStatus || "").toLowerCase();
  const pagesBuildStatus =
    pagesReady && (!buildStatus || buildStatus === "queued" || buildStatus === "deploying")
      ? "built"
      : onboarding.pagesBuildStatus || null;

  return {
    isAuthenticated: Boolean(session),
    viewer: session?.viewer || null,
    repoReady,
    forkReady: repoReady,
    pagesReady,
    pagesBuildStatus,
    pagesBuildUpdatedAt: onboarding.pagesBuildUpdatedAt || null,
    pagesBuildError: onboarding.pagesBuildError || null,
    siteReady: Boolean(reachable),
    pagesUrl,
    targetOwner: onboarding.targetOwner || null,
    repoName: onboarding.repoName || TARGET_REPO,
    branch: onboarding.branch || "main",
  };
}

async function migrateCompGameModes(buildStore, compStore) {
  const comps = await compStore.listComps();
  // Skip if all comps already have the gameMode field
  if (comps.every((c) => "gameMode" in c)) return;
  const builds = await buildStore.listBuilds();
  const buildMap = new Map(builds.map((b) => [b.id, b]));
  for (const comp of comps) {
    if ("gameMode" in comp) continue;
    let gameMode = null;
    if (comp.buildIds && comp.buildIds.length > 0) {
      const firstBuild = buildMap.get(comp.buildIds[0]);
      gameMode = firstBuild?.gameMode ?? null;
    }
    await compStore.upsertComp({ ...comp, gameMode });
  }
}

// Send an event to every open window. No-op when headless (zero windows).
function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, data);
  }
}

// IPC registry: handle() registers with ipcMain AND records the handler so the
// local API can call the exact same function via invokeLocal(). This keeps the
// HTTP endpoints thin wrappers over the existing handlers — history capture,
// team sync outbox, ownership guards, and publish flows are all reused.
const ipcRegistry = new Map();
function handle(channel, fn) {
  ipcRegistry.set(channel, fn);
  ipcMain.handle(channel, fn);
}
function invokeLocal(channel, ...args) {
  const fn = ipcRegistry.get(channel);
  if (!fn) return Promise.reject(new Error(`No handler registered for ${channel}`));
  // Handlers expect an event whose sender.send() emits progress/sync events;
  // for API-originated calls, fan those out to any open windows.
  const fakeEvent = { sender: { send: broadcast } };
  return Promise.resolve(fn(fakeEvent, ...args));
}

// Maps handler failures to HTTP statuses for API-originated calls:
// - decode/parse failures of user input → 400
// - "not found" errors → 404
// - handlers that resolve { success: false, error } → throw with the given message
function asHttpResult(promise, { badInput = false } = {}) {
  return Promise.resolve(promise).then((result) => {
    if (result && typeof result === "object" && result.success === false && result.error) {
      throw httpError(badInput ? 400 : 500, result.error);
    }
    return result;
  }, (err) => {
    const msg = err?.message || String(err);
    if (/^(Build|Comp|Folder|History entry) not found/i.test(msg)) throw httpError(404, msg);
    const ioCodes = ["ENOENT", "EACCES", "EPERM", "ENOSPC", "EMFILE"];
    if (badInput && !ioCodes.includes(err?.code)) throw httpError(400, msg);
    throw err;
  });
}

let localApi = null;
let mainWindow = null;
// Set once TeamSync is constructed during startup, so app-level lifecycle hooks
// (will-quit) can reach the instance that lives inside the ready handler.
let teamSyncRef = null;

// Sync events go to the focused-most window (the same target TeamSync itself
// uses for its own events).
function teamSyncEmit(channel, data) {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length) wins[0].webContents.send(channel, data);
}

// Outbox enqueues are best-effort: the local write already succeeded, so a
// failure to record the sync op must not turn a successful mutation into an IPC
// rejection (the renderer would roll back UI that is actually persisted). Report
// it as a sync error instead — the next full push/pull reconciles.
async function safeEnqueue(fn, ctx) {
  try {
    return await fn();
  } catch (err) {
    console.error("[team-sync] enqueue failed:", ctx, err.message);
    teamSyncEmit("sync-status", { status: "error", error: "outbox", ...ctx, message: err.message });
  }
}
// True once a windowed launch has been delegated to this (headless) instance via
// "second-instance" but before its window finishes opening. Guards against a
// headless quit (quitIfHeadless's deferred app.quit) racing the promotion and
// killing the process before the user's window appears.
let windowPending = false;
let axicodeHandlersRegistered = false;
let autoUpdateInitialized = false;
// Last validated window bounds, loaded during whenReady. Module-level so
// windows adopted later (activate / second-instance into a headless instance)
// restore the saved position too.
let lastSavedBounds = null;

// Creates (or focuses) the main window. Used by normal startup, the macOS
// "activate" handler, and "second-instance" when a windowed launch hits a
// running headless instance. Safe to call before whenReady resolves only via
// those electron events, which all fire after ready.
function openMainWindow(savedBounds = lastSavedBounds) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = createWindow(savedBounds);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  // Init once per process — re-running would re-register ipcMain.handle
  // ("updater:get-version" throws on duplicate registration) and duplicate
  // autoUpdater listeners. The getter late-binds so reopened windows still
  // receive updater events.
  if (!autoUpdateInitialized) {
    initAutoUpdate(() => mainWindow);
    autoUpdateInitialized = true;
  }
  if (!axicodeHandlersRegistered) {
    registerAxicodeFileHandlers(() => mainWindow);
    axicodeHandlersRegistered = true;
  }
  return mainWindow;
}

const readyWork = app.whenReady().then(async () => {
  if (!gotInstanceLock) return; // a second launch — the running instance handles it
  await store.init();
  await store.migrateCompIdToCompIds();
  await folderStore.init();
  await compStore.init();
  await syncStore.init();
  await buildHistoryStore.init();
  // Once-a-day snapshot of the user's library (kept 7 days) under data/backups/.
  // Cheap insurance on top of the per-write .bak generation in jsonFile.js.
  snapshotDaily(dataDir, ["builds.json", "comps.json", "folders.json", "settings.json"]).catch(() => {});
  await initDiskCache(dataDir);
  initWikiClient(dataDir);
  await migrateCompGameModes(store, compStore);

  // Team root for a folder (walks parentId). Null for personal folders.
  async function findTeamRoot(folderId) {
    if (!folderId) return null;
    return teamSync.teamRootFor(folderId, await folderStore.listFolders());
  }

  const teamSync = new TeamSync({
    buildStore: store, compStore, folderStore, syncStore,
    historyStore: buildHistoryStore,
    emit: teamSyncEmit,
  });
  teamSyncRef = teamSync;
  // Polling is meaningless without a team session (pullAll is a no-op then), and
  // teams:enable starts it as soon as the user opts in.
  if (await teamSync.getSession()) teamSync.startPolling();
  // Startup housekeeping: folders that already live in a team can't still be
  // GitHub-org shared folders. Non-destructive — nothing is deleted, only the
  // dead `orgName`/`lastSyncedAt` fields (and the stale auth blob) go away.
  teamSync.cleanupLegacyFolders().catch((err) => console.warn("[legacy-cleanup]", err.message));
  // Flush anything left in the outbox from a previous run, then pull.
  teamSync.pullAll().catch((err) => console.error("[startup-pull] error:", err.message));
  app.on("browser-window-focus", () => { teamSync.onFocus(); });

  // Restore last window position/size if valid
  const b = await store.getSetting("windowBounds");
  if (b && typeof b.x === "number" && typeof b.y === "number" &&
      typeof b.width === "number" && typeof b.height === "number") {
    const isOnScreen = screen.getAllDisplays().some(({ bounds }) =>
      b.x < bounds.x + bounds.width &&
      b.x + b.width > bounds.x &&
      b.y < bounds.y + bounds.height &&
      b.y + b.height > bounds.y
    );
    if (isOnScreen) lastSavedBounds = b;
  }

  if (!cliFlags.headless) {
    openMainWindow(lastSavedBounds);
  } else {
    console.log("[headless] started without a window — services and local API only");
  }

  // Pre-warm all profession catalogs in the background so class switching is instant.
  // Runs sequentially with a short delay between each to avoid hammering the GW2 API.
  // SKIPPED in headless: there's no UI to make snappy, and the pre-warm burst
  // competes with (and 429-throttles) the on-demand decodes the headless instance
  // was spawned to serve — making build-card decodes time out.
  if (!cliFlags.headless) {
    (async () => {
      const PROFESSION_IDS = ["Guardian","Warrior","Engineer","Ranger","Thief","Elementalist","Mesmer","Necromancer","Revenant"];
      // Small initial delay to let the window load first
      await new Promise((r) => setTimeout(r, 3000));
      for (const id of PROFESSION_IDS) {
        try {
          await getProfessionCatalog(id, "en");
        } catch {
          // Ignore errors — pre-warming is best-effort
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
  }

  handle("app:get-config", async () => {
    const auth = await getAuthRecord();
    return {
      pagesUrl: auth?.onboarding?.pagesUrl || "",
      repoName: auth?.onboarding?.repoName || TARGET_REPO,
    };
  });

  handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return true;
  });

  handle("window:toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  handle("window:is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false;
  });

  handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return true;
  });

  handle("app:open-external", (_event, url) => {
    // Only open http(s) links externally — never file:// or other schemes from the renderer.
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  handle("window:open-preview", (_event, url, opts = {}) => {
    const mobile = opts.mobile === true;
    const preview = new BrowserWindow({
      width: mobile ? 390 : 1600,
      height: mobile ? 844 : 980,
      minWidth: mobile ? 320 : 1120,
      minHeight: mobile ? 568 : 740,
      useContentSize: mobile,
      backgroundColor: "#050910",
      icon: getIconPath(),
      title: mobile ? "AxiForge — Mobile Preview" : "AxiForge — Local Preview",
    });
    preview.loadURL(url);
    return true;
  });

  handle("clipboard:write-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });
  handle("clipboard:read-text", () => {
    return clipboard.readText();
  });

  handle("auth:get-session", async () => getSession());

  handle("auth:begin-login", async () => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || "Ov23li30QPR3mAwgSUvv";
    return beginGitHubDeviceAuth(clientId);
  });

  handle("auth:complete-login", async (_e, beginData) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || "Ov23li30QPR3mAwgSUvv";
    const token = await completeGitHubDeviceAuth(
      clientId,
      beginData?.deviceCode,
      beginData?.interval,
      beginData?.expiresIn
    );
    const viewer = await getViewer(token);
    await store.updateAuth((previous) => ({
      ...previous,
      token,
      viewer,
      onboarding: previous.onboarding || {},
    }));
    return { viewer };
  });

  handle("auth:logout", async () => {
    await store.clearAuth();
    return true;
  });

  handle("builds:list", async () => store.listBuilds());
  handle("builds:save", async (_e, build) => {
    const existing = build.id ? (await store.listBuilds()).find((b) => b.id === build.id) : null;
    const oldFolderId = existing?.folderId ?? null;
    // Capture history before overwriting (non-blocking — never fails the save)
    if (existing) {
      const auth = await getAuthRecord().catch(() => null);
      buildHistoryStore.addEntry({
        buildId: existing.id,
        authorLogin: auth?.viewer?.login || "local",
        source: "local",
        summary: summarizeBuildChange(existing, build),
        snapshot: existing,
      }).catch((err) => console.warn("[history] addEntry failed:", err.message));
    }
    // Guard BEFORE the local write: a refusal after the upsert would leave the
    // build locally moved with nothing tombstoned in the source team.
    // upsertBuild PRESERVES the existing folder when the payload's folderId is
    // null/undefined (buildStore.js), so a partial save is NOT a move to personal.
    const { oldRoot, newRoot } = await assertCanMoveOutOfTeam({ teamSync, findTeamRoot }, {
      itemId: build.id, oldFolderId, newFolderId: build.folderId ?? oldFolderId, label: "build",
    });
    const saved = await store.upsertBuild(build);
    // Record creation for new builds so folder history panel shows the initial save.
    if (!existing) {
      const auth = await getAuthRecord().catch(() => null);
      buildHistoryStore.addEntry({
        buildId: saved.id,
        authorLogin: auth?.viewer?.login || "local",
        source: "local",
        summary: "Created",
        snapshot: saved,
      }).catch((err) => console.warn("[history] addEntry failed:", err.message));
    }
    if (saved.folderId) {
      await folderStore.touchFolders([saved.folderId]);
    }
    if (newRoot) await safeEnqueue(() => teamSync.enqueue(newRoot.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
    // Moved out of a team (or into a different one): tombstone it there.
    if (oldRoot && oldRoot.id !== newRoot?.id) {
      await safeEnqueue(() => teamSync.enqueue(oldRoot.teamId, saved.id, "build", "delete"), { type: "build", id: saved.id });
    }
    return saved;
  });
  handle("builds:delete", async (_e, id) => {
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === id);
    const folderId = build?.folderId;
    const teamRoot = folderId ? await findTeamRoot(folderId) : null;
    if (teamRoot && !(await teamSync.canDelete(teamRoot.teamId, id))) {
      throw new Error("Only the team owner or the build's creator can delete it from the team.");
    }
    await store.deleteBuild(id);
    await compStore.removeBuildFromComps(id);
    buildHistoryStore.deleteHistory(id).catch((err) => console.warn("[history] deleteHistory failed:", err.message));
    if (folderId) await folderStore.touchFolders([folderId]);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, id, "build", "delete"), { type: "build", id });
    return true;
  });

  // Build history
  handle("builds:get-history", async (_e, buildId) => {
    return buildHistoryStore.getHistory(buildId);
  });

  handle("folders:get-history", async (_e, folderId) => {
    const allFolders = await folderStore.listFolders();
    const allBuilds = await store.listBuilds();
    const allHistory = await buildHistoryStore.getAllHistory();

    // Collect this folder and all its descendants
    const folderIds = new Set();
    const queue = [folderId];
    while (queue.length > 0) {
      const id = queue.shift();
      folderIds.add(id);
      for (const f of allFolders) {
        if (f.parentId === id) queue.push(f.id);
      }
    }

    // Build a title lookup for builds in those folders
    const titleMap = {};
    for (const b of allBuilds) {
      if (folderIds.has(b.folderId)) titleMap[b.id] = b.title || b.id;
    }

    // Gather and annotate all history entries for those builds
    const entries = [];
    for (const [buildId, buildEntries] of Object.entries(allHistory)) {
      if (!titleMap[buildId]) continue;
      for (const entry of buildEntries) {
        entries.push({ ...entry, buildTitle: titleMap[buildId] });
      }
    }

    // Sort newest first
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return entries;
  });

  handle("builds:revert", async (_e, buildId, historyEntryId) => {
    const entries = await buildHistoryStore.getHistory(buildId);
    const entry = entries.find((e) => e.id === historyEntryId);
    if (!entry) throw new Error("History entry not found");

    // Capture the current state before reverting so the revert itself is undoable
    const currentBuilds = await store.listBuilds();
    const currentBuild = currentBuilds.find((b) => b.id === buildId);
    const auth = await getAuthRecord().catch(() => null);
    if (currentBuild) {
      buildHistoryStore.addEntry({
        buildId,
        authorLogin: auth?.viewer?.login || "local",
        source: "revert",
        summary: `reverted to ${new Date(entry.timestamp).toLocaleString()}`,
        snapshot: currentBuild,
      }).catch((err) => console.warn("[history] revert addEntry failed:", err.message));
    }

    const saved = await store.upsertBuild(entry.snapshot);
    if (saved.folderId) {
      await folderStore.touchFolders([saved.folderId]);
    }
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
    return saved;
  });

  // Folder CRUD
  handle("folders:list", () => folderStore.listFolders());
  handle("folders:save", async (_e, folder) => {
    const existing = folder.id ? (await folderStore.listFolders()).find((f) => f.id === folder.id) : null;
    // A team's root folder is owned by the team record: re-parenting it would
    // orphan the share, and a local rename is silently reverted by the next
    // _ensureRootFolder. Both go through teams:rename / Settings → Teams.
    if (existing?.teamId && (folder.parentId || folder.name !== existing.name)) {
      throw new Error("Rename or move the team from Settings → Teams.");
    }
    const oldParentId = existing?.parentId ?? null;
    const newParentId = folder.parentId ?? null;
    // Guards BEFORE the local write — see builds:save. The depth check covers
    // the whole subtree (upsertFolder only checks the moved folder itself): a
    // too-deep tree pushed into a team can never be applied by teammates.
    if (existing && newParentId !== oldParentId) {
      assertFolderTreeFits({ folders: await folderStore.listFolders(), folderId: folder.id, newParentId });
    }
    const { oldRoot, newRoot } = await assertCanMoveOutOfTeam({ teamSync, findTeamRoot }, {
      itemId: folder.id, oldFolderId: oldParentId, newFolderId: newParentId, label: "folder",
    });
    const saved = await folderStore.upsertFolder(folder);
    if (newRoot && newRoot.id !== oldRoot?.id) {
      // Entering a team: the whole subtree is new to that team, not just this folder.
      await safeEnqueue(() => teamSync.enqueueFolderTree(newRoot.teamId, saved.id, "put"), { type: "folder", id: saved.id });
    } else if (newRoot) {
      await safeEnqueue(() => teamSync.enqueue(newRoot.teamId, saved.id, "folder", "put"), { type: "folder", id: saved.id });
    }
    if (oldRoot && oldRoot.id !== newRoot?.id) {
      // Leaving a team: one folder tombstone; the server cascades to descendants.
      await safeEnqueue(() => teamSync.enqueueFolderTree(oldRoot.teamId, saved.id, "delete"), { type: "folder", id: saved.id });
    }
    return saved;
  });
  handle("folders:delete", async (_e, id) => {
    const allFolders = await folderStore.listFolders();
    const target = allFolders.find((f) => f.id === id);
    if (target?.teamId) throw new Error("Leave or delete the team from Settings → Teams instead.");
    const teamRoot = target?.parentId ? _findTeamRoot(target.parentId, allFolders) : null;
    if (teamRoot && !(await teamSync.canDelete(teamRoot.teamId, id))) {
      throw new Error("Only the team owner or the folder's creator can delete it from the team.");
    }
    const deletedIds = await folderStore.deleteFolder(id);
    if (deletedIds.length) await store.clearFolderFromBuilds(deletedIds);
    // One tombstone for the folder; the server cascades to descendants.
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, id, "folder", "delete"), { type: "folder", id });
    return deletedIds;
  });
  handle("folders:reorder", async (_e, updates) => {
    await folderStore.reorderFolders(updates);
    const folders = await folderStore.listFolders();
    for (const { id } of updates) {
      const f = folders.find((x) => x.id === id);
      const teamRoot = f?.parentId ? _findTeamRoot(f.parentId, folders) : null;
      if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, id, "folder", "put"), { type: "folder", id });
    }
  });

  // Build library operations
  handle("builds:move", async (_e, ids, folderId) => {
    if (folderId !== null) {
      const exists = await folderStore.folderExists(folderId);
      if (!exists) throw new Error(`Folder not found: ${folderId}`);
    }
    // Collect source folders before move
    const builds = await store.listBuilds();
    const sourceFolderIds = [...new Set(
      builds.filter((b) => ids.includes(b.id) && b.folderId).map((b) => b.folderId)
    )];

    const destRoot = await findTeamRoot(folderId);
    for (const srcId of sourceFolderIds) {
      if (srcId === folderId) continue;
      const srcRoot = await findTeamRoot(srcId);
      if (srcRoot && srcRoot.id !== destRoot?.id) {
        for (const id of ids) {
          if (!(await teamSync.canDelete(srcRoot.teamId, id))) {
            throw new Error("Only the team owner or the build's creator can move it out of the team.");
          }
        }
      }
    }

    await store.moveBuilds(ids, folderId);

    if (destRoot) {
      for (const id of ids) await safeEnqueue(() => teamSync.enqueue(destRoot.teamId, id, "build", "put"), { type: "build", id });
    }
    for (const srcId of sourceFolderIds) {
      if (srcId === folderId) continue;
      const srcRoot = await findTeamRoot(srcId);
      if (srcRoot && srcRoot.id !== destRoot?.id) {
        for (const id of ids) await safeEnqueue(() => teamSync.enqueue(srcRoot.teamId, id, "build", "delete"), { type: "build", id });
      }
    }

    // Touch source and destination folders
    const touchIds = [...sourceFolderIds];
    if (folderId) touchIds.push(folderId);
    if (touchIds.length) await folderStore.touchFolders([...new Set(touchIds)]);
    return true;
  });
  handle("builds:pin", (_e, ids, pinned) =>
    store.pinBuilds(ids, pinned),
  );
  handle("builds:reorder", (_e, updates) =>
    store.reorderBuilds(updates),
  );

  // Comp CRUD
  handle("comps:list", () => compStore.listComps());
  handle("comps:save", async (_e, comp) => {
    const existing = comp.id ? (await compStore.listComps()).find((c) => c.id === comp.id) : null;
    const oldFolderId = existing?.folderId ?? null;
    // Guard BEFORE the local write — see builds:save.
    const { oldRoot, newRoot } = await assertCanMoveOutOfTeam({ teamSync, findTeamRoot }, {
      itemId: comp.id, oldFolderId, newFolderId: comp.folderId ?? null, label: "comp",
    });
    const saved = await compStore.upsertComp(comp);
    if (newRoot) await safeEnqueue(() => teamSync.enqueue(newRoot.teamId, saved.id, "comp", "put"), { type: "comp", id: saved.id });
    if (oldRoot && oldRoot.id !== newRoot?.id) {
      await safeEnqueue(() => teamSync.enqueue(oldRoot.teamId, saved.id, "comp", "delete"), { type: "comp", id: saved.id });
    }
    return saved;
  });
  handle("comps:delete", async (_e, id) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === id);
    const folderId = comp?.folderId;
    const teamRoot = folderId ? await findTeamRoot(folderId) : null;
    if (teamRoot && !(await teamSync.canDelete(teamRoot.teamId, id))) {
      throw new Error("Only the team owner or the comp's creator can delete it from the team.");
    }
    await compStore.deleteComp(id);
    await store.clearCompFromBuilds([id]);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, id, "comp", "delete"), { type: "comp", id });
  });
  handle("comps:reorder", (_e, updates) => compStore.reorderComps(updates));
  handle("comps:delete-batch", async (_e, ids) => {
    const comps = await compStore.listComps();
    const folders = await folderStore.listFolders();
    const teamOps = [];
    for (const id of ids) {
      const comp = comps.find((c) => c.id === id);
      const teamRoot = comp?.folderId ? _findTeamRoot(comp.folderId, folders) : null;
      if (!teamRoot) continue;
      if (!(await teamSync.canDelete(teamRoot.teamId, id))) {
        throw new Error(`Only the team owner or the comp's creator can delete "${comp.name}" from the team.`);
      }
      teamOps.push([teamRoot.teamId, id]);
    }
    await compStore.deleteComps(ids);
    if (ids.length) await store.clearCompFromBuilds(ids);
    for (const [teamId, id] of teamOps) await safeEnqueue(() => teamSync.enqueue(teamId, id, "comp", "delete"), { type: "comp", id });
  });
  // Tag edits are a real mutation of the comp record, so team comps must be
  // pushed too — otherwise teammates never see the new tags.
  async function enqueueCompPuts(ids) {
    const comps = await compStore.listComps();
    const folders = await folderStore.listFolders();
    for (const id of ids) {
      const comp = comps.find((c) => c.id === id);
      const teamRoot = comp?.folderId ? _findTeamRoot(comp.folderId, folders) : null;
      if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, id, "comp", "put"), { type: "comp", id });
    }
  }
  handle("comps:add-tags", async (_e, ids, tags) => {
    const res = await compStore.addTagsToComps(ids, tags);
    await enqueueCompPuts(ids);
    return res;
  });
  handle("comps:remove-tags", async (_e, ids, tags) => {
    const res = await compStore.removeTagsFromComps(ids, tags);
    await enqueueCompPuts(ids);
    return res;
  });

  handle("comps:get-published-url", async (_e, compId) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === compId);
    if (!comp?.publishedFileId) return null;
    const auth = await getAuthRecord();
    const owner = publishedOwnerFor(comp, auth?.onboarding?.targetOwner);
    if (!owner) throw new Error("GitHub publishing not configured.");
    const repo = auth?.onboarding?.repoName || TARGET_REPO;
    const slug = comp.publishedSlug || "";
    const theme = await store.getSetting("appearance.theme");
    return `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(slug)}&c=${comp.publishedFileId}.${comp.publishedKey}${theme ? `&t=${theme}` : ""}`;
  });

  handle("builds:generate-chat-link", async (_e, build) => {
    const { generateChatLink } = require("./buildChatLink.js");
    return generateChatLink(build);
  });
  handle("builds:prewarm-chat-links", async (_e, builds) => {
    const { prewarmChatLinks } = require("./buildChatLink.js");
    prewarmChatLinks(builds); // fire-and-forget
  });
  handle("builds:preview-chat-link", async (_e, link) => {
    const { previewChatLink } = require("./buildChatLink.js");
    return previewChatLink(link);
  });
  handle("builds:import-chat-link", async (_e, link, name, folderId, gameMode) => {
    const { decodeChatLinkToBuild } = require("./buildChatLink.js");
    const build = await decodeChatLinkToBuild(link, name, folderId, gameMode);
    const saved = await store.upsertBuild(build);
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
    return saved;
  });
  handle("builds:import-gw2skills", async (_e, url, name, folderId, gameMode) => {
    const { importGw2SkillsBuild } = require("./gw2skillsImport.js");
    const build = await importGw2SkillsBuild(url, name, folderId, gameMode);
    const saved = await store.upsertBuild(build);
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
    return saved;
  });
  handle("builds:parse-gw2skills", async (_e, url, gameMode) => {
    const { parseGw2Skills } = require("./gw2skillsImport.js");
    return parseGw2Skills(url, { gameMode });
  });
  handle("builds:parse-chat-link", async (_e, link, gameMode) => {
    const { decodeChatLinkToBuild } = require("./buildChatLink.js");
    // Decode only — no store.upsertBuild, so meta builds never pollute the library.
    // Timed + logged: AxiVale renders build cards through this, and a slow/hung
    // decode shows up to the user as "AxiForge timed out" — so surface it here.
    const t0 = Date.now();
    try {
      const build = await decodeChatLinkToBuild(link, null, null, gameMode);
      console.log(`[parse-chat-link] decoded in ${Date.now() - t0}ms (gameMode=${gameMode ?? "default"})`);
      return build;
    } catch (err) {
      console.error(`[parse-chat-link] FAILED after ${Date.now() - t0}ms:`, err?.message || err);
      throw err;
    }
  });
  handle("builds:encode-share-code", async (_e, build) => {
    const { encodeShareCode } = require("@axiapps/code");
    return encodeShareCode(build);
  });
  handle("builds:decode-share-code", async (_e, code) => {
    const { decodeShareCode } = require("@axiapps/code");
    return decodeShareCode(code);
  });
  handle("builds:is-share-code", async (_e, text) => {
    const { isValidShareCode } = require("@axiapps/code");
    return isValidShareCode(text);
  });

  handle("comps:encode-share-code", async (_e, compId) => {
    const { encodeComp } = require("./compCodec.js");
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === compId);
    if (!comp) throw new Error("Comp not found");
    const allBuilds = await store.listBuilds();
    const buildsMap = {};
    for (const b of allBuilds) buildsMap[b.id] = b;
    const code = encodeComp(comp, buildsMap);
    if (!code) throw new Error("Failed to encode comp share code");
    return code;
  });

  handle("comps:import-share-code", async (_e, code) => {
    const { decodeComp, isValidCompCode } = require("./compCodec.js");
    if (!isValidCompCode(code)) throw new Error("Invalid comp share code format");
    const decoded = decodeComp(code);
    if (!decoded) throw new Error("Failed to decode comp share code");

    // Create the comp first (without builds) so we have an ID for compId wiring
    const comp = await compStore.upsertComp({
      name: decoded.name,
      gameMode: decoded.gameMode,
      buildIds: [],
      partyLines: [],
    });

    // Create new builds for each unique decoded build, wiring compIds immediately
    const newBuildIds = [];
    const buildRefToId = new Map();
    for (const build of decoded.builds) {
      const saved = await store.upsertBuild({
        ...build,
        title: build.title || "Imported Build",
        compIds: [comp.id],
      });
      newBuildIds.push(saved.id);
      buildRefToId.set(build, saved.id);
    }

    // Remap decoded build refs → new build IDs for both party-line slots and categories.
    // Tag slots arrive as { __tagCategoryId } markers and become "tag:<categoryId>" tokens.
    const { remapImportedComp } = require("./compCodec.js");
    const { partyLines, categories } = remapImportedComp(decoded, buildRefToId);

    // Update the comp with buildIds, partyLines, and categories
    const updated = await compStore.upsertComp({
      ...comp,
      buildIds: newBuildIds,
      partyLines,
      categories,
    });

    // Return comp ID + warning count for UI feedback
    const result = { compId: updated.id };
    if (decoded.failedBuildCount > 0) {
      result.warning = `${decoded.failedBuildCount} of ${decoded.failedBuildCount + decoded.builds.length} builds could not be decoded — they may require a newer version of AxiForge.`;
    }
    return result;
  });

  handle("builds:publish-build", (event, buildId, opts) => enqueuePublish(() => publishBuildImpl(event, buildId, opts || {})));
  async function publishBuildImpl(event, buildId, opts = {}) {
    const sender = event.sender;
    const progress = (step) => sender.send("publish-progress", { id: buildId, step });

    const session = await getSession();
    if (!session) {
      throw new Error("You must log in with GitHub before publishing.");
    }

    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    const personalOwner = auth?.onboarding?.targetOwner || session.viewer.login;

    // Load the build
    progress("loading");
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === buildId);
    if (!build) throw new Error("Build not found.");

    const owner = personalOwner;
    const ownerType = "user";
    if (build.publishedOwner && build.publishedOwner !== owner && !opts.force) {
      throw new Error(`PUBLISHED_BY_OTHER:${build.publishedOwner}`);
    }
    const teamRoot = await findTeamRoot(build.folderId);

    // Auto-populate build name if empty or default
    if (!build.title?.trim() || build.title === "Untitled Build") {
      const defaultName = getDefaultBuildName(build.specializations, build.profession);
      build.title = defaultName;
      const renamed = await store.upsertBuild(build);
      // Keep the snapshot's updatedAt in step with what was just written, so the
      // publishedAt stamped at the end matches and the build reads as fresh.
      build.updatedAt = renamed.updatedAt;
    }

    // Validate
    if (!build.title) throw new Error("Build name is required for publishing.");
    if (!build.profession) throw new Error("Build must have a profession selected.");

    // Generate or reuse publish metadata
    const fileId = build.publishedFileId || generateFileId();
    const encKey = build.publishedKey || generateEncryptionKey();
    const newSlug = slugifyBuildName(build.title);

    // Ensure repo and site infrastructure exist (cached after the first success)
    progress("repo");
    await ensurePublishInfra(session.token, owner, ownerType, branch);

    // Build combined bundle: SPA files + encrypted build in one commit.
    // publishSiteBundle compares SHA hashes and skips unchanged files,
    // so SPA files are effectively a no-op after the first publish.
    progress("site");
    const spaBundle = buildSpaBundle();

    // Enrich build data for the SPA
    progress("encrypt");
    let enrichedBuild;
    try {
      const [catalog, upgradeCatalog] = await Promise.all([
        getProfessionCatalog(build.profession, "en"),
        getUpgradeCatalog("en"),
      ]);
      const extraCatalogs = await loadCrossProfessionCatalogs(build.notes, build.profession, getProfessionCatalog);
      enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog, extraCatalogs);
    } catch (err) {
      throw new Error(
        `Failed to enrich build data: ${err?.message || err}. ` +
        "Check your internet connection and try again."
      );
    }
    // Pre-compute GW2 chat link so the SPA can display it without API calls
    try {
      const { generateChatLink } = require("./buildChatLink.js");
      enrichedBuild.chatLink = await generateChatLink(build);
    } catch {
      // Chat link unavailable — SPA will hide the build code widget
    }
    const encFile = buildEncryptedBuildFile(enrichedBuild, fileId, encKey);

    // Merge SPA bundle + encrypted build + redirect into a single commit
    const redirectFile = buildRedirectFile(fileId, encKey, "b");
    const combinedBundle = { ...spaBundle, [encFile.filePath]: encFile.content, [redirectFile.filePath]: redirectFile.content };

    // Re-encrypt any published comps that contain this build so their
    // embedded build data stays in sync (notes, traits, equipment, etc.)
    const allComps = await compStore.listComps();
    const affectedComps = allComps.filter(
      (c) => c.publishedFileId && (c.buildIds || []).includes(buildId)
    );
    if (affectedComps.length) {
      const allBuilds = await store.listBuilds();
      const themedBuildsOn = await store.getSetting("appearance.themedBuildPages");
      const compTheme = await store.getSetting("appearance.theme");

      for (const comp of affectedComps) {
        const compBuildIds = new Set(getCompPublishBuildIds(comp));
        const compBuilds = allBuilds.filter((b) => compBuildIds.has(b.id));
        const buildsMap = {};

        for (const cb of compBuilds) {
          let enriched;
          if (cb.id === buildId) {
            // Reuse the enriched build we already computed above
            enriched = { ...enrichedBuild };
          } else {
            try {
              const [cat, upCat] = await Promise.all([
                getProfessionCatalog(cb.profession, "en"),
                getUpgradeCatalog("en"),
              ]);
              const cbExtras = await loadCrossProfessionCatalogs(cb.notes, cb.profession, getProfessionCatalog);
              enriched = serializeForPublish(cb, cat, upCat, cbExtras);
            } catch {
              continue; // Skip builds that fail to enrich — don't block the publish
            }
            try {
              const { generateChatLink } = require("./buildChatLink.js");
              enriched.chatLink = await generateChatLink(cb);
            } catch { /* */ }
          }

          const cbFileId = cb.publishedFileId || generateFileId();
          const cbEncKey = cb.publishedKey || generateEncryptionKey();
          const cbSlug = slugifyBuildName(cb.title);
          const buildTheme = themedBuildsOn && cb.profession && PROFESSION_THEME_IDS[cb.profession]
            ? PROFESSION_THEME_IDS[cb.profession]
            : compTheme;
          const cbSpaUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(cbSlug)}&b=${cbFileId}.${cbEncKey}${buildTheme ? `&t=${buildTheme}` : ""}`;
          buildsMap[cb.id] = { ...enriched, spaUrl: cbSpaUrl };
        }

        const compPayload = serializeCompForPublish(comp, buildsMap);
        if (comp.boonCoverageHtml) compPayload.boonCoverageHtml = comp.boonCoverageHtml;
        const compEncFile = buildEncryptedCompFile(compPayload, comp.publishedFileId, comp.publishedKey);
        combinedBundle[compEncFile.filePath] = compEncFile.content;
      }
    }

    progress("upload");
    let publishResult;
    try {
      publishResult = await publishSiteBundle(session.token, owner, combinedBundle, branch, TARGET_REPO);
    } catch (err) {
      if (err?.status === 404) invalidatePublishInfra(owner, branch);
      throw err;
    }
    if (publishResult.shellChanged) {
      progress("deploy");
      await triggerPagesWorkflow(session.token, owner, branch, TARGET_REPO).catch(() => null);
    }

    // Confirm the encrypted build is actually reachable before we mark the
    // build as published. The SPA reads it from raw.githubusercontent.com, which
    // reflects the commit within seconds. Only after it's live do we stamp
    // publishedAt — so "published" always means "the shared link works".
    progress("pages");
    const rawBuildUrl = `https://raw.githubusercontent.com/${owner}/${TARGET_REPO}/${branch}/site/builds/${fileId}.enc`;
    const live = await pollUrlLive(rawBuildUrl);
    if (!live) {
      throw new Error("Published, but the link did not go live in time. Try again in a minute.");
    }

    // On a shell-changed publish (first ever, or the SPA app itself updated) the
    // site shell is served by the Pages workflow, not raw — wait for it too so the
    // shared page itself (not just the build data) is live before we mark published.
    if (publishResult.shellChanged) {
      const shellLive = await pollUrlLive(`https://${owner}.github.io/${TARGET_REPO}/`, { timeoutMs: 180000 });
      if (!shellLive) {
        throw new Error("Published, but the site did not go live in time. Try again in a minute.");
      }
    }

    // Record publish metadata and push to shared repo so teammates receive the
    // published URL without needing to publish themselves. markPublished patches
    // only the publish fields — it must NOT re-upsert the `build` snapshot, which
    // would clobber any save the user made while the upload was in flight. If
    // such a save happened, publishedAt (= snapshot updatedAt) != updatedAt and
    // the build correctly shows as needing a re-publish.
    const savedBuild = (await store.markPublished(buildId, {
      publishedSlug: newSlug,
      publishedFileId: fileId,
      publishedKey: encKey,
      publishedOwner: owner,
      snapshotUpdatedAt: build.updatedAt,
    })) || build;
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, savedBuild.id, "build", "put"), { type: "build", id: savedBuild.id });

    const themedBuilds = await store.getSetting("appearance.themedBuildPages");
    const themeParam = themedBuilds && build.profession && PROFESSION_THEME_IDS[build.profession]
      ? PROFESSION_THEME_IDS[build.profession]
      : await store.getSetting("appearance.theme");
    const pagesUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(newSlug)}&b=${fileId}.${encKey}${themeParam ? `&t=${themeParam}` : ""}`;

    await patchAuthRecord({
      onboarding: {
        repoReady: true,
        forkReady: true,
        repoName: TARGET_REPO,
        pagesReady: false,
        pagesBuildStatus: "queued",
        pagesBuildUpdatedAt: new Date().toISOString(),
        pagesBuildError: null,
        pagesUrl: `https://${owner}.github.io/${TARGET_REPO}/`,
        branch,
        targetOwner: owner,
      },
    });

    return {
      pagesUrl,
      slug: newSlug,
      fileId,
      changed: true,
    };
  }

  handle("comps:publish-comp", (event, compId, boonCoverageHtml, opts) => enqueuePublish(() => publishCompImpl(event, compId, boonCoverageHtml, opts || {})));
  async function publishCompImpl(event, compId, boonCoverageHtml, opts = {}) {
    const sender = event.sender;
    const progress = (step) => sender.send("publish-progress", { id: compId, step });

    const session = await getSession();
    if (!session) throw new Error("You must log in with GitHub before publishing.");

    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    const personalOwner = auth?.onboarding?.targetOwner || session.viewer.login;

    // ── 1. Load comp + its builds ──────────────────────────────────────
    const compTheme = await store.getSetting("appearance.theme");
    const themedBuildsOn = await store.getSetting("appearance.themedBuildPages");
    progress("loading");
    const allComps = await compStore.listComps();
    const comp = allComps.find((c) => c.id === compId);
    if (!comp) throw new Error("Comp not found.");

    if (!comp.name?.trim() || comp.name === "Untitled Comp") {
      throw new Error("Comp name is required for publishing.");
    }

    const owner = personalOwner;
    const ownerType = "user";
    if (comp.publishedOwner && comp.publishedOwner !== owner && !opts.force) {
      throw new Error(`PUBLISHED_BY_OTHER:${comp.publishedOwner}`);
    }
    const compTeamRoot = await findTeamRoot(comp.folderId);

    const allBuilds = await store.listBuilds();
    // Use union of buildIds + all party line slot IDs so a build that ended up
    // in a slot without being in buildIds (data divergence) is still published.
    const buildIdSet = new Set(getCompPublishBuildIds(comp));
    const compBuilds = allBuilds.filter((b) => buildIdSet.has(b.id));

    // ── 2. Ensure repo infrastructure (cached after first success) ─────
    progress("repo");
    await ensurePublishInfra(session.token, owner, ownerType, branch);

    // ── 3. Build SPA bundle ────────────────────────────────────────────
    progress("site");
    const spaBundle = buildSpaBundle();

    // ── 4. Publish unpublished builds, enrich all builds ──────────────
    const buildsMap = {};
    const updatedBuildRecords = [];
    // Builds already published by a teammate: linked, never re-uploaded (see
    // decideCompBuildPublish). Surfaced so the UI can explain the split.
    const skippedForeignBuilds = [];
    const unpublishedBuilds = compBuilds.filter((b) => !b.publishedFileId);

    for (let i = 0; i < compBuilds.length; i++) {
      const build = compBuilds[i];

      if (!build.publishedFileId) {
        const unpubIdx = unpublishedBuilds.indexOf(build);
        progress(`builds:${unpubIdx + 1}:${unpublishedBuilds.length}:${build.title || build.profession || "Build"}`);
      }

      // Enrich build — required for the SPA to display skills and traits
      let enrichedBuild;
      try {
        const [catalog, upgradeCatalog] = await Promise.all([
          getProfessionCatalog(build.profession, "en"),
          getUpgradeCatalog("en"),
        ]);
        const extraCatalogs = await loadCrossProfessionCatalogs(build.notes, build.profession, getProfessionCatalog);
        enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog, extraCatalogs);
      } catch (err) {
        throw new Error(
          `Failed to enrich build "${build.title || build.profession}": ${err?.message || err}. ` +
          "Check your internet connection and try again."
        );
      }
      // Pre-compute GW2 chat link so the SPA can display it without API calls
      try {
        const { generateChatLink } = require("./buildChatLink.js");
        enrichedBuild.chatLink = await generateChatLink(build);
      } catch {
        // Chat link unavailable — SPA will hide the build code widget
      }

      const slug = slugifyBuildName(build.title);
      const buildTheme = themedBuildsOn && build.profession && PROFESSION_THEME_IDS[build.profession]
        ? PROFESSION_THEME_IDS[build.profession]
        : compTheme;
      const { foreignOwner, needsRecord } = decideCompBuildPublish({ build, owner, force: opts.force, slug });

      if (foreignOwner) {
        // Keep the existing URL stable: link to the other user's published copy
        // rather than re-uploading the bytes under our owner (which would leave
        // publishedOwner pointing at a copy we no longer maintain).
        const fSlug = build.publishedSlug || slug;
        buildsMap[build.id] = {
          ...enrichedBuild,
          spaUrl: `https://${foreignOwner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(fSlug)}&b=${build.publishedFileId}.${build.publishedKey}${buildTheme ? `&t=${buildTheme}` : ""}`,
        };
        skippedForeignBuilds.push({ id: build.id, title: build.title || build.profession || "Build", owner: foreignOwner });
        continue;
      }

      const fileId = build.publishedFileId || generateFileId();
      const encKey = build.publishedKey || generateEncryptionKey();
      const spaUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(slug)}&b=${fileId}.${encKey}${buildTheme ? `&t=${buildTheme}` : ""}`;

      // Always re-encrypt with latest enriched data (traits may have been fixed)
      const encFile = buildEncryptedBuildFile(enrichedBuild, fileId, encKey);
      spaBundle[encFile.filePath] = encFile.content;

      if (needsRecord) {
        updatedBuildRecords.push({ id: build.id, publishedFileId: fileId, publishedKey: encKey, publishedSlug: slug, publishedOwner: owner, snapshotUpdatedAt: build.updatedAt });
      }

      // Always add redirect file (idempotent — overwrites if already exists)
      const redir = buildRedirectFile(fileId, encKey, "b");
      spaBundle[redir.filePath] = redir.content;

      buildsMap[build.id] = { ...enrichedBuild, spaUrl };
    }

    // ── 5. Serialize + encrypt comp ────────────────────────────────────
    progress("encrypt");
    const compFileId = comp.publishedFileId || generateFileId();
    const compEncKey = comp.publishedKey || generateEncryptionKey();
    const compSlug = slugifyBuildName(comp.name);

    const compPayload = serializeCompForPublish(comp, buildsMap);
    if (boonCoverageHtml) compPayload.boonCoverageHtml = boonCoverageHtml;
    const compEncFile = buildEncryptedCompFile(compPayload, compFileId, compEncKey);
    spaBundle[compEncFile.filePath] = compEncFile.content;
    const compRedir = buildRedirectFile(compFileId, compEncKey, "c");
    spaBundle[compRedir.filePath] = compRedir.content;

    // ── 6. Upload everything in one commit ────────────────────────────
    progress("upload");
    let compPublishResult;
    try {
      compPublishResult = await publishSiteBundle(session.token, owner, spaBundle, branch, TARGET_REPO);
    } catch (err) {
      if (err?.status === 404) invalidatePublishInfra(owner, branch);
      throw err;
    }

    // ── 7. Trigger Pages rebuild ───────────────────────────────────────
    if (compPublishResult.shellChanged) {
      progress("deploy");
      await triggerPagesWorkflow(session.token, owner, branch, TARGET_REPO).catch(() => null);
    }

    // ── 8. Persist metadata (builds first, then comp) ─────────────────
    // Push each newly-published build to the shared repo so teammates get the
    // published URL without needing to publish themselves.
    for (const { id, ...patch } of updatedBuildRecords) {
      const savedBuild = await store.markPublished(id, patch);
      if (savedBuild && compTeamRoot) {
        await safeEnqueue(() => teamSync.enqueue(compTeamRoot.teamId, savedBuild.id, "build", "put"), { type: "build", id: savedBuild.id });
      }
    }

    const savedTheme = await store.getSetting("appearance.theme");
    const compPagesUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(compSlug)}&c=${compFileId}.${compEncKey}${savedTheme ? `&t=${savedTheme}` : ""}`;

    // Patch publish fields only — never re-upsert the pre-publish snapshot
    // (see builds:publish-build for why).
    const savedComp = (await compStore.markPublished(compId, {
      publishedFileId: compFileId,
      publishedKey: compEncKey,
      publishedSlug: compSlug,
      publishedOwner: owner,
      boonCoverageHtml: boonCoverageHtml || comp.boonCoverageHtml || "",
      snapshotUpdatedAt: comp.updatedAt,
    })) || comp;

    // Push comp publish metadata to shared repo so teammates get the URL.
    // Skip personal auth record update for shared comps — the org's repo is the
    // canonical publish target, not the user's personal publishing setup.
    if (compTeamRoot) await safeEnqueue(() => teamSync.enqueue(compTeamRoot.teamId, savedComp.id, "comp", "put"), { type: "comp", id: savedComp.id });
    await patchAuthRecord({
      onboarding: {
        repoReady: true,
        forkReady: true,
        repoName: TARGET_REPO,
        pagesReady: false,
        pagesBuildStatus: "queued",
        pagesBuildUpdatedAt: new Date().toISOString(),
        pagesBuildError: null,
        pagesUrl: `https://${owner}.github.io/${TARGET_REPO}/`,
        branch,
        targetOwner: owner,
      },
    });

    return { pagesUrl: compPagesUrl, slug: compSlug, fileId: compFileId, changed: true, skippedForeignBuilds };
  }

  handle("gw2:list-professions", async () => getProfessionList("en"));
  handle("gw2:get-profession-catalog", async (_e, professionId, gameMode) =>
    getProfessionCatalog(professionId, "en", gameMode)
  );
  handle("gw2:get-upgrade-catalog", async () => getUpgradeCatalog("en"));
  handle("gw2:clear-cache", async () => { clearCatalogCache(); return clearDiskCache(); });
  handle("wiki:get-summary", async (_e, title) => getWikiSummary(title));
  handle("wiki:get-related-data", async (_e, title) => getWikiRelatedData(title));
  handle("wiki:resolve-entity-facts", async (_e, entityNames) => {
    const { getWikiClient } = require("./gw2Data/catalog");
    const { resolveEntityFacts } = require("../../packages/gw2-data/src/wiki/resolver");
    const client = getWikiClient();

    const titleToId = new Map(entityNames.map((n) => [n.name, n.id]));
    const result = await resolveEntityFacts(client, titleToId);

    // Convert Map to plain object for IPC serialization
    const serialized = {};
    for (const [id, facts] of result) {
      serialized[id] = facts;
    }
    return serialized;
  });
  handle("settings:get", async (_e, key) => store.getSetting(key));
  handle("settings:set", async (_e, key, value) => store.setSetting(key, value));

  handle("app:get-whats-new", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const {
      extractReleaseNotesRangeFromFile,
      fetchGithubReleaseNotesRange,
    } = require("./versionUtils");

    const version = app.getVersion();
    let lastSeenVersion = (await store.getSetting("lastSeenVersion")) || null;

    // Dev fake-update tester: simulate having last seen the release
    // immediately before the current one, so the modal shows only the
    // latest section's delta — exactly what a real returning user sees
    // after a single version bump.
    if (process.env.AXIFORGE_FAKE_UPDATE) {
      const fs = require("node:fs");
      const path = require("node:path");
      const { parseVersion, compareVersion } = require("./versionUtils");
      try {
        const raw = fs.readFileSync(path.join(process.cwd(), "RELEASE_NOTES.md"), "utf8");
        const versions = [...raw.matchAll(/^##\s*Version\s+v?([0-9]+\.[0-9]+\.[0-9]+)/gm)]
          .map((m) => m[1])
          .map((v) => ({ str: v, parsed: parseVersion(v) }))
          .filter((v) => v.parsed)
          .sort((a, b) => compareVersion(b.parsed, a.parsed));
        // Pick a synthetic lastSeenVersion a few releases back so the
        // tester exercises the multi-version delta path. Override with
        // AXIFORGE_FAKE_LAST_SEEN to pin a specific version (e.g. "0.6.15"),
        // or set AXIFORGE_FAKE_GAP=N to control how many releases back.
        const current = parseVersion(version);
        const older = versions.filter((v) => current && compareVersion(v.parsed, current) < 0);
        if (process.env.AXIFORGE_FAKE_LAST_SEEN) {
          lastSeenVersion = process.env.AXIFORGE_FAKE_LAST_SEEN;
        } else {
          const gap = Math.max(1, Number(process.env.AXIFORGE_FAKE_GAP) || 3);
          const target = older[Math.min(gap - 1, older.length - 1)];
          lastSeenVersion = target ? target.str : null;
        }
      } catch { /* fall through to real lastSeenVersion */ }
    }

    let releaseNotes = await fetchGithubReleaseNotesRange(version, lastSeenVersion);
    if (!releaseNotes) {
      const basePath = app.isPackaged ? app.getAppPath() : process.cwd();
      const notesPath = path.join(basePath, "RELEASE_NOTES.md");
      try {
        const rawNotes = fs.readFileSync(notesPath, "utf8");
        releaseNotes = extractReleaseNotesRangeFromFile(rawNotes, version, lastSeenVersion);
        if (!releaseNotes) {
          // Fall back to the most-recent section so manual "What's New" never comes up empty
          const sections = rawNotes.split(/\n(?=##\s*Version\s+v)/);
          releaseNotes = (sections[0] || "").trim() || null;
        }
      } catch (err) {
        console.warn("[Main] Failed to read RELEASE_NOTES.md:", err?.message || err);
      }
    }

    return { version, lastSeenVersion, releaseNotes };
  });

  handle("app:set-last-seen-version", async (_e, version) => {
    if (process.env.AXIFORGE_FAKE_UPDATE) return;
    await store.setSetting("lastSeenVersion", version);
  });

  handle("discord:share-comp", async (_e, compId, webhookIds) => {
    const { shareCompToDiscord } = require("./discordWebhook");
    const { getCompWebhooks, shareCompToWebhooks } = require("./compWebhooks");

    // 1. Load configured comp webhooks (migrates legacy single webhook if needed)
    const webhooks = await getCompWebhooks(store);
    if (!webhooks.length) {
      return { success: false, error: "Discord webhook URL is not configured or invalid" };
    }

    // 2. Load and validate comp
    const allComps = await compStore.listComps();
    const comp = allComps.find((c) => c.id === compId);
    if (!comp) return { success: false, error: "Comp not found" };
    if (!comp.publishedSlug) return { success: false, error: "Comp must be published before sharing" };
    const compReject = shareRejectionReason(comp, "Comp");
    if (compReject) return { success: false, error: compReject };

    // 3. Resolve owner for URL construction (matches existing publish pattern)
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    if (!owner) return { success: false, error: "GitHub publishing not configured" };
    const repo = auth?.onboarding?.repoName || TARGET_REPO;

    // 4. Build comp URL — use GitHub Pages short redirect
    const compUrl = shortUrl(publishedOwnerFor(comp, owner), repo, comp.publishedFileId);

    // 5. Load builds and construct maps — use short URLs
    const allBuilds = await store.listBuilds();
    const buildsMap = {};
    const buildUrls = {};
    for (const build of allBuilds) {
      buildsMap[build.id] = build;
      if (build.publishedFileId) {
        buildUrls[build.id] = shortUrl(publishedOwnerFor(build, owner), repo, build.publishedFileId);
      }
    }

    // 6. Post to each selected webhook (or all when webhookIds is empty/omitted)
    return shareCompToWebhooks(webhooks, webhookIds, (w) =>
      shareCompToDiscord(comp, buildsMap, compUrl, buildUrls, w.url, {
        threadMode: w.threadMode || "none",
        threadId: w.threadMode === "custom" ? w.threadId : null,
      })
    );
  });

  handle("discord:list-comp-webhooks", async () => {
    const { getCompWebhooks } = require("./compWebhooks");
    const webhooks = await getCompWebhooks(store);
    return webhooks.map((w) => ({ id: w.id, name: w.name }));
  });

  handle("discord:share-build", async (_e, buildId, webhookIds) => {
    const { shareBuildToDiscord } = require("./discordWebhook");
    const { getBuildWebhooks, shareBuildToWebhooks } = require("./buildWebhooks");
    const { generateChatLink } = require("./buildChatLink.js");

    // 1. Load configured build webhooks (migrates the legacy single webhook if needed)
    const webhooks = await getBuildWebhooks(store);
    if (!webhooks.length) {
      return { success: false, error: "Build webhook URL is not configured or invalid" };
    }

    // 2. Load and validate build
    const allBuilds = await store.listBuilds();
    const build = allBuilds.find((b) => b.id === buildId);
    if (!build) return { success: false, error: "Build not found" };
    const buildReject = shareRejectionReason(build, "Build");
    if (buildReject) return { success: false, error: buildReject };

    // 3. Resolve owner for URL construction
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    if (!owner) return { success: false, error: "GitHub publishing not configured" };
    const repo = auth?.onboarding?.repoName || TARGET_REPO;

    // 4. Build URL
    const buildUrl = shortUrl(publishedOwnerFor(build, owner), repo, build.publishedFileId);

    // 5. Generate chat link
    let chatLink = null;
    try { chatLink = await generateChatLink(build); } catch (err) { try { console.error("discord:share-build — chat link generation failed:", err); } catch (_) {} }

    // 6. Get class icon URL (gw2-class-icons: elite spec > profession), spec icon, and elite spec name
    const CLASS_ICON_BASE = "https://raw.githubusercontent.com/darkharasho/gw2-class-icons/main/wiki/150px";
    const { getEliteSpecName } = require("./discordEmoji");
    const eliteSpecName = getEliteSpecName(build);
    const classIconName = eliteSpecName || build.profession;
    const professionIconUrl = classIconName ? `${CLASS_ICON_BASE}/${encodeURIComponent(classIconName)}.png` : null;

    let specIconUrl = null;
    let catalog = null;
    let upgradeCatalog = null;
    try {
      [catalog, upgradeCatalog] = await Promise.all([
        getProfessionCatalog(build.profession, "en", build.gameMode || "pve"),
        getUpgradeCatalog("en"),
      ]);
      if (eliteSpecName) {
        const specData = catalog.specializations?.find((s) => s.name === eliteSpecName);
        specIconUrl = specData?.icon || null;
      }
      if (!specIconUrl) {
        specIconUrl = catalog.profession?.icon || null;
      }
    } catch { /* optional */ }

    // 7. Estimate role
    const { estimateRole } = require("./statsCompute");
    const role = estimateRole(build);

    // 8. Post to each selected webhook (or all when webhookIds is empty/omitted)
    return shareBuildToWebhooks(webhooks, webhookIds, (w) =>
      shareBuildToDiscord(build, buildUrl, chatLink, {
        professionIconUrl,
        specIconUrl,
        eliteSpecName,
        gameMode: build.gameMode || "pve",
        role,
        catalog,
        upgradeCatalog,
      }, w.url, {
        threadMode: w.threadMode || "none",
        threadId: w.threadMode === "custom" ? w.threadId : null,
      })
    );
  });

  handle("discord:list-build-webhooks", async () => {
    const { getBuildWebhooks } = require("./buildWebhooks");
    const webhooks = await getBuildWebhooks(store);
    return webhooks.map((w) => ({ id: w.id, name: w.name }));
  });

  handle("discord:build-copy-text", async (_e, buildId) => {
    const { formatBuildDiscordCopy } = require("./discordWebhook");

    const allBuilds = await store.listBuilds();
    const build = allBuilds.find((b) => b.id === buildId);
    if (!build) throw new Error("Build not found");

    let buildUrl = null;
    if (build.publishedFileId) {
      const auth = await getAuthRecord();
      const session = await getSession();
      const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
      if (owner) {
        const repo = auth?.onboarding?.repoName || TARGET_REPO;
        buildUrl = shortUrl(publishedOwnerFor(build, owner), repo, build.publishedFileId);
      }
    }

    return formatBuildDiscordCopy(build, buildUrl);
  });

  handle("comps:generate-plaintext", async (_e, compId) => {
    const { getDisplayName, getDiscordEmoji, tagEmojiMention } = require("./discordEmoji");

    const allComps = await compStore.listComps();
    const comp = allComps.find((c) => c.id === compId);
    if (!comp) throw new Error("Comp not found");

    // Resolve owner/repo for short URLs
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    const repo = auth?.onboarding?.repoName || TARGET_REPO;
    const hasUrls = !!owner;

    const allBuilds = await store.listBuilds();
    const buildsMap = {};
    const buildUrls = {};
    if (hasUrls) {
      for (const b of allBuilds) {
        buildsMap[b.id] = b;
        if (b.publishedFileId) buildUrls[b.id] = shortUrl(publishedOwnerFor(b, owner), repo, b.publishedFileId);
      }
    } else {
      for (const b of allBuilds) buildsMap[b.id] = b;
    }

    // Comp grid: one row of emojis per party line, broken at 5 with party numbers
    const PARTY_EMOJIS = [
      "1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3",
      "4\uFE0F\u20E3", "5\uFE0F\u20E3", "6\uFE0F\u20E3",
      "7\uFE0F\u20E3", "8\uFE0F\u20E3", "9\uFE0F\u20E3",
      "\uD83D\uDD1F",
    ];
    const buildColors = comp.buildColors || {};

    // A slot can be a category reference ("tag:<id>") instead of a build. Render it as
    // the category's custom Discord emoji so it shows up on signups exactly like the
    // built-in role icons. Derive the <:name:id> mention from the stored emoji CDN URL.
    const TAG_PREFIX = "tag:";
    const categoryById = new Map((comp.categories || []).map((c) => [c.id, c]));
    const mentionForCategory = (category) => tagEmojiMention(category?.icon, category?.name);

    const gridRows = [];
    const placed = new Set();
    (comp.partyLines || []).forEach((line, idx) => {
      const emojis = [];
      (line.slots || []).forEach((slotId) => {
        if (slotId) placed.add(slotId);
        if (typeof slotId === "string" && slotId.startsWith(TAG_PREFIX)) {
          const cat = categoryById.get(slotId.slice(TAG_PREFIX.length));
          const mention = cat ? mentionForCategory(cat) : null;
          if (mention) emojis.push(mention);
          return;
        }
        const build = buildsMap[slotId];
        if (!build) return;
        const emoji = getDiscordEmoji(build, buildColors[slotId] || "normal");
        if (emoji) emojis.push(emoji);
      });
      if (emojis.length > 0) {
        const label = PARTY_EMOJIS[idx] || `P${idx + 1}`;
        if (emojis.length <= 5) {
          gridRows.push(`${label} ${emojis.join(" ")}`);
        } else {
          for (let i = 0; i < emojis.length; i += 5) {
            const chunk = emojis.slice(i, i + 5).join(" ");
            gridRows.push(i === 0 ? `${label} ${chunk}` : `\u2B1B ${chunk}`);
          }
        }
      }
    });

    // Builds in the comp but not placed in any line \u2014 still show them.
    const extraBuildIds = (comp.buildIds || []).filter(
      (id) => id && !placed.has(id) && buildsMap[id]
    );
    const extraEmojis = [];
    for (const id of extraBuildIds) {
      const emoji = getDiscordEmoji(buildsMap[id], buildColors[id] || "normal");
      if (emoji) extraEmojis.push(emoji);
    }
    for (let i = 0; i < extraEmojis.length; i += 5) {
      gridRows.push(`\u2795 ${extraEmojis.slice(i, i + 5).join(" ")}`);
    }

    // Builds legend: one line per unique build with emoji + linked name
    const seen = new Set();
    const legendLines = [];
    for (const line of comp.partyLines || []) {
      for (const slotId of line.slots || []) {
        if (seen.has(slotId)) continue;
        seen.add(slotId);
        if (typeof slotId === "string" && slotId.startsWith(TAG_PREFIX)) {
          const cat = categoryById.get(slotId.slice(TAG_PREFIX.length));
          if (!cat) continue;
          const mention = mentionForCategory(cat);
          legendLines.push(`${mention ? mention + " " : ""}${cat.name} _(tag)_`);
          continue;
        }
        const build = buildsMap[slotId];
        if (!build) continue;
        const emoji = getDiscordEmoji(build, buildColors[slotId] || "normal");
        const name = getDisplayName(build);
        const url = buildUrls[slotId];
        const nameStr = url ? `[${name}](${url})` : name;
        legendLines.push(emoji ? `${emoji} ${nameStr}` : nameStr);
      }
    }
    // Append unplaced builds to the legend so they're listed too
    for (const id of extraBuildIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const build = buildsMap[id];
      const emoji = getDiscordEmoji(build, buildColors[id] || "normal");
      const name = getDisplayName(build);
      const url = buildUrls[id];
      const nameStr = url ? `[${name}](${url})` : name;
      legendLines.push(emoji ? `${emoji} ${nameStr}` : nameStr);
    }

    const compName = comp.name || "Untitled Comp";
    const compUrl = hasUrls && comp.publishedFileId
      ? shortUrl(publishedOwnerFor(comp, owner), repo, comp.publishedFileId)
      : null;
    const title = compUrl ? `**[${compName}](${compUrl})**` : `**${compName}**`;
    const out = [title];
    out.push("");
    out.push("**Comp**");
    out.push(gridRows.join("\n") || "(empty)");
    out.push("");
    out.push("**Builds**");
    out.push(legendLines.join("\n") || "(none)");
    return out.join("\n");
  });

  handle("onboarding:status", async () => getOnboardingStatus());
  handle("onboarding:list-targets", async () => {
    const session = await getSession();
    if (!session) return [];
    return listTargets(session.token, session.viewer.login);
  });

  async function setupRepoPages(targetOwner, ownerType = "user") {
    const session = await getSession();
    if (!session) {
      throw new Error("Authenticate with GitHub before continuing setup.");
    }

    const owner = targetOwner || session.viewer.login;
    try {
      await ensureAxiForgeRepo(session.token, owner, ownerType);
      const repo = await getRepo(session.token, owner, TARGET_REPO);
      const defaultBranch = repo.default_branch || "main";
      await ensurePagesWorkflow(session.token, owner, defaultBranch, TARGET_REPO);
      await ensurePages(session.token, owner, defaultBranch, TARGET_REPO);

      const emptySite = buildSpaBundle();
      const publish = await publishSiteBundle(
        session.token,
        owner,
        emptySite,
        defaultBranch,
        TARGET_REPO
      );
      if (!publish.changed) {
        await triggerPagesWorkflow(session.token, owner, defaultBranch, TARGET_REPO);
      }

      await patchAuthRecord({
        onboarding: {
          repoReady: true,
          forkReady: true,
          repoName: TARGET_REPO,
          pagesReady: false,
          pagesBuildStatus: "queued",
          pagesBuildUpdatedAt: null,
          pagesBuildError: null,
          pagesUrl: `https://${owner}.github.io/${TARGET_REPO}/`,
          branch: defaultBranch,
          targetOwner: owner,
        },
      });
    } catch (err) {
      const apiTail = buildGithubApiDebugTail(err);
      if (err?.status === 404) {
        const orgHint =
          ownerType === "org"
            ? " If this is an org, approve the OAuth app for the org and ensure you can create repos there."
            : "";
        throw new Error(
          `Could not access ${owner}/${TARGET_REPO}.${orgHint} Check token scopes and owner permissions.${apiTail}`
        );
      }
      if (err?.status === 403) {
        throw new Error(
          `Permission denied for ${owner}/${TARGET_REPO}. Ensure the OAuth app is approved for that owner and your account can create repos and manage Pages.${apiTail}`
        );
      }
      throw err;
    }

    return getOnboardingStatus();
  }

  handle("onboarding:setup-repo-pages", async (_e, targetOwner, ownerType = "user") =>
    setupRepoPages(targetOwner, ownerType)
  );

  handle("onboarding:setup-fork-pages", async (_e, targetOwner, ownerType = "user") =>
    setupRepoPages(targetOwner, ownerType)
  );

  handle("onboarding:poll-pages-status", async () => {
    const session = await getSession();
    if (!session) {
      throw new Error("Authenticate with GitHub before checking Pages status.");
    }
    const auth = await getAuthRecord();
    const onboarding = auth?.onboarding || {};
    const owner = onboarding.targetOwner || session.viewer.login;
    const build = await getPagesBuildStatus(session.token, owner, TARGET_REPO);

    await patchAuthRecord({
      onboarding: {
        pagesBuildStatus: build.status,
        pagesBuildUpdatedAt: build.updatedAt,
        pagesBuildError: build.error,
        pagesReady: Boolean(build.ready),
        pagesUrl: build.htmlUrl || onboarding.pagesUrl || `https://${owner}.github.io/${TARGET_REPO}/`,
      },
    });

    return {
      status: build.status,
      ready: build.ready,
      pagesUrl: build.htmlUrl || onboarding.pagesUrl || `https://${owner}.github.io/${TARGET_REPO}/`,
      updatedAt: build.updatedAt,
      error: build.error,
    };
  });

  handle("dialog:error", async (_e, title, body) => {
    await dialog.showMessageBox({
      type: "error",
      title: title || "Error",
      message: body || "Unknown error",
    });
    return true;
  });

  // ─── Teams (team sync) ─────────────────────────────────────────────────────
  // Only the identity fields — never the 90-day bearer token. The main process
  // attaches it itself (syncApi.js); handing it to the renderer would turn any
  // future script injection into a durable, off-machine credential for every
  // team the user belongs to.
  handle("teams:get-session", async () => {
    const s = await teamSync.getSession();
    return s ? { userId: s.userId, login: s.login } : null;
  });
  handle("teams:enable", async () => {
    const session = await getSession();
    if (!session) throw new Error("Log in with GitHub first.");
    const user = await teamSync.enableWithGithub(session.token);
    teamSync.startPolling();
    teamSync.pullAll().catch(() => {});
    return user;
  });
  handle("teams:disable", () => teamSync.disable());
  handle("teams:list", () => teamSync.listTeams());
  handle("teams:create", (_e, name) => teamSync.createTeam(name));
  handle("teams:join", (_e, code) => teamSync.joinTeam(code));
  handle("teams:leave", (_e, teamId) => teamSync.leaveTeam(teamId));
  handle("teams:delete", (_e, teamId) => teamSync.deleteTeam(teamId));
  handle("teams:rename", (_e, teamId, name) => teamSync.renameTeam(teamId, name));
  handle("teams:members", (_e, teamId) => teamSync.listMembers(teamId));
  handle("teams:remove-member", (_e, teamId, userId) => teamSync.removeMember(teamId, userId));
  handle("teams:rotate-invite", (_e, teamId) => teamSync.rotateInvite(teamId));
  // A destroyed/reloading WebContents makes send() throw; that throw would
  // propagate out of the upload and be read as an upload failure (which, for the
  // migration, deletes a team whose items all landed).
  const progressTo = (sender, extra) => (p) => {
    try {
      if (sender && !sender.isDestroyed?.()) sender.send("team-share-progress", { ...extra, ...p });
    } catch { /* renderer went away mid-upload — never fail the upload for it */ }
  };
  handle("teams:share-folder", (_e, folderId, teamId) =>
    teamSync.shareFolderToTeam(folderId, teamId, progressTo(_e.sender, { folderId })));
  handle("teams:stop-sharing", async (_e, folderId) => {
    const root = await findTeamRoot(folderId);
    if (root?.role !== "owner") throw new Error("Only the team owner can stop sharing a folder.");
    return teamSync.stopSharing(folderId);
  });
  handle("teams:legacy-status", () => teamSync.legacyStatus());
  handle("teams:migrate-org-library", (_e, opts) =>
    teamSync.migrateOrgLibrary(opts || {}, progressTo(_e.sender, { migration: true })));
  handle("teams:pull", (_e, teamId) => teamSync.pullTeam(teamId));
  handle("teams:pull-all", () => teamSync.pullAll());
  handle("teams:resolve-conflict", (_e, teamId, itemId, choice) => teamSync.resolveConflict(teamId, itemId, choice));
  handle("teams:outbox", async () => {
    const out = {};
    for (const teamId of await syncStore.listTeamIds()) out[teamId] = await syncStore.listOutbox(teamId);
    return out;
  });

  // ─── Local API (consumed by AxiVale and other local Axi apps) ─────────────
  const apiToken = generateToken();
  localApi = createLocalApi({
    token: apiToken,
    version: app.getVersion(),
    ops: {
      // Quit only if still windowless (never promoted to a real window via a
      // second-instance/AxiOM launch). Defer the quit so the 200 flushes first,
      // and re-check at fire time: a windowed launch may have been delegated to
      // this instance in the interim (window already open, or windowPending set
      // synchronously by "second-instance"). Quitting then would silently drop
      // the user's launch — the intermittent "AppImage won't open" symptom.
      quitIfHeadless: () => {
        const promoted = BrowserWindow.getAllWindows().length > 0 || windowPending;
        if (!promoted) {
          setTimeout(() => {
            if (BrowserWindow.getAllWindows().length === 0 && !windowPending) app.quit();
          }, 50);
        }
        return { quitting: !promoted };
      },
      listBuilds: () => invokeLocal("builds:list"),
      saveBuild: (build) => asHttpResult(invokeLocal("builds:save", build)),
      deleteBuild: (id) => asHttpResult(invokeLocal("builds:delete", id)),
      publishBuild: (id) => asHttpResult(invokeLocal("builds:publish-build", id)),
      shareBuildToDiscord: (id, webhookIds) =>
        asHttpResult(invokeLocal("discord:share-build", id, webhookIds), { badInput: true }),
      listDiscordWebhooks: async () => ({
        comp: await invokeLocal("discord:list-comp-webhooks"),
        build: await invokeLocal("discord:list-build-webhooks"),
      }),
      generateChatLink: (build) =>
        asHttpResult(invokeLocal("builds:generate-chat-link", build)),
      listComps: () => invokeLocal("comps:list"),
      saveComp: (comp) => asHttpResult(invokeLocal("comps:save", comp)),
      deleteComp: (id) => asHttpResult(invokeLocal("comps:delete", id)),
      publishComp: (id, boonCoverageHtml) =>
        asHttpResult(invokeLocal("comps:publish-comp", id, boonCoverageHtml)),
      shareCompToDiscord: (id, webhookIds) =>
        asHttpResult(invokeLocal("discord:share-comp", id, webhookIds), { badInput: true }),
      compPlaintext: (id) => asHttpResult(invokeLocal("comps:generate-plaintext", id)),
      importChatLink: (link, name, folderId, gameMode) =>
        asHttpResult(invokeLocal("builds:import-chat-link", link, name, folderId, gameMode), { badInput: true }),
      importGw2Skills: (url, name, folderId, gameMode) =>
        asHttpResult(invokeLocal("builds:import-gw2skills", url, name, folderId, gameMode), { badInput: true }),
      parseGw2Skills: (url, gameMode) =>
        asHttpResult(invokeLocal("builds:parse-gw2skills", url, gameMode), { badInput: true }),
      parseChatLink: (link, gameMode) =>
        asHttpResult(invokeLocal("builds:parse-chat-link", link, gameMode), { badInput: true }),
      listProfessions: () => getProfessionList("en"),
      getProfessionCatalog: (id, gameMode) => getProfessionCatalog(id, "en", gameMode),
      getUpgradeCatalog: () => getUpgradeCatalog("en"),
      listFolders: () => folderStore.listFolders(),
    },
  });
  try {
    const { port } = await localApi.start();
    await writeDiscoveryFile(dataDir, {
      port,
      token: apiToken,
      exePath: app.getPath("exe"),
      version: app.getVersion(),
      pid: process.pid,
    });
    console.log(`[local-api] listening on 127.0.0.1:${port}`);
  } catch (err) {
    // The app must stay fully usable without the API (e.g. port exhaustion).
    console.error("[local-api] failed to start:", err?.message || err);
  }

  // axiom install-detection convention: write the current version to
  // <userData>/axiom-version so axiom (and AxiVale's launcher) can detect the
  // installed app on Linux. AxiForge did not previously write this file.
  try {
    require("node:fs").writeFileSync(
      path.join(app.getPath("userData"), "axiom-version"),
      app.getVersion(),
      "utf8",
    );
  } catch (err) {
    console.warn("[axiom-version] write failed:", err?.message || err);
  }
});

app.on("will-quit", () => {
  // A second launch that lost the single-instance lock must never clean up
  // state owned by the running instance.
  if (!gotInstanceLock) return;
  // Invalidate discovery on clean shutdown so clients never talk to a dead
  // port. Stale files from crashes are handled by clients via /health checks
  // and are overwritten on the next startup. The ownerPid guard ensures we
  // only remove a file this process wrote.
  removeDiscoveryFileSync(dataDir, { ownerPid: process.pid });
  if (localApi) localApi.stop().catch(() => {});
  // Stop the team-sync poll timer so a pending tick can't fire mid-teardown.
  if (teamSyncRef) teamSyncRef.stopPolling();
});

app.on("window-all-closed", () => {
  // A headless-launched instance keeps services + the local API running when
  // the user closes a window that was opened into it later.
  if (cliFlags.headless) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  // Wait for startup init so an adopted window never opens against a
  // half-initialized process.
  readyWork.then(() => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  }).catch((err) => console.error("[startup] adoption failed:", err));
});

async function isPagesUrlReachable(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

function buildGithubApiDebugTail(err) {
  if (!err) return "";
  const parts = [];
  if (err?.data?.message) parts.push(`GitHub said: ${err.data.message}.`);
  if (err?.path) parts.push(`Endpoint: ${err.path}.`);
  if (err?.oauthScopes) parts.push(`Token scopes: ${err.oauthScopes}.`);
  if (err?.acceptedOauthScopes) parts.push(`Endpoint accepts: ${err.acceptedOauthScopes}.`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}
