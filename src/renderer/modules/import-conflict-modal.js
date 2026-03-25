// Import Conflict Modal — per-item conflict resolution dialog for .axicode imports.
// Singleton overlay, Promise-based API. Follows confirm-modal.js pattern.

let _overlay = null;
let _escHandler = null;
let _resolve = null;

export function initImportConflictModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "icm-overlay icm-overlay--hidden";
  _overlay.innerHTML = `
    <div class="icm">
      <div class="icm__header">
        <h3 class="icm__title" id="icm-title">Import Conflicts</h3>
        <button class="icm__close" id="icm-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="icm__subtitle" id="icm-subtitle"></div>
      <div class="icm__list" id="icm-list"></div>
      <div class="icm__footer">
        <div class="icm__bulk">
          <button class="icm__bulk-btn" id="icm-replace-all">Replace All</button>
          <button class="icm__bulk-btn" id="icm-copy-all">Copy All</button>
          <button class="icm__bulk-btn" id="icm-skip-all">Skip All</button>
        </div>
        <div class="icm__actions">
          <button class="icm__btn" id="icm-cancel">Cancel</button>
          <button class="icm__btn icm__btn--primary" id="icm-import">Import</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById("icm-close").addEventListener("click", () => _dismiss(null));
  document.getElementById("icm-cancel").addEventListener("click", () => _dismiss(null));
  document.getElementById("icm-import").addEventListener("click", _handleImport);

  document.getElementById("icm-replace-all").addEventListener("click", () => _setAllDropdowns("replace"));
  document.getElementById("icm-copy-all").addEventListener("click", () => _setAllDropdowns("copy"));
  document.getElementById("icm-skip-all").addEventListener("click", () => _setAllDropdowns("skip"));
}

/**
 * Show the import conflict resolution dialog.
 * @param {{ conflicts: Array<{ type: string, imported: Object, existing: Object }>, totalCount: number }} opts
 * @returns {Promise<Map<string, string>|null>} Map<id, 'replace'|'copy'|'skip'> or null if cancelled
 */
export function showImportConflictModal({ conflicts, totalCount }) {
  if (!_overlay) return Promise.resolve(null);
  if (_resolve) _resolve(null);

  const subtitle = document.getElementById("icm-subtitle");
  subtitle.textContent = `${conflicts.length} of ${totalCount} items already exist in your library.`;

  const list = document.getElementById("icm-list");
  list.innerHTML = conflicts
    .map((c) => {
      const id = c.imported.id;
      const name = c.imported.title || c.imported.name || "Untitled";
      const typeLabel = c.type === "build" ? "Build" : c.type === "comp" ? "Comp" : "Folder";
      return `
        <div class="icm__row" data-conflict-id="${id}">
          <div class="icm__row-info">
            <span class="icm__row-type icm__row-type--${c.type}">${typeLabel}</span>
            <span class="icm__row-name">${_escapeHtml(name)}</span>
          </div>
          <select class="icm__row-select" data-conflict-id="${id}">
            <option value="copy" selected>Import as Copy</option>
            <option value="replace">Replace</option>
            <option value="skip">Skip</option>
          </select>
        </div>
      `;
    })
    .join("");

  _overlay.classList.remove("icm-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _dismiss(null); };
  document.addEventListener("keydown", _escHandler);

  return new Promise((resolve) => { _resolve = resolve; });
}

function _handleImport() {
  const selects = _overlay.querySelectorAll(".icm__row-select");
  const result = new Map();
  for (const sel of selects) {
    result.set(sel.dataset.conflictId, sel.value);
  }
  _dismiss(result);
}

function _setAllDropdowns(value) {
  const selects = _overlay.querySelectorAll(".icm__row-select");
  for (const sel of selects) sel.value = value;
}

function _dismiss(result) {
  if (!_overlay) return;
  _overlay.classList.add("icm-overlay--hidden");
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

function _escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
