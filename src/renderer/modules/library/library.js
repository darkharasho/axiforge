// Library orchestrator — wires all library sub-modules together.
// This is the main entry point for the library page.

import { state } from "../state.js";

import {
  loadFolders,
  saveFolder,
  deleteFolder,
  moveBuilds,
  pinBuilds,
} from "./folder-store.js";

import { showConfirmModal } from "../confirm-modal.js";
import { initToolbar, renderToolbar, renderFilters } from "./toolbar.js";
import { initSidebar, renderSidebar } from "./sidebar.js";
import { initContent, renderContent } from "./content.js";
import { initContextMenu, wireContextMenuEvents, closeMenu } from "./context-menu.js";
import {
  getSelection,
  clearSelection,
  selectAll,
  navigateSelection,
  wireSelectionEvents,
} from "./selection.js";
import { initDragDrop, wireDragDropEvents } from "./drag-drop.js";

// ─── App-level callbacks (injected at init) ────────────────────────────────────

let _app = {};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize all library sub-modules.
 * Called once at app startup.
 *
 * @param {{
 *   navigateToPage: function,
 *   loadBuildIntoEditor: function,
 *   startNewBuild: function,
 *   confirmDiscardDirty: function,
 *   saveCurrentBuild: function,
 *   duplicateCurrentBuild: function,
 *   copyBuildJsonToClipboard: function,
 *   importBuildJsonFromClipboard: function,
 *   render: function
 * }} appCallbacks
 */
export async function initLibrary(appCallbacks) {
  _app = appCallbacks || {};

  try {
    await loadFolders();
    await loadPrefs();
  } catch (err) {
    console.warn("[library] init data load failed:", err);
  }

  const shared = _buildSharedCallbacks();

  initToolbar(shared);
  initSidebar(shared);
  initContent(shared);
  initContextMenu(shared);
  initDragDrop(shared);
}

/**
 * Render all library sub-views.
 * Call when navigating to the library page or when data changes.
 */
export function renderLibrary() {
  renderSidebar();
  renderToolbar();
  renderFilters();
  renderContent();
  wireSelectionEvents();
  wireContextMenuEvents();
  wireDragDropEvents();
}

/**
 * Handle keyboard shortcuts when the library page is active.
 * @param {KeyboardEvent} e
 */
export function handleLibraryKeydown(e) {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  const ctrl = e.ctrlKey || e.metaKey;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      navigateSelection("down");
      break;

    case "ArrowUp":
      e.preventDefault();
      navigateSelection("up");
      break;

    case "Enter": {
      const sel = getSelection();
      if (sel.length > 0) {
        e.preventDefault();
        handleLoadBuild(sel[0]);
      }
      break;
    }

    case "F2": {
      const sel = getSelection();
      if (sel.length > 0) {
        e.preventDefault();
        handleRename(sel[0]);
      }
      break;
    }

    case "Delete": {
      const sel = getSelection();
      if (sel.length > 0) {
        e.preventDefault();
        handleDelete(sel);
      }
      break;
    }

    case "Escape":
      e.preventDefault();
      clearSelection();
      closeMenu();
      break;

    case "a":
    case "A":
      if (ctrl) {
        e.preventDefault();
        selectAll();
      }
      break;

    case "d":
    case "D":
      if (ctrl) {
        const sel = getSelection();
        if (sel.length > 0) {
          e.preventDefault();
          handleDuplicate(sel[0]);
        }
      }
      break;

    case "n":
    case "N":
      if (ctrl) {
        e.preventDefault();
        handleNewBuild();
      }
      break;

    case "c":
    case "C":
      if (ctrl) {
        const sel = getSelection();
        if (sel.length > 0) {
          e.preventDefault();
          handleCopyJson(sel);
        }
      }
      break;

    case "v":
    case "V":
      if (ctrl) {
        e.preventDefault();
        handlePasteJson();
      }
      break;
  }
}

// ─── Action handlers ───────────────────────────────────────────────────────────

function handleNewBuild() {
  if (!_app.confirmDiscardDirty?.("Start a new build")) return;
  _app.startNewBuild?.();
  _app.navigateToPage?.("editor");
}

async function handleNewFolder() {
  const name = await showPrompt("New folder name");
  if (!name) return;
  await saveFolder({ name, parentId: null });
  renderLibrary();
}

function handleLoadBuild(buildId) {
  if (!_app.confirmDiscardDirty?.("Load another build")) return;
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  _app.loadBuildIntoEditor?.(build);
  _app.navigateToPage?.("editor");
}

async function handleRename(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const newTitle = await showPrompt("Rename build", build.title || "");
  if (!newTitle) return;
  await window.desktopApi.saveBuild({ ...build, title: newTitle });
  state.builds = await window.desktopApi.listBuilds();
  renderLibrary();
}

async function handleDuplicate(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const copy = { ...build };
  delete copy.id;
  copy.title = `${build.title || "Untitled"} (Copy)`;
  await window.desktopApi.saveBuild(copy);
  state.builds = await window.desktopApi.listBuilds();
  renderLibrary();
}

