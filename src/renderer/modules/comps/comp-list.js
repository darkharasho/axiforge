// Comp list module — renders the comp list page with two-tier toolbar, rich card rows,
// filtering (search, game mode, publish status, tags), bulk selection, and view toggle.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { compIcon } from "../library/heroicons.js";
import { getProfessionSvg } from "../profession-icons.js";
import { getEliteSpecName, profClass } from "../build-helpers.js";
import { computeCompPartyCoverage } from "./comp-boon-coverage.js";
import { BOON_DISPLAY_ORDER } from "../constants.js";

// ─── Shared folder helpers ───────────────────────────────────────────────────

function _isCompShared(comp) {
  if (!comp.folderId) return false;
  let current = (state.folders || []).find((f) => f.id === comp.folderId);
  while (current) {
    if (current.shared) return true;
    if (!current.parentId) return false;
    current = (state.folders || []).find((f) => f.id === current.parentId);
  }
  return false;
}

// ─── Module-level state (not persisted) ──────────────────────────────────────

let _activeCtxMenu = null;
let _callbacks = {};

/** Bulk selection: Set of selected comp IDs. Cleared on page nav or Cancel. */
const _selectedIds = new Set();

/** Boon coverage cache: compId → { percentage: number, hash: string } */
const _boonCache = new Map();

// Profession hex colors (matching existing lib-prof-- CSS classes)
const PROF_COLORS = {
  guardian: "#6ea8ff", warrior: "#ff9944", necromancer: "#4dca7a",
  engineer: "#cc8844", ranger: "#77cc55", thief: "#cc6677",
  mesmer: "#b07acc", elementalist: "#dd5555", revenant: "#aa6655",
};

// ─── Init / Public API ───────────────────────────────────────────────────────

/**
 * Store callbacks for comp list actions.
 * @param {{ onOpenComp, onNewComp, onDeleteComp, onRenameComp, onDuplicateComp,
 *           onDeleteComps, onAddTags, onRemoveTags, onExportComps, getCatalog }} callbacks
 */
export function initCompList(callbacks) {
  _callbacks = callbacks || {};
}

/** Clear bulk selection (called on page navigation). */
export function clearCompSelection() {
  _selectedIds.clear();
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
  const allTags = collectAllTags();
  const anySelected = _selectedIds.size > 0;

  container.innerHTML = `
    ${anySelected ? renderBulkBar() : renderToolbarTier1(searchVal, prefs)}
    ${!anySelected && prefs.filtersExpanded ? renderToolbarTier2(prefs, allTags) : ""}
    <div class="comp-list-body">
      ${comps.length > 0
        ? comps.map((c) => prefs.viewMode === "compact" ? renderCompactRow(c) : renderExpandedRow(c)).join("")
        : renderEmptyState()}
    </div>
  `;

  bindListEvents(container);

  // Kick off async boon coverage computation for visible comps
  for (const comp of comps) {
    computeBoonCoverageAsync(comp);
  }
}

// ─── Filtering / Sorting ──────────────────────────────────────────────────────

function getVisibleComps() {
  let comps = [...state.comps];

  // Text search
  const search = (state.compSearch || "").trim().toLowerCase();
  if (search) {
    comps = comps.filter((c) => (c.name || "").toLowerCase().includes(search));
  }

  // Tag filters (OR logic)
  const activeTags = state.compPrefs.activeFilters?.tags || [];
  if (activeTags.length > 0) {
    comps = comps.filter((c) => {
      const compTags = c.tags || [];
      return activeTags.some((t) => compTags.includes(t));
    });
  }

  // Game mode filter
  const gm = state.compPrefs.activeFilters?.gameMode;
  if (gm) {
    comps = comps.filter((c) => c.gameMode === gm);
  }

  // Publish status filter
  const ps = state.compPrefs.activeFilters?.publishStatus;
  if (ps === "published") {
    comps = comps.filter((c) => !!c.publishedFileId);
  } else if (ps === "draft") {
    comps = comps.filter((c) => !c.publishedFileId);
  }

  // Sort
  const { sortField, sortDirection } = state.compPrefs;
  const dir = sortDirection === "asc" ? 1 : -1;
  comps.sort((a, b) => {
    if (sortField === "name") return dir * (a.name || "").localeCompare(b.name || "");
    if (sortField === "createdAt") return dir * (new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    if (sortField === "updatedAt") return dir * (new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));
    return 0;
  });

  return comps;
}

