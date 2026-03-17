// Library content module — renders builds and folders in the active view mode.

import { state } from "../state.js";
import { escapeHtml, formatRelativeTime } from "../utils.js";
import { getVisibleBuilds, getVisibleFolders } from "./folder-store.js";
import { getProfessionSvg } from "../profession-icons.js";
import { clearSelection, handleBuildClick } from "./selection.js";
import { wireDragDropEvents } from "./drag-drop.js";
import {
  folderIcon,
  starIcon,
  chevronUpDownIcon,
  chevronUpIcon,
  chevronDownIcon,
  chevronRightIcon,
} from "./heroicons.js";

let _callbacks = {};
const _tableExpandedFolders = new Set();

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

  const viewMode = state.libraryPrefs.viewMode || "list";

  switch (viewMode) {
    case "table":
      renderTableView(container);
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

  // Re-init SortableJS on the new DOM
  wireDragDropEvents();
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function getSpecIcon(build) {
  const eliteSpec = getEliteSpecName(build);
  const name = eliteSpec || build.profession;
  if (!name) return "";
  const svg = getProfessionSvg(name);
  return svg || "";
}

function getEliteSpecName(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

function profClass(profession) {
  if (!profession) return "";
  return `lib-prof--${profession.toLowerCase()}`;
}

function gameModeLabel(mode) {
  if (mode === "pve") return "PvE";
  if (mode === "pvp") return "PvP";
  if (mode === "wvw") return "WvW";
  return mode || "PvE";
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
  return `<span class="lib-pill lib-pill--prof ${profClass(prof)}">${escapeHtml(prof)}</span>`;
}

function eliteSpecPillHtml(build) {
  const spec = getEliteSpecName(build);
  if (!spec) return "";
  return `<span class="lib-pill lib-pill--spec">${escapeHtml(spec)}</span>`;
}

function gameModePillHtml(build) {
  const mode = gameModeLabel(build.gameMode || "pve");
  return `<span class="lib-pill lib-pill--mode">${escapeHtml(mode)}</span>`;
}

function tagPillsHtml(build) {
  return (build.tags || [])
    .map((t) => `<span class="lib-pill lib-pill--tag">${escapeHtml(t)}</span>`)
    .join("");
}

function emptyStateHtml() {
  return `<div class="lib-empty-state">
    <p>No builds found.</p>
  </div>`;
}

// ─── List View ─────────────────────────────────────────────────────────────────

function renderListView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();

  if (folders.length === 0 && builds.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  const folderRows = folders
    .map(
      (f) => `
        <div class="lib-list-row lib-list-row--folder" data-folder-id="${escapeHtml(f.id)}">
          <span class="lib-list-row__icon lib-list-row__icon--folder">${folderIcon}</span>
          <span class="lib-list-row__title">${escapeHtml(f.name)}</span>
        </div>
      `
    )
    .join("");

  const buildRows = builds
    .map(
      (b) => `
        <div class="lib-list-row lib-list-row--build ${b.pinned ? "lib-list-row--pinned" : ""}" data-build-id="${escapeHtml(b.id)}">
          <span class="lib-list-row__spec-icon ${profClass(b.profession)}">${getSpecIcon(b)}</span>
          <span class="lib-list-row__title">${escapeHtml(b.title || "Untitled")}</span>
          <span class="lib-list-row__pills">
            ${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}${tagPillsHtml(b)}
          </span>
          <span class="lib-list-row__date" title="${escapeHtml(b.updatedAt || "")}">${formatDate(b.updatedAt)}</span>
          ${pinStarHtml(b)}
        </div>
      `
    )
    .join("");

  container.innerHTML = `<div class="lib-list">${folderRows}${buildRows}</div>`;

  bindContentEvents(container);
}

// ─── Table View ────────────────────────────────────────────────────────────────

function renderTableView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();

  const { sortField, sortDirection } = state.libraryPrefs;

  function sortHeaderDiv(field, label) {
    const isActive = sortField === field;
    const icon = isActive
      ? (sortDirection === "asc" ? chevronUpIcon : chevronDownIcon)
      : chevronUpDownIcon;
    return `<button type="button" class="lib-tv__sort-btn ${isActive ? "lib-tv__sort-btn--active" : ""}" data-sort-field="${field}">${escapeHtml(label)} ${icon}</button>`;
  }

  if (folders.length === 0 && builds.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  function renderTreeFolder(folder) {
    const isExpanded = _tableExpandedFolders.has(folder.id);
    const chevron = isExpanded ? chevronDownIcon : chevronRightIcon;

    let childrenHtml = "";
    if (isExpanded) {
      const childFolders = state.folders
        .filter((f) => f.parentId === folder.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const folderBuilds = state.builds
        .filter((b) => b.folderId === folder.id)
        .sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          const av = (a[sortField] ?? "").toString().toLowerCase();
          const bv = (b[sortField] ?? "").toString().toLowerCase();
          const dir = sortDirection === "asc" ? 1 : -1;
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
          return 0;
        });

      const items = childFolders.map((f) => renderTreeFolder(f)).join("")
        + folderBuilds.map((b) => renderTreeBuild(b)).join("");

      // Always render <ul> even if empty so SortableJS can create a drop zone
      childrenHtml = `<ul class="lib-tv__children">${items}</ul>`;
    }

    return `
      <li class="lib-tv__item" data-folder-id="${escapeHtml(folder.id)}">
        <div class="lib-tv__row lib-tv__row--folder">
          <span class="lib-tv__action" data-toggle-table-folder="${escapeHtml(folder.id)}">${chevron}</span>
          <span class="lib-tv__icon"><span class="lib-table__folder-icon">${folderIcon}</span></span>
          <span class="lib-tv__name">${escapeHtml(folder.name)}</span>
          <span class="lib-tv__profession"></span>
          <span class="lib-tv__spec"></span>
          <span class="lib-tv__mode"></span>
          <span class="lib-tv__tags"></span>
          <span class="lib-tv__created" title="${escapeHtml(folder.createdAt || "")}">${formatDate(folder.createdAt)}</span>
          <span class="lib-tv__modified" title="${escapeHtml(folder.updatedAt || "")}">${formatDate(folder.updatedAt)}</span>
        </div>
        ${childrenHtml}
      </li>
    `;
  }

  function renderTreeBuild(b) {
    const eliteSpec = getEliteSpecName(b);
    const tags = (b.tags || []).map((t) => escapeHtml(t)).join(", ");
    return `
      <li class="lib-tv__item" data-build-id="${escapeHtml(b.id)}">
        <div class="lib-tv__row lib-tv__row--build ${b.pinned ? "lib-tv__row--pinned" : ""}">
          <span class="lib-tv__action">${pinStarHtml(b)}</span>
          <span class="lib-tv__icon ${profClass(b.profession)}">${getSpecIcon(b)}</span>
          <span class="lib-tv__name">${escapeHtml(b.title || "Untitled")}</span>
          <span class="lib-tv__profession">${escapeHtml(b.profession || "")}</span>
          <span class="lib-tv__spec">${escapeHtml(eliteSpec || "")}</span>
          <span class="lib-tv__mode">${escapeHtml(gameModeLabel(b.gameMode || "pve"))}</span>
          <span class="lib-tv__tags" title="${escapeHtml((b.tags || []).join(", "))}">${tags}</span>
          <span class="lib-tv__created" title="${escapeHtml(b.createdAt || "")}">${formatDate(b.createdAt)}</span>
          <span class="lib-tv__modified" title="${escapeHtml(b.updatedAt || "")}">${formatDate(b.updatedAt)}</span>
        </div>
      </li>
    `;
  }

  const folderItems = folders.map((f) => renderTreeFolder(f)).join("");
  const buildItems = builds.map((b) => renderTreeBuild(b)).join("");

  container.innerHTML = `
    <div class="lib-tv">
      <div class="lib-tv__header">
        <span class="lib-tv__action"></span>
        <span class="lib-tv__icon"></span>
        <span class="lib-tv__name">${sortHeaderDiv("title", "Name")}</span>
        <span class="lib-tv__profession">${sortHeaderDiv("profession", "Profession")}</span>
        <span class="lib-tv__spec">Elite Spec</span>
        <span class="lib-tv__mode">Mode</span>
        <span class="lib-tv__tags">Tags</span>
        <span class="lib-tv__created">${sortHeaderDiv("createdAt", "Created")}</span>
        <span class="lib-tv__modified">${sortHeaderDiv("updatedAt", "Modified")}</span>
      </div>
      <ul class="lib-tv__tree">
        ${folderItems}${buildItems}
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

  bindContentEvents(container);
}

// ─── Grid View ─────────────────────────────────────────────────────────────────

function renderGridView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();

  if (folders.length === 0 && builds.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  const folderCards = folders
    .map(
      (f) => `
        <div class="lib-grid-card lib-grid-card--folder" data-folder-id="${escapeHtml(f.id)}">
          <div class="lib-grid-card__icon lib-grid-card__icon--folder">${folderIcon}</div>
          <div class="lib-grid-card__title">${escapeHtml(f.name)}</div>
        </div>
      `
    )
    .join("");

  const buildCards = builds
    .map(
      (b) => `
        <div class="lib-grid-card lib-grid-card--build ${b.pinned ? "lib-grid-card--pinned" : ""} ${profClass(b.profession)}" data-build-id="${escapeHtml(b.id)}">
          <div class="lib-grid-card__header">
            <div class="lib-grid-card__spec-icon ${profClass(b.profession)}">${getSpecIcon(b)}</div>
            ${pinStarHtml(b)}
          </div>
          <div class="lib-grid-card__title">${escapeHtml(b.title || "Untitled")}</div>
          <div class="lib-grid-card__pills">
            ${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}
          </div>
          <div class="lib-grid-card__date">${formatDate(b.updatedAt)}</div>
        </div>
      `
    )
    .join("");

  container.innerHTML = `<div class="lib-grid">${folderCards}${buildCards}</div>`;

  bindContentEvents(container);
}

// ─── Icon View ─────────────────────────────────────────────────────────────────

function renderIconView(container) {
  const folders = getVisibleFolders();
  const builds = getVisibleBuilds();

  if (folders.length === 0 && builds.length === 0) {
    container.innerHTML = emptyStateHtml();
    return;
  }

  const folderItems = folders
    .map(
      (f) => `
        <div class="lib-icon-item lib-icon-item--folder" data-folder-id="${escapeHtml(f.id)}">
          <div class="lib-icon-item__icon lib-icon-item__icon--folder">${folderIcon}</div>
          <div class="lib-icon-item__label">${escapeHtml(f.name)}</div>
        </div>
      `
    )
    .join("");

  const buildItems = builds
    .map(
      (b) => `
        <div class="lib-icon-item lib-icon-item--build ${b.pinned ? "lib-icon-item--pinned" : ""} ${profClass(b.profession)}" data-build-id="${escapeHtml(b.id)}">
          <div class="lib-icon-item__icon ${profClass(b.profession)}">${getSpecIcon(b)}</div>
          <div class="lib-icon-item__label">${escapeHtml(b.title || "Untitled")}</div>
        </div>
      `
    )
    .join("");

  container.innerHTML = `<div class="lib-icon-grid">${folderItems}${buildItems}</div>`;

  bindContentEvents(container);
}

// ─── Event binding ─────────────────────────────────────────────────────────────

function bindContentEvents(container) {
  // Container-level click: only bind once (container persists across renders)
  if (!container.dataset.contentBound) {
    container.dataset.contentBound = "1";
    container.addEventListener("click", (e) => {
      if (!e.target.closest("[data-build-id]") && !e.target.closest("[data-folder-id]") && !e.target.closest("[data-sort-field]")) {
        clearSelection();
      }
    });
  }

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

  container.querySelectorAll("[data-folder-id]:not([data-bound])").forEach((el) => {
    el.dataset.bound = "1";
    if (el.closest(".lib-tv")) {
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
    } else {
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
