// Settings Modal — App-wide settings dialog.
// Singleton overlay, follows the confirm-modal pattern.

let _overlay = null;
let _el = {};
let _escHandler = null;

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

export function initSettingsModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "settings-modal-overlay settings-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="settings-modal">
      <div class="settings-modal__header">
        <h3 class="settings-modal__title">Settings</h3>
        <button class="settings-modal__close" id="sm-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="settings-modal__body">
        <div class="settings-modal__section">
          <h4 class="settings-modal__section-title">Discord Webhook</h4>
          <label class="settings-modal__label" for="sm-webhook-url">Webhook URL</label>
          <input type="text" class="settings-modal__input" id="sm-webhook-url" placeholder="https://discord.com/api/webhooks/..." autocomplete="off" spellcheck="false">
          <span class="settings-modal__error" id="sm-webhook-error"></span>
        </div>
        <div class="settings-modal__section">
          <h4 class="settings-modal__section-title">Forum Channel</h4>
          <div class="settings-modal__radio-group" id="sm-thread-mode">
            <label class="settings-modal__radio" data-value="none">
              <input type="radio" name="sm-thread-mode" value="none" class="settings-modal__radio-input">
              <span class="settings-modal__radio-dot"></span>
              <span class="settings-modal__radio-content">
                <span class="settings-modal__radio-label">None</span>
                <span class="settings-modal__radio-desc">Post directly to the channel</span>
              </span>
            </label>
            <label class="settings-modal__radio" data-value="auto">
              <input type="radio" name="sm-thread-mode" value="auto" class="settings-modal__radio-input">
              <span class="settings-modal__radio-dot"></span>
              <span class="settings-modal__radio-content">
                <span class="settings-modal__radio-label">Auto</span>
                <span class="settings-modal__radio-desc">Create a new forum post per comp</span>
              </span>
            </label>
            <label class="settings-modal__radio" data-value="custom">
              <input type="radio" name="sm-thread-mode" value="custom" class="settings-modal__radio-input">
              <span class="settings-modal__radio-dot"></span>
              <span class="settings-modal__radio-content">
                <span class="settings-modal__radio-label">Custom</span>
                <span class="settings-modal__radio-desc">Reply to an existing thread or post</span>
              </span>
            </label>
          </div>
          <div class="settings-modal__thread-id-row settings-modal__thread-id-row--hidden" id="sm-thread-id-row">
            <label class="settings-modal__label" for="sm-thread-id">Thread / Post ID</label>
            <input type="text" class="settings-modal__input" id="sm-thread-id" placeholder="e.g. 1234567890" autocomplete="off" spellcheck="false">
            <span class="settings-modal__error" id="sm-thread-error"></span>
          </div>
        </div>
      </div>
      <div class="settings-modal__actions">
        <button class="settings-modal__btn settings-modal__btn--save" id="sm-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    close:        document.getElementById("sm-close"),
    webhookUrl:   document.getElementById("sm-webhook-url"),
    webhookError: document.getElementById("sm-webhook-error"),
    threadMode:   document.getElementById("sm-thread-mode"),
    threadIdRow:  document.getElementById("sm-thread-id-row"),
    threadId:     document.getElementById("sm-thread-id"),
    threadError:  document.getElementById("sm-thread-error"),
    save:         document.getElementById("sm-save"),
  };

  _el.close.addEventListener("click", _close);
  _el.save.addEventListener("click", _save);

  // Toggle thread ID input visibility based on radio selection
  _el.threadMode.addEventListener("change", (e) => {
    _el.threadIdRow.classList.toggle("settings-modal__thread-id-row--hidden", e.target.value !== "custom");
  });
}

export async function openSettingsModal() {
  if (!_overlay) return;

  // Load current values
  const [webhookUrl, threadMode, threadId] = await Promise.all([
    window.desktopApi.getSetting("discord.webhookUrl"),
    window.desktopApi.getSetting("discord.threadMode"),
    window.desktopApi.getSetting("discord.threadId"),
  ]);
  _el.webhookUrl.value = webhookUrl || "";
  _el.webhookError.textContent = "";

  const mode = threadMode || "none";
  const radio = _el.threadMode.querySelector(`input[value="${mode}"]`);
  if (radio) radio.checked = true;
  _el.threadIdRow.classList.toggle("settings-modal__thread-id-row--hidden", mode !== "custom");
  _el.threadId.value = threadId || "";
  _el.threadError.textContent = "";

  _overlay.classList.remove("settings-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _close(); };
  document.addEventListener("keydown", _escHandler);
  _el.webhookUrl.focus();
}

async function _save() {
  const url = _el.webhookUrl.value.trim();
  const mode = _el.threadMode.querySelector("input:checked")?.value || "none";
  const threadId = _el.threadId.value.trim();

  // Validate webhook URL: allow empty (clears setting) or valid Discord webhook URL
  if (url && !WEBHOOK_RE.test(url)) {
    _el.webhookError.textContent = "Must be a Discord webhook URL";
    return;
  }

  // Validate thread ID when custom mode is selected
  if (mode === "custom" && !threadId) {
    _el.threadError.textContent = "Thread ID is required for custom mode";
    return;
  }
  if (mode === "custom" && !/^\d+$/.test(threadId)) {
    _el.threadError.textContent = "Must be a numeric Discord ID";
    return;
  }

  _el.webhookError.textContent = "";
  _el.threadError.textContent = "";
  await Promise.all([
    window.desktopApi.setSetting("discord.webhookUrl", url || null),
    window.desktopApi.setSetting("discord.threadMode", mode),
    window.desktopApi.setSetting("discord.threadId", mode === "custom" ? threadId : null),
  ]);
  _close();
}

function _close() {
  if (!_overlay) return;
  _overlay.classList.add("settings-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}
