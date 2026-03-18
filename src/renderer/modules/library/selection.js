// Library selection module — manages multi-select state for builds and comps.
// Supports single click, Ctrl/Meta+click (toggle), and Shift+click (range).

import { getVisibleBuilds, getVisibleComps } from "./folder-store.js";

const selection = {
  ids: new Set(),       // build IDs
  compIds: new Set(),   // comp IDs
  lastClickedId: null,
  lastClickedType: null, // "build" | "comp"
};

// ─── Public API ────────────────────────────────────────────────────────────────

/** Returns array of selected build IDs. */
export function getSelection() {
  return Array.from(selection.ids);
}

/** Returns array of selected comp IDs. */
export function getCompSelection() {
  return Array.from(selection.compIds);
}

/** Clears all selections (builds and comps). */
export function clearSelection() {
  selection.ids.clear();
  selection.compIds.clear();
  selection.lastClickedId = null;
  selection.lastClickedType = null;
  updateSelectionVisuals();
}

/** Selects all currently visible builds and comps. */
export function selectAll() {
  const builds = getVisibleBuilds();
  const comps = getVisibleComps();
  selection.ids = new Set(builds.map((b) => b.id));
  selection.compIds = new Set(comps.map((c) => c.id));
  if (comps.length > 0) {
    selection.lastClickedId = comps[comps.length - 1].id;
    selection.lastClickedType = "comp";
  } else if (builds.length > 0) {
    selection.lastClickedId = builds[builds.length - 1].id;
    selection.lastClickedType = "build";
  }
  updateSelectionVisuals();
}

/** Returns true if the given build ID is selected. */
export function isSelected(buildId) {
  return selection.ids.has(buildId);
}

/** Returns true if the given comp ID is selected. */
export function isCompSelected(compId) {
  return selection.compIds.has(compId);
}

/**
 * Handle a click on a build item.
 * @param {string} buildId
 * @param {MouseEvent} event
 */
export function handleBuildClick(buildId, event) {
  // Clear comp selection when clicking a build (unless Ctrl is held)
  if (!event.ctrlKey && !event.metaKey) {
    selection.compIds.clear();
  }
  if (event.shiftKey && selection.lastClickedId && selection.lastClickedType === "build") {
    _rangeSelect(buildId);
  } else if (event.ctrlKey || event.metaKey) {
    selection.compIds.clear();
    _toggleSelect(buildId);
  } else {
    // Clicking the sole selected item deselects it; otherwise single-select
    if (selection.ids.size === 1 && selection.ids.has(buildId) && selection.compIds.size === 0) {
      selection.ids.clear();
      selection.lastClickedId = null;
      selection.lastClickedType = null;
    } else {
      _singleSelect(buildId);
    }
  }
  selection.lastClickedType = "build";
  updateSelectionVisuals();
}

/**
 * Handle a click on a comp item.
 * @param {string} compId
 * @param {MouseEvent} event
 */
export function handleCompClick(compId, event) {
  // Clear build selection when clicking a comp (unless Ctrl is held)
  if (!event.ctrlKey && !event.metaKey) {
    selection.ids.clear();
  }
  if (event.shiftKey && selection.lastClickedId && selection.lastClickedType === "comp") {
    _compRangeSelect(compId);
  } else if (event.ctrlKey || event.metaKey) {
    selection.ids.clear();
    _compToggleSelect(compId);
  } else {
    // Clicking the sole selected comp deselects it; otherwise single-select
    if (selection.compIds.size === 1 && selection.compIds.has(compId) && selection.ids.size === 0) {
      selection.compIds.clear();
      selection.lastClickedId = null;
      selection.lastClickedType = null;
    } else {
      _compSingleSelect(compId);
    }
  }
  selection.lastClickedType = "comp";
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
  selection.compIds.clear();
  selection.lastClickedId = nextBuild.id;
  selection.lastClickedType = "build";
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

// ─── Internal helpers (builds) ─────────────────────────────────────────────────

function _singleSelect(buildId) {
  selection.ids = new Set([buildId]);
  selection.compIds.clear();
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
  // Use DOM order of build elements — this includes builds inside expanded
  // folders/comps in table view, not just top-level getVisibleBuilds()
  const container = document.getElementById("lib-content");
  const elements = container
    ? [...container.querySelectorAll("[data-build-id]")]
    : [];
  const ids = elements.map((el) => el.dataset.buildId);

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
  selection.compIds.clear();
  // Note: lastClickedId stays as the anchor for subsequent shift+clicks
}

// ─── Internal helpers (comps) ──────────────────────────────────────────────────

function _compSingleSelect(compId) {
  selection.compIds = new Set([compId]);
  selection.ids.clear();
  selection.lastClickedId = compId;
}

function _compToggleSelect(compId) {
  if (selection.compIds.has(compId)) {
    selection.compIds.delete(compId);
  } else {
    selection.compIds.add(compId);
  }
  selection.lastClickedId = compId;
}

function _compRangeSelect(compId) {
  const comps = getVisibleComps();
  const ids = comps.map((c) => c.id);

  const anchorIndex = ids.indexOf(selection.lastClickedId);
  const targetIndex = ids.indexOf(compId);

  if (anchorIndex === -1 || targetIndex === -1) {
    _compSingleSelect(compId);
    return;
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);

  selection.compIds = new Set(ids.slice(start, end + 1));
  selection.ids.clear();
}

/**
 * Update DOM: add/remove `lib-selected` class on [data-build-id] and [data-comp-id] elements.
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
  document.querySelectorAll("[data-comp-id]").forEach((el) => {
    const compId = el.dataset.compId;
    if (!compId) return;
    if (selection.compIds.has(compId)) {
      el.classList.add("lib-selected");
    } else {
      el.classList.remove("lib-selected");
    }
  });
}
