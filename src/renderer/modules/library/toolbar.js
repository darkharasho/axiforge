// Library toolbar module — renders search, sort, view toggle, breadcrumb, and filter chips.

import { state } from "../state.js";
import { escapeHtml, formatRelativeTime } from "../utils.js";
import {
  magnifyingGlassIcon,
  plusIcon,
  bars3Icon,
  tableIcon,
  squaresIcon,
  squaresMiniIcon,
  chevronRightIcon,
  homeIcon,
} from "./heroicons.js";

let _callbacks = {};

/**
 * Store callbacks for toolbar actions.
 * @param {{ onFilterChange, onSortChange, onViewChange, onNewBuild, onNavigate }} callbacks
 */
export function initToolbar(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Render the toolbar into #lib-toolbar.
 */
export function renderToolbar() {
  const container = document.getElementById("lib-toolbar");
  if (!container) return;

  const prefs = state.libraryPrefs;
  const searchVal = escapeHtml(state.buildSearch || "");

  container.innerHTML = `
    <div class="lib-toolbar__breadcrumb">
      ${renderBreadcrumb()}
    </div>
    <div class="lib-toolbar__controls">
      <div class="lib-toolbar__search">
        <span class="lib-toolbar__search-icon">${magnifyingGlassIcon}</span>
        <input
          type="search"
          id="lib-search-input"
          class="lib-toolbar__search-input"
          placeholder="Search builds…"
          value="${searchVal}"
          autocomplete="off"
        />
      </div>
      <div class="lib-toolbar__sort">
        <select id="lib-sort-select" class="lib-toolbar__sort-select">
          <option value="updatedAt" ${prefs.sortField === "updatedAt" ? "selected" : ""}>Last Modified</option>
          <option value="createdAt" ${prefs.sortField === "createdAt" ? "selected" : ""}>Created</option>
          <option value="title" ${prefs.sortField === "title" ? "selected" : ""}>A–Z</option>
          <option value="profession" ${prefs.sortField === "profession" ? "selected" : ""}>Profession</option>
        </select>
      </div>
      <div class="lib-toolbar__view-toggle" role="group" aria-label="View mode">
        ${renderViewToggle(prefs.viewMode)}
      </div>
      <button type="button" id="lib-new-build-btn" class="btn btn-primary lib-toolbar__new-btn">
        ${plusIcon} New Build
      </button>
    </div>
  `;

  bindToolbarEvents(container);
}

/**
 * Render filter chips into #lib-filters.
 */
export function renderFilters() {
  const container = document.getElementById("lib-filters");
  if (!container) return;

  const activeFilters = state.libraryPrefs.activeFilters || {};

  // Collect unique values from builds
  const professions = [...new Set(state.builds.map((b) => b.profession).filter(Boolean))].sort();
  const gameModes = [...new Set(state.builds.map((b) => b.gameMode || "pve").filter(Boolean))].sort();
  const tags = [...new Set(state.builds.flatMap((b) => b.tags || []).filter(Boolean))].sort();

  if (professions.length === 0 && gameModes.length === 0 && tags.length === 0) {
    container.innerHTML = "";
    return;
  }

  const chips = [];

  // Clear all chip (only when filters are active)
  const hasActiveFilter = Object.values(activeFilters).some(Boolean);
  if (hasActiveFilter) {
    chips.push(`<button type="button" class="lib-filter-chip lib-filter-chip--clear" data-filter-clear="1">Clear filters</button>`);
  }

  if (professions.length > 1) {
    chips.push(`<span class="lib-filter-label">Profession:</span>`);
    for (const prof of professions) {
      const active = activeFilters.profession === prof;
      chips.push(
        `<button type="button" class="lib-filter-chip ${active ? "lib-filter-chip--active" : ""}" data-filter-type="profession" data-filter-value="${escapeHtml(prof)}">${escapeHtml(prof)}</button>`
      );
    }
  }

  if (gameModes.length > 1) {
    chips.push(`<span class="lib-filter-label">Mode:</span>`);
    for (const mode of gameModes) {
      const active = activeFilters.gameMode === mode;
      const label = mode === "pve" ? "PvE" : mode === "pvp" ? "PvP" : mode === "wvw" ? "WvW" : escapeHtml(mode);
      chips.push(
        `<button type="button" class="lib-filter-chip ${active ? "lib-filter-chip--active" : ""}" data-filter-type="gameMode" data-filter-value="${escapeHtml(mode)}">${label}</button>`
      );
    }
  }

  if (tags.length > 0) {
    chips.push(`<span class="lib-filter-label">Tags:</span>`);
    for (const tag of tags) {
      const active = activeFilters.tag === tag;
      chips.push(
        `<button type="button" class="lib-filter-chip ${active ? "lib-filter-chip--active" : ""}" data-filter-type="tag" data-filter-value="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
      );
    }
  }

  container.innerHTML = `<div class="lib-filters__chips">${chips.join("")}</div>`;

  bindFilterEvents(container);
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function renderBreadcrumb() {
  const folder = state.currentFolder;
  const parts = [];

  parts.push(
    `<button type="button" class="lib-breadcrumb__item" data-navigate-root="1">${homeIcon}<span>All Builds</span></button>`
  );

  if (!folder || folder.type === "all") {
    // At root — just highlight "All Builds"
    return parts.join("");
  }

  if (folder.type === "smart-profession") {
    parts.push(`<span class="lib-breadcrumb__sep">${chevronRightIcon}</span>`);
    parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">By Profession</span>`);
    parts.push(`<span class="lib-breadcrumb__sep">${chevronRightIcon}</span>`);
    parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">${escapeHtml(folder.id)}</span>`);
    return parts.join("");
  }

  if (folder.type === "smart-gamemode") {
    parts.push(`<span class="lib-breadcrumb__sep">${chevronRightIcon}</span>`);
    parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">By Game Mode</span>`);
    parts.push(`<span class="lib-breadcrumb__sep">${chevronRightIcon}</span>`);
    const modeLabel = gameModeLabel(folder.id);
    parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">${escapeHtml(modeLabel)}</span>`);
    return parts.join("");
  }

  if (folder.type === "custom") {
    // Build the ancestor chain
    const chain = buildFolderChain(folder.id);
    for (let i = 0; i < chain.length; i++) {
      const f = chain[i];
      const isLast = i === chain.length - 1;
      parts.push(`<span class="lib-breadcrumb__sep">${chevronRightIcon}</span>`);
      if (isLast) {
        parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">${escapeHtml(f.name)}</span>`);
      } else {
        parts.push(
          `<button type="button" class="lib-breadcrumb__item" data-navigate-folder="${escapeHtml(f.id)}">${escapeHtml(f.name)}</button>`
        );
      }
    }
    return parts.join("");
  }

  return parts.join("");
}

function buildFolderChain(folderId) {
  const chain = [];
  let id = folderId;
  const visited = new Set();
  while (id && !visited.has(id)) {
    visited.add(id);
    const folder = state.folders.find((f) => f.id === id);
    if (!folder) break;
    chain.unshift(folder);
    id = folder.parentId;
  }
  return chain;
}

function gameModeLabel(id) {
  if (id === "pve") return "PvE";
  if (id === "pvp") return "PvP";
  if (id === "wvw") return "WvW";
  return id;
}

function renderViewToggle(active) {
  const modes = [
    { id: "list", icon: bars3Icon, label: "List view" },
    { id: "table", icon: tableIcon, label: "Table view" },
    { id: "grid", icon: squaresIcon, label: "Grid view" },
    { id: "icon", icon: squaresMiniIcon, label: "Icon view" },
  ];
  return modes
    .map(
      (m) =>
        `<button type="button"
          class="lib-view-btn ${active === m.id ? "lib-view-btn--active" : ""}"
          data-view="${m.id}"
          title="${m.label}"
          aria-label="${m.label}"
          aria-pressed="${active === m.id}"
        >${m.icon}</button>`
    )
    .join("");
}

function bindToolbarEvents(container) {
  // Search input
  const searchInput = container.querySelector("#lib-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.buildSearch = e.target.value;
      _callbacks.onFilterChange?.();
    });
  }

  // Sort select
  const sortSelect = container.querySelector("#lib-sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      _callbacks.onSortChange?.({ field: e.target.value });
    });
  }

  // View toggle buttons
  container.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _callbacks.onViewChange?.(btn.dataset.view);
    });
  });

  // New build button
  const newBtn = container.querySelector("#lib-new-build-btn");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      _callbacks.onNewBuild?.();
    });
  }

  // Breadcrumb navigation
  container.querySelectorAll("[data-navigate-root]").forEach((el) => {
    el.addEventListener("click", () => {
      _callbacks.onNavigate?.({ type: "all" });
    });
  });
  container.querySelectorAll("[data-navigate-folder]").forEach((el) => {
    el.addEventListener("click", () => {
      _callbacks.onNavigate?.({ type: "custom", id: el.dataset.navigateFolder });
    });
  });
}

function bindFilterEvents(container) {
  // Clear all filters
  container.querySelectorAll("[data-filter-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _callbacks.onFilterChange?.({ clear: true });
    });
  });

  // Individual filter chips (toggle)
  container.querySelectorAll("[data-filter-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.filterType;
      const value = btn.dataset.filterValue;
      const current = state.libraryPrefs.activeFilters[type];
      // Toggle: click active chip clears it
      _callbacks.onFilterChange?.({ type, value: current === value ? null : value });
    });
  });
}
