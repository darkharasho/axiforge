const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { app, BrowserWindow, ipcMain, dialog, clipboard } = require("electron");
const { BuildStore } = require("./buildStore");
const { FolderStore } = require("./folderStore");
const { CompStore } = require("./compStore");
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
const { getProfessionList, getProfessionCatalog, getUpgradeCatalog, getWikiSummary, getWikiRelatedData } = require("./gw2Data");
const { slugifyBuildName, generateFileId, generateEncryptionKey, getDefaultBuildName } = require("./buildEncryption");
const { buildSpaBundle, buildEncryptedBuildFile, buildEncryptedCompFile, buildRedirectFile } = require("./siteBundle");
const { serializeForPublish } = require("./buildPublish");
const { serializeCompForPublish } = require("./compPublish");
const { initAutoUpdate } = require("./autoUpdate");

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";
const IS_DEV_PROFILE = process.env.APP_PROFILE === "dev" && !app.isPackaged;
if (IS_DEV_PROFILE) {
  const devUserData = path.join(app.getPath("appData"), `${app.getName()}-dev`);
  app.setPath("userData", devUserData);
}

const dataDir = path.join(app.getPath("userData"), "data");
const store = new BuildStore(dataDir);
const folderStore = new FolderStore(dataDir);
const compStore = new CompStore(dataDir);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1120,
    minHeight: 740,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    backgroundColor: "#050910",
    icon: path.join(__dirname, "../../public/img/build_logo.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: path.join(__dirname, "../preload/index.js"),
    },
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
    // Vite HMR reloads cause Electron to steal focus. Before each reload, make the
    // window non-focusable so the OS never hands it focus; restore after load finishes.
    let wasFocused = false;
    win.webContents.on("did-start-loading", () => {
      wasFocused = win.isFocused();
      if (!wasFocused) win.setFocusable(false);
    });
    win.webContents.on("did-finish-load", () => {
      if (!wasFocused) win.setFocusable(true);
    });
  } else {
    const rendererPath = app.isPackaged
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
  await folderStore.init();
  await compStore.init();
  await migrateCompGameModes(store, compStore);
  const win = createWindow();
  initAutoUpdate(win);

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

  // Check for new GW2 balance patches and update splits.json in the background.
  (async () => {
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const { main: crawlPatches } = require("../../lib/gw2-balance-splits/scripts/crawl-patches");
      await crawlPatches();
    } catch {
      // Non-fatal — app works without latest splits
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

  ipcMain.handle("window:open-preview", (_event, url) => {
    const preview = new BrowserWindow({
      width: 1600,
      height: 980,
      minWidth: 1120,
      minHeight: 740,
      backgroundColor: "#050910",
      icon: path.join(__dirname, "../../public/img/build_logo.png"),
      title: "AxiForge — Local Preview",
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
    const saved = await store.upsertBuild(build);
    // Touch the folder this build belongs to
    if (saved.folderId) {
      await folderStore.touchFolders([saved.folderId]);
    }
    return saved;
  });
  ipcMain.handle("builds:delete", async (_e, id) => {
    // Check which folder this build is in before deleting
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === id);
    const folderId = build?.folderId;
    await store.deleteBuild(id);
    await compStore.removeBuildFromComps(id);
    if (folderId) {
      await folderStore.touchFolders([folderId]);
    }
    return true;
  });

  // Folder CRUD
  ipcMain.handle("folders:list", () => folderStore.listFolders());
  ipcMain.handle("folders:save", (_e, folder) =>
    folderStore.upsertFolder(folder),
  );
  ipcMain.handle("folders:delete", async (_e, id) => {
    const deletedIds = await folderStore.deleteFolder(id);
    if (deletedIds.length) {
      await store.clearFolderFromBuilds(deletedIds);
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
    await store.moveBuilds(ids, folderId);
    // Touch source and destination folders
    const touchIds = [...sourceFolderIds];
    if (folderId) touchIds.push(folderId);
    if (touchIds.length) await folderStore.touchFolders([...new Set(touchIds)]);
  });
  ipcMain.handle("builds:pin", (_e, ids, pinned) =>
    store.pinBuilds(ids, pinned),
  );
  ipcMain.handle("builds:reorder", (_e, updates) =>
    store.reorderBuilds(updates),
  );

  // Comp CRUD
  ipcMain.handle("comps:list", () => compStore.listComps());
  ipcMain.handle("comps:save", (_e, comp) => compStore.upsertComp(comp));
  ipcMain.handle("comps:delete", (_e, id) => compStore.deleteComp(id));
  ipcMain.handle("comps:reorder", (_e, updates) => compStore.reorderComps(updates));

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
    const { encodeShareCode } = require("@mks.haro/axicode");
    return encodeShareCode(build);
  });
  ipcMain.handle("builds:decode-share-code", async (_e, code) => {
    const { decodeShareCode } = require("@mks.haro/axicode");
    return decodeShareCode(code);
  });
  ipcMain.handle("builds:is-share-code", async (_e, text) => {
    const { isValidShareCode } = require("@mks.haro/axicode");
    return isValidShareCode(text);
  });

  ipcMain.handle("builds:publish-build", async (event, buildId) => {
    const sender = event.sender;
    const progress = (step) => sender.send("publish-progress", step);

    const session = await getSession();
    if (!session) {
      throw new Error("You must log in with GitHub before publishing.");
    }

    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    const owner = auth?.onboarding?.targetOwner || session.viewer.login;

    // Load the build
    progress("loading");
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === buildId);
    if (!build) throw new Error("Build not found.");

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
    await ensureAxiForgeRepo(session.token, owner, "user");
    await ensurePagesWorkflow(session.token, owner, branch, TARGET_REPO);
    await ensurePages(session.token, owner, branch, TARGET_REPO);

    // Build combined bundle: SPA files + encrypted build in one commit.
    // publishSiteBundle compares SHA hashes and skips unchanged files,
    // so SPA files are effectively a no-op after the first publish.
    progress("site");
    const spaBundle = buildSpaBundle();

    // Enrich build data for the SPA
    progress("encrypt");
    let enrichedBuild = build;
    try {
      const [catalog, upgradeCatalog] = await Promise.all([
        getProfessionCatalog(build.profession, "en"),
        getUpgradeCatalog("en"),
      ]);
      enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog);
    } catch {
      // Fall back to un-enriched build if catalog unavailable
    }
    const encFile = buildEncryptedBuildFile(enrichedBuild, fileId, encKey);

    // Merge SPA bundle + encrypted build + redirect into a single commit
    const redirectFile = buildRedirectFile(fileId, encKey, "b");
    const combinedBundle = { ...spaBundle, [encFile.filePath]: encFile.content, [redirectFile.filePath]: redirectFile.content };

    progress("upload");
    await publishSiteBundle(session.token, owner, combinedBundle, branch, TARGET_REPO);

    // Trigger Pages rebuild
    progress("deploy");
    await triggerPagesWorkflow(session.token, owner, branch, TARGET_REPO).catch(() => null);

    // Update build with publish metadata
    await store.upsertBuild({
      ...build,
      publishedSlug: newSlug,
      publishedFileId: fileId,
      publishedKey: encKey,
    });

    const pagesUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(newSlug)}&b=${fileId}.${encKey}`;

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
  });

  ipcMain.handle("comps:publish-comp", async (event, compId, boonCoverageHtml) => {
    const sender = event.sender;
    const progress = (step) => sender.send("publish-progress", step);

    const session = await getSession();
    if (!session) throw new Error("You must log in with GitHub before publishing.");

    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    const owner = auth?.onboarding?.targetOwner || session.viewer.login;

    // ── 1. Load comp + its builds ──────────────────────────────────────
    progress("loading");
    const allComps = await compStore.listComps();
    const comp = allComps.find((c) => c.id === compId);
    if (!comp) throw new Error("Comp not found.");

    if (!comp.name?.trim() || comp.name === "Untitled Comp") {
      throw new Error("Comp name is required for publishing.");
    }

    const allBuilds = await store.listBuilds();
    const compBuilds = allBuilds.filter((b) => b.compId === compId);

    // ── 2. Ensure repo infrastructure ─────────────────────────────────
    progress("repo");
    await ensureAxiForgeRepo(session.token, owner, "user");
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

      // Enrich build (with fallback)
      let enrichedBuild = build;
      try {
        const [catalog, upgradeCatalog] = await Promise.all([
          getProfessionCatalog(build.profession, "en"),
          getUpgradeCatalog("en"),
        ]);
        enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog);
      } catch {
        // Catalog unavailable — use unenriched build
      }

      const fileId = build.publishedFileId || generateFileId();
      const encKey = build.publishedKey || generateEncryptionKey();
      const slug = build.publishedSlug || slugifyBuildName(build.title);
      const spaUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(slug)}&b=${fileId}.${encKey}`;

      if (!build.publishedFileId) {
        const encFile = buildEncryptedBuildFile(enrichedBuild, fileId, encKey);
        spaBundle[encFile.filePath] = encFile.content;
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
    for (const updatedBuild of updatedBuildRecords) {
      await store.upsertBuild(updatedBuild);
    }

    const compPagesUrl = `https://${owner}.github.io/${TARGET_REPO}/?n=${encodeURIComponent(compSlug)}&c=${compFileId}.${compEncKey}`;



    await compStore.upsertComp({
      ...comp,
      publishedFileId: compFileId,
      publishedKey: compEncKey,
      publishedSlug: compSlug,
    });

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

    return { pagesUrl: compPagesUrl, slug: compSlug, fileId: compFileId, changed: true };
  });

  ipcMain.handle("gw2:list-professions", async () => getProfessionList("en"));
  ipcMain.handle("gw2:get-profession-catalog", async (_e, professionId, gameMode) =>
    getProfessionCatalog(professionId, "en", gameMode)
  );
  ipcMain.handle("gw2:get-upgrade-catalog", async () => getUpgradeCatalog("en"));
  ipcMain.handle("wiki:get-summary", async (_e, title) => getWikiSummary(title));
  ipcMain.handle("wiki:get-related-data", async (_e, title) => getWikiRelatedData(title));
  ipcMain.handle("settings:get", async (_e, key) => store.getSetting(key));
  ipcMain.handle("settings:set", async (_e, key, value) => store.setSetting(key, value));

  ipcMain.handle("discord:share-comp", async (_e, compId) => {
    const { shareCompToDiscord } = require("./discordWebhook");

    // 1. Load webhook URL
    const webhookUrl = await store.getSetting("discord.webhookUrl");
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
    return shareCompToDiscord(comp, buildsMap, compUrl, buildUrls, webhookUrl);
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
