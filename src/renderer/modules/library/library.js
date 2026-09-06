// Library orchestrator — wires all library sub-modules together.
// This is the main entry point for the library page.

import { state } from "../state.js";
import { normalizeImportedSkills } from "../editor.js";
import { escapeHtml } from "../utils.js";

import {
  loadFolders,
  saveFolder,
  deleteFolder,
  moveBuilds,
  pinBuilds,
} from "./folder-store.js";

import { showConfirmModal } from "../confirm-modal.js";
import { showChoiceModal } from "../choice-modal.js";
import { showFormModal } from "../form-modal.js";
import { askAboutDuplicates, summarizeImport } from "./import-dedupe.js";
import { showPrompt } from "../prompt-modal.js";
import { loadTeamState, teamRootFor } from "../teams.js";
import { promptRenameTeam } from "../team-modal.js";
import { initToolbar, renderToolbar, renderFilters } from "./toolbar.js";
import { initSidebar, renderSidebar, insertInlineInput } from "./sidebar.js";
import { initSidebarResize, applySidebarWidth, clampSidebarWidth } from "./sidebar-resize.js";
import { initContent, renderContent } from "./content.js";
import { initContextMenu, wireContextMenuEvents, closeMenu } from "./context-menu.js";
import {
  getSelection,
  getCompSelection,
  clearSelection,
  selectAll,
  navigateSelection,
  wireSelectionEvents,
} from "./selection.js";
import { initDragDrop, wireDragDropEvents } from "./drag-drop.js";
import { showHistoryPanel, showCompHistoryPanel, showFolderHistoryPanel } from "./history-panel.js";
import { compIcon } from "./heroicons.js";
import { pushUndo, popUndo, applyUndo } from "./undo.js";
// Toast lives in its own module so the Undo affordance is testable without
// pulling all of library.js into a DOM. Re-exported: it is imported from here
// all over the renderer.
import { showToast, hideToast } from "./toast.js";
export { showToast };
import { handleAxicodeExport, handleAxicodeImport } from "./axicode-io.js";
import { pickWebhooks } from "../webhook-picker.js";

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
 *   render: function,
 *   openSettings?: function
 * }} appCallbacks
 */
export async function initLibrary(appCallbacks) {
  _app = appCallbacks || {};

  try {
    await loadFolders();
    await loadPrefs();
    await loadTeamState();
    await refreshTrash();
    await refreshArchive();
  } catch (err) {
    console.warn("[library] init data load failed:", err);
  }

  const shared = _buildSharedCallbacks();

  initToolbar(shared);
  initSidebar(shared);
  initSidebarResize({ onCommit: savePrefs });
  initContent(shared);
  initContextMenu(shared);
  initDragDrop(shared);

  // Re-render the library when a revert completes (fired by history-panel.js)
  document.addEventListener("library:rerender", () => renderLibrary());
  // Toast requests from history-panel.js (avoids circular import)
  document.addEventListener("library:toast", (e) => showToast(e.detail?.message, e.detail?.type));
}

/**
 * Render all library sub-views.
 * Call when navigating to the library page or when data changes.
 */
export function renderLibrary() {
  refreshTrashBadge();
  applySidebarWidth();
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
export async function handleLibraryKeydown(e) {
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
      const compSel = getCompSelection();
      if (compSel.length > 0) {
        e.preventDefault();
        handleOpenComp(compSel[0]);
      } else if (sel.length > 0) {
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
      const compSel = getCompSelection();
      if (compSel.length > 0) {
        e.preventDefault();
        handleDeleteComps(compSel);
        break;
      }
      const sel = getSelection();
      if (sel.length > 0) {
        e.preventDefault();
        // Inside a comp the selection is the comp's *membership*, not a folder
        // of builds. Dragging out and the context menu both unlink there, so
        // Delete must too — hard-deleting the underlying builds from a view
        // that never offers a Delete item is how people lose their library.
        if (state.currentFolder?.type === "comp") {
          const compId = state.currentFolder.id;
          (async () => {
            for (const id of sel) await handleRemoveBuildFromComp(id, compId);
          })();
        } else {
          handleDelete(sel);
        }
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

    case "x":
    case "X":
      if (ctrl) {
        const sel = getSelection();
        if (sel.length > 0) {
          e.preventDefault();
          handleCutJson(sel);
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

    case "z":
    case "Z":
      if (ctrl) {
        e.preventDefault();
        await runUndo();
      }
      break;
  }
}

// ─── Undo plumbing ─────────────────────────────────────────────────────────────

// Naming helpers for the toasts below. A toast that says what it acted on
// ("Moved 3 builds to Raids") is worth far more than "Done!" when the next thing
// the user has to decide is whether to hit Undo.
function countLabel(n, noun) {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}
function folderLabel(folderId) {
  if (!folderId) return "All Builds";
  return state.folders?.find((f) => f.id === folderId)?.name || "that folder";
}
function compLabel(compId) {
  return `"${state.comps?.find((c) => c.id === compId)?.name || "Untitled Comp"}"`;
}

/** The one place undo is applied — Ctrl+Z and the toast's Undo button both land here. */
function runUndo() {
  return applyUndo(popUndo(), { toast: showToast, render: renderLibrary });
}

/**
 * Record an undoable action and tell the user it happened, with the reversal
 * offered inline.
 *
 * Undo was previously invisible: ten of the twelve reversible actions gave no
 * feedback at all, so dragging a build into the wrong folder looked identical to
 * nothing happening. Announcing the action IS the discovery mechanism for undo,
 * so the two belong in one call rather than being remembered separately at each
 * call site.
 *
 * @param {{type: string, label?: string, undo: () => Promise<void>}} action
 *        `label` is what the user is told after undoing ("Move undone").
 * @param {string} doneMessage - what just happened ("Moved 3 builds")
 */
function pushUndoable(action, doneMessage) {
  pushUndo(action);
  showToast(doneMessage, "success", { label: "Undo", onClick: runUndo });
}

// ─── Action handlers ───────────────────────────────────────────────────────────

function handleNewBuild() {
  if (!_app.confirmDiscardDirty?.("Start a new build")) return;
  _app.startNewBuild?.();
  // Preserve current location so the build is saved into the right place
  if (state.editor) {
    if (state.currentFolder?.type === "comp") {
      state.editor.activeCompId = state.currentFolder.id;
    } else if (state.currentFolder?.type === "custom") {
      state.editor.folderId = state.currentFolder.id;
    }
  }
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

async function handleLoadBuild(buildId) {
  if (!_app.confirmDiscardDirty?.("Load another build")) return;
  // Always fetch from the store so we get the post-sync version, not a
  // potentially stale in-memory copy (e.g. notes written by another user
  // whose push landed after the last in-memory state update).
  const freshBuilds = await window.desktopApi.listBuilds().catch(() => null);
  if (freshBuilds) state.builds = freshBuilds;
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) {
    showToast("Build not found — it may have been deleted.", "error");
    renderLibrary();
    return;
  }
  _app.loadBuildIntoEditor?.(build);
  _app.navigateToPage?.("editor");
}

/**
 * Replace the title/name element inside a content item with an inline input.
 * Returns the new value (trimmed) or null if cancelled (Escape).
 */
function startInlineRename(itemEl, currentValue) {
  if (!itemEl) return Promise.resolve(null);
  // Find the title element — different classes per view type
  // One entry per view mode. A missing class here is a SILENT failure — Rename
  // resolves null and the menu item looks broken — which is what happened to
  // the columns view (.lib-col__name) for as long as it has existed.
  const titleEl =
    itemEl.querySelector(".lib-list-row__title") ||
    itemEl.querySelector(".lib-grid-card__title") ||
    itemEl.querySelector(".lib-icon-item__label") ||
    itemEl.querySelector(".lib-tv__name") ||
    itemEl.querySelector(".lib-col__name");
  if (!titleEl) return Promise.resolve(null);

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "lib-inline-input";
    input.value = currentValue;
    // Preserve the element's dimensions
    input.style.width = "100%";

    const originalContent = titleEl.innerHTML;
    titleEl.textContent = "";
    titleEl.appendChild(input);

    input.focus();
    input.select();

    let resolved = false;
    function finish(value) {
      if (resolved) return;
      resolved = true;
      resolve(value);
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finish(input.value.trim() || null);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        titleEl.innerHTML = originalContent;
        finish(null);
      }
    });
    input.addEventListener("blur", () => {
      finish(input.value.trim() || null);
    });
  });
}

