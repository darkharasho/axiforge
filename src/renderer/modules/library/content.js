// Library content module — renders builds and folders in the active view mode.

import { state } from "../state.js";
import { professionSeriesStyle, professionStripStyle } from "../../../shared/professions.js";
import { escapeHtml, formatRelativeTime } from "../utils.js";
import { roleBadgeHtml } from '../roleEstimator.js';
import { getVisibleBuilds, getVisibleFolders, getVisibleComps, libraryBuilds, libraryComps, libraryFolders, searchQuery, hasSearchQuery, buildMatchesQuery, compMatchesQuery } from "./folder-store.js";
import { getProfessionSvg } from "../profession-icons.js";
import { gameModeLabel } from "./smart-folders.js";
import { badgeHtml } from "../sync-status.js";
import { itemPublishBadgeHtml, itemPublishStatus, describePublishStatus } from "../publish-status.js";
import { buildUsageChipHtml, compSourceBadgeHtml, foreignFolderChipHtml } from "../build-source-chips.js";
import { folderPathText } from "../build-sources.js";
import { showBuildSourcesModal, showCompSourcesModal } from "../build-sources-modal.js";
import { teamRootFor, teamLabel, ensureTeamMemberNames } from "../teams.js";
import { visibleColumns, gridTemplate, compareBuilds, eliteSpecName, ownerLabel } from "./table-columns.js";
import { clearSelection, handleBuildClick, handleCompClick, updateSelectionVisuals } from "./selection.js";
import { wireDragDropEvents } from "./drag-drop.js";
import { renderTrashView } from "./trash-view.js";
import { renderArchiveView } from "./archive-view.js";
import {
  folderIcon,
  starIcon,
  chevronUpDownIcon,
  chevronUpIcon,
  chevronDownIcon,
  chevronRightIcon,
  compIcon,
  shareIcon,
  adjustmentsIcon,
} from "./heroicons.js";

let _callbacks = {};
const _tableExpandedFolders = new Set();
let _columnSelectedFolders = []; // tracks selected folder at each column depth
// Which navigation context the column stack above was built for. The stack is a
// path RELATIVE to column 0, so it is only meaningful while column 0 stays put.
let _columnsContextKey = null;

/** A stable key for "what column 0 is currently showing". */
function _navContextKey() {
  const f = state.currentFolder;
  return f ? `${f.type}:${f.id}` : "root";
}

/**
 * Keep the column stack honest before drawing it.
 *
 * Two ways it used to go wrong, both of which show up as duplicated or ghost
 * columns that stay until you switch view modes:
 *
 *  - Navigating (sidebar, breadcrumb, a drop on a nav target) moves column 0
 *    without touching the stack. Drill into "Raids", then click "Raids" in the
 *    sidebar, and column 0 becomes Raids' contents while the stack still says
 *    "show Raids' contents next" — so you get the same column twice.
 *  - A selected id can stop resolving (deleted, trashed, archived, or removed
 *    by a teammate's sync), leaving an empty column with nothing to click that
 *    would ever clear it.
 */
function _pruneColumnSelections() {
  const key = _navContextKey();
  if (key !== _columnsContextKey) {
    _columnsContextKey = key;
    _columnSelectedFolders = [];
    return;
  }
  const idx = _columnSelectedFolders.findIndex(
    (id) => id && !libraryFolders().some((f) => f.id === id) && !libraryComps().some((c) => c.id === id)
  );
  if (idx !== -1) _columnSelectedFolders = _columnSelectedFolders.slice(0, idx);
}

/** Expand a folder in the table view (used by drag-drop to auto-expand on hover). */
export function expandTableFolder(folderId) {
  if (!_tableExpandedFolders.has(folderId)) {
    _tableExpandedFolders.add(folderId);
    renderContent();
  }
}

/**
 * Store callbacks for content actions.
 * @param {{ onLoadBuild, onNavigate, onSortChange }} callbacks
 */
