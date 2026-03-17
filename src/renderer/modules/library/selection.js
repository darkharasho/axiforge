// Library selection module — manages multi-select state for builds.
// Supports single click, Ctrl/Meta+click (toggle), and Shift+click (range).

import { getVisibleBuilds } from "./folder-store.js";

const selection = {
  ids: new Set(),
  lastClickedId: null,
};

// ─── Public API ────────────────────────────────────────────────────────────────

/** Returns array of selected build IDs. */
export function getSelection() {
  return Array.from(selection.ids);
}

/** Clears all selections. */
export function clearSelection() {
  selection.ids.clear();
  selection.lastClickedId = null;
  updateSelectionVisuals();
}

/** Selects all currently visible builds. */
export function selectAll() {
  const builds = getVisibleBuilds();
  selection.ids = new Set(builds.map((b) => b.id));
  if (builds.length > 0) {
    selection.lastClickedId = builds[builds.length - 1].id;
  }
  updateSelectionVisuals();
}

/** Returns true if the given build ID is selected. */
export function isSelected(buildId) {
  return selection.ids.has(buildId);
}

/**
 * Handle a click on a build item.
 * @param {string} buildId
 * @param {MouseEvent} event
 */
export function handleBuildClick(buildId, event) {
  if (event.shiftKey && selection.lastClickedId) {
    _rangeSelect(buildId);
  } else if (event.ctrlKey || event.metaKey) {
    _toggleSelect(buildId);
  } else {
    // Clicking the sole selected item deselects it; otherwise single-select
    if (selection.ids.size === 1 && selection.ids.has(buildId)) {
      selection.ids.clear();
      selection.lastClickedId = null;
    } else {
      _singleSelect(buildId);
    }
  }
  updateSelectionVisuals();
}

/**
 * Navigate selection by keyboard arrow keys.
 * @param {"up"|"down"} direction
 */
export function navigateSelection(direction) {
  const builds = getVisibleBuilds();
  if (builds.length === 0) return;

  // Find current position — use lastClickedId if it's in the visible list
  const currentIndex = selection.lastClickedId
    ? builds.findIndex((b) => b.id === selection.lastClickedId)
    : -1;

  let nextIndex;
  if (direction === "down") {
    nextIndex = currentIndex < builds.length - 1 ? currentIndex + 1 : currentIndex;
  } else {
    nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
  }

  const nextBuild = builds[nextIndex];
  selection.ids = new Set([nextBuild.id]);
  selection.lastClickedId = nextBuild.id;
  updateSelectionVisuals();

  // Scroll the newly selected item into view
  const el = document.querySelector(`[data-build-id="${CSS.escape(nextBuild.id)}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

/**
 * Wire click handlers on all [data-build-id] elements in the document.
 * Call this after the content is re-rendered.
 */
export function wireSelectionEvents() {
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    // Avoid double-binding
    if (el.dataset.selectionBound) return;
    el.dataset.selectionBound = "1";

    el.addEventListener("click", (e) => {
      // Ignore clicks on action buttons (e.g. pin button)
      if (e.target.closest("[data-action]")) return;
      const buildId = el.dataset.buildId;
      if (buildId) handleBuildClick(buildId, e);
    });
  });
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function _singleSelect(buildId) {
  selection.ids = new Set([buildId]);
  selection.lastClickedId = buildId;
}

function _toggleSelect(buildId) {
  if (selection.ids.has(buildId)) {
    selection.ids.delete(buildId);
  } else {
    selection.ids.add(buildId);
  }
  selection.lastClickedId = buildId;
}

function _rangeSelect(buildId) {
  const builds = getVisibleBuilds();
  const ids = builds.map((b) => b.id);

  const anchorIndex = ids.indexOf(selection.lastClickedId);
  const targetIndex = ids.indexOf(buildId);

  if (anchorIndex === -1 || targetIndex === -1) {
    _singleSelect(buildId);
    return;
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);

  // Replace selection with range; preserve lastClickedId (the anchor)
  selection.ids = new Set(ids.slice(start, end + 1));
  // Note: lastClickedId stays as the anchor for subsequent shift+clicks
}

/**
 * Update DOM: add/remove `lib-selected` class on [data-build-id] elements.
 */
function updateSelectionVisuals() {
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    const buildId = el.dataset.buildId;
    if (!buildId) return;
    if (selection.ids.has(buildId)) {
      el.classList.add("lib-selected");
    } else {
      el.classList.remove("lib-selected");
    }
  });
}
