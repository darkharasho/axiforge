import { state } from "../state.js";

/** Load all folders from main process into state.folders. */
export async function loadFolders() {
  state.folders = await window.desktopApi.listFolders();
}

/** Create or update a folder. Returns the saved folder. */
export async function saveFolder(folder) {
  const saved = await window.desktopApi.saveFolder(folder);
  await loadFolders();
  return saved;
}

/** Delete a folder by ID. Builds in it move to root. */
export async function deleteFolder(id) {
  await window.desktopApi.deleteFolder(id);
  await loadFolders();
  // Reload builds too since their folderId may have changed
  state.builds = await window.desktopApi.listBuilds();
}

/** Reorder folders. updates: Array<{id, sortOrder}> */
export async function reorderFolders(updates) {
  await window.desktopApi.reorderFolders(updates);
  await loadFolders();
}

/** Move builds to a folder. ids: string[], folderId: string|null */
export async function moveBuilds(ids, folderId) {
  await window.desktopApi.moveBuilds(ids, folderId);
  state.builds = await window.desktopApi.listBuilds();
}

/** Pin or unpin builds. ids: string[], pinned: boolean */
export async function pinBuilds(ids, pinned) {
  await window.desktopApi.pinBuilds(ids, pinned);
  state.builds = await window.desktopApi.listBuilds();
}

/** Reorder builds. updates: Array<{id, sortOrder}> */
export async function reorderBuilds(updates) {
  await window.desktopApi.reorderBuilds(updates);
  state.builds = await window.desktopApi.listBuilds();
}

/**
 * Get builds for the current folder/filter context.
 * Applies smart folder filtering, custom folder filtering, search, and sort.
 */
export function getVisibleBuilds() {
  let builds = [...state.builds];

  // Filter by current folder
  const folder = state.currentFolder;
  if (folder) {
    if (folder.type === "custom") {
      builds = builds.filter((b) => b.folderId === folder.id);
    } else if (folder.type === "smart-profession") {
      builds = builds.filter((b) => b.profession === folder.id);
    } else if (folder.type === "smart-gamemode") {
      builds = builds.filter(
        (b) => (b.gameMode || "pve") === folder.id,
      );
    }
    // "all" type = no filtering (shows everything including in-folder builds)
  } else {
    // Root: only show builds not in any folder
    builds = builds.filter((b) => !b.folderId);
  }

  // Apply filter chips
  const filters = state.libraryPrefs.activeFilters;
  if (filters.profession) {
    builds = builds.filter((b) => b.profession === filters.profession);
  }
  if (filters.gameMode) {
    builds = builds.filter(
      (b) => (b.gameMode || "pve") === filters.gameMode,
    );
  }
  if (filters.eliteSpec) {
    builds = builds.filter((b) =>
      (b.specializations || []).some(
        (s) => s.elite && s.name === filters.eliteSpec,
      ),
    );
  }
  if (filters.tag) {
    builds = builds.filter((b) =>
      (b.tags || []).includes(filters.tag),
    );
  }

  // Apply search
  const query = (state.buildSearch || "").trim().toLowerCase();
  if (query) {
    builds = builds.filter((b) => {
      const haystack = [
        b.title || "",
        b.profession || "",
        b.notes || "",
        ...(b.tags || []),
        ...((b.specializations || []).map((s) => s.name || "")),
        b.gameMode || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  // Sort — pinned items always first
  const { sortField, sortDirection } = state.libraryPrefs;
  const dir = sortDirection === "asc" ? 1 : -1;

  builds.sort((a, b) => {
    // Pinned first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    let av = a[sortField] ?? "";
    let bv = b[sortField] ?? "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  return builds;
}

/**
 * Get sub-folders for the current navigation context.
 */
export function getVisibleFolders() {
  const folder = state.currentFolder;
  // At root or "all builds" smart folder: show top-level custom folders
  if (!folder || folder.type === "all") {
    return state.folders
      .filter((f) => f.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  // Inside a custom folder: show its children
  if (folder.type === "custom") {
    return state.folders
      .filter((f) => f.parentId === folder.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  // Smart folders don't contain sub-folders
  return [];
}

/**
 * Count builds in a folder (including sub-folders recursively).
 */
export function countBuildsInFolder(folderId) {
  const allFolderIds = collectFolderIds(folderId);
  return state.builds.filter((b) => allFolderIds.includes(b.folderId)).length;
}

function collectFolderIds(folderId) {
  const ids = [folderId];
  const children = state.folders.filter((f) => f.parentId === folderId);
  for (const child of children) {
    ids.push(...collectFolderIds(child.id));
  }
  return ids;
}