export function initContent(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Render the active view into #lib-content.
 */
export function renderContent() {
  const container = document.getElementById("lib-content");
  if (!container) return;

  // The trash holds records the rest of the library no longer knows about, so
  // it bypasses the view modes entirely — see trash-view.js.
  if (state.currentFolder?.type === "trash") {
    renderTrashView(container, state.trashItems || [], {
      onRestore: (ref) => _callbacks.onTrashRestore?.(ref),
      onPurge: (ref) => _callbacks.onTrashPurge?.(ref),
      onEmpty: () => _callbacks.onTrashEmpty?.(),
      teamItems: state.teamTrashItems || [],
      onTeamRestore: (ref) => _callbacks.onTeamTrashRestore?.(ref),
    });
    return;
  }

  // The archive is a flat list of what the user put away, for the same reason:
  // none of the folder nesting or drag-drop below applies to it.
  if (state.currentFolder?.type === "archive") {
    renderArchiveView(container, state.archiveItems || [], {
      onRestore: (ref) => _callbacks.onArchiveRestore?.(ref),
      onOpen: (ref) => _callbacks.onArchiveOpen?.(ref),
    });
    return;
  }

  const viewMode = state.libraryPrefs.viewMode || "list";

  switch (viewMode) {
    case "table":
      renderTableView(container);
      break;
    case "columns":
      renderColumnsView(container);
      break;
    case "grid":
      renderGridView(container);
      break;
    case "icon":
      renderIconView(container);
      break;
    case "list":
    default:
      renderListView(container);
      break;
  }

  renderLegacyOrphanBanner(container);

  // Re-init SortableJS on the new DOM
  wireDragDropEvents();

  // Re-apply selection visuals after DOM replacement
  updateSelectionVisuals();
}

// A folder left behind by the retired GitHub-org shared library: it still
// carries `orgName` but is not part of any team, so nothing syncs it any more.
// The owner migrates it from Settings → Teams; everyone else joins with an
// invite code.
function renderLegacyOrphanBanner(container) {
  const current = state.currentFolder;
  if (!current || current.type !== "custom") return;
  const folder = (state.folders || []).find((f) => f.id === current.id);
  if (!folder || !folder.orgName || folder.teamId) return;
  container.insertAdjacentHTML("afterbegin", `
    <div class="lib-banner lib-banner--info">This library moved to Teams \u2014 join with the owner's invite code. <button type="button" class="lib-banner__btn" data-open-settings="teams">Open Teams</button></div>`);
  const btn = container.querySelector("[data-open-settings]");
  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    _callbacks.onOpenSettings?.(btn.dataset.openSettings);
  });
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function getSpecIcon(build) {
  const eliteSpec = eliteSpecName(build);
  const name = eliteSpec || build.profession;
  if (!name) return "";
  const svg = getProfessionSvg(name);
  return svg || "";
}

function formatDate(value) {
  return formatRelativeTime(value) || "—";
}

function pinStarHtml(build) {
  return `<button
    type="button"
    class="lib-pin-btn ${build.pinned ? "lib-pin-btn--active" : ""}"
    data-pin-id="${escapeHtml(build.id)}"
    data-action="pin"
    title="${build.pinned ? "Unpin" : "Pin"}"
    aria-label="${build.pinned ? "Unpin build" : "Pin build"}"
  >${starIcon}</button>`;
}

function profPillHtml(build) {
  const prof = build.profession;
  if (!prof) return "";
  // Rule 7: the diamond carries the profession's colour, the label stays in
  // the neutral ramp. A chip filled with the profession hue would be status
  // (rule 5), and which profession a build is is not a status.
  return `<span class="axi-chip af-chip--prof"><span class="axi-diamond axi-diamond--series" style="${professionSeriesStyle(prof)}"></span>${escapeHtml(prof)}</span>`;
}

function eliteSpecPillHtml(build) {
  const spec = eliteSpecName(build);
  if (!spec) return "";
  return `<span class="axi-chip">${escapeHtml(spec)}</span>`;
}

function gameModePillHtml(build) {
  const mode = gameModeLabel(build.gameMode || "pve");
  return `<span class="axi-chip axi-chip--meta">${escapeHtml(mode)}</span>`;
}

function tagPillsHtml(build) {
  return (build.tags || [])
    .map((t) => `<span class="axi-chip">${escapeHtml(t)}</span>`)
    .join("");
}

// The bare build count used to be the whole story here. It hid the case that
// actually matters -- a comp quietly sourcing half its roster from other
// folders -- so the count now says so, and is clickable straight into the
// sources matrix without entering the comp.
function compBadgeHtml(comp) {
  return compSourceBadgeHtml(comp);
}

function emptyStateHtml() {
  // If the current team folder is actively syncing, tell the user to wait
  const f = state.currentFolder;
  if (f?.id && state.folderSyncStatus?.[f.id] === "syncing") {
    return `<div class="lib-empty-state">
      <p>Syncing team content\u2026</p>
    </div>`;
  }
  return `<div class="lib-empty-state">
    <p>No builds found.</p>
  </div>`;
}

/** True when the current view mixes builds from multiple folders (smart folders). */
function isCombinedView() {
  // Search results are drawn flat from across the tree, so each row has to say
  // where it actually lives -- same reason the smart folders do.
  if (hasSearchQuery()) return true;
  const f = state.currentFolder;
  if (!f) return false;
  return f.type === "smart-rule" || f.type === "all";
}



function contentSyncIndicatorHtml(folderId) {
  return badgeHtml("lib-content-sync-indicator", state.folderSyncStatus?.[folderId]);
}

