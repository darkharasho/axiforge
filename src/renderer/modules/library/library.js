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
import { initSidebar, renderSidebar, insertInlineInput } from "./sidebar.js";
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
  wireContextMenuEvents();
  // Pre-generate chat links in the background so copies are instant.
  window.desktopApi?.prewarmChatLinks?.(state.builds);
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
  // Find the "+" button as anchor for inline input in sidebar
  const btn = document.getElementById("lib-new-folder-btn");
  const anchor = btn?.closest(".lib-sidebar__section-header");
  const name = await insertInlineInput(anchor, "");
  if (!name) { renderLibrary(); return; }
  await saveFolder({ name, parentId: null });
  renderLibrary();
}

async function handleNewFolderInContent() {
  // Insert inline input at the top of the content area (like file explorer)
  const content = document.getElementById("lib-content");
  if (!content) return;
  const name = await insertInlineInput(null, "", {
    container: content,
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
  const parentId = state.currentFolder?.type === "custom" ? state.currentFolder.id : null;
  await saveFolder({ name, parentId });
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

let _toastEl = null;
let _toastTimer = null;
function showToast(message, type = "success") {
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    _toastEl.className = "lib-toast";
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = message;
  _toastEl.className = `lib-toast lib-toast--${type}`;
  // Force reflow so transition fires even if toast is already visible
  void _toastEl.offsetWidth;
  _toastEl.classList.add("lib-toast--visible");
  clearTimeout(_toastTimer);
  if (type !== "loading") {
    _toastTimer = setTimeout(() => {
      _toastEl.classList.remove("lib-toast--visible");
    }, 2000);
  }
}

async function handleCopyChatLink(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  try {
    const link = await window.desktopApi.generateChatLink(build);
    await window.desktopApi.writeClipboardText(link);
    showToast("Chat link copied!");
  } catch (err) {
    console.error("Failed to generate chat link:", err);
    showToast("Failed to generate chat link", "error");
  }
}

async function handleImportChatLink() {
  const folderId = state.currentFolder || null;
  const result = await showImportModal();
  if (!result) return;
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const saved = await window.desktopApi.importChatLink(result.link, result.name, folderId, gameMode);
    state.builds = await window.desktopApi.listBuilds();
    renderLibrary();
    window.desktopApi.prewarmChatLinks?.([saved]);
    showToast(`"${saved.title}" imported`);
  } catch (err) {
    console.error("Import failed:", err);
    showToast("Import failed", "error");
  }
}

async function handleImportGw2Skills() {
  const folderId = state.currentFolder || null;
  const result = await showGw2SkillsImportModal();
  if (!result) return;
  showToast("Importing from GW2Skills\u2026", "loading");
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const saved = await window.desktopApi.importGw2Skills(result.url, result.name, folderId, gameMode);
    state.builds = await window.desktopApi.listBuilds();
    renderLibrary();
    window.desktopApi.prewarmChatLinks?.([saved]);
    showToast(`"${saved.title}" imported`);
  } catch (err) {
    console.error("GW2Skills import failed:", err);
    showToast("GW2Skills import failed", "error");
  }
}

function handlePasteJson() {
  _app.importBuildJsonFromClipboard?.();
}

function handlePublish(buildId) {
  // Load the build into the editor and navigate there — publish from editor
  handleLoadBuild(buildId);
}

async function handleBuildInfo(buildId) {
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
  // Find the folder's nav item in sidebar and replace label with inline input
  const navItem = document.querySelector(`[data-navigate-folder="${folderId}"]`);
  const newName = await insertInlineInput(navItem, folder.name || "");
  if (!newName) { renderLibrary(); return; }
  await saveFolder({ ...folder, name: newName });
  renderLibrary();
}

async function handleNewSubfolder(parentId) {
  // Insert inline input in the content area after the parent folder row
  const folderEl = document.querySelector(`#lib-content [data-folder-id="${parentId}"]`);
  const name = await insertInlineInput(folderEl, "", {
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
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
  const content = document.getElementById("lib-content");
  if (!content) return;
  const name = await insertInlineInput(null, "", {
    container: content,
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
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
    onNewFolder: handleNewFolderInContent,
    onNewFolderSidebar: handleNewFolder,

    onFilterChange(change) {
      if (!change) {
        // No change object = search text updated, just re-render content
        renderContent();
        return;
      }
      if (change.clear) {
        state.libraryPrefs.activeFilters = {};
      } else if (change.type) {
        const filters = { ...state.libraryPrefs.activeFilters };
        if (change.value) {
          filters[change.type] = change.value;
        } else {
          delete filters[change.type];
        }
        state.libraryPrefs.activeFilters = filters;
      }
      savePrefs();
      // Re-render content but keep filter dropdowns open
      renderContent();
    },

    onSortChange({ field, direction } = {}) {
      if (field) state.libraryPrefs.sortField = field;
      if (direction) state.libraryPrefs.sortDirection = direction;
      // Toggle direction if same field and no explicit direction provided
      if (field && !direction) {
        state.libraryPrefs.sortDirection =
          state.libraryPrefs.sortDirection === "desc" ? "asc" : "desc";
      }
      savePrefs();
      renderLibrary();
    },

    onViewChange(mode) {
      state.libraryPrefs.viewMode = mode;
      savePrefs();
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
    onCopyChatLink: handleCopyChatLink,
    onImportChatLink: handleImportChatLink,
    onImportGw2Skills: handleImportGw2Skills,
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
          <input type="text" class="confirm-modal__input" value="" style="width:100%;padding:6px 8px;background:#151530;border:1px solid #303060;border-radius:4px;color:#ccd;font-size:0.9rem;outline:none;" />
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

function showImportModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal" style="width:420px;max-width:90vw;">
        <div class="confirm-modal__header">
          <h3 class="confirm-modal__title">Import Build Link</h3>
        </div>
        <div class="confirm-modal__body" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:0.8rem;color:#889;margin-bottom:4px;">Build Link</label>
            <input
              type="text"
              id="import-link-input"
              placeholder="Paste [&amp;...] chat link here"
              style="width:100%;padding:6px 8px;background:#151530;border:1px solid #303060;border-radius:4px;color:#ccd;font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
            <div id="import-link-status" style="font-size:0.75rem;min-height:1.2em;margin-top:3px;color:#556;"></div>
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:#889;margin-bottom:4px;">Build Name</label>
            <input
              type="text"
              id="import-name-input"
              placeholder="Build name"
              style="width:100%;padding:6px 8px;background:#151530;border:1px solid #303060;border-radius:4px;color:#ccd;font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
          </div>
        </div>
        <div class="confirm-modal__actions">
          <button class="confirm-modal__btn" data-action="cancel">Cancel</button>
          <button class="confirm-modal__btn confirm-modal__btn--primary" data-action="import" disabled>Import</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const linkInput = overlay.querySelector("#import-link-input");
    const nameInput = overlay.querySelector("#import-name-input");
    const statusEl = overlay.querySelector("#import-link-status");
    const importBtn = overlay.querySelector('[data-action="import"]');
    let previewTimer = null;
    let linkValid = false;

    linkInput.focus();

    function setStatus(msg, color) {
      statusEl.textContent = msg;
      statusEl.style.color = color;
    }

    linkInput.addEventListener("input", () => {
      const val = linkInput.value.trim();
      clearTimeout(previewTimer);
      importBtn.disabled = true;
      linkValid = false;
      if (!val) { setStatus("", "#556"); return; }
      if (!val.startsWith("[&") || !val.endsWith("]")) {
        setStatus("Not a valid chat link format", "#c55");
        return;
      }
      setStatus("Decoding\u2026", "#889");
      previewTimer = setTimeout(async () => {
        try {
          const { profession, eliteSpec } = await window.desktopApi.previewChatLink(val);
          const autoName = eliteSpec ? `Imported ${eliteSpec}` : `Imported ${profession}`;
          if (!nameInput.value || nameInput.dataset.autoFilled === "1") {
            nameInput.value = autoName;
            nameInput.dataset.autoFilled = "1";
          }
          setStatus(`\u2713 ${profession}${eliteSpec ? ` \u2014 ${eliteSpec}` : ""}`, "#5a5");
          linkValid = true;
          importBtn.disabled = false;
        } catch {
          setStatus("Could not decode link", "#c55");
        }
      }, 400);
    });

    nameInput.addEventListener("input", () => {
      nameInput.dataset.autoFilled = "0";
    });

    function dismiss(result) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === "Escape") dismiss(null);
      if (e.key === "Enter" && linkValid) {
        dismiss({ link: linkInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
      }
    }

    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => dismiss(null));
    importBtn.addEventListener("click", () => {
      dismiss({ link: linkInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
    });
  });
}

function showGw2SkillsImportModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal" style="width:460px;max-width:90vw;">
        <div class="confirm-modal__header">
          <h3 class="confirm-modal__title">Import from GW2Skills</h3>
        </div>
        <div class="confirm-modal__body" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:0.8rem;color:#889;margin-bottom:4px;">GW2Skills URL</label>
            <input
              type="text"
              id="gw2s-url-input"
              placeholder="https://gw2skills.net/editor/?..."
              style="width:100%;padding:6px 8px;background:#151530;border:1px solid #303060;border-radius:4px;color:#ccd;font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
            <div id="gw2s-url-status" style="font-size:0.75rem;min-height:1.2em;margin-top:3px;color:#556;"></div>
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:#889;margin-bottom:4px;">Build Name</label>
            <input
              type="text"
              id="gw2s-name-input"
              placeholder="Build name"
              style="width:100%;padding:6px 8px;background:#151530;border:1px solid #303060;border-radius:4px;color:#ccd;font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
          </div>
        </div>
        <div class="confirm-modal__actions">
          <button class="confirm-modal__btn" data-action="cancel">Cancel</button>
          <button class="confirm-modal__btn confirm-modal__btn--primary" data-action="import" disabled>Import</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const urlInput = overlay.querySelector("#gw2s-url-input");
    const nameInput = overlay.querySelector("#gw2s-name-input");
    const statusEl = overlay.querySelector("#gw2s-url-status");
    const importBtn = overlay.querySelector('[data-action="import"]');
    let urlValid = false;

    urlInput.focus();

    function setStatus(msg, color) {
      statusEl.textContent = msg;
      statusEl.style.color = color;
    }

    urlInput.addEventListener("input", () => {
      const val = urlInput.value.trim();
      importBtn.disabled = true;
      urlValid = false;
      if (!val) { setStatus("", "#556"); return; }
      if (!val.includes("gw2skills.net/editor/?") || val.split("?")[1]?.length < 5) {
        setStatus("Not a valid GW2Skills URL", "#c55");
        return;
      }
      setStatus("\u2713 Valid GW2Skills URL", "#5a5");
      urlValid = true;
      importBtn.disabled = false;
    });

    nameInput.addEventListener("input", () => {
      nameInput.dataset.autoFilled = "0";
    });

    function dismiss(result) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === "Escape") dismiss(null);
      if (e.key === "Enter" && urlValid) {
        dismiss({ url: urlInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
      }
    }

    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => dismiss(null));
    importBtn.addEventListener("click", () => {
      dismiss({ url: urlInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(null); });
  });
}

/**
 * Show a confirm dialog. Returns true/false.
 */
function showConfirm(title, body = "") {
  return showConfirmModal({ title, body, confirmLabel: "Confirm", cancelLabel: "Cancel" });
}
