// Form Modal — the overlay scaffolding every "fill this in" dialog needs.
//
// confirm-modal.js answers a yes/no question and owns a single reusable
// overlay. The import dialogs are the other shape: a form with its own fields
// and its own notion of when it is valid. They were each hand-rolling the
// scaffolding around that form — create the overlay, append it, listen for
// Escape, dismiss on a backdrop click, remove the listener again — and the five
// copies had already drifted. The Import Build Link dialog was the one you
// could not dismiss by clicking outside it, for no reason other than that its
// copy of the code predated the others.
//
// So the scaffolding lives here once, and a caller supplies only the parts that
// differ: the fields, and what pressing the confirm button means.
//
// Reuses the confirm-modal styles rather than growing a parallel set.

import { escapeHtml } from "./utils.js";

/**
 * Show a modal built around a form, and resolve with whatever the caller's
 * submit() returns — or null if it was dismissed.
 *
 * Validity is the confirm button's `disabled` state and nothing else: Enter
 * submits exactly when the button would, so a dialog cannot end up with a
 * greyed-out button that the keyboard still fires.
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.body       HTML for the form fields (trusted markup —
 *                                    escape any user text before passing it)
 * @param {number} [options.width=420]
 * @param {string} [options.confirmLabel] the primary button's text; omit for a
 *                                    dialog whose body carries its own choices
 * @param {(ctx: {overlay: HTMLElement, confirm: HTMLElement|null, close: (result?: any) => void}) => (() => any)|void} [options.setup]
 *   wires the fields up. Return a submit function to make the confirm button
 *   and Enter resolve with its return value.
 * @returns {Promise<any>} the submit result, or null if dismissed
 */
export function showFormModal({ title, body, width = 420, confirmLabel, setup }) {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal" style="width:${Number(width)}px;max-width:90vw;">
        <div class="confirm-modal__header">
          <h3 class="confirm-modal__title">${escapeHtml(title)}</h3>
        </div>
        <div class="confirm-modal__body" style="display:flex;flex-direction:column;gap:10px;">${body}</div>
        <div class="confirm-modal__actions">
          <button class="confirm-modal__btn" data-action="cancel">Cancel</button>
          ${confirmLabel
            ? `<button class="confirm-modal__btn confirm-modal__btn--primary" data-action="confirm" disabled>${escapeHtml(confirmLabel)}</button>`
            : ""}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const confirm = overlay.querySelector('[data-action="confirm"]');

    function close(result = null) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    }

    let submit = null;
    function trySubmit() {
      if (!submit || (confirm && confirm.disabled)) return;
      close(submit());
    }

    function onKey(e) {
      if (e.key === "Escape") close(null);
      else if (e.key === "Enter") trySubmit();
    }

    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    if (confirm) confirm.addEventListener("click", trySubmit);

    // Focus before setup runs, so a caller that wants the text selected can
    // select it without focus() wiping the selection afterwards.
    overlay.querySelector(".confirm-modal__body input")?.focus();
    submit = (typeof setup === "function" ? setup({ overlay, confirm, close }) : null) || null;
  });
}
