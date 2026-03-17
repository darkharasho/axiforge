// Library drag-and-drop module.
// Uses event delegation on #lib-content — a single set of handlers catches
// all drag events regardless of how/when child elements are rendered.

import { getSelection } from "./selection.js";
import { moveBuilds } from "./folder-store.js";
import { state } from "../state.js";

let _callbacks = {};
let _draggedIds = [];
let _rootDropZone = null;
let _bound = false;

export function initDragDrop(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Wire drag-drop via delegation. Only needs to be called once — the
 * delegated handlers on #lib-content work for any child elements
 * added later by renderContent().
 */
export function wireDragDropEvents() {
  const content = document.getElementById("lib-content");
  if (!content || _bound) return;
  _bound = true;

  // --- DRAGOVER: always allow drops everywhere in #lib-content ---
  content.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // Highlight the nearest folder drop target
    const folderEl = e.target.closest("[data-folder-id]");
    // Remove previous highlights
    content.querySelectorAll(".lib-drop-target").forEach((n) => n.classList.remove("lib-drop-target"));
    if (folderEl) {
      folderEl.classList.add("lib-drop-target");
    }
  });

  // --- DRAGSTART: on any [data-build-id][draggable] ---
  content.addEventListener("dragstart", (e) => {
    const buildEl = e.target.closest("[data-build-id]");
    if (!buildEl) return;

    const buildId = buildEl.dataset.buildId;
    const sel = getSelection();
    _draggedIds = (sel.length > 1 && sel.includes(buildId)) ? [...sel] : [buildId];

    e.dataTransfer.setData("text/plain", JSON.stringify(_draggedIds));
    e.dataTransfer.effectAllowed = "move";
    buildEl.classList.add("lib-dragging");

    // Show root drop zone if build is in a folder
    if (state.builds.find((b) => b.id === buildId)?.folderId) {
      _showRootDropZone();
    }
  });

  // --- DRAGEND: clean up ---
  content.addEventListener("dragend", (e) => {
    const buildEl = e.target.closest("[data-build-id]");
    if (buildEl) buildEl.classList.remove("lib-dragging");
    content.querySelectorAll(".lib-drop-target").forEach((n) => n.classList.remove("lib-drop-target"));
    _hideRootDropZone();
    setTimeout(() => { _draggedIds = []; }, 50);
  });

  // --- DROP: delegate to folder or root ---
  content.addEventListener("drop", async (e) => {
    e.preventDefault();
    content.querySelectorAll(".lib-drop-target").forEach((n) => n.classList.remove("lib-drop-target"));

    const ids = _getDragIds(e);
    if (!ids.length) return;

    // Find the nearest folder drop target
    const folderEl = e.target.closest("[data-folder-id]");
    const targetFolderId = folderEl?.dataset.folderId || null;

    // If dropping on the same folder the builds are already in, move to parent folder or root
    if (targetFolderId && ids.every((id) => state.builds.find((b) => b.id === id)?.folderId === targetFolderId)) {
      const folder = state.folders.find((f) => f.id === targetFolderId);
      const parentId = folder?.parentId || null;
      await moveBuilds(ids, parentId);
    } else {
      await moveBuilds(ids, targetFolderId);
    }
    _draggedIds = [];
    _hideRootDropZone();
    _callbacks.onRefresh?.();
  });

  // --- Also wire sidebar folder drop targets ---
  _wireSidebarDropTargets();
}

function _wireSidebarDropTargets() {
  const sidebar = document.getElementById("lib-sidebar");
  if (!sidebar || sidebar.dataset.dndBound) return;
  sidebar.dataset.dndBound = "1";

  sidebar.addEventListener("dragover", (e) => {
    const target = e.target.closest("[data-navigate-folder], [data-navigate-all]");
    if (!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    target.classList.add("lib-drop-target");
  });

  sidebar.addEventListener("dragleave", (e) => {
    const target = e.target.closest("[data-navigate-folder], [data-navigate-all]");
    if (target && !target.contains(e.relatedTarget)) {
      target.classList.remove("lib-drop-target");
    }
  });

  sidebar.addEventListener("drop", async (e) => {
    const target = e.target.closest("[data-navigate-folder], [data-navigate-all]");
    if (!target) return;
    e.preventDefault();
    target.classList.remove("lib-drop-target");

    const ids = _getDragIds(e);
    if (!ids.length) return;

    const folderId = target.dataset.navigateFolder || null;
    await moveBuilds(ids, folderId);
    _draggedIds = [];
    _hideRootDropZone();
    _callbacks.onRefresh?.();
  });
}

// --- Root drop zone ---

function _showRootDropZone() {
  if (_rootDropZone) return;
  const content = document.getElementById("lib-content");
  if (!content) return;

  _rootDropZone = document.createElement("div");
  _rootDropZone.className = "lib-root-drop-zone";
  _rootDropZone.textContent = "Drop here to move to root";
  content.prepend(_rootDropZone);

  _rootDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    _rootDropZone.classList.add("lib-root-drop-zone--active");
  });

  _rootDropZone.addEventListener("dragleave", () => {
    _rootDropZone?.classList.remove("lib-root-drop-zone--active");
  });

  _rootDropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = _getDragIds(e);
    if (!ids.length) return;
    await moveBuilds(ids, null);
    _draggedIds = [];
    _hideRootDropZone();
    _callbacks.onRefresh?.();
  });
}

function _hideRootDropZone() {
  if (_rootDropZone) {
    _rootDropZone.remove();
    _rootDropZone = null;
  }
}

function _getDragIds(e) {
  if (_draggedIds.length) return [..._draggedIds];
  try {
    const p = JSON.parse(e.dataTransfer.getData("text/plain"));
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}
