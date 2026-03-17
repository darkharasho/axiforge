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
    el.draggable = true;

    el.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      console.log("[drag] dragstart", el.dataset.buildId);
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

    el.addEventListener("dragend", () => {
      // Remove dragging class from all elements
      document.querySelectorAll(".lib-dragging").forEach((node) => {
        node.classList.remove("lib-dragging");
      });

      // Remove drop-target highlights
      document.querySelectorAll(".lib-drop-target").forEach((node) => {
        node.classList.remove("lib-drop-target");
      });

      // Delay clearing IDs so drop handler can read them
      // (dragend fires before drop on some targets)
      setTimeout(() => { _draggedIds = []; }, 0);
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

  // Sidebar "All Builds" — drop here to move to root
  document.querySelectorAll("[data-navigate-all]").forEach((el) => {
    _makeDropTarget(el, null);
  });

  // Content area — always accept drops, move to root
  const content = document.getElementById("lib-content");
  if (content && !content.dataset.rootDropBound) {
    content.dataset.rootDropBound = "1";

    content.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }, true);

    content.addEventListener("drop", async (e) => {
      // If a folder drop target already handled this, it will have
      // called stopPropagation. If we get here, no folder caught it.
      e.preventDefault();
      let ids = _draggedIds;
      if (!ids || ids.length === 0) {
        try { ids = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { ids = []; }
      }
      console.log("[drag] drop on root, ids:", ids);
      if (ids.length === 0) return;

      try {
        await moveBuilds(ids, null);
        console.log("[drag] moveBuilds complete, calling onRefresh, builds[0].folderId:",
          (await import("../state.js")).state.builds.find(b => ids.includes(b.id))?.folderId);
        _callbacks.onRefresh?.();
      } catch (err) {
        console.error("[drag] moveBuilds failed:", err);
      }
    });
  }
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

    // If ALL dragged builds are already in this folder, skip and let event bubble
    // so a parent folder can handle it
    if (folderId) {
      const { state } = await import("../state.js");
      const allAlreadyHere = ids.every((id) => {
        const build = state.builds.find((b) => b.id === id);
        return build && build.folderId === folderId;
      });
      if (allAlreadyHere) return; // let it bubble to parent
    }

    e.preventDefault();
    e.stopPropagation();
    await moveBuilds(ids, folderId ?? null);
    _callbacks.onRefresh?.();
  });
}
