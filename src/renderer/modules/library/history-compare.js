// Side-by-side version compare for the v2 build/comp history.
//
// Clicking a history entry opens this on top of the history panel: the record
// as it was at two chosen versions, rendered as two mini build cards, with a
// table of every op between them underneath and a "restore" footer.
//
// WHERE THE DIFF IS ACTUALLY VISIBLE: `renderChangeTable`. Task 7's highlight
// anchors are hidden, zero-content spans inside `.mini-card__hist-anchors` —
// the mini card renders AGGREGATES (one best rune across slots, one weapon
// set, one stats cell), so there is no 1:1 visible element per gear slot to
// outline. `highlightOps` still exists and still marks those anchors, because
// the op -> selector mapping is the contract the anchors were shaped for and a
// future card that does render per-slot elements gets highlighting for free.
// But do not expect the cards themselves to visibly change; the table is the
// user-facing diff.
//
// NOTE: deliberately does NOT import from history-panel.js (which imports
// this), so the caller passes an `onRestored` callback instead of us reaching
// back into the panel.

import { escapeHtml } from "../utils.js";
import { state } from "../state.js";
import { renderMiniBuildCard } from "../mini-build-card.js";

let _modal = null;
let _escHandler = null;

const _styleId = "history-compare-styles";

/* --------------------------------------------------------------- labelling */

