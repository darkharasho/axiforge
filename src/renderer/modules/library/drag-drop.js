// Library drag-and-drop module — HTML5 drag-and-drop for moving builds to folders.

import { getSelection } from "./selection.js";
import { moveBuilds } from "./folder-store.js";
import { state } from "../state.js";

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
  _wireRootDropTarget();
}

// ─── Internal: build draggables ────────────────────────────────────────────────

function _wireBuildDraggables() {
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    el.draggable = true;

    el.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      const buildId = el.dataset.buildId;

      const sel = getSelection();
      if (sel.length > 1 && sel.includes(buildId)) {
        _draggedIds = [...sel];
      } else {
        _draggedIds = [buildId];
      }

      e.dataTransfer.setData("text/plain", JSON.stringify(_draggedIds));
      e.dataTransfer.effectAllowed = "move";

      _draggedIds.forEach((id) => {
        document
          .querySelectorAll(`[data-build-id="${CSS.escape(id)}"]`)
          .forEach((node) => node.classList.add("lib-dragging"));
      });

      // Show root drop zone if build is in a folder
      const build = state.builds.find((b) => b.id === buildId);
      if (build?.folderId) {
        _showRootDropZone();
      }
    });

    el.addEventListener("dragend", () => {
      document.querySelectorAll(".lib-dragging").forEach((node) => {
        node.classList.remove("lib-dragging");
      });
      document.querySelectorAll(".lib-drop-target").forEach((node) => {
        node.classList.remove("lib-drop-target");
      });
      _hideRootDropZone();
      setTimeout(() => { _draggedIds = []; }, 50);
    });
  });
}

// ─── Internal: folder drop targets ─────────────────────────────────────────────

function _wireFolderDropTargets() {
  document.querySelectorAll("[data-folder-id]").forEach((el) => {
    _makeDropTarget(el, el.dataset.folderId);
  });

  document.querySelectorAll("[data-navigate-folder]").forEach((el) => {
    _makeDropTarget(el, el.dataset.navigateFolder);
  });

  document.querySelectorAll("[data-nav]").forEach((el) => {
    const nav = el.dataset.nav;
    if (nav && nav.startsWith("custom:")) {
      _makeDropTarget(el, nav.slice(7));
    }
  });

  document.querySelectorAll("[data-navigate-all]").forEach((el) => {
    _makeDropTarget(el, null);
  });
}

function _makeDropTarget(el, folderId) {
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

    const ids = _getDropIds(e);
    if (ids.length === 0) return;

    // If all builds are already in this folder, let it bubble to parent
    if (folderId) {
      const allHere = ids.every((id) => {
        const b = state.builds.find((x) => x.id === id);
        return b && b.folderId === folderId;
      });
      if (allHere) return;
    }

    e.preventDefault();
    e.stopPropagation();
    await moveBuilds(ids, folderId ?? null);
    _draggedIds = [];
    _callbacks.onRefresh?.();
  });
}

// ─── Internal: root (empty space) drop target ──────────────────────────────────

function _wireRootDropTarget() {
  const content = document.getElementById("lib-content");
  if (!content || content.dataset.rootDropBound) return;
  content.dataset.rootDropBound = "1";

  // Capture phase so it fires even when over child elements
  content.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, true);

  content.addEventListener("drop", async (e) => {
    // If a folder handler already caught this (stopPropagation), we won't get here
    e.preventDefault();

    const ids = _getDropIds(e);
    if (ids.length === 0) return;

    await moveBuilds(ids, null);
    _draggedIds = [];
    _callbacks.onRefresh?.();
  });
}

// ─── Root drop zone (visible bar during drag) ─────────────────────────────────

let _rootDropZone = null;

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
    _rootDropZone.classList.remove("lib-root-drop-zone--active");
  });

  _rootDropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = _getDropIds(e);
    if (ids.length === 0) return;
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function _getDropIds(e) {
  if (_draggedIds.length > 0) return [..._draggedIds];
  try {
    const parsed = JSON.parse(e.dataTransfer.getData("text/plain"));
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return [];
}
