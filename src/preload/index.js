const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  isMaximizedWindow: () => ipcRenderer.invoke("window:is-maximized"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  openPreviewWindow: (url, opts) => ipcRenderer.invoke("window:open-preview", url, opts),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  beginLogin: () => ipcRenderer.invoke("auth:begin-login"),
  completeLogin: (beginData) => ipcRenderer.invoke("auth:complete-login", beginData),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getOnboardingStatus: () => ipcRenderer.invoke("onboarding:status"),
  listTargets: () => ipcRenderer.invoke("onboarding:list-targets"),
  setupRepoPages: (targetOwner, ownerType) =>
    ipcRenderer.invoke("onboarding:setup-repo-pages", targetOwner, ownerType),
  setupForkPages: (targetOwner, ownerType) =>
    ipcRenderer.invoke("onboarding:setup-fork-pages", targetOwner, ownerType),
  pollPagesStatus: () => ipcRenderer.invoke("onboarding:poll-pages-status"),
  listBuilds: () => ipcRenderer.invoke("builds:list"),
  saveBuild: (build) => ipcRenderer.invoke("builds:save", build),
  deleteBuild: (id) => ipcRenderer.invoke("builds:delete", id),
  getBuildHistory: (buildId) => ipcRenderer.invoke("builds:get-history", buildId),
  getFolderHistory: (folderId) => ipcRenderer.invoke("folders:get-history", folderId),
  revertBuild: (buildId, historyEntryId) => ipcRenderer.invoke("builds:revert", buildId, historyEntryId),
  publishSite: () => ipcRenderer.invoke("builds:publish-site"),
  publishBuild: (buildId) => ipcRenderer.invoke("builds:publish-build", buildId),

  // Folder operations
  listFolders: () => ipcRenderer.invoke("folders:list"),
  saveFolder: (folder) => ipcRenderer.invoke("folders:save", folder),
  deleteFolder: (id) => ipcRenderer.invoke("folders:delete", id),
  reorderFolders: (updates) =>
    ipcRenderer.invoke("folders:reorder", updates),

  // Comp operations
  listComps: () => ipcRenderer.invoke("comps:list"),
  saveComp: (comp) => ipcRenderer.invoke("comps:save", comp),
  deleteComp: (id) => ipcRenderer.invoke("comps:delete", id),
  reorderComps: (updates) => ipcRenderer.invoke("comps:reorder", updates),
  deleteComps: (ids) => ipcRenderer.invoke("comps:delete-batch", ids),
  addTagsToComps: (ids, tags) => ipcRenderer.invoke("comps:add-tags", ids, tags),
  removeTagsFromComps: (ids, tags) => ipcRenderer.invoke("comps:remove-tags", ids, tags),
  publishComp: (compId, boonCoverageHtml) => ipcRenderer.invoke("comps:publish-comp", compId, boonCoverageHtml),
  getCompPublishedUrl: (compId) => ipcRenderer.invoke("comps:get-published-url", compId),

  // Build library operations
  moveBuilds: (ids, folderId) =>
    ipcRenderer.invoke("builds:move", ids, folderId),
  pinBuilds: (ids, pinned) =>
    ipcRenderer.invoke("builds:pin", ids, pinned),
  reorderBuilds: (updates) =>
    ipcRenderer.invoke("builds:reorder", updates),
  generateChatLink: (build) => ipcRenderer.invoke("builds:generate-chat-link", build),
  prewarmChatLinks: (builds) => ipcRenderer.invoke("builds:prewarm-chat-links", builds),
  previewChatLink: (link) => ipcRenderer.invoke("builds:preview-chat-link", link),
  importChatLink: (link, name, folderId, gameMode) => ipcRenderer.invoke("builds:import-chat-link", link, name, folderId, gameMode),
  importGw2Skills: (url, name, folderId, gameMode) => ipcRenderer.invoke("builds:import-gw2skills", url, name, folderId, gameMode),
  encodeShareCode: (build) => ipcRenderer.invoke("builds:encode-share-code", build),
  decodeShareCode: (code) => ipcRenderer.invoke("builds:decode-share-code", code),
  isShareCode: (text) => ipcRenderer.invoke("builds:is-share-code", text),
  encodeCompShareCode: (compId) => ipcRenderer.invoke("comps:encode-share-code", compId),
  importCompShareCode: (code) => ipcRenderer.invoke("comps:import-share-code", code),
  // .axicode file export/import
  exportAxicodeFile: (builds, folders, comps) =>
    ipcRenderer.invoke("axicode-file:export", { builds, folders, comps }),
  importAxicodeFile: () => ipcRenderer.invoke("axicode-file:import"),
  listProfessions: () => ipcRenderer.invoke("gw2:list-professions"),
  getProfessionCatalog: (professionId, gameMode) =>
    ipcRenderer.invoke("gw2:get-profession-catalog", professionId, gameMode),
  getUpgradeCatalog: () => ipcRenderer.invoke("gw2:get-upgrade-catalog"),
  clearGw2Cache: () => ipcRenderer.invoke("gw2:clear-cache"),
  getWikiSummary: (title) => ipcRenderer.invoke("wiki:get-summary", title),
  getWikiRelatedData: (title) => ipcRenderer.invoke("wiki:get-related-data", title),
  resolveEntityFacts: (entityNames) =>
    ipcRenderer.invoke("wiki:resolve-entity-facts", entityNames),
  showError: (title, body) => ipcRenderer.invoke("dialog:error", title, body),
  getSetting: (key) => ipcRenderer.invoke("settings:get", key),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  shareCompToDiscord: (compId) => ipcRenderer.invoke("discord:share-comp", compId),
  shareBuildToDiscord: (buildId) => ipcRenderer.invoke("discord:share-build", buildId),
  getBuildDiscordCopyText: (buildId) => ipcRenderer.invoke("discord:build-copy-text", buildId),
  generateCompPlaintext: (compId) => ipcRenderer.invoke("comps:generate-plaintext", compId),
  getAppVersion: () => ipcRenderer.invoke("updater:get-version"),
  getWhatsNew: () => ipcRenderer.invoke("app:get-whats-new"),
  setLastSeenVersion: (version) => ipcRenderer.invoke("app:set-last-seen-version", version),
  checkForUpdates: () => ipcRenderer.send("updater:check"),
  restartApp: () => ipcRenderer.send("updater:restart"),
  onUpdateChecking: (cb) => {
    ipcRenderer.removeAllListeners("update-checking");
    ipcRenderer.on("update-checking", (_e, info) => cb(info));
  },
  onUpdateUnsupported: (cb) => {
    ipcRenderer.removeAllListeners("update-unsupported");
    ipcRenderer.on("update-unsupported", (_e, info) => cb(info));
  },
  onUpdateAvailable: (cb) => {
    ipcRenderer.removeAllListeners("update-available");
    ipcRenderer.on("update-available", (_e, info) => cb(info));
  },
  onUpdateNotAvailable: (cb) => {
    ipcRenderer.removeAllListeners("update-not-available");
    ipcRenderer.on("update-not-available", (_e, info) => cb(info));
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.removeAllListeners("update-downloaded");
    ipcRenderer.on("update-downloaded", (_e, info) => cb(info));
  },
  onUpdateError: (cb) => {
    ipcRenderer.removeAllListeners("update-error");
    ipcRenderer.on("update-error", (_e, info) => cb(info));
  },
  onDownloadProgress: (cb) => {
    ipcRenderer.removeAllListeners("download-progress");
    ipcRenderer.on("download-progress", (_e, info) => cb(info));
  },
  onPublishProgress: (cb) => {
    ipcRenderer.removeAllListeners("publish-progress");
    ipcRenderer.on("publish-progress", (_e, step) => cb(step));
  },
  // Shared Library
  listOrgs: () => ipcRenderer.invoke("shared-library:list-orgs"),
  setupSharedLibrary: (orgName) => ipcRenderer.invoke("shared-library:setup", orgName),
  shareFolder: (folderId) => ipcRenderer.invoke("shared-library:share-folder", folderId),
  unshareFolder: (folderId) => ipcRenderer.invoke("shared-library:unshare-folder", folderId),
  pullFolder: (folderId) => ipcRenderer.invoke("shared-library:pull-folder", folderId),
  pullAllShared: () => ipcRenderer.invoke("shared-library:pull-all"),
  connectSharedLibrary: () => ipcRenderer.invoke("shared-library:connect"),
  disconnectSharedLibrary: () => ipcRenderer.invoke("shared-library:disconnect"),
  getSharedLibraryConfig: () => ipcRenderer.invoke("shared-library:get-config"),
  forcePush: (type, item) => ipcRenderer.invoke("shared-library:force-push", type, item),
  onSyncConflict: (cb) => {
    ipcRenderer.removeAllListeners("sync-conflict");
    ipcRenderer.on("sync-conflict", (_e, data) => cb(data));
  },
  onSyncStatus: (cb) => {
    ipcRenderer.removeAllListeners("sync-status");
    ipcRenderer.on("sync-status", (_e, status) => cb(status));
  },
});