// Returns the sync indicator HTML for a build or comp item.
// Shows a persistent checkmark for shared-folder items, spinner while syncing, warning on error.
function itemSyncIndicatorHtml(type, item) {
  const statusMap = type === "build" ? state.buildSyncStatus : state.compSyncStatus;
  const activeStatus = statusMap?.[item.id];
  // Persistent checkmark for all items in a shared folder, unless the item has
  // a more specific status (syncing / pending / conflict / error).
  return badgeHtml(
    "lib-content-sync-indicator",
    activeStatus || (teamRootFor(item.folderId) ? "synced" : null),
  );
}

// Sync indicator plus publish mark, as every view draws them side by side. A
// comp's mark reads state.builds, so a member edit shows without reloading comps.
function itemIndicatorsHtml(type, item) {
  return itemSyncIndicatorHtml(type, item) + itemPublishBadgeHtml(type, item, state.builds);
}

/** Return HTML for the folder path breadcrumb shown in combined views. */
function folderPathHtml(build) {
  if (!isCombinedView()) return "";
  const path = folderPathText(build.folderId);
  if (!path) return "";
  return `<span class="lib-folder-path">${escapeHtml(path)}</span>`;
}

// ─── List View ─────────────────────────────────────────────────────────────────

function renderListView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();
  const comps = getVisibleComps();

  if (folders.length === 0 && builds.length === 0 && comps.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  const folderRows = folders
    .map(
      (f) => `
        <div class="lib-list-row lib-list-row--folder" data-folder-id="${escapeHtml(f.id)}">
          <span class="lib-list-row__icon lib-list-row__icon--folder">${folderIcon}</span>
          <span class="lib-list-row__title">${escapeHtml(f.name)}${f.teamId ? `<span class="lib-shared-badge" title="${escapeHtml(teamLabel(f))}">${shareIcon}</span>` : ""}${contentSyncIndicatorHtml(f.id)}</span>
        </div>
      `
    )
    .join("");

  const buildRows = builds
    .map(
      (b) => `
        <div class="lib-list-row lib-list-row--build ${b.pinned ? "lib-list-row--pinned" : ""}" data-build-id="${escapeHtml(b.id)}">
          <span class="lib-list-row__spec-icon" style="${professionSeriesStyle(b.profession)}">${getSpecIcon(b)}</span>
          <span class="lib-list-row__title">${escapeHtml(b.title || "Untitled")}${folderPathHtml(b)}${itemIndicatorsHtml("build", b)}</span>
          <span class="lib-list-row__pills">
            ${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}${tagPillsHtml(b)}${roleBadgeHtml(b, state.upgradeCatalog)}${buildUsageChipHtml(b)}
          </span>
          <span class="lib-list-row__date" title="${escapeHtml(b.updatedAt || "")}">${formatDate(b.updatedAt)}</span>
          ${pinStarHtml(b)}
        </div>
      `
    )
    .join("");

  const compRows = comps
    .map(
      (c) => `
        <div class="lib-list-row lib-list-row--comp" data-comp-id="${escapeHtml(c.id)}">
          <span class="lib-list-row__spec-icon lib-list-row__comp-icon">${compIcon}</span>
          <span class="lib-list-row__title">${escapeHtml(c.name || "Untitled Comp")}${itemIndicatorsHtml("comp", c)}</span>
          ${compBadgeHtml(c)}
        </div>
      `
    )
    .join("");

  container.innerHTML = `<div class="lib-list">${folderRows}${compRows}${buildRows}</div>`;

  bindContentEvents(container);
}

// ─── Table View ────────────────────────────────────────────────────────────────

