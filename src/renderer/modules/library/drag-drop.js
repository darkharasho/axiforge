// Library drag-and-drop module — HTML5 drag-and-drop for moving builds to folders.

import { getSelection } from "./selection.js";
import { moveBuilds } from "./folder-store.js";

let _callbacks = {};

// IDs being dragged in the current drag operation
let _draggedIds = [];

/**
 * Store callbacks for drag-and-drop actions.
 * @param {{ onRefresh }} callbacks
 */
export function initDragDrop(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Wire drag handlers on rendered elements.
 * Call after each render.
 */
export function wireDragDropEvents() {
  _wireBuildDraggables();
  _wireFolderDropTargets();
}

// ─── Internal: build draggables ────────────────────────────────────────────────

function _wireBuildDraggables() {
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    // Avoid double-binding
    if (el.dataset.dragBound) return;
    el.dataset.dragBound = "1";

    // Set draggable on the element itself or its draggable child
    const draggable = el.querySelector("[draggable]") || el;
    if (!draggable.hasAttribute("draggable")) draggable.draggable = true;

    draggable.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      const buildId = el.dataset.buildId;

      // If this build is part of a multi-selection, drag all selected
      const sel = getSelection();
      if (sel.length > 1 && sel.includes(buildId)) {
        _draggedIds = sel;
      } else {
        _draggedIds = [buildId];
      }

      // Store IDs in dataTransfer for cross-window support (optional but conventional)
      e.dataTransfer.setData("text/plain", JSON.stringify(_draggedIds));
      e.dataTransfer.effectAllowed = "move";

      // Add dragging class to all dragged elements
      _draggedIds.forEach((id) => {
        document
          .querySelectorAll(`[data-build-id="${CSS.escape(id)}"]`)
          .forEach((node) => node.classList.add("lib-dragging"));
      });
    });

    draggable.addEventListener("dragend", () => {
      // Remove dragging class from all elements
      document.querySelectorAll(".lib-dragging").forEach((node) => {
        node.classList.remove("lib-dragging");
      });

      // Remove drop-target highlights
      document.querySelectorAll(".lib-drop-target").forEach((node) => {
        node.classList.remove("lib-drop-target");
      });

      _draggedIds = [];
    });
  });
}

// ─── Internal: folder drop targets ─────────────────────────────────────────────

function _wireFolderDropTargets() {
  // Content area folder elements (data-folder-id)
  document.querySelectorAll("[data-folder-id]").forEach((el) => {
    _makeDropTarget(el, el.dataset.folderId);
  });

  // Sidebar custom folder nav items (data-navigate-folder)
  document.querySelectorAll("[data-navigate-folder]").forEach((el) => {
    _makeDropTarget(el, el.dataset.navigateFolder);
  });

  // Sidebar nav items with data-nav="custom:<folderId>"
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const nav = el.dataset.nav;
    if (nav && nav.startsWith("custom:")) {
      const folderId = nav.slice(7);
      _makeDropTarget(el, folderId);
    }
  });
}

function _makeDropTarget(el, folderId) {
  // Avoid double-binding
  if (el.dataset.dropBound) return;
  el.dataset.dropBound = "1";

  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("lib-drop-target");
  });

  el.addEventListener("dragleave", (e) => {
    // Only remove if leaving the element itself (not a child)
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove("lib-drop-target");
    }
  });

  el.addEventListener("drop", async (e) => {
    e.preventDefault();
    el.classList.remove("lib-drop-target");

    // Prefer the module-level _draggedIds; fall back to dataTransfer
    let ids = _draggedIds;
    if (!ids || ids.length === 0) {
      try {
        ids = JSON.parse(e.dataTransfer.getData("text/plain"));
      } catch {
        ids = [];
      }
    }

    if (ids.length === 0) return;

    await moveBuilds(ids, folderId || null);
    _callbacks.onRefresh?.();
  });
}
