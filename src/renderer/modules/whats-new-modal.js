// What's New modal — shows release notes between lastSeenVersion (exclusive)
// and the current version (inclusive). Mirrors axibridge's behavior.

import { marked } from "marked";

let _overlay = null;
let _el = {};
let _escHandler = null;
let _currentVersion = "";

export function initWhatsNewModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "whats-new-modal-overlay whats-new-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="whats-new-modal">
      <div class="whats-new-modal__header">
        <div class="whats-new-modal__title-wrap">
          <div class="whats-new-modal__title">What's New</div>
          <div class="whats-new-modal__version" id="whats-new-version"></div>
        </div>
        <button class="whats-new-modal__close" id="whats-new-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg>
        </button>
      </div>
      <div class="whats-new-modal__body" id="whats-new-body"></div>
      <div class="whats-new-modal__actions">
        <button class="whats-new-modal__btn whats-new-modal__btn--primary" id="whats-new-continue">Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    version:  document.getElementById("whats-new-version"),
    body:     document.getElementById("whats-new-body"),
    close:    document.getElementById("whats-new-close"),
    continue: document.getElementById("whats-new-continue"),
  };

  _el.close.addEventListener("click", _close);
  _el.continue.addEventListener("click", _close);
  _overlay.addEventListener("click", (e) => {
    if (e.target === _overlay) _close();
  });
}

export function openWhatsNewModal({ version, releaseNotes }) {
  if (!_overlay) return;
  _currentVersion = version || "";
  _el.version.textContent = version ? `Version ${version}` : "";
  const md = (releaseNotes || "").trim() || "Release notes unavailable.";
  _el.body.innerHTML = marked.parse(md, { breaks: true });
  _overlay.classList.remove("whats-new-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _close(); };
  document.addEventListener("keydown", _escHandler);
}

function _close() {
  if (!_overlay) return;
  _overlay.classList.add("whats-new-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
  if (_currentVersion && window.desktopApi?.setLastSeenVersion) {
    window.desktopApi.setLastSeenVersion(_currentVersion).catch(() => {});
  }
}

// Auto-open on startup if the current version differs from lastSeenVersion.
// Also wires the titlebar version label as a manual trigger.
export async function maybeAutoOpenWhatsNew(versionLabelEl) {
  if (typeof window === "undefined" || !window.desktopApi?.getWhatsNew) return;
  let data = null;
  try { data = await window.desktopApi.getWhatsNew(); } catch { return; }
  if (!data || !data.version) return;

  if (versionLabelEl) {
    versionLabelEl.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      try {
        const fresh = await window.desktopApi.getWhatsNew();
        // Manual open: show the latest section even if already seen
        openWhatsNewModal({
          version: fresh?.version || data.version,
          releaseNotes: fresh?.releaseNotes || data.releaseNotes,
        });
      } catch { /* */ }
    });
  }

  if (data.version !== data.lastSeenVersion && data.releaseNotes) {
    openWhatsNewModal({ version: data.version, releaseNotes: data.releaseNotes });
  }
}
