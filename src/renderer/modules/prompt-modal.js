// Prompt Modal — a single-line text input in a modal.
//
// Electron's renderer does not implement window.prompt(): calling it raises
// "Error: prompt() is and will not be supported.", which any surrounding
// try/catch then paints as a failure. Everything that needs to ask the user for
// a string goes through here instead.
//
// The overlay, Escape, backdrop-click and teardown all come from form-modal.js
// — this module is only the field and the "empty means no" rule.

import { showFormModal } from "./form-modal.js";

/**
 * Show a text-input prompt via a modal.
 * @param {string} title
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>} the trimmed input, or null if cancelled/empty
 */
export function showPrompt(title, defaultValue = "") {
  return showFormModal({
    title,
    confirmLabel: "OK",
    body: `<input type="text" class="confirm-modal__input" value="" style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;" />`,
    setup: ({ overlay, confirm }) => {
      const input = overlay.querySelector("input");
      input.value = defaultValue;
      input.select();
      // Nothing to validate: an empty answer is a "no", not a blocked button.
      confirm.disabled = false;
      return () => input.value.trim() || null;
    },
  });
}
