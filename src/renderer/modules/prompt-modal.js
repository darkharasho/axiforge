// Prompt Modal — a single-line text input in a modal.
//
// Electron's renderer does not implement window.prompt(): calling it raises
// "Error: prompt() is and will not be supported.", which any surrounding
// try/catch then paints as a failure. Everything that needs to ask the user for
// a string goes through here instead.
//
// Reuses the confirm-modal styles; the overlay is built and torn down per call,
// so concurrent prompts never share state.

import { escapeHtml } from "./utils.js";

/**
 * Show a text-input prompt via a modal.
 * @param {string} title
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>} the trimmed input, or null if cancelled/empty
 */
export function showPrompt(title, defaultValue = "") {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal">
        <div class="confirm-modal__header">
          <h3 class="confirm-modal__title">${escapeHtml(title)}</h3>
        </div>
        <div class="confirm-modal__body">
          <input type="text" class="confirm-modal__input" value="" style="width:100%;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text);font-size:0.9rem;outline:none;" />
        </div>
        <div class="confirm-modal__actions">
          <button class="confirm-modal__btn" data-action="cancel">Cancel</button>
          <button class="confirm-modal__btn confirm-modal__btn--confirm" data-action="ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("input");
    input.value = defaultValue;
    input.focus();
    input.select();

    function dismiss(value) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    }

    function onKey(e) {
      if (e.key === "Escape") dismiss(null);
      if (e.key === "Enter") dismiss(input.value.trim() || null);
    }

    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => dismiss(null));
    overlay.querySelector('[data-action="ok"]').addEventListener("click", () => dismiss(input.value.trim() || null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(null); });
  });
}
