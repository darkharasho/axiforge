const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

// Ignore EPIPE errors on stdout/stderr — AppImage launches may close the
// parent pipe, and writing to it would crash the main process.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.("error", (err) => { if (err.code !== "EPIPE") throw err; });
}
const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeTheme, nativeImage, screen } = require("electron");

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
const { SharedLibrary } = require("./sharedLibrary");
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
} = require("./githubApi");
const { getProfessionList, getProfessionCatalog, getUpgradeCatalog, getWikiSummary, getWikiRelatedData, initDiskCache, clearDiskCache, initWikiClient, clearCatalogCache } = require("./gw2Data");
const { slugifyBuildName, generateFileId, generateEncryptionKey, getDefaultBuildName } = require("./buildEncryption");
const { buildSpaBundle, buildEncryptedBuildFile, buildEncryptedCompFile, buildRedirectFile } = require("./siteBundle");
const { serializeForPublish } = require("./buildPublish");
const { serializeCompForPublish, getCompPublishBuildIds } = require("./compPublish");
const { initAutoUpdate } = require("./autoUpdate");
const { registerAxicodeFileHandlers } = require("./axicodeFile");

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

const dataDir = path.join(app.getPath("userData"), "data");
const store = new BuildStore(dataDir);
const folderStore = new FolderStore(dataDir);
const compStore = new CompStore(dataDir);
const syncStore = new SyncStore(dataDir);
const buildHistoryStore = new BuildHistoryStore(dataDir);

// Walk up the folder parentId chain to find the root folder with shared:true.
// Returns the shared folder object (with orgName) or null if the build is personal.
function _findRootSharedFolder(folderId, folders) {
  if (!folderId) return null;
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return null;
  if (folder.shared) return folder;
  return _findRootSharedFolder(folder.parentId, folders);
}