// ─── Toolbar Tier 1 ──────────────────────────────────────────────────────────

function renderToolbarTier1(searchVal, prefs) {
  const hasActiveFilter = prefs.activeFilters?.gameMode || prefs.activeFilters?.publishStatus
    || (prefs.activeFilters?.tags || []).length > 0;
  const filtersActive = prefs.filtersExpanded || hasActiveFilter;

  return `
    <div class="comp-list-toolbar">
      <div class="comp-list-toolbar__left">
        <button type="button" id="comp-new-btn" class="btn btn-primary comp-list-toolbar__new-btn">+ New Comp</button>
        <div class="comp-list-toolbar__search">
          <input type="search" id="comp-search-input" class="comp-list-toolbar__search-input"
            placeholder="Search comps\u2026" value="${searchVal}" autocomplete="off" />
        </div>
      </div>
      <div class="comp-list-toolbar__right">
        <button type="button" id="comp-filters-toggle" class="comp-list-toolbar__filters-btn ${filtersActive ? "comp-list-toolbar__filters-btn--active" : ""}"
          title="Toggle filters">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 0 1 .628.74v2.288a2.25 2.25 0 0 1-.659 1.59l-4.682 4.683a2.25 2.25 0 0 0-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 0 1 8 18.25v-5.757a2.25 2.25 0 0 0-.659-1.591L2.659 6.22A2.25 2.25 0 0 1 2 4.629V2.34a.75.75 0 0 1 .628-.74Z" clip-rule="evenodd"/></svg>
        </button>
        <div class="comp-list-toolbar__view-toggle">
          <button type="button" class="comp-list-toolbar__view-btn ${prefs.viewMode === "expanded" ? "comp-list-toolbar__view-btn--active" : ""}"
            data-view-mode="expanded" title="Expanded view">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M2 3.75A.75.75 0 0 1 2.75 3h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75Zm0 4.167a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Zm0 4.166a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Zm0 4.167a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/></svg>
          </button>
          <button type="button" class="comp-list-toolbar__view-btn ${prefs.viewMode === "compact" ? "comp-list-toolbar__view-btn--active" : ""}"
            data-view-mode="compact" title="Compact view">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clip-rule="evenodd"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Toolbar Tier 2 (collapsible filters) ────────────────────────────────────

function renderToolbarTier2(prefs, allTags) {
  const gm = prefs.activeFilters?.gameMode || "";
  const ps = prefs.activeFilters?.publishStatus || "";
  const activeTags = prefs.activeFilters?.tags || [];

  const tagChips = allTags.map((tag) => {
    const active = activeTags.includes(tag);
    return `<button type="button" class="comp-tag-chip ${active ? "comp-tag-chip--active" : ""}" data-tag-filter="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  }).join("");

  return `
    <div class="comp-list-filters">
      <div class="comp-list-filters__left">
        <div class="comp-list-filters__group">
          <label class="comp-list-filters__label">MODE</label>
          <select id="comp-filter-mode" class="comp-list-filters__select">
            <option value="" ${gm === "" ? "selected" : ""}>All</option>
            <option value="pve" ${gm === "pve" ? "selected" : ""}>PvE</option>
            <option value="wvw" ${gm === "wvw" ? "selected" : ""}>WvW</option>
          </select>
        </div>
        <div class="comp-list-filters__group">
          <label class="comp-list-filters__label">STATUS</label>
          <select id="comp-filter-status" class="comp-list-filters__select">
            <option value="" ${ps === "" ? "selected" : ""}>All</option>
            <option value="published" ${ps === "published" ? "selected" : ""}>Published</option>
            <option value="draft" ${ps === "draft" ? "selected" : ""}>Draft</option>
          </select>
        </div>
        <div class="comp-list-filters__group">
          <label class="comp-list-filters__label">SORT</label>
          <div class="comp-list-filters__sort-row">
            <select id="comp-sort-select" class="comp-list-filters__select">
              <option value="updatedAt" ${prefs.sortField === "updatedAt" ? "selected" : ""}>Last Updated</option>
              <option value="createdAt" ${prefs.sortField === "createdAt" ? "selected" : ""}>Date Created</option>
              <option value="name" ${prefs.sortField === "name" ? "selected" : ""}>Name</option>
            </select>
            <button type="button" id="comp-sort-dir-btn" class="comp-list-filters__sort-dir" title="Toggle sort direction">
              ${prefs.sortDirection === "asc" ? "\u2191" : "\u2193"}
            </button>
          </div>
        </div>
      </div>
      ${allTags.length > 0 ? `
        <div class="comp-list-filters__right">
          <label class="comp-list-filters__label">TAGS</label>
          <div class="comp-list-filters__tags">${tagChips}</div>
        </div>
      ` : ""}
    </div>
  `;
}