async function handleRename(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const oldTitle = build.title;
  const el = document.querySelector(`#lib-content [data-build-id="${buildId}"]`);
  const newTitle = await startInlineRename(el, build.title || "");
  if (!newTitle) { renderLibrary(); return; }
  try {
    await window.desktopApi.saveBuild({ ...build, title: newTitle });
    state.builds = await window.desktopApi.listBuilds();
    pushUndoable({ type: "rename-build", label: `Renamed back to "${oldTitle}"`, undo: async () => {
      const current = state.builds.find((b) => b.id === buildId);
      if (current) await window.desktopApi.saveBuild({ ...current, title: oldTitle });
      state.builds = await window.desktopApi.listBuilds();
    }}, `Renamed to "${newTitle}"`);
  } catch (err) {
    console.error("[library] rename failed:", err);
    showToast("Rename failed — please try again.", "error");
    state.builds = await window.desktopApi.listBuilds();
  } finally {
    renderLibrary();
  }
}

async function handleDuplicate(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const copy = { ...build };
  delete copy.id;
  copy.title = `${build.title || "Untitled"} (Copy)`;
  copy.compIds = [];
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
  const oldFolderIds = ids.map((id) => {
    const b = state.builds.find((b) => b.id === id);
    return { id, folderId: b?.folderId || null };
  });
  await moveBuilds(ids, folderId);
  pushUndoable({ type: "move-builds", label: countLabel(ids.length, "build") + " moved back", undo: async () => {
    for (const { id, folderId } of oldFolderIds) {
      const build = state.builds.find((b) => b.id === id);
      if (build) await window.desktopApi.saveBuild({ ...build, folderId });
    }
    state.builds = await window.desktopApi.listBuilds();
  }}, `Moved ${countLabel(ids.length, "build")} to ${folderLabel(folderId)}`);
  renderLibrary();
}

async function handleDelete(ids) {
  const count = ids.length;
  // No confirm: the delete is staged in the trash for 30 days and the toast
  // below offers the reversal inline. A dialog here would be asking the user to
  // approve something that has not actually been destroyed.
  for (const id of ids) {
    await window.desktopApi.deleteBuild(id);
  }
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  clearSelection();
  pushUndoable({
    type: "delete-builds",
    label: `Restored ${countLabel(count, "build")}`,
    undo: async () => {
      await window.desktopApi.restoreFromTrash({ builds: ids });
      state.builds = await window.desktopApi.listBuilds();
      state.comps = await window.desktopApi.listComps();
    },
  }, `Moved ${countLabel(count, "build")} to Trash`);
  renderLibrary();
}

// ─── Trash ───────────────────────────────────────────────────────────────────

async function refreshTrash() {
  state.trashItems = (await window.desktopApi.listTrash?.()) || [];
  await refreshTeamTrash();
}

/**
 * What the TEAM deleted, from the server.
 *
 * Separate from the local trash because it answers a different question, and
 * because only the server can answer it for everyone: a teammate who was
 * offline when the tombstone landed, or who joined afterwards, has no local
 * copy to offer back. Failures are swallowed — the trash must still open when
 * you are offline, showing your own rows.
 */
