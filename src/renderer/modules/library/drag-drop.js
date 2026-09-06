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
import { isTeamOwner } from "../teams.js";
import { showToast } from "./toast.js";
import { canWrite } from "./access.js";

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
  return !isTeamOwner(srcFolderId);
}

/**
 * Refuse a blocked move and say why. Returns true when the caller must bail.
 * Silently returning left the item painted in its new spot with no explanation.
 */
function _refuseSharedMove(srcFolderId, destFolderId, label) {
  if (!_blockedBySharedOwnership(srcFolderId, destFolderId)) return false;
  showToast(`Only the team owner can move a ${label} out of a shared folder.`, "error");
  return true;
}

/** Turn a main-process rejection into something a user can act on. */
function _dropErrorMessage(err) {
  const raw = String(err?.message || err || "");
  // Electron wraps IPC rejections as "Error invoking remote method 'x': Error: <real>".
  const msg = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim();
  if (/FOLDER_TOO_DEEP|Maximum folder nesting depth/i.test(msg)) {
    return "Folders can only be nested 3 levels deep \u2014 that move would go deeper.";
  }
  return msg || "That move couldn't be completed.";
}

// Resolve the semantic folder ID a sortable container belongs to.
// In table view, build/comp/folder lists are nested under [data-folder-id].
// In flat views (list/grid/icon/columns), the container has no folder ancestor —
// it represents the current folder context, so use state.currentFolder.id.
// Without this fallback, an in-place sortable end-event resolves the destination
// to root and silently moves items out of any subfolder (custom or shared).
function _containerFolderId(container) {
  const folderEl = container?.closest?.("[data-folder-id]");
  if (folderEl) return folderEl.dataset.folderId;
  if (state.currentFolder?.type === "custom") return state.currentFolder.id;
  return null;
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
 * Remove any drag ghost SortableJS abandoned on <body>.
 *
 * With forceFallback + fallbackOnBody, Sortable drags a full clone of the row
 * (`ghostEl`) parented to <body> and positioned fixed. It removes that clone in
 * _onDrop -- but only inside `if (evt)`, and `destroy()` calls `_onDrop()` with
 * no event, then nulls the reference. So destroying an instance mid-drag strands
 * the clone permanently: nothing holds a handle to it any more, it is not inside
 * #lib-content, and every later render replaces #lib-content's innerHTML without
 * touching it. The user sees a phantom build row pinned at its old coordinates,
 * floating over the Archive, the Trash and every folder they visit.
 *
 * A render CAN land mid-drag -- the table view's hover-to-auto-expand calls
 * renderContent() from the pointermove handler, and a sync push can repaint at
 * any moment -- so this runs wherever we destroy, rather than trying to prove
 * no such render exists.
 */
function _removeStrandedDragGhosts() {
  document
    .querySelectorAll("body > .lib-drag-fallback, body > .lib-drag-active")
    .forEach((el) => el.remove());
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
  _removeStrandedDragGhosts();

  const onStart = (evt) => {
    _isDragging = true;
    _draggedBuildId = evt.item?.dataset?.buildId || null;
    _draggedCompId = evt.item?.dataset?.compId || null;
    _draggedFolderId = evt.item?.dataset?.folderId || null;
    document.addEventListener("pointermove", _onPointerMove);
  };

  // SortableJS has already moved the DOM node by the time this runs, so every
  // exit path — refused, blocked, cancelled or thrown — has to repaint from
  // state. Without that the item sits wherever it was dropped while the data
  // says otherwise, which reads as "the drag froze halfway".
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

    try {
      await _applyDrop(evt, droppedOnTarget);
    } catch (err) {
      // Main-process guards (team ownership, folder depth) reject by throwing.
      // Swallowing that left the user with a silently reverted-but-not-repainted
      // drag and no idea why.
      showToast(_dropErrorMessage(err), "error");
    } finally {
      _isDragging = false;
      _draggedBuildId = null;
      _draggedCompId = null;
      _draggedFolderId = null;
      _callbacks.onRefresh?.();
    }
  };

  const _applyDrop = async (evt, droppedOnTarget) => {
    const draggedFolderId = evt.item?.dataset?.folderId;
    if (draggedFolderId) {
      if (droppedOnTarget) {
        const targetFolderEl = droppedOnTarget.closest("[data-folder-id]");
        if (targetFolderEl && !_isFolderSelfOrDescendant(targetFolderEl.dataset.folderId, draggedFolderId)) {
          await _callbacks.onMoveFolder?.(draggedFolderId, targetFolderEl.dataset.folderId);
          return;
        }
        const navTarget = droppedOnTarget.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
        if (navTarget) {
          await _callbacks.onMoveFolder?.(draggedFolderId, navTarget.dataset.navigateFolder || null);
          return;
        }
      }

      const dropContainer = evt.to;
      const newParentId = _containerFolderId(dropContainer);
      const folder = state.folders?.find((f) => f.id === draggedFolderId);
      const oldParentId = folder?.parentId || null;

      if (newParentId !== oldParentId) {
        // A drop into the folder's own subtree is simply refused; the repaint in
        // the finally block puts it back. It must NOT fall through to the
        // reorder branch, which would renumber a container the folder isn't in.
        if (!_isFolderSelfOrDescendant(newParentId, draggedFolderId)) {
          await _callbacks.onMoveFolder?.(draggedFolderId, newParentId);
        }
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
      return;
    }

    const compId = evt.item?.dataset?.compId;
    if (compId) {
      const comp = state.comps?.find((c) => c.id === compId);
      const compSrcFolderId = comp?.folderId || null;
      if (droppedOnTarget) {
        const folderEl = droppedOnTarget.closest("[data-folder-id]");
        if (folderEl) {
          if (_refuseSharedMove(compSrcFolderId, folderEl.dataset.folderId, "comp")) return;
          await _callbacks.onMoveComps?.([compId], folderEl.dataset.folderId);
          return;
        }
        const navTarget = droppedOnTarget.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
        if (navTarget) {
          const destFolderId = navTarget.dataset.navigateFolder || null;
          if (_refuseSharedMove(compSrcFolderId, destFolderId, "comp")) return;
          await _callbacks.onMoveComps?.([compId], destFolderId);
          return;
        }
      }

      const dropContainer = evt.to;
      const newFolderId = _containerFolderId(dropContainer);
      const oldFolderId = compSrcFolderId;

      if (newFolderId !== oldFolderId) {
        if (_refuseSharedMove(oldFolderId, newFolderId, "comp")) return;
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
      return;
    }

    const buildId = evt.item?.dataset?.buildId;
    if (!buildId) return;

    // Check if we were hovering over a folder, comp, or nav target when dropped
    if (droppedOnTarget) {
      const compEl = droppedOnTarget.closest("[data-comp-id]");
      if (compEl) {
        const targetCompId = compEl.dataset.compId;
        // Use multi-selection if the dragged build is part of one
        const selected = getSelection();
        const buildIds = selected.length > 1 && selected.includes(buildId)
          ? selected
          : [buildId];
        await _callbacks.onDropBuildsOnComp?.(buildIds, targetCompId);
        return;
      }

      const folderEl = droppedOnTarget.closest("[data-folder-id]");
      if (folderEl) {
        const folderId = folderEl.dataset.folderId;
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
          if (_refuseSharedMove(srcFolderId, folderId, "build")) return;
          await moveBuilds(idsToMove, folderId);
        }
        return;
      }

      const navTarget = droppedOnTarget.closest("[data-navigate-folder], [data-navigate-all], [data-navigate-root]");
      if (navTarget) {
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
          if (_refuseSharedMove(srcFolderId, folderId, "build")) return;
          await moveBuilds(idsToMove, folderId);
        }
        return;
      }
    }

    // Normal SortableJS reorder/move logic
    const dropContainer = evt.to;
    const newFolderId = _containerFolderId(dropContainer);

    const build = state.builds.find((b) => b.id === buildId);
    const oldFolderId = build?.folderId || null;

    if (newFolderId !== oldFolderId) {
      if (_refuseSharedMove(oldFolderId, newFolderId, "build")) return;
      // Honour the multi-selection, like every droppedOnTarget branch above.
      // This branch used to move the single dragged build and silently leave
      // the rest of the selection behind — which is what made shift-clicking
      // several builds in the COLUMNS view and dragging them out of a folder
      // look broken. Columns are the common case because a .lib-col is not
      // inside a [data-folder-id] and is not a nav target, so a column-to-column
      // drag has no hover target and always lands here.
      const selected = getSelection();
      const idsToMove = selected.length > 1 && selected.includes(buildId) ? selected : [buildId];
      await moveBuilds(idsToMove, newFolderId);
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
    // How far the pointer must travel before a press becomes a drag. Sortable
    // defaults this to 0, so with forceFallback a click that wobbles by one
    // pixel started a real drag — people were reordering and re-foldering
    // things they only meant to select. A native OS drag threshold is 4-5px;
    // this is deliberately a touch above that, because the cost of a missed
    // drag (press again) is far lower than the cost of an accidental one
    // (a build silently moved into another folder).
    fallbackTolerance: 8,
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
        if (_isFolderSelfOrDescendant(folderId, _draggedFolderId) || !canWrite(folderId)) {
          folderEl.classList.add("is-invalid");
        }
      }
      return;
    }
    const childrenUl = folderEl.querySelector(".lib-tv__children");
    if (!childrenUl) {
      _hoverTarget = folderEl;
      folderEl.classList.add("lib-drop-target");
      // The drop is still refused by main; this is only so the user sees it
      // coming rather than watching the item snap back after a toast.
      if (!canWrite(folderId)) folderEl.classList.add("is-invalid");

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
    // navigateFolder is absent on "All Builds" / root, which are personal and
    // always writable — canWrite(undefined) answers that.
    if (!canWrite(navTarget.dataset.navigateFolder)) navTarget.classList.add("is-invalid");
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
