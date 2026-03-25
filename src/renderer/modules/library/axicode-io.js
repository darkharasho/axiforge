// .axicode file export/import orchestration.
// Handles export collection (selection/visible gathering, dependency resolution)
// and import flow (conflict detection, dialog, applying resolutions).

import { state } from "../state.js";
import { getVisibleBuilds, getVisibleFolders, getVisibleComps } from "./folder-store.js";
import { getSelection, getCompSelection } from "./selection.js";
import { showImportConflictModal } from "../import-conflict-modal.js";
import { nextCopyTitle } from "./library.js";
import { pushUndo } from "./undo.js";

// ─── Export ──────────────────────────────────────────────────────────────────────

/**
 * Collect items for export based on current selection or visible items.
 * @param {"selection"|"visible"} mode
 * @returns {{ builds: Object[], folders: Object[], comps: Object[] }}
 */
export function collectExportData(mode) {
  if (mode === "selection") {
    return _collectFromSelection();
  }
  return _collectFromVisible();
}

function _collectFromVisible() {
  const builds = getVisibleBuilds();
  const folders = getVisibleFolders();
  const comps = getVisibleComps();

  // For visible comps, also pull in their referenced builds
  const buildIds = new Set(builds.map((b) => b.id));
  for (const comp of comps) {
    for (const id of (comp.buildIds || [])) {
      if (!buildIds.has(id)) {
        const b = state.builds.find((x) => x.id === id);
        if (b) {
          builds.push(b);
          buildIds.add(id);
        }
      }
    }
  }

  // For visible folders, also pull in their nested contents
  const folderIds = new Set(folders.map((f) => f.id));
  for (const folder of folders) {
    _collectFolderContents(folder.id, builds, folders, comps, buildIds, folderIds);
  }

  return { builds, folders, comps };
}

function _collectFromSelection() {
  const selectedBuildIds = getSelection();
  const selectedCompIds = getCompSelection();

  const builds = [];
  const folders = [];
  const comps = [];
  const buildIds = new Set();
  const folderIds = new Set();
  const compIds = new Set();

  // Add selected builds
  for (const id of selectedBuildIds) {
    const b = state.builds.find((x) => x.id === id);
    if (b && !buildIds.has(id)) {
      builds.push(b);
      buildIds.add(id);
    }
  }

  // Add selected comps + their builds
  for (const id of selectedCompIds) {
    const c = (state.comps || []).find((x) => x.id === id);
    if (c && !compIds.has(id)) {
      comps.push(c);
      compIds.add(id);
      for (const buildId of (c.buildIds || [])) {
        if (!buildIds.has(buildId)) {
          const b = state.builds.find((x) => x.id === buildId);
          if (b) {
            builds.push(b);
            buildIds.add(buildId);
          }
        }
      }
    }
  }

  return { builds, folders, comps };
}

/**
 * Export a specific folder and all its contents.
 * Called when right-clicking a folder → Export.
 * @param {string} folderId
 */
export function collectFolderExportData(folderId) {
  const builds = [];
  const folders = [];
  const comps = [];
  const buildIds = new Set();
  const folderIds = new Set();

  const folder = state.folders.find((f) => f.id === folderId);
  if (folder) {
    folders.push(folder);
    folderIds.add(folder.id);
    _collectFolderContents(folderId, builds, folders, comps, buildIds, folderIds);
  }

  // Also pull in builds referenced by comps
  for (const comp of comps) {
    for (const id of (comp.buildIds || [])) {
      if (!buildIds.has(id)) {
        const b = state.builds.find((x) => x.id === id);
        if (b) {
          builds.push(b);
          buildIds.add(id);
        }
      }
    }
  }

  return { builds, folders, comps };
}

