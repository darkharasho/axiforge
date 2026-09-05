// Single transient build persisted to localStorage. Folders/comps/history are
// empty in the playground's single-build scope; their methods exist only so the
// renderer never calls an undefined seam method.
const DRAFT_KEY = "axiforge.web.draft";
const DRAFT_ID = "web-draft";

function createDraftApi({ storage = window.localStorage } = {}) {
  function readDraft() {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return {
    listBuilds: async () => {
      const draft = readDraft();
      return draft ? [draft] : [];
    },
    saveBuild: async (build) => {
      const draft = { ...build, id: DRAFT_ID };
      storage.setItem(DRAFT_KEY, JSON.stringify(draft));
      return draft;
    },
    deleteBuild: async () => {
      storage.removeItem(DRAFT_KEY);
    },
    // The web build is a single draft, not a library, so there is nothing to
    // stage. These exist so the shared library code can call them unguarded.
    listTrash: async () => [],
    restoreFromTrash: async () => ({ builds: [], comps: [], folders: [] }),
    purgeFromTrash: async () => ({ builds: [], comps: [], folders: [] }),
    emptyTrash: async () => ({ builds: [], comps: [], folders: [] }),
    listArchive: async () => [],
    archiveBuilds: async () => [],
    archiveComps: async () => [],
    archiveFolder: async () => ({ builds: [], comps: [], folders: [] }),
    restoreFromArchive: async () => ({ builds: [], comps: [], folders: [] }),
    getBuildHistory: async () => [],
    getFolderHistory: async () => [],
    revertBuild: async () => null,
    listFolders: async () => [],
    saveFolder: async (folder) => folder,
    deleteFolder: async () => undefined,
    reorderFolders: async () => undefined,
    listComps: async () => [],
    saveComp: async (comp) => comp,
    deleteComp: async () => undefined,
    deleteComps: async () => undefined,
    reorderComps: async () => undefined,
    addTagsToComps: async () => undefined,
    removeTagsFromComps: async () => undefined,
    moveBuilds: async () => undefined,
    pinBuilds: async () => undefined,
    reorderBuilds: async () => undefined,
    listCompWebhooks: async () => [],
    listBuildWebhooks: async () => [],
  };
}

export { createDraftApi, DRAFT_KEY, DRAFT_ID };
