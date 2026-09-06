// The in-depth half of build sources.
//
// One modal, two ways in, because the same table answers both questions:
//
//   showCompSourcesModal(comp)   the matrix -- one row per build in the comp,
//                                with its home folder and the other comps that
//                                share it. Opened from the comp detail, or from
//                                a comp row in the library.
//   showBuildSourcesModal(build) straight to one build's detail, skipping the
//                                matrix. Opened from a build chip anywhere.
//
// Rows expand IN PLACE rather than swapping the table for a second view: the
// point of the matrix is comparison, and losing it the moment you drill into a
// row would throw away the context you opened it for.
//
// Follows the choice-modal.js lifecycle -- lazily built, appended to <body>,
// rebuilt if the document is replaced under it.

import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { getSpecIcon, profClass } from "./build-helpers.js";
import { buildUsage, compSources, folderPathText } from "./build-sources.js";

const HIDDEN = "bsm-overlay--hidden";
const ROOT_LABEL = "Library root";

let _overlay = null;
let _el = null;
let _escHandler = null;
// What is on screen: the comp whose matrix we drew (null in per-build mode) and
// which row is expanded.
let _comp = null;
let _expandedBuildId = null;
let _onlyExternal = false;

export function initBuildSourcesModal() {
  if (typeof document === "undefined") return;
  if (_overlay?.isConnected) return;
  // Built once but no longer in the document (the body was replaced): drop the
  // dead nodes and rebuild rather than wiring handlers to nothing.
  if (_overlay) closeBuildSourcesModal();

  _overlay = document.createElement("div");
  _overlay.className = `bsm-overlay ${HIDDEN}`;
  _overlay.innerHTML = `
    <div class="bsm-panel" role="dialog" aria-modal="true" aria-label="Build sources">
      <div class="bsm-header">
        <div class="bsm-heading">
          <h3 class="bsm-title"></h3>
          <div class="bsm-subtitle"></div>
        </div>
        <div class="bsm-tools">
          <div class="bsm-toolslot"></div>
          <button type="button" class="bsm-close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 18L18 6M6 6L18 18"/></svg>
          </button>
        </div>
      </div>
      <div class="bsm-body"></div>
    </div>`;
  document.body.appendChild(_overlay);

  _el = {
    panel:    _overlay.querySelector(".bsm-panel"),
    title:    _overlay.querySelector(".bsm-title"),
    subtitle: _overlay.querySelector(".bsm-subtitle"),
    toolslot: _overlay.querySelector(".bsm-toolslot"),
    body:     _overlay.querySelector(".bsm-body"),
  };

  _overlay.querySelector(".bsm-close").addEventListener("click", closeBuildSourcesModal);
  // A click on the backdrop dismisses; one that started inside the panel must
  // not, or every row click would close the modal.
  _overlay.addEventListener("click", (e) => {
    if (e.target === _overlay) closeBuildSourcesModal();
  });
  _el.body.addEventListener("click", _onBodyClick);
  _el.toolslot.addEventListener("change", (e) => {
    if (!e.target.matches(".bsm-toggle input")) return;
    _onlyExternal = e.target.checked;
    _renderMatrix();
  });
}

export function closeBuildSourcesModal() {
  if (!_overlay) return;
  _overlay.classList.add(HIDDEN);
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
  _comp = null;
  _expandedBuildId = null;
  _onlyExternal = false;
}

function _open() {
  initBuildSourcesModal();
  _overlay.classList.remove(HIDDEN);
  if (!_escHandler) {
    _escHandler = (e) => {
      if (e.key === "Escape") closeBuildSourcesModal();
    };
    document.addEventListener("keydown", _escHandler);
  }
}

// ─── Matrix ──────────────────────────────────────────────────────────────────

/** The whole comp: one row per build, expandable into per-build detail. */
export function showCompSourcesModal(comp) {
  if (!comp) return;
  _open();
  _comp = comp;
  _expandedBuildId = null;
  _onlyExternal = false;
  _el.title.textContent = "Build Sources";
  _el.subtitle.textContent = _compSubtitle(comp);
  _renderTools();
  _renderMatrix();
}

function _compSubtitle(comp) {
  const name = comp.name || "Untitled Comp";
  const path = folderPathText(comp.folderId);
  return path ? `${name} · ${path}` : `${name} · ${ROOT_LABEL}`;
}

/**
 * The header tools, drawn ONCE per open. Kept out of _renderMatrix on purpose:
 * that runs on every filter change and every row expansion, and rebuilding the
 * checkbox underneath the user takes the focus off it mid-interaction (and
 * strands the node the change event came from).
 */