function _collectFolderContents(folderId, builds, folders, comps, buildIds, folderIds) {
  // Add builds in this folder
  for (const b of state.builds) {
    if (b.folderId === folderId && !buildIds.has(b.id)) {
      builds.push(b);
      buildIds.add(b.id);
    }
  }

  // Add comps in this folder
  for (const c of (state.comps || [])) {
    if (c.folderId === folderId) {
      comps.push(c);
    }
  }

  // Recurse into sub-folders
  for (const f of state.folders) {
    if (f.parentId === folderId && !folderIds.has(f.id)) {
      folders.push(f);
      folderIds.add(f.id);
      _collectFolderContents(f.id, builds, folders, comps, buildIds, folderIds);
    }
  }
}

// ─── Import ──────────────────────────────────────────────────────────────────────

/**
 * Handle the full .axicode file import flow.
 * Opens file picker, parses, detects conflicts, shows dialog if needed, applies.
 * @param {string|null} targetFolderId - folder to import into (null = root)
 * @param {function} renderLibrary - callback to re-render the library
 * @param {function} showToast - callback to show toast notification
 */
export async function handleAxicodeImport(targetFolderId, renderLibrary, showToast) {
  const result = await window.desktopApi.importAxicodeFile();
  if (result.cancelled) return;
  if (result.error) {
    showToast(result.error, "error");
    return;
  }

  const { data } = result;
  const { builds: importBuilds, folders: importFolders, comps: importComps } = data;
  const totalCount = importBuilds.length + importFolders.length + importComps.length;

  if (totalCount === 0) {
    showToast("The .axicode file is empty.", "error");
    return;
  }

  // Detect conflicts (matching by ID)
  const conflicts = [];
  for (const b of importBuilds) {
    const existing = state.builds.find((x) => x.id === b.id);
    if (existing) conflicts.push({ type: "build", imported: b, existing });
  }
  for (const f of importFolders) {
    const existing = state.folders.find((x) => x.id === f.id);
    if (existing) conflicts.push({ type: "folder", imported: f, existing });
  }
  for (const c of importComps) {
    const existing = (state.comps || []).find((x) => x.id === c.id);
    if (existing) conflicts.push({ type: "comp", imported: c, existing });
  }

  // If conflicts, show resolution dialog
  let resolutions = null;
  if (conflicts.length > 0) {
    resolutions = await showImportConflictModal({ conflicts, totalCount });
    if (resolutions === null) return; // cancelled
  }

  // Apply import
  const undoActions = [];
  const existingBuildTitles = state.builds.map((b) => b.title || "");
  const existingFolderNames = state.folders.map((f) => f.name || "");
  const existingCompNames = (state.comps || []).map((c) => c.name || "");
  let importedCount = 0;

  // Import folders first (builds/comps reference them)
  for (const folder of importFolders) {
    const action = resolutions?.get(folder.id);
    if (action === "skip") continue;

    if (action === "replace") {
      const old = state.folders.find((f) => f.id === folder.id);
      if (old) undoActions.push({ type: "folder", action: "replace", old });
      await window.desktopApi.saveFolder(folder);
    } else if (action === "copy") {
      const copy = { ...folder, id: crypto.randomUUID(), name: nextCopyTitle(folder.name, existingFolderNames) };
      if (targetFolderId && !folder.parentId) copy.parentId = targetFolderId;
      existingFolderNames.push(copy.name);
      await window.desktopApi.saveFolder(copy);
      undoActions.push({ type: "folder", action: "create", id: copy.id });
    } else {
      // No conflict — import directly
      const toSave = { ...folder };
      if (targetFolderId && !folder.parentId) toSave.parentId = targetFolderId;
      await window.desktopApi.saveFolder(toSave);
      undoActions.push({ type: "folder", action: "create", id: toSave.id });
    }
    importedCount++;
  }

  // Import builds
  for (const build of importBuilds) {
    const action = resolutions?.get(build.id);
    if (action === "skip") continue;

    if (action === "replace") {
      const old = state.builds.find((b) => b.id === build.id);
      if (old) undoActions.push({ type: "build", action: "replace", old: { ...old } });
      await window.desktopApi.saveBuild(build);
    } else if (action === "copy") {
      const copy = { ...build, id: crypto.randomUUID(), title: nextCopyTitle(build.title, existingBuildTitles) };
      if (targetFolderId && !build.folderId && !build.compId) copy.folderId = targetFolderId;
      existingBuildTitles.push(copy.title);
      await window.desktopApi.saveBuild(copy);
      undoActions.push({ type: "build", action: "create", id: copy.id });
    } else {
      // No conflict
      const toSave = { ...build };
      if (targetFolderId && !build.folderId && !build.compId) toSave.folderId = targetFolderId;
      await window.desktopApi.saveBuild(toSave);
      undoActions.push({ type: "build", action: "create", id: toSave.id });
    }
    importedCount++;
  }

  // Import comps
  for (const comp of importComps) {
    const action = resolutions?.get(comp.id);
    if (action === "skip") continue;

    if (action === "replace") {
      const old = (state.comps || []).find((c) => c.id === comp.id);
      if (old) undoActions.push({ type: "comp", action: "replace", old: { ...old } });
      await window.desktopApi.saveComp(comp);
    } else if (action === "copy") {
      const copy = { ...comp, id: crypto.randomUUID(), name: nextCopyTitle(comp.name, existingCompNames) };
      if (targetFolderId && !comp.folderId) copy.folderId = targetFolderId;
      await window.desktopApi.saveComp(copy);
      undoActions.push({ type: "comp", action: "create", id: copy.id });
    } else {
      // No conflict
      const toSave = { ...comp };
      if (targetFolderId && !comp.folderId) toSave.folderId = targetFolderId;
      await window.desktopApi.saveComp(toSave);
      undoActions.push({ type: "comp", action: "create", id: toSave.id });
    }
    importedCount++;
  }

  // Push undo action
  pushUndo({
    type: "import-axicode",
    async undo() {
      for (const a of undoActions.reverse()) {
        if (a.action === "create") {
          if (a.type === "build") await window.desktopApi.deleteBuild(a.id);
          else if (a.type === "folder") await window.desktopApi.deleteFolder(a.id);
          else if (a.type === "comp") await window.desktopApi.deleteComp(a.id);
        } else if (a.action === "replace") {
          if (a.type === "build") await window.desktopApi.saveBuild(a.old);
          else if (a.type === "folder") await window.desktopApi.saveFolder(a.old);
          else if (a.type === "comp") await window.desktopApi.saveComp(a.old);
        }
      }
      state.builds = await window.desktopApi.listBuilds();
      state.folders = await window.desktopApi.listFolders();
      state.comps = await window.desktopApi.listComps();
      renderLibrary();
    },
  });

  // Reload state and render
  state.builds = await window.desktopApi.listBuilds();
  state.folders = await window.desktopApi.listFolders();
  state.comps = await window.desktopApi.listComps();
  renderLibrary();
  showToast(`Imported ${importedCount} item${importedCount !== 1 ? "s" : ""}`);
}

/**
 * Handle the .axicode file export flow.
 * @param {"selection"|"visible"} mode
 * @param {string|null} folderId - if exporting a specific folder
 * @param {function} showToast - callback to show toast notification
 */
export async function handleAxicodeExport(mode, folderId, showToast) {
  let data;
  if (folderId) {
    data = collectFolderExportData(folderId);
  } else {
    data = collectExportData(mode);
  }

  if (data.builds.length === 0 && data.folders.length === 0 && data.comps.length === 0) {
    showToast("Nothing to export.", "error");
    return;
  }

  const result = await window.desktopApi.exportAxicodeFile(data.builds, data.folders, data.comps);
  if (result.cancelled) return;
  if (result.success) {
    const total = data.builds.length + data.folders.length + data.comps.length;
    showToast(`Exported ${total} item${total !== 1 ? "s" : ""}`);
  }
}
