// Desktop-only seam methods that have no meaning in the browser playground.
// Each returns a safe value and never throws, so the renderer boots and runs
// with publishing/auth/updater/sharing simply inert (their UI is hidden via CSS).
function createStubsApi() {
  const noop = async () => undefined;
  const onEvent = () => undefined; // event registrars are sync, return void

  return {
    // window chrome
    minimizeWindow: noop,
    toggleMaximizeWindow: noop,
    isMaximizedWindow: async () => false,
    closeWindow: noop,
    openPreviewWindow: noop,
    // auth
    getSession: async () => ({ signedIn: false }),
    beginLogin: () => {
      const p = Promise.reject(new Error("Sign-in is not available in the web playground."));
      p.catch(() => {}); // Suppress unhandled rejection for test
      return p;
    },
    completeLogin: noop,
    logout: noop,
    // onboarding / pages
    getOnboardingStatus: async () => ({ configured: false }),
    listTargets: async () => [],
    setupRepoPages: noop,
    setupForkPages: noop,
    pollPagesStatus: async () => ({ ready: false }),
    // publishing
    publishSite: noop,
    publishBuild: noop,
    publishComp: noop,
    getCompPublishedUrl: async () => null,
    // discord
    shareCompToDiscord: noop,
    shareBuildToDiscord: noop,
    getBuildDiscordCopyText: async () => "",
    generateCompPlaintext: async () => "",
    encodeCompShareCode: () => {
      const p = Promise.reject(new Error("Comp sharing is not available in the web playground."));
      p.catch(() => {}); // Suppress unhandled rejection for test
      return p;
    },
    importCompShareCode: () => {
      const p = Promise.reject(new Error("Comp import is not available in the web playground."));
      p.catch(() => {}); // Suppress unhandled rejection for test
      return p;
    },
    // teams (team sync)
    getTeamSession: async () => null,
    listTeams: async () => [],
    listOutbox: async () => ({}),
    pullAllTeams: noop,
    resolveConflict: noop,
    // updater + progress/sync events
    checkForUpdates: onEvent,
    restartApp: onEvent,
    onUpdateChecking: onEvent,
    onUpdateUnsupported: onEvent,
    onUpdateAvailable: onEvent,
    onUpdateNotAvailable: onEvent,
    onUpdateDownloaded: onEvent,
    onUpdateError: onEvent,
    onUpdateInstallError: onEvent,
    onDownloadProgress: onEvent,
    onPublishProgress: onEvent,
    onSyncStatus: onEvent,
    onSyncConflict: onEvent,
    // wiki deep-dive (facts are baked into catalogs; live lookups are off)
    getWikiSummary: async () => null,
    getWikiRelatedData: async () => null,
    resolveEntityFacts: async (names = []) => names.map(() => null),
    // misc
    getWhatsNew: async () => null,
    setLastSeenVersion: noop,
    prewarmChatLinks: noop,
    clearGw2Cache: noop, // real impl provided by catalog api; this is a fallback
    exportAxicodeFile: noop,
    importAxicodeFile: async () => null,
    getConfig: async () => ({ web: true }),
  };
}

export { createStubsApi };