// ─── Bulk Selection Bar ──────────────────────────────────────────────────────

function renderBulkBar() {
  const count = _selectedIds.size;
  const total = state.comps.length;
  const allSelected = count === total && total > 0;

  return `
    <div class="comp-list-bulk-bar">
      <div class="comp-list-bulk-bar__left">
        <input type="checkbox" id="comp-bulk-master" class="comp-list-bulk-bar__master"
          ${allSelected ? "checked" : ""} ${count > 0 && !allSelected ? 'data-indeterminate="true"' : ""} />
        <span class="comp-list-bulk-bar__count">${count} selected</span>
      </div>
      <div class="comp-list-bulk-bar__right">
        <button type="button" class="comp-list-bulk-bar__btn" data-bulk-action="tag">Tag</button>
        <button type="button" class="comp-list-bulk-bar__btn" data-bulk-action="export">Export</button>
        <button type="button" class="comp-list-bulk-bar__btn comp-list-bulk-bar__btn--danger" data-bulk-action="delete">Delete</button>
        <button type="button" class="comp-list-bulk-bar__btn comp-list-bulk-bar__btn--cancel" data-bulk-action="cancel">Cancel</button>
      </div>
    </div>
  `;
}

// ─── Row Rendering — Expanded ────────────────────────────────────────────────

function renderExpandedRow(comp) {
  const name = escapeHtml(comp.name || "Untitled Comp");
  const checked = _selectedIds.has(comp.id) ? "checked" : "";
  const selectedClass = _selectedIds.has(comp.id) ? " comp-list-row--selected" : "";

  // Game mode badge
  const gmBadge = comp.gameMode === "pve"
    ? `<span class="comp-badge comp-badge--pve">PvE</span>`
    : comp.gameMode === "wvw"
      ? `<span class="comp-badge comp-badge--wvw">WvW</span>`
      : "";

  // Publish status badge
  const pubBadge = comp.publishedFileId
    ? `<span class="comp-badge comp-badge--published">Published</span>`
    : `<span class="comp-badge comp-badge--draft">Draft</span>`;

  // Shared badge
  const sharedBadge = _isCompShared(comp)
    ? `<span class="comp-badge comp-badge--shared">Shared</span>`
    : "";

  // Relative timestamp
  const timeStr = relativeTime(comp.updatedAt);

  // Profession icons
  const profIcons = renderProfessionIcons(comp);

  // Party/slot summary
  const partySummary = getPartySummary(comp);

  // Boon coverage (may be cached or placeholder)
  const boonHtml = renderBoonIndicator(comp.id);

  // Tags
  const tags = (comp.tags || [])
    .map((t) => `<span class="comp-list-row__tag">${escapeHtml(t)}</span>`)
    .join("");

  return `
    <div class="comp-list-row comp-list-row--expanded${selectedClass}" data-comp-id="${escapeHtml(comp.id)}">
      <div class="comp-list-row__top">
        <input type="checkbox" class="comp-list-row__checkbox" data-comp-check="${escapeHtml(comp.id)}" ${checked} />
        <span class="comp-list-row__name">${name}</span>
        ${gmBadge}
        ${pubBadge}
        ${sharedBadge}
        <span class="comp-list-row__spacer"></span>
        <span class="comp-list-row__time">${timeStr}</span>
      </div>
      <div class="comp-list-row__bottom">
        <div class="comp-list-row__prof-icons">${profIcons}</div>
        <span class="comp-list-row__pipe">|</span>
        <span class="comp-list-row__summary">${partySummary}</span>
        <span class="comp-list-row__pipe">|</span>
        ${boonHtml}
        <span class="comp-list-row__tags-right">${tags}</span>
      </div>
    </div>
  `;
}