function renderTableView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();
  const comps = getVisibleComps();

  const { sortField, sortDirection } = state.libraryPrefs;
  const columns = visibleColumns(state.libraryPrefs.tableColumns);

  // Owner names come from the team member lists, which only load when the
  // column is actually showing. The table redraws once they arrive.
  if (columns.some((c) => c.id === "owner")) ensureTeamMemberNames(() => renderContent());

  function sortHeaderDiv(field, label) {
    const isActive = sortField === field;
    const icon = isActive
      ? (sortDirection === "asc" ? chevronUpIcon : chevronDownIcon)
      : chevronUpDownIcon;
    return `<button type="button" class="lib-tv__sort-btn ${isActive ? "lib-tv__sort-btn--active" : ""}" data-sort-field="${field}">${escapeHtml(label)} ${icon}</button>`;
  }

  function headerCellHtml(col) {
    if (col.id === "action") {
      return `<span class="lib-tv__action"><button type="button" class="lib-tv__columns-btn" data-table-columns-menu title="Choose columns" aria-label="Choose columns">${adjustmentsIcon}</button></span>`;
    }
    const inner = col.sortField ? sortHeaderDiv(col.sortField, col.label) : escapeHtml(col.label);
    return `<span class="${cellClass(col.id)}">${inner}</span>`;
  }

  if (folders.length === 0 && builds.length === 0 && comps.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  const rowCells = (kind, item) => columns.map((col) => tableCellHtml(col.id, kind, item)).join("");

  function renderTreeFolder(folder) {
    const isExpanded = _tableExpandedFolders.has(folder.id);

    let childrenHtml = "";
    if (isExpanded) {
      const childFolders = libraryFolders()
        .filter((f) => f.parentId === folder.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const folderBuilds = libraryBuilds()
        .filter((b) => b.folderId === folder.id)
        .sort((a, b) => compareBuilds(a, b, sortField, sortDirection));

      const folderComps = libraryComps()
        .filter((c) => c.folderId === folder.id)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const items = childFolders.map((f) => renderTreeFolder(f)).join("")
        + folderComps.map((c) => renderTreeComp(c)).join("")
        + folderBuilds.map((b) => renderTreeBuild(b)).join("");

      // Always render <ul> even if empty so SortableJS can create a drop zone
      childrenHtml = `<ul class="lib-tv__children">${items}</ul>`;
    }

    return `
      <li class="lib-tv__item" data-folder-id="${escapeHtml(folder.id)}">
        <div class="lib-tv__row lib-tv__row--folder">${rowCells("folder", folder)}</div>
        ${childrenHtml}
      </li>
    `;
  }

  function renderTreeBuild(b) {
    return `
      <li class="lib-tv__item" data-build-id="${escapeHtml(b.id)}">
        <div class="lib-tv__row lib-tv__row--build ${b.pinned ? "lib-tv__row--pinned" : ""}">${rowCells("build", b)}</div>
      </li>
    `;
  }

  function renderTreeComp(c) {
    let childrenHtml = "";
    if (_tableExpandedFolders.has(c.id)) {
      const compBuildIdSet = new Set(c.buildIds || []);
      const items = state.builds.filter((b) => compBuildIdSet.has(b.id)).map((b) => renderTreeBuild(b)).join("");
      childrenHtml = `<ul class="lib-tv__children">${items}</ul>`;
    }

    return `
      <li class="lib-tv__item" data-comp-id="${escapeHtml(c.id)}">
        <div class="lib-tv__row lib-tv__row--comp">${rowCells("comp", c)}</div>
        ${childrenHtml}
      </li>
    `;
  }

  const folderItems = folders.map((f) => renderTreeFolder(f)).join("");
  const buildItems = builds.map((b) => renderTreeBuild(b)).join("");
  const compItems = comps.map((c) => renderTreeComp(c)).join("");

  container.innerHTML = `
    <div class="lib-tv" style="--lib-tv-cols: ${gridTemplate(columns)}">
      <div class="lib-tv__header">${columns.map(headerCellHtml).join("")}</div>
      <ul class="lib-tv__tree">
        ${folderItems}${compItems}${buildItems}
      </ul>
    </div>
  `;

  // Bind chevron toggles
  container.querySelectorAll("[data-toggle-table-folder]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const folderId = el.dataset.toggleTableFolder;
      if (_tableExpandedFolders.has(folderId)) {
        _tableExpandedFolders.delete(folderId);
      } else {
        _tableExpandedFolders.add(folderId);
      }
      renderContent();
    });
  });

  container.querySelector("[data-table-columns-menu]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    _callbacks.onTableColumnsMenu?.(r.left, r.bottom + 4);
  });

  bindContentEvents(container);
}

/** A table cell's class: every column is `lib-tv__<column id>`. */
function cellClass(id) {
  return `lib-tv__${id}`;
}

/** Text cell with a full-value tooltip, for columns that ellipsise. */
function textCell(id, text) {
  const t = escapeHtml(text || "");
  return `<span class="${cellClass(id)}" title="${t}">${t}</span>`;
}

function dateCell(id, value) {
  return `<span class="${cellClass(id)}" title="${escapeHtml(value || "")}">${formatDate(value)}</span>`;
}

/**
 * One table cell. Folders, comps and builds share the columns but not every
 * column means something for every kind -- those cells are drawn empty so the
 * grid stays aligned.
 */