async function refreshTeamTrash() {
  const roots = (state.folders || []).filter((f) => f.teamId && !f.parentId);
  if (!roots.length || !window.desktopApi.listTeamTrash) {
    state.teamTrashItems = [];
    return;
  }
  const perTeam = await Promise.all(
    roots.map(async (root) => {
      try {
        const rows = await window.desktopApi.listTeamTrash(root.teamId);
        return (rows || []).map((r) => ({ ...r, teamId: root.teamId, teamName: root.name }));
      } catch {
        return [];
      }
    })
  );
  state.teamTrashItems = perTeam
    .flat()
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

/**
 * Keep the sidebar's Trash count honest without making every delete remember to
 * update it. Re-renders the sidebar only when the count actually moved, so this
 * cannot loop.
 */
function refreshTrashBadge() {
  const before = (state.trashItems || []).length;
  refreshTrash()
    .then(() => {
      if ((state.trashItems || []).length !== before) renderSidebar();
    })
    .catch(() => {});
}

/** Reload everything the trash can have put back or taken away. */
async function reloadAfterTrashChange() {
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  await loadFolders();
  await refreshTrash();
  renderLibrary();
}

/**
 * Undo a team deletion for everyone, not just here. The server restores the
 * item and the pull that follows brings it back into this library the same way
 * any other teammate's write arrives.
 */
async function handleTeamTrashRestore({ teamId, id }) {
  try {
    await window.desktopApi.restoreFromTeamTrash(teamId, id);
    await reloadAfterTrashChange();
    showToast("Back for the whole team", "success");
  } catch (err) {
    showToast(err?.message || "Couldn't restore that.", "error");
  }
}

async function handleTrashRestore({ type, id }) {
  const key = type === "folder" ? "folders" : type === "comp" ? "comps" : "builds";
  await window.desktopApi.restoreFromTrash({ [key]: [id] });
  await reloadAfterTrashChange();
  showToast("Put back", "success");
}

async function handleTrashPurge({ type, id }) {
  const item = (state.trashItems || []).find((i) => i.id === id);
  const name = item?.name || "this item";
  // The one delete that really is unrecoverable still asks first.
  const confirmed = await showConfirm(
    `Permanently delete "${name}"?`,
    "This cannot be undone.",
  );
  if (!confirmed) return;
  const key = type === "folder" ? "folders" : type === "comp" ? "comps" : "builds";
  await window.desktopApi.purgeFromTrash({ [key]: [id] });
  await reloadAfterTrashChange();
  showToast("Deleted permanently", "success");
}

async function handleTrashEmpty() {
  const count = (state.trashItems || []).length;
  const confirmed = await showConfirm(
    `Permanently delete ${count === 1 ? "1 item" : `${count} items`}?`,
    "Emptying the trash cannot be undone.",
  );
  if (!confirmed) return;
  await window.desktopApi.emptyTrash();
  await reloadAfterTrashChange();
  showToast("Trash emptied", "success");
}

// ─── Archive ─────────────────────────────────────────────────────────────────
// The archive is the trash's opposite number: nothing is staged for removal and
// nothing expires, so there is no confirm and no countdown. Archived records
// stay live in main (see archive.js) -- they are filtered out of the library
// views in folder-store.js -- which is why every handler here only has to
// reload state and re-render.

async function refreshArchive() {
  state.archiveItems = (await window.desktopApi.listArchive?.()) || [];
}

/** Reload everything an archive change can have hidden or brought back. */
async function reloadAfterArchiveChange() {
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  await loadFolders();
  await refreshArchive();
  renderLibrary();
}

/**
 * @param {{builds?: string[], comps?: string[], folder?: string}} target
 */
async function handleArchive(target) {
  const { builds = [], comps = [], folder = null } = target || {};
  let label = "";

  if (folder) {
    const name = state.folders.find((f) => f.id === folder)?.name || "Folder";
    const result = await window.desktopApi.archiveFolder(folder);
    // Say what went with it. "Archived Raids" reads as if the builds inside are
    // still on the shelf somewhere, and they are not.
    const carried = (result?.builds?.length || 0) + (result?.comps?.length || 0);
    label = carried
      ? `Archived "${name}" and ${countLabel(carried, "item")} inside it`
      : `Archived "${name}"`;
  } else if (comps.length) {
    await window.desktopApi.archiveComps(comps);
    label = `Archived ${countLabel(comps.length, "comp")}`;
  } else if (builds.length) {
    await window.desktopApi.archiveBuilds(builds);
    label = `Archived ${countLabel(builds.length, "build")}`;
  } else {
    return;
  }

  // Same as the delete path: an archived comp you are standing inside stops
  // resolving, and the view empties out with no explanation. @see handleDeleteComps
  if (state.currentFolder?.type === "comp" && comps.includes(state.currentFolder.id)) {
    state.currentFolder = null;
  }
  clearSelection();
  await reloadAfterArchiveChange();
  pushUndoable({
    type: "archive",
    label: "Unarchived",
    undo: async () => {
      await window.desktopApi.restoreFromArchive(
        folder ? { folders: [folder] } : comps.length ? { comps } : { builds },
      );
      await reloadAfterArchiveChange();
    },
  }, label);
}

async function handleArchiveRestore({ type, id }) {
  const key = type === "folder" ? "folders" : type === "comp" ? "comps" : "builds";
  await window.desktopApi.restoreFromArchive({ [key]: [id] });
  await reloadAfterArchiveChange();
  showToast("Back in your library", "success");
}

/**
 * Opening straight out of the archive, without un-archiving first. An archived
 * build is a working build -- this is the whole point of an archive over a
 * trash -- so looking one up should not cost you a round trip through the
 * library. Navigating away leaves it archived.
 */
function handleArchiveOpen({ type, id }) {
  if (type === "comp") return handleOpenComp(id);
  return handleLoadBuild(id);
}

let _cutIds = [];

async function handleCopyJson(idOrIds) {
  _cutIds = []; // clear any pending cut
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  const builds = ids
    .map((id) => state.builds.find((b) => b.id === id))
    .filter(Boolean);
  if (builds.length === 0) return;
  const json = JSON.stringify(builds.length === 1 ? builds[0] : builds, null, 2);
  await window.desktopApi.writeClipboardText(json);
  showToast(builds.length === 1 ? "Build copied!" : `${builds.length} builds copied!`);
}

async function handleCutJson(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  const builds = ids
    .map((id) => state.builds.find((b) => b.id === id))
    .filter(Boolean);
  if (builds.length === 0) return;
  _cutIds = builds.map((b) => b.id);
  const json = JSON.stringify(builds.length === 1 ? builds[0] : builds, null, 2);
  await window.desktopApi.writeClipboardText(json);
  showToast(builds.length === 1 ? "Build cut!" : `${builds.length} builds cut!`);
}

async function handleCopyShareCode(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  if (ids.length !== 1) {
    showToast?.("AxiCode only supports a single build.");
    return;
  }
  const build = state.builds.find((b) => b.id === ids[0]);
  if (!build) return;
  try {
    const code = await window.desktopApi.encodeShareCode(build);
    await window.desktopApi.writeClipboardText(code);
    showToast?.("AxiCode copied!");
  } catch (err) {
    showToast?.("Failed to generate AxiCode.");
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

async function handleDiscordCopy(buildId) {
  try {
    const text = await window.desktopApi.getBuildDiscordCopyText(buildId);
    await window.desktopApi.writeClipboardText(text);
    showToast("Discord link copied!");
  } catch (err) {
    console.error("Failed to copy Discord link:", err);
    showToast("Failed to copy Discord link", "error");
  }
}

async function handleDiscordEmbed(buildId) {
  try {
    const webhooks = await window.desktopApi.listBuildWebhooks();
    if (!webhooks || !webhooks.length) {
      showToast("Add a build webhook in Settings first", "error");
      return;
    }

    let webhookIds;
    if (webhooks.length === 1) {
      webhookIds = [webhooks[0].id];
    } else {
      webhookIds = await pickWebhooks(webhooks);
      if (!webhookIds) return; // cancelled
    }

    const result = await window.desktopApi.shareBuildToDiscord(buildId, webhookIds);
    if (result.success) {
      showToast("Shared to Discord!");
    } else {
      showToast(result.error || "Failed to share", "error");
    }
  } catch (err) {
    console.error("Failed to share to Discord:", err);
    showToast("Failed to share to Discord", "error");
  }
}

async function addImportedBuildToActiveComp(saved) {
  if (state.currentFolder?.type !== "comp") return;
  const compId = state.currentFolder.id;
  const comp = state.comps?.find((c) => c.id === compId);
  if (!comp) return;
  if (!isGameModeCompatible(comp, saved)) {
    const modeName = comp.gameMode === "wvw" ? "WvW" : "PvE";
    showToast(`Build imported but not added to comp (locked to ${modeName}).`, "warning");
    return;
  }
  const newCompIds = [...new Set([...(saved.compIds || []), compId])];
  await window.desktopApi.saveBuild({ ...saved, compIds: newCompIds });
  const currentBuildIds = Array.isArray(comp.buildIds) ? [...comp.buildIds] : [];
  if (!currentBuildIds.includes(saved.id)) {
    currentBuildIds.push(saved.id);
    const newGameMode = comp.gameMode || saved.gameMode;
    await window.desktopApi.saveComp({ ...comp, gameMode: newGameMode, buildIds: currentBuildIds });
  }
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
}

async function handleImportChatLink(targetFolderId) {
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  const result = await showImportModal();
  if (!result) return;
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const saved = await window.desktopApi.importChatLink(result.link, result.name, folderId, gameMode);
    await addImportedBuildToActiveComp(saved);
    state.builds = await window.desktopApi.listBuilds();
    renderLibrary();
    window.desktopApi.prewarmChatLinks?.([saved]);
    showToast(`"${saved.title}" imported`);
  } catch (err) {
    console.error("Import failed:", err);
    showToast("Import failed", "error");
  }
}

export async function handleImportGw2Skills(targetFolderId) {
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  const result = await showGw2SkillsImportModal();
  if (!result) return;
  showToast("Importing from GW2Skills\u2026", "loading");
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const saved = await window.desktopApi.importGw2Skills(result.url, result.name, folderId, gameMode);
    if (window.__AXIFORGE_WEB__) {
      if (_app.confirmDiscardDirty && !_app.confirmDiscardDirty("Load imported build")) return;
      _app.loadBuildIntoEditor?.(saved);
      _app.navigateToPage?.("editor");
      showToast(`"${saved.title || saved.name || "Build"}" loaded`);
      return;
    }
    await addImportedBuildToActiveComp(saved);
    state.builds = await window.desktopApi.listBuilds();
    renderLibrary();
    window.desktopApi.prewarmChatLinks?.([saved]);
    showToast(`"${saved.title}" imported`);
  } catch (err) {
    console.error("GW2Skills import failed:", err);
    showToast(err?.message ? `GW2Skills import failed: ${err.message}` : "GW2Skills import failed", "error");
  }
}

/**
 * Fetch the link, ask about anything it would duplicate, then write it.
 *
 * Two round trips because the answer is only knowable after the fetch: nothing
 * is written until the user has seen what the link actually carries. Falls back
 * to the one-shot import where preview isn't wired (the web build), so that path
 * keeps behaving exactly as it did.
 *
 * @returns {Promise<{saved: object|null, decision: string|null}>} a null `saved`
 *   means the user backed out.
 */
async function runAxiImport(url, name, folderId, gameMode) {
  if (!window.desktopApi.previewAxiLink) {
    return { saved: await window.desktopApi.importAxiLink(url, name, folderId, gameMode), decision: null };
  }
  const preview = await window.desktopApi.previewAxiLink(url, name, folderId, gameMode);
  const decision = await askAboutDuplicates(preview, showChoiceModal);
  if (!decision) {
    // The token is left to expire on its own; nothing was written.
    hideToast();
    return { saved: null, decision: null };
  }
  showToast("Importing from AxiForge link…", "loading");
  return { saved: await window.desktopApi.commitAxiImport(preview.token, { reuse: decision === "reuse" }), decision };
}

async function handleImportAxiLink(targetFolderId) {
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  const result = await showAxiLinkImportModal();
  if (!result) return;
  showToast("Importing from AxiForge link\u2026", "loading");
  try {
    const gameMode = state.editor?.gameMode || "pve";
    // A blank name keeps the published build's own title — unlike a share code,
    // a published link carries the real name inside the payload.
    const { saved, decision } = await runAxiImport(result.url, result.name || "", folderId, gameMode);
    if (!saved) return; // backed out of the duplicate question
    // A comp link brings the comp AND every build it uses, landing in a folder of
    // its own — so there is a new folder to pick up and no single build to slot
    // into the comp being edited.
    if (saved?.kind === "comp") {
      state.builds = await window.desktopApi.listBuilds();
      state.comps = await window.desktopApi.listComps();
      state.folders = await window.desktopApi.listFolders();
      renderLibrary();
      window.desktopApi.prewarmChatLinks?.(saved.builds);
      showToast(summarizeImport(saved, decision));
      return;
    }
    await addImportedBuildToActiveComp(saved);
    state.builds = await window.desktopApi.listBuilds();
    renderLibrary();
    window.desktopApi.prewarmChatLinks?.([saved]);
    showToast(summarizeImport(saved, decision));
  } catch (err) {
    console.error("AxiForge link import failed:", err);
    showToast(err?.message ? `Import failed: ${err.message}` : "Import failed", "error");
  }
}

async function handleImportShareCode(targetFolderId) {
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  const result = await showShareCodeImportModal();
  if (!result) return;
  try {
    const decoded = await window.desktopApi.decodeShareCode(result.code);
    // Normalize axicode format to match the internal build store format.
    // Skills: convert flat healId/utilityIds/eliteId → nested { heal: {id}, utility: [{id}], elite: {id} }
    decoded.skills = normalizeImportedSkills(decoded);
    decoded.underwaterSkills = normalizeImportedSkills({ skills: decoded.underwaterSkills || {} });
    // Specializations: extract elite spec name from axicode label and
    // convert traitChoices → _traitChoices for later resolution by the editor.
    const labelMatch = result.code.match(/^<AxiForge:([^:]+):/);
    const axicodeLabel = labelMatch?.[1] || null;
    const isCoreBuild = axicodeLabel && axicodeLabel === decoded.profession;
    decoded.specializations = (decoded.specializations || []).map((s, i) => {
      // The last spec is typically the elite; the axicode label is its name
      const isElite = !isCoreBuild && axicodeLabel && i === (decoded.specializations.length - 1);
      return {
        ...s,
        name: s.name || (isElite ? axicodeLabel : ""),
        elite: s.elite ?? isElite,
        majorChoices: s.majorChoices || { 1: 0, 2: 0, 3: 0 },
        _traitChoices: Array.isArray(s.traitChoices) ? s.traitChoices : null,
      };
    });
    decoded.title = result.name || decoded.title || "Imported Build";
    if (folderId) decoded.folderId = folderId;
    const saved = await window.desktopApi.saveBuild(decoded);
    await addImportedBuildToActiveComp(saved);
    state.builds = await window.desktopApi.listBuilds();
    renderLibrary();
    showToast("AxiCode imported!");
  } catch (err) {
    console.error("Import failed:", err);
    showToast("Import failed: " + (err.message || "Unknown error"), "error");
  }
}

async function handleExportAxicode(mode) {
  await handleAxicodeExport(mode, null, showToast);
}

async function handleExportAxicodeFolder(folderId) {
  await handleAxicodeExport(null, folderId, showToast);
}

export async function handleImportAxicodeFile(targetFolderId) {
  if (window.__AXIFORGE_WEB__) {
    const result = await window.desktopApi.importAxicodeFile();
    if (!result || result.cancelled) return;
    if (result.error) {
      showToast(result.error, "error");
      return;
    }
    const builds = result.builds || [];
    if (builds.length === 0) {
      showToast("No builds found in that file.", "error");
      return;
    }
    const chosen = builds.length === 1 ? builds[0] : await showAxicodeBuildPickerModal(builds);
    if (!chosen) return;
    if (_app.confirmDiscardDirty && !_app.confirmDiscardDirty("Load imported build")) return;
    _app.loadBuildIntoEditor?.(chosen);
    _app.navigateToPage?.("editor");
    showToast(`"${chosen.title || chosen.name || "Build"}" loaded`);
    return;
  }
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  await handleAxicodeImport(folderId, renderLibrary, showToast);
}

/**
 * Compute the next copy title by appending or incrementing a numeric suffix.
 * Given "My Build" and existing titles ["My Build (1)", "My Build (2)"],
 * returns "My Build (3)".
 * @param {string} title
 * @param {string[]} existingTitles
 * @returns {string}
 */
export function nextCopyTitle(title, existingTitles) {
  // Strip existing numeric suffix to get the base name
  const base = title.replace(/\s*\(\d+\)$/, "");
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\((\\d+)\\)$`);
  let max = 0;
  for (const t of existingTitles) {
    const m = t.match(pattern);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${base} (${max + 1})`;
}

export function isGameModeCompatible(comp, build) {
  if (!comp.gameMode) return true;
  return comp.gameMode === build.gameMode;
}

async function handlePasteJson(targetId) {
  try {
    // Determine paste destination: explicit target (from context menu), or current folder
    let folderId = null;
    let compId = null;

    if (targetId) {
      // Check if the target is a comp or a folder
      const isComp = state.comps?.some((c) => c.id === targetId);
      if (isComp) {
        compId = targetId;
      } else {
        folderId = targetId;
      }
    } else if (state.currentFolder?.type === "comp") {
      compId = state.currentFolder.id;
    } else if (state.currentFolder?.type === "custom") {
      folderId = state.currentFolder.id;
    }

    // If we have pending cut IDs, move those builds instead of pasting from clipboard
    if (_cutIds.length > 0) {
      const idsToMove = _cutIds.filter((id) => state.builds.some((b) => b.id === id));
      _cutIds = [];
      if (idsToMove.length === 0) {
        showToast("Cut builds no longer exist", "error");
        return;
      }
      // Capture old locations before moving
      const oldLocations = idsToMove.map((id) => {
        const b = state.builds.find((b) => b.id === id);
        return { id, folderId: b?.folderId || null, compIds: [...(b?.compIds || [])] };
      });
      // Capture comp state before paste so undo can restore it
      const oldTargetComp = compId ? state.comps?.find((c) => c.id === compId) : null;
      const oldTargetCompSnapshot = oldTargetComp
        ? { buildIds: [...(oldTargetComp.buildIds || [])], gameMode: oldTargetComp.gameMode ?? null }
        : null;
      let filteredToMove = idsToMove;
      if (compId) {
        // Game mode lock check — filter builds to only those compatible with the comp
        const targetComp = state.comps?.find((c) => c.id === compId);
        let effectiveLock = targetComp?.gameMode || null;
        const incompatibleIds = [];
        filteredToMove = [];

        for (const id of idsToMove) {
          const build = state.builds.find((b) => b.id === id);
          if (!build) continue;
          if (effectiveLock === null) {
            effectiveLock = build.gameMode;
            filteredToMove.push(id);
          } else if (isGameModeCompatible({ gameMode: effectiveLock }, build)) {
            filteredToMove.push(id);
          } else {
            incompatibleIds.push(id);
          }
        }

        if (incompatibleIds.length > 0) {
          const modeName = effectiveLock === "wvw" ? "WvW" : "PvE";
          showToast(`${incompatibleIds.length} build(s) skipped — comp is locked to ${modeName}.`, "error");
          if (filteredToMove.length === 0) { _cutIds = []; return; }
        }

        // Move only the compatible builds
        for (const id of filteredToMove) {
          const build = state.builds.find((b) => b.id === id);
          if (build) {
            const newCompIds = [...new Set([...(build.compIds || []), compId])];
            await window.desktopApi.saveBuild({ ...build, compIds: newCompIds });
          }
          const comp = state.comps?.find((c) => c.id === compId);
          if (comp && !(comp.buildIds || []).includes(id)) {
            const newGameMode = comp.gameMode || state.builds.find((b) => b.id === id)?.gameMode || null;
            const updatedComp = { ...comp, gameMode: newGameMode, buildIds: [...(comp.buildIds || []), id] };
            await window.desktopApi.saveComp(updatedComp);
            // Update in-memory so subsequent iterations see the set gameMode
            const idx = state.comps.findIndex((c) => c.id === compId);
            if (idx !== -1) state.comps[idx] = updatedComp;
          }
        }
        state.builds = await window.desktopApi.listBuilds();
        state.comps = await window.desktopApi.listComps();
      } else {
        await moveBuilds(idsToMove, folderId);
      }
      pushUndoable({ type: "cut-paste", label: "Move undone", undo: async () => {
        for (const { id, folderId, compIds } of oldLocations) {
          const build = state.builds.find((b) => b.id === id);
          if (build) await window.desktopApi.saveBuild({ ...build, folderId, compIds });
        }
        // Restore comp state if the paste was into a comp
        if (compId && oldTargetCompSnapshot) {
          const c = state.comps?.find((c) => c.id === compId);
          if (c) await window.desktopApi.saveComp({ ...c, buildIds: oldTargetCompSnapshot.buildIds, gameMode: oldTargetCompSnapshot.gameMode });
        }
        state.builds = await window.desktopApi.listBuilds();
        state.comps = await window.desktopApi.listComps();
      }}, `Moved ${countLabel(filteredToMove.length, "build")}`);
      clearSelection();
      renderLibrary();
      return;
    }

    const text = await window.desktopApi.readClipboardText();
    if (!text || !String(text).trim()) {
      showToast("Clipboard is empty", "error");
      return;
    }
    let items;
    try {
      const parsed = JSON.parse(String(text));
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      showToast("Clipboard does not contain valid JSON", "error");
      return;
    }
    if (compId) {
      const targetComp = state.comps?.find((c) => c.id === compId);
      // Filter items to only those compatible with the comp's game mode (or would-be mode)
      let effectiveLock = targetComp?.gameMode || null;
      items = items.filter((item) => {
        if (!item || typeof item !== "object") return true;
        const source = item.build && typeof item.build === "object" ? item.build : item;
        const buildGameMode = source.gameMode || "pve";
        if (effectiveLock === null) { effectiveLock = buildGameMode; return true; }
        return buildGameMode === effectiveLock;
      });
      if (items.length === 0) {
        // Use effectiveLock (not targetComp?.gameMode) — it may have been set by the first item
        const modeName = effectiveLock === "wvw" ? "WvW" : "PvE";
        showToast(`This comp is locked to ${modeName} builds.`, "error");
        return;
      }
    }
    const existingTitles = state.builds.map((b) => b.title || "");
    const pastedIds = [];
    let savedCount = 0;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const source = item.build && typeof item.build === "object" ? item.build : item;
      const originalTitle = String(source.title || source.name || "Imported Build");
      const title = nextCopyTitle(originalTitle, existingTitles);
      existingTitles.push(title);
      const copy = { ...source, title, folderId: folderId || undefined, compIds: compId ? [compId] : [] };
      delete copy.id;
      const saved = await window.desktopApi.saveBuild(copy);
      if (saved?.id) pastedIds.push(saved.id);
      // If pasting into a comp, also add to comp's buildIds
      if (compId && saved) {
        const comp = state.comps?.find((c) => c.id === compId);
        if (comp && !(comp.buildIds || []).includes(saved.id)) {
          const newGameMode = comp.gameMode || saved.gameMode || null;
          const updatedComp = { ...comp, gameMode: newGameMode, buildIds: [...(comp.buildIds || []), saved.id] };
          await window.desktopApi.saveComp(updatedComp);
          const idx = state.comps.findIndex((c) => c.id === compId);
          if (idx !== -1) state.comps[idx] = updatedComp;
        }
      }
      savedCount++;
    }
    if (savedCount === 0) {
      showToast("No valid builds found in clipboard", "error");
      return;
    }
    state.builds = await window.desktopApi.listBuilds();
    if (compId) state.comps = await window.desktopApi.listComps();
    if (pastedIds.length > 0) {
      pushUndoable({ type: "paste", label: "Paste undone", undo: async () => {
        for (const id of pastedIds) await window.desktopApi.deleteBuild(id);
        state.builds = await window.desktopApi.listBuilds();
        if (compId) state.comps = await window.desktopApi.listComps();
      }}, `Pasted ${countLabel(savedCount, "build")}`);
    }
    renderLibrary();
  } catch (err) {
    console.error("Paste failed:", err);
    showToast("Paste failed", "error");
  }
}