// ─── Row Rendering — Compact ─────────────────────────────────────────────────

function renderCompactRow(comp) {
  const name = escapeHtml(comp.name || "Untitled Comp");
  const checked = _selectedIds.has(comp.id) ? "checked" : "";
  const selectedClass = _selectedIds.has(comp.id) ? " comp-list-row--selected" : "";

  const gmBadge = comp.gameMode === "pve"
    ? `<span class="comp-badge comp-badge--pve comp-badge--sm">PvE</span>`
    : comp.gameMode === "wvw"
      ? `<span class="comp-badge comp-badge--wvw comp-badge--sm">WvW</span>`
      : "";

  const pubBadge = comp.publishedFileId
    ? `<span class="comp-badge comp-badge--published comp-badge--sm">Published</span>`
    : `<span class="comp-badge comp-badge--draft comp-badge--sm">Draft</span>`;

  const sharedBadge = _isCompShared(comp)
    ? `<span class="comp-badge comp-badge--shared comp-badge--sm">Shared</span>`
    : "";

  const partySummary = getPartySummary(comp);
  const boonHtml = renderBoonIndicator(comp.id);
  const timeStr = relativeTime(comp.updatedAt);

  return `
    <div class="comp-list-row comp-list-row--compact${selectedClass}" data-comp-id="${escapeHtml(comp.id)}">
      <input type="checkbox" class="comp-list-row__checkbox" data-comp-check="${escapeHtml(comp.id)}" ${checked} />
      <span class="comp-list-row__name">${name}</span>
      ${gmBadge}
      ${pubBadge}
      ${sharedBadge}
      <span class="comp-list-row__summary comp-list-row__summary--compact">${partySummary}</span>
      ${boonHtml}
      <span class="comp-list-row__spacer"></span>
      <span class="comp-list-row__time">${timeStr}</span>
    </div>
  `;
}

// ─── Row Data Helpers ────────────────────────────────────────────────────────

function renderProfessionIcons(comp) {
  const specs = [];
  const seen = new Set();
  const lines = comp.partyLines || [];
  for (const line of lines) {
    for (const slotBuildId of (line.slots || [])) {
      if (!slotBuildId) continue;
      const build = state.builds.find((b) => b.id === slotBuildId);
      if (!build) continue;
      const eliteSpec = getEliteSpecName(build);
      const specName = eliteSpec || build.profession;
      if (!specName || seen.has(specName)) continue;
      seen.add(specName);
      specs.push({ specName, profession: build.profession });
      if (specs.length >= 5) break;
    }
    if (specs.length >= 5) break;
  }

  const totalUnique = countUniqueSpecs(comp);
  const overflow = totalUnique > 5 ? `<span class="comp-list-row__prof-overflow">+${totalUnique - 5}</span>` : "";

  if (specs.length === 0) {
    return `<span class="comp-list-row__prof-empty"></span>`;
  }

  const icons = specs.map(({ specName, profession }) => {
    const svg = getProfessionSvg(specName) || getProfessionSvg(profession) || "";
    const color = PROF_COLORS[(profession || "").toLowerCase()] || "#888";
    return `<span class="comp-list-row__prof-icon ${profClass(profession)}" style="background:${color}" title="${escapeHtml(specName)}">${svg}</span>`;
  }).join("");

  return icons + overflow;
}

function countUniqueSpecs(comp) {
  const seen = new Set();
  for (const line of (comp.partyLines || [])) {
    for (const slotBuildId of (line.slots || [])) {
      if (!slotBuildId) continue;
      const build = state.builds.find((b) => b.id === slotBuildId);
      if (!build) continue;
      const eliteSpec = getEliteSpecName(build);
      seen.add(eliteSpec || build.profession);
    }
  }
  return seen.size;
}