async function handleTogglePin(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  await pinBuilds([buildId], !build.pinned);
  renderLibrary();
}

async function handlePinAll(ids) {
  await pinBuilds(ids, true);
  renderLibrary();
}

async function handleMoveTo(ids, folderId) {
  await moveBuilds(ids, folderId);
  renderLibrary();
}

async function handleDelete(ids) {
  const count = ids.length;
  const label = count === 1 ? "this build" : `${count} builds`;
  const confirmed = await showConfirm(`Delete ${label}?`, "This cannot be undone.");
  if (!confirmed) return;
  for (const id of ids) {
    await window.desktopApi.deleteBuild(id);
  }
  state.builds = await window.desktopApi.listBuilds();
  clearSelection();
  renderLibrary();
}

async function handleCopyJson(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  const builds = ids
    .map((id) => state.builds.find((b) => b.id === id))
    .filter(Boolean);
  if (builds.length === 0) return;
  const json = JSON.stringify(builds.length === 1 ? builds[0] : builds, null, 2);
  await window.desktopApi.writeClipboardText(json);
}

function handlePasteJson() {
  _app.importBuildJsonFromClipboard?.();
}

function handlePublish(buildId) {
  // Load the build into the editor and navigate there — publish from editor
  handleLoadBuild(buildId);
}

function handleBuildInfo(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const title = build.title || "Untitled";
  const prof = build.profession || "—";
  const created = build.createdAt ? new Date(build.createdAt).toLocaleString() : "—";
  const updated = build.updatedAt ? new Date(build.updatedAt).toLocaleString() : "—";
  const tags = (build.tags || []).join(", ") || "—";
  await showConfirm("Build Info", `
    <div style="line-height:1.8">
      <strong>Title:</strong> ${title}<br>
      <strong>Profession:</strong> ${prof}<br>
      <strong>Created:</strong> ${created}<br>
      <strong>Modified:</strong> ${updated}<br>
      <strong>Tags:</strong> ${tags}
    </div>
  `);
}

async function handleEditTags(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  const firstBuild = state.builds.find((b) => b.id === ids[0]);
  const currentTags = (firstBuild?.tags || []).join(", ");
  const input = await showPrompt("Tags (comma-separated)", currentTags);
  if (input === null) return;
  const tags = input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  for (const id of ids) {
    const build = state.builds.find((b) => b.id === id);
    if (!build) continue;
    await window.desktopApi.saveBuild({ ...build, tags });
  }
  state.builds = await window.desktopApi.listBuilds();
  renderLibrary();
}

function handleOpenFolder(folderId) {
  state.currentFolder = { type: "custom", id: folderId };
  renderLibrary();
}

async function handleRenameFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const newName = await showPrompt("Rename folder", folder.name || "");
  if (!newName) return;
  await saveFolder({ ...folder, name: newName });
  renderLibrary();
}

async function handleNewSubfolder(parentId) {
  const name = await showPrompt("New sub-folder name");
  if (!name) return;
  await saveFolder({ name, parentId });
  renderLibrary();
}

function handleNewBuildInFolder(folderId) {
  if (!_app.confirmDiscardDirty?.("Start a new build")) return;
  _app.startNewBuild?.();
  // Set the folder on the editor so the build is saved into this folder
  if (state.editor) {
    state.editor.folderId = folderId;
  }
  _app.navigateToPage?.("editor");
}

async function handleDeleteFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  const name = folder?.name || "this folder";
  const confirmed = await showConfirm(
    `Delete folder "${name}"?`,
    "Builds inside will be moved to the root.",
  );
  if (!confirmed) return;
  await deleteFolder(folderId);
  // If we're currently viewing the deleted folder, go back to root
  if (state.currentFolder?.id === folderId) {
    state.currentFolder = null;
  }
  renderLibrary();
}

async function handleNewFolderAndMove(buildIds) {
  const name = await showPrompt("New folder name");
  if (!name) return;
  const folder = await saveFolder({ name, parentId: null });
  if (!folder?.id) return;
  await moveBuilds(buildIds, folder.id);
  renderLibrary();
}

// ─── Preferences ──────────────────────────────────────────────────────────────

async function loadPrefs() {
  try {
    const viewMode = await window.desktopApi.getSetting("library.viewMode");
    const sortField = await window.desktopApi.getSetting("library.sortField");
    const sortDirection = await window.desktopApi.getSetting("library.sortDirection");
    const sidebarOpen = await window.desktopApi.getSetting("library.sidebarOpen");
    const sidebarExpandedFolders = await window.desktopApi.getSetting("library.sidebarExpandedFolders");
    const activeFilters = await window.desktopApi.getSetting("library.activeFilters");

    if (viewMode != null) state.libraryPrefs.viewMode = viewMode;
    if (sortField != null) state.libraryPrefs.sortField = sortField;
    if (sortDirection != null) state.libraryPrefs.sortDirection = sortDirection;
    if (sidebarOpen != null) state.libraryPrefs.sidebarOpen = sidebarOpen;
    if (Array.isArray(sidebarExpandedFolders)) state.libraryPrefs.sidebarExpandedFolders = sidebarExpandedFolders;
    if (activeFilters != null && typeof activeFilters === "object") state.libraryPrefs.activeFilters = activeFilters;
  } catch {
    // First run or settings not available — use defaults
  }
}

