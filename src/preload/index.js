const { contextBridge, ipcRenderer } = require("electron");

// ipcRenderer.invoke rejects with "Error invoking remote method '<channel>':
// Error: <message>". Handlers word their errors for the user (the migration's
// rollback message tells them exactly what to do next), so strip the wrapper
// before the renderer ever sees it.
const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/;
function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    if (err && typeof err.message === "string") {
      const stripped = err.message.replace(REMOTE_PREFIX, "");
      if (stripped !== err.message) { try { err.message = stripped; } catch { /* frozen */ } }
    }
    throw err;
  });
}

contextBridge.exposeInMainWorld("desktopApi", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  isMaximizedWindow: () => ipcRenderer.invoke("window:is-maximized"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  openPreviewWindow: (url, opts) => ipcRenderer.invoke("window:open-preview", url, opts),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
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
  // Trash. Deletes above stage items here; these are the recovery side.
  listTrash: () => ipcRenderer.invoke("trash:list"),
  restoreFromTrash: (selection) => ipcRenderer.invoke("trash:restore", selection),
  purgeFromTrash: (selection) => ipcRenderer.invoke("trash:purge", selection),
  emptyTrash: () => ipcRenderer.invoke("trash:empty"),
  // Archive. Nothing here removes anything; it only moves items out of the
  // library view and back.
  listArchive: () => ipcRenderer.invoke("archive:list"),
  archiveBuilds: (ids) => ipcRenderer.invoke("archive:builds", ids),
  archiveComps: (ids) => ipcRenderer.invoke("archive:comps", ids),
  archiveFolder: (id) => ipcRenderer.invoke("archive:folder", id),
  restoreFromArchive: (selection) => ipcRenderer.invoke("archive:restore", selection),
  getBuildHistory: (buildId) => ipcRenderer.invoke("builds:get-history", buildId),
  getFolderHistory: (folderId) => ipcRenderer.invoke("folders:get-history", folderId),
  revertBuild: (buildId, historyEntryId) => ipcRenderer.invoke("builds:revert", buildId, historyEntryId),
  getCompHistory: (compId) => ipcRenderer.invoke("comps:get-history", compId),
  revertComp: (compId, historyEntryId) => ipcRenderer.invoke("comps:revert", compId, historyEntryId),
  publishSite: () => ipcRenderer.invoke("builds:publish-site"),
  publishBuild: (buildId, opts) => ipcRenderer.invoke("builds:publish-build", buildId, opts || {}),

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
  publishComp: (compId, html, opts) => ipcRenderer.invoke("comps:publish-comp", compId, html, opts || {}),
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
  importAxiLink: (link, name, folderId, gameMode) => ipcRenderer.invoke("builds:import-axi-link", link, name, folderId, gameMode),
  previewAxiLink: (link, name, folderId, gameMode) => ipcRenderer.invoke("builds:preview-axi-link", link, name, folderId, gameMode),
  commitAxiImport: (token, opts) => ipcRenderer.invoke("builds:commit-axi-import", token, opts),
  encodeShareCode: (build) => ipcRenderer.invoke("builds:encode-share-code", build),
  decodeShareCode: (code) => ipcRenderer.invoke("builds:decode-share-code", code),
  isShareCode: (text) => ipcRenderer.invoke("builds:is-share-code", text),
  encodeCompShareCode: (compId) => ipcRenderer.invoke("comps:encode-share-code", compId),
  previewCompShareCode: (code) => ipcRenderer.invoke("comps:preview-share-code", code),
  importCompShareCode: (code, opts) => ipcRenderer.invoke("comps:import-share-code", code, opts),
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
  shareCompToDiscord: (compId, webhookIds) => ipcRenderer.invoke("discord:share-comp", compId, webhookIds),
  listCompWebhooks: () => ipcRenderer.invoke("discord:list-comp-webhooks"),
  shareBuildToDiscord: (buildId, webhookIds) => ipcRenderer.invoke("discord:share-build", buildId, webhookIds),
  listBuildWebhooks: () => ipcRenderer.invoke("discord:list-build-webhooks"),
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
  onUpdateInstallError: (cb) => {
    ipcRenderer.removeAllListeners("update-install-error");
    ipcRenderer.on("update-install-error", (_e, info) => cb(info));
  },
  onDownloadProgress: (cb) => {
    ipcRenderer.removeAllListeners("download-progress");
    ipcRenderer.on("download-progress", (_e, info) => cb(info));
  },
  onPublishProgress: (cb) => {
    ipcRenderer.removeAllListeners("publish-progress");
    ipcRenderer.on("publish-progress", (_e, step) => cb(step));
  },
  // Teams (team sync)
  getTeamSession: () => invoke("teams:get-session"),
  enableTeamSync: () => invoke("teams:enable"),
  disableTeamSync: () => invoke("teams:disable"),
  listTeams: () => invoke("teams:list"),
  createTeam: (name) => invoke("teams:create", name),
  joinTeam: (code) => invoke("teams:join", code),
  leaveTeam: (teamId) => invoke("teams:leave", teamId),
  deleteTeam: (teamId) => invoke("teams:delete", teamId),
  renameTeam: (teamId, name) => invoke("teams:rename", teamId, name),
  listTeamMembers: (teamId) => invoke("teams:members", teamId),
  removeTeamMember: (teamId, userId) => invoke("teams:remove-member", teamId, userId),
  listTeamGrants: (teamId) => invoke("teams:grants", teamId),
  setTeamGrant: (teamId, folderId, userId, access) => invoke("teams:set-grant", teamId, folderId, userId, access),
  teamAccessMap: () => invoke("teams:access"),
  rotateInvite: (teamId) => invoke("teams:rotate-invite", teamId),
  shareFolderToTeam: (folderId, teamId) => invoke("teams:share-folder", folderId, teamId),
  stopSharingFolder: (folderId) => invoke("teams:stop-sharing", folderId),
  legacyLibraryStatus: () => invoke("teams:legacy-status"),
  migrateOrgLibrary: (opts) => invoke("teams:migrate-org-library", opts),
  pullTeam: (teamId) => invoke("teams:pull", teamId),
  listTeamTrash: (teamId) => invoke("teams:trash", teamId),
  restoreFromTeamTrash: (teamId, itemId) => invoke("teams:trash-restore", teamId, itemId),
  pullAllTeams: () => invoke("teams:pull-all"),
  resolveConflict: (teamId, itemId, choice) => invoke("teams:resolve-conflict", teamId, itemId, choice),
  listOutbox: () => invoke("teams:outbox"),
  onTeamShareProgress: (cb) => {
    ipcRenderer.removeAllListeners("team-share-progress");
    ipcRenderer.on("team-share-progress", (_e, p) => cb(p));
  },
  onSyncConflict: (cb) => {
    ipcRenderer.removeAllListeners("sync-conflict");
    ipcRenderer.on("sync-conflict", (_e, data) => cb(data));
  },
  onSyncStatus: (cb) => {
    ipcRenderer.removeAllListeners("sync-status");
    ipcRenderer.on("sync-status", (_e, status) => cb(status));
  },
});