function getPartySummary(comp) {
  const lines = comp.partyLines || [];
  const parties = lines.length;
  const slots = lines.reduce((sum, l) => sum + (l.capacity || 0), 0);
  const partyWord = parties === 1 ? "party" : "parties";
  const slotWord = slots === 1 ? "slot" : "slots";
  return `${parties} ${partyWord} &middot; ${slots} ${slotWord}`;
}

function renderBoonIndicator(compId) {
  const cached = _boonCache.get(compId);
  if (!cached) {
    return `<span class="comp-list-row__boon" data-boon-id="${compId}"><span class="comp-list-row__boon-dot comp-list-row__boon-dot--none"></span><span class="comp-list-row__boon-pct">--</span></span>`;
  }
  const pct = cached.percentage;
  let colorClass;
  if (pct >= 80) colorClass = "comp-list-row__boon-dot--green";
  else if (pct >= 50) colorClass = "comp-list-row__boon-dot--yellow";
  else colorClass = "comp-list-row__boon-dot--red";

  let textColor;
  if (pct >= 80) textColor = "#4caf50";
  else if (pct >= 50) textColor = "#ffc107";
  else textColor = "#f44336";

  return `<span class="comp-list-row__boon" data-boon-id="${compId}"><span class="comp-list-row__boon-dot ${colorClass}"></span><span class="comp-list-row__boon-pct" style="color:${textColor}">${pct}%</span></span>`;
}

// ─── Boon Coverage Async Cache ───────────────────────────────────────────────

function computeBuildHash(comp) {
  const ids = [];
  for (const line of (comp.partyLines || [])) {
    for (const slotId of (line.slots || [])) {
      ids.push(slotId || "");
    }
  }
  return ids.join(",");
}

async function computeBoonCoverageAsync(comp) {
  const hash = computeBuildHash(comp);
  const cached = _boonCache.get(comp.id);
  if (cached && cached.hash === hash) return; // still valid

  try {
    const builds = state.builds || [];
    const catalogCache = state.catalogCache;
    if (!state.upgradeCatalog) {
      state.upgradeCatalog = await window.desktopApi.getUpgradeCatalog();
    }

    const result = await computeCompPartyCoverage(comp, builds, catalogCache, _callbacks.getCatalog, state.upgradeCatalog);
    if (!result || !result.lines) {
      _boonCache.set(comp.id, { percentage: 0, hash });
    } else {
      // Aggregate boon coverage across all lines (union of covered boons)
      const coveredBoons = new Set();
      for (const line of result.lines) {
        if (!line.hasFilledSlots) continue;
        for (const boon of BOON_DISPLAY_ORDER) {
          const entry = line.boons.get(boon);
          if (entry && entry.count > 0) coveredBoons.add(boon);
        }
      }
      const percentage = Math.round((coveredBoons.size / BOON_DISPLAY_ORDER.length) * 100);
      _boonCache.set(comp.id, { percentage, hash });
    }
  } catch {
    _boonCache.set(comp.id, { percentage: 0, hash });
  }

  // Update the DOM element in-place (avoid full re-render)
  const el = document.querySelector(`[data-boon-id="${comp.id}"]`);
  if (el) {
    const cached2 = _boonCache.get(comp.id);
    const pct = cached2.percentage;
    let dotClass, textColor;
    if (pct >= 80) { dotClass = "comp-list-row__boon-dot--green"; textColor = "#4caf50"; }
    else if (pct >= 50) { dotClass = "comp-list-row__boon-dot--yellow"; textColor = "#ffc107"; }
    else { dotClass = "comp-list-row__boon-dot--red"; textColor = "#f44336"; }
    el.innerHTML = `<span class="comp-list-row__boon-dot ${dotClass}"></span><span class="comp-list-row__boon-pct" style="color:${textColor}">${pct}%</span>`;
  }
}

// ─── Relative Timestamps ─────────────────────────────────────────────────────

