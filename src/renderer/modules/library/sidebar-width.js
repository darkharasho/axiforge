// The library sidebar's width bounds, and the clamp that enforces them.
//
// These live in their own leaf module because three places need the default and
// two of them cannot reach each other: state.js seeds libraryPrefs with it, and
// sidebar-resize.js applies it -- but sidebar-resize.js imports state.js, so
// state.js importing back would be a cycle. A leaf both can import is the only
// shape that leaves one copy of the number.
//
// The third place is CSS: library.css's `var(--lib-sidebar-w, <default>px)`
// fallback, which paints for the instant before applySidebarWidth() runs. A
// stylesheet cannot import this, so that one literal is a deliberate mirror and
// carries a comment saying so.

export const MIN_SIDEBAR_W = 150;
export const MAX_SIDEBAR_W = 480;
export const DEFAULT_SIDEBAR_W = 240;

/** Clamp to the usable range, falling back to the default for junk input. */
export function clampSidebarWidth(px) {
  // Number(null) is 0, which would silently clamp a missing setting down to the
  // minimum instead of leaving it at the default.
  if (px == null || px === "") return DEFAULT_SIDEBAR_W;
  const n = Number(px);
  if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_W;
  return Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, Math.round(n)));
}