// There is deliberately NO label vocabulary here. Every op arrives from
// `history:compare` already carrying a `label`, written by the same
// `renderOpDetail` that words the one-line entry summaries — one vocabulary,
// defined once in src/main/history/renderSummary.js, crossing the boundary as
// data. A renderer-side copy could not import it (that file is CommonJS) and
// so drifted: a folder move read "moved to another folder" in the entry list
// and "folder: f1 → f2" in the compare table.
//
// `_fallbackText` is NOT a second vocabulary. It is the last resort for an op
// that reached the table unlabelled — only possible when `renderChangeTable`
// is called directly, as the unit tests do — and it names nothing, it just
// prints what the op carries.
function _fallbackValue(v) {
  if (v === null || v === undefined || v === "") return "(none)";
  if (Array.isArray(v)) return v.length ? v.map(_fallbackValue).join(", ") : "(none)";
  if (typeof v === "object") {
    if (typeof v.name === "string") return v.name;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function _fallbackText(op) {
  const what = op.path || [op.slot, op.part].filter(Boolean).join(" ") || op.t || "change";
  return `${what}: ${_fallbackValue(op.before)} → ${_fallbackValue(op.after)}`;
}

/* ------------------------------------------------------------ change table */

/**
 * The visible diff. One row per substantive op, before on the left, after on
 * the right. `derived` ops (icons, descriptions, catalog blobs rewritten by a
 * game patch) round-trip through the log but are not edits anyone made, so
 * they never reach the table.
 *
 * @param {object[]} ops
 * @returns {string} HTML
 */
export function renderChangeTable(ops) {
  const list = (Array.isArray(ops) ? ops : []).filter((op) => op && op.t !== "derived");
  if (list.length === 0) {
    return `<div class="hist-compare__empty">No changes between these two versions.</div>`;
  }
  const rows = list.map((op) => `
    <div class="hist-compare__row" data-hist-row data-hist-op="${escapeHtml(String(op.t || ""))}">
      <span class="hist-compare__row-text">${escapeHtml(op.label || _fallbackText(op))}</span>
    </div>
  `).join("");
  return `<div class="hist-compare__table" role="table">${rows}</div>`;
}

/* -------------------------------------------------------------- highlights */

// Attribute-selector values are quoted with ", so a value carrying a " or a
// backslash would otherwise produce a SyntaxError rather than "no match".
// CSS.escape isn't available in every environment this runs in (jsdom included
// on some versions), so escape by hand.
function attrValue(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** op -> the anchor selector Task 7 emits, or null when the card has no anchor. */
function opSelector(op) {
  switch (op.t) {
    case "gear":
      return `[data-hist-slot="${attrValue(op.slot)}"][data-hist-part="${attrValue(op.part)}"]`;
    case "skill":
      // The mini card renders land skills only; an underwater op must not
      // light up the land skill that happens to share its slot name.
      return op.uw ? null : `[data-hist-skill="${attrValue(op.slot)}"]`;
    case "trait":
      return `[data-hist-trait="${attrValue(op.line)}:${attrValue(op.tier)}"]`;
    case "spec":
      return `[data-hist-spec="${attrValue(op.line)}"]`;
    default:
      // stat / field / meta / consumable / slot / raw have no per-element
      // anchor on the card. The change table carries them instead.
      return null;
  }
}

/**
 * Marks every anchor the given ops refer to with `.hist-changed`. Ops with no
 * anchor — and anchors that this particular card didn't render — are skipped
 * silently: a diff must never be able to throw the modal away.
 */
export function highlightOps(rootEl, ops) {
  if (!rootEl || !Array.isArray(ops)) return;
  for (const op of ops) {
    if (!op || op.t === "derived") continue;
    const sel = opSelector(op);
    if (!sel) continue;
    let found;
    try {
      found = rootEl.querySelectorAll(sel);
    } catch {
      continue;
    }
    found.forEach((el) => el.classList.add("hist-changed"));
  }
}

/**
 * The same ops seen from the older side: before and after swapped. The anchor
 * a given op maps to is the same either way (the selector is built from
 * slot/part/line/tier, never from the values), but inverting keeps the two
 * sides honestly named — the left card is showing the "before" of each op.
 */
function invert(ops) {
  return (Array.isArray(ops) ? ops : []).map((op) => ({ ...op, before: op.after, after: op.before }));
}

/* ------------------------------------------------------------------ styles */

function _injectStyles() {
  if (document.getElementById(_styleId)) return;
  const style = document.createElement("style");
  style.id = _styleId;
  style.textContent = `
    .hist-compare-overlay {
      position: fixed;
      inset: 0;
      z-index: 1200;
      background: rgba(0,0,0,0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .hist-compare {
      background: var(--panel, #141518);
      border: 1px solid var(--line, #1e1f24);
      border-radius: var(--radius-md, 10px);
      box-shadow: var(--shadow-lg, 0 12px 48px rgba(0,0,0,0.5));
      width: min(980px, 100%);
      max-height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .hist-compare__header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line, #1e1f24);
      background: var(--panel-gradient, none);
      flex-shrink: 0;
    }
    .hist-compare__heading {
      font-size: 13px;
      font-weight: 600;
      color: var(--text, #e2e3e8);
      margin: 0 6px 0 0;
    }
    .hist-compare__word { font-size: 12px; color: var(--text-dim, #646670); }
    .hist-compare__pick {
      background: var(--input-bg, #0f1013);
      color: var(--text, #e2e3e8);
      border: 1px solid var(--line, #1e1f24);
      border-radius: var(--radius-xs, 4px);
      font-size: 12px;
      padding: 3px 6px;
    }
    .hist-compare__close {
      margin-left: auto;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-dim, #646670);
      padding: 4px;
      border-radius: var(--radius-xs, 4px);
      display: flex;
      align-items: center;
    }
    .hist-compare__close:hover { color: var(--text, #e2e3e8); background: var(--hover-subtle, rgba(255,255,255,0.05)); }
    .hist-compare__body { overflow-y: auto; padding: 14px; flex: 1; }
    .hist-compare__cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    @media (max-width: 720px) { .hist-compare__cols { grid-template-columns: 1fr; } }
    .hist-compare__col-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-dim, #646670);
      margin-bottom: 6px;
    }
    .hist-compare__missing {
      padding: 24px 12px;
      text-align: center;
      font-size: 12px;
      color: var(--text-dim, #646670);
      border: 1px dashed var(--line, #1e1f24);
      border-radius: var(--radius-sm, 6px);
    }
    .hist-compare__note {
      margin-top: 14px;
      padding: 10px 12px;
      border-radius: var(--radius-sm, 6px);
      border: 1px solid rgba(var(--accent-rgb, 200,152,72), 0.28);
      background: rgba(var(--accent-rgb, 200,152,72), 0.07);
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-light, #aeafb8);
    }
    .hist-compare__changes { margin-top: 14px; }
    .hist-compare__changes-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-dim, #646670);
      margin-bottom: 6px;
    }
    .hist-compare__empty {
      font-size: 12px;
      color: var(--text-dim, #646670);
      padding: 12px 2px;
    }
    /* One clause per row. The clause is written by the main process (see the
       labelling note at the top of this file), arrow and all, so splitting it
       back into before/after cells here would mean re-parsing prose. */
    .hist-compare__row {
      padding: 6px 2px;
      border-top: 1px solid var(--line, #1e1f24);
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
      color: var(--text, #e2e3e8);
    }
    .hist-compare__row:first-child { border-top: none; }
    .hist-compare__footer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      border-top: 1px solid var(--line, #1e1f24);
      flex-shrink: 0;
    }
    .hist-compare__restore {
      align-self: flex-end;
      font-size: 12px;
      padding: 5px 12px;
      border-radius: var(--radius-xs, 4px);
      border: 1px solid var(--line, #1e1f24);
      background: transparent;
      color: var(--text-light, #aeafb8);
      cursor: pointer;
    }
    .hist-compare__restore:hover:not(:disabled) {
      background: var(--hover-accent, rgba(200,152,72,0.12));
      border-color: rgba(var(--accent-rgb, 200,152,72), 0.45);
      color: var(--accent, #c89848);
    }
    .hist-compare__restore:disabled { opacity: 0.35; cursor: not-allowed; }
    .hist-compare__confirm-text {
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-light, #aeafb8);
    }
    .hist-compare__confirm-buttons { display: flex; gap: 6px; justify-content: flex-end; }
    .hist-compare__confirm-yes {
      border-color: var(--btn-primary-to, #a87828);
      background: linear-gradient(180deg, var(--btn-primary-from, #c89848), var(--btn-primary-to, #a87828));
      color: #17120a;
      font-weight: 600;
    }

    /* The one thing an anchor is for. Harmless on the hidden anchor spans the
       mini card emits today; visible the moment a card renders a real element
       carrying data-hist-*. */
    .hist-changed {
      outline: 1px solid rgba(var(--accent-rgb, 200,152,72), 0.85);
      outline-offset: 1px;
      background: rgba(var(--accent-rgb, 200,152,72), 0.12);
      border-radius: var(--radius-xs, 4px);
    }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------- modal */

// "Current" is the live record rather than any stored version, so it needs a
// sentinel the <select> can carry as a string value.
const CURRENT = "current";

function _versionLabel(pick, versions) {
  if (pick === CURRENT) return "Current";
  const entry = versions.find((e) => e.v === pick);
  return entry ? `v${entry.v}` : `v${pick}`;
}

function _renderCard(doc) {
  if (!doc) {
    return `<div class="hist-compare__missing">This version could not be reconstructed.</div>`;
  }
  // Comps aren't build cards. Rather than render a wrong-shaped card, say what
  // the record was called and let the change table do the work.
  if (!doc.equipment && !doc.specializations) {
    return `<div class="hist-compare__missing">${escapeHtml(doc.name || doc.title || "This version")}<br>(no build card for this record type)</div>`;
  }
  return renderMiniBuildCard(doc, state.upgradeCatalog, { showActions: false });
}

function _pickerOptions(versions, selected, { includeCurrent }) {
  const opts = [];
  if (includeCurrent) {
    opts.push(`<option value="${CURRENT}"${selected === CURRENT ? " selected" : ""}>Current</option>`);
  }
  for (const entry of versions) {
    const label = `v${entry.v}${entry.summary ? ` — ${entry.summary}` : ""}`;
    opts.push(`<option value="${entry.v}"${selected === entry.v ? " selected" : ""}>${escapeHtml(label)}</option>`);
  }
  return opts.join("");
}

/**
 * Open the compare modal for one version of one record.
 *
 * @param {{kind: "build"|"comp", recordId: string, version: number,
 *          title?: string, onRestored?: (saved: object) => void}} input
 */
export async function showCompareModal({ kind, recordId, version, title, onRestored } = {}) {
  closeCompareModal();
  _injectStyles();

  const overlay = document.createElement("div");
  overlay.className = "hist-compare-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCompareModal();
  });

  const modal = document.createElement("div");
  modal.className = "hist-compare";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", `Compare versions of ${title || "record"}`);
  modal.innerHTML = `
    <div class="hist-compare__header">
      <h2 class="hist-compare__heading">${escapeHtml(title || "Compare versions")}</h2>
      <span class="hist-compare__word">Compare</span>
      <select class="hist-compare__pick hist-compare__pick--left" aria-label="Version to compare"></select>
      <span class="hist-compare__word">with</span>
      <select class="hist-compare__pick hist-compare__pick--right" aria-label="Version to compare against"></select>
      <button class="hist-compare__close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6L18 18"/></svg>
      </button>
    </div>
    <div class="hist-compare__body">
      <div class="hist-compare__empty">Loading…</div>
    </div>
    <div class="hist-compare__footer"></div>
  `;
  modal.querySelector(".hist-compare__close").addEventListener("click", closeCompareModal);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _modal = overlay;

  // Escape closes the compare modal only; the history panel stays open beneath
  // it (history-panel.js's own handler steps aside while this overlay exists).
  _escHandler = (e) => { if (e.key === "Escape") closeCompareModal(); };
  document.addEventListener("keydown", _escHandler);

  let versions = [];
  try {
    const res = kind === "comp"
      ? await window.desktopApi.getCompHistory(recordId, { limit: 200 })
      : await window.desktopApi.getBuildHistory(recordId, { limit: 200 });
    versions = (Array.isArray(res) ? res : (res && res.versions) || []).slice();
  } catch {
    versions = [];
  }
  if (!_modal) return; // closed while loading
  versions.sort((a, b) => b.v - a.v);

  const left = modal.querySelector(".hist-compare__pick--left");
  const right = modal.querySelector(".hist-compare__pick--right");
  const chosen = Number(version);
  const hasPrev = versions.some((e) => e.v === chosen - 1);
  left.innerHTML = _pickerOptions(versions, chosen, { includeCurrent: false });
  right.innerHTML = _pickerOptions(versions, hasPrev ? chosen - 1 : CURRENT, { includeCurrent: true });

  const ctx = { kind, recordId, title, versions, onRestored };
  const rerender = () => _renderComparison(modal, ctx, _pick(left), _pick(right));
  left.addEventListener("change", rerender);
  right.addEventListener("change", rerender);
  await rerender();
}

function _pick(select) {
  return select.value === CURRENT ? CURRENT : Number(select.value);
}

async function _renderComparison(modal, ctx, leftPick, rightPick) {
  const { kind, recordId, versions } = ctx;
  const body = modal.querySelector(".hist-compare__body");
  body.innerHTML = `<div class="hist-compare__empty">Loading…</div>`;

  // "Current" resolves to the newest RECORDED version rather than the live
  // record in `state`. The two can only differ by a change the log judged
  // non-substantive (a derived-only edit, or a save that changed nothing), so
  // the diff is identical either way — and reading both the cards and the
  // table from one source means they cannot disagree.
  const latest = versions.length ? Math.max(...versions.map((e) => e.v)) : 0;
  const leftV = leftPick === CURRENT ? latest : Number(leftPick);
  const rightV = rightPick === CURRENT ? latest : Number(rightPick);
  // Diff oldest -> newest so every clause reads forwards in time, whichever
  // side of the modal the user put the older version on.
  const leftIsOlder = leftV <= rightV;

  let res;
  try {
    // ONE call, however far apart the versions are. This used to be one
    // `getHistoryOps` per version in the range, concatenated — which reported
    // a value that changed and changed back as two changes.
    res = await window.desktopApi.compareHistory(
      kind, recordId, Math.min(leftV, rightV), Math.max(leftV, rightV),
    );
  } catch (err) {
    body.innerHTML = `<div class="hist-compare__empty">Could not load these versions — ${escapeHtml(err.message || "unknown error")}</div>`;
    return;
  }
  if (!document.body.contains(modal)) return;

  const ops = (res && res.ops) || [];
  const leftDoc = (leftIsOlder ? res && res.fromDoc : res && res.toDoc) || null;
  const rightDoc = (leftIsOlder ? res && res.toDoc : res && res.fromDoc) || null;

  // Version 1 is the origin keyframe: there is nothing before it to diff
  // against. That is the record's initial state, not "no changes were made".
  const isOrigin = leftPick === 1 && ops.length === 0;
  const originNote = isOrigin
    ? `<div class="hist-compare__note">v1 is where this ${kind === "comp" ? "comp" : "build"}'s history begins — the state it was first recorded in. There is no earlier version to compare it against.</div>`
    : "";

  body.innerHTML = `
    <div class="hist-compare__cols">
      <div class="hist-compare__col hist-compare__col--left">
        <div class="hist-compare__col-title">${escapeHtml(_versionLabel(leftPick, versions))}</div>
        ${_renderCard(leftDoc)}
      </div>
      <div class="hist-compare__col hist-compare__col--right">
        <div class="hist-compare__col-title">${escapeHtml(_versionLabel(rightPick, versions))}</div>
        ${_renderCard(rightDoc)}
      </div>
    </div>
    ${originNote}
    ${isOrigin ? "" : `
    <div class="hist-compare__changes">
      <div class="hist-compare__changes-title">Changes</div>
      ${renderChangeTable(ops)}
    </div>`}
  `;

  // Each side highlights its own pieces. Invisible on today's card — the
  // anchors are hidden spans — see the note at the top of this file.
  highlightOps(body.querySelector(".hist-compare__col--left"), leftIsOlder ? invert(ops) : ops);
  highlightOps(body.querySelector(".hist-compare__col--right"), leftIsOlder ? ops : invert(ops));

  _renderFooter(modal, ctx, leftPick);
}

/* ----------------------------------------------------------------- restore */

function _restoreLabel(pick, versions) {
  if (pick === CURRENT) return "Restore";
  const entry = versions.find((e) => e.v === pick);
  const what = entry && entry.summary ? ` (the state after "${entry.summary}")` : "";
  return `Restore v${pick}${what}`;
}

function _renderFooter(modal, ctx, pick) {
  const footer = modal.querySelector(".hist-compare__footer");
  // Restorability is keyed off the VERSION EXISTING. v2 stores no per-entry
  // snapshot — a version is reconstructed by replaying the log — so there is
  // no "this entry has nothing to restore" case any more.
  if (pick === CURRENT) {
    footer.innerHTML = "";
    return;
  }
  footer.innerHTML = `<button class="hist-compare__restore">${escapeHtml(_restoreLabel(pick, ctx.versions))}</button>`;
  footer.querySelector(".hist-compare__restore")
    .addEventListener("click", () => _askRestore(modal, ctx, pick));
}

function _askRestore(modal, ctx, pick) {
  const footer = modal.querySelector(".hist-compare__footer");
  footer.innerHTML = `
    <div class="hist-compare__confirm-text">
      Roll this ${ctx.kind === "comp" ? "comp" : "build"} back to v${escapeHtml(String(pick))}? Anything changed since then is replaced. Teammates will see it on their next sync.
    </div>
    <div class="hist-compare__confirm-buttons">
      <button class="hist-compare__restore hist-compare__confirm-no">Cancel</button>
      <button class="hist-compare__restore hist-compare__confirm-yes">Restore</button>
    </div>
  `;
  footer.querySelector(".hist-compare__confirm-no")
    .addEventListener("click", () => _renderFooter(modal, ctx, pick));
  footer.querySelector(".hist-compare__confirm-yes")
    .addEventListener("click", () => _doRestore(modal, ctx, pick));
}

async function _doRestore(modal, ctx, pick) {
  const yes = modal.querySelector(".hist-compare__confirm-yes");
  yes.disabled = true;
  yes.textContent = "Restoring…";
  try {
    const isComp = ctx.kind === "comp";
    const saved = isComp
      ? await window.desktopApi.revertComp(ctx.recordId, pick)
      : await window.desktopApi.revertBuild(ctx.recordId, pick);
    const collection = isComp ? (state.comps || []) : (state.builds || []);
    const idx = collection.findIndex((r) => r.id === saved.id);
    if (idx >= 0) collection[idx] = saved;
    else collection.push(saved);
    document.dispatchEvent(new CustomEvent("library:rerender"));
    closeCompareModal();
    if (typeof ctx.onRestored === "function") ctx.onRestored(saved);
    document.dispatchEvent(new CustomEvent("library:toast", { detail: { message: "Restored!" } }));
  } catch (err) {
    _renderFooter(modal, ctx, pick);
    document.dispatchEvent(new CustomEvent("library:toast", {
      detail: { message: "Restore failed — " + err.message, type: "error" },
    }));
  }
}

export function closeCompareModal() {
  if (_modal) {
    _modal.remove();
    _modal = null;
  }
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

/** True while the compare modal is open — history-panel.js defers Escape to it. */
export function isCompareModalOpen() {
  return _modal !== null;
}
