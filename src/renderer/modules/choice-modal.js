// Choice Modal — like confirm-modal, but with N labelled buttons and a distinct
// "dismissed" outcome (null) for Escape / close. Used for conflict resolution.
// Reuses the confirm-modal styles; --hidden is toggled on both overlay classes
// so the confirm-modal CSS transition applies.

let _overlay = null;
let _el = null;
let _resolve = null;
let _escHandler = null;

const HIDDEN = ["confirm-modal-overlay--hidden", "choice-modal-overlay--hidden"];

export function initChoiceModal() {
  if (typeof document === "undefined") return;
  if (_overlay?.isConnected) return;
  // The overlay was built but is no longer in the document (body replaced):
  // settle any pending promise and rebuild rather than pointing at dead nodes.
  if (_overlay) _dismiss(null);
  _overlay = document.createElement("div");
  _overlay.className = `confirm-modal-overlay choice-modal-overlay ${HIDDEN.join(" ")}`;
  _overlay.innerHTML = `
    <div class="confirm-modal choice-modal">
      <div class="confirm-modal__header">
        <h3 class="confirm-modal__title" id="chm-title"></h3>
        <button class="confirm-modal__close" id="chm-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="confirm-modal__body" id="chm-body"></div>
      <div class="confirm-modal__actions" id="chm-actions"></div>
    </div>`;
  document.body.appendChild(_overlay);
  _el = {
    title:   document.getElementById("chm-title"),
    body:    document.getElementById("chm-body"),
    actions: document.getElementById("chm-actions"),
    close:   document.getElementById("chm-close"),
  };
  _el.close.addEventListener("click", () => _dismiss(null));
}

/**
 * Show a modal with one button per choice.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.body] - HTML string
 * @param {Array<{id: string, label: string, danger?: boolean}>} options.choices
 * @returns {Promise<string|null>} the chosen id, or null if dismissed
 */
export function showChoiceModal({ title, body, choices }) {
  if (!_overlay) initChoiceModal();
  if (!_overlay) return Promise.resolve(null);

  // If already open, dismiss the previous one as cancelled.
  _dismiss(null);

  _el.title.textContent = title;
  _el.body.innerHTML = body || "";
  _el.actions.innerHTML = "";
  for (const c of choices) {
    const btn = document.createElement("button");
    btn.className = "confirm-modal__btn choice-modal__btn "
      + (c.danger ? "choice-modal__btn--danger confirm-modal__btn--confirm" : "confirm-modal__btn--primary");
    btn.textContent = c.label;
    btn.dataset.choice = c.id;
    btn.addEventListener("click", () => _dismiss(c.id));
    _el.actions.appendChild(btn);
  }

  _overlay.classList.remove(...HIDDEN);
  _escHandler = (e) => { if (e.key === "Escape") _dismiss(null); };
  document.addEventListener("keydown", _escHandler);

  return new Promise((resolve) => { _resolve = resolve; });
}

function _dismiss(result) {
  if (!_overlay) return;
  _overlay.classList.add(...HIDDEN);
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
