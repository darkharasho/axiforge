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
import { moveBuilds, reorderBuilds, reorderComps, reorderFolders } from "./folder-store.js";
import { expandTableFolder } from "./content.js";
import { state } from "../state.js";
import { isGameModeCompatible } from "./library.js";
import { getSelection } from "./selection.js";

/** True if folderId is within a shared folder tree. */
function _isInSharedFolder(folderId) {
  let current = state.folders.find((f) => f.id === folderId);
  while (current) {
    if (current.shared) return true;
    if (!current.parentId) return false;
    current = state.folders.find((f) => f.id === current.parentId);
  }
  return false;
}

/** True if current user is an org owner. */
function _isOrgOwner() {
  return !!state.sharedLibraryConfig?.isOwner;
}

/**
 * Guard against dragging items out of a shared folder when not an owner.
 * Returns true if the move is blocked.
 */
function _blockedBySharedOwnership(srcFolderId, destFolderId) {
  if (!_isInSharedFolder(srcFolderId)) return false;
  const destShared = _isInSharedFolder(destFolderId);
  // Moving within the same shared tree is always allowed
  const srcRoot = _findSharedRoot(srcFolderId);
  const destRoot = destFolderId ? _findSharedRoot(destFolderId) : null;
  if (srcRoot && destRoot && srcRoot === destRoot) return false;
  return !_isOrgOwner();
}

function _findSharedRoot(folderId) {
  let current = state.folders.find((f) => f.id === folderId);
  while (current) {
    if (current.shared) return current.id;
    if (!current.parentId) return null;
    current = state.folders.find((f) => f.id === current.parentId);
  }
  return null;
}

