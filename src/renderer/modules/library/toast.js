// Library toast — the single transient-feedback surface for library actions.
//
// Most library actions are undoable (see undo.js), but the undo stack used to be
// invisible: the only hint it existed was a sentence inside the delete confirm.
// Every file manager worth copying instead puts an Undo button in the toast the
// action raises, which is what `action` here is for. That makes the toast the
// discovery mechanism, so it has to survive long enough to actually be clicked.

const PLAIN_MS = 2000;
const ACTION_MS = 6000; // long enough to notice a button, reach it and click

let _toastEl = null;
let _msgEl = null;
let _toastTimer = null;
let _dismissMs = PLAIN_MS;

function _ensureEl() {
  if (_toastEl) return;
  _toastEl = document.createElement("div");
  _toastEl.className = "lib-toast";
  _msgEl = document.createElement("span");
  _msgEl.className = "lib-toast__msg";
  _toastEl.appendChild(_msgEl);
  // Reaching for the Undo button must not race the dismiss timer.
  _toastEl.addEventListener("mouseenter", () => clearTimeout(_toastTimer));
  _toastEl.addEventListener("mouseleave", () => _scheduleDismiss(_dismissMs));
  document.body.appendChild(_toastEl);
}

function _scheduleDismiss(ms) {
  clearTimeout(_toastTimer);
  if (ms === Infinity) return;
  _toastTimer = setTimeout(_dismiss, ms);
}

function _dismiss() {
  clearTimeout(_toastTimer);
  _toastEl?.classList.remove("lib-toast--visible");
}

/**
 * @param {string} message - shown as text; build titles reach here verbatim
 * @param {"success"|"error"|"warning"|"loading"} type
 * @param {{label: string, onClick: () => void}} [action] - e.g. an Undo button
 */
export function showToast(message, type = "success", action = null) {
  _ensureEl();
  _msgEl.textContent = message;

  // Rebuild from scratch each time: a stale Undo button left over from the
  // previous toast would undo something the user is no longer being told about.
  _toastEl.querySelector(".lib-toast__action")?.remove();
  if (action?.label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lib-toast__action";
    btn.textContent = action.label;
    // Undo pops a stack — a double-click would undo two unrelated actions.
    btn.addEventListener("click", () => {
      _dismiss();
      action.onClick?.();
    }, { once: true });
    _toastEl.appendChild(btn);
  }

  _toastEl.className = `lib-toast lib-toast--${type}`;
  // .lib-toast is pointer-events:none so it never blocks the UI behind it; a
  // toast carrying a button has to opt back in or the button is unclickable.
  if (action?.label) _toastEl.classList.add("lib-toast--interactive");
  // Force reflow so transition fires even if toast is already visible
  void _toastEl.offsetWidth;
  _toastEl.classList.add("lib-toast--visible");

  _dismissMs = type === "loading" ? Infinity : action?.label ? ACTION_MS : PLAIN_MS;
  _scheduleDismiss(_dismissMs);
}

export function _resetToastForTests() {
  clearTimeout(_toastTimer);
  _toastEl?.remove();
  _toastEl = null;
  _msgEl = null;
  _toastTimer = null;
  _dismissMs = PLAIN_MS;
}
