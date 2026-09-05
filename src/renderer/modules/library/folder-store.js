import { state } from "../state.js";
import { teamRootFor } from "../teams.js";

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

/** Share a personal folder (and its subtree) to a team. */
export async function shareFolderToTeam(folderId, teamId) {
  const result = await window.desktopApi.shareFolderToTeam(folderId, teamId);
  await loadFolders();
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  return result; // { uploaded, failed }
}

/** Owner only: remove a sub-folder tree from its team; local copies stay. */
export async function stopSharingFolder(folderId) {
  await window.desktopApi.stopSharingFolder(folderId);
  await loadFolders();
}

/** Pull the latest for the team that contains folderId. */
export async function pullTeamFor(folderId) {
  const root = teamRootFor(folderId);
  if (root) await window.desktopApi.pullTeam(root.teamId);
  await loadFolders();
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
}

export async function reorderComps(updates) {
  await window.desktopApi.reorderComps(updates);
  state.comps = await window.desktopApi.listComps();
}

/**
 * Archived records are still live everywhere else in the app -- a comp resolves
 * an archived build, a published link still works, team sync still carries it.
 * The stamp means one thing: keep it out of the library. So `state.builds` and
 * friends stay complete and the browsing views read through these three instead.
 *
 * Anything that BROWSES the library (grids, trees, sidebar counts, search) must
 * go through here. Anything that RESOLVES a specific record by id -- the comp
 * editor looking up its slots, drag-drop, history -- must not, or an archived
 * build vanishes out of the middle of a comp you still use.
 */
export const isArchived = (record) => Boolean(record?.archivedAt);

/** The builds the library should draw right now. @see isArchived */
export function libraryBuilds() {
  return (state.builds || []).filter((b) => !b.archivedAt);
}

/** The comps the library should draw right now. @see isArchived */
export function libraryComps() {
  return (state.comps || []).filter((c) => !c.archivedAt);
}

/** The folders the library should draw right now. @see isArchived */
export function libraryFolders() {
  return (state.folders || []).filter((f) => !f.archivedAt);
}

/**
 * Get builds for the current folder/filter context.
 * Applies smart folder filtering, custom folder filtering, search, and sort.
 */
export function getVisibleBuilds() {
  let builds = libraryBuilds();

  // Filter by current folder
  const folder = state.currentFolder;
  if (folder) {
    if (folder.type === "comp") {
      // Inside a comp: show builds that belong to this comp
      const compBuildIds = new Set(
        (state.comps || []).find((c) => c.id === folder.id)?.buildIds || [],
      );
      builds = builds.filter((b) => compBuildIds.has(b.id));
    } else if (folder.id === "__all-comps") {
      // "All Comps" smart folder: no builds shown
      return [];
    } else if (folder.type === "smart-profession") {
      // Smart folders aggregate ALL matching builds, including those in comps
      builds = builds.filter((b) => b.profession === folder.id);
    } else if (folder.type === "smart-gamemode") {
      builds = builds.filter(
        (b) => (b.gameMode || "pve") === folder.id,
      );
    } else {
      if (folder.type === "custom") {
        builds = builds.filter((b) => b.folderId === folder.id);
      } else if (folder.type === "all") {
        // "all" type: show only root-level builds at top level;
        // builds inside folders appear under their expanded folder rows
        builds = builds.filter((b) => !b.folderId);
      }
    }
  } else {
    // Root: only show builds not in any folder
    builds = builds.filter((b) => !b.folderId);
  }

  // Apply filter dropdowns (multi-select arrays)
  const filters = state.libraryPrefs.activeFilters;
  if (filters.professions?.length > 0) {
    builds = builds.filter((b) => filters.professions.includes(b.profession));
  }
  if (filters.eliteSpecs?.length > 0) {
    builds = builds.filter((b) =>
      (b.specializations || []).some(
        (s) => s.elite && s.name && filters.eliteSpecs.includes(s.name),
      ),
    );
  }
  if (filters.gameModes?.length > 0) {
    builds = builds.filter(
      (b) => filters.gameModes.includes(b.gameMode || "pve"),
    );
  }
  if (filters.tags?.length > 0) {
    builds = builds.filter((b) =>
      filters.tags.some((t) => (b.tags || []).includes(t)),
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
  let folders;

  // At root or "all builds" smart folder: show top-level custom folders
  if (!folder || folder.type === "all") {
    folders = libraryFolders()
      .filter((f) => f.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  } else if (folder.type === "custom") {
    // Inside a custom folder: show its children
    folders = libraryFolders()
      .filter((f) => f.parentId === folder.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  } else {
    // Smart folders don't contain sub-folders
    return [];
  }

  // Filter folders by search query: hide folders whose name doesn't match
  // AND that contain no matching builds
  const query = (state.buildSearch || "").trim().toLowerCase();
  if (query) {
    folders = folders.filter((f) => {
      if (f.name.toLowerCase().includes(query)) return true;
      // Check if any builds in this folder (recursively) match the search
      const folderIds = collectFolderIds(f.id);
      return libraryBuilds().some((b) => {
        if (!folderIds.includes(b.folderId)) return false;
        const haystack = [b.title || "", b.profession || "", ...(b.tags || [])].join(" ").toLowerCase();
        return haystack.includes(query);
      });
    });
  }

  return folders;
}

/**
 * Count builds in a folder (including sub-folders recursively).
 */
export function countBuildsInFolder(folderId) {
  const allFolderIds = collectFolderIds(folderId);
  return libraryBuilds().filter((b) => allFolderIds.includes(b.folderId)).length;
}

/**
 * Get comps for the current folder/filter context.
 * Comps appear in "All Comps" smart folder, custom folders, or root.
 */
export function getVisibleComps() {
  const folder = state.currentFolder;
  let comps = libraryComps();

  if (folder) {
    if (folder.type === "custom") {
      comps = comps.filter((c) => c.folderId === folder.id);
    } else if (folder.id === "__all-comps") {
      // Show all comps — no filter
    } else if (folder.type === "all") {
      // "All Builds" view: show root-level comps (same as no folder)
      comps = comps.filter((c) => !c.folderId);
    } else {
      // Other smart folders (profession, gamemode, comp drilldown) don't show comps
      return [];
    }
  } else {
    // Root: show comps with no folder
    comps = comps.filter((c) => !c.folderId);
  }

  // Apply search
  const query = (state.buildSearch || "").trim().toLowerCase();
  if (query) {
    comps = comps.filter((c) => {
      const haystack = [c.name || "", ...(c.tags || [])].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  // Sort by sortOrder (or name as fallback)
  comps.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return comps;
}

function collectFolderIds(folderId) {
  const ids = [folderId];
  const children = state.folders.filter((f) => f.parentId === folderId);
  for (const child of children) {
    ids.push(...collectFolderIds(child.id));
  }
  return ids;
}
