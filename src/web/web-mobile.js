/* src/web/web-mobile.js — Playground mobile behavior (web build only). */

let installed = false;

/** Wire collapsible sections + custom-select touch fix. Idempotent. */
export function initWebMobile() {
  if (installed) return;
  installed = true;

  // Some touch browsers don't synthesize a click that the custom-select opens on.
  // Bridge pointerup -> click on select triggers (web build only).
  //
  // Double-fire prevention: after our bridge calls trigger.click() (which opens the
  // menu synchronously), the browser also synthesizes a subsequent click event from
  // the touch gesture. We suppress that second click in the capture phase — preventing
  // it from reaching the cselect's own listener which would toggle the menu closed.
  //
  // Sequence:
  //   1. pointerup fires → bridge calls trigger.click() → cselect opens (flag not set yet)
  //   2. Bridge sets _csBridgePending = true AFTER our click completes
  //   3. Browser synthesizes click → capture handler sees flag → suppresses it → clears flag
  //
  // Desktop guard: e.pointerType !== "touch" exits early, so mouse/keyboard on desktop is
  // completely unaffected. The capture handler also only acts when the flag is set.
  document.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType !== "touch") return;
      const trigger = e.target.closest?.(".cselect__trigger, #professionSelect button");
      if (!trigger) return;
      const alreadyOpen = document.querySelector('[data-cselect-portal="1"]');
      if (!alreadyOpen) {
        // Fire the click first (opens the menu synchronously via cselect's click listener),
        // THEN set the flag so the browser's subsequent synthetic click gets suppressed.
        // Use try/finally so the flag is always set even if trigger.click() throws.
        try {
          trigger.click();
        } finally {
          trigger._csBridgePending = true;
        }
      }
    },
    { passive: true }
  );

  // Capture-phase click handler: suppress the browser-synthesized click that follows
  // our bridge's trigger.click(), so the cselect doesn't toggle the menu closed.
  document.addEventListener(
    "click",
    (e) => {
      const trigger = e.target.closest?.(".cselect__trigger, #professionSelect button");
      if (!trigger || !trigger._csBridgePending) return;
      // Consume the flag — only suppress once per bridge fire.
      trigger._csBridgePending = false;
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true }
  );
}