// On Windows, the taskbar follows the "system" theme (SystemUsesLightTheme)
// while nativeTheme.shouldUseDarkColors follows the "app" theme. These can
// differ when the user picks "Custom" under Personalisation → Colors.
function isWindowsTaskbarDark() {
  try {
    const out = require("child_process").execSync(
      'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v SystemUsesLightTheme',
      { encoding: "utf8", windowsHide: true, timeout: 2000 },
    );
    const match = out.match(/SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
    return match ? parseInt(match[1], 16) === 0 : nativeTheme.shouldUseDarkColors;
  } catch {
    return nativeTheme.shouldUseDarkColors;
  }
}

function getIconPath() {
  let variant;
  if (process.platform === "linux") {
    variant = "White";
  } else if (process.platform === "win32") {
    variant = isWindowsTaskbarDark() ? "White" : "Black";
  } else {
    variant = nativeTheme.shouldUseDarkColors ? "White" : "Black";
  }
  return path.join(__dirname, `../../public/img/AxiForge-${variant}.png`);
}

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
    win.show();
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
  const current = await getAuthRecord();
  const next = {
    ...current,
    ...patch,
    onboarding: {
      ...(current.onboarding || {}),
      ...((patch && patch.onboarding) || {}),
    },
  };
  await store.saveAuth(next);
  return next;
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

app.whenReady().then(async () => {
  await store.init();
  await store.migrateCompIdToCompIds();
  await folderStore.init();
  await compStore.init();
  await syncStore.init();
  await buildHistoryStore.init();
  await initDiskCache(dataDir);
  initWikiClient(dataDir);
  await migrateCompGameModes(store, compStore);

  // Walk up parentId chain to find the closest ancestor with shared:true
  async function findRootSharedFolder(folderId) {
    if (!folderId) return null;
    const folders = await folderStore.listFolders();
    function walk(id) {
      const f = folders.find((x) => x.id === id);
      if (!f) return null;
      if (f.shared) return f;
      if (f.parentId) return walk(f.parentId);
      return null;
    }
    return walk(folderId);
  }

  const sharedLibrary = new SharedLibrary({
    buildStore: store, compStore, folderStore, syncStore,
    historyStore: buildHistoryStore,
    emit: (channel, data) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length) wins[0].webContents.send(channel, data);
    },
  });
  sharedLibrary.startPolling();

  // Pull immediately on startup so already-connected users see fresh data
  // without waiting for the first 60-second poll tick.
  sharedLibrary.pullAll().catch((err) => {
    console.error("[startup-pull] error:", err.message);
  });

  // Pull on window focus so changes from other users arrive as soon as the
  // user switches back to the app, rather than waiting for the next poll tick.
  // Cooldown of 10s prevents rapid alt-tab churning from stacking API calls.
  let _lastFocusPullAt = 0;
  app.on("browser-window-focus", () => {
    const now = Date.now();
    if (now - _lastFocusPullAt < 10_000) return;
    _lastFocusPullAt = now;
    sharedLibrary.pullAll().catch((err) => {
      console.error("[focus-pull] error:", err.message);
    });
  });

  // Restore last window position/size if valid
  let savedBounds;
  const b = await store.getSetting("windowBounds");
  if (b && typeof b.x === "number" && typeof b.y === "number" &&
      typeof b.width === "number" && typeof b.height === "number") {
    const isOnScreen = screen.getAllDisplays().some(({ bounds }) =>
      b.x < bounds.x + bounds.width &&
      b.x + b.width > bounds.x &&
      b.y < bounds.y + bounds.height &&
      b.y + b.height > bounds.y
    );
    if (isOnScreen) savedBounds = b;
  }

  const win = createWindow(savedBounds);
  initAutoUpdate(win);

  // Update window icon when system theme changes (light ↔ dark)
  nativeTheme.on("updated", () => {
    const icon = nativeImage.createFromPath(getIconPath());
    win?.setIcon(icon);
  });

  // Pre-warm all profession catalogs in the background so class switching is instant.
  // Runs sequentially with a short delay between each to avoid hammering the GW2 API.
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

  ipcMain.handle("app:get-config", async () => {
    const auth = await getAuthRecord();
    return {
      pagesUrl: auth?.onboarding?.pagesUrl || "",
      repoName: auth?.onboarding?.repoName || TARGET_REPO,
    };
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return true;
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false;
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return true;
  });

  ipcMain.handle("window:open-preview", (_event, url, opts = {}) => {
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

  ipcMain.handle("clipboard:write-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });
  ipcMain.handle("clipboard:read-text", () => {
    return clipboard.readText();
  });

  ipcMain.handle("auth:get-session", async () => getSession());

  ipcMain.handle("auth:begin-login", async () => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || "Ov23li30QPR3mAwgSUvv";
    return beginGitHubDeviceAuth(clientId);
  });

  ipcMain.handle("auth:complete-login", async (_e, beginData) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || "Ov23li30QPR3mAwgSUvv";
    const token = await completeGitHubDeviceAuth(
      clientId,
      beginData?.deviceCode,
      beginData?.interval,
      beginData?.expiresIn
    );
    const viewer = await getViewer(token);
    const previous = await getAuthRecord();
    await store.saveAuth({
      ...previous,
      token,
      viewer,
      onboarding: previous.onboarding || {},
    });
    return { viewer };
  });

  ipcMain.handle("auth:logout", async () => {
    await store.clearAuth();
    return true;
  });

  ipcMain.handle("builds:list", async () => store.listBuilds());
  ipcMain.handle("builds:save", async (_e, build) => {
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
    const saved = await store.upsertBuild(build);
    if (saved.folderId) {
      await folderStore.touchFolders([saved.folderId]);
    }
    const rootShared = await findRootSharedFolder(saved.folderId);
    if (rootShared) {
      _e.sender.send("sync-status", { status: "syncing", folderId: rootShared.id });
      _e.sender.send("sync-status", { status: "syncing", type: "build", id: saved.id, folderId: rootShared.id });
      sharedLibrary.schedulePush("build", saved);
    }
    // If moved out of a shared folder (or into a different one), enforce ownership then delete remote
    if (oldFolderId && oldFolderId !== saved.folderId) {
      const oldRootShared = await findRootSharedFolder(oldFolderId);
      if (oldRootShared && oldRootShared.id !== rootShared?.id) {
        const auth = await getAuthRecord();
        if (!auth?.sharedLibrary?.isOwner) {
          throw new Error("Only org owners can move items out of shared folders.");
        }
        sharedLibrary.deleteBuildRemote(oldFolderId, saved.id).catch((err) => {
          console.error("Failed to delete remote build after move:", err.message);
        });
      }
    }
    return saved;
  });
  ipcMain.handle("builds:delete", async (_e, id) => {
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === id);
    const folderId = build?.folderId;
    // Block non-owners from deleting builds in a shared folder — the handler
    // used to propagate to the shared repo with no isOwner check, so a member
    // deleting locally wiped the build from GitHub, and the admin's next sync
    // saw "remote missing → delete locally," destroying the admin's copy too.
    // Mirrors the move-out-of-shared check in builds:move.
    const rootShared = folderId ? await findRootSharedFolder(folderId) : null;
    if (rootShared) {
      const auth = await getAuthRecord();
      if (!auth?.sharedLibrary?.isOwner) {
        throw new Error("Only org owners can delete from shared folders.");
      }
    }
    await store.deleteBuild(id);
    await compStore.removeBuildFromComps(id);
    buildHistoryStore.deleteHistory(id).catch((err) => console.warn("[history] deleteHistory failed:", err.message));
    if (folderId) {
      await folderStore.touchFolders([folderId]);
      if (rootShared) {
        sharedLibrary.deleteBuildRemote(folderId, id).catch((err) => {
          console.error("Shared library remote delete failed:", err.message);
        });
      }
    }
    return true;
  });

  // Build history
  ipcMain.handle("builds:get-history", async (_e, buildId) => {
    return buildHistoryStore.getHistory(buildId);
  });

  ipcMain.handle("folders:get-history", async (_e, folderId) => {
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

  ipcMain.handle("builds:revert", async (_e, buildId, historyEntryId) => {
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
    const rootShared = await findRootSharedFolder(saved.folderId);
    if (rootShared) {
      sharedLibrary.schedulePush("build", saved);
    }
    return saved;
  });

  // Folder CRUD
  ipcMain.handle("folders:list", () => folderStore.listFolders());
  ipcMain.handle("folders:save", async (_e, folder) => {
    const saved = await folderStore.upsertFolder(folder);
    // If this folder lives inside a shared folder, sync the folder structure
    if (saved.parentId) {
      const rootShared = await findRootSharedFolder(saved.parentId);
      if (rootShared) {
        _e.sender.send("sync-status", { status: "syncing", folderId: rootShared.id });
        sharedLibrary.schedulePushFolderMeta(rootShared.id);
      }
    }
    return saved;
  });
  ipcMain.handle("folders:delete", async (_e, id) => {
    // Capture parent before deletion to determine shared ancestry
    const allFolders = await folderStore.listFolders();
    const target = allFolders.find((f) => f.id === id);
    const rootShared = target?.parentId ? await findRootSharedFolder(target.parentId) : null;

    const deletedIds = await folderStore.deleteFolder(id);
    if (deletedIds.length) {
      await store.clearFolderFromBuilds(deletedIds);
    }
    if (rootShared) {
      _e.sender.send("sync-status", { status: "syncing", folderId: rootShared.id });
      sharedLibrary.schedulePushFolderMeta(rootShared.id);
    }
    return deletedIds;
  });
  ipcMain.handle("folders:reorder", (_e, updates) =>
    folderStore.reorderFolders(updates),
  );

  // Build library operations
  ipcMain.handle("builds:move", async (_e, ids, folderId) => {
    if (folderId !== null) {
      const exists = await folderStore.folderExists(folderId);
      if (!exists) throw new Error(`Folder not found: ${folderId}`);
    }
    // Collect source folders before move
    const builds = await store.listBuilds();
    const sourceFolderIds = [...new Set(
      builds.filter((b) => ids.includes(b.id) && b.folderId).map((b) => b.folderId)
    )];

    // Block non-owners from moving builds out of a shared folder
    const destRootSharedCheck = await findRootSharedFolder(folderId);
    for (const srcId of sourceFolderIds) {
      if (srcId === folderId) continue;
      const srcRootShared = await findRootSharedFolder(srcId);
      if (srcRootShared && srcRootShared.id !== destRootSharedCheck?.id) {
        const auth = await getAuthRecord();
        if (!auth?.sharedLibrary?.isOwner) {
          throw new Error("Only org owners can move items out of shared folders.");
        }
        break;
      }
    }

    await store.moveBuilds(ids, folderId);

    // Handle shared folder sync — check full ancestor chain for both source and dest
    const movedBuilds = (await store.listBuilds()).filter((b) => ids.includes(b.id));
    const destRootShared = await findRootSharedFolder(folderId);

    if (destRootShared) {
      _e.sender.send("sync-status", { status: "syncing", folderId: destRootShared.id });
      for (const build of movedBuilds) {
        _e.sender.send("sync-status", { status: "syncing", type: "build", id: build.id, folderId: destRootShared.id });
        sharedLibrary.schedulePush("build", build);
      }
    }

    for (const srcId of sourceFolderIds) {
      if (srcId === folderId) continue;
      const srcRootShared = await findRootSharedFolder(srcId);
      // Only delete remotely if moving OUT of a different shared hierarchy
      if (srcRootShared && srcRootShared.id !== destRootShared?.id) {
        _e.sender.send("sync-status", { status: "syncing", folderId: srcRootShared.id });
        for (const id of ids) {
          sharedLibrary.deleteBuildRemote(srcId, id).catch((err) => {
            console.error("Failed to delete remote build after move:", err.message);
          });
        }
      }
    }

    // Touch source and destination folders
    const touchIds = [...sourceFolderIds];
    if (folderId) touchIds.push(folderId);
    if (touchIds.length) await folderStore.touchFolders([...new Set(touchIds)]);
    return true;
  });
  ipcMain.handle("builds:pin", (_e, ids, pinned) =>
    store.pinBuilds(ids, pinned),
  );
  ipcMain.handle("builds:reorder", (_e, updates) =>
    store.reorderBuilds(updates),
  );

  // Comp CRUD
  ipcMain.handle("comps:list", () => compStore.listComps());
  ipcMain.handle("comps:save", async (_e, comp) => {
    const existing = comp.id ? (await compStore.listComps()).find((c) => c.id === comp.id) : null;
    const oldFolderId = existing?.folderId ?? null;
    const saved = await compStore.upsertComp(comp);
    const rootShared = await findRootSharedFolder(saved.folderId);
    if (rootShared) {
      _e.sender.send("sync-status", { status: "syncing", folderId: rootShared.id });
      _e.sender.send("sync-status", { status: "syncing", type: "comp", id: saved.id, folderId: rootShared.id });
      sharedLibrary.schedulePush("comp", saved);
    }
    // If moved out of a shared folder (or into a different one), enforce ownership then delete remote
    if (oldFolderId && oldFolderId !== saved.folderId) {
      const oldRootShared = await findRootSharedFolder(oldFolderId);
      if (oldRootShared && oldRootShared.id !== rootShared?.id) {
        const auth = await getAuthRecord();
        if (!auth?.sharedLibrary?.isOwner) {
          throw new Error("Only org owners can move items out of shared folders.");
        }
        sharedLibrary.deleteCompRemote(oldFolderId, saved.id).catch((err) => {
          console.error("Failed to delete remote comp after move:", err.message);
        });
      }
    }
    return saved;
  });
  ipcMain.handle("comps:delete", async (_e, id) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === id);
    const folderId = comp?.folderId;
    // Same guard as builds:delete — members deleting locally must not wipe
    // the comp from the shared repo.
    const rootShared = folderId ? await findRootSharedFolder(folderId) : null;
    if (rootShared) {
      const auth = await getAuthRecord();
      if (!auth?.sharedLibrary?.isOwner) {
        throw new Error("Only org owners can delete from shared folders.");
      }
    }
    await compStore.deleteComp(id);
    await store.clearCompFromBuilds([id]);
    if (folderId && rootShared) {
      sharedLibrary.deleteCompRemote(folderId, id).catch((err) => {
        console.error("Shared library remote comp delete failed:", err.message);
      });
    }
  });
  ipcMain.handle("comps:reorder", (_e, updates) => compStore.reorderComps(updates));
  ipcMain.handle("comps:delete-batch", async (_e, ids) => {
    await compStore.deleteComps(ids);
    if (ids.length) {
      await store.clearCompFromBuilds(ids);
    }
  });
  ipcMain.handle("comps:add-tags", (_e, ids, tags) => compStore.addTagsToComps(ids, tags));
  ipcMain.handle("comps:remove-tags", (_e, ids, tags) => compStore.removeTagsFromComps(ids, tags));

  ipcMain.handle("comps:get-published-url", async (_e, compId) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === compId);
    if (!comp?.publishedFileId) return null;
    const auth = await getAuthRecord();
    const owner = auth?.onboarding?.targetOwner;
    if (!owner) throw new Error("GitHub publishing not configured.");
    const repo = auth?.onboarding?.repoName || TARGET_REPO;
    const slug = comp.publishedSlug || "";
    const theme = await store.getSetting("appearance.theme");
    return `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(slug)}&c=${comp.publishedFileId}.${comp.publishedKey}${theme ? `&t=${theme}` : ""}`;
  });

  ipcMain.handle("builds:generate-chat-link", async (_e, build) => {
    const { generateChatLink } = require("./buildChatLink.js");
    return generateChatLink(build);
  });
  ipcMain.handle("builds:prewarm-chat-links", async (_e, builds) => {
    const { prewarmChatLinks } = require("./buildChatLink.js");
    prewarmChatLinks(builds); // fire-and-forget
  });
  ipcMain.handle("builds:preview-chat-link", async (_e, link) => {
    const { previewChatLink } = require("./buildChatLink.js");
    return previewChatLink(link);
  });
  ipcMain.handle("builds:import-chat-link", async (_e, link, name, folderId, gameMode) => {
    const { decodeChatLinkToBuild } = require("./buildChatLink.js");
    const build = await decodeChatLinkToBuild(link, name, folderId, gameMode);
    return store.upsertBuild(build);
  });
  ipcMain.handle("builds:import-gw2skills", async (_e, url, name, folderId, gameMode) => {
    const { importGw2SkillsBuild } = require("./gw2skillsImport.js");
    const build = await importGw2SkillsBuild(url, name, folderId, gameMode);
    return store.upsertBuild(build);
  });
  ipcMain.handle("builds:encode-share-code", async (_e, build) => {
    const { encodeShareCode } = require("@axiapps/code");
    return encodeShareCode(build);
  });
  ipcMain.handle("builds:decode-share-code", async (_e, code) => {
    const { decodeShareCode } = require("@axiapps/code");
    return decodeShareCode(code);
  });
  ipcMain.handle("builds:is-share-code", async (_e, text) => {
    const { isValidShareCode } = require("@axiapps/code");
    return isValidShareCode(text);
  });

  ipcMain.handle("comps:encode-share-code", async (_e, compId) => {
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

  ipcMain.handle("comps:import-share-code", async (_e, code) => {
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

    // Map party line slots from decoded build refs to new build IDs
    const partyLines = decoded.partyLines.map((line) => ({
      capacity: line.capacity,
      slots: line.slots.map((buildRef) => buildRefToId.get(buildRef)).filter(Boolean),
    }));

    // Update the comp with buildIds and partyLines
    const updated = await compStore.upsertComp({
      ...comp,
      buildIds: newBuildIds,
      partyLines,
    });

    // Return comp ID + warning count for UI feedback
    const result = { compId: updated.id };
    if (decoded.failedBuildCount > 0) {
      result.warning = `${decoded.failedBuildCount} of ${decoded.failedBuildCount + decoded.builds.length} builds could not be decoded — they may require a newer version of AxiForge.`;
    }
    return result;
  });

  ipcMain.handle("builds:publish-build", async (event, buildId) => {
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

    // Shared builds always publish to the org's axibuilds repo, regardless of
    // what the user has set as their personal publishing target.
    const allFolders = await folderStore.listFolders();
    const sharedRoot = _findRootSharedFolder(build.folderId, allFolders);
    const owner = sharedRoot ? sharedRoot.orgName : personalOwner;
    const ownerType = sharedRoot ? "org" : "user";

    // Auto-populate build name if empty or default
    if (!build.title?.trim() || build.title === "Untitled Build") {
      const defaultName = getDefaultBuildName(build.specializations, build.profession);
      build.title = defaultName;
      await store.upsertBuild(build);
    }

    // Validate
    if (!build.title) throw new Error("Build name is required for publishing.");
    if (!build.profession) throw new Error("Build must have a profession selected.");

    // Generate or reuse publish metadata
    const fileId = build.publishedFileId || generateFileId();
    const encKey = build.publishedKey || generateEncryptionKey();
    const newSlug = slugifyBuildName(build.title);

    // Ensure repo and site infrastructure exist
    progress("repo");
    await ensureAxiForgeRepo(session.token, owner, ownerType);
    await ensurePagesWorkflow(session.token, owner, branch, TARGET_REPO);
    await ensurePages(session.token, owner, branch, TARGET_REPO);

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
      enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog);
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
              enriched = serializeForPublish(cb, cat, upCat);
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
    await publishSiteBundle(session.token, owner, combinedBundle, branch, TARGET_REPO);

    // Trigger Pages rebuild
    progress("deploy");
    await triggerPagesWorkflow(session.token, owner, branch, TARGET_REPO).catch(() => null);

    // Update build with publish metadata and push to shared repo so teammates
    // receive the published URL without needing to publish themselves.
    const savedBuild = await store.upsertBuild({
      ...build,
      publishedSlug: newSlug,
      publishedFileId: fileId,
      publishedKey: encKey,
    });
    if (sharedRoot) {
      sharedLibrary.schedulePush("build", savedBuild);
    }

    const themedBuilds = await store.getSetting("appearance.themedBuildPages");
    const themeParam = themedBuilds && build.profession && PROFESSION_THEME_IDS[build.profession]
      ? PROFESSION_THEME_IDS[build.profession]
      : await store.getSetting("appearance.theme");
    const pagesUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(newSlug)}&b=${fileId}.${encKey}${themeParam ? `&t=${themeParam}` : ""}`;

    // Only update the personal auth record for personal builds — shared builds
    // publish to the org's repo and must not overwrite the user's personal target.
    if (!sharedRoot) {
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
    }

    return {
      pagesUrl,
      slug: newSlug,
      fileId,
      changed: true,
    };
  });

  ipcMain.handle("comps:publish-comp", async (event, compId, boonCoverageHtml) => {
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

    // Shared comps publish to the org's axibuilds repo so the URL is the same
    // for all org members and doesn't change when a different user publishes.
    const compSharedRoot = await findRootSharedFolder(comp.folderId);
    const owner = compSharedRoot ? compSharedRoot.orgName : personalOwner;
    const ownerType = compSharedRoot ? "org" : "user";

    const allBuilds = await store.listBuilds();
    // Use union of buildIds + all party line slot IDs so a build that ended up
    // in a slot without being in buildIds (data divergence) is still published.
    const buildIdSet = new Set(getCompPublishBuildIds(comp));
    const compBuilds = allBuilds.filter((b) => buildIdSet.has(b.id));

    // ── 2. Ensure repo infrastructure ─────────────────────────────────
    progress("repo");
    await ensureAxiForgeRepo(session.token, owner, ownerType);
    await ensurePagesWorkflow(session.token, owner, branch, TARGET_REPO);
    await ensurePages(session.token, owner, branch, TARGET_REPO);

    // ── 3. Build SPA bundle ────────────────────────────────────────────
    progress("site");
    const spaBundle = buildSpaBundle();

    // ── 4. Publish unpublished builds, enrich all builds ──────────────
    const buildsMap = {};
    const updatedBuildRecords = [];
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
        enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog);
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

      const fileId = build.publishedFileId || generateFileId();
      const encKey = build.publishedKey || generateEncryptionKey();
      const slug = slugifyBuildName(build.title);
      const buildTheme = themedBuildsOn && build.profession && PROFESSION_THEME_IDS[build.profession]
        ? PROFESSION_THEME_IDS[build.profession]
        : compTheme;
      const spaUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(slug)}&b=${fileId}.${encKey}${buildTheme ? `&t=${buildTheme}` : ""}`;

      // Always re-encrypt with latest enriched data (traits may have been fixed)
      const encFile = buildEncryptedBuildFile(enrichedBuild, fileId, encKey);
      spaBundle[encFile.filePath] = encFile.content;

      if (!build.publishedFileId || build.publishedSlug !== slug) {
        updatedBuildRecords.push({ ...build, publishedFileId: fileId, publishedKey: encKey, publishedSlug: slug });
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
    await publishSiteBundle(session.token, owner, spaBundle, branch, TARGET_REPO);

    // ── 7. Trigger Pages rebuild ───────────────────────────────────────
    progress("deploy");
    await triggerPagesWorkflow(session.token, owner, branch, TARGET_REPO).catch(() => null);

    // ── 8. Persist metadata (builds first, then comp) ─────────────────
    // Push each newly-published build to the shared repo so teammates get the
    // published URL without needing to publish themselves.
    for (const updatedBuild of updatedBuildRecords) {
      const savedBuild = await store.upsertBuild(updatedBuild);
      if (compSharedRoot) {
        sharedLibrary.schedulePush("build", savedBuild);
      }
    }

    const savedTheme = await store.getSetting("appearance.theme");
    const compPagesUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(compSlug)}&c=${compFileId}.${compEncKey}${savedTheme ? `&t=${savedTheme}` : ""}`;

    const savedComp = await compStore.upsertComp({
      ...comp,
      publishedFileId: compFileId,
      publishedKey: compEncKey,
      publishedSlug: compSlug,
      boonCoverageHtml: boonCoverageHtml || comp.boonCoverageHtml || "",
    });

    // Push comp publish metadata to shared repo so teammates get the URL.
    // Skip personal auth record update for shared comps — the org's repo is the
    // canonical publish target, not the user's personal publishing setup.
    if (compSharedRoot) {
      sharedLibrary.schedulePush("comp", savedComp);
    } else {
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
    }

    return { pagesUrl: compPagesUrl, slug: compSlug, fileId: compFileId, changed: true };
  });

  ipcMain.handle("gw2:list-professions", async () => getProfessionList("en"));
  ipcMain.handle("gw2:get-profession-catalog", async (_e, professionId, gameMode) =>
    getProfessionCatalog(professionId, "en", gameMode)
  );
  ipcMain.handle("gw2:get-upgrade-catalog", async () => getUpgradeCatalog("en"));
  ipcMain.handle("gw2:clear-cache", async () => { clearCatalogCache(); return clearDiskCache(); });
  ipcMain.handle("wiki:get-summary", async (_e, title) => getWikiSummary(title));
  ipcMain.handle("wiki:get-related-data", async (_e, title) => getWikiRelatedData(title));
  ipcMain.handle("wiki:resolve-entity-facts", async (_e, entityNames) => {
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
  ipcMain.handle("settings:get", async (_e, key) => store.getSetting(key));
  ipcMain.handle("settings:set", async (_e, key, value) => store.setSetting(key, value));

  ipcMain.handle("discord:share-comp", async (_e, compId) => {
    const { shareCompToDiscord } = require("./discordWebhook");

    // 1. Load webhook URL and thread settings
    const [webhookUrl, threadMode, threadId] = await Promise.all([
      store.getSetting("discord.webhookUrl"),
      store.getSetting("discord.threadMode"),
      store.getSetting("discord.threadId"),
    ]);
    if (!webhookUrl || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)) {
      return { success: false, error: "Discord webhook URL is not configured or invalid" };
    }

    // 2. Load and validate comp
    const allComps = await compStore.listComps();
    const comp = allComps.find((c) => c.id === compId);
    if (!comp) return { success: false, error: "Comp not found" };
    if (!comp.publishedFileId || !comp.publishedKey || !comp.publishedSlug) {
      return { success: false, error: "Comp must be published before sharing" };
    }

    // 3. Resolve owner for URL construction (matches existing publish pattern)
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    if (!owner) return { success: false, error: "GitHub publishing not configured" };
    const repo = auth?.onboarding?.repoName || TARGET_REPO;

    // 4. Build comp URL — use GitHub Pages short redirect
    const { shortUrl } = require("./shortUrl");
    const compUrl = shortUrl(owner, repo, comp.publishedFileId);

    // 5. Load builds and construct maps — use short URLs
    const allBuilds = await store.listBuilds();
    const buildsMap = {};
    const buildUrls = {};
    for (const build of allBuilds) {
      buildsMap[build.id] = build;
      if (build.publishedFileId) {
        buildUrls[build.id] = shortUrl(owner, repo, build.publishedFileId);
      }
    }

    // 6. Share
    return shareCompToDiscord(comp, buildsMap, compUrl, buildUrls, webhookUrl, {
      threadMode: threadMode || "none",
      threadId: threadMode === "custom" ? threadId : null,
    });
  });

  ipcMain.handle("discord:share-build", async (_e, buildId) => {
    const { shareBuildToDiscord } = require("./discordWebhook");
    const { generateChatLink } = require("./buildChatLink.js");

    // 1. Load webhook URL and thread settings
    const [webhookUrl, threadMode, threadId] = await Promise.all([
      store.getSetting("discord.buildWebhookUrl"),
      store.getSetting("discord.buildThreadMode"),
      store.getSetting("discord.buildThreadId"),
    ]);
    if (!webhookUrl || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)) {
      return { success: false, error: "Build webhook URL is not configured or invalid" };
    }

    // 2. Load and validate build
    const allBuilds = await store.listBuilds();
    const build = allBuilds.find((b) => b.id === buildId);
    if (!build) return { success: false, error: "Build not found" };
    if (!build.publishedFileId || !build.publishedKey) {
      return { success: false, error: "Build must be published before sharing" };
    }

    // 3. Resolve owner for URL construction
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    if (!owner) return { success: false, error: "GitHub publishing not configured" };
    const repo = auth?.onboarding?.repoName || TARGET_REPO;

    // 4. Build URL
    const { shortUrl } = require("./shortUrl");
    const buildUrl = shortUrl(owner, repo, build.publishedFileId);

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

    // 8. Share
    return shareBuildToDiscord(build, buildUrl, chatLink, {
      professionIconUrl,
      specIconUrl,
      eliteSpecName,
      gameMode: build.gameMode || "pve",
      role,
      catalog,
      upgradeCatalog,
    }, webhookUrl, {
      threadMode: threadMode || "none",
      threadId: threadMode === "custom" ? threadId : null,
    });
  });

  ipcMain.handle("discord:build-copy-text", async (_e, buildId) => {
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
        const { shortUrl } = require("./shortUrl");
        buildUrl = shortUrl(owner, repo, build.publishedFileId);
      }
    }

    return formatBuildDiscordCopy(build, buildUrl);
  });

  ipcMain.handle("comps:generate-plaintext", async (_e, compId) => {
    const { getDisplayName, getDiscordEmoji } = require("./discordEmoji");

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
      const { shortUrl } = require("./shortUrl");
      for (const b of allBuilds) {
        buildsMap[b.id] = b;
        if (b.publishedFileId) buildUrls[b.id] = shortUrl(owner, repo, b.publishedFileId);
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
    const gridRows = [];
    (comp.partyLines || []).forEach((line, idx) => {
      const emojis = [];
      for (const slotId of line.slots || []) {
        const build = buildsMap[slotId];
        if (!build) continue;
        const emoji = getDiscordEmoji(build);
        if (emoji) emojis.push(emoji);
      }
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

    // Builds legend: one line per unique build with emoji + linked name
    const seen = new Set();
    const legendLines = [];
    for (const line of comp.partyLines || []) {
      for (const slotId of line.slots || []) {
        if (seen.has(slotId)) continue;
        seen.add(slotId);
        const build = buildsMap[slotId];
        if (!build) continue;
        const emoji = getDiscordEmoji(build);
        const name = getDisplayName(build);
        const url = buildUrls[slotId];
        const nameStr = url ? `[${name}](${url})` : name;
        legendLines.push(emoji ? `${emoji} ${nameStr}` : nameStr);
      }
    }

    const compName = comp.name || "Untitled Comp";
    const compUrl = hasUrls && comp.publishedFileId
      ? require("./shortUrl").shortUrl(owner, repo, comp.publishedFileId)
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

  ipcMain.handle("onboarding:status", async () => getOnboardingStatus());
  ipcMain.handle("onboarding:list-targets", async () => {
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

  ipcMain.handle("onboarding:setup-repo-pages", async (_e, targetOwner, ownerType = "user") =>
    setupRepoPages(targetOwner, ownerType)
  );

  ipcMain.handle("onboarding:setup-fork-pages", async (_e, targetOwner, ownerType = "user") =>
    setupRepoPages(targetOwner, ownerType)
  );

  ipcMain.handle("onboarding:poll-pages-status", async () => {
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

  ipcMain.handle("dialog:error", async (_e, title, body) => {
    await dialog.showMessageBox({
      type: "error",
      title: title || "Error",
      message: body || "Unknown error",
    });
    return true;
  });

  // .axicode file export/import
  registerAxicodeFileHandlers(win);

  // ─── Shared Library ─────────────────────────────────────────────────────────
  ipcMain.handle("shared-library:list-orgs", async () => {
    const session = await getSession();
    if (!session) return [];
    const targets = await listTargets(session.token, session.viewer.login);
    return targets.filter((t) => t.type === "org");
  });

  ipcMain.handle("shared-library:setup", async (_e, orgName) => {
    const session = await getSession();
    if (!session) throw new Error("Not logged in");
    const { ensureSharedRepo } = require("./githubApi");
    await ensureSharedRepo(session.token, orgName);
    const auth = await getAuthRecord();
    await store.saveAuth({
      ...auth,
      sharedLibrary: { orgName, repoName: "axibuilds-shared", isOwner: true },
    });
    return { orgName, repoName: "axibuilds-shared", isOwner: true };
  });

  ipcMain.handle("shared-library:share-folder", async (_e, folderId) => {
    _e.sender.send("sync-status", { status: "syncing", folderId });
    try {
      await sharedLibrary.shareFolder(folderId);
      _e.sender.send("sync-status", { status: "synced", folderId });
    } catch (err) {
      _e.sender.send("sync-status", { status: "error", folderId });
      throw err;
    }
    return true;
  });

  ipcMain.handle("shared-library:unshare-folder", async (_e, folderId) => {
    const auth = await getAuthRecord();
    if (!auth?.sharedLibrary?.isOwner) throw new Error("Only org owners can unshare folders.");
    _e.sender.send("sync-status", { status: "syncing", folderId });
    try {
      await sharedLibrary.unshareFolder(folderId);
      _e.sender.send("sync-status", { status: "synced", folderId });
    } catch (err) {
      _e.sender.send("sync-status", { status: "error", folderId });
      throw err;
    }
    return true;
  });

  ipcMain.handle("shared-library:pull-folder", async (_e, folderId) => {
    _e.sender.send("sync-status", { status: "syncing", folderId });
    try {
      await sharedLibrary.pullFolder(folderId);
      _e.sender.send("sync-status", { status: "synced", folderId });
    } catch (err) {
      _e.sender.send("sync-status", { status: "error", folderId });
      throw err;
    }
    return true;
  });

  ipcMain.handle("shared-library:pull-all", async () => {
    await sharedLibrary.pullAll();
    return true;
  });

  ipcMain.handle("shared-library:connect", async (_e) => {
    const auth = await getAuthRecord();
    if (!auth?.sharedLibrary?.orgName) throw new Error("No shared library configured");

    const { getRepoTree, getFileContents, getOrgRole } = require("./githubApi");

    // Determine if this user is an org owner
    const session = await getSession();
    const role = session
      ? await getOrgRole(session.token, auth.sharedLibrary.orgName, session.viewer.login)
      : null;
    // If getOrgRole failed (null), preserve the stored isOwner rather than overwriting with false
    const isOwner = role === "admin" ? true : (role === "member" ? false : (auth.sharedLibrary.isOwner ?? false));
    await store.saveAuth({
      ...auth,
      sharedLibrary: { ...auth.sharedLibrary, isOwner },
    });
    const tree = await getRepoTree(
      auth.token, auth.sharedLibrary.orgName,
      auth.sharedLibrary.repoName || "axibuilds-shared"
    );

    const folderMetas = [];
    for (const entry of tree) {
      const match = entry.path.match(/^folders\/([^/]+)\/meta\.json$/);
      if (match) {
        const { content } = await getFileContents(
          auth.token, auth.sharedLibrary.orgName,
          auth.sharedLibrary.repoName || "axibuilds-shared",
          entry.path
        );
        if (content) folderMetas.push(JSON.parse(content));
      }
    }

    // Create local folders for each remote folder (if they don't exist)
    const localFolders = await folderStore.listFolders();
    for (const meta of folderMetas) {
      const existing = localFolders.find((f) => f.id === meta.id);
      if (!existing) {
        await folderStore.upsertFolder({
          id: meta.id,
          name: meta.name,
          sortOrder: meta.sortOrder || 0,
          shared: true,
          orgName: auth.sharedLibrary.orgName,
        });
      } else if (!existing.shared) {
        await folderStore.upsertFolder({
          id: existing.id,
          name: meta.name,
          shared: true,
          orgName: auth.sharedLibrary.orgName,
        });
      }
    }

    // Emit syncing immediately for each shared folder so the UI shows spinners
    // before the pull begins, then fire the pull in the background so the
    // connect IPC call returns right away and the renderer can navigate.
    const sharedFolders = (await folderStore.listFolders()).filter((f) => f.shared);
    for (const folder of sharedFolders) {
      _e.sender.send("sync-status", { status: "syncing", folderId: folder.id });
    }
    sharedLibrary.pullAll().then(() => {
      for (const folder of sharedFolders) {
        _e.sender.send("sync-status", { status: "synced", folderId: folder.id });
      }
    }).catch((err) => {
      console.error("[connect] pullAll failed:", err.message);
      for (const folder of sharedFolders) {
        _e.sender.send("sync-status", { status: "error", folderId: folder.id });
      }
    });
    return true;
  });

  ipcMain.handle("shared-library:disconnect", async () => {
    sharedLibrary.stopPolling();
    sharedLibrary.invalidateHeadShaCache(); // force fresh fetch on next connect
    // Cancel all pending debounced pushes so they don't fire after disconnect
    for (const [key, timer] of sharedLibrary._pushTimers) {
      clearTimeout(timer?.id ?? timer);
    }
    sharedLibrary._pushTimers.clear();
    const auth = await getAuthRecord();
    delete auth.sharedLibrary;
    await store.saveAuth(auth);
    // Unmark all shared folders
    const folders = await folderStore.listFolders();
    for (const f of folders.filter((f) => f.shared)) {
      await folderStore.upsertFolder({ id: f.id, name: f.name, shared: false });
    }
    await syncStore.reset();
    return true;
  });

  ipcMain.handle("shared-library:get-config", async () => {
    const auth = await getAuthRecord();
    if (!auth?.sharedLibrary) return null;
    // Self-heal: if isOwner is not stored, re-check from the org role API
    if (!auth.sharedLibrary.isOwner) {
      const { getOrgRole } = require("./githubApi");
      const session = await getSession().catch(() => null);
      if (session) {
        const role = await getOrgRole(session.token, auth.sharedLibrary.orgName, session.viewer.login);
        if (role === "admin") {
          await store.saveAuth({
            ...auth,
            sharedLibrary: { ...auth.sharedLibrary, isOwner: true },
          });
          return { ...auth.sharedLibrary, isOwner: true };
        }
      }
    }
    return auth.sharedLibrary;
  });

  ipcMain.handle("shared-library:force-push", async (_e, type, item) => {
    return sharedLibrary._enqueuePush(async () => {
      if (type === "build") return sharedLibrary.pushBuild(item);
      if (type === "comp") return sharedLibrary.pushComp(item);
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