// ─── Comp action handlers ───────────────────────────────────────────────────

async function handleNewComp() {
  // Inline input in the content area to name the comp (like new folders)
  const content = document.getElementById("lib-content");
  if (!content) return;
  const name = await insertInlineInput(null, "", {
    container: content,
    className: "lib-content-inline-folder",
    fallbackName: "New Comp",
    icon: compIcon,
  });
  if (!name) { renderLibrary(); return; }
  const parentId = state.currentFolder?.type === "custom" ? state.currentFolder.id : null;
  await window.desktopApi.saveComp({ name, folderId: parentId });
  state.comps = await window.desktopApi.listComps();
  renderLibrary();
}

async function handleCopyCompJson(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  const comps = ids
    .map((id) => state.comps.find((c) => c.id === id))
    .filter(Boolean);
  if (comps.length === 0) return;
  const json = JSON.stringify(comps.length === 1 ? comps[0] : comps, null, 2);
  await window.desktopApi.writeClipboardText(json);
  showToast(comps.length === 1 ? "Comp copied!" : `${comps.length} comps copied!`);
}

async function handleCutCompJson(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  const comps = ids
    .map((id) => state.comps.find((c) => c.id === id))
    .filter(Boolean);
  if (comps.length === 0) return;
  const json = JSON.stringify(comps.length === 1 ? comps[0] : comps, null, 2);
  await window.desktopApi.writeClipboardText(json);
  for (const comp of comps) {
    await window.desktopApi.deleteComp(comp.id);
  }
  state.comps = await window.desktopApi.listComps();
  renderLibrary();
  showToast(comps.length === 1 ? "Comp cut!" : `${comps.length} comps cut!`);
}