async function savePrefs() {
  try {
    const p = state.libraryPrefs;
    await window.desktopApi.setSetting("library.viewMode", p.viewMode);
    await window.desktopApi.setSetting("library.sortField", p.sortField);
    await window.desktopApi.setSetting("library.sortDirection", p.sortDirection);
    await window.desktopApi.setSetting("library.sidebarOpen", p.sidebarOpen);
    await window.desktopApi.setSetting("library.sidebarExpandedFolders", p.sidebarExpandedFolders);
    await window.desktopApi.setSetting("library.activeFilters", p.activeFilters);
  } catch {
    // Settings write failure is non-fatal
  }
}

// ─── Shared callbacks object ───────────────────────────────────────────────────

function _buildSharedCallbacks() {
  return {
    // Toolbar
    onNewBuild: handleNewBuild,
    onNewFolder: handleNewFolder,

    onFilterChange(change) {
      if (!change) return;
      if (change.clear) {
        state.libraryPrefs.activeFilters = {};
      } else if (change.type) {
        state.libraryPrefs.activeFilters = {
          ...state.libraryPrefs.activeFilters,
          [change.type]: change.value || undefined,
        };
        // Remove keys with falsy values
        for (const k of Object.keys(state.libraryPrefs.activeFilters)) {
          if (!state.libraryPrefs.activeFilters[k]) {
            delete state.libraryPrefs.activeFilters[k];
          }
        }
      }
      renderLibrary();
    },

    onSortChange({ field, direction } = {}) {
      if (field) state.libraryPrefs.sortField = field;
      if (direction) state.libraryPrefs.sortDirection = direction;
      // Toggle direction if same field and no explicit direction provided
      if (field && !direction) {
        state.libraryPrefs.sortDirection =
          state.libraryPrefs.sortDirection === "desc" ? "asc" : "desc";
      }
      renderLibrary();
    },

    onViewChange(mode) {
      state.libraryPrefs.viewMode = mode;
      renderLibrary();
    },

    onPrefsChange(delta) {
      Object.assign(state.libraryPrefs, delta);
      savePrefs();
      renderLibrary();
    },

    onNavigate(folder) {
      state.currentFolder = folder || null;
      clearSelection();
      savePrefs();
      renderLibrary();
    },

    // Content / build actions
    onLoadBuild: handleLoadBuild,
    onRename: handleRename,
    onDuplicate: handleDuplicate,
    onTogglePin: handleTogglePin,
    onPinAll: handlePinAll,
    onMoveTo: handleMoveTo,
    onDelete: handleDelete,
    onCopyJson: handleCopyJson,
    onExportJson: handleCopyJson,
    onPasteJson: handlePasteJson,
    onPublish: handlePublish,
    onBuildInfo: handleBuildInfo,
    onEditTags: handleEditTags,

    // Folder actions
    onOpenFolder: handleOpenFolder,
    onRenameFolder: handleRenameFolder,
    onNewSubfolder: handleNewSubfolder,
    onNewBuildInFolder: handleNewBuildInFolder,
    onDeleteFolder: handleDeleteFolder,
    onNewFolderAndMove: handleNewFolderAndMove,

    // Selection
    onSelectAll: selectAll,

    // Refresh (used by drag-drop)
    onRefresh: renderLibrary,
  };
}

// ─── Dialog helpers (Electron doesn't support window.prompt/confirm/alert) ────

/**
 * Show a text-input prompt via a modal. Returns the entered string or null if cancelled.
 */
function showPrompt(title, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal">
        <div class="confirm-modal__header">
          <h3 class="confirm-modal__title">${title}</h3>
        </div>
        <div class="confirm-modal__body">
          <input type="text" class="confirm-modal__input" value="" style="width:100%;padding:6px 8px;background:#151530;border:1px solid #303060;border-radius:4px;color:#ccd;font-size:0.9rem;" />
        </div>
        <div class="confirm-modal__actions">
          <button class="confirm-modal__btn" data-action="cancel">Cancel</button>
          <button class="confirm-modal__btn confirm-modal__btn--confirm" data-action="ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("input");
    input.value = defaultValue;
    input.focus();
    input.select();

    function dismiss(value) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    }

    function onKey(e) {
      if (e.key === "Escape") dismiss(null);
      if (e.key === "Enter") dismiss(input.value.trim() || null);
    }

    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => dismiss(null));
    overlay.querySelector('[data-action="ok"]').addEventListener("click", () => dismiss(input.value.trim() || null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(null); });
  });
}

/**
 * Show a confirm dialog. Returns true/false.
 */
function showConfirm(title, body = "") {
  return showConfirmModal({ title, body, confirmLabel: "Confirm", cancelLabel: "Cancel" });
}
