const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  isMaximizedWindow: () => ipcRenderer.invoke("window:is-maximized"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  openPreviewWindow: (url) => ipcRenderer.invoke("window:open-preview", url),
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
  publishSite: () => ipcRenderer.invoke("builds:publish-site"),
  publishBuild: (buildId) => ipcRenderer.invoke("builds:publish-build", buildId),

  // Folder operations
  listFolders: () => ipcRenderer.invoke("folders:list"),
  saveFolder: (folder) => ipcRenderer.invoke("folders:save", folder),
  deleteFolder: (id) => ipcRenderer.invoke("folders:delete", id),
  reorderFolders: (updates) =>
    ipcRenderer.invoke("folders:reorder", updates),

  // Build library operations
  moveBuilds: (ids, folderId) =>
    ipcRenderer.invoke("builds:move", ids, folderId),
  pinBuilds: (ids, pinned) =>
    ipcRenderer.invoke("builds:pin", ids, pinned),
  reorderBuilds: (updates) =>
    ipcRenderer.invoke("builds:reorder", updates),
  listProfessions: () => ipcRenderer.invoke("gw2:list-professions"),
  getProfessionCatalog: (professionId, gameMode) =>
    ipcRenderer.invoke("gw2:get-profession-catalog", professionId, gameMode),
  getUpgradeCatalog: () => ipcRenderer.invoke("gw2:get-upgrade-catalog"),
  getWikiSummary: (title) => ipcRenderer.invoke("wiki:get-summary", title),
  getWikiRelatedData: (title) => ipcRenderer.invoke("wiki:get-related-data", title),
  showError: (title, body) => ipcRenderer.invoke("dialog:error", title, body),
  getSetting: (key) => ipcRenderer.invoke("settings:get", key),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  getAppVersion: () => ipcRenderer.invoke("updater:get-version"),
  checkForUpdates: () => ipcRenderer.send("updater:check"),
  restartApp: () => ipcRenderer.send("updater:restart"),
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
});