function handleOpenComp(compId) {
  // Navigate into comp like a folder — shows the comp's builds in library
  state.currentFolder = { type: "comp", id: compId };
  clearSelection();
  renderLibrary();
}

async function handleRenameComp(compId) {
  const comp = state.comps?.find((c) => c.id === compId);
  if (!comp) return;
  const oldName = comp.name;
  const el = document.querySelector(`#lib-content [data-comp-id="${compId}"]`);
  const newName = await startInlineRename(el, comp.name || "");
  if (!newName) { renderLibrary(); return; }
  await window.desktopApi.saveComp({ ...comp, name: newName });
  state.comps = await window.desktopApi.listComps();
  pushUndoable({ type: "rename-comp", label: `Renamed back to "${oldName}"`, undo: async () => {
    const current = state.comps?.find((c) => c.id === compId);
    if (current) await window.desktopApi.saveComp({ ...current, name: oldName });
    state.comps = await window.desktopApi.listComps();
  }}, `Renamed to "${newName}"`);
  renderLibrary();
}

async function handleDuplicateComp(compId) {
  const comp = state.comps?.find((c) => c.id === compId);
  if (!comp) return;
  const copy = { ...comp };
  delete copy.id;
  copy.name = `Copy of ${comp.name || "Untitled"}`;
  await window.desktopApi.saveComp(copy);
  state.comps = await window.desktopApi.listComps();
  renderLibrary();
}

async function handleDropBuildsOnComp(buildIds, compId) {
  const compBuildIdSet = new Set(
    (state.comps?.find((c) => c.id === compId)?.buildIds) || [],
  );
  const builds = buildIds
    .map((id) => state.builds.find((b) => b.id === id))
    .filter((b) => b && !compBuildIdSet.has(b.id));
  if (builds.length === 0) return;

  // Game mode lock check against the first incompatible build
  const comp = state.comps?.find((c) => c.id === compId);
  for (const build of builds) {
    if (comp && !isGameModeCompatible(comp, build)) {
      const modeName = comp.gameMode === "wvw" ? "WvW" : "PvE";
      showToast(`This comp is locked to ${modeName} builds.`, "error");
      return;
    }
  }

  // Save previous state for undo
  const oldStates = builds.map((b) => ({
    id: b.id,
    folderId: b.folderId || null,
    compIds: [...(b.compIds || [])],
  }));

  for (const build of builds) {
    const newCompIds = [...new Set([...(build.compIds || []), compId])];
    await window.desktopApi.saveBuild({ ...build, compIds: newCompIds });
  }
  if (comp) {
    let currentBuildIds = Array.isArray(comp.buildIds) ? [...comp.buildIds] : [];
    let newGameMode = comp.gameMode;
    for (const build of builds) {
      if (!currentBuildIds.includes(build.id)) {
        currentBuildIds.push(build.id);
        if (!newGameMode) newGameMode = build.gameMode;
      }
    }
    await window.desktopApi.saveComp({ ...comp, gameMode: newGameMode, buildIds: currentBuildIds });
  }
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  pushUndoable({ type: "move-to-comp", label: "Move undone", undo: async () => {
    for (const old of oldStates) {
      const current = state.builds.find((b) => b.id === old.id);
      if (current) await window.desktopApi.saveBuild({ ...current, compIds: old.compIds, folderId: old.folderId });
    }
    const c = state.comps?.find((c) => c.id === compId);
    if (c) {
      const movedIds = new Set(oldStates.map((o) => o.id));
      const ids = (c.buildIds || []).filter((id) => !movedIds.has(id));
      const gameMode = ids.length === 0 ? null : c.gameMode;
      await window.desktopApi.saveComp({ ...c, buildIds: ids, gameMode });
    }
    state.builds = await window.desktopApi.listBuilds();
    state.comps = await window.desktopApi.listComps();
  }}, `Added ${countLabel(oldStates.length, "build")} to ${compLabel(compId)}`);
  clearSelection();
  renderLibrary();
}

