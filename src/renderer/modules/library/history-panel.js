// Build history slide-in panel — shows the per-record change log. Restoring is
// NOT done from here: every entry opens the compare modal, which owns the
// confirmation, so no single click in this list can roll a record back.
// NOTE: deliberately does NOT import from library.js to avoid a circular dependency.
// Toast feedback is dispatched via CustomEvent so library.js can pick it up.

import { escapeHtml } from "../utils.js";
import { state } from "../state.js";
import { showCompareModal, isCompareModalOpen, closeCompareModal } from "./history-compare.js";
import { renderOpIconStrip } from "./history-diff-view.js";

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
      width: 380px;
      max-width: 100vw;
      background: var(--panel, #141518);
      border-left: 1px solid var(--line, #1e1f24);
      display: flex;
      flex-direction: column;
      z-index: 1101;
      box-shadow: var(--shadow-lg, -4px 0 24px rgba(0,0,0,0.4));
      animation: history-panel-in 0.16s ease-out;
    }
    @keyframes history-panel-in {
      from { transform: translateX(12px); opacity: 0; }
      to { transform: none; opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .history-panel { animation: none; }
    }
    .history-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 14px 16px;
      background: var(--panel-gradient, none);
      border-bottom: 1px solid var(--line, #1e1f24);
      flex-shrink: 0;
    }
    .history-panel__title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text, #e2e3e8);
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
      color: var(--text-dim, #646670);
      padding: 4px;
      border-radius: var(--radius-xs, 4px);
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .history-panel__close:hover { color: var(--text, #e2e3e8); background: var(--hover-subtle, rgba(255,255,255,0.05)); }
    .history-panel__list {
      overflow-y: auto;
      flex: 1;
      padding: 6px 0 16px;
    }
    .history-panel__empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--text-dim, #646670);
      font-size: 13px;
      line-height: 1.6;
    }

    /* Entries are a vertical timeline: a hairline rail down the left with one
       dot per change, tinted by where the change came from. */
    .history-panel__entry {
      position: relative;
      padding: 11px 14px 12px 36px;
      transition: background 0.12s ease;
    }
    .history-panel__entry:hover { background: var(--hover-subtle, rgba(255,255,255,0.05)); }
    /* The row body opens the side-by-side compare; the actions block below it
       does not (its own handlers own those clicks). */
    .history-panel__entry-body { cursor: pointer; }
    .history-panel__entry::before {
      content: "";
      position: absolute;
      left: 19px;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--line, #1e1f24);
    }
    .history-panel__entry:first-child::before { top: 17px; }
    .history-panel__entry:last-child::before { bottom: auto; height: 17px; }
    .history-panel__dot {
      position: absolute;
      left: 15px;
      top: 14px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--panel, #141518);
      border: 2px solid var(--text-dim, #646670);
      box-sizing: border-box;
    }
    .history-panel__dot--sync { border-color: var(--accent-2, #64aaf0); }
    .history-panel__dot--revert { border-color: var(--accent, #c89848); }

    .history-panel__entry-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 3px;
    }
    .history-panel__entry-time {
      font-size: 11px;
      color: var(--text-dim, #646670);
    }
    .history-panel__badge {
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .history-panel__badge--local { background: var(--hover-subtle, rgba(255,255,255,0.05)); color: var(--text-dim, #646670); }
    .history-panel__badge--sync { background: rgba(var(--accent-2-rgb, 100,170,240), 0.14); color: var(--accent-2, #64aaf0); }
    .history-panel__badge--revert { background: rgba(var(--accent-rgb, 200,152,72), 0.14); color: var(--accent, #c89848); }
    .history-panel__badge--deleted { background: rgba(var(--danger-rgb, 214,92,92), 0.14); color: var(--danger, #d65c5c); }
    /* The build is in the trash: dim the entry so the list reads at a glance,
       but keep it fully legible — this is the row you came here to act on. */
    .history-panel__entry--deleted .history-panel__entry-build { color: var(--danger, #d65c5c); }
    .history-panel__entry-build {
      font-size: 11px;
      font-weight: 600;
      color: var(--accent-2, #64aaf0);
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .history-panel__entry-summary {
      font-size: 12px;
      line-height: 1.45;
      color: var(--text-light, #aeafb8);
      margin-bottom: 8px;
      word-break: break-word;
    }

    /* The artwork of what changed, under the sentence that describes it. The
       sentence stays the description; this is so a glance down the feed says
       "a rune and two sigils moved" before anything is read. */
    .hist-strip {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: -4px 0 8px;
    }
    .hist-strip__pair {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 5px;
      border: 1px solid var(--line, #1e1f24);
      border-radius: 999px;
    }
    .hist-strip__arrow { font-size: 9px; color: var(--text-dim, #646670); }
    .hist-strip__icon {
      width: 18px;
      height: 18px;
      border-radius: 3px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .hist-strip__icon--svg { display: inline-flex; opacity: 0.7; }
    .hist-strip__icon--svg svg { width: 100%; height: 100%; fill: currentColor; }
    .hist-strip__icon--empty {
      display: inline-block;
      border: 1px dashed var(--line, #1e1f24);
      border-radius: 3px;
      box-sizing: border-box;
    }
    .hist-strip__more { font-size: 11px; color: var(--text-dim, #646670); }

    /* Dimmed until the row is hovered or keyboard-focused, so a long feed reads
       as history first and a wall of buttons second. */
    .history-panel__actions { opacity: 0.5; transition: opacity 0.12s ease; }
    .history-panel__entry:hover .history-panel__actions,
    .history-panel__entry:focus-within .history-panel__actions { opacity: 1; }
    .history-panel__revert {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: var(--radius-xs, 4px);
      border: 1px solid var(--line, #1e1f24);
      background: transparent;
      color: var(--text-light, #aeafb8);
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
    }
    .history-panel__revert:hover:not(:disabled) {
      background: var(--hover-accent, rgba(200,152,72,0.12));
      border-color: rgba(var(--accent-rgb, 200,152,72), 0.45);
      color: var(--accent, #c89848);
    }
    .history-panel__revert:focus-visible {
      outline: 2px solid var(--focus-ring, rgba(200,152,72,0.26));
      outline-offset: 1px;
    }
    .history-panel__revert:disabled { opacity: 0.35; cursor: not-allowed; }

    .history-panel__confirm {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 9px;
      border-radius: var(--radius-sm, 6px);
      border: 1px solid rgba(var(--accent-rgb, 200,152,72), 0.28);
      background: rgba(var(--accent-rgb, 200,152,72), 0.07);
    }
    .history-panel__confirm-text {
      font-size: 11px;
      color: var(--text-light, #aeafb8);
      line-height: 1.45;
    }
    .history-panel__confirm-buttons {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .history-panel__confirm-yes {
      border-color: var(--btn-primary-to, #a87828);
      background: linear-gradient(180deg, var(--btn-primary-from, #c89848), var(--btn-primary-to, #a87828));
      color: #17120a;
      font-weight: 600;
    }
    .history-panel__confirm-yes:hover:not(:disabled) {
      background: linear-gradient(180deg, var(--btn-primary-from-hover, #d0a858), var(--btn-primary-to-hover, #b89038));
      border-color: var(--btn-primary-to-hover, #b89038);
      color: #17120a;
    }
  `;
  document.head.appendChild(style);
}

function _isSync(source) {
  // "team-sync" is what teamSync.js writes; "shared-sync" is the legacy name
  // from the GitHub-org sync era and still exists in older history files.
  return source === "team-sync" || source === "shared-sync";
}

function _badgeClass(source) {
  if (_isSync(source)) return "history-panel__badge--sync";
  if (source === "revert") return "history-panel__badge--revert";
  return "history-panel__badge--local";
}

function _dotClass(source) {
  if (_isSync(source)) return "history-panel__dot--sync";
  if (source === "revert") return "history-panel__dot--revert";
  return "";
}

function _badgeLabel(source) {
  if (_isSync(source)) return "sync";
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

export async function showFolderHistoryPanel(folderId, folderName) {
  closeHistoryPanel();
  _injectStyles();

  const overlay = document.createElement("div");
  overlay.className = "history-panel-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeHistoryPanel();
  });

  const panel = document.createElement("div");
  panel.className = "history-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Folder History");

  panel.innerHTML = `
    <div class="history-panel__header">
      <h2 class="history-panel__title">History: ${escapeHtml(folderName || "Folder")}</h2>
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

  // Escape belongs to the compare modal while it is open — closing the panel
  // out from under it would take the modal with it.
  _escHandler = (e) => {
    if (e.key !== "Escape") return;
    if (isCompareModalOpen()) return;
    closeHistoryPanel();
  };
  document.addEventListener("keydown", _escHandler);

  try {
    // getFolderHistory returns a bare array (deliberately — it is a merged
    // feed, not a paged log), but tolerate the wrapped shape too.
    const res = await window.desktopApi.getFolderHistory(folderId);
    const entries = Array.isArray(res) ? res : ((res && res.versions) || []);
    _renderFolderEntries(panel.querySelector("#history-panel-list"), entries);
  } catch (err) {
    panel.querySelector("#history-panel-list").innerHTML =
      `<div class="history-panel__empty">Failed to load history.</div>`;
  }
}

function _renderFolderEntries(listEl, entries) {
  if (!entries || entries.length === 0) {
    listEl.innerHTML = `<div class="history-panel__empty">No history yet.<br>Changes will appear here after syncs or saves.</div>`;
    return;
  }

  listEl.innerHTML = entries.map((entry) => {
    // v2 stores no per-entry snapshot: a version is reconstructed by replaying
    // the log up to it, so EVERY listed version is restorable. Restorability
    // is keyed off the version existing, nothing else.
    // A record sitting in the trash is still listed here, and restoring one of
    // its versions takes it back out — so the button has to say that rather
    // than "Restore", which reads as a no-op on something that looks gone.
    // "Review &" because the button opens the compare modal: restoring is only
    // reachable from there, after you have seen the diff.
    const label = entry.recordDeleted ? "Review &amp; bring it back" : "Review &amp; restore";
    return `
    <div class="history-panel__entry${entry.recordDeleted ? " history-panel__entry--deleted" : ""}"
      data-hist-v="${escapeHtml(String(entry.v))}" data-record-id="${escapeHtml(String(entry.recordId ?? ""))}">
      <span class="history-panel__dot ${_dotClass(entry.source)}"></span>
      <div class="history-panel__entry-body" role="button" tabindex="0" title="Compare this version">
        <div class="history-panel__entry-meta">
          <span class="history-panel__entry-time">${escapeHtml(_formatTime(entry.ts))}</span>
          <span class="history-panel__badge ${_badgeClass(entry.source)}">${_badgeLabel(entry.source)}</span>
          ${entry.author ? `<span class="history-panel__entry-time">${escapeHtml(entry.author)}</span>` : ""}
          ${entry.recordDeleted ? `<span class="history-panel__badge history-panel__badge--deleted">in trash</span>` : ""}
        </div>
        ${entry.recordTitle ? `<div class="history-panel__entry-build">${escapeHtml(entry.recordTitle)}</div>` : ""}
        <div class="history-panel__entry-summary">${escapeHtml(_summaryText(entry))}</div>
        ${renderOpIconStrip(entry.ops, { catalog: state.upgradeCatalog })}
      </div>
      <div class="history-panel__actions">
        <button class="history-panel__revert">${label}</button>
      </div>
    </div>
  `;
  }).join("");

  // Bind by DOM order rather than by id selector — record ids are opaque and
  // would need CSS.escape, which isn't available in every environment.
  listEl.querySelectorAll(".history-panel__entry").forEach((row, i) => {
    const entry = entries[i];
    const open = () => showCompareModal({
      kind: entry.recordKind === "comp" ? "comp" : "build",
      recordId: entry.recordId,
      version: entry.v,
      title: entry.recordTitle || "",
      deleted: !!entry.recordDeleted,
      onRestored: closeHistoryPanel,
    });
    const btn = row.querySelector(".history-panel__revert");
    if (btn) btn.addEventListener("click", open);
    _bindCompare(row, open);
  });
}

// The origin keyframe has no predecessor, so it carries no ops and its summary
// is empty. Saying "no changes" there would be a lie about the build's first
// recorded state.
function _summaryText(entry) {
  if (entry.summary) return entry.summary;
  if (entry.v === 1) return "Created — the first recorded state";
  return "No described changes";
}

// The row body opens the compare modal; the actions block keeps its own
// clicks. Enter/Space match the button role the body advertises.
function _bindCompare(row, open) {
  const body = row.querySelector(".history-panel__entry-body");
  if (!body) return;
  body.addEventListener("click", (e) => {
    if (e.target.closest(".history-panel__actions")) return;
    open();
  });
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
}

export async function showHistoryPanel(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  return _showRecordHistory({
    kind: "build",
    id: buildId,
    label: "Build",
    title: build?.title || "Build",
    fetch: (id) => window.desktopApi.getBuildHistory(id),
  });
}

/**
 * The same panel for a comp. Comps had no history at all until now — the thing
 * a squad actually argues over, and the thing one drag can restructure, kept no
 * record of who changed what.
 */
export async function showCompHistoryPanel(compId) {
  const comp = (state.comps || []).find((c) => c.id === compId);
  return _showRecordHistory({
    kind: "comp",
    id: compId,
    label: "Comp",
    title: comp?.name || "Comp",
    fetch: (id) => window.desktopApi.getCompHistory(id),
  });
}

async function _showRecordHistory({ kind, id, label, title, fetch }) {
  closeHistoryPanel();
  _injectStyles();

  const overlay = document.createElement("div");
  overlay.className = "history-panel-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeHistoryPanel();
  });

  const panel = document.createElement("div");
  panel.className = "history-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `${label} History`);

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

  // Escape belongs to the compare modal while it is open — closing the panel
  // out from under it would take the modal with it.
  _escHandler = (e) => {
    if (e.key !== "Escape") return;
    if (isCompareModalOpen()) return;
    closeHistoryPanel();
  };
  document.addEventListener("keydown", _escHandler);

  // Fetch and render history
  try {
    // The per-record reads hand back {versions, nextCursor}; the folder feed is
    // a bare array. Tolerate both so a stubbed api can't silently render empty.
    const res = await fetch(id);
    const entries = Array.isArray(res) ? res : ((res && res.versions) || []);
    _renderEntries(panel.querySelector("#history-panel-list"), { id, kind, title }, entries);
  } catch (err) {
    panel.querySelector("#history-panel-list").innerHTML =
      `<div class="history-panel__empty">Failed to load history.</div>`;
  }
}

function _renderEntries(listEl, record, entries) {
  if (!entries || entries.length === 0) {
    listEl.innerHTML = `<div class="history-panel__empty">No history yet.<br>Changes will appear here after saves.</div>`;
    return;
  }

  // v2 has no per-entry snapshot — a version is reconstructed by replaying the
  // log — so every listed version is restorable. No "nothing to restore" case.
  listEl.innerHTML = entries.map((entry) => `
    <div class="history-panel__entry" data-hist-v="${escapeHtml(String(entry.v))}" data-record-id="${escapeHtml(String(record.id))}">
      <span class="history-panel__dot ${_dotClass(entry.source)}"></span>
      <div class="history-panel__entry-body" role="button" tabindex="0" title="Compare this version">
        <div class="history-panel__entry-meta">
          <span class="history-panel__entry-time">${escapeHtml(_formatTime(entry.ts))}</span>
          <span class="history-panel__badge ${_badgeClass(entry.source)}">${_badgeLabel(entry.source)}</span>
          ${entry.author ? `<span class="history-panel__entry-time">${escapeHtml(entry.author)}</span>` : ""}
        </div>
        <div class="history-panel__entry-summary">${escapeHtml(_summaryText(entry))}</div>
        ${renderOpIconStrip(entry.ops, { catalog: state.upgradeCatalog })}
      </div>
      <div class="history-panel__actions">
        <button class="history-panel__revert" data-hist-v="${escapeHtml(String(entry.v))}">
          Review &amp; restore
        </button>
      </div>
    </div>
  `).join("");

  // The button and the row body do the same thing: open the compare modal.
  // Restoring lives behind the modal's own confirmation and nowhere else, so a
  // stray click in this list can never roll a build back.
  listEl.querySelectorAll(".history-panel__entry").forEach((row, i) => {
    const entry = entries[i];
    const open = () => showCompareModal({
      kind: record.kind,
      recordId: record.id,
      version: entry.v,
      title: record.title || "",
      onRestored: closeHistoryPanel,
    });
    const btn = row.querySelector(".history-panel__revert");
    if (btn) btn.addEventListener("click", open);
    _bindCompare(row, open);
  });

}

export function closeHistoryPanel() {
  // The compare modal is parented to <body>, not to the panel, so it would
  // otherwise be left floating over an empty library.
  closeCompareModal();
  if (_panel) {
    _panel.remove();
    _panel = null;
  }
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}
