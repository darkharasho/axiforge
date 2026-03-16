// Module-level state — one modal instance for the entire app lifetime
let _overlay = null;
let _webview = null;
let _urlDisplay = null;
let _currentUrl = "";
let _escHandler = null;

export function initWikiModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return; // already initialized
  _overlay = document.createElement("div");
  _overlay.className = "wiki-modal-overlay wiki-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="wiki-modal">
      <div class="wiki-modal-toolbar">
        <span class="wiki-modal-label">Wiki</span>
        <div class="wiki-modal-url" id="wiki-modal-url"></div>
        <button class="wiki-modal-btn" id="wiki-modal-copy">Copy URL</button>
        <button class="wiki-modal-btn wiki-modal-btn--close" id="wiki-modal-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="wiki-modal-body">
        <div class="wiki-modal-loading wiki-modal-loading--hidden" id="wiki-modal-loading">
          <div class="wiki-modal-spinner"></div>
          <span class="wiki-modal-loading-text">Loading&hellip;</span>
        </div>
        <webview class="wiki-modal-webview" id="wiki-modal-webview" partition="wiki"></webview>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _webview = document.getElementById("wiki-modal-webview");
  _urlDisplay = document.getElementById("wiki-modal-url");
  const loadingEl = document.getElementById("wiki-modal-loading");

  document.getElementById("wiki-modal-close").addEventListener("click", closeWikiModal);

  const copyBtn = document.getElementById("wiki-modal-copy");
  let _copyResetTimer = null;
  copyBtn.addEventListener("click", () => {
    if (!_currentUrl) return;
    window.desktopApi?.writeClipboardText(_currentUrl);
    copyBtn.textContent = "✓ Copied";
    copyBtn.classList.add("wiki-modal-btn--copied");
    clearTimeout(_copyResetTimer);
    _copyResetTimer = setTimeout(() => {
      copyBtn.textContent = "Copy URL";
      copyBtn.classList.remove("wiki-modal-btn--copied");
    }, 1800);
  });

  _webview.addEventListener("did-navigate", (e) => {
    _currentUrl = e.url;
    _urlDisplay.textContent = e.url;
  });

  _webview.addEventListener("did-navigate-in-page", (e) => {
    _currentUrl = e.url;
    _urlDisplay.textContent = e.url;
  });

  _webview.addEventListener("did-start-loading", () => {
    loadingEl.classList.remove("wiki-modal-loading--hidden");
  });

  _webview.addEventListener("did-stop-loading", () => {
    loadingEl.classList.add("wiki-modal-loading--hidden");
  });

  // Electron's backing iframe lives inside the webview's shadow root and has no height set.
  // CSS selectors can't pierce shadow DOM, so we set it directly via JS.
  const _fixIframeHeight = () => {
    const iframe = _webview.shadowRoot?.querySelector("iframe") ?? _webview.querySelector("iframe");
    if (iframe) iframe.style.height = "100%";
  };
  _webview.addEventListener("did-attach", _fixIframeHeight);
  _webview.addEventListener("dom-ready", _fixIframeHeight);
}

export function openWikiModal(url) {
  if (!_overlay) return; // not yet initialized
  _currentUrl = url;
  _urlDisplay.textContent = url;
  if (_webview.src !== url) _webview.src = url; // skip reload if same URL already loaded

  if (!_overlay.classList.contains("wiki-modal-overlay--hidden")) {
    return; // Already visible — webview src updated above if needed;
            // Escape handler is already registered, no need to re-register
  }

  _overlay.classList.remove("wiki-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") closeWikiModal(); };
  document.addEventListener("keydown", _escHandler);
}

export function closeWikiModal() {
  _overlay.classList.add("wiki-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}
