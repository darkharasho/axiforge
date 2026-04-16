// Build history slide-in panel — shows per-build change log with revert support.
// NOTE: deliberately does NOT import from library.js to avoid a circular dependency.
// Toast feedback is dispatched via CustomEvent so library.js can pick it up.

import { escapeHtml } from "../utils.js";
import { state } from "../state.js";

let _panel = null;
let _escHandler = null;

const _styleId = "history-panel-styles";

function _injectStyles() {
  if (document.getElementById(_styleId)) return;
  const style = document.createElement("style");
  style.id = _styleId;
  style.textContent = `
    .history-panel-overlay {
      position: fixed;
      inset: 0;
      z-index: 1100;
      background: transparent;
    }
    .history-panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 360px;
      max-width: 100vw;
      background: var(--surface, #1e1e2e);
      border-left: 1px solid var(--input-border, #3a3a5c);
      display: flex;
      flex-direction: column;
      z-index: 1101;
      box-shadow: -4px 0 24px rgba(0,0,0,0.4);
    }
    .history-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--input-border, #3a3a5c);
      flex-shrink: 0;
    }
    .history-panel__title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text, #cdd6f4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      margin: 0;
    }
    .history-panel__close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--muted, #6c7086);
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .history-panel__close:hover { color: var(--text, #cdd6f4); background: var(--input-bg, #2a2a3c); }
    .history-panel__list {
      overflow-y: auto;
      flex: 1;
      padding: 8px 0;
    }
    .history-panel__empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--muted, #6c7086);
      font-size: 13px;
    }
    .history-panel__entry {
      padding: 10px 16px;
      border-bottom: 1px solid var(--input-border, #3a3a5c);
    }
    .history-panel__entry:last-child { border-bottom: none; }
    .history-panel__entry-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .history-panel__entry-time {
      font-size: 11px;
      color: var(--muted, #6c7086);
    }
    .history-panel__badge {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .history-panel__badge--local { background: var(--input-bg, #2a2a3c); color: var(--muted, #6c7086); }
    .history-panel__badge--sync { background: #1e3a5f; color: #7ec8e3; }
    .history-panel__badge--revert { background: #3a1e5f; color: #c9a7e3; }
    .history-panel__entry-summary {
      font-size: 12px;
      color: var(--text, #cdd6f4);
      margin-bottom: 8px;
      word-break: break-word;
    }
    .history-panel__revert {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--input-border, #3a3a5c);
      background: var(--input-bg, #2a2a3c);
      color: var(--text, #cdd6f4);
      cursor: pointer;
    }
    .history-panel__revert:hover:not(:disabled) { background: var(--accent, #7f849c); }
    .history-panel__revert:disabled { opacity: 0.4; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
}

function _badgeClass(source) {
  if (source === "shared-sync") return "history-panel__badge--sync";
  if (source === "revert") return "history-panel__badge--revert";
  return "history-panel__badge--local";
}

function _badgeLabel(source) {
  if (source === "shared-sync") return "sync";
  if (source === "revert") return "revert";
  return "local";
}

function _formatTime(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export async function showHistoryPanel(buildId) {
  closeHistoryPanel();
  _injectStyles();

  const build = state.builds.find((b) => b.id === buildId);
  const title = build?.title || "Build";

  const overlay = document.createElement("div");
  overlay.className = "history-panel-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeHistoryPanel();
  });

  const panel = document.createElement("div");
  panel.className = "history-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Build History");

  panel.innerHTML = `
    <div class="history-panel__header">
      <h2 class="history-panel__title">History: ${escapeHtml(title)}</h2>
      <button class="history-panel__close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6L18 18"/></svg>
      </button>
    </div>
    <div class="history-panel__list" id="history-panel-list">
      <div class="history-panel__empty">Loading…</div>
    </div>
  `;

  panel.querySelector(".history-panel__close").addEventListener("click", closeHistoryPanel);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  _panel = overlay;

  _escHandler = (e) => { if (e.key === "Escape") closeHistoryPanel(); };
  document.addEventListener("keydown", _escHandler);

  // Fetch and render history
  try {
    const entries = await window.desktopApi.getBuildHistory(buildId);
    _renderEntries(panel.querySelector("#history-panel-list"), buildId, entries);
  } catch (err) {
    panel.querySelector("#history-panel-list").innerHTML =
      `<div class="history-panel__empty">Failed to load history.</div>`;
  }
}

function _renderEntries(listEl, buildId, entries) {
  if (!entries || entries.length === 0) {
    listEl.innerHTML = `<div class="history-panel__empty">No history yet.<br>Changes will appear here after saves.</div>`;
    return;
  }

  listEl.innerHTML = entries.map((entry, idx) => `
    <div class="history-panel__entry" data-entry-id="${escapeHtml(entry.id)}">
      <div class="history-panel__entry-meta">
        <span class="history-panel__entry-time">${escapeHtml(_formatTime(entry.timestamp))}</span>
        <span class="history-panel__badge ${_badgeClass(entry.source)}">${_badgeLabel(entry.source)}</span>
        ${entry.authorLogin ? `<span class="history-panel__entry-time">${escapeHtml(entry.authorLogin)}</span>` : ""}
      </div>
      <div class="history-panel__entry-summary">${escapeHtml(entry.summary)}</div>
      <button class="history-panel__revert" data-entry-id="${escapeHtml(entry.id)}"
        ${idx === 0 ? "disabled title=\"This is the most recent version\"" : ""}>
        Revert to this version
      </button>
    </div>
  `).join("");

  listEl.querySelectorAll(".history-panel__revert:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Reverting…";
      try {
        const saved = await window.desktopApi.revertBuild(buildId, btn.dataset.entryId);
        // Update state and re-render library
        const idx = state.builds.findIndex((b) => b.id === saved.id);
        if (idx >= 0) state.builds[idx] = saved;
        else state.builds.push(saved);
        // Trigger library re-render via a custom event the renderer listens to
        document.dispatchEvent(new CustomEvent("library:rerender"));
        closeHistoryPanel();
        document.dispatchEvent(new CustomEvent("library:toast", { detail: { message: "Reverted!" } }));
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Revert to this version";
        document.dispatchEvent(new CustomEvent("library:toast", { detail: { message: "Revert failed — " + err.message, type: "error" } }));
      }
    });
  });
}

export function closeHistoryPanel() {
  if (_panel) {
    _panel.remove();
    _panel = null;
  }
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}
