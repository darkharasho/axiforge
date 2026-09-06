// Drag-to-resize for the library folder sidebar.
//
// The width lives on .lib-page as the --lib-sidebar-w custom property rather
// than as an inline style on the sidebar itself, because renderSidebar()
// replaces the sidebar's contents on every repaint and the collapsed/open
// classes also drive width. One variable on the stable parent survives both.

import { state } from "../state.js";

export const MIN_SIDEBAR_W = 150;
export const MAX_SIDEBAR_W = 480;
export const DEFAULT_SIDEBAR_W = 200;

/** Clamp to the usable range, falling back to the default for junk input. */
export function clampSidebarWidth(px) {
  // Number(null) is 0, which would silently clamp a missing setting down to the
  // minimum instead of leaving it at the default.
  if (px == null || px === "") return DEFAULT_SIDEBAR_W;
  const n = Number(px);
  if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_W;
  return Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, Math.round(n)));
}

/** Push the current preference onto the page. Safe to call before the DOM exists. */
export function applySidebarWidth() {
  const page = document.querySelector(".lib-page");
  if (!page) return;
  const w = clampSidebarWidth(state.libraryPrefs.sidebarWidth ?? DEFAULT_SIDEBAR_W);
  page.style.setProperty("--lib-sidebar-w", `${w}px`);
}

/**
 * Wire the drag handle between the sidebar and the main pane.
 * @param {{ onCommit?: () => void }} [opts] called once per gesture, not per
 *   pointermove -- committing writes a setting to disk.
 */
export function initSidebarResize(opts = {}) {
  const handle = document.getElementById("lib-sidebar-resizer");
  const page = document.querySelector(".lib-page");
  if (!handle || !page || handle.dataset.bound) return;
  handle.dataset.bound = "1";

  applySidebarWidth();

  const commit = (w) => {
    state.libraryPrefs.sidebarWidth = clampSidebarWidth(w);
    applySidebarWidth();
    opts.onCommit?.();
  };

  let startX = 0;
  let startW = DEFAULT_SIDEBAR_W;

  const onPointerMove = (e) => {
    const w = clampSidebarWidth(startW + (e.clientX - startX));
    page.style.setProperty("--lib-sidebar-w", `${w}px`);
  };

  const onPointerUp = (e) => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    page.classList.remove("is-resizing");
    commit(startW + (e.clientX - startX));
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const sidebar = document.getElementById("lib-sidebar");
    if (!sidebar || sidebar.classList.contains("lib-sidebar--collapsed")) return;
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width || DEFAULT_SIDEBAR_W;
    // The class kills the sidebar's width transition and text selection for the
    // duration -- with either left in place the handle lags the pointer and the
    // drag paints a selection across the folder tree.
    page.classList.add("is-resizing");
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  });

  // Double-click the handle to snap back to the default width.
  handle.addEventListener("dblclick", () => commit(DEFAULT_SIDEBAR_W));

  // Keyboard: the handle is a focusable separator, so arrows have to work.
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 32 : 8;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      commit((state.libraryPrefs.sidebarWidth ?? DEFAULT_SIDEBAR_W) - step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      commit((state.libraryPrefs.sidebarWidth ?? DEFAULT_SIDEBAR_W) + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      commit(DEFAULT_SIDEBAR_W);
    }
  });
}