let _callbacks = {};
let _sortableInstances = [];
let _expandTimer = null;
let _isDragging = false;
let _draggedBuildId = null;
let _draggedCompId = null;
let _draggedFolderId = null;
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
    _draggedBuildId = evt.item?.dataset?.buildId || null;
    _draggedCompId = evt.item?.dataset?.compId || null;
    _draggedFolderId = evt.item?.dataset?.folderId || null;
    document.addEventListener("pointermove", _onPointerMove);
  };

  const onEnd = async (evt) => {
    document.removeEventListener("pointermove", _onPointerMove);
    clearTimeout(_expandTimer);

    // Save hover target before clearing (used for folder/nav drop detection)
    const droppedOnTarget = _hoverTarget;

    // Clean up hover highlight
    if (_hoverTarget) {
      _hoverTarget.classList.remove("lib-drop-target", "is-invalid");
      _hoverTarget = null;
    }

    const draggedFolderId = evt.item?.dataset?.folderId;
    if (draggedFolderId) {
      if (droppedOnTarget) {
        const targetFolderEl = droppedOnTarget.closest("[data-folder-id]");
        if (targetFolderEl && !_isFolderSelfOrDescendant(targetFolderEl.dataset.folderId, draggedFolderId)) {
          _isDragging = false;
          _draggedFolderId = null;
          await _callbacks.onMoveFolder?.(draggedFolderId, targetFolderEl.dataset.folderId);
          return;
        }
        const navTarget = droppedOnTarget.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
        if (navTarget) {
          _isDragging = false;
          _draggedFolderId = null;
          await _callbacks.onMoveFolder?.(draggedFolderId, navTarget.dataset.navigateFolder || null);
          _callbacks.onRefresh?.();
          return;
        }
      }

      const dropContainer = evt.to;
      const parentLi = dropContainer.closest("[data-folder-id]");
      const newParentId = parentLi?.dataset.folderId || null;
      const folder = state.folders?.find((f) => f.id === draggedFolderId);
      const oldParentId = folder?.parentId || null;

      if (newParentId !== oldParentId && !_isFolderSelfOrDescendant(newParentId, draggedFolderId)) {
        await _callbacks.onMoveFolder?.(draggedFolderId, newParentId);
      } else {
        const children = [...evt.to.children]
          .map((el) => el.dataset?.folderId)
          .filter(Boolean);
        if (children.length > 0) {
          const updates = children.map((id, i) => ({ id, sortOrder: i }));
          await reorderFolders(updates);
          state.libraryPrefs.sortField = "sortOrder";
          state.libraryPrefs.sortDirection = "asc";
        }
      }

      _isDragging = false;
      _draggedFolderId = null;
      _callbacks.onRefresh?.();
      return;
    }

    const compId = evt.item?.dataset?.compId;
    if (compId) {
      const comp = state.comps?.find((c) => c.id === compId);
      const compSrcFolderId = comp?.folderId || null;
      if (droppedOnTarget) {
        const folderEl = droppedOnTarget.closest("[data-folder-id]");
        if (folderEl) {
          _isDragging = false;
          _draggedCompId = null;
          if (_blockedBySharedOwnership(compSrcFolderId, folderEl.dataset.folderId)) return;
          await _callbacks.onMoveComps?.([compId], folderEl.dataset.folderId);
          return;
        }
        const navTarget = droppedOnTarget.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
        if (navTarget) {
          const destFolderId = navTarget.dataset.navigateFolder || null;
          _isDragging = false;
          _draggedCompId = null;
          if (_blockedBySharedOwnership(compSrcFolderId, destFolderId)) return;
          await _callbacks.onMoveComps?.([compId], destFolderId);
          _callbacks.onRefresh?.();
          return;
        }
      }

      const dropContainer = evt.to;
      const folderLi = dropContainer.closest("[data-folder-id]");
      const newFolderId = folderLi?.dataset.folderId || null;
      const oldFolderId = compSrcFolderId;

      if (newFolderId !== oldFolderId) {
        await _callbacks.onMoveComps?.([compId], newFolderId);
      } else {
        const children = [...evt.to.children]
          .map((el) => el.dataset?.compId)
          .filter(Boolean);
        if (children.length > 0) {
          const updates = children.map((id, i) => ({ id, sortOrder: i }));
          await reorderComps(updates);
          state.libraryPrefs.sortField = "sortOrder";
          state.libraryPrefs.sortDirection = "asc";
        }
      }

      _isDragging = false;
      _draggedCompId = null;
      _callbacks.onRefresh?.();
      return;
    }

    const buildId = evt.item?.dataset?.buildId;
    if (!buildId) {
      _isDragging = false;
      _draggedBuildId = null;
      return;
    }

    // Check if we were hovering over a folder, comp, or nav target when dropped
    if (droppedOnTarget) {
      const compEl = droppedOnTarget.closest("[data-comp-id]");
      if (compEl) {
        const compId = compEl.dataset.compId;
        _isDragging = false;
        _draggedBuildId = null;
        // Use multi-selection if the dragged build is part of one
        const selected = getSelection();
        const buildIds = selected.length > 1 && selected.includes(buildId)
          ? selected
          : [buildId];
        await _callbacks.onDropBuildsOnComp?.(buildIds, compId);
        return;
      }

      const folderEl = droppedOnTarget.closest("[data-folder-id]");
      if (folderEl) {
        const folderId = folderEl.dataset.folderId;
        _isDragging = false;
        _draggedBuildId = null;
        const selected = getSelection();
        const idsToMove = selected.length > 1 && selected.includes(buildId)
          ? selected
          : [buildId];
        // If inside a comp, remove builds from comp instead of moving
        if (state.currentFolder?.type === "comp") {
          for (const id of idsToMove) {
            await _callbacks.onRemoveBuildFromComp?.(id, state.currentFolder.id);
          }
        } else {
          const srcFolderId = state.builds.find((b) => b.id === buildId)?.folderId || null;
          if (!_blockedBySharedOwnership(srcFolderId, folderId)) {
            await moveBuilds(idsToMove, folderId);
          }
        }
        _callbacks.onRefresh?.();
        return;
      }

      const navTarget = droppedOnTarget.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
      if (navTarget) {
        _isDragging = false;
        _draggedBuildId = null;
        const selected = getSelection();
        const idsToMove = selected.length > 1 && selected.includes(buildId)
          ? selected
          : [buildId];
        // If inside a comp, remove builds from comp instead of moving
        if (state.currentFolder?.type === "comp") {
          for (const id of idsToMove) {
            await _callbacks.onRemoveBuildFromComp?.(id, state.currentFolder.id);
          }
        } else {
          const folderId = navTarget.dataset.navigateFolder || null;
          const srcFolderId = state.builds.find((b) => b.id === buildId)?.folderId || null;
          if (!_blockedBySharedOwnership(srcFolderId, folderId)) {
            await moveBuilds(idsToMove, folderId);
          }
        }
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
      if (!_blockedBySharedOwnership(oldFolderId, newFolderId)) {
        await moveBuilds([buildId], newFolderId);
      }
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
    _draggedCompId = null;
    _draggedFolderId = null;
    _callbacks.onRefresh?.();
  };

  const onMove = (evt) => {
    const dragged = evt.dragged;
    const related = evt.related;
    // When dragging a build, don't allow reorder indicators near folders or comps
    // — builds can only be dropped *into* them (handled by pointer-based hover).
    if (dragged?.dataset?.buildId) {
      if (related?.dataset?.folderId || related?.dataset?.compId) return false;
    }
    // When dragging a comp, don't allow reorder indicators near folders
    if (dragged?.dataset?.compId) {
      if (related?.dataset?.folderId) return false;
    }
  };

  const sortableOpts = {
    group: "builds",
    animation: 150,
    ghostClass: "lib-drag-ghost",
    chosenClass: "lib-drag-chosen",
    dragClass: "lib-drag-active",
    draggable: "[data-build-id], [data-comp-id], [data-folder-id]",
    emptyInsertThreshold: 20,
    forceFallback: true,
    fallbackClass: "lib-drag-fallback",
    fallbackOnBody: true,
    swapThreshold: 0.65,
    onStart,
    onEnd,
    onMove,
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
    _hoverTarget.classList.remove("lib-drop-target", "is-invalid");
    _hoverTarget = null;
  }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return;

  // Check folder elements in content area
  const folderEl = el.closest("[data-folder-id]");
  if (folderEl) {
    const folderId = folderEl.dataset.folderId;
    if (_draggedFolderId) {
      // Folder-on-folder: highlight as target, mark invalid if self or descendant
      if (folderId !== _draggedFolderId) {
        _hoverTarget = folderEl;
        folderEl.classList.add("lib-drop-target");
        if (_isFolderSelfOrDescendant(folderId, _draggedFolderId)) {
          folderEl.classList.add("is-invalid");
        }
      }
      return;
    }
    const childrenUl = folderEl.querySelector(".lib-tv__children");
    if (!childrenUl) {
      _hoverTarget = folderEl;
      folderEl.classList.add("lib-drop-target");

      // Auto-expand collapsed table folders after 500ms hover
      if (folderEl.closest(".lib-tv") && folderId) {
        clearTimeout(_expandTimer);
        _expandTimer = setTimeout(() => expandTableFolder(folderId), 500);
      }
      return;
    }
  }

  // Check comp rows — a build can be dropped onto a comp to add it
  const compEl = el.closest("[data-comp-id]");
  if (compEl && _draggedBuildId) {
    _hoverTarget = compEl;
    compEl.classList.add("lib-drop-target");
    // Show invalid indicator if comp is locked to a different game mode
    const hoveredComp = state.comps?.find((c) => c.id === compEl.dataset.compId);
    const draggedBuild = state.builds?.find((b) => b.id === _draggedBuildId);
    if (hoveredComp && draggedBuild && !isGameModeCompatible(hoveredComp, draggedBuild)) {
      compEl.classList.add("is-invalid");
    }
    return;
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

/**
 * Returns true if targetId is the same as ancestorId or is a descendant of it.
 * Used to prevent dropping a folder into itself or one of its children.
 */
function _isFolderSelfOrDescendant(targetId, ancestorId) {
  let current = targetId;
  while (current) {
    if (current === ancestorId) return true;
    const folder = state.folders?.find((f) => f.id === current);
    current = folder?.parentId || null;
  }
  return false;
}
