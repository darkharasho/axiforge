// Library drag-and-drop module — powered by SortableJS.
// Handles:
// - Reordering builds within a container (any view)
// - Moving builds between folders via nested containers (table view)
// - Moving builds into folders by dropping on folder elements (all views)
// - Dropping builds onto sidebar folder items and breadcrumbs
// - Auto-expanding collapsed folders on hover (table view)
//
// Uses forceFallback mode to control the drag cursor, and pointer events +
// elementFromPoint() for folder/sidebar/breadcrumb drop targets (since
// forceFallback bypasses native HTML5 drag events).

import Sortable from "sortablejs";
import { moveBuilds, reorderBuilds } from "./folder-store.js";
import { expandTableFolder } from "./content.js";
import { state } from "../state.js";

let _callbacks = {};
let _sortableInstances = [];
let _expandTimer = null;
let _isDragging = false;
let _draggedBuildId = null;
let _hoverTarget = null;

export function initDragDrop(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Initialize SortableJS on all sortable containers.
 * Called after every render.
 */
export function wireDragDropEvents() {
  // Destroy old instances
  _sortableInstances.forEach((s) => {
    try { s.destroy(); } catch { /* dead DOM */ }
  });
  _sortableInstances = [];

  const onStart = (evt) => {
    _isDragging = true;
    _draggedBuildId = evt.item?.dataset?.buildId;
    document.addEventListener("pointermove", _onPointerMove);
  };

  const onEnd = async (evt) => {
    document.removeEventListener("pointermove", _onPointerMove);
    clearTimeout(_expandTimer);

    // Save hover target before clearing (used for folder/nav drop detection)
    const droppedOnTarget = _hoverTarget;

    // Clean up hover highlight
    if (_hoverTarget) {
      _hoverTarget.classList.remove("lib-drop-target");
      _hoverTarget = null;
    }

    const buildId = evt.item?.dataset?.buildId;
    if (!buildId) {
      _isDragging = false;
      _draggedBuildId = null;
      return;
    }

    // Check if we were hovering over a folder or nav target when dropped
    if (droppedOnTarget) {
      const folderEl = droppedOnTarget.closest("[data-folder-id]");
      if (folderEl) {
        const folderId = folderEl.dataset.folderId;
        _isDragging = false;
        _draggedBuildId = null;
        await moveBuilds([buildId], folderId);
        _callbacks.onRefresh?.();
        return;
      }

      const navTarget = droppedOnTarget.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
      if (navTarget) {
        const folderId = navTarget.dataset.navigateFolder || null;
        _isDragging = false;
        _draggedBuildId = null;
        await moveBuilds([buildId], folderId);
        _callbacks.onRefresh?.();
        return;
      }
    }

    // Normal SortableJS reorder/move logic
    const dropContainer = evt.to;
    const folderLi = dropContainer.closest("[data-folder-id]");
    const newFolderId = folderLi?.dataset.folderId || null;

    const build = state.builds.find((b) => b.id === buildId);
    const oldFolderId = build?.folderId || null;

    if (newFolderId !== oldFolderId) {
      await moveBuilds([buildId], newFolderId);
    } else {
      // Reordered within same container — save custom sort order
      const children = [...evt.to.children]
        .map((el) => el.dataset?.buildId)
        .filter(Boolean);

      if (children.length > 0) {
        const updates = children.map((id, i) => ({ id, sortOrder: i }));
        await reorderBuilds(updates);
        state.libraryPrefs.sortField = "sortOrder";
        state.libraryPrefs.sortDirection = "asc";
      }
    }

    _isDragging = false;
    _draggedBuildId = null;
    _callbacks.onRefresh?.();
  };

  const sortableOpts = {
    group: "builds",
    animation: 150,
    ghostClass: "lib-drag-ghost",
    chosenClass: "lib-drag-chosen",
    dragClass: "lib-drag-active",
    draggable: "[data-build-id]",
    emptyInsertThreshold: 20,
    forceFallback: true,
    fallbackClass: "lib-drag-fallback",
    fallbackOnBody: true,
    swapThreshold: 0.65,
    onStart,
    onEnd,
  };

  // Create Sortable on all containers
  document.querySelectorAll(
    ".lib-list, .lib-tv__tree, .lib-tv__children, .lib-grid, .lib-icon-grid, .lib-col"
  ).forEach((el) => {
    _sortableInstances.push(Sortable.create(el, sortableOpts));
  });
}

// ─── Pointer-based hover tracking during drag ─────────────────────────────────
// With forceFallback, native drag events don't fire. We use pointermove +
// elementFromPoint to highlight folder/sidebar/breadcrumb targets during drag.

function _onPointerMove(e) {
  if (!_isDragging) return;

  // Clear previous highlight
  if (_hoverTarget) {
    _hoverTarget.classList.remove("lib-drop-target");
    _hoverTarget = null;
  }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return;

  // Check folder elements in content area
  const folderEl = el.closest("[data-folder-id]");
  if (folderEl) {
    const childrenUl = folderEl.querySelector(".lib-tv__children");
    if (!childrenUl) {
      _hoverTarget = folderEl;
      folderEl.classList.add("lib-drop-target");

      // Auto-expand collapsed table folders after 500ms hover
      const folderId = folderEl.dataset.folderId;
      if (folderEl.closest(".lib-tv") && folderId) {
        clearTimeout(_expandTimer);
        _expandTimer = setTimeout(() => expandTableFolder(folderId), 500);
      }
      return;
    }
  }

  // Check sidebar and breadcrumb targets
  const navTarget = el.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
  if (navTarget) {
    _hoverTarget = navTarget;
    navTarget.classList.add("lib-drop-target");
    return;
  }

  clearTimeout(_expandTimer);
}
