// Library orchestrator — wires all library sub-modules together.
// This is the main entry point for the library page.

import { state } from "../state.js";
import { normalizeImportedSkills } from "../editor.js";

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
  getCompSelection,
  clearSelection,
  selectAll,
  navigateSelection,
  wireSelectionEvents,
} from "./selection.js";
import { initDragDrop, wireDragDropEvents } from "./drag-drop.js";
import { compIcon } from "./heroicons.js";
import { pushUndo, popUndo } from "./undo.js";
import { handleAxicodeExport, handleAxicodeImport } from "./axicode-io.js";

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
    state.sharedLibraryConfig = await window.desktopApi.getSharedLibraryConfig().catch(() => null);
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
        const action = popUndo();
        if (action) {
          await action.undo();
          renderLibrary();
          showToast("Undone!");
        }
      }
      break;
  }
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

function handleLoadBuild(buildId) {
  if (!_app.confirmDiscardDirty?.("Load another build")) return;
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
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
  const titleEl =
    itemEl.querySelector(".lib-list-row__title") ||
    itemEl.querySelector(".lib-grid-card__title") ||
    itemEl.querySelector(".lib-icon-item__label") ||
    itemEl.querySelector(".lib-tv__name");
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
  await window.desktopApi.saveBuild({ ...build, title: newTitle });
  state.builds = await window.desktopApi.listBuilds();
  pushUndo({ type: "rename-build", undo: async () => {
    const current = state.builds.find((b) => b.id === buildId);
    if (current) await window.desktopApi.saveBuild({ ...current, title: oldTitle });
    state.builds = await window.desktopApi.listBuilds();
  }});
  renderLibrary();
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
  pushUndo({ type: "move-builds", undo: async () => {
    for (const { id, folderId } of oldFolderIds) {
      const build = state.builds.find((b) => b.id === id);
      if (build) await window.desktopApi.saveBuild({ ...build, folderId });
    }
    state.builds = await window.desktopApi.listBuilds();
  }});
  renderLibrary();
}

