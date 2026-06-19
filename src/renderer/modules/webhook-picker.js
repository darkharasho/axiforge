// Shared webhook picker — a small modal that lets the user choose which
// Discord webhook(s) to post to when more than one is configured. Used by
// both comp sharing and build sharing.

import { escapeHtml } from "./utils.js";

// Resolves to an array of selected webhook ids, or null if cancelled.
export function pickWebhooks(webhooks) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "comp-webhook-picker-overlay";
    overlay.innerHTML = `
      <div class="comp-webhook-picker" role="dialog" aria-label="Choose webhooks">
        <div class="comp-webhook-picker__title">Share to which Discord webhook(s)?</div>
        <div class="comp-webhook-picker__list">
          ${webhooks.map((w) => `
            <label class="comp-webhook-picker__item">
              <input type="checkbox" value="${escapeHtml(w.id)}" checked>
              <span>${escapeHtml(w.name || "(unnamed)")}</span>
            </label>`).join("")}
        </div>
        <div class="comp-webhook-picker__actions">
          <button class="comp-webhook-picker__btn" data-act="cancel" type="button">Cancel</button>
          <button class="comp-webhook-picker__btn comp-webhook-picker__btn--primary" data-act="post" type="button">Post</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("[data-act='cancel']").addEventListener("click", () => close(null));
    overlay.querySelector("[data-act='post']").addEventListener("click", () => {
      const ids = Array.from(overlay.querySelectorAll("input[type='checkbox']:checked")).map((cb) => cb.value);
      if (!ids.length) return; // require at least one
      close(ids);
    });
  });
}
