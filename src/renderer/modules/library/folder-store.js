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
 * The active library search, normalized -- "" when the box is empty.
 *
 * A query changes what "here" means: with the box empty you are browsing one
 * level of the tree, but the moment you type, the library searches the whole
 * subtree beneath you and draws the matches flat. Callers that scope by folder
 * must check this, or a build two folders down is unreachable by search.
 */
export function searchQuery() {
  return (state.buildSearch || "").trim().toLowerCase();
}

/** True when the library is showing search results rather than a folder level. */
export function hasSearchQuery() {
  return searchQuery() !== "";
}

/** Everything about a build the search box looks at. */
export function buildMatchesQuery(build, query) {
  if (!query) return true;
  const haystack = [
    build.title || "",
    build.profession || "",
    build.notes || "",
    ...(build.tags || []),
    ...((build.specializations || []).map((s) => s.name || "")),
    build.gameMode || "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/** Everything about a comp the search box looks at. */
export function compMatchesQuery(comp, query) {
  if (!query) return true;
  const haystack = [comp.name || "", ...(comp.tags || [])].join(" ").toLowerCase();
  return haystack.includes(query);
}

/** The folder itself plus every folder under it, as a Set of ids. */
export function folderSubtreeIds(folderId) {
  return new Set(collectFolderIds(folderId));
}

/**
 * Get builds for the current folder/filter context.
 * Applies smart folder filtering, custom folder filtering, search, and sort.
 */
export function getVisibleBuilds() {
  let builds = libraryBuilds();
  const query = searchQuery();

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
        // Searching reaches through sub-folders, so the scope is the whole
        // subtree rather than just the builds sitting at this level.
        const scope = query ? folderSubtreeIds(folder.id) : new Set([folder.id]);
        builds = builds.filter((b) => scope.has(b.folderId));
      } else if (folder.type === "all" && !query) {
        // "all" type: show only root-level builds at top level;
        // builds inside folders appear under their expanded folder rows
        builds = builds.filter((b) => !b.folderId);
      }
    }
  } else if (!query) {
    // Root: only show builds not in any folder. A search spans the library.
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
  if (query) builds = builds.filter((b) => buildMatchesQuery(b, query));

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
  const query = searchQuery();
  let folders;

  // At root or "all builds" smart folder: show top-level custom folders --
  // or every folder, when a search is flattening the tree.
  if (!folder || folder.type === "all") {
    folders = query
      ? libraryFolders()
      : libraryFolders().filter((f) => f.parentId === null);
  } else if (folder.type === "custom") {
    // Inside a custom folder: show its children, or its whole subtree when
    // searching.
    if (query) {
      const scope = folderSubtreeIds(folder.id);
      folders = libraryFolders().filter((f) => f.id !== folder.id && scope.has(f.id));
    } else {
      folders = libraryFolders().filter((f) => f.parentId === folder.id);
    }
  } else {
    // Smart folders don't contain sub-folders
    return [];
  }

  // A search flattens the tree, so a folder earns its row on its own name only.
  // It no longer stands in for the builds inside it -- those now surface as
  // results themselves, wherever they are nested.
  if (query) {
    return folders
      .filter((f) => (f.name || "").toLowerCase().includes(query))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  return folders.sort((a, b) => a.sortOrder - b.sortOrder);
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
  const query = searchQuery();
  let comps = libraryComps();

  if (folder) {
    if (folder.type === "custom") {
      // Searching reaches through sub-folders; browsing shows this level only.
      const scope = query ? folderSubtreeIds(folder.id) : new Set([folder.id]);
      comps = comps.filter((c) => scope.has(c.folderId));
    } else if (folder.id === "__all-comps") {
      // Show all comps — no filter
    } else if (folder.type === "all") {
      // "All Builds" view: show root-level comps (same as no folder), unless a
      // search is flattening the tree.
      if (!query) comps = comps.filter((c) => !c.folderId);
    } else {
      // Other smart folders (profession, gamemode, comp drilldown) don't show comps
      return [];
    }
  } else if (!query) {
    // Root: show comps with no folder. A search spans the library.
    comps = comps.filter((c) => !c.folderId);
  }

  // Apply search
  if (query) comps = comps.filter((c) => compMatchesQuery(c, query));

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