async function handleDelete(ids) {
  const count = ids.length;
  const label = count === 1 ? "this build" : `${count} builds`;

  const affectedComps = new Set();
  for (const id of ids) {
    const build = state.builds.find((b) => b.id === id);
    if (build && Array.isArray(build.compIds)) {
      for (const cid of build.compIds) affectedComps.add(cid);
    }
  }
  let detail = "This cannot be undone.";
  if (affectedComps.size > 0) {
    const compNames = [...affectedComps]
      .map((cid) => (state.comps || []).find((c) => c.id === cid)?.name || "Untitled Comp")
      .join(", ");
    detail = `${count === 1 ? "This build is" : "These builds are"} linked to ${affectedComps.size} comp${affectedComps.size !== 1 ? "s" : ""}: ${compNames}. Deleting will remove ${count === 1 ? "it" : "them"} from ${affectedComps.size === 1 ? "that comp" : "those comps"}. This cannot be undone.`;
  }

  const confirmed = await showConfirm(`Delete ${label}?`, detail);
  if (!confirmed) return;
  for (const id of ids) {
    await window.desktopApi.deleteBuild(id);
  }
  state.builds = await window.desktopApi.listBuilds();
  clearSelection();
  renderLibrary();
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

let _toastEl = null;
let _toastTimer = null;
export function showToast(message, type = "success") {
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
    const webhookUrl = await window.desktopApi.getSetting("discord.buildWebhookUrl");
    if (!webhookUrl) {
      showToast("Set build webhook URL in Settings first", "error");
      return;
    }

    // Auto-publish if not yet published
    let build = state.builds.find((b) => b.id === buildId);
    if (!build?.publishedFileId) {
      showToast("Publishing first...");
      await window.desktopApi.publishBuild(buildId);
      state.builds = await window.desktopApi.listBuilds();
      renderLibrary();
    }

    const result = await window.desktopApi.shareBuildToDiscord(buildId);
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

async function handleImportGw2Skills(targetFolderId) {
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  const result = await showGw2SkillsImportModal();
  if (!result) return;
  showToast("Importing from GW2Skills\u2026", "loading");
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const saved = await window.desktopApi.importGw2Skills(result.url, result.name, folderId, gameMode);
    await addImportedBuildToActiveComp(saved);
    state.builds = await window.desktopApi.listBuilds();
    renderLibrary();
    window.desktopApi.prewarmChatLinks?.([saved]);
    showToast(`"${saved.title}" imported`);
  } catch (err) {
    console.error("GW2Skills import failed:", err);
    showToast("GW2Skills import failed", "error");
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

async function handleImportAxicodeFile(targetFolderId) {
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
      pushUndo({ type: "cut-paste", undo: async () => {
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
      }});
      clearSelection();
      renderLibrary();
      showToast(filteredToMove.length === 1 ? "Build moved!" : `${filteredToMove.length} builds moved!`);
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
      pushUndo({ type: "paste", undo: async () => {
        for (const id of pastedIds) await window.desktopApi.deleteBuild(id);
        state.builds = await window.desktopApi.listBuilds();
        if (compId) state.comps = await window.desktopApi.listComps();
      }});
    }
    renderLibrary();
    showToast(savedCount === 1 ? "Build pasted!" : `${savedCount} builds pasted!`);
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
  pushUndo({ type: "rename-comp", undo: async () => {
    const current = state.comps?.find((c) => c.id === compId);
    if (current) await window.desktopApi.saveComp({ ...current, name: oldName });
    state.comps = await window.desktopApi.listComps();
  }});
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
  pushUndo({ type: "move-to-comp", undo: async () => {
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
  }});
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
  pushUndo({ type: "remove-from-comp", undo: async () => {
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
  }});
  renderLibrary();
}

async function handleDeleteComps(ids) {
  const count = ids.length;
  const label = count === 1 ? "this comp" : `${count} comps`;
  const confirmed = await showConfirm(`Delete ${label}?`, "This cannot be undone.");
  if (!confirmed) return;
  for (const id of ids) {
    await window.desktopApi.deleteComp(id);
  }
  state.comps = await window.desktopApi.listComps();
  state.builds = await window.desktopApi.listBuilds();
  clearSelection();
  renderLibrary();
}

async function handleMoveComps(compIds, folderId) {
  const oldFolderIds = compIds.map((id) => {
    const c = state.comps.find((c) => c.id === id);
    return { id, folderId: c?.folderId || null };
  });
  for (const id of compIds) {
    const comp = state.comps.find((c) => c.id === id);
    if (!comp) continue;
    await window.desktopApi.saveComp({ ...comp, folderId: folderId ?? null });
  }
  state.comps = await window.desktopApi.listComps();
  pushUndo({ type: "move-comps", undo: async () => {
    for (const { id, folderId } of oldFolderIds) {
      const comp = state.comps.find((c) => c.id === id);
      if (comp) await window.desktopApi.saveComp({ ...comp, folderId });
    }
    state.comps = await window.desktopApi.listComps();
  }});
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

  // Pull latest from remote when navigating to a shared folder
  const folderObj = state.folders.find((f) => f.id === folderId);
  if (folderObj?.shared) {
    window.desktopApi.pullFolder(folderId).then(async () => {
      state.builds = await window.desktopApi.listBuilds();
      state.comps = await window.desktopApi.listComps();
      state.folders = await window.desktopApi.listFolders();
      renderLibrary();
    }).catch(() => {
      // Silently fail — will sync on next poll
    });
  }
}

async function handleMoveFolder(folderId, newParentId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const oldParentId = folder.parentId || null;
  await saveFolder({ ...folder, parentId: newParentId ?? null });
  pushUndo({ type: "move-folder", undo: async () => {
    const current = state.folders.find((f) => f.id === folderId);
    if (current) await saveFolder({ ...current, parentId: oldParentId });
  }});
  renderLibrary();
}

async function handleRenameFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const oldName = folder.name;
  // Find the folder's nav item in sidebar and replace label with inline input
  const navItem = document.querySelector(`[data-navigate-folder="${folderId}"]`);
  const newName = await insertInlineInput(navItem, folder.name || "");
  if (!newName) { renderLibrary(); return; }
  await saveFolder({ ...folder, name: newName });
  pushUndo({ type: "rename-folder", undo: async () => {
    const current = state.folders.find((f) => f.id === folderId);
    if (current) await saveFolder({ ...current, name: oldName });
  }});
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

    onNavigate(folder) {
      state.currentFolder = folder || null;
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
    onImportShareCode: handleImportShareCode,
    onExportAxicode: handleExportAxicode,
    onExportAxicodeFolder: handleExportAxicodeFolder,
    onImportAxicodeFile: handleImportAxicodeFile,
    onPasteJson: handlePasteJson,
    onPublish: handlePublish,
    onBuildInfo: handleBuildInfo,
    onEditTags: handleEditTags,

    // Folder actions
    onOpenFolder: handleOpenFolder,
    onMoveFolder: handleMoveFolder,
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
          <input type="text" class="confirm-modal__input" value="" style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;" />
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
            <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px;">Build Link</label>
            <input
              type="text"
              id="import-link-input"
              placeholder="Paste [&amp;...] chat link here"
              style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
            <div id="import-link-status" style="font-size:0.75rem;min-height:1.2em;margin-top:3px;color:var(--text-dim);"></div>
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px;">Build Name</label>
            <input
              type="text"
              id="import-name-input"
              placeholder="Build name"
              style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;box-sizing:border-box;"
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
            <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px;">GW2Skills URL</label>
            <input
              type="text"
              id="gw2s-url-input"
              placeholder="https://gw2skills.net/editor/?..."
              style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
            <div id="gw2s-url-status" style="font-size:0.75rem;min-height:1.2em;margin-top:3px;color:var(--text-dim);"></div>
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px;">Build Name</label>
            <input
              type="text"
              id="gw2s-name-input"
              placeholder="Build name"
              style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;box-sizing:border-box;"
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

function showShareCodeImportModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal" style="width:420px;max-width:90vw;">
        <div class="confirm-modal__header">
          <h3 class="confirm-modal__title">Import AxiCode</h3>
        </div>
        <div class="confirm-modal__body" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px;">AxiCode</label>
            <input
              type="text"
              id="sharecode-input"
              placeholder="Paste <AxiForge:...> AxiCode here"
              style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;box-sizing:border-box;"
            />
            <div id="sharecode-status" style="font-size:0.75rem;min-height:1.2em;margin-top:3px;color:var(--text-dim);"></div>
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px;">Build Name</label>
            <input
              type="text"
              id="sharecode-name-input"
              placeholder="Build name"
              style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;box-sizing:border-box;"
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

    const codeInput = overlay.querySelector("#sharecode-input");
    const nameInput = overlay.querySelector("#sharecode-name-input");
    const statusEl = overlay.querySelector("#sharecode-status");
    const importBtn = overlay.querySelector('[data-action="import"]');
    let codeValid = false;

    codeInput.focus();

    function setStatus(msg, color) {
      statusEl.textContent = msg;
      statusEl.style.color = color;
    }

    codeInput.addEventListener("input", () => {
      const val = codeInput.value.trim();
      importBtn.disabled = true;
      codeValid = false;
      if (!val) { setStatus("", "#556"); return; }
      if (!val.startsWith("<AxiForge:") || !val.endsWith(">")) {
        setStatus("Not a valid AxiCode format", "#c55");
        return;
      }
      // Extract the label (part between first : and second :)
      const inner = val.slice(1, -1); // remove < and >
      const parts = inner.split(":");
      const label = parts.length >= 2 ? parts[1] : "";
      if (label) {
        setStatus(`\u2713 ${label}`, "#5a5");
        if (!nameInput.value || nameInput.dataset.autoFilled === "1") {
          nameInput.value = `Imported ${label}`;
          nameInput.dataset.autoFilled = "1";
        }
      } else {
        setStatus("\u2713 Valid AxiCode", "#5a5");
      }
      codeValid = true;
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
      if (e.key === "Enter" && codeValid) {
        dismiss({ code: codeInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
      }
    }

    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => dismiss(null));
    importBtn.addEventListener("click", () => {
      dismiss({ code: codeInput.value.trim(), name: nameInput.value.trim() || "Imported Build" });
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
