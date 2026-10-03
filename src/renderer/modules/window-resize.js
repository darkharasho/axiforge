// Resize grips for the frameless window.
//
// The window is transparent on Linux and Windows so its corners can be rounded
// in CSS, and a transparent Electron window has no native resize border — the
// window could not be resized at all (issue #318). These eight strips, one per
// edge and corner, are the replacement: they sit inside the clip on <html>, so
// they follow the rounded corners, and they hand the main process an edge plus
// the total screen-space delta of the drag, which turns into bounds there (see
// resizeBounds in src/shared/windowChrome.js).
//
// macOS resizes natively and gets no grips, so none of this shadows a real
// border; preload decides, from the same helper main uses to create the window.

const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/**
 * @param {object} api the preload bridge (needsManualResize + resizeWindow*)
 */
export function initWindowResize(api = globalThis.desktopApi) {
  if (typeof document === "undefined") return;
  if (!api?.needsManualResize) return;
  // Idempotent off the DOM rather than a module flag, so the grips are
  // installed once per document and not once per process.
  if (document.querySelector(".af-resize-layer")) return;

  // The drag lives in this closure, not at module scope: there is one layer per
  // document, and state that outlives the layer it belongs to is state that can
  // leak a half-finished gesture into the next one.
  let drag = null;

  const layer = document.createElement("div");
  layer.className = "af-resize-layer";
  // The layer spans the window; only the grips inside it take the pointer, so
  // it cannot steal a click from the page it covers.
  for (const edge of EDGES) {
    const grip = document.createElement("div");
    // no-drag: the titlebar's drag region would otherwise swallow the top
    // grips, and -webkit-app-region wins over any pointer handler.
    grip.className = `af-resize af-resize--${edge} no-drag`;
    grip.dataset.edge = edge;
    grip.addEventListener("pointerdown", onPointerDown);
    grip.addEventListener("pointermove", onPointerMove);
    grip.addEventListener("pointerup", onPointerEnd);
    grip.addEventListener("pointercancel", onPointerEnd);
    layer.appendChild(grip);
  }
  document.body.appendChild(layer);

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const edge = event.currentTarget.dataset.edge;
    drag = { edge, screenX: event.screenX, screenY: event.screenY };
    // Capture so the drag keeps reporting once the pointer has left the 6px
    // grip, which it does immediately when the window grows away from it.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
    event.preventDefault();
    api.resizeWindowStart(edge);
  }

  function onPointerMove(event) {
    if (!drag) return;
    event.preventDefault();
    api.resizeWindowTo(event.screenX - drag.screenX, event.screenY - drag.screenY);
  }

  function onPointerEnd(event) {
    if (!drag) return;
    drag = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* unsupported */ }
    api.resizeWindowEnd();
  }
}
