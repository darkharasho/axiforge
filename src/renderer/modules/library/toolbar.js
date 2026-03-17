// Library toolbar module — renders search, sort, view toggle, breadcrumb, and filter chips.

import { state } from "../state.js";
import { escapeHtml, formatRelativeTime } from "../utils.js";
import { getProfessionSvg } from "../profession-icons.js";
import {
  magnifyingGlassIcon,
  plusIcon,
  bars3Icon,
  tableIcon,
  squaresIcon,
  squaresMiniIcon,
  viewColumnsIcon,
  chevronRightIcon,
  chevronDownIcon,
  homeIcon,
  xMarkIcon,
  checkIcon,
  arrowDownTrayIcon,
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
          <option value="sortOrder" ${prefs.sortField === "sortOrder" ? "selected" : ""}>Custom</option>
          <option value="updatedAt" ${prefs.sortField === "updatedAt" ? "selected" : ""}>Last Modified</option>
          <option value="createdAt" ${prefs.sortField === "createdAt" ? "selected" : ""}>Created</option>
          <option value="title" ${prefs.sortField === "title" ? "selected" : ""}>A–Z</option>
          <option value="profession" ${prefs.sortField === "profession" ? "selected" : ""}>Profession</option>
        </select>
      </div>
      <div class="lib-toolbar__view-toggle" role="group" aria-label="View mode">
        ${renderViewToggle(prefs.viewMode)}
      </div>
      <button type="button" id="lib-import-btn" class="btn lib-toolbar__import-btn">
        ${arrowDownTrayIcon} Import
      </button>
      <button type="button" id="lib-new-build-btn" class="btn btn-primary lib-toolbar__new-btn">
        ${plusIcon} New Build
      </button>
    </div>
  `;

  bindToolbarEvents(container);
}

/**
 * Render filter dropdowns into #lib-filters.
 */
export function renderFilters() {
  const container = document.getElementById("lib-filters");
  if (!container) return;

  const activeFilters = state.libraryPrefs.activeFilters || {};

  // Collect unique professions and their elite specs from builds
  const profMap = new Map(); // profession → Set of elite specs
  for (const b of state.builds) {
    if (!b.profession) continue;
    if (!profMap.has(b.profession)) profMap.set(b.profession, new Set());
    const spec = _getEliteSpec(b);
    if (spec) profMap.get(b.profession).add(spec);
  }
  const professions = [...profMap.keys()].sort();

  const gameModes = [...new Set(state.builds.map((b) => b.gameMode || "pve").filter(Boolean))].sort();
  const tags = [...new Set(state.builds.flatMap((b) => b.tags || []).filter(Boolean))].sort();

  if (professions.length === 0 && gameModes.length === 0 && tags.length === 0) {
    container.innerHTML = "";
    return;
  }

  const dropdowns = [];

  // Profession / Elite Spec dropdown
  if (professions.length > 0) {
    const selectedProfs = activeFilters.professions || [];
    const selectedSpecs = activeFilters.eliteSpecs || [];
    const count = selectedProfs.length + selectedSpecs.length;
    const label = count > 0 ? `Class (${count})` : "Class";

    let items = "";
    for (const prof of professions) {
      const profActive = selectedProfs.includes(prof);
      const svg = getProfessionSvg(prof) || "";
      items += `<button type="button" class="lib-fd__item ${profActive ? "lib-fd__item--active" : ""}" data-filter-type="professions" data-filter-value="${escapeHtml(prof)}">
        <span class="lib-fd__check">${checkIcon}</span>
        <span class="lib-fd__icon lib-fd__icon--prof">${svg}</span>
        <span class="lib-fd__label">${escapeHtml(prof)}</span>
      </button>`;

      // Elite specs under this profession
      const specs = [...(profMap.get(prof) || [])].sort();
      for (const spec of specs) {
        const specActive = selectedSpecs.includes(spec);
        const specSvg = getProfessionSvg(spec) || "";
        items += `<button type="button" class="lib-fd__item lib-fd__item--indent ${specActive ? "lib-fd__item--active" : ""}" data-filter-type="eliteSpecs" data-filter-value="${escapeHtml(spec)}">
          <span class="lib-fd__check">${checkIcon}</span>
          <span class="lib-fd__icon lib-fd__icon--spec">${specSvg}</span>
          <span class="lib-fd__label">${escapeHtml(spec)}</span>
        </button>`;
      }
    }

    dropdowns.push(_renderDropdown("class-filter", label, items, count > 0));
  }

  // Game Mode dropdown
  if (gameModes.length > 1) {
    const selectedModes = activeFilters.gameModes || [];
    const count = selectedModes.length;
    const label = count > 0 ? `Mode (${count})` : "Mode";

    let items = "";
    for (const mode of gameModes) {
      const active = selectedModes.includes(mode);
      const modeLabel = mode === "pve" ? "PvE" : mode === "pvp" ? "PvP" : mode === "wvw" ? "WvW" : escapeHtml(mode);
      items += `<button type="button" class="lib-fd__item ${active ? "lib-fd__item--active" : ""}" data-filter-type="gameModes" data-filter-value="${escapeHtml(mode)}">
        <span class="lib-fd__check">${checkIcon}</span>
        <span class="lib-fd__label">${escapeHtml(modeLabel)}</span>
      </button>`;
    }

    dropdowns.push(_renderDropdown("mode-filter", label, items, count > 0));
  }

  // Tags dropdown
  if (tags.length > 0) {
    const selectedTags = activeFilters.tags || [];
    const count = selectedTags.length;
    const label = count > 0 ? `Tags (${count})` : "Tags";

    let items = "";
    for (const tag of tags) {
      const active = selectedTags.includes(tag);
      items += `<button type="button" class="lib-fd__item ${active ? "lib-fd__item--active" : ""}" data-filter-type="tags" data-filter-value="${escapeHtml(tag)}">
        <span class="lib-fd__check">${checkIcon}</span>
        <span class="lib-fd__label">${escapeHtml(tag)}</span>
      </button>`;
    }

    dropdowns.push(_renderDropdown("tags-filter", label, items, count > 0));
  }

  // Clear all button
  const hasActiveFilter = _hasAnyFilter(activeFilters);
  const clearBtn = hasActiveFilter
    ? `<button type="button" class="lib-fd__clear" data-filter-clear="1">${xMarkIcon} Clear</button>`
    : "";

  container.innerHTML = `<div class="lib-filters__bar">${dropdowns.join("")}${clearBtn}</div>`;

  bindFilterEvents(container);
}

function _renderDropdown(id, label, items, hasActive) {
  return `<div class="lib-fd" data-dropdown="${id}">
    <button type="button" class="lib-fd__trigger ${hasActive ? "lib-fd__trigger--active" : ""}">
      <span>${label}</span>${chevronDownIcon}
    </button>
    <div class="lib-fd__menu">${items}</div>
  </div>`;
}

function _getEliteSpec(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

function _hasAnyFilter(filters) {
  return (filters.professions?.length > 0) ||
    (filters.eliteSpecs?.length > 0) ||
    (filters.gameModes?.length > 0) ||
    (filters.tags?.length > 0);
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
    { id: "columns", icon: viewColumnsIcon, label: "Columns view" },
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

  // Import button
  container.querySelector("#lib-import-btn")?.addEventListener("click", () => {
    _callbacks.onImportChatLink?.();
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
  // Dropdown trigger toggle
  container.querySelectorAll(".lib-fd__trigger").forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const dropdown = trigger.closest(".lib-fd");
      const wasOpen = dropdown.classList.contains("lib-fd--open");

      // Close all dropdowns
      container.querySelectorAll(".lib-fd--open").forEach((d) => d.classList.remove("lib-fd--open"));

      if (!wasOpen) {
        dropdown.classList.add("lib-fd--open");
        // Close on outside click
        const closeHandler = (evt) => {
          if (!dropdown.contains(evt.target)) {
            dropdown.classList.remove("lib-fd--open");
            document.removeEventListener("click", closeHandler);
          }
        };
        // Delay to avoid this click closing it immediately
        setTimeout(() => document.addEventListener("click", closeHandler), 0);
      }
    });
  });

  // Multi-select items (toggle value in array, keep dropdown open)
  container.querySelectorAll("[data-filter-type]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const type = btn.dataset.filterType;
      const value = btn.dataset.filterValue;
      const current = state.libraryPrefs.activeFilters[type] || [];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];

      // Toggle visual state in place
      btn.classList.toggle("lib-fd__item--active");

      // Update trigger label
      const dropdown = btn.closest(".lib-fd");
      const trigger = dropdown?.querySelector(".lib-fd__trigger span");
      const allItems = dropdown?.querySelectorAll(".lib-fd__item--active") || [];
      const baseLabel = dropdown?.dataset.dropdown === "class-filter" ? "Class"
        : dropdown?.dataset.dropdown === "mode-filter" ? "Mode" : "Tags";
      trigger.textContent = allItems.length > 0 ? `${baseLabel} (${allItems.length})` : baseLabel;
      dropdown?.querySelector(".lib-fd__trigger")?.classList.toggle("lib-fd__trigger--active", allItems.length > 0);

      _callbacks.onFilterChange?.({ type, value: updated.length > 0 ? updated : null });
    });
  });

  // Clear all filters
  container.querySelectorAll("[data-filter-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _callbacks.onFilterChange?.({ clear: true });
    });
  });
}