async function handleRemoveBuildFromComp(buildId, compId) {
  // Capture comp state before removal for undo
  const comp = state.comps?.find((c) => c.id === compId);
  const oldCompBuildIds = comp ? [...(comp.buildIds || [])] : [];
  const oldCompPartyLines = comp ? JSON.parse(JSON.stringify(comp.partyLines || [])) : [];
  const oldGameMode = comp?.gameMode ?? null;
  // Remove this comp from the build's compIds
  const build = state.builds.find((b) => b.id === buildId);
  if (build) {
    const newCompIds = (build.compIds || []).filter((id) => id !== compId);
    await window.desktopApi.saveBuild({ ...build, compIds: newCompIds });
  }
  // Also clean up comp's buildIds and party line slots
  if (comp) {
    const buildIds = (comp.buildIds || []).filter((id) => id !== buildId);
    const partyLines = (comp.partyLines || []).map((line) => ({
      ...line,
      slots: (line.slots || []).filter((id) => id !== buildId),
    }));
    const gameMode = buildIds.length === 0 ? null : comp.gameMode;
    await window.desktopApi.saveComp({ ...comp, buildIds, partyLines, gameMode });
  }
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  pushUndoable({ type: "remove-from-comp", label: "Build put back", undo: async () => {
    const current = state.builds.find((b) => b.id === buildId);
    if (current) {
      const restoredCompIds = [...new Set([...(current.compIds || []), compId])];
      await window.desktopApi.saveBuild({ ...current, compIds: restoredCompIds });
    }
    // Restore comp's buildIds and partyLines
    const c = state.comps?.find((c) => c.id === compId);
    if (c) await window.desktopApi.saveComp({ ...c, buildIds: oldCompBuildIds, partyLines: oldCompPartyLines, gameMode: oldGameMode });
    state.builds = await window.desktopApi.listBuilds();
    state.comps = await window.desktopApi.listComps();
  }}, `Removed from ${compLabel(compId)}`);
  renderLibrary();
}

async function handleDeleteComps(ids) {
  const count = ids.length;
  for (const id of ids) {
    await window.desktopApi.deleteComp(id);
  }
  // Standing inside one of these comps means currentFolder now names a record
  // that no longer exists. getVisibleBuilds resolves that id to nothing and
  // returns an EMPTY list, so the page reads as "all my builds vanished" until
  // you navigate somewhere else. handleDeleteFolder has always stepped out for
  // exactly this reason; the comp and archive paths never did.
  const wasViewing = state.currentFolder?.type === "comp" && ids.includes(state.currentFolder.id);
  if (wasViewing) state.currentFolder = null;
  state.comps = await window.desktopApi.listComps();
  state.builds = await window.desktopApi.listBuilds();
  clearSelection();
  pushUndoable({
    type: "delete-comps",
    label: `Restored ${countLabel(count, "comp")}`,
    undo: async () => {
      await window.desktopApi.restoreFromTrash({ comps: ids });
      state.comps = await window.desktopApi.listComps();
      state.builds = await window.desktopApi.listBuilds();
    },
  }, `Moved ${countLabel(count, "comp")} to Trash`);
  renderLibrary();
}

