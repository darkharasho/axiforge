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
      background: var(--axi-surface);
      border-left: var(--axi-border-panel) solid var(--axi-ink-line);
      display: flex;
      flex-direction: column;
      z-index: 1101;
      box-shadow: var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line);
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
      border-bottom: var(--axi-border-hairline) solid var(--axi-rule);
      flex-shrink: 0;
    }
    .history-panel__title {
      font: var(--axi-t-label);
      letter-spacing: var(--axi-ls-label);
      color: var(--axi-text);
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
      color: var(--axi-text-faint);
      padding: 4px;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .history-panel__close:hover { color: var(--axi-text); background: var(--axi-surface-raised); }
    .history-panel__list {
      overflow-y: auto;
      flex: 1;
      padding: 6px 0 16px;
    }
    .history-panel__empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--axi-text-faint);
      font: var(--axi-t-small);
      line-height: 1.6;
    }

    /* Entries are a vertical timeline: a hairline rail down the left with one
       dot per change, tinted by where the change came from. */
    .history-panel__entry {
      position: relative;
      padding: 11px 14px 12px 36px;
      transition: background 0.12s ease;
    }
    .history-panel__entry:hover { background: var(--axi-surface-raised); }
    /* The row body opens the side-by-side compare; the actions block below it
       does not (its own handlers own those clicks). */
    .history-panel__entry-body { cursor: pointer; }
    /* The rail the events hang off. A rule, not an edge: it is inside the
       panel's running content. */
    .history-panel__entry::before {
      content: "";
      position: absolute;
      left: 19px;
      top: 0;
      bottom: 0;
      width: var(--axi-border-hairline);
      background: var(--axi-rule);
    }
    .history-panel__entry:first-child::before { top: 17px; }
    .history-panel__entry:last-child::before { bottom: auto; height: 17px; }
    /* Rule 7. A local edit is the ordinary case and is outlined; a sync, a
       revert and a deletion each get an ink, and nothing else on the timeline
       does -- three inks is already the most a column of events can carry
       before the colour stops sorting anything. */
    .history-panel__dot {
      position: absolute;
      left: 14px;
      top: 13px;
      width: 12px;
      height: 12px;
      flex: none;
      transform: rotate(45deg);
      background: var(--axi-ground);
      border: var(--axi-border-control) solid var(--axi-ink-line);
      box-sizing: border-box;
    }
    .history-panel__dot--sync { background: var(--axi-meta); }
    .history-panel__dot--revert { background: var(--axi-accent); }
    .history-panel__dot--deleted { background: var(--axi-danger); }

    .history-panel__entry-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 3px;
    }
    /* No scale step: normal-weight meta at 11px. --axi-t-micro is that size
       but 800-weight caps type, and --axi-t-small is 13.5px, so nothing fits.
       Same case as comps.css's .party-cov__toggle-text; every "same case as
       __entry-time" below is this one. */
    .history-panel__entry-time {
      font-size: 11px;
      color: var(--axi-text-faint);
    }
    .history-panel__badge {
      display: inline-block;
      padding: 1px 7px;
      border: var(--axi-border-hairline) solid var(--axi-rule);
      background: transparent;
      color: var(--axi-text-faint);
      font: var(--axi-t-micro);
      letter-spacing: var(--axi-ls-micro);
      text-transform: uppercase;
    }
    .history-panel__badge--sync { border-color: var(--axi-meta); color: var(--axi-meta); }
    .history-panel__badge--revert { border-color: var(--axi-accent); color: var(--axi-accent); }
    .history-panel__badge--deleted { border-color: var(--axi-danger); color: var(--axi-danger); }
    /* The build is in the trash: dim the entry so the list reads at a glance,
       but keep it fully legible — this is the row you came here to act on. */
    .history-panel__entry--deleted .history-panel__entry-build { color: var(--axi-danger); }
    .history-panel__entry-build {
      font: var(--axi-t-micro);
      letter-spacing: var(--axi-ls-micro);
      color: var(--axi-meta);
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .history-panel__entry-summary {
      font: var(--axi-t-small);
      line-height: 1.45;
      color: var(--axi-text-dim);
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
      border: var(--axi-border-hairline) solid var(--axi-rule);
    }
    /* No scale step: a single arrow glyph, not prose. */
    .hist-strip__arrow { font-size: 9px; color: var(--axi-text-faint); }
    .hist-strip__icon {
      width: 18px;
      height: 18px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .hist-strip__icon--svg { display: inline-flex; color: var(--axi-text-faint); }
    .hist-strip__icon--svg svg { width: 100%; height: 100%; fill: currentColor; }
    .hist-strip__icon--empty {
      display: inline-block;
      border: var(--axi-border-hairline) dashed var(--axi-rule);
      box-sizing: border-box;
    }
    /* No scale step: same case as __entry-time. */
    .hist-strip__more { font-size: 11px; color: var(--axi-text-faint); }

    /* Dimmed until the row is hovered or keyboard-focused, so a long feed reads
       as history first and a wall of buttons second. */
    .history-panel__actions { color: var(--axi-text-faint); transition: color 0.12s ease; }
    .history-panel__entry:hover .history-panel__actions,
    .history-panel__entry:focus-within .history-panel__actions { color: var(--axi-text); }
    .history-panel__revert {
      font: var(--axi-t-micro);
      letter-spacing: var(--axi-ls-micro);
      padding: 4px 10px;
      border: var(--axi-border-hairline) solid var(--axi-rule);
      background: transparent;
      color: var(--axi-text-dim);
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease, transform 0.1s, box-shadow 0.1s;
    }
    .history-panel__revert:hover:not(:disabled) {
      transform: translate(-2px, -2px);
      box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);
      background: var(--axi-surface-raised);
      border-color: var(--axi-accent);
      color: var(--axi-accent);
    }
    .history-panel__revert:focus-visible {
      outline: var(--axi-border-control) solid var(--axi-accent);
      outline-offset: 1px;
    }
    .history-panel__revert:disabled { color: var(--axi-text-faint); cursor: not-allowed; }

    .history-panel__confirm {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 9px;
      border: var(--axi-border-hairline) solid var(--axi-accent);
      background: var(--axi-surface-raised);
    }
    /* No scale step: same case as __entry-time -- a normal-weight sentence. */
    .history-panel__confirm-text {
      font-size: 11px;
      color: var(--axi-text-dim);
      line-height: 1.45;
    }
    .history-panel__confirm-buttons {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .history-panel__confirm-yes {
      background: var(--axi-accent);
      color: var(--axi-accent-ink);
      box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);
      /* No scale step: weight emphasis over the type __revert already sets on
         this same button; a font: shorthand would reset that. */
      font-weight: 600;
    }
    /* Same pair, same shape as history-compare.js's: __revert's :hover is rule
       4 case 1 (translate plus a gained 3px block) while __confirm-yes rests on
       a block already, so it is case 3 -- keep the translate, deepen 3px -> 6px.
       On its own, .history-panel__confirm-yes:hover:not(:disabled) ties
       __revert's hover at (0,3,0) and would win only by sitting later in the
       file, so a reorder could silently swap them; naming both classes makes it
       (0,4,0) and the win independent of source order. This confirm flow is not
       emitted from this file today (it lives in history-compare.js), so the tie
       is latent rather than live -- the rules stay per Global Constraint 10, and
       this is the selector shape a revival should start from, matching the
       markup history-compare.js actually emits (both classes on one button). */
    .history-panel__revert.history-panel__confirm-yes:hover:not(:disabled) {
      background: var(--axi-accent);
      color: var(--axi-accent-ink);
      box-shadow: var(--axi-offset-control-hover) var(--axi-offset-control-hover) 0 var(--axi-ink-line);
    }

    /* ── Reduced motion ──────────────────────────────────────────────── */
    /* The package's block (axi.css:149-166) enumerates only its own .axi-*
       selectors, so it never reaches an app-local lift, and its global
       "* { transition-duration: .01ms }" rule makes a lift INSTANT
       rather than absent -- which is exactly why the package cancels transform
       separately. Same shape and reason as comps.css's block. */
    @media (prefers-reduced-motion: reduce) {
      .history-panel__revert:hover:not(:disabled) {
        transform: none !important;
      }
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
  // "local" is the unmodified badge -- its rule was removed when it became the
  // default, so emitting the name put a class with no selector in the markup.
  // Same disposition as _dotClass() below.
  return "";
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
