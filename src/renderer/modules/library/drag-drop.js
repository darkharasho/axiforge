// Library drag-and-drop module — powered by SortableJS.
// Re-initializes Sortable instances on every render since content
// is rebuilt via innerHTML each time.

import Sortable from "sortablejs";
import { moveBuilds, reorderBuilds } from "./folder-store.js";
import { state } from "../state.js";

let _callbacks = {};
let _sortableInstances = [];

export function initDragDrop(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Initialize SortableJS on all sortable containers.
 * Must be called after every render (renderContent, folder expand, etc.)
 * because innerHTML replacement destroys the previous DOM + Sortable instances.
 */
export function wireDragDropEvents() {
  // Destroy old instances (they're on dead DOM nodes anyway)
  _sortableInstances.forEach((s) => {
    try { s.destroy(); } catch { /* already gone */ }
  });
  _sortableInstances = [];

  const onEnd = async (evt) => {
    const buildId = evt.item?.dataset?.buildId;
    if (!buildId) return;

    // Determine target folder from the container we dropped into
    const dropContainer = evt.to;
    const folderLi = dropContainer.closest("[data-folder-id]");
    const newFolderId = folderLi?.dataset.folderId || null;

    // Get current folder
    const build = state.builds.find((b) => b.id === buildId);
    const oldFolderId = build?.folderId || null;

    if (newFolderId !== oldFolderId) {
      // Moved to a different folder
      await moveBuilds([buildId], newFolderId);
    } else {
      // Reordered within the same container — save custom sort order
      const children = [...evt.to.children]
        .map((el) => el.dataset?.buildId)
        .filter(Boolean);

      if (children.length > 0) {
        const updates = children.map((id, i) => ({ id, sortOrder: i }));
        await reorderBuilds(updates);

        // Auto-switch to custom sort so the order is visible
        state.libraryPrefs.sortField = "sortOrder";
        state.libraryPrefs.sortDirection = "asc";
      }
    }

    // Re-render to reflect changes
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
    fallbackOnBody: true,
    swapThreshold: 0.65,
    onEnd,
  };

  // Tree/table view: root list + each expanded folder's children
  document.querySelectorAll(".lib-tv__tree, .lib-tv__children").forEach((el) => {
    _sortableInstances.push(Sortable.create(el, sortableOpts));
  });

  // List view: the root .lib-list container
  document.querySelectorAll(".lib-list").forEach((el) => {
    _sortableInstances.push(Sortable.create(el, sortableOpts));
  });

  // Grid view
  document.querySelectorAll(".lib-grid").forEach((el) => {
    _sortableInstances.push(Sortable.create(el, sortableOpts));
  });

  // Icon view
  document.querySelectorAll(".lib-icon-grid").forEach((el) => {
    _sortableInstances.push(Sortable.create(el, sortableOpts));
  });

  // Wire sidebar drop targets (delegation, only once)
  _wireSidebarDropTargets();
}

// ─── Sidebar drop targets (manual — not SortableJS) ────────────────────────────

function _wireSidebarDropTargets() {
  const sidebar = document.getElementById("lib-sidebar");
  if (!sidebar || sidebar.dataset.sortableBound) return;
  sidebar.dataset.sortableBound = "1";

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

    // Find the SortableJS dragged element
    const dragging = document.querySelector(".sortable-drag, .lib-drag-chosen");
    const buildId = dragging?.dataset?.buildId;
    if (!buildId) return;

    const folderId = target.dataset.navigateFolder || null;
    await moveBuilds([buildId], folderId);
    _callbacks.onRefresh?.();
  });
}