async function handleMoveComps(compIds, folderId) {
  // Check if the destination is a team folder (or inside one)
  const destIsTeam = !!teamRootFor(folderId);

  // Collect builds referenced by these comps that live outside the destination folder
  let buildsToMove = [];
  // Builds already in the destination that still need their subfolder info re-synced
  let buildsToResync = [];
  if (destIsTeam) {
    const allBuildIds = compIds.flatMap((id) => {
      const c = state.comps.find((c) => c.id === id);
      return c?.buildIds || [];
    });
    const uniqueBuildIds = [...new Set(allBuildIds)];
    const allRefBuilds = uniqueBuildIds.map((bid) => state.builds?.find((b) => b.id === bid)).filter(Boolean);
    buildsToMove = allRefBuilds.filter((b) => b.folderId !== folderId);
    buildsToResync = allRefBuilds.filter((b) => b.folderId === folderId);

    if (buildsToMove.length > 0) {
      const buildNames = buildsToMove
        .slice(0, 5)
        .map((b) => `<strong>${b.title || "Untitled"}</strong>`)
        .join(", ");
      const extra = buildsToMove.length > 5 ? ` and ${buildsToMove.length - 5} more` : "";
      const confirmed = await showConfirmModal({
        title: "Move builds into the team folder?",
        body: `The comp${compIds.length > 1 ? "s" : ""} reference ${buildsToMove.length} build${buildsToMove.length > 1 ? "s" : ""} outside this folder: ${buildNames}${extra}.<br><br>Those builds will also be moved into the team folder so they stay in sync for everyone.`,
        confirmLabel: "Move All",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
    }
  }

  const oldCompFolderIds = compIds.map((id) => {
    const c = state.comps.find((c) => c.id === id);
    return { id, folderId: c?.folderId || null };
  });
  const oldBuildFolderIds = buildsToMove.map((b) => ({ id: b.id, folderId: b.folderId }));

  for (const id of compIds) {
    const comp = state.comps.find((c) => c.id === id);
    if (!comp) continue;
    await window.desktopApi.saveComp({ ...comp, folderId: folderId ?? null });
  }
  for (const build of buildsToMove) {
    await window.desktopApi.saveBuild({ ...build, folderId: folderId ?? null });
  }
  // Re-save builds already in the destination so their subfolder info syncs to GitHub
  for (const build of buildsToResync) {
    await window.desktopApi.saveBuild({ ...build });
  }

  state.comps = await window.desktopApi.listComps();
  if (buildsToMove.length > 0 || buildsToResync.length > 0) {
    state.builds = await window.desktopApi.listBuilds();
  }

  pushUndoable({
    type: "move-comps",
    label: countLabel(compIds.length, "comp") + " moved back",
    undo: async () => {
      for (const { id, folderId } of oldCompFolderIds) {
        const comp = state.comps.find((c) => c.id === id);
        if (comp) await window.desktopApi.saveComp({ ...comp, folderId });
      }
      for (const { id, folderId } of oldBuildFolderIds) {
        const build = state.builds?.find((b) => b.id === id);
        if (build) await window.desktopApi.saveBuild({ ...build, folderId });
      }
      state.comps = await window.desktopApi.listComps();
      if (oldBuildFolderIds.length > 0) state.builds = await window.desktopApi.listBuilds();
    },
  }, `Moved ${countLabel(compIds.length, "comp")} to ${folderLabel(folderId)}`);
  renderLibrary();
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

  // Pull latest from remote when navigating into a team folder
  const folderObj = state.folders.find((f) => f.id === folderId);
  if (folderObj) {
    const root = teamRootFor(folderId);
    if (root) {
      window.desktopApi.pullTeam(root.teamId).then(async () => {
        state.builds = await window.desktopApi.listBuilds();
        state.comps = await window.desktopApi.listComps();
        state.folders = await window.desktopApi.listFolders();
        renderLibrary();
      }).catch(() => {
        // Silently fail — will sync on next poll
      });
    }
  }
}

async function handleMoveFolder(folderId, newParentId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const oldParentId = folder.parentId || null;
  await saveFolder({ ...folder, parentId: newParentId ?? null });
  pushUndoable({ type: "move-folder", label: "Folder moved back", undo: async () => {
    const current = state.folders.find((f) => f.id === folderId);
    if (current) await saveFolder({ ...current, parentId: oldParentId });
  }}, `Moved "${folderLabel(folderId)}" to ${folderLabel(newParentId)}`);
  renderLibrary();
}

export async function handleRenameFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const oldName = folder.name;
  // Prefer the content-area row so rename works when viewing inside a shared
  // folder (where the sidebar may not have a nav item for the subfolder).
  const contentEl = document.querySelector(`#lib-content [data-folder-id="${folderId}"]`);
  const navItem = contentEl || document.querySelector(`[data-navigate-folder="${folderId}"]`);
  const container = !navItem ? document.getElementById("lib-content") : null;
  const newName = await insertInlineInput(navItem, folder.name || "", { container });
  if (!newName) { renderLibrary(); return; }
  // main refuses some renames outright — a team root, or a folder you only have
  // read access to — and the rejection used to escape unhandled: the inline input
  // had already removed itself, so a refused rename was indistinguishable from a
  // menu item that did nothing at all. Every refusal has a reason; say it.
  try {
    await saveFolder({ ...folder, name: newName });
  } catch (err) {
    showToast(err?.message || "Could not rename that folder.", "error");
    renderLibrary();
    return;
  }
  pushUndoable({ type: "rename-folder", label: `Renamed back to "${oldName}"`, undo: async () => {
    const current = state.folders.find((f) => f.id === folderId);
    if (current) await saveFolder({ ...current, name: oldName });
  }}, `Renamed to "${newName}"`);
  renderLibrary();
}

async function handleRenameTeam(teamId) {
  // Shares promptRenameTeam with the Manage team dialog rather than re-deriving
  // it: a team rename also rewrites its root folder, so a second copy here would
  // be a second chance for the two to disagree about what a rename does.
  const err = await promptRenameTeam(teamId, { onRefresh: async () => {
    await loadFolders();
  } });
  if (err) { showToast(err, "error"); return; }
  renderLibrary();
}

async function handleNewSubfolder(parentId) {
  const content = document.getElementById("lib-content");
  if (!content) return;
  // Pass container so insertInlineInput detects the correct view type (grid/icon/list).
  // Without container, view detection fails and the input uses sidebar styling.
  const folderEl = content.querySelector(`[data-folder-id="${parentId}"]`);
  const name = await insertInlineInput(folderEl, "", {
    container: content,
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
  // A team root folder goes away by leaving/deleting the team, not from here.
  if (teamRootFor(folderId)?.id === folderId) {
    showToast("Leave or delete the team in Settings → Teams.", "info");
    return;
  }
  const name = folder?.name || "this folder";
  // The subtree and everything in it goes to the trash as one batch, so the
  // builds inside keep their folder and come back with it.
  const wasViewing = state.currentFolder?.id === folderId;
  await deleteFolder(folderId);
  if (wasViewing) {
    state.currentFolder = null;
  }
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  pushUndoable({
    type: "delete-folder",
    label: `Restored folder "${name}"`,
    undo: async () => {
      await window.desktopApi.restoreFromTrash({ folders: [folderId] });
      state.builds = await window.desktopApi.listBuilds();
      state.comps = await window.desktopApi.listComps();
      if (wasViewing) {
        state.currentFolder = state.folders.find((f) => f.id === folderId) || null;
      }
    },
  }, `Moved "${name}" to Trash`);
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
    const sidebarWidth = await window.desktopApi.getSetting("library.sidebarWidth");
    const sidebarExpandedFolders = await window.desktopApi.getSetting("library.sidebarExpandedFolders");
    const activeFilters = await window.desktopApi.getSetting("library.activeFilters");

    if (viewMode != null) state.libraryPrefs.viewMode = viewMode;
    if (sortField != null) state.libraryPrefs.sortField = sortField;
    if (sortDirection != null) state.libraryPrefs.sortDirection = sortDirection;
    if (sidebarOpen != null) state.libraryPrefs.sidebarOpen = sidebarOpen;
    if (sidebarWidth != null) state.libraryPrefs.sidebarWidth = clampSidebarWidth(sidebarWidth);
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
    await window.desktopApi.setSetting("library.sidebarWidth", p.sidebarWidth);
    await window.desktopApi.setSetting("library.sidebarExpandedFolders", p.sidebarExpandedFolders);
    await window.desktopApi.setSetting("library.activeFilters", p.activeFilters);
  } catch {
    // Settings write failure is non-fatal
  }
}

// ─── Shared callbacks object ───────────────────────────────────────────────────

function _buildSharedCallbacks() {
  return {
    // Open a Settings pane (used by the legacy-library orphan banner).
    onOpenSettings: (pane) => _app.openSettings?.(pane),

    // Trash
    onTrashRestore: handleTrashRestore,
    onTeamTrashRestore: handleTeamTrashRestore,
    onTrashPurge: handleTrashPurge,
    onTrashEmpty: handleTrashEmpty,

    // Archive
    onArchive: handleArchive,
    onArchiveRestore: handleArchiveRestore,
    onArchiveOpen: handleArchiveOpen,

    // Toolbar
    onNewBuild: handleNewBuild,
    onNewFolder: handleNewFolderInContent,
    onNewFolderSidebar: handleNewFolder,
    onNewComp: handleNewComp,

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

    async onNavigate(folder) {
      state.currentFolder = folder || null;
      // The trash lives in the main process, not in state.builds — it has to be
      // fetched on the way in, and again after anything changes it.
      if (folder?.type === "trash") await refreshTrash();
      if (folder?.type === "archive") await refreshArchive();
      clearSelection();
      savePrefs();
      renderLibrary();
    },

    // Content / build actions
    onLoadBuild: handleLoadBuild,
    onOpenComp: handleOpenComp,
    onRenameComp: handleRenameComp,
    onDuplicateComp: handleDuplicateComp,
    onDropBuildsOnComp: handleDropBuildsOnComp,
    onRemoveBuildFromComp: handleRemoveBuildFromComp,
    onDeleteComps: handleDeleteComps,
    onMoveComps: handleMoveComps,
    onCopyCompJson: handleCopyCompJson,
    onCutCompJson: handleCutCompJson,
    onRename: handleRename,
    onDuplicate: handleDuplicate,
    onTogglePin: handleTogglePin,
    onPinAll: handlePinAll,
    onMoveTo: handleMoveTo,
    onDelete: handleDelete,
    onCopyJson: handleCopyJson,
    onCutJson: handleCutJson,
    onCopyChatLink: handleCopyChatLink,
    onCopyShareCode: handleCopyShareCode,
    onDiscordCopy: handleDiscordCopy,
    onDiscordEmbed: handleDiscordEmbed,
    onImportChatLink: handleImportChatLink,
    onImportGw2Skills: handleImportGw2Skills,
    onImportAxiLink: handleImportAxiLink,
    onImportShareCode: handleImportShareCode,
    onExportAxicode: handleExportAxicode,
    onExportAxicodeFolder: handleExportAxicodeFolder,
    onImportAxicodeFile: handleImportAxicodeFile,
    onPasteJson: handlePasteJson,
    onPublish: handlePublish,
    onBuildInfo: handleBuildInfo,
    onViewHistory: (buildId) => showHistoryPanel(buildId),
    onViewCompHistory: (compId) => showCompHistoryPanel(compId),
    onViewFolderHistory: (folderId, folderName) => showFolderHistoryPanel(folderId, folderName),
    onEditTags: handleEditTags,

    // Folder actions
    onOpenFolder: handleOpenFolder,
    onMoveFolder: handleMoveFolder,
    onRenameFolder: handleRenameFolder,
    onRenameTeam: handleRenameTeam,
    onNewSubfolder: handleNewSubfolder,
    onNewBuildInFolder: handleNewBuildInFolder,
    onDeleteFolder: handleDeleteFolder,
    onNewFolderAndMove: handleNewFolderAndMove,

    // Selection
    onSelectAll: selectAll,

    // Refresh (used by drag-drop)
    onRefresh: renderLibrary,
    onToast: showToast,
  };
}

// ─── Dialog helpers (Electron doesn't support window.prompt/confirm/alert) ────
// showPrompt lives in ../prompt-modal.js — settings-modal.js needs it too.

function fieldHtml({ id, label, placeholder, statusId }) {
  return `
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px;">${label}</label>
            <input
              type="text"
              id="${id}"
              placeholder="${placeholder}"
              style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
            ${statusId ? `<div id="${statusId}" style="font-size:0.75rem;min-height:1.2em;margin-top:3px;color:var(--text-dim);"></div>` : ""}
          </div>`;
}

// A name field that stops auto-filling itself once the user has typed in it.
function autoNameField(input) {
  input.addEventListener("input", () => { input.dataset.autoFilled = "0"; });
  return (name) => {
    if (!input.value || input.dataset.autoFilled === "1") {
      input.value = name;
      input.dataset.autoFilled = "1";
    }
  };
}

function statusSetter(el) {
  return (msg, color) => { el.textContent = msg; el.style.color = color; };
}

function showImportModal() {
  return showFormModal({
    title: "Import Build Link",
    width: 420,
    confirmLabel: "Import",
    body:
      fieldHtml({ id: "import-link-input", label: "Build Link", placeholder: "Paste [&amp;...] chat link here", statusId: "import-link-status" })
      + fieldHtml({ id: "import-name-input", label: "Build Name", placeholder: "Build name" }),
    setup: ({ overlay, confirm }) => {
      const linkInput = overlay.querySelector("#import-link-input");
      const nameInput = overlay.querySelector("#import-name-input");
      const setStatus = statusSetter(overlay.querySelector("#import-link-status"));
      const suggestName = autoNameField(nameInput);
      let previewTimer = null;

      linkInput.addEventListener("input", () => {
        const val = linkInput.value.trim();
        clearTimeout(previewTimer);
        confirm.disabled = true;
        if (!val) { setStatus("", "#556"); return; }
        if (!val.startsWith("[&") || !val.endsWith("]")) {
          setStatus("Not a valid chat link format", "#c55");
          return;
        }
        setStatus("Decoding…", "#889");
        previewTimer = setTimeout(async () => {
          try {
            const { profession, eliteSpec } = await window.desktopApi.previewChatLink(val);
            suggestName(eliteSpec ? `Imported ${eliteSpec}` : `Imported ${profession}`);
            setStatus(`✓ ${profession}${eliteSpec ? ` — ${eliteSpec}` : ""}`, "#5a5");
            confirm.disabled = false;
          } catch {
            setStatus("Could not decode link", "#c55");
          }
        }, 400);
      });

      return () => ({ link: linkInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
    },
  });
}

function showGw2SkillsImportModal() {
  return showFormModal({
    title: "Import from GW2Skills",
    width: 460,
    confirmLabel: "Import",
    body:
      fieldHtml({ id: "gw2s-url-input", label: "GW2Skills URL", placeholder: "https://gw2skills.net/editor/?...", statusId: "gw2s-url-status" })
      + fieldHtml({ id: "gw2s-name-input", label: "Build Name", placeholder: "Build name" }),
    setup: ({ overlay, confirm }) => {
      const urlInput = overlay.querySelector("#gw2s-url-input");
      const nameInput = overlay.querySelector("#gw2s-name-input");
      const setStatus = statusSetter(overlay.querySelector("#gw2s-url-status"));
      autoNameField(nameInput);

      urlInput.addEventListener("input", () => {
        const val = urlInput.value.trim();
        confirm.disabled = true;
        if (!val) { setStatus("", "#556"); return; }
        if (!val.includes("gw2skills.net/editor/?") || val.split("?")[1]?.length < 5) {
          setStatus("Not a valid GW2Skills URL", "#c55");
          return;
        }
        setStatus("✓ Valid GW2Skills URL", "#5a5");
        confirm.disabled = false;
      });

      return () => ({ url: urlInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
    },
  });
}

function showAxicodeBuildPickerModal(builds) {
  const rows = builds
    .map((build, i) => {
      const label = escapeHtml(build.title || build.name || "Untitled");
      return `<button class="confirm-modal__btn" data-index="${i}" style="width:100%;text-align:left;margin-bottom:6px;">${label}</button>`;
    })
    .join("");

  return showFormModal({
    title: "Choose a build to import",
    width: 460,
    // Every row is its own confirm, so there is no single button to press.
    body: `<div style="display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow-y:auto;">${rows}</div>`,
    setup: ({ overlay, close }) => {
      overlay.querySelectorAll("[data-index]").forEach((btn) => {
        btn.addEventListener("click", () => close(builds[Number(btn.dataset.index)]));
      });
    },
  });
}

function showAxiLinkImportModal() {
  return showFormModal({
    title: "Import from AxiForge Link",
    width: 460,
    confirmLabel: "Import",
    body:
      fieldHtml({ id: "axilink-url-input", label: "Published build or comp link", placeholder: "https://someone.github.io/axibuilds/?n=...&amp;b=...", statusId: "axilink-url-status" })
      + fieldHtml({ id: "axilink-name-input", label: `Name <span style="color:var(--text-dim);">(optional)</span>`, placeholder: "Keep the published name" }),
    setup: ({ overlay, confirm }) => {
      const urlInput = overlay.querySelector("#axilink-url-input");
      const nameInput = overlay.querySelector("#axilink-name-input");
      const setStatus = statusSetter(overlay.querySelector("#axilink-url-status"));

      urlInput.addEventListener("input", () => {
        const val = urlInput.value.trim();
        confirm.disabled = true;
        if (!val) { setStatus("", "#556"); return; }
        // Mirrors what parseAxiLink accepts: a ?b=/?c=/?legacy= ref, the oldest
        // bare #id.key hash, or a /r/<id>/ short link.
        const isComp = /[?&]c=[^.&]+\.[^&]/.test(val);
        const isBuild = /[?&](?:b|legacy)=[^.&]+\.[^&]/.test(val) || /#[^.#]+\.[^#]/.test(val) || /\/r\/[^/]+\/?$/.test(val);
        if (!isComp && !isBuild) { setStatus("Not an AxiForge build or comp link", "#c55"); return; }
        // A short link (/r/<id>/) can be either — only the redirect it serves says
        // which, and that is a network round-trip the import itself makes.
        setStatus(isComp ? "✓ Comp link — imports the comp and its builds into a new folder" : "✓ Valid AxiForge link", "#5a5");
        confirm.disabled = false;
      });

      return () => ({ url: urlInput.value.trim(), name: nameInput.value.trim() });
    },
  });
}

function showShareCodeImportModal() {
  return showFormModal({
    title: "Import AxiCode",
    width: 420,
    confirmLabel: "Import",
    body:
      fieldHtml({ id: "sharecode-input", label: "AxiCode", placeholder: "Paste &lt;AxiForge:...&gt; AxiCode here", statusId: "sharecode-status" })
      + fieldHtml({ id: "sharecode-name-input", label: "Build Name", placeholder: "Build name" }),
    setup: ({ overlay, confirm }) => {
      const codeInput = overlay.querySelector("#sharecode-input");
      const nameInput = overlay.querySelector("#sharecode-name-input");
      const setStatus = statusSetter(overlay.querySelector("#sharecode-status"));
      const suggestName = autoNameField(nameInput);

      codeInput.addEventListener("input", () => {
        const val = codeInput.value.trim();
        confirm.disabled = true;
        if (!val) { setStatus("", "#556"); return; }
        if (!val.startsWith("<AxiForge:") || !val.endsWith(">")) {
          setStatus("Not a valid AxiCode format", "#c55");
          return;
        }
        // The label is the part between the first and second colon.
        const label = val.slice(1, -1).split(":")[1] || "";
        if (label) {
          setStatus(`✓ ${label}`, "#5a5");
          suggestName(`Imported ${label}`);
        } else {
          setStatus("✓ Valid AxiCode", "#5a5");
        }
        confirm.disabled = false;
      });

      return () => ({ code: codeInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
    },
  });
}

/**
 * Show a confirm dialog. Returns true/false.
 */
function showConfirm(title, body = "") {
  return showConfirmModal({ title, body, confirmLabel: "Confirm", cancelLabel: "Cancel" });
}
