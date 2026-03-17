// Library drag-and-drop module — powered by SortableJS.
// Handles:
// - Reordering builds within a container (any view)
// - Moving builds between folders via nested containers (table view)
// - Moving builds into folders by dropping on folder elements (all views)
// - Auto-expanding collapsed folders on hover (table view)

import Sortable from "sortablejs";
import { moveBuilds, reorderBuilds } from "./folder-store.js";
import { expandTableFolder } from "./content.js";
import { state } from "../state.js";

let _callbacks = {};
let _sortableInstances = [];
let _expandTimer = null;

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

  const onEnd = async (evt) => {
    const buildId = evt.item?.dataset?.buildId;
    if (!buildId) return;

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

  // Create Sortable on all containers
  document.querySelectorAll(
    ".lib-list, .lib-tv__tree, .lib-tv__children, .lib-grid, .lib-icon-grid"
  ).forEach((el) => {
    _sortableInstances.push(Sortable.create(el, sortableOpts));
  });

  // Wire folder elements as drop targets (for all views)
  _wireFolderDropTargets();

  // Wire sidebar drop targets (once)
  _wireSidebarDropTargets();
}

// ─── Folder drop targets (non-table views + collapsed table folders) ───────────
// In list/grid/icon views, folders are flat elements — not SortableJS containers.
// We add manual dragover/drop handlers so you can drop builds ON a folder element.
// In table view, collapsed folders also need this since they have no children <ul>.

function _wireFolderDropTargets() {
  const content = document.getElementById("lib-content");
  if (!content) return;

  // Use delegation on #lib-content for folder drop targets
  if (content.dataset.folderDropBound) return;
  content.dataset.folderDropBound = "1";

  content.addEventListener("dragover", (e) => {
    const folderEl = e.target.closest("[data-folder-id]");
    if (!folderEl) return;

    // Check if this folder already has a SortableJS children container
    // If so, SortableJS handles it — don't interfere
    const childrenUl = folderEl.querySelector(".lib-tv__children");
    if (childrenUl) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    folderEl.classList.add("lib-drop-target");

    // Auto-expand collapsed folders in table view after hovering 500ms
    const folderId = folderEl.dataset.folderId;
    if (folderEl.closest(".lib-tv") && folderId) {
      clearTimeout(_expandTimer);
      _expandTimer = setTimeout(() => {
        expandTableFolder(folderId);
      }, 500);
    }
  });

  content.addEventListener("dragleave", (e) => {
    const folderEl = e.target.closest("[data-folder-id]");
    if (folderEl && !folderEl.contains(e.relatedTarget)) {
      folderEl.classList.remove("lib-drop-target");
      clearTimeout(_expandTimer);
    }
  });

  content.addEventListener("drop", async (e) => {
    clearTimeout(_expandTimer);
    const folderEl = e.target.closest("[data-folder-id]");
    if (!folderEl) return;

    // If this folder has a SortableJS children container, let SortableJS handle it
    const childrenUl = folderEl.querySelector(".lib-tv__children");
    if (childrenUl) return;

    e.preventDefault();
    e.stopPropagation();
    folderEl.classList.remove("lib-drop-target");

    // Find the dragged build
    const dragging = document.querySelector(".sortable-drag");
    const buildId = dragging?.dataset?.buildId;
    if (!buildId) return;

    const folderId = folderEl.dataset.folderId;
    await moveBuilds([buildId], folderId);
    _callbacks.onRefresh?.();
  });
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

    const dragging = document.querySelector(".sortable-drag, .lib-drag-chosen");
    const buildId = dragging?.dataset?.buildId;
    if (!buildId) return;

    const folderId = target.dataset.navigateFolder || null;
    await moveBuilds([buildId], folderId);
    _callbacks.onRefresh?.();
  });
}