function tableCellHtml(id, kind, item) {
  switch (id) {
    case "action": {
      if (kind === "build") return `<span class="lib-tv__action">${pinStarHtml(item)}</span>`;
      const chevron = _tableExpandedFolders.has(item.id) ? chevronDownIcon : chevronRightIcon;
      return `<span class="lib-tv__action" data-toggle-table-folder="${escapeHtml(item.id)}">${chevron}</span>`;
    }
    case "icon":
      if (kind === "folder") return `<span class="lib-tv__icon"><span class="lib-table__folder-icon">${folderIcon}</span></span>`;
      if (kind === "comp") return `<span class="lib-tv__icon lib-list-row__comp-icon">${compIcon}</span>`;
      return `<span class="lib-tv__icon" style="${professionSeriesStyle(item.profession)}">${getSpecIcon(item)}</span>`;
    case "name":
      if (kind === "folder") {
        return `<span class="lib-tv__name"><span class="lib-tv__title">${escapeHtml(item.name)}</span>${item.teamId ? `<span class="lib-shared-badge" title="${escapeHtml(teamLabel(item))}">${shareIcon}</span>` : ""}${contentSyncIndicatorHtml(item.id)}</span>`;
      }
      if (kind === "comp") {
        return `<span class="lib-tv__name"><span class="lib-tv__title">${escapeHtml(item.name || "Untitled Comp")}</span>${itemIndicatorsHtml("comp", item)}</span>`;
      }
      return `<span class="lib-tv__name"><span class="lib-tv__title">${escapeHtml(item.title || "Untitled")}</span>${folderPathHtml(item)}${itemIndicatorsHtml("build", item)}${buildUsageChipHtml(item, { compact: true })}</span>`;
    case "profession":
      if (kind === "comp") return `<span class="lib-tv__profession">${compBadgeHtml(item)}</span>`;
      return `<span class="lib-tv__profession">${kind === "build" ? escapeHtml(item.profession || "") : ""}</span>`;
    case "spec":
      return `<span class="lib-tv__spec">${kind === "build" ? escapeHtml(eliteSpecName(item) || "") : ""}</span>`;
    case "mode":
      return `<span class="lib-tv__mode">${kind === "build" ? escapeHtml(gameModeLabel(item.gameMode || "pve")) : ""}</span>`;
    case "role":
      return `<span class="lib-tv__role">${kind === "build" ? roleBadgeHtml(item, state.upgradeCatalog) : ""}</span>`;
    case "tags":
      return textCell("tags", kind === "folder" ? "" : (item.tags || []).join(", "));
    case "created":
      return dateCell("created", item.createdAt);
    case "modified":
      return dateCell("modified", item.updatedAt);
    case "path":
      // A folder's path is where it sits, not itself.
      return textCell("path", folderPathText(kind === "folder" ? item.parentId : item.folderId));
    case "owner":
      return textCell("owner", ownerLabel(item));
    case "published": {
      if (kind === "folder") return `<span class="lib-tv__published"></span>`;
      const { status, reason } = itemPublishStatus(kind, item, state.builds);
      const d = status === "never" ? null : describePublishStatus(status, reason);
      return `<span class="lib-tv__published${d ? ` lib-tv__published-${status}` : ""}" title="${escapeHtml(d?.title || "")}">${escapeHtml(d?.label || "")}</span>`;
    }
    default:
      return `<span class="${cellClass(id)}"></span>`;
  }
}

// ─── Grid View ─────────────────────────────────────────────────────────────────

function renderGridView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();
  const comps = getVisibleComps();

  if (folders.length === 0 && builds.length === 0 && comps.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  const folderCards = folders
    .map(
      (f) => `
        <div class="af-tile af-tile--row af-tile--folder" data-folder-id="${escapeHtml(f.id)}">
          <div class="af-tile__folder-icon">${folderIcon}${f.teamId ? `<span class="lib-shared-badge lib-shared-badge--grid" title="${escapeHtml(teamLabel(f))}">${shareIcon}</span>` : ""}</div>
          <div class="af-tile__title">${escapeHtml(f.name)}${contentSyncIndicatorHtml(f.id)}</div>
        </div>
      `
    )
    .join("");

  const buildCards = builds
    .map(
      (b) => `
        <div class="af-tile af-tile--strip ${b.pinned ? "af-tile--pinned" : ""}" style="${professionStripStyle(b.profession)}" data-build-id="${escapeHtml(b.id)}">
          <div class="af-tile__head">
            <div class="af-tile__glyph" style="${professionSeriesStyle(b.profession)}">${getSpecIcon(b)}</div>
            <div class="af-tile__title">${escapeHtml(b.title || "Untitled")}${itemIndicatorsHtml("build", b)}</div>
            ${buildUsageChipHtml(b, { compact: true })}${pinStarHtml(b)}
          </div>
          ${folderPathHtml(b)}
          <div class="af-tile__pills">
            ${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}${roleBadgeHtml(b, state.upgradeCatalog)}
          </div>
          <div class="af-tile__meta">${formatDate(b.updatedAt)}</div>
        </div>
      `
    )
    .join("");

  const compCards = comps
    .map(
      (c) => `
        <div class="af-tile af-tile--row" data-comp-id="${escapeHtml(c.id)}">
          <div class="af-tile__comp-icon">${compIcon}</div>
          <div class="af-tile__comp-body">
            <div class="af-tile__title">${escapeHtml(c.name || "Untitled Comp")}${itemIndicatorsHtml("comp", c)}</div>
            ${compBadgeHtml(c)}
          </div>
        </div>
      `
    )
    .join("");

  const sections = [];
  // data-grid marks the folder section for insertInlineInput(), which has to
  // append a new-folder card to the folder grid specifically. It is a JS hook,
  // not a style variant: the old .lib-grid--folders class carried both jobs,
  // and the sizing half is now the --axi-grid-min knob below.
  if (folderCards) sections.push(`<div class="lib-grid" data-grid="folders" style="--axi-grid-min: 170px">${folderCards}</div>`);
  if (compCards) sections.push(`<div class="lib-grid" style="--axi-grid-min: 170px">${compCards}</div>`);
  if (buildCards) sections.push(`<div class="lib-grid" style="--axi-grid-min: 200px">${buildCards}</div>`);
  container.innerHTML = sections.join("");

  bindContentEvents(container);
}

