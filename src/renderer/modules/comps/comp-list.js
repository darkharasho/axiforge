// Comp list module — renders the comp list page with toolbar, search, sort, tag filters, and comp rows.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { compIcon } from "../library/heroicons.js";

let _activeCtxMenu = null;

let _callbacks = {};

/**
 * Store callbacks for comp list actions.
 * @param {{ onOpenComp, onNewComp, onDeleteComp, onRenameComp }} callbacks
 */
export function initCompList(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Render the comp list page into #comps-container.
 */
export function renderCompList() {
  const container = document.getElementById("comps-container");
  if (!container) return;

  const comps = getVisibleComps();
  const prefs = state.compPrefs;
  const searchVal = escapeHtml(state.compSearch || "");

  // Collect all unique tags across comps for filter chips
  const allTags = collectAllTags();
  const activeTags = prefs.activeFilters?.tags || [];

  container.innerHTML = `
    <div class="comp-list-toolbar">
      <div class="comp-list-toolbar__left">
        <button type="button" id="comp-new-btn" class="btn btn-primary comp-list-toolbar__new-btn">+ New Comp</button>
      </div>
      <div class="comp-list-toolbar__right">
        <div class="comp-list-toolbar__search">
          <input
            type="search"
            id="comp-search-input"
            class="comp-list-toolbar__search-input"
            placeholder="Search comps\u2026"
            value="${searchVal}"
            autocomplete="off"
          />
        </div>
        <div class="comp-list-toolbar__sort">
          <select id="comp-sort-select" class="comp-list-toolbar__sort-select">
            <option value="name" ${prefs.sortField === "name" ? "selected" : ""}>Name</option>
            <option value="createdAt" ${prefs.sortField === "createdAt" ? "selected" : ""}>Date Created</option>
            <option value="updatedAt" ${prefs.sortField === "updatedAt" ? "selected" : ""}>Date Updated</option>
          </select>
        </div>
      </div>
    </div>
    ${allTags.length > 0 ? renderTagFilters(allTags, activeTags) : ""}
    <div class="comp-list-body">
      ${comps.length > 0 ? comps.map(renderCompRow).join("") : renderEmptyState()}
    </div>
  `;

  bindListEvents(container);
}

// ─── Filtering / Sorting ──────────────────────────────────────────────────────

/**
 * Return the list of comps after applying search, tag filters, and sorting.
 */
function getVisibleComps() {
  let comps = [...state.comps];

  // Filter by search text (case-insensitive name match)
  const search = (state.compSearch || "").trim().toLowerCase();
  if (search) {
    comps = comps.filter((c) => (c.name || "").toLowerCase().includes(search));
  }

  // Filter by active tag filters (show comps matching ANY active tag)
  const activeTags = state.compPrefs.activeFilters?.tags || [];
  if (activeTags.length > 0) {
    comps = comps.filter((c) => {
      const compTags = c.tags || [];
      return activeTags.some((t) => compTags.includes(t));
    });
  }

  // Sort
  const { sortField, sortDirection } = state.compPrefs;
  const dir = sortDirection === "asc" ? 1 : -1;

  comps.sort((a, b) => {
    if (sortField === "name") {
      return dir * (a.name || "").localeCompare(b.name || "");
    }
    if (sortField === "createdAt") {
      return dir * ((a.createdAt || 0) - (b.createdAt || 0));
    }
    if (sortField === "updatedAt") {
      return dir * ((a.updatedAt || 0) - (b.updatedAt || 0));
    }
    return 0;
  });

  return comps;
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function collectAllTags() {
  const tagSet = new Set();
  for (const c of state.comps) {
    if (c.tags) {
      for (const t of c.tags) tagSet.add(t);
    }
  }
  return [...tagSet].sort();
}

function renderTagFilters(allTags, activeTags) {
  const chips = allTags
    .map((tag) => {
      const active = activeTags.includes(tag);
      return `<button type="button" class="comp-tag-chip ${active ? "comp-tag-chip--active" : ""}" data-tag-filter="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
    })
    .join("");

  const clearBtn =
    activeTags.length > 0
      ? `<button type="button" class="comp-tag-chip comp-tag-chip--clear" data-tag-clear="1">\u00d7 Clear</button>`
      : "";

  return `<div class="comp-list-tags-bar">${chips}${clearBtn}</div>`;
}

function renderCompRow(comp) {
  const name = escapeHtml(comp.name || "Untitled Comp");
  const buildCount = state.builds.filter((b) => b.compId === comp.id).length;
  const countLabel = buildCount === 1 ? "1 build" : `${buildCount} builds`;
  const tags = (comp.tags || [])
    .map((t) => `<span class="comp-list-row__tag">${escapeHtml(t)}</span>`)
    .join("");

  return `
    <div class="comp-list-row" data-comp-id="${escapeHtml(comp.id)}">
      <span class="comp-list-row__icon">${compIcon}</span>
      <span class="comp-list-row__name">${name}</span>
      <span class="comp-list-row__count">${countLabel}</span>
      <span class="comp-list-row__tags">${tags}</span>
    </div>
  `;
}

function renderEmptyState() {
  const hasSearch = (state.compSearch || "").trim().length > 0;
  const hasTagFilter = (state.compPrefs.activeFilters?.tags || []).length > 0;

  if (hasSearch || hasTagFilter) {
    return `<div class="comp-list-empty">No comps match your filters.</div>`;
  }
  return `<div class="comp-list-empty">No comps yet. Click <strong>New Comp</strong> to get started.</div>`;
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindListEvents(container) {
  // New Comp button
  const newBtn = container.querySelector("#comp-new-btn");
  if (newBtn) {
    newBtn.addEventListener("click", () => _callbacks.onNewComp?.());
  }

  // Search input
  const searchInput = container.querySelector("#comp-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.compSearch = e.target.value;
      const cursorPos = e.target.selectionStart;
      renderCompList();
      // Restore focus and cursor position after re-render
      const newInput = document.getElementById("comp-search-input");
      if (newInput) {
        newInput.focus();
        newInput.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }

  // Sort select
  const sortSelect = container.querySelector("#comp-sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      state.compPrefs.sortField = e.target.value;
      renderCompList();
    });
  }

  // Tag filter chips
  container.querySelectorAll("[data-tag-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.dataset.tagFilter;
      const current = state.compPrefs.activeFilters?.tags || [];
      if (current.includes(tag)) {
        state.compPrefs.activeFilters.tags = current.filter((t) => t !== tag);
      } else {
        if (!state.compPrefs.activeFilters) state.compPrefs.activeFilters = {};
        state.compPrefs.activeFilters.tags = [...current, tag];
      }
      renderCompList();
    });
  });

  // Clear tag filters
  container.querySelectorAll("[data-tag-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.compPrefs.activeFilters) {
        state.compPrefs.activeFilters.tags = [];
      }
      renderCompList();
    });
  });

  // Comp row click — open comp
  container.querySelectorAll(".comp-list-row").forEach((row) => {
    row.addEventListener("click", () => {
      const compId = row.dataset.compId;
      const comp = state.comps.find((c) => c.id === compId);
      if (comp) _callbacks.onOpenComp?.(comp);
    });

    // Right-click context menu
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const compId = row.dataset.compId;
      const comp = state.comps.find((c) => c.id === compId);
      if (comp) showCompCtxMenu(e.clientX, e.clientY, comp);
    });
  });

  // Right-click on empty area
  const body = container.querySelector(".comp-list-body");
  if (body) {
    body.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".comp-list-row")) return; // handled above
      e.preventDefault();
      showEmptyCtxMenu(e.clientX, e.clientY);
    });
  }
}

// ─── Context menu ──────────────────────────────────────────────────────────────

function closeCtxMenu() {
  if (_activeCtxMenu) {
    _activeCtxMenu.remove();
    _activeCtxMenu = null;
  }
}

function showCtxMenu(x, y, items) {
  closeCtxMenu();
  const menu = document.createElement("div");
  menu.className = "lib-ctx-menu";
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  for (const item of items) menu.appendChild(item);
  document.body.appendChild(menu);

  // Position with viewport overflow correction
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;

  _activeCtxMenu = menu;

  // Close on click outside or Escape
  const onClose = (e) => {
    if (!menu.contains(e.target)) { closeCtxMenu(); document.removeEventListener("mousedown", onClose); }
  };
  const onKey = (e) => {
    if (e.key === "Escape") { closeCtxMenu(); document.removeEventListener("keydown", onKey); }
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onClose);
    document.addEventListener("keydown", onKey);
  }, 0);
}

function ctxItem(label, handler, destructive = false) {
  const el = document.createElement("div");
  el.className = "lib-ctx-item" + (destructive ? " lib-ctx-item--danger" : "");
  el.innerHTML =
    `<span class="lib-ctx-item__icon"></span>` +
    `<span class="lib-ctx-item__label">${escapeHtml(label)}</span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    closeCtxMenu();
    handler();
  });
  return el;
}

function ctxSep() {
  const el = document.createElement("div");
  el.className = "lib-ctx-sep";
  return el;
}

function showCompCtxMenu(x, y, comp) {
  const items = [
    ctxItem("Open", () => _callbacks.onOpenComp?.(comp)),
    ctxItem("Rename", () => _callbacks.onRenameComp?.(comp.id, comp.name)),
    ctxItem("Duplicate", () => _callbacks.onDuplicateComp?.(comp.id)),
    ctxSep(),
    ctxItem("Copy JSON", () => handleCopyCompJson(comp)),
    ctxItem("Copy AxiCode", () => handleCopyCompShareCode(comp.id)),
    ctxSep(),
    ctxItem("Delete", () => _callbacks.onDeleteComp?.(comp.id), true),
  ];
  showCtxMenu(x, y, items);
}

function showEmptyCtxMenu(x, y) {
  const items = [
    ctxItem("New Comp", () => _callbacks.onNewComp?.()),
    ctxSep(),
    ctxItem("Paste", () => handlePasteComp()),
  ];
  showCtxMenu(x, y, items);
}

async function handleCopyCompJson(comp) {
  const json = JSON.stringify(comp, null, 2);
  await window.desktopApi.writeClipboardText(json);
}

async function handleCopyCompShareCode(compId) {
  try {
    const code = await window.desktopApi.encodeCompShareCode(compId);
    await window.desktopApi.writeClipboardText(code);
  } catch {
    window.desktopApi.showError?.("Copy Failed", "Failed to generate comp AxiCode.");
  }
}

async function handlePasteComp() {
  try {
    const text = await window.desktopApi.readClipboardText();
    if (!text) return;
    const trimmed = text.trim();

    // Check if it's a comp share code
    if (trimmed.startsWith("<AxiForge:Comp:") && trimmed.endsWith(">")) {
      try {
        const result = await window.desktopApi.importCompShareCode(trimmed);
        state.comps = await window.desktopApi.listComps();
        state.builds = await window.desktopApi.listBuilds();
        if (result.warning) {
          window.desktopApi.showError?.("Partial Import", result.warning);
        }
        const newComp = state.comps.find((c) => c.id === result.compId);
        if (newComp) {
          _callbacks.onOpenComp?.(newComp);
        } else {
          renderCompList();
        }
      } catch (err) {
        window.desktopApi.showError?.("Import Failed", err.message || "Failed to decode comp AxiCode.");
      }
      return;
    }

    // Fall back to JSON paste
    const parsed = JSON.parse(trimmed);
    const comps = Array.isArray(parsed) ? parsed : [parsed];
    for (const comp of comps) {
      if (!comp.name) continue;
      const { id, createdAt, updatedAt, ...rest } = comp;
      await window.desktopApi.saveComp(rest);
    }
    state.comps = await window.desktopApi.listComps();
    renderCompList();
  } catch {
    // Not valid JSON or comp code — ignore silently
  }
}
