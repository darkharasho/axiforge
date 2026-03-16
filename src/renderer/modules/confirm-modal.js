// Confirm Modal — Generic reusable confirmation dialog.
// Singleton overlay, Promise-based API. Follows the detail-modal/wiki-modal pattern.

let _overlay = null;
let _el = {};
let _escHandler = null;
let _resolve = null;

export function initConfirmModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "confirm-modal-overlay confirm-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="confirm-modal">
      <div class="confirm-modal__header">
        <h3 class="confirm-modal__title" id="cm-title"></h3>
        <button class="confirm-modal__close" id="cm-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="confirm-modal__body" id="cm-body"></div>
      <div class="confirm-modal__actions">
        <button class="confirm-modal__btn" id="cm-cancel"></button>
        <button class="confirm-modal__btn confirm-modal__btn--confirm" id="cm-confirm"></button>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    title:   document.getElementById("cm-title"),
    body:    document.getElementById("cm-body"),
    close:   document.getElementById("cm-close"),
    cancel:  document.getElementById("cm-cancel"),
    confirm: document.getElementById("cm-confirm"),
  };

  _el.close.addEventListener("click", () => _dismiss(false));
  _el.cancel.addEventListener("click", () => _dismiss(false));
  _el.confirm.addEventListener("click", () => _dismiss(true));
}

/**
 * Show a confirmation dialog and return a Promise<boolean>.
 * @param {Object} options
 * @param {string} options.title   - Modal heading text
 * @param {string} options.body    - HTML string for the body content
 * @param {string} [options.confirmLabel="Confirm"] - Confirm button text
 * @param {string} [options.cancelLabel="Cancel"]   - Cancel button text
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 */
export function showConfirmModal({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel" }) {
  if (!_overlay) return Promise.resolve(false);

  // If already open, dismiss the previous one as cancelled
  if (_resolve) _resolve(false);

  _el.title.textContent = title;
  _el.body.innerHTML = body;
  _el.confirm.textContent = confirmLabel;
  _el.cancel.textContent = cancelLabel;

  _overlay.classList.remove("confirm-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _dismiss(false); };
  document.addEventListener("keydown", _escHandler);

  return new Promise((resolve) => { _resolve = resolve; });
}

function _dismiss(result) {
  if (!_overlay) return;
  _overlay.classList.add("confirm-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
  if (_resolve) {
    const resolve = _resolve;
    _resolve = null;
    resolve(result);
  }
}
