// Library drag-and-drop module — HTML5 drag-and-drop for moving builds to folders.
// Simplified: uses data attributes to prevent duplicate binding.

import { getSelection } from "./selection.js";
import { moveBuilds } from "./folder-store.js";
import { state } from "../state.js";

let _callbacks = {};
let _draggedIds = [];
let _rootDropZone = null;

export function initDragDrop(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Wire drag handlers on rendered elements.
 * Uses data-* flags to prevent duplicate binding since the container
 * element (#lib-content) persists across renders.
 */
export function wireDragDropEvents() {
  // Build items — draggable sources
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    if (el.dataset.dndBound) return;
    el.dataset.dndBound = "1";
    el.draggable = true;

    el.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      const buildId = el.dataset.buildId;
      const sel = getSelection();
      _draggedIds = (sel.length > 1 && sel.includes(buildId)) ? [...sel] : [buildId];

      e.dataTransfer.setData("text/plain", JSON.stringify(_draggedIds));
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("lib-dragging");

      // Show root drop zone if this build is in a folder
      if (state.builds.find((b) => b.id === buildId)?.folderId) {
        _showRootDropZone();
      }
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("lib-dragging");
      document.querySelectorAll(".lib-drop-target").forEach((n) => n.classList.remove("lib-drop-target"));
      _hideRootDropZone();
      setTimeout(() => { _draggedIds = []; }, 50);
    });
  });

  // Folder items — drop targets (content area + sidebar)
  document.querySelectorAll("[data-folder-id]").forEach((el) => {
    if (el.dataset.dropBound) return;
    el.dataset.dropBound = "1";
    _bindDropTarget(el, el.dataset.folderId);
  });

  document.querySelectorAll("[data-navigate-folder]").forEach((el) => {
    if (el.dataset.dropBound) return;
    el.dataset.dropBound = "1";
    _bindDropTarget(el, el.dataset.navigateFolder);
  });

  // Sidebar "All Builds" — drop to move to root
  document.querySelectorAll("[data-navigate-all]").forEach((el) => {
    if (el.dataset.dropBound) return;
    el.dataset.dropBound = "1";
    _bindDropTarget(el, null);
  });
}

function _bindDropTarget(el, folderId) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("lib-drop-target");
  });

  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove("lib-drop-target");
    }
  });

  el.addEventListener("drop", async (e) => {
    el.classList.remove("lib-drop-target");
    const ids = _getDragIds(e);
    if (!ids.length) return;

    // Skip if builds already in this folder (let event bubble to parent)
    if (folderId && ids.every((id) => state.builds.find((b) => b.id === id)?.folderId === folderId)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    await moveBuilds(ids, folderId ?? null);
    _draggedIds = [];
    _hideRootDropZone();
    _callbacks.onRefresh?.();
  });
}

// ─── Root drop zone (visible bar at top during drag-from-folder) ───────────────

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
