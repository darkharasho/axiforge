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
const { createTrash } = require("./trash");
const { createArchive } = require("./archive");
const { SyncStore } = require("./syncStore");
const { BuildHistoryStore } = require("./buildHistoryStore");
const { CompHistoryStore } = require("./compHistoryStore");
const { buildFolderFeed } = require("./history/folderFeed");
const { migrateV1 } = require("./history/migrateV1");
const { compareVersions } = require("./history/compareVersions");
const diffBuild = require("./history/diffBuild");
const diffComp = require("./history/diffComp");
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
const { buildSpaBundle, buildEncryptedBuildFile, buildEncryptedCompFile } = require("./siteBundle");
const { snapshotDaily, readJsonFile, writeJsonAtomic } = require("./jsonFile");
const { WINDOW_MIN, windowChromeOptions, needsManualResize, resizeBounds } = require("../shared/windowChrome");
const { repairOrphans } = require("./orphanRepair");
const { serializeForPublish, loadCrossProfessionCatalogs } = require("./buildPublish");
const { serializeCompForPublish, getCompPublishBuildIds } = require("./compPublish");
const { formatStamp, planFormatMigrations } = require("./formatMigration");
const { initAutoUpdate } = require("./autoUpdate");
const { registerAxicodeFileHandlers } = require("./axicodeFile");
const { createLocalApi, generateToken, httpError } = require("./localApi");
const { writeDiscoveryFile, removeDiscoveryFileSync } = require("./localApiDiscovery");
const { parseCliFlags } = require("./cliFlags");
const { startAccess } = require("./access");
const { shareRejectionReason } = require("./shareGate");
const { withoutPublishReceipt } = require("../shared/publishState");
const {
  annotateBuild, annotateComp, annotateSyncEvent,
} = require("./publishFingerprint");
const { backfillPublishReceipts } = require("./publishBaseline");
const { shortUrl, publishedOwnerFor } = require("./shortUrl");
const { resolvePublishTarget } = require("./publishTarget");
const { PublishQueue } = require("./publishQueue");
const { autoPublishDecision, bulkPublishCandidates } = require("./autoPublish");
const { createPublishBatch, publishedPageUrl, displayTitle, pageThemes, PAGES_TIMEOUT_MS } = require("./publishBatch");
const { createPagesLive } = require("./pagesLive");
const { assertCanMoveOutOfTeam, assertFolderTreeFits, withoutReceiptHashes } = require("./teamGuards");


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

// Set at boot when the Axi access check blocks this instance; the normal
// window must never open afterwards. accessGate is the runtime re-check hook.
let accessBlocked = false;
let accessGate = null;
const recheckAccess = () => { if (accessGate) void accessGate.recheck(); };

