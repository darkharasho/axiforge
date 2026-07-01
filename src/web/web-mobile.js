/* src/web/web-mobile.js — Playground mobile behavior (web build only). */

let installed = false;

/** Wire touch-friendly custom-select opening + collapsible attributes panel. Idempotent. */
export function initWebMobile() {
  if (installed) return;
  installed = true;

  // ── Custom-select: reliable open on touch (esp. iOS Safari) ──────────────
  //
  // The cselect trigger opens on a `click` (custom-select.js). On iOS Safari a
  // tap generates the click at the END of the gesture via hit-testing at that
  // moment — but our menu can open earlier, so a naive "open on pointerup" fix
  // suffers the classic ghost-click: iOS then dispatches its delayed click at
  // the point where a menu OPTION now sits, instantly closing or mis-selecting.
  //
  // Canonical fix: handle `touchend` on the trigger, call preventDefault() to
  // suppress the compatibility mouse/click sequence entirely (no ghost click),
  // then invoke the trigger's own click() to open the menu exactly once.
  // Options inside the portalled menu are NOT triggers, so their taps fall
  // through to the native click that performs selection.
  //
  // Desktop is untouched: mouse never fires touchend, so the existing click
  // listener handles everything as before.
  document.addEventListener(
    "touchend",
    (e) => {
      // Ignore multi-touch / gestures that leave fingers down.
      if (e.touches && e.touches.length > 0) return;
      const trigger = e.target.closest?.(".cselect__trigger, #professionSelect button");
      if (!trigger) return;
      // Suppress the synthesized mouse/click sequence (prevents the ghost click
      // that would land on a menu option and immediately close/mis-select).
      if (e.cancelable) e.preventDefault();
      // Open (or toggle) the select via its own click handler — exactly once.
      trigger.click();
    },
    { passive: false }
  );

  // ── Collapsible Attributes panel on phone ────────────────────────────────
  //
  // On phone the Equipment tab shows a collapsed "Attributes" bar pinned at the
  // bottom; tapping its header expands the stats. State lives as a class on
  // <body> (stable across the frequent #equipmentPanel re-renders). The
  // Attributes section is reliably the first section in .equip-col--right.
  document.addEventListener("click", (e) => {
    const head = e.target.closest?.(".equip-section__head");
    if (!head) return;
    const section = head.closest(".equip-section");
    const rightCol = section?.parentElement;
    const isAttributes =
      rightCol?.classList.contains("equip-col--right") &&
      rightCol.firstElementChild === section;
    if (!isAttributes) return;
    // Only meaningful at the phone breakpoint where the panel is collapsible.
    if (!window.matchMedia("(max-width: 600px)").matches) return;
    document.body.classList.toggle("attrs-expanded");
  });
}