// ─── Icon View ─────────────────────────────────────────────────────────────────

function renderIconView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();
  const comps = getVisibleComps();

  if (folders.length === 0 && builds.length === 0 && comps.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  const folderItems = folders
    .map(
      (f) => `
        <div class="lib-icon-item lib-icon-item--folder" data-folder-id="${escapeHtml(f.id)}">
          <div class="lib-icon-item__icon lib-icon-item__icon--folder">${folderIcon}${f.teamId ? `<span class="lib-shared-badge lib-shared-badge--icon" title="${escapeHtml(teamLabel(f))}">${shareIcon}</span>` : ""}</div>
          <div class="lib-icon-item__label">${escapeHtml(f.name)}${contentSyncIndicatorHtml(f.id)}</div>
        </div>
      `
    )
    .join("");

  const buildItems = builds
    .map(
      (b) => `
        <div class="lib-icon-item lib-icon-item--build ${b.pinned ? "lib-icon-item--pinned" : ""}" data-build-id="${escapeHtml(b.id)}">
          <div class="lib-icon-item__icon" style="${professionSeriesStyle(b.profession)}">${getSpecIcon(b)}</div>
          <div class="lib-icon-item__label">${escapeHtml(b.title || "Untitled")}${itemIndicatorsHtml("build", b)}${buildUsageChipHtml(b, { compact: true })}</div>
          ${folderPathHtml(b)}
        </div>
      `
    )
    .join("");

  const compItems = comps
    .map(
      (c) => `
        <div class="lib-icon-item lib-icon-item--comp" data-comp-id="${escapeHtml(c.id)}">
          <div class="lib-icon-item__icon lib-icon-item__icon--comp">${compIcon}</div>
          <div class="lib-icon-item__label">${escapeHtml(c.name || "Untitled Comp")}${itemIndicatorsHtml("comp", c)}</div>
        </div>
      `
    )
    .join("");

  container.innerHTML = `<div class="lib-icon-grid">${folderItems}${compItems}${buildItems}</div>`;

  bindContentEvents(container);
}

// ─── Columns View (Miller columns) ─────────────────────────────────────────────

