// Library drag-and-drop module — powered by SortableJS.
// Creates Sortable instances on each container (root list, folder children lists).
// Items can be dragged between containers to move builds into/out of folders.

import Sortable from "sortablejs";
import { moveBuilds } from "./folder-store.js";
import { state } from "../state.js";

let _callbacks = {};
let _sortableInstances = [];

export function initDragDrop(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Initialize SortableJS on all sortable containers in the current view.
 * Call after each render. Destroys previous instances first.
 */
export function wireDragDropEvents() {
  // Destroy old instances
  _sortableInstances.forEach((s) => s.destroy());
  _sortableInstances = [];

  // Find all sortable containers:
  // - .lib-list (list view root)
  // - .lib-tv__tree (table/tree view root)
  // - .lib-tv__children (expanded folder children in tree view)
  // - .lib-grid (grid view root)
  // - .lib-icon-grid (icon view root)
  const containers = document.querySelectorAll(
    ".lib-list, .lib-tv__tree, .lib-tv__children, .lib-grid, .lib-icon-grid"
  );

  containers.forEach((container) => {
    // Determine the folder ID this container belongs to
    // For .lib-tv__children, the parent <li> has data-folder-id
    const parentFolderLi = container.closest("[data-folder-id]");
    const containerId = parentFolderLi?.dataset.folderId || null;

    const sortable = Sortable.create(container, {
      group: "builds",
      animation: 150,
      ghostClass: "lib-drag-ghost",
      chosenClass: "lib-drag-chosen",
      dragClass: "lib-drag-active",
      // Only drag elements with data-build-id (not folders)
      draggable: "[data-build-id]",
      // Allow dropping even if container is empty
      emptyInsertThreshold: 20,

      onEnd: async (evt) => {
        const buildId = evt.item?.dataset?.buildId;
        if (!buildId) return;

        // Figure out where it was dropped
        const newContainer = evt.to;
        const newParentLi = newContainer.closest("[data-folder-id]");
        const newFolderId = newParentLi?.dataset.folderId || null;

        // Get the build's current folder
        const build = state.builds.find((b) => b.id === buildId);
        const oldFolderId = build?.folderId || null;

        // Only move if the folder actually changed
        if (newFolderId !== oldFolderId) {
          await moveBuilds([buildId], newFolderId);
        }

        // Always refresh to restore proper sort order
        // (SortableJS physically moves the DOM element, but our render
        // needs to rebuild with correct data)
        _callbacks.onRefresh?.();
      },
    });

    _sortableInstances.push(sortable);
  });

  // Also make sidebar folders drop targets
  _wireSidebarDropTargets();
}

// ─── Sidebar drop targets ──────────────────────────────────────────────────────

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

    // Get the dragged build ID from SortableJS's dataTransfer
    let ids = [];
    try {
      const data = e.dataTransfer.getData("text/plain");
      // SortableJS doesn't set custom data, so we need to find the currently
      // dragged element from the DOM
    } catch { /* ignore */ }

    // Find the element SortableJS is currently dragging
    const dragging = document.querySelector(".lib-drag-chosen, .lib-drag-active, .sortable-drag");
    const buildId = dragging?.dataset?.buildId;
    if (!buildId) return;

    const folderId = target.dataset.navigateFolder || null;
    await moveBuilds([buildId], folderId);
    _callbacks.onRefresh?.();
  });
}