function relativeTime(isoStr) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 6) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks <= 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function renderEmptyState() {
  const hasSearch = (state.compSearch || "").trim().length > 0;
  const hasFilter = state.compPrefs.activeFilters?.gameMode
    || state.compPrefs.activeFilters?.publishStatus
    || (state.compPrefs.activeFilters?.tags || []).length > 0;

  if (hasSearch || hasFilter) {
    return `
      <div class="comp-list-empty">
        <div class="comp-list-empty__title">No comps match your filters</div>
        <div class="comp-list-empty__sub">Try adjusting your filters or search</div>
        <button type="button" id="comp-clear-filters-btn" class="comp-list-empty__btn">Clear Filters</button>
      </div>
    `;
  }

  return `
    <div class="comp-list-empty">
      <div class="comp-list-empty__title">No compositions yet</div>
      <div class="comp-list-empty__sub">Create your first comp to organize builds into party groups</div>
      <button type="button" id="comp-empty-new-btn" class="btn btn-primary comp-list-toolbar__new-btn">+ New Comp</button>
    </div>
  `;
}

// ─── Collect Tags ────────────────────────────────────────────────────────────

function collectAllTags() {
  const tagSet = new Set();
  for (const c of state.comps) {
    if (c.tags) for (const t of c.tags) tagSet.add(t);
  }
  return [...tagSet].sort();
}

// ─── Event Binding ───────────────────────────────────────────────────────────

function bindListEvents(container) {
  // New Comp buttons
  const newBtn = container.querySelector("#comp-new-btn");
  if (newBtn) newBtn.addEventListener("click", () => _callbacks.onNewComp?.());
  const emptyNewBtn = container.querySelector("#comp-empty-new-btn");
  if (emptyNewBtn) emptyNewBtn.addEventListener("click", () => _callbacks.onNewComp?.());

  // Clear filters (from empty state)
  const clearFiltersBtn = container.querySelector("#comp-clear-filters-btn");
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      state.compSearch = "";
      state.compPrefs.activeFilters = { gameMode: null, publishStatus: null, tags: [] };
      renderCompList();
    });
  }

  // Search input
  const searchInput = container.querySelector("#comp-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.compSearch = e.target.value;
      const cursorPos = e.target.selectionStart;
      renderCompList();
      const newInput = document.getElementById("comp-search-input");
      if (newInput) { newInput.focus(); newInput.setSelectionRange(cursorPos, cursorPos); }
    });
  }

  // Filters toggle
  const filtersToggle = container.querySelector("#comp-filters-toggle");
  if (filtersToggle) {
    filtersToggle.addEventListener("click", () => {
      state.compPrefs.filtersExpanded = !state.compPrefs.filtersExpanded;
      renderCompList();
    });
  }

  // View toggle
  container.querySelectorAll("[data-view-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.compPrefs.viewMode = btn.dataset.viewMode;
      renderCompList();
    });
  });

  // Tier 2 filters
  const modeSelect = container.querySelector("#comp-filter-mode");
  if (modeSelect) {
    modeSelect.addEventListener("change", (e) => {
      state.compPrefs.activeFilters.gameMode = e.target.value || null;
      renderCompList();
    });
  }

  const statusSelect = container.querySelector("#comp-filter-status");
  if (statusSelect) {
    statusSelect.addEventListener("change", (e) => {
      state.compPrefs.activeFilters.publishStatus = e.target.value || null;
      renderCompList();
    });
  }

  const sortSelect = container.querySelector("#comp-sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      state.compPrefs.sortField = e.target.value;
      renderCompList();
    });
  }

  const sortDirBtn = container.querySelector("#comp-sort-dir-btn");
  if (sortDirBtn) {
    sortDirBtn.addEventListener("click", () => {
      state.compPrefs.sortDirection = state.compPrefs.sortDirection === "asc" ? "desc" : "asc";
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
        state.compPrefs.activeFilters.tags = [...current, tag];
      }
      renderCompList();
    });
  });

  // Checkboxes (bulk selection)
  container.querySelectorAll("[data-comp-check]").forEach((cb) => {
    cb.addEventListener("click", (e) => {
      e.stopPropagation(); // don't open comp
      const compId = cb.dataset.compCheck;
      if (cb.checked) _selectedIds.add(compId);
      else _selectedIds.delete(compId);
      renderCompList();
    });
  });

  // Bulk bar events
  bindBulkBarEvents(container);

  // Comp row click — open comp (but not on checkbox)
  container.querySelectorAll(".comp-list-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-comp-check]")) return;
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
      if (e.target.closest(".comp-list-row")) return;
      e.preventDefault();
      showEmptyCtxMenu(e.clientX, e.clientY);
    });
  }

  // Set indeterminate state on master checkbox (can't do via HTML attribute)
  const master = container.querySelector("#comp-bulk-master");
  if (master && master.dataset.indeterminate === "true") {
    master.indeterminate = true;
  }
}