function renderColumnsView(container) {
  // Build columns: first column is the current navigation context,
  // subsequent columns are based on selected folders in _columnSelectedFolders
  _pruneColumnSelections();
  const columns = [];

  // Column 0: root level (folders + builds + comps at current navigation context)
  const rootFolders = getVisibleFolders();
  const rootBuilds = getVisibleBuilds();
  const rootComps = getVisibleComps();
  // A column has to know which folder it IS, not just what it contains: a drop
  // lands on a column, and every column past the first belongs to a different
  // folder than the one the library is navigated to.
  const rootFolderId = state.currentFolder?.type === "custom" ? state.currentFolder.id : null;
  const rootCompId = state.currentFolder?.type === "comp" ? state.currentFolder.id : null;
  columns.push({
    folders: rootFolders,
    builds: rootBuilds,
    comps: rootComps,
    parentId: null,
    folderId: rootFolderId,
    compId: rootCompId,
    title: state.currentFolder?.name || "Library",
  });

  // Subsequent columns based on selected folders/comps
  for (let i = 0; i < _columnSelectedFolders.length; i++) {
    const selectedId = _columnSelectedFolders[i];
    if (!selectedId) break;

    // Check if the selected item is a comp
    const selectedComp = (state.comps || []).find((c) => c.id === selectedId);
    if (selectedComp) {
      // Comp selected: show its builds in next column, no sub-folders or sub-comps
      const selectedCompBuildIds = new Set(selectedComp.buildIds || []);
      const compBuilds = state.builds.filter((b) => selectedCompBuildIds.has(b.id));
      columns.push({ folders: [], builds: compBuilds, comps: [], parentId: selectedId, folderId: null, compId: selectedId, title: selectedComp.name || "Untitled Comp" });
      break; // comps are flat — no further nesting
    }

    // Columns past the first are built straight from the stores, so they have
    // to apply the search themselves.
    const query = searchQuery();

    const childFolders = libraryFolders()
      .filter((f) => f.parentId === selectedId)
      .filter((f) => !query || (f.name || "").toLowerCase().includes(query))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const childBuilds = libraryBuilds()
      .filter((b) => b.folderId === selectedId)
      .filter((b) => buildMatchesQuery(b, query))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const childComps = libraryComps()
      .filter((c) => c.folderId === selectedId)
      .filter((c) => compMatchesQuery(c, query))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const selectedFolder = libraryFolders().find((f) => f.id === selectedId);
    columns.push({ folders: childFolders, builds: childBuilds, comps: childComps, parentId: selectedId, folderId: selectedId, compId: null, title: selectedFolder?.name || "Folder" });
  }

  const columnsHtml = columns
    .map((col, colIndex) => {
      const items = [];

      for (const f of col.folders) {
        const isSelected = _columnSelectedFolders[colIndex] === f.id;
        items.push(`
          <div class="lib-col__item lib-col__item--folder ${isSelected ? "lib-col__item--selected" : ""}"
               data-folder-id="${escapeHtml(f.id)}" data-col-index="${colIndex}">
            <span class="lib-col__icon lib-col__icon--folder">${folderIcon}</span>
            <span class="lib-col__name">${escapeHtml(f.name)}${f.teamId ? `<span class="lib-shared-badge" title="${escapeHtml(teamLabel(f))}">${shareIcon}</span>` : ""}${contentSyncIndicatorHtml(f.id)}</span>
            <span class="lib-col__chevron">${chevronRightIcon}</span>
          </div>
        `);
      }

      for (const c of (col.comps || [])) {
        const isSelected = _columnSelectedFolders[colIndex] === c.id;
        items.push(`
          <div class="lib-col__item lib-col__item--comp ${isSelected ? "lib-col__item--selected" : ""}"
               data-comp-id="${escapeHtml(c.id)}" data-col-index="${colIndex}">
            <span class="lib-col__icon lib-col__icon--comp">${compIcon}</span>
            <span class="lib-col__name">${escapeHtml(c.name || "Untitled Comp")}${itemIndicatorsHtml("comp", c)}</span>
            <span class="lib-col__chevron">${chevronRightIcon}</span>
          </div>
        `);
      }

      // A column showing a COMP's roster asks the comp-side question -- "where
      // did this build come from" -- while a column showing a folder asks the
      // library-side one, "who uses this build".
      const colComp = col.compId ? (state.comps || []).find((c) => c.id === col.compId) : null;
      for (const b of col.builds) {
        const sourceChip = colComp
          ? foreignFolderChipHtml(b, colComp)
          : buildUsageChipHtml(b, { compact: true });
        items.push(`
          <div class="lib-col__item lib-col__item--build"
               data-build-id="${escapeHtml(b.id)}" data-col-index="${colIndex}">
            <span class="lib-col__icon" style="${professionSeriesStyle(b.profession)}">${getSpecIcon(b)}</span>
            <span class="lib-col__name">${escapeHtml(b.title || "Untitled")}${folderPathHtml(b)}${itemIndicatorsHtml("build", b)}</span>
            ${roleBadgeHtml(b, state.upgradeCatalog)}${sourceChip}
          </div>
        `);
      }

      if (items.length === 0) {
        items.push(`<div class="lib-col__empty">Empty</div>`);
      }

      // data-col-folder-id / data-col-comp-id rather than data-folder-id: the
      // latter would make the column itself draggable and would be picked up by
      // .closest() as if the column were a folder row.
      const colAttr = col.compId
        ? `data-col-comp-id="${escapeHtml(col.compId)}"`
        : `data-col-folder-id="${escapeHtml(col.folderId || "")}"`;
      const count = col.folders.length + (col.comps || []).length + col.builds.length;
      const head = `<div class="lib-col__head">
        <span class="axi-eyebrow lib-col__head-title">${escapeHtml(col.title || "")}</span>
        <span class="axi-badge-count">${count}</span>
      </div>`;
      return `<div class="lib-col" data-col="${colIndex}" ${colAttr}>${head}<div class="lib-col__body">${items.join("")}</div></div>`;
    })
    .join("");

  container.innerHTML = `<div class="lib-columns">${columnsHtml}</div>`;

  bindColumnsEvents(container);
  bindContentEvents(container);
}