function _renderTools() {
  const { total, externalCount } = compSources(_comp);
  // The filter is only worth its space when it would actually change the view.
  _el.toolslot.innerHTML = externalCount && externalCount < total
    ? `<label class="bsm-toggle"><input type="checkbox" />Only outside builds</label>`
    : "";
}

function _renderMatrix() {
  const { rows, total } = compSources(_comp);

  if (!total) {
    _el.body.innerHTML = `<p class="bsm-empty">This comp has no builds yet.</p>`;
    return;
  }

  const shown = _onlyExternal ? rows.filter((r) => r.isExternal) : rows;
  _el.body.innerHTML = `
    <table class="bsm-table">
      <thead><tr><th>Build</th><th>Home folder</th><th>Also in comps</th></tr></thead>
      <tbody>${shown.map(_rowHtml).join("")}</tbody>
    </table>`;
}

function _rowHtml(row) {
  const home = row.isExternal
    ? `<span class="bsm-path">${escapeHtml(row.folderPath || ROOT_LABEL)}</span>`
    : `<span class="bsm-path bsm-path--home">✓ this comp's folder</span>`;

  const others = row.otherComps.length
    ? row.otherComps.map((e) => `<span class="bsm-other">${escapeHtml(e.comp.name || "Untitled Comp")}</span>`).join(", ")
    : `<span class="bsm-none">—</span>`;

  return `
    <tr class="bsm-row ${row.isExternal ? "bsm-row--external" : ""}"
        data-src-build="${escapeHtml(row.build.id)}" aria-expanded="false">
      <td><span class="bsm-build">
        <span class="bsm-icon ${profClass(row.build.profession)}">${getSpecIcon(row.build)}</span>
        ${escapeHtml(row.build.title || "Untitled")}
      </span></td>
      <td>${home}</td>
      <td>${others}</td>
    </tr>`;
}

/**
 * Expanding splices the detail row in rather than re-rendering the table. The
 * table is small enough that a redraw would be cheap, but it would also replace
 * the very row the user just clicked -- taking keyboard focus off it and
 * scrapping any selection inside the open detail.
 */
function _onBodyClick(e) {
  const row = e.target.closest(".bsm-row");
  if (!row) return;

  const wasOpen = _expandedBuildId === row.dataset.srcBuild;
  _collapseDetail();
  if (wasOpen) return;

  // One detail at a time, and the row you click is always the one you end up
  // looking at.
  _expandedBuildId = row.dataset.srcBuild;
  row.setAttribute("aria-expanded", "true");
  const build = (state.builds || []).find((b) => b.id === _expandedBuildId);
  const detail = document.createElement("tr");
  detail.className = "bsm-detail-row";
  detail.innerHTML = `<td colspan="3">${_detailHtml(build)}</td>`;
  row.after(detail);
}

function _collapseDetail() {
  _el.body.querySelector(".bsm-detail-row")?.remove();
  _el.body.querySelector('.bsm-row[aria-expanded="true"]')?.setAttribute("aria-expanded", "false");
  _expandedBuildId = null;
}

// ─── Per-build detail ────────────────────────────────────────────────────────

/** One build, no matrix — the entry point the library chips use. */
export function showBuildSourcesModal(build, comp = null) {
  if (!build) return;
  _open();
  _comp = comp;
  _expandedBuildId = null;
  _el.title.textContent = build.title || "Untitled";
  _el.subtitle.textContent = "Build sources";
  _el.toolslot.innerHTML = "";
  _el.body.innerHTML = _detailHtml(build);
}

function _detailHtml(build) {
  const usage = buildUsage(build);
  const home = folderPathText(build.folderId) || ROOT_LABEL;

  const comps = usage.count
    ? usage.entries.map((e) => {
        const self = _comp && e.comp.id === _comp.id;
        return `<div class="bsm-detail-comp ${self ? "bsm-detail-comp--self" : ""}">
          <span class="bsm-detail-comp__name">${escapeHtml(e.comp.name || "Untitled Comp")}</span>
          <span class="bsm-detail-comp__folder">${escapeHtml(e.folderPath || ROOT_LABEL)}${self ? " (this comp)" : ""}</span>
        </div>`;
      }).join("")
    : `<p class="bsm-none">This build is not in any comp.</p>`;

  const heading = usage.count === 1 ? "Appears in 1 comp" : `Appears in ${usage.count} comps`;

  return `
    <div class="bsm-detail">
      <div class="bsm-detail-label">Home</div>
      <div class="bsm-detail-home">${escapeHtml(home)}</div>
      <div class="bsm-detail-label">${usage.count ? heading : "Usage"}</div>
      ${comps}
    </div>`;
}
