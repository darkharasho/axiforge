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
          <h4 class="settings-modal__section-title">Discord</h4>
          <label class="settings-modal__label" for="sm-webhook-url">Webhook URL</label>
          <input type="text" class="settings-modal__input" id="sm-webhook-url" placeholder="https://discord.com/api/webhooks/..." autocomplete="off" spellcheck="false">
          <span class="settings-modal__error" id="sm-webhook-error"></span>
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
    save:         document.getElementById("sm-save"),
  };

  _el.close.addEventListener("click", _close);
  _el.save.addEventListener("click", _save);
}

export async function openSettingsModal() {
  if (!_overlay) return;

  // Load current values
  const webhookUrl = await window.desktopApi.getSetting("discord.webhookUrl");
  _el.webhookUrl.value = webhookUrl || "";
  _el.webhookError.textContent = "";

  _overlay.classList.remove("settings-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _close(); };
  document.addEventListener("keydown", _escHandler);
  _el.webhookUrl.focus();
}

async function _save() {
  const url = _el.webhookUrl.value.trim();

  // Validate: allow empty (clears setting) or valid Discord webhook URL
  if (url && !WEBHOOK_RE.test(url)) {
    _el.webhookError.textContent = "Must be a Discord webhook URL";
    return;
  }

  _el.webhookError.textContent = "";
  await window.desktopApi.setSetting("discord.webhookUrl", url || null);
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