function bindColumnsEvents(container) {
  // Folder click in columns view: select folder and show its contents in the next column
  container.querySelectorAll(".lib-col__item--folder[data-col-index]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const colIndex = parseInt(el.dataset.colIndex, 10);
      const folderId = el.dataset.folderId;

      // Truncate selections after this column and set new selection
      _columnSelectedFolders = _columnSelectedFolders.slice(0, colIndex);
      _columnSelectedFolders[colIndex] = folderId;

      renderContent();
    });
  });

  // Comp click in columns view: select comp and show its builds in the next column
  container.querySelectorAll(".lib-col__item--comp[data-col-index]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const colIndex = parseInt(el.dataset.colIndex, 10);
      const compId = el.dataset.compId;

      _columnSelectedFolders = _columnSelectedFolders.slice(0, colIndex);
      _columnSelectedFolders[colIndex] = compId;

      renderContent();
    });
  });
}

// ─── Event binding ─────────────────────────────────────────────────────────────

function bindContentEvents(container) {
  // Container-level click: only bind once (container persists across renders)
  if (!container.dataset.contentBound) {
    container.dataset.contentBound = "1";
    container.addEventListener("click", (e) => {
      if (!e.target.closest("[data-build-id]") && !e.target.closest("[data-folder-id]") && !e.target.closest("[data-comp-id]") && !e.target.closest("[data-sort-field]")) {
        clearSelection();
      }
    });
  }

  // Source chips sit INSIDE build rows and comp rows, both of which are
  // clickable and draggable. They claim the click first so opening the sources
  // modal never doubles as selecting or opening the row behind it.
  container.querySelectorAll("[data-src-build]:not([data-bound]), [data-src-comp]:not([data-bound])").forEach((el) => {
    el.dataset.bound = "1";
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const buildId = el.dataset.srcBuild;
      if (buildId) {
        const build = state.builds.find((b) => b.id === buildId);
        const comp = el.dataset.srcComp
          ? (state.comps || []).find((c) => c.id === el.dataset.srcComp)
          : null;
        if (build) showBuildSourcesModal(build, comp);
        return;
      }
      const comp = (state.comps || []).find((c) => c.id === el.dataset.srcComp);
      if (comp) showCompSourcesModal(comp);
    });
  });

  // Child elements: use data-bound flag (children are replaced on re-render)
  container.querySelectorAll("[data-build-id]:not([data-bound])").forEach((el) => {
    el.dataset.bound = "1";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!e.target.closest("[data-action]")) {
        handleBuildClick(el.dataset.buildId, e);
      }
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      _callbacks.onLoadBuild?.(el.dataset.buildId);
    });
  });

  // Comp elements — behave like folders (expand in table, drill-in in others)
  container.querySelectorAll("[data-comp-id]:not([data-bound])").forEach((el) => {
    el.dataset.bound = "1";
    if (el.closest(".lib-tv")) {
      // Table view: single click toggles expand/collapse (like folders)
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const compId = el.dataset.compId;
        if (_tableExpandedFolders.has(compId)) {
          _tableExpandedFolders.delete(compId);
        } else {
          _tableExpandedFolders.add(compId);
        }
        renderContent();
      });
    } else if (!el.closest(".lib-columns")) {
      // List/grid/icon views: single click selects, double-click navigates into comp
      // (columns view handles comp clicks via bindColumnsEvents)
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        handleCompClick(el.dataset.compId, e);
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        _callbacks.onOpenComp?.(el.dataset.compId);
      });
    }
  });

  container.querySelectorAll("[data-folder-id]:not([data-bound])").forEach((el) => {
    el.dataset.bound = "1";
    if (el.closest(".lib-tv")) {
      // Table view: single click toggles expand/collapse
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const folderId = el.dataset.folderId;
        if (_tableExpandedFolders.has(folderId)) {
          _tableExpandedFolders.delete(folderId);
        } else {
          _tableExpandedFolders.add(folderId);
        }
        renderContent();
      });
    } else if (!el.closest(".lib-columns")) {
      // List/grid/icon views: double-click navigates into folder
      // (table and columns handle folders via their own click handlers)
      el.addEventListener("dblclick", () => {
        _callbacks.onNavigate?.({ type: "custom", id: el.dataset.folderId });
      });
    }
  });

  container.querySelectorAll("[data-sort-field]:not([data-bound])").forEach((th) => {
    th.dataset.bound = "1";
    th.addEventListener("click", (e) => {
      e.stopPropagation();
      const field = th.dataset.sortField;
      const { sortField, sortDirection } = state.libraryPrefs;
      const newDirection = field === sortField && sortDirection === "desc" ? "asc" : "desc";
      _callbacks.onSortChange?.({ field, direction: newDirection });
    });
  });
}