app.on("second-instance", (_event, argv) => {
  if (accessBlocked) return;
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
// History summaries name things: "moved to Raids/Support", "party 1 slot 1:
// (none) -> Heal Tempest", "any Healers". `renderSummary` is synchronous and
// knows only ids, so those names have to be resolved and handed to it. They are
// supplied to the STORE as a factory rather than to each call site because a
// version is appended from six places — save, revert, team-sync pull, tombstone,
// trash and the v1 migration — and any one of them forgetting is a summary that
// reads "moved to another folder" forever after, in a log that cannot be
// re-rendered. The factory runs only when a version is actually written.
async function folderNameResolver() {
  // Trashed and archived folders included on purpose: a version that recorded a
  // move into a folder the user later deleted still has to be able to say where
  // it went.
  const all = await folderStore.listFolders();
  const gone = await folderStore.listTrashedFolders();
  const byId = new Map([...all, ...gone].map((f) => [f.id, f]));
  // The full path, so "Support" under "Raids" is not confused with a "Support"
  // somewhere else in the tree.
  return (id) => {
    const parts = [];
    let node = byId.get(id);
    // `seen` bounds the walk: a parentId cycle in a hand-edited folders.json
    // must not hang a save.
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      parts.unshift(node.name);
      node = node.parentId ? byId.get(node.parentId) : null;
    }
    return parts.length ? parts.join("/") : undefined;
  };
}

async function compBuildTitleResolver() {
  const byId = new Map((await store.listBuilds()).map((b) => [b.id, b.title]));
  return (id) => byId.get(id);
}

// Categories are comp-scoped ({ id, name, buildIds } on the comp), so a slot
// holding "tag:<id>" can only be named by looking across the comps.
async function compCategoryNameResolver() {
  const byId = new Map();
  for (const c of await compStore.listComps()) {
    for (const cat of c.categories || []) if (cat && cat.id) byId.set(cat.id, cat.name);
  }
  return (id) => byId.get(id);
}

// Runes, sigils, infusions and the enrichment/food/utility consumables are all
// stored as GW2 item ids, so a summary with no resolver behind it reads
// "enrichment: (none) -> 79926" and stays that way forever: the one-line
// summary is frozen into the log when the version is written.
// `getUpgradeCatalog` caches after its first fetch, and a catalog that cannot
// be loaded must never fail the save that asked for it — an absent resolver
// degrades to the raw id, which is what we had before.
async function upgradeNameResolver() {
  let catalog;
  try {
    catalog = await getUpgradeCatalog("en");
  } catch {
    return undefined;
  }
  const maps = ["runeById", "sigilById", "infusionById", "enrichmentById", "foodById", "utilityById"]
    .map((key) => catalog && catalog[key])
    .filter((m) => m && typeof m.get === "function");
  if (!maps.length) return undefined;
  // Ids are stored as strings ("79926"); the catalog maps are keyed by number.
  return (value) => {
    const id = Number(value);
    if (!Number.isFinite(id)) return undefined;
    for (const m of maps) {
      const hit = m.get(id);
      if (hit && hit.name) return hit.name;
    }
    return undefined;
  };
}

async function buildSummaryOpts() {
  const [folderNameOf, itemNameOf] = await Promise.all([
    folderNameResolver(), upgradeNameResolver(),
  ]);
  return { folderNameOf, itemNameOf };
}

async function compSummaryOpts() {
  const [folderNameOf, buildNameOf, categoryNameOf] = await Promise.all([
    folderNameResolver(), compBuildTitleResolver(), compCategoryNameResolver(),
  ]);
  return { folderNameOf, buildNameOf, categoryNameOf };
}

const buildHistoryStore = new BuildHistoryStore(dataDir, buildSummaryOpts);
const compHistoryStore = new CompHistoryStore(dataDir, compSummaryOpts);

// v2 histories are uncapped, so every history read is a page. 200 is what the
// pre-v2 handlers returned and stays the default; the cap keeps a renderer
// typo from pulling a whole log (each keyframe carries a full document) across
// IPC.
function historyPage(opts) {
  const { limit, cursor } = opts || {};
  const n = Number(limit);
  return {
    limit: Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 200,
    cursor: cursor === undefined ? null : cursor,
  };
}

// Migrates both v1 history files if they are still there. Idempotent: the
// migration renames its source to `<file>.pre-v2` when it is done, and skips
// records that already have a v2 log.
async function migrateHistoryV1() {
  const jobs = [
    { label: "builds", store: buildHistoryStore, fileName: "build-history.json", docs: () => store.listBuilds() },
    { label: "comps", store: compHistoryStore, fileName: "comp-history.json", docs: () => compStore.listComps() },
  ];
  for (const job of jobs) {
    try {
      const live = new Map((await job.docs()).map((d) => [d.id, d]));
      const r = await migrateV1({ baseDir: dataDir, store: job.store, fileName: job.fileName, liveDocs: live });
      if (r && (r.migrated || r.failed)) {
        // `skipped`/`retired` are flags, not counts: nothing to migrate, and
        // whether the v1 file was renamed to `.pre-v2` (the user's undo).
        console.warn(
          `[history] v1 ${job.label} migration: ${r.migrated} record(s) migrated, ${r.failed} failed; `
          + `${r.entries} v1 entries → ${r.versioned} versions `
          + `(${r.derivedOnly} derived-only, ${r.dropped} dropped)`
          + `${r.retired ? "" : "; source file NOT retired — it will be re-read next launch"}`,
        );
      }
    } catch (err) {
      // migrateV1 does not reject; this is the belt on top of the braces,
      // because history must never block app launch.
      console.warn(`[history] v1 ${job.label} migration failed:`, err && err.message);
    }
  }
}
// Deleting anything in the library stages it here for 30 days rather than
// destroying it. See trash.js for why the comp-unlink and history deletion that
// used to run on delete are deferred until purge.
const trash = createTrash({
  buildStore: store,
  compStore,
  folderStore,
  historyStore: buildHistoryStore,
  compHistoryStore,
});
// The archive is the trash's opposite number: nothing is staged for removal and
// nothing expires. See archive.js for why archived records stay live here and
// are hidden in the renderer instead.
const archive = createArchive({ buildStore: store, compStore, folderStore });

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

// E2E workers run side by side and would share the OS clipboard, so one spec's
// copy lands in another spec's paste. AXIFORGE_PRIVATE_CLIPBOARD=1 gives each
// process its own in-memory text clipboard. Patching the module object covers
// the IPC handlers and specs that call clipboard through electronApp.evaluate.
if (process.env.AXIFORGE_PRIVATE_CLIPBOARD === "1" && !app.isPackaged) {
  let privateClipboardText = "";
  clipboard.writeText = (text) => { privateClipboardText = String(text ?? ""); };
  clipboard.readText = () => privateClipboardText;
}

function createWindow(savedBounds) {
  const win = new BrowserWindow({
    width: savedBounds?.width ?? 1600,
    height: savedBounds?.height ?? 980,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    show: false,
    frame: false,
    // A frameless window's corner is rounded in CSS, and CSS can only cut a
    // hole: what shows through it is whatever the window itself was created
    // over. An opaque backgroundColor paints a square there, so the radius reads
    // as no radius at all. Transparent on Linux and Windows, the pattern axiam
    // already ships; macOS rounds and shadows a frameless window itself, and
    // transparency there would cost the native shadow for nothing. The
    // renderer's half is the clip on <html> in styles/app.css.
    //
    // The options live in shared/windowChrome.js because transparency costs the
    // native resize border on Linux and Windows, and preload has to reach the
    // same verdict to decide whether the renderer installs its own resize
    // grips — see the window:resize-* handlers below.
    ...windowChromeOptions(process.platform),
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: path.join(__dirname, "../preload/index.js"),
      // A window that is never shown gets no vsync, so Chromium paints it at
      // 1 fps: rAF, CSS animations and scroll events then land up to a second
      // late, and E2E dropdowns close or never finish opening. Offscreen
      // rendering keeps its own clock (60 fps, set on ready-to-show).
      ...(HIDE_WINDOW ? { offscreen: true } : {}),
      // The preload is sandboxed and cannot require shared/windowChrome to
      // reach this verdict itself, so hand it over as data. Computed from the
      // same helper the window above is built with, which is what keeps the
      // grips and the native border from ever both being absent.
      additionalArguments: [
        `--axi-manual-resize=${needsManualResize(process.platform) ? "1" : "0"}`,
      ],
    },
  });

  win.on("close", () => {
    store.setSetting("windowBounds", win.getBounds());
  });

  win.once("ready-to-show", () => {
    if (!HIDE_WINDOW) win.show();
    else win.webContents.setFrameRate(60);
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

// { session, unauthorized }: unauthorized is true when GitHub just refused the
// stored token (it is cleared), so a caller can tell that from never signed in.
async function readSession() {
  const auth = await store.getAuth();
  if (!auth.token) return { session: null, unauthorized: false };
  try {
    const viewer = await getViewer(auth.token);
    return { session: { token: auth.token, viewer }, unauthorized: false };
  } catch (err) {
    if (err?.status === 401) {
      await store.clearAuth();
      return { session: null, unauthorized: true };
    }
    // Network error or transient GitHub failure — keep the token,
    // fall back to the cached viewer so the session stays alive.
    if (auth.viewer) {
      return { session: { token: auth.token, viewer: auth.viewer }, unauthorized: false };
    }
    return { session: null, unauthorized: false };
  }
}

async function getSession() {
  return (await readSession()).session;
}

// A publish round's session: a refused token is GITHUB_UNAUTHORIZED, so the
// queue pauses for sign-in instead of reading it as "not set up".
async function getPublishSession() {
  const { session, unauthorized } = await readSession();
  if (unauthorized) {
    const err = new Error("Sign in to GitHub again to publish.");
    err.code = "GITHUB_UNAUTHORIZED";
    throw err;
  }
  return session;
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
    targetOwnerType: onboarding.targetOwnerType === "org" ? "org" : "user",
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
    if (/^(Build|Comp|Folder|Version|History entry) not found/i.test(msg)) throw httpError(404, msg);
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
// Set once the publish queue is constructed in the ready handler, for the
// app-level quit hooks.
let publishQueueRef = null;

// Sync events go to the focused-most window (the same target TeamSync itself
// uses for its own events).
function teamSyncEmit(channel, data) {
  const wins = BrowserWindow.getAllWindows();
  // A pulled record is spliced straight into renderer state, so it needs the
  // contentHash the list handlers would have attached.
  if (wins.length) wins[0].webContents.send(channel, channel === "sync-status" ? annotateSyncEvent(data) : data);
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
  if (accessBlocked) return null;
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
  // Access check first: when blocked, start nothing else (no local API, team
  // sync, IPC or main window).
  let access = null;
  try {
    access = await startAccess({
      electron: { app, BrowserWindow, shell },
      store,
      headless: cliFlags.headless,
    });
  } catch {
    // Fail open: a bug in the check must not take the app down.
    console.warn('access check unavailable');
  }
  if (access && access.blocked) {
    accessBlocked = true;
    return;
  }
  accessGate = access ? access.gate : null;
  await store.migrateCompIdToCompIds();
  await folderStore.init();
  await compStore.init();
  await syncStore.init();
  await buildHistoryStore.init();
  await compHistoryStore.init();
  // One-shot v1 → v2 history migration. It runs after the record stores are up
  // because it seeds a record's origin from the LIVE document, and it never
  // rejects: a failure here leaves the pre-v2 file in place and the user with
  // an empty history, not a launch that hangs.
  await migrateHistoryV1();
  // Records published before publish receipts existed get a baseline one, so
  // an edit made from here on reads "Out of date". Idempotent; a failure only
  // leaves those records on the legacy timestamp check.
  try {
    const stamped = await backfillPublishReceipts({ buildStore: store, compStore });
    if (stamped.builds || stamped.comps) console.log("[publish] baseline receipts:", stamped);
  } catch (err) {
    console.warn("[publish] baseline backfill failed:", err.message);
  }
  // Sweep anything past the retention window. Never blocks startup: a failed
  // sweep means items linger in the trash, which is harmless.
  trash.purgeExpired().catch((err) => console.warn("[trash] sweep failed:", err.message));
  // Same posture for version history: it is an undo net, not an archive, so
  // everything past the newest MAX_VERSIONS goes. Sequential inside, never
  // awaited here — a library with hundreds of records must not add its prune
  // to launch time.
  Promise.all([
    buildHistoryStore.pruneAll(),
    compHistoryStore.pruneAll(),
  ]).then(([builds, comps]) => {
    const dropped = builds.dropped + comps.dropped;
    if (dropped) console.warn(`[history] pruned ${dropped} old version(s) across ${builds.records + comps.records} record(s)`);
  }).catch((err) => console.warn("[history] prune failed:", err.message));
  // Once-a-day snapshot of the user's library (kept 7 days) under data/backups/.
  // Cheap insurance on top of the per-write .bak generation in jsonFile.js.
  snapshotDaily(dataDir, ["builds.json", "comps.json", "folders.json", "settings.json"]).catch(() => {});
  await initDiskCache(dataDir);
  initWikiClient(dataDir);
  await migrateCompGameModes(store, compStore);
  // Records whose folder was hard-deleted by a pre-0.14.0 release are on disk
  // but unreachable from every view. Send them back to the root so they exist
  // again as far as the user is concerned.
  repairOrphans({ buildStore: store, compStore, folderStore })
    .then(({ builds, comps, folders }) => {
      const total = builds.length + comps.length + folders.length;
      if (total) console.warn(`[orphan-repair] reattached ${total} orphaned record(s) to the root`);
    })
    .catch((err) => console.warn("[orphan-repair] failed:", err.message));

  // Team root for a folder (walks parentId). Null for personal folders.
  async function findTeamRoot(folderId) {
    if (!folderId) return null;
    return teamSync.teamRootFor(folderId, await folderStore.listFolders());
  }

  const teamSync = new TeamSync({
    buildStore: store, compStore, folderStore, syncStore,
    historyStore: buildHistoryStore,
    compHistoryStore,
    // A teammate's delete stages in the trash, exactly like your own.
    trash,
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
  // Publish on save (publishQueue.js / publishBatch.js). Rounds go through
  // enqueuePublish, so a round, a Retry and a local API publish never race.
  const publishBatch = createPublishBatch({
    getSession: getPublishSession, getAuthRecord, patchAuthRecord, findTeamRoot, resolvePublishTarget,
    listBuilds: () => store.listBuilds(),
    listComps: () => compStore.listComps(),
    markBuildPublished: (id, patch) => store.markPublished(id, patch),
    markCompPublished: (id, patch) => compStore.markPublished(id, patch),
    getSetting: (key) => store.getSetting(key),
    enrichBuildForPublish, buildSpaBundle, addFormatMigrations, stampFormatMigrations,
    ensurePublishInfra, invalidatePublishInfra, publishSiteBundle, triggerPagesWorkflow, pollUrlLive,
    teamPut: (teamId, id, kind) => safeEnqueue(() => teamSync.enqueue(teamId, id, kind, "put"), { type: kind, id }),
    choiceOf: (kind, id) => publishQueue.choiceOf(kind, id),
    repo: TARGET_REPO,
  });
  const publishQueueFile = path.join(app.getPath("userData"), "publish-queue.json");
  const publishQueue = new PublishQueue({
    runRound: (items) => enqueuePublish(() => publishBatch(items)),
    load: () => readJsonFile(publishQueueFile, null),
    persist: (data) => writeJsonAtomic(publishQueueFile, data, { backup: false }),
    emit: (snapshot) => broadcast("publish:status", snapshot),
  });
  publishQueueRef = publishQueue;
  publishQueue.load().catch((err) => console.warn("[publish-queue] load failed:", err.message));

  app.on("browser-window-focus", () => {
    teamSync.onFocus();
    // Focus retries a "disconnected" pause and an offline backoff, never bad
    // credentials: those wait for sign-in (auth:complete-login).
    publishQueue.resume({ keepUnauthorized: true }).catch(() => {});
  });

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
  // After normal startup, never awaited: the manifest fetch must not delay launch.
  recheckAccess();

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

  // ── Manual window resize ───────────────────────────────────────────────────
  // A transparent window has no native resize border (see windowChromeOptions),
  // so the renderer's grips drive it from here. The bounds the drag started from
  // are held per window rather than recomputed per move: the renderer reports
  // the total delta from where the pointer went down, so a coalesced or dropped
  // move event cannot accumulate into drift.
  const resizeDrags = new WeakMap();

  handle("window:resize-start", (event, edge) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isMaximized() || win.isFullScreen()) return false;
    resizeDrags.set(win, { edge, start: win.getBounds() });
    return true;
  });

  handle("window:resize-to", (event, dx, dy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const drag = win && resizeDrags.get(win);
    if (!drag) return false;
    win.setBounds(resizeBounds(drag.start, drag.edge, dx, dy, WINDOW_MIN));
    return true;
  });

  handle("window:resize-end", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      resizeDrags.delete(win);
      // The window only persists its bounds on close; a resize that ends with
      // the app still running should survive a crash too.
      store.setSetting("windowBounds", win.getBounds());
    }
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
    recheckAccess();
    publishQueueRef?.resume().catch(() => {});
    return { viewer };
  });

  handle("auth:logout", async () => {
    await store.clearAuth();
    return true;
  });

  // contentHash rides along for the renderer's publish status; never stored.
  // Where a record publishes, from the stored auth only: a save must never wait
  // on a network round trip. null when signed out (the round decides later).
  async function publishTargetOwner(record) {
    const auth = await getAuthRecord();
    if (!auth?.token || !auth?.viewer?.login) return null;
    return resolvePublishTarget(auth, auth.viewer.login, await findTeamRoot(record.folderId)).owner;
  }

  // Never fails the save: publishing is best-effort on top of a local write.
  async function autoPublishAfterSave(kind, saved) {
    try {
      const annotated = kind === "comp" ? annotateComp(saved) : annotateBuild(saved);
      const decision = autoPublishDecision(kind, annotated, {
        targetOwner: await publishTargetOwner(saved),
        choice: publishQueue.choiceOf(kind, saved.id),
      });
      if (decision === "enqueue") {
        publishQueue.enqueue(kind, saved.id);
      } else if (decision === "ask-owner" && publishQueue.markNeedsChoice(kind, saved.id, saved.publishedOwner)) {
        broadcast("publish:needs-owner-choice", { kind, id: saved.id, owner: saved.publishedOwner });
      }
    } catch (err) {
      console.warn("[publish-queue] auto-publish skipped:", kind, saved?.id, err?.message || err);
    }
  }

  handle("builds:list", async () => (await store.listBuilds()).map(annotateBuild));
  handle("builds:save", async (_e, rawBuild) => {
    // Main owns the publish receipt: a renderer object can be stale.
    const build = withoutReceiptHashes(rawBuild);
    const existing = build.id ? (await store.listBuilds()).find((b) => b.id === build.id) : null;
    const oldFolderId = existing?.folderId ?? null;
    // Guard BEFORE the local write: a refusal after the upsert would leave the
    // build locally moved with nothing tombstoned in the source team.
    // upsertBuild PRESERVES the existing folder when the payload's folderId is
    // null/undefined (buildStore.js), so a partial save is NOT a move to personal.
    const { oldRoot, newRoot } = await assertCanMoveOutOfTeam({ teamSync, findTeamRoot }, {
      itemId: build.id, oldFolderId, newFolderId: build.folderId ?? oldFolderId, label: "build",
    });
    const saved = await store.upsertBuild(build);
    // History records the SAVED record, not the payload: a partial save merges
    // into the stored build, so the payload is not what the build now is.
    // Non-blocking — history is never worth failing a save over. The store
    // diffs its own stored tail, so `existing` only seeds a record that has no
    // history yet.
    {
      const auth = await getAuthRecord().catch(() => null);
      buildHistoryStore.appendVersion({
        recordId: saved.id,
        before: existing,
        after: saved,
        author: auth?.viewer?.login || "local",
        source: "local",
      }).catch((err) => console.warn("[history] appendVersion failed:", err.message));
    }
    if (saved.folderId) {
      await folderStore.touchFolders([saved.folderId]);
    }
    if (newRoot) await safeEnqueue(() => teamSync.enqueue(newRoot.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
    // Moved out of a team (or into a different one): tombstone it there.
    if (oldRoot && oldRoot.id !== newRoot?.id) {
      await safeEnqueue(() => teamSync.enqueue(oldRoot.teamId, saved.id, "build", "delete"), { type: "build", id: saved.id });
    }
    await autoPublishAfterSave("build", saved);
    return annotateBuild(saved);
  });
  handle("builds:delete", async (_e, id) => {
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === id);
    const folderId = build?.folderId;
    const teamRoot = folderId ? await findTeamRoot(folderId) : null;
    if (teamRoot && !(await teamSync.canDeleteIn(teamRoot.teamId, id, folderId))) {
      throw new Error("Only the team owner or the build's creator can delete it from the team.");
    }
    // Staged in the trash, not destroyed. The comp unlink and history deletion
    // that used to run here now wait for the purge, so a restore inside the
    // retention window brings the build back whole.
    await trash.trashBuilds([id]);
    if (folderId) await folderStore.touchFolders([folderId]);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, id, "build", "delete"), { type: "build", id });
    return true;
  });

  // ── Trash ──────────────────────────────────────────────────────────────────
  handle("trash:list", async () => trash.listTrash());

  handle("trash:restore", async (_e, selection) => {
    const restored = await trash.restore(selection || {});
    // A team item was tombstoned for the team when it was trashed, so bringing
    // it back locally has to push it again or only this machine sees it.
    const [builds, comps, folders] = await Promise.all([
      store.listBuilds(), compStore.listComps(), folderStore.listFolders(),
    ]);
    const enqueuePut = async (id, type, folderId) => {
      const teamRoot = folderId ? _findTeamRoot(folderId, folders) : null;
      if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, id, type, "put"), { type, id });
    };
    for (const id of restored.folders) {
      const folder = folders.find((f) => f.id === id);
      if (folder?.parentId) await enqueuePut(id, "folder", folder.parentId);
    }
    for (const id of restored.builds) {
      await enqueuePut(id, "build", builds.find((b) => b.id === id)?.folderId);
    }
    for (const id of restored.comps) {
      await enqueuePut(id, "comp", comps.find((c) => c.id === id)?.folderId);
    }
    return restored;
  });

  // ── Archive ────────────────────────────────────────────────────────────────
  // No team ops anywhere in here. Archiving does not remove anything -- the
  // records stay live and stay synced -- and the stamp itself is local, so a
  // teammate's library is unaffected by what you tidy away in yours.
  handle("archive:list", async () => archive.listArchive());

  handle("archive:builds", async (_e, ids) => archive.archiveBuilds(ids || []));
  handle("archive:comps", async (_e, ids) => archive.archiveComps(ids || []));
  handle("archive:folder", async (_e, id) => archive.archiveFolder(id));
  handle("archive:restore", async (_e, selection) => archive.unarchive(selection || {}));

  // No team op on purge: the tombstone already went out when the item was
  // trashed, so the team stopped seeing it then.
  handle("trash:purge", async (_e, selection) => trash.purge(selection || {}));
  handle("trash:empty", async () => trash.empty());

  // Build history. A page, not the whole log: v2 histories are uncapped, so
  // the renderer asks for a window and pages with `nextCursor`.
  handle("builds:get-history", async (_e, buildId, opts) => (
    buildHistoryStore.listVersions(buildId, historyPage(opts))
  ));

  handle("folders:get-history", async (_e, folderId, opts) => {
    const { limit } = historyPage(opts);
    // Trashed records are passed in alongside the live ones on purpose — see
    // history/folderFeed.js, which explains why and does the assembly.
    return buildFolderFeed({
      folderId,
      limit,
      folders: await folderStore.listFolders(),
      builds: [...(await store.listBuilds()), ...(await store.listTrashedBuilds())],
      comps: [...(await compStore.listComps()), ...(await compStore.listTrashedComps())],
      buildHistory: buildHistoryStore,
      compHistory: compHistoryStore,
    });
  });

  // One version's whole document, and the ops that produced it. `kind` picks
  // the store so the renderer has a single pair of calls for both record types.
  const historyStoreFor = (kind) => (kind === "comp" ? compHistoryStore : buildHistoryStore);

  handle("history:get-version", async (_e, kind, recordId, v) => (
    historyStoreFor(kind).getVersion(recordId, v)
  ));

  handle("history:get-ops", async (_e, kind, recordId, v) => {
    const { versions } = await historyStoreFor(kind).listVersions(recordId, { limit: 1, cursor: v });
    const entry = versions[0];
    if (!entry || entry.v !== Number(v)) return [];
    // A keyframe carries no ops of its own; derive them by diffing the version
    // before it, so "what changed here" answers the same way for every entry.
    if (Array.isArray(entry.ops)) return entry.ops;
    const hs = historyStoreFor(kind);
    const [before, after] = await Promise.all([
      hs.getVersion(recordId, Number(v) - 1),
      hs.getVersion(recordId, Number(v)),
    ]);
    if (!before || !after) return [];
    return (kind === "comp" ? diffComp : diffBuild).diff(before, after);
  });

  // A TRUE diff between any two versions, however far apart: two
  // reconstructions and one diff() call. The compare modal used to assemble
  // this renderer-side by concatenating `history:get-ops` over the range,
  // which reported a value that changed and changed BACK as two changes and
  // cost one IPC round trip per version. `history:get-ops` stays — it is still
  // the right answer to "what did THIS entry change" in the entry list.
  //
  // Ops come back LABELLED, by the same renderOpDetail that writes the entry
  // summaries, so the two surfaces can never word the same edit differently.
  handle("history:compare", async (_e, kind, recordId, fromV, toV) => compareVersions({
    store: historyStoreFor(kind),
    differ: kind === "comp" ? diffComp : diffBuild,
    recordId,
    fromV,
    toV,
    // Exactly the options appendVersion used when it wrote the summary for
    // this record type — the same factory, so the compare table and the entry
    // list cannot word the same edit differently.
    summaryOpts: await (kind === "comp" ? compSummaryOpts() : buildSummaryOpts()),
  }));

  handle("comps:get-history", async (_e, compId, opts) => compHistoryStore.listVersions(compId, historyPage(opts)));

  handle("comps:revert", async (_e, compId, versionNumber) => {
    const doc = await compHistoryStore.getVersion(compId, versionNumber);
    if (!doc) throw new Error("Version not found");

    // Same as builds:revert — a comp sitting in the trash has to come out of it,
    // or upsertComp carries the deletedAt stamp over and the revert writes a
    // comp nothing will draw.
    const trashedComps = await compStore.listTrashedComps();
    if (trashedComps.some((c) => c.id === compId)) {
      await trash.restore({ comps: [compId] });
    }

    const current = (await compStore.listComps()).find((c) => c.id === compId);
    const auth = await getAuthRecord().catch(() => null);
    // The history document carries the receipt from ITS point in time; the
    // published page reflects the latest publish, so the current receipt stays.
    const saved = await compStore.upsertComp(withoutPublishReceipt(doc));
    if (current) {
      compHistoryStore.appendVersion({
        recordId: compId,
        before: current,
        after: saved,
        author: auth?.viewer?.login || "local",
        source: "revert",
      }).catch((err) => console.warn("[comp-history] revert appendVersion failed:", err.message));
    }
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, saved.id, "comp", "put"), { type: "comp", id: saved.id });
    await autoPublishAfterSave("comp", saved);
    return annotateComp(saved);
  });

  handle("builds:revert", async (_e, buildId, versionNumber) => {
    const doc = await buildHistoryStore.getVersion(buildId, versionNumber);
    if (!doc) throw new Error("Version not found");

    // Restoring a version of a build that is currently in the trash has to take
    // it OUT of the trash — otherwise upsertBuild carries the deletedAt stamp
    // over (it does that on purpose, so a teammate's edit can't resurrect
    // something you deleted) and the revert writes a build nothing will draw.
    // This is the undelete path for a shared folder: a teammate deletes a
    // build, you open the folder history, and put that version back.
    const trashedBuilds = await store.listTrashedBuilds();
    if (trashedBuilds.some((b) => b.id === buildId)) {
      await trash.restore({ builds: [buildId] });
    }

    // Capture the current state before reverting so the revert itself is undoable
    const currentBuilds = await store.listBuilds();
    const currentBuild = currentBuilds.find((b) => b.id === buildId);
    const auth = await getAuthRecord().catch(() => null);
    // See comps:revert — the current receipt stays.
    const saved = await store.upsertBuild(withoutPublishReceipt(doc));
    if (currentBuild) {
      buildHistoryStore.appendVersion({
        recordId: buildId,
        before: currentBuild,
        after: saved,
        author: auth?.viewer?.login || "local",
        source: "revert",
      }).catch((err) => console.warn("[history] revert appendVersion failed:", err.message));
    }
    if (saved.folderId) {
      await folderStore.touchFolders([saved.folderId]);
    }
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
    await autoPublishAfterSave("build", saved);
    return annotateBuild(saved);
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
    // A folder carries its own grant, so editing one is governed by the folder
    // itself and not only by where it sits. New folders have no grant of their
    // own yet; the parent check inside assertCanMoveOutOfTeam covers those.
    if (existing) await teamSync.assertCanWrite(folder.id);
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
    // Keyed by the folder's OWN id: a grant on a folder governs the folder as
    // well as its contents, which is what makes "none" hide it rather than just
    // what is inside it. @see src/main/folderAccess.js
    if (teamRoot && !(await teamSync.canDeleteIn(teamRoot.teamId, id, id))) {
      throw new Error("Only the team owner or the folder's creator can delete it from the team.");
    }
    // Trashes the subtree plus the builds and comps inside it, under one batch,
    // so restoring the folder brings its contents back with it.
    const { folders: deletedIds } = await trash.trashFolder(id);
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
    // Both ends, before anything moves — see assertCanMoveOutOfTeam.
    if (folderId) await teamSync.assertCanWrite(folderId);
    for (const srcId of sourceFolderIds) {
      if (srcId === folderId) continue;
      await teamSync.assertCanWrite(srcId);
      const srcRoot = await findTeamRoot(srcId);
      if (srcRoot && srcRoot.id !== destRoot?.id) {
        for (const id of ids) {
          if (!(await teamSync.canDeleteIn(srcRoot.teamId, id, srcId))) {
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
  handle("comps:list", async () => (await compStore.listComps()).map(annotateComp));
  // Comp summaries name the builds that moved ("removed Heal Druid") rather than
  // counting them, which needs a title lookup the comp itself does not carry.
  handle("comps:save", async (_e, rawComp) => {
    // Main owns the publish receipt: a renderer object can be stale.
    const comp = withoutReceiptHashes(rawComp);
    const existing = comp.id ? (await compStore.listComps()).find((c) => c.id === comp.id) : null;
    const oldFolderId = existing?.folderId ?? null;
    // Guard BEFORE the local write — see builds:save.
    // Resolve the destination the way upsertComp will actually store it: an
    // ABSENT folderId is a partial save that leaves the comp where it is, not a
    // move to the library root. Reading it as a move made the guard below
    // enqueue a team-wide delete for a rename. @see CompStore#upsertComp.
    const newFolderId = comp.folderId === undefined ? oldFolderId : (comp.folderId ?? null);
    const { oldRoot, newRoot } = await assertCanMoveOutOfTeam({ teamSync, findTeamRoot }, {
      itemId: comp.id, oldFolderId, newFolderId, label: "comp",
    });
    const saved = await compStore.upsertComp(comp);
    // Non-blocking — never fails the save, exactly as builds:save does.
    {
      const auth = await getAuthRecord().catch(() => null);
      compHistoryStore.appendVersion({
        recordId: saved.id,
        before: existing,
        after: saved,
        author: auth?.viewer?.login || "local",
        source: "local",
      }).catch((err) => console.warn("[comp-history] appendVersion failed:", err.message));
    }
    if (newRoot) await safeEnqueue(() => teamSync.enqueue(newRoot.teamId, saved.id, "comp", "put"), { type: "comp", id: saved.id });
    if (oldRoot && oldRoot.id !== newRoot?.id) {
      await safeEnqueue(() => teamSync.enqueue(oldRoot.teamId, saved.id, "comp", "delete"), { type: "comp", id: saved.id });
    }
    await autoPublishAfterSave("comp", saved);
    return annotateComp(saved);
  });
  handle("comps:delete", async (_e, id) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === id);
    const folderId = comp?.folderId;
    const teamRoot = folderId ? await findTeamRoot(folderId) : null;
    if (teamRoot && !(await teamSync.canDeleteIn(teamRoot.teamId, id, folderId))) {
      throw new Error("Only the team owner or the comp's creator can delete it from the team.");
    }
    await trash.trashComps([id]);
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
      if (!(await teamSync.canDeleteIn(teamRoot.teamId, id, comp.folderId))) {
        throw new Error(`Only the team owner or the comp's creator can delete "${comp.name}" from the team.`);
      }
      teamOps.push([teamRoot.teamId, id]);
    }
    await trash.trashComps(ids);
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
  // Tags are part of a comp's published page, so a tag edit publishes like a save.
  async function autoPublishComps(ids) {
    const idSet = new Set(ids);
    for (const comp of await compStore.listComps()) {
      if (idSet.has(comp.id)) await autoPublishAfterSave("comp", comp);
    }
  }
  handle("comps:add-tags", async (_e, ids, tags) => {
    const res = await compStore.addTagsToComps(ids, tags);
    await enqueueCompPuts(ids);
    await autoPublishComps(ids);
    return res;
  });
  handle("comps:remove-tags", async (_e, ids, tags) => {
    const res = await compStore.removeTagsFromComps(ids, tags);
    await enqueueCompPuts(ids);
    await autoPublishComps(ids);
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
  handle("builds:generate-chat-link-report", async (_e, build) => {
    const { generateChatLinkReport } = require("./buildChatLink.js");
    return generateChatLinkReport(build);
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
  // Importing into a team folder can only reuse builds that ALREADY live in
  // that same team. Pointing the comp at a build outside it would leave every
  // teammate with a comp referencing a build they cannot see — the exact thing
  // the "share the whole thing, not just the comp" rule below exists to avoid.
  async function reuseEligibility(destFolderId) {
    const teamRoot = await findTeamRoot(destFolderId);
    if (!teamRoot) return undefined;
    const folders = await folderStore.listFolders();
    return (build) => {
      if (!build.folderId) return false;
      const root = teamSync.teamRootFor(build.folderId, folders);
      return Boolean(root) && root.teamId === teamRoot.teamId;
    };
  }

  // A previewed import, waiting on the user to say what to do about the
  // duplicates it found. Held in memory rather than re-fetched on commit: the
  // local build ids are minted during the fetch, so a second fetch would mint
  // different ones and every id the preview just reported would be stale.
  const pendingAxiImports = new Map();
  const AXI_PREVIEW_TTL_MS = 10 * 60 * 1000;
  function stashAxiImport(entry) {
    const cutoff = Date.now() - AXI_PREVIEW_TTL_MS;
    for (const [key, held] of pendingAxiImports) {
      if (held.at < cutoff) pendingAxiImports.delete(key);
    }
    const token = require("node:crypto").randomUUID();
    pendingAxiImports.set(token, { ...entry, at: Date.now() });
    return token;
  }

  async function writeAxiImport({ imported, folderId, reuse }) {
    if (imported.kind === "comp") {
      // A comp arrives as a comp plus every build it references, so dropping it
      // loose into the current folder would scatter four or five builds among
      // whatever is already there. It gets its own folder, and `folderId` — the
      // folder the user was looking at — becomes that folder's PARENT.
      const { applyBuildReuse } = require("./buildDedupe.js");
      // Reused builds stay where they are — that is the whole point — so only
      // what is left after the rewrite lands in the comp's new folder.
      const { comp, builds, reused } = applyBuildReuse(imported, reuse);
      const folder = await folderStore.upsertFolder({ name: comp.name, parentId: folderId ?? null });
      const savedBuilds = [];
      for (const build of builds) savedBuilds.push(await store.upsertBuild({ ...build, folderId: folder.id }));
      const savedComp = await compStore.upsertComp({ ...comp, folderId: folder.id });

      // A reused build now belongs to one more comp. compIds is what tells the
      // library a build is in use, so without this the comp shows the build and
      // the build denies the comp.
      const savedReused = [];
      for (const build of reused) {
        const compIds = Array.isArray(build.compIds) ? build.compIds : [];
        savedReused.push(
          compIds.includes(savedComp.id)
            ? build
            : await store.upsertBuild({ ...build, compIds: [...compIds, savedComp.id] })
        );
      }

      // Importing into a team folder shares the whole thing, not just the comp —
      // teammates would otherwise see a comp whose builds do not exist for them.
      // Reused builds are already in the team (reuseEligibility saw to that), but
      // their compIds just changed, so they ride along too.
      const teamRoot = await findTeamRoot(folder.id);
      if (teamRoot) {
        await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, folder.id, "folder", "put"), { type: "folder", id: folder.id });
        for (const b of [...savedBuilds, ...savedReused]) {
          await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, b.id, "build", "put"), { type: "build", id: b.id });
        }
        await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, savedComp.id, "comp", "put"), { type: "comp", id: savedComp.id });
      }
      return { kind: "comp", comp: savedComp, builds: savedBuilds, reused: savedReused, folder };
    }

    // A build link that matched something you already have writes nothing: the
    // answer to "you already have this" is the copy you already have, not a
    // second one beside it.
    const existing = reuse?.get(imported.build.id);
    if (existing) return { ...existing, reusedExisting: true };

    const saved = await store.upsertBuild(imported.build);
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
    return saved;
  }

  /**
   * Look at a published link without writing anything, and report which of the
   * builds it carries are already in the library. The assembled records are held
   * under a token; `builds:commit-axi-import` finishes the job.
   */
  handle("builds:preview-axi-link", async (_e, link, name, folderId, gameMode) => {
    const { importAxiAny } = require("./axiLinkImport.js");
    const { planBuildReuse } = require("./buildDedupe.js");
    const imported = await importAxiAny(link, { name, folderId, gameMode });

    const incoming = imported.kind === "comp" ? imported.builds : [imported.build];
    const eligible = await reuseEligibility(folderId);
    const { reuse, duplicates } = planBuildReuse(incoming, await store.listBuilds(), { eligible });

    const token = stashAxiImport({ imported, folderId, reuse });
    return imported.kind === "comp"
      ? {
          kind: "comp",
          token,
          name: imported.comp.name,
          buildCount: imported.builds.length,
          duplicates,
        }
      : { kind: "build", token, name: imported.build.title, buildCount: 1, duplicates };
  });

  // `reuse: true` points the import at the builds the preview matched; false
  // imports its own copies of everything, which is what always used to happen.
  handle("builds:commit-axi-import", async (_e, token, opts = {}) => {
    const entry = pendingAxiImports.get(token);
    if (!entry) throw new Error("That import timed out — paste the link again.");
    pendingAxiImports.delete(token);
    return writeAxiImport({ ...entry, reuse: opts.reuse === true ? entry.reuse : null });
  });

  // Takes either kind of published link. A build returns the saved build, as it
  // always has; a comp returns { kind: "comp", ... } because it writes several
  // records at once and the caller needs all of them to refresh. No dedupe —
  // this is the one-shot path, for callers with nobody to ask.
  handle("builds:import-axi-link", async (_e, link, name, folderId, gameMode) => {
    const { importAxiAny } = require("./axiLinkImport.js");
    const imported = await importAxiAny(link, { name, folderId, gameMode });
    return writeAxiImport({ imported, folderId, reuse: null });
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

  function decodeCompCode(code) {
    const { decodeComp, isValidCompCode } = require("./compCodec.js");
    if (!isValidCompCode(code)) throw new Error("Invalid comp share code format");
    const decoded = decodeComp(code);
    if (!decoded) throw new Error("Failed to decode comp share code");
    return decoded;
  }

  // The published-link twin of builds:preview-axi-link, minus the token: a share
  // code decodes locally and deterministically, so the commit can just decode it
  // again rather than hold the result in memory.
  handle("comps:preview-share-code", async (_e, code) => {
    const { planBuildReuse } = require("./buildDedupe.js");
    const decoded = decodeCompCode(code);
    const { duplicates } = planBuildReuse(decoded.builds, await store.listBuilds(), {
      keyOf: (b) => b,
    });
    return { kind: "comp", name: decoded.name, buildCount: decoded.builds.length, duplicates };
  });

  handle("comps:import-share-code", async (_e, code, opts = {}) => {
    const decoded = decodeCompCode(code);

    // Create the comp first (without builds) so we have an ID for compId wiring
    const comp = await compStore.upsertComp({
      name: decoded.name,
      gameMode: decoded.gameMode,
      buildIds: [],
      partyLines: [],
    });

    // A build the library already has is pointed at rather than copied, when the
    // user said so (comps:preview-share-code is what they answered). Keyed by the
    // decoded object because a decoded build has no id yet.
    const { planBuildReuse } = require("./buildDedupe.js");
    const { reuse } = opts.reuse === true
      ? planBuildReuse(decoded.builds, await store.listBuilds(), { keyOf: (b) => b })
      : { reuse: new Map() };

    // Create new builds for each unique decoded build, wiring compIds immediately
    const newBuildIds = [];
    const buildRefToId = new Map();
    const reusedIds = new Set();
    for (const build of decoded.builds) {
      const match = reuse.get(build);
      const saved = match
        ? await store.upsertBuild({
            ...match,
            compIds: [...new Set([...(match.compIds || []), comp.id])],
          })
        : await store.upsertBuild({
            ...build,
            title: build.title || "Imported Build",
            compIds: [comp.id],
          });
      if (match) reusedIds.add(saved.id);
      // A build matched twice is one roster entry, not two — same collapse
      // applyBuildReuse makes on the published-link path.
      if (!newBuildIds.includes(saved.id)) newBuildIds.push(saved.id);
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
    const result = {
      compId: updated.id,
      reusedCount: reusedIds.size,
      newCount: newBuildIds.length - reusedIds.size,
    };
    if (decoded.failedBuildCount > 0) {
      result.warning = `${decoded.failedBuildCount} of ${decoded.failedBuildCount + decoded.builds.length} builds could not be decoded — they may require a newer version of AxiForge.`;
    }
    return result;
  });

  // A build as its published page carries it: catalog data the page needs and
  // the GW2 chat link, so the SPA makes no API calls.
  async function enrichBuildForPublish(build) {
    const [catalog, upgradeCatalog] = await Promise.all([
      getProfessionCatalog(build.profession, "en", build.gameMode || "pve"),
      getUpgradeCatalog("en"),
    ]);
    const extraCatalogs = await loadCrossProfessionCatalogs(build.notes, build.profession, getProfessionCatalog);
    const enriched = serializeForPublish(build, catalog, upgradeCatalog, extraCatalogs);
    try {
      const { generateChatLink } = require("./buildChatLink.js");
      enriched.chatLink = await generateChatLink(build);
    } catch {
      // Chat link unavailable — SPA will hide the build code widget
    }
    return enriched;
  }

  /**
   * Add a batch of this owner's old-format pages to a publish's bundle, re-encoded
   * in the current format under their existing ids and keys (formatMigration.js).
   * Never fails the publish: a page that can't be redone stays as it is, and
   * still opens. Returns what to stamp once the upload lands.
   */
  async function addFormatMigrations(bundle, owner, excludeIds) {
    const done = { builds: [], comps: [] };
    try {
      const [builds, comps] = await Promise.all([store.listBuilds(), compStore.listComps()]);
      const theme = await pageThemes((key) => store.getSetting(key));
      const plan = planFormatMigrations({
        builds, comps, owner, excludeIds,
        memberIdsOf: getCompPublishBuildIds,
        themeOf: theme.build,
      });
      for (const build of plan.builds) {
        try {
          // Titled the way publishBatch titles it, so an untitled build's page keeps its name.
          const enriched = await enrichBuildForPublish({ ...build, title: displayTitle(build) });
          const file = buildEncryptedBuildFile(enriched, build.publishedFileId, build.publishedKey);
          bundle[file.filePath] = file.content;
          done.builds.push(build);
        } catch (err) {
          console.warn("[publish] format migration skipped build", build.id, err?.message || err);
        }
      }
      for (const { comp, members } of plan.comps) {
        const file = buildEncryptedCompFile(serializeCompForPublish(comp, members), comp.publishedFileId, comp.publishedKey);
        bundle[file.filePath] = file.content;
        done.comps.push(comp);
      }
      if (done.builds.length || done.comps.length) {
        console.log("[publish] format migration:", { builds: done.builds.length, comps: done.comps.length });
      }
    } catch (err) {
      console.warn("[publish] format migration skipped:", err?.message || err);
    }
    return done;
  }

  // Stamp the pages addFormatMigrations redid, and share the stamp with each
  // record's team so teammates don't redo them. Only the format moves: the
  // content receipt was already current.
  async function stampFormatMigrations({ builds, comps }) {
    for (const build of builds) {
      try {
        const saved = await store.markPublished(build.id, {
          publishedFormat: formatStamp("build", build.publishedHash),
          snapshotUpdatedAt: build.publishedAt || build.updatedAt,
        });
        const root = saved && await findTeamRoot(saved.folderId);
        if (root) await safeEnqueue(() => teamSync.enqueue(root.teamId, saved.id, "build", "put"), { type: "build", id: saved.id });
      } catch (err) {
        console.warn("[publish] format stamp failed for build", build.id, err?.message || err);
      }
    }
    for (const comp of comps) {
      try {
        const saved = await compStore.markPublished(comp.id, {
          boonCoverageHtml: "",
          // The page now links its members' live pages, as compReceipt(comp, []) records.
          publishedMemberHashes: {},
          publishedFormat: formatStamp("comp", comp.publishedHash),
          snapshotUpdatedAt: comp.publishedAt || comp.updatedAt,
        });
        const root = saved && await findTeamRoot(saved.folderId);
        if (root) await safeEnqueue(() => teamSync.enqueue(root.teamId, saved.id, "comp", "put"), { type: "comp", id: saved.id });
      } catch (err) {
        console.warn("[publish] format stamp failed for comp", comp.id, err?.message || err);
      }
    }
  }

  // Explicit publishes (old IPC, local API, Copy link on a never-published
  // item) go through the queue too: same round, same receipts, same wait.
  const PUBLISH_FULL_WAIT_MS = 5 * 60 * 1000;
  // A share waits out a whole round: up to 50 items plus a batch of format
  // migrations, which takes well past 15 s right after an upgrade.
  const SHARE_PUBLISH_WAIT_MS = 60 * 1000;
  // A new item's /r/ page and a new site's viewer go live with the Pages
  // deploy, after the round: whoever hands those links out waits for them.
  const pagesLive = createPagesLive({ pollUrlLive, timeoutMs: PAGES_TIMEOUT_MS });
  const PAGES_NOT_LIVE = "Published, but the link isn't live yet. Try again in a minute.";
  // Copied text is handed out even if a page is still deploying: wait a little
  // for a new page, never the full deploy timeout (offline, every click would hang).
  const COPY_LIVE_WAIT_MS = 20 * 1000;

  async function findPublishRecord(kind, id) {
    const list = kind === "comp" ? await compStore.listComps() : await store.listBuilds();
    return list.find((r) => r.id === id) || null;
  }

  // An explicit publish lifts any pause: another item's broken setup must not
  // refuse this one. A still-broken item re-pauses the queue in that round.
  function publishAndWait(kind, id, timeoutMs = PUBLISH_FULL_WAIT_MS) {
    publishQueue.publishNow(kind, id, { unpause: true }).catch(() => {});
    return publishQueue.awaitPublished(kind, id, { timeoutMs });
  }

  async function publishViaQueue(kind, id, opts = {}) {
    if (!(await findPublishRecord(kind, id))) throw new Error(`${kind === "comp" ? "Comp" : "Build"} not found.`);
    if (opts.force) publishQueue.setChoice(kind, id, "mine");
    const result = await publishAndWait(kind, id);
    if (!result?.pagesUrl) throw new Error(`${kind === "comp" ? "Comp" : "Build"} not found.`);
    const { pagesUrl, slug, fileId, changed, skippedForeignBuilds } = result;
    return kind === "comp" ? { pagesUrl, slug, fileId, changed, skippedForeignBuilds } : { pagesUrl, slug, fileId, changed };
  }

  // The link a published record answers on. Owner from its receipt, theme the
  // way publishBatch writes it.
  async function publishedLinkFor(kind, record) {
    if (!record?.publishedFileId || !record?.publishedKey) return null;
    const auth = await getAuthRecord();
    const owner = publishedOwnerFor(record, auth?.onboarding?.targetOwner);
    if (!owner) return null;
    const themes = await pageThemes((key) => store.getSetting(key));
    const theme = kind === "comp" ? themes.comp : themes.build(record);
    return publishedPageUrl({ kind, owner, slug: record.publishedSlug || "", fileId: record.publishedFileId, key: record.publishedKey, theme, repo: TARGET_REPO });
  }

  // A save still on its way up is waited for, so sharing right after saving
  // shares the new version instead of refusing. Returns an error message or null.
  async function settlePendingPublish(kind, id) {
    const state = publishQueue.snapshot().items[`${kind}:${id}`]?.state;
    if (state !== "queued" && state !== "waiting" && state !== "publishing") return null;
    if (state !== "publishing") publishQueue.publishNow(kind, id).catch(() => {});
    try {
      await publishQueue.awaitPublished(kind, id, { timeoutMs: SHARE_PUBLISH_WAIT_MS });
      return null;
    } catch (err) {
      return err?.message || String(err);
    }
  }

  handle("builds:publish-build", (event, buildId, opts) => publishViaQueue("build", buildId, opts || {}));
  handle("comps:publish-comp", (event, compId, opts) => publishViaQueue("comp", compId, opts || {}));

  handle("publish:snapshot", async () => publishQueue.snapshot());
  handle("publish:retry", async (_e, kind, id) => {
    publishQueue.publishNow(kind, id).catch(() => {});
    return true;
  });
  handle("publish:set-choice", async (_e, kind, id, choice) => {
    publishQueue.setChoice(kind, id, choice);
    if (choice === "mine") publishQueue.publishNow(kind, id).catch(() => {});
    return true;
  });
  handle("publish:get-link", async (_e, kind, id) => {
    let record = await findPublishRecord(kind, id);
    if (!record) throw new Error(`${kind === "comp" ? "Comp" : "Build"} not found.`);
    if (!record.publishedFileId) {
      await publishAndWait(kind, id);
      record = await findPublishRecord(kind, id);
    }
    const link = await publishedLinkFor(kind, record);
    // The ?b= link opens on the site's viewer, which a brand-new site deploys after its first round.
    if (link && !(await pagesLive.waitLive([link.split("?")[0]]))) throw new Error(PAGES_NOT_LIVE);
    return link;
  });
  async function bulkCandidates() {
    const [builds, comps] = await Promise.all([store.listBuilds(), compStore.listComps()]);
    return bulkPublishCandidates({ builds, comps });
  }
  handle("publish:bulk-candidates", async () => (await bulkCandidates()).length);
  handle("publish:bulk-enqueue", async () => {
    const items = await bulkCandidates();
    publishQueue.enqueueMany(items);
    return items.length;
  });
  // Coming online passes keepUnauthorized: only signing in fixes bad credentials.
  handle("publish:resume", async (_e, opts) => {
    publishQueue.resume({ keepUnauthorized: Boolean(opts?.keepUnauthorized) }).catch(() => {});
    return true;
  });

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
  handle("settings:set", async (_e, key, value) => {
    const result = await store.setSetting(key, value);
    if (typeof key === "string" && key.startsWith("discord.")) recheckAccess();
    return result;
  });

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
    const compWaitError = await settlePendingPublish("comp", compId);
    if (compWaitError) return { success: false, error: compWaitError };
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
    const buildsById = new Map((await store.listBuilds()).map((b) => [b.id, annotateBuild(b)]));
    const compReject = shareRejectionReason(annotateComp(comp), "Comp", (id) => buildsById.get(id));
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

    if (!(await pagesLive.waitLive([compUrl, ...getCompPublishBuildIds(comp).map((id) => buildUrls[id])]))) {
      return { success: false, error: PAGES_NOT_LIVE };
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
    const buildWaitError = await settlePendingPublish("build", buildId);
    if (buildWaitError) return { success: false, error: buildWaitError };
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
    const buildReject = shareRejectionReason(annotateBuild(build), "Build");
    if (buildReject) return { success: false, error: buildReject };

    // 3. Resolve owner for URL construction
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    if (!owner) return { success: false, error: "GitHub publishing not configured" };
    const repo = auth?.onboarding?.repoName || TARGET_REPO;

    // 4. Build URL
    const buildUrl = shortUrl(publishedOwnerFor(build, owner), repo, build.publishedFileId);
    if (!(await pagesLive.waitLive([buildUrl]))) return { success: false, error: PAGES_NOT_LIVE };

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
    // The share gate lets this through while a save uploads: copy the new link.
    const waitError = await settlePendingPublish("build", buildId);
    if (waitError) throw new Error(waitError);

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
    // The text is handed out either way: a page still deploying opens shortly.
    await pagesLive.waitLive([buildUrl], { timeoutMs: COPY_LIVE_WAIT_MS });

    return formatBuildDiscordCopy(build, buildUrl);
  });

  handle("comps:generate-plaintext", async (_e, compId) => {
    const { getDisplayName, getDiscordEmoji, tagEmojiMention } = require("./discordEmoji");

    // The share gate lets this through while the comp or a member uploads:
    // wait for them, so the text links what was just saved.
    const pending = (await compStore.listComps()).find((c) => c.id === compId);
    const waitErrors = await Promise.all([
      settlePendingPublish("comp", compId),
      ...(pending ? getCompPublishBuildIds(pending) : []).map((id) => settlePendingPublish("build", id)),
    ]);
    const waitError = waitErrors.find(Boolean);
    if (waitError) throw new Error(waitError);

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
    // The text is handed out either way: a page still deploying opens shortly.
    await pagesLive.waitLive([compUrl, ...getCompPublishBuildIds(comp).map((id) => buildUrls[id])], { timeoutMs: COPY_LIVE_WAIT_MS });
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
          targetOwnerType: ownerType === "org" ? "org" : "user",
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

  // Selecting an owner in Settings must persist immediately. It used to only be
  // stored as a side effect of running setup, so picking the team org and
  // closing the dialog left targetOwner unset and every publish silently went to
  // the personal account.
  handle("onboarding:set-target-owner", async (_e, targetOwner, ownerType = "user") => {
    const session = await getSession();
    if (!session) throw new Error("Authenticate with GitHub before choosing a publish target.");
    const owner = targetOwner || session.viewer.login;
    const type = ownerType === "org" ? "org" : "user";

    // Readiness is per-owner, so it can't carry over from the previous target.
    // A repo that already exists means this owner is set up — checking costs one
    // call and keeps switching between configured owners seamless.
    let repoReady = false;
    try {
      await getRepo(session.token, owner, TARGET_REPO);
      repoReady = true;
    } catch {
      // 404 (or anything else) — treat as not set up and let the user run setup.
    }

    await patchAuthRecord({
      onboarding: {
        targetOwner: owner,
        targetOwnerType: type,
        repoReady,
        forkReady: repoReady,
        repoName: TARGET_REPO,
        // getOnboardingStatus probes this URL, so pagesReady self-heals for an
        // owner whose site is already live.
        pagesUrl: `https://${owner}.github.io/${TARGET_REPO}/`,
        pagesReady: false,
        pagesBuildStatus: null,
        pagesBuildError: null,
      },
    });
    return getOnboardingStatus();
  });

  // Finishing setup resumes anything saved while publishing wasn't connected.
  async function afterPublishSetup(result) {
    publishQueue.resume().catch(() => {});
    return result;
  }

  handle("onboarding:setup-repo-pages", async (_e, targetOwner, ownerType = "user") =>
    afterPublishSetup(await setupRepoPages(targetOwner, ownerType))
  );

  handle("onboarding:setup-fork-pages", async (_e, targetOwner, ownerType = "user") =>
    afterPublishSetup(await setupRepoPages(targetOwner, ownerType))
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
  // Where this team publishes. Owner-only (the server refuses anyone else), and
  // it reaches every member: a team's builds belong in the team's GitHub org, not
  // in whichever account the member who happened to hit Publish had configured.
  // `owner: null` clears it, putting the team back on each member's personal
  // target. @see src/main/publishTarget.js
  handle("teams:set-publish-owner", (_e, teamId, owner, ownerType) =>
    teamSync.setPublishOwner(teamId, owner, ownerType));
  handle("teams:members", (_e, teamId) => teamSync.listMembers(teamId));
  // Per-folder access. `teams:access` is the resolved answer for the CURRENT
  // user, folder id → level, so the renderer never has to walk the tree itself
  // and cannot drift from src/main/folderAccess.js.
  handle("teams:grants", (_e, teamId) => teamSync.listGrants(teamId));
  handle("teams:set-grant", (_e, teamId, folderId, userId, access) => teamSync.setGrant(teamId, folderId, userId, access));
  handle("teams:access", () => teamSync.accessMap());
  // Item id -> author user id, for the smart-folder ownership filters. Only the
  // creator's id, never the session token: this is the same identity the
  // renderer already holds for every team member.
  handle("teams:authors", () => teamSync.authorMap());
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
  // The shared trash. @see teamSync.listTeamTrash for why this is server-backed
  // rather than assembled from the local trash.
  handle("teams:trash", (_e, teamId) => teamSync.listTeamTrash(teamId));
  handle("teams:trash-restore", (_e, teamId, itemId) => teamSync.restoreFromTeamTrash(teamId, itemId));
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
      publishComp: (id) => asHttpResult(invokeLocal("comps:publish-comp", id)),
      shareCompToDiscord: (id, webhookIds) =>
        asHttpResult(invokeLocal("discord:share-comp", id, webhookIds), { badInput: true }),
      compPlaintext: (id) => asHttpResult(invokeLocal("comps:generate-plaintext", id)),
      importChatLink: (link, name, folderId, gameMode) =>
        asHttpResult(invokeLocal("builds:import-chat-link", link, name, folderId, gameMode), { badInput: true }),
      importGw2Skills: (url, name, folderId, gameMode) =>
        asHttpResult(invokeLocal("builds:import-gw2skills", url, name, folderId, gameMode), { badInput: true }),
      importAxiLink: (link, name, folderId, gameMode) =>
        asHttpResult(invokeLocal("builds:import-axi-link", link, name, folderId, gameMode), { badInput: true }),
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

// Saves still waiting to publish get one round (10 s at most) before the app
// exits. Anything unfinished stays in publish-queue.json for the next launch.
let publishFlushedForQuit = false;
app.on("before-quit", (event) => {
  if (publishFlushedForQuit || !publishQueueRef?.hasPending()) return;
  event.preventDefault();
  publishFlushedForQuit = true;
  publishQueueRef.flushForQuit().finally(() => app.quit());
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
  if (publishQueueRef) publishQueueRef.stop();
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
    if (accessBlocked) return;
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