function bindBulkBarEvents(container) {
  // Master checkbox
  const master = container.querySelector("#comp-bulk-master");
  if (master) {
    master.addEventListener("change", () => {
      if (master.checked) {
        for (const c of state.comps) _selectedIds.add(c.id);
      } else {
        _selectedIds.clear();
      }
      renderCompList();
    });
  }

  // Bulk action buttons
  container.querySelectorAll("[data-bulk-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.bulkAction;
      const ids = [..._selectedIds];
      if (action === "cancel") {
        _selectedIds.clear();
        renderCompList();
      } else if (action === "delete") {
        _callbacks.onDeleteComps?.(ids);
      } else if (action === "export") {
        _callbacks.onExportComps?.(ids);
      } else if (action === "tag") {
        showBulkTagPopover(btn, ids);
      }
    });
  });
}

// ─── Bulk Tag Popover ────────────────────────────────────────────────────────

function showBulkTagPopover(anchor, ids) {
  // Close any existing popover
  document.querySelector(".comp-bulk-tag-popover")?.remove();

  const allTags = collectAllTags();
  const popover = document.createElement("div");
  popover.className = "comp-bulk-tag-popover";

  // Determine which tags are on ALL selected comps
  const selectedComps = state.comps.filter((c) => ids.includes(c.id));
  const tagPresence = {};
  for (const tag of allTags) {
    tagPresence[tag] = selectedComps.every((c) => (c.tags || []).includes(tag));
  }

  popover.innerHTML = `
    <div class="comp-bulk-tag-popover__header">Manage Tags</div>
    <div class="comp-bulk-tag-popover__list">
      ${allTags.map((t) => `
        <label class="comp-bulk-tag-popover__item">
          <input type="checkbox" data-bulk-tag="${escapeHtml(t)}" ${tagPresence[t] ? "checked" : ""} />
          <span>${escapeHtml(t)}</span>
        </label>
      `).join("")}
    </div>
    <div class="comp-bulk-tag-popover__add">
      <input type="text" placeholder="New tag\u2026" class="comp-bulk-tag-popover__input" />
      <button type="button" class="comp-bulk-tag-popover__add-btn">Add</button>
    </div>
  `;

  // Position below anchor
  const rect = anchor.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${rect.left}px`;
  popover.style.zIndex = "9999";
  document.body.appendChild(popover);

  // Tag toggle handlers
  popover.querySelectorAll("[data-bulk-tag]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const tag = cb.dataset.bulkTag;
      if (cb.checked) {
        await _callbacks.onAddTags?.(ids, [tag]);
      } else {
        await _callbacks.onRemoveTags?.(ids, [tag]);
      }
    });
  });

  // Add new tag
  const addBtn = popover.querySelector(".comp-bulk-tag-popover__add-btn");
  const addInput = popover.querySelector(".comp-bulk-tag-popover__input");
  if (addBtn && addInput) {
    const doAdd = async () => {
      const tag = addInput.value.trim();
      if (!tag) return;
      await _callbacks.onAddTags?.(ids, [tag]);
      addInput.value = "";
    };
    addBtn.addEventListener("click", doAdd);
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
  }

  // Close on click outside
  const onOutside = (e) => {
    if (!popover.contains(e.target) && e.target !== anchor) {
      popover.remove();
      document.removeEventListener("mousedown", onOutside);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", onOutside), 0);
}

// ─── Context Menu ────────────────────────────────────────────────────────────

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

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;

  _activeCtxMenu = menu;

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
