"use strict";

/**
 * The frameless window's platform-dependent chrome, in one place.
 *
 * The window is transparent on Linux and Windows so the CSS radius on <html>
 * has something to show through (see createWindow in src/main/index.js and the
 * clip in src/renderer/styles/app.css); macOS rounds and shadows a frameless
 * window itself. The catch, and the reason this module exists rather than the
 * options sitting inline: a transparent Electron window has no native resize
 * border on those two platforms, so opting into transparency means the app has
 * to draw and drive its own resize grips. Two processes therefore need the same
 * answer — main, to create the window, and preload, to tell the renderer
 * whether to install the grips — and if they ever disagree the window either
 * cannot be resized at all or grows invisible grips over a native border.
 */

/** Smallest the window may become, however it is resized. */
const WINDOW_MIN = { width: 1120, height: 740 };

/**
 * The BrowserWindow options that differ by platform. Callers spread this into
 * the rest of their window options.
 * @param {string} platform process.platform
 */
function windowChromeOptions(platform) {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hidden",
      trafficLightPosition: { x: -20, y: -20 },
      backgroundColor: "#050910",
    };
  }
  return { transparent: true, backgroundColor: "#00000000" };
}

/**
 * Whether the renderer must supply its own resize grips, which is exactly when
 * the window is transparent and so has no native resize border.
 * @param {string} platform process.platform
 */
function needsManualResize(platform) {
  return windowChromeOptions(platform).transparent === true;
}

const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/**
 * The new window bounds for a resize drag, as a pure function of where it
 * started. The renderer reports the total delta from the pointer's starting
 * position rather than per-move increments, so a dropped or coalesced move
 * event cannot make the window drift away from the cursor.
 *
 * North and west move the origin as the size changes, so the opposite edge
 * stays anchored under the user's other hand; clamping at the minimum stops the
 * origin too, rather than letting it keep walking past a window that can no
 * longer shrink.
 *
 * @param {{x: number, y: number, width: number, height: number}} start bounds when the drag began
 * @param {string} edge one of EDGES
 * @param {number} dx total pointer movement since the drag began, in screen px
 * @param {number} dy
 * @param {{width: number, height: number}} [min]
 */
function resizeBounds(start, edge, dx, dy, min = WINDOW_MIN) {
  if (!EDGES.includes(edge)) return { ...start };

  let { x, y, width, height } = start;
  const dxi = Math.round(dx);
  const dyi = Math.round(dy);

  if (edge.includes("e")) width = Math.max(min.width, start.width + dxi);
  if (edge.includes("w")) {
    width = Math.max(min.width, start.width - dxi);
    x = start.x + start.width - width;
  }
  if (edge.includes("s")) height = Math.max(min.height, start.height + dyi);
  if (edge.includes("n")) {
    height = Math.max(min.height, start.height - dyi);
    y = start.y + start.height - height;
  }

  return { x: Math.round(x), y: Math.round(y), width, height };
}

module.exports = { WINDOW_MIN, EDGES, windowChromeOptions, needsManualResize, resizeBounds };
