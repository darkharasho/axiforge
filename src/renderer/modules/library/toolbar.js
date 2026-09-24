// Library toolbar module — renders search, sort, view toggle, breadcrumb, and filter chips.

import { state } from "../state.js";
import { escapeHtml, formatRelativeTime } from "../utils.js";
import { getProfessionSvg } from "../profession-icons.js";
import { libraryBuilds } from "./folder-store.js";
import { writeDeniedReason, currentFolderId } from "./access.js";
// One folder-ancestor walker for the whole renderer. There used to be three
// near-identical copies (here, content.js, comp-detail.js) and only some of
// them guarded against a parent cycle.
import { folderChain as buildFolderChain } from "../build-sources.js";
import {
  magnifyingGlassIcon,
  plusIcon,
  bars3Icon,
  tableIcon,
  squaresIcon,
  squaresMiniIcon,
  viewColumnsIcon,
  chevronDownIcon,
  homeIcon,
  xMarkIcon,
  arrowDownTrayIcon,
  arrowUpTrayIcon,
  linkIcon,
  axiforgeIcon,
  compPlusIcon,
  documentPlusIcon,
  folderPlusIcon,
  funnelIcon,
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
  // The nodes any open picker's scroll/resize listeners close over are about
  // to be discarded below; nothing calls setOpen(false) for a destroyed
  // node, so this has to close them first.
  _closeAllPickers();

  const prefs = state.libraryPrefs;
  const searchVal = escapeHtml(state.buildSearch || "");
  const insideComp = state.currentFolder?.type === "comp";
  // New and Import both land in the folder you are standing in, so in a
  // read-only shared folder they are refusals waiting to happen. Export is not
  // gated: reading out what you can already see takes nothing from the team.
  const writeTip = writeDeniedReason(currentFolderId());
  const writeAttrs = writeTip ? ` disabled title="${escapeHtml(writeTip)}"` : "";

  // The trash and the archive bypass the view modes entirely (see
  // renderContent), so every control here is inert in them: search filters
  // nothing, sorting reorders nothing, the view toggle switches between
  // renderers that never run, and New/Import/Export act on a library you are
  // not currently looking at. Worse, typing in the search box left
  // state.buildSearch set with no visible effect until you navigated back out
  // and found the library mysteriously filtered. Show the breadcrumb alone.
  if (isListlessView()) {
    container.innerHTML = `
      <div class="lib-toolbar__breadcrumb">
        ${renderBreadcrumb()}
      </div>
    `;
    bindToolbarEvents(container);
    return;
  }

  container.innerHTML = `
    <div class="lib-toolbar__breadcrumb">
      ${renderBreadcrumb()}
    </div>
    <div class="lib-toolbar__controls">
      <div class="lib-toolbar__search axi-search">
        <span class="axi-search__icon">${magnifyingGlassIcon}</span>
        <input
          type="search"
          id="lib-search-input"
          class="lib-toolbar__search-input axi-input"
          placeholder="Search builds…"
          value="${searchVal}"
          autocomplete="off"
        />
      </div>
      ${renderSortPicker(prefs.sortField)}
      <div class="lib-toolbar__view-toggle" role="group" aria-label="View mode">
        ${renderViewToggle(prefs.viewMode)}
      </div>
      <div class="axi-picker af-libpicker" id="lib-import-dropdown">
        <button type="button" id="lib-import-btn" class="axi-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="lib-import-menu"${writeAttrs}>
          ${arrowDownTrayIcon} Import
        </button>
        <div class="axi-picker__pop axi-picker__pop--fixed lib-toolbar__picker-pop" id="lib-import-menu" role="menu" hidden>
          <button type="button" class="axi-picker__opt" role="menuitem" data-import-type="chatlink">
            ${linkIcon} Build Link
          </button>
          <button type="button" class="axi-picker__opt" role="menuitem" data-import-type="gw2skills">
            ${arrowDownTrayIcon} GW2Skills
          </button>
          <button type="button" class="axi-picker__opt" role="menuitem" data-import-type="axilink">
            ${linkIcon} AxiForge Link
          </button>
          <button type="button" class="axi-picker__opt" role="menuitem" data-import-type="sharecode">
            ${axiforgeIcon} AxiCode
          </button>
          <div class="af-menu-sep"></div>
          <button type="button" class="axi-picker__opt" role="menuitem" data-import-type="axicode-file">
            ${arrowDownTrayIcon} .axicode File
          </button>
        </div>
      </div>
      <div class="axi-picker af-libpicker" id="lib-export-dropdown">
        <button type="button" id="lib-export-btn" class="axi-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="lib-export-menu">
          ${arrowUpTrayIcon} Export
        </button>
        <div class="axi-picker__pop axi-picker__pop--fixed lib-toolbar__picker-pop" id="lib-export-menu" role="menu" hidden>
          <button type="button" class="axi-picker__opt" role="menuitem" data-export-type="all">
            ${arrowUpTrayIcon} Export All (.axicode)
          </button>
        </div>
      </div>
      <div class="axi-picker af-libpicker" id="lib-new-dropdown">
        <button type="button" id="lib-new-btn" class="axi-btn axi-btn--primary" aria-haspopup="menu" aria-expanded="false" aria-controls="lib-new-menu"${writeAttrs}>
          ${plusIcon} New
        </button>
        <div class="axi-picker__pop axi-picker__pop--fixed lib-toolbar__picker-pop" id="lib-new-menu" role="menu" hidden>
          <button type="button" class="axi-picker__opt" role="menuitem" data-new-type="build">
            ${documentPlusIcon} New Build
          </button>
          ${insideComp ? "" : `<button type="button" class="axi-picker__opt" role="menuitem" data-new-type="folder">
            ${folderPlusIcon} New Folder
          </button>
          <button type="button" class="axi-picker__opt" role="menuitem" data-new-type="comp">
            ${compPlusIcon} New Comp
          </button>`}
        </div>
      </div>
    </div>
  `;

  bindToolbarEvents(container);
}

/** field → the label the closed sort picker shows. */
const SORT_FIELDS = [
  { value: "sortOrder", label: "Custom" },
  { value: "updatedAt", label: "Last Modified" },
  { value: "createdAt", label: "Created" },
  { value: "title", label: "A–Z" },
  { value: "profession", label: "Profession" },
];

function renderSortPicker(activeField) {
  const active = SORT_FIELDS.find((f) => f.value === activeField) || SORT_FIELDS[0];
  const opts = SORT_FIELDS.map(
    (f) => `<button type="button" class="axi-picker__opt" role="option" data-sort-field="${f.value}" aria-selected="${f.value === active.value}">${f.label}</button>`
  ).join("");
  return `
    <div class="axi-picker af-libpicker lib-toolbar__sort" id="lib-sort-picker">
      <button type="button" class="axi-picker__btn" id="lib-sort-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="lib-sort-pop">${active.label}</button>
      <div class="axi-picker__pop axi-picker__pop--fixed" id="lib-sort-pop" role="listbox" hidden>${opts}</div>
    </div>
  `;
}

/**
 * Views that hold records the library's list renderers never draw — the trash
 * and the archive. @see renderToolbar
 */
function isListlessView() {
  const type = state.currentFolder?.type;
  return type === "trash" || type === "archive";
}

/**
 * Render filter dropdowns into #lib-filters.
 */
export function renderFilters() {
  const container = document.getElementById("lib-filters");
  if (!container) return;
  // Same reason as renderToolbar(): close before the nodes underneath any
  // open picker's listeners are discarded.
  _closeAllPickers();

  // Same reason as the toolbar controls: a Class/Mode/Tags filter cannot narrow
  // a list that is not being drawn from libraryBuilds() in the first place.
  if (isListlessView()) {
    container.innerHTML = "";
    return;
  }

  const activeFilters = state.libraryPrefs.activeFilters || {};

  // Collect unique professions and their elite specs from builds
  const profMap = new Map(); // profession → Set of elite specs
  // Facets come from what is actually browsable. A filter offering a profession
  // that only archived builds have would come back empty every time.
  const builds = libraryBuilds();
  for (const b of builds) {
    if (!b.profession) continue;
    if (!profMap.has(b.profession)) profMap.set(b.profession, new Set());
    const spec = _getEliteSpec(b);
    if (spec) profMap.get(b.profession).add(spec);
  }
  const professions = [...profMap.keys()].sort();

  const gameModes = [...new Set(builds.map((b) => b.gameMode || "pve").filter(Boolean))].sort();
  const tags = [...new Set(builds.flatMap((b) => b.tags || []).filter(Boolean))].sort();

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
      items += `<button type="button" class="axi-picker__opt" role="option" aria-selected="${profActive}" data-filter-type="professions" data-filter-value="${escapeHtml(prof)}">
        <span class="lib-fd__icon lib-fd__icon--prof">${svg}</span>
        <span class="lib-fd__label">${escapeHtml(prof)}</span>
      </button>`;

      // Elite specs under this profession
      const specs = [...(profMap.get(prof) || [])].sort();
      for (const spec of specs) {
        const specActive = selectedSpecs.includes(spec);
        const specSvg = getProfessionSvg(spec) || "";
        items += `<button type="button" class="axi-picker__opt lib-fd__item--indent" role="option" aria-selected="${specActive}" data-filter-type="eliteSpecs" data-filter-value="${escapeHtml(spec)}">
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
      items += `<button type="button" class="axi-picker__opt" role="option" aria-selected="${active}" data-filter-type="gameModes" data-filter-value="${escapeHtml(mode)}">
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
      items += `<button type="button" class="axi-picker__opt" role="option" aria-selected="${active}" data-filter-type="tags" data-filter-value="${escapeHtml(tag)}">
        <span class="lib-fd__label">${escapeHtml(tag)}</span>
      </button>`;
    }

    dropdowns.push(_renderDropdown("tags-filter", label, items, count > 0));
  }

  // Clear all button
  const hasActiveFilter = _hasAnyFilter(activeFilters);
  const clearBtn = hasActiveFilter
    ? `<button type="button" class="axi-btn axi-btn--ghost" data-filter-clear="1">${xMarkIcon} Clear</button>`
    : "";
  const saveBtn = hasActiveFilter
    ? `<button type="button" class="axi-btn axi-btn--ghost" data-filter-save-smart="1">${funnelIcon} Save as smart folder</button>`
    : "";

  container.innerHTML = `<div class="lib-filters__bar">${dropdowns.join("")}${clearBtn}${saveBtn}</div>`;

  bindFilterEvents(container);
}

function _renderDropdown(id, label, items, hasActive) {
  const popId = `lib-fd-pop-${id}`;
  return `<div class="axi-picker af-libpicker lib-fd" data-dropdown="${id}">
    <button type="button" class="axi-picker__btn lib-fd__trigger${hasActive ? " lib-fd__trigger--active" : ""}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${popId}">
      <span>${label}</span>${chevronDownIcon}
    </button>
    <div class="axi-picker__pop axi-picker__pop--fixed" id="${popId}" role="listbox" aria-multiselectable="true" hidden>${items}</div>
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

/**
 * The toolbar filters as a smart folder rule.
 *
 * The rule vocabulary was designed as a superset of these four filters, so the
 * mapping is direct -- which is the point: people filter first and then wish it
 * had stuck.
 */
export function filtersToRule(activeFilters) {
  const f = activeFilters || {};
  const children = [];
  const push = (field, op, value) => {
    if (Array.isArray(value) && value.length > 0) {
      children.push({ type: "condition", field, op, value: [...value] });
    }
  };
  push("profession", "isAnyOf", f.professions);
  push("eliteSpec", "isAnyOf", f.eliteSpecs);
  push("gameMode", "isAnyOf", f.gameModes);
  push("tags", "hasAnyOf", f.tags);
  return { type: "group", match: "all", children };
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

  // The trash and the archive are places you navigate TO, so the breadcrumb has
  // to say so. Falling through to the generic tail below left "All Builds"
  // rendered as a plain, un-highlighted crumb — the exact same header the root
  // shows — while the pane underneath was showing the archive.
  if (folder.type === "trash" || folder.type === "archive") {
    parts.push(`<span class="lib-breadcrumb__sep axi-diamond" aria-hidden="true"></span>`);
    parts.push(
      `<span class="lib-breadcrumb__item lib-breadcrumb__item--current">${folder.type === "trash" ? "Trash" : "Archive"}</span>`
    );
    return parts.join("");
  }

  if (folder.id === "__all-comps") {
    parts.push(`<span class="lib-breadcrumb__sep axi-diamond" aria-hidden="true"></span>`);
    parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">All Comps</span>`);
    return parts.join("");
  }

  if (folder.type === "comp") {
    const comp = state.comps.find((c) => c.id === folder.id);
    const compName = comp?.name || "Comp";
    // If comp is in a folder, show the folder chain first
    if (comp?.folderId) {
      const chain = buildFolderChain(comp.folderId);
      for (const f of chain) {
        parts.push(`<span class="lib-breadcrumb__sep axi-diamond" aria-hidden="true"></span>`);
        parts.push(`<button type="button" class="lib-breadcrumb__item" data-navigate-folder="${escapeHtml(f.id)}">${escapeHtml(f.name)}</button>`);
      }
    }
    parts.push(`<span class="lib-breadcrumb__sep axi-diamond" aria-hidden="true"></span>`);
    parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">${escapeHtml(compName)}</span>`);
    return parts.join("");
  }

  if (folder.type === "smart-rule") {
    parts.push(`<span class="lib-breadcrumb__sep axi-diamond" aria-hidden="true"></span>`);
    parts.push(`<span class="lib-breadcrumb__item lib-breadcrumb__item--current">${escapeHtml(folder.smartFolder?.name || "")}</span>`);
    return parts.join("");
  }

  if (folder.type === "custom") {
    // Build the ancestor chain
    const chain = buildFolderChain(folder.id);
    for (let i = 0; i < chain.length; i++) {
      const f = chain[i];
      const isLast = i === chain.length - 1;
      parts.push(`<span class="lib-breadcrumb__sep axi-diamond" aria-hidden="true"></span>`);
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
          class="axi-pill lib-view-btn"
          data-view="${m.id}"
          title="${m.label}"
          aria-label="${m.label}"
          aria-pressed="${active === m.id}"
        >${m.icon}</button>`
    )
    .join("");
}

/**
 * Wire a single .axi-picker: the package ships no script, so `hidden`,
 * `aria-expanded` and `aria-selected` are the whole state and this is the
 * consumer's half of the contract. Roving focus over the options, arrows and
 * Home/End to move it, Escape back to the trigger, click-outside-to-close —
 * the same shape as the package's own gallery.js reference wiring.
 *
 * The popover is always --fixed here: both .lib-toolbar and .lib-filters sit
 * inside .lib-main's `overflow: hidden`, so position is measured from the
 * trigger with getBoundingClientRect() and written to the popover's
 * left/top, the tooltip's contract.
 *
 * @param {HTMLElement} root the .axi-picker
 * @param {object} [opts]
 * @param {(opt: HTMLElement) => (boolean|void)} [opts.onSelect] called when
 *   an option is activated; returning `false` keeps the picker open (the
 *   filter pickers, which toggle a multi-select value rather than choosing
 *   one and closing).
 * @param {HTMLElement[]} [opts.group] sibling .axi-picker roots that close
 *   when this one opens — the filter bar's "only one open at a time".
 */
// Every currently-OPEN picker, keyed by its .axi-picker root, value is its
// own close() (== setOpen(false)). This is the single source of truth for
// "is a picker open and does it still have listeners attached" -- closeOthers
// and the outside-click watcher below close a picker by calling the entry's
// close() rather than poking pop.hidden/aria-expanded directly, so setOpen is
// the *only* exit a picker closes through and its scroll/resize cleanup can
// never be bypassed. A closed picker has no entry here.
const _openPickers = new Map();

/**
 * Close every open picker. renderToolbar()/renderFilters() call this before
 * replacing their container's innerHTML: the nodes a picker's scroll/resize
 * listeners close over are about to be discarded, and nothing calls
 * setOpen(false) for a destroyed node, so the render site has to close first
 * rather than rely on the picker to clean up after itself. There is nothing
 * in either container worth preserving open across a re-render, so this
 * closes all of them rather than walking the container for just its own.
 */
function _closeAllPickers() {
  for (const close of [..._openPickers.values()]) close();
}

function bindPicker(root, { onSelect, group } = {}) {
  const btn = root.querySelector(".axi-picker__btn, .axi-btn[aria-haspopup]");
  const pop = root.querySelector(".axi-picker__pop");
  if (!btn || !pop) return;
  const isFixed = pop.classList.contains("axi-picker__pop--fixed");
  const opts = () => [...pop.querySelectorAll(".axi-picker__opt")];

  const position = () => {
    if (!isFixed) return;
    const rect = btn.getBoundingClientRect();
    pop.style.left = `${Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.minWidth = `${rect.width}px`;
  };

  const closeOthers = () => {
    for (const other of group || []) {
      if (other === root) continue;
      _openPickers.get(other)?.();
    }
  };

  // A --fixed popover is measured once at open and doesn't move with
  // anything after that -- a native <select>'s popup is positioned by the
  // OS, which is the whole reason the package stopped asking the OS to draw
  // it, and once this owns the positioning it owns keeping it attached.
  // Resize is rare and repositioning is cheap, so that one just recomputes.
  // Scroll is common (the sidebar and the content pane both scroll behind
  // this toolbar) and firing layout on every scroll tick would be wasteful,
  // so a scroll closes the popover instead of chasing it. Both listeners are
  // attached only while open and removed on close -- via setOpen(false), the
  // only path that ever closes a picker, so this can't be bypassed the way
  // three direct hidden/aria-expanded writes were.
  let onResize = null;
  let onScroll = null;

  const setOpen = (open) => {
    if (open) closeOthers();
    btn.setAttribute("aria-expanded", String(open));
    pop.hidden = !open;
    if (open) {
      position();
      // Opening lands on the current choice, not the top of the list: the
      // first arrow press should step away from where you already are.
      const current = opts().find((o) => o.getAttribute("aria-selected") === "true");
      (current ?? opts()[0])?.focus();
      if (isFixed) {
        onResize = () => position();
        onScroll = () => setOpen(false);
        window.addEventListener("resize", onResize);
        // capture: a scroll inside .lib-main (or the sidebar) doesn't bubble
        // to window, so this has to hear it on the way down.
        window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      }
      _openPickers.set(root, () => setOpen(false));
    } else {
      if (isFixed) {
        if (onResize) window.removeEventListener("resize", onResize);
        if (onScroll) window.removeEventListener("scroll", onScroll, { capture: true });
        onResize = null;
        onScroll = null;
      }
      _openPickers.delete(root);
    }
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(btn.getAttribute("aria-expanded") !== "true");
  });

  for (const opt of opts()) {
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      const keepOpen = onSelect?.(opt) === false;
      if (!keepOpen) {
        setOpen(false);
        btn.focus();
      }
    });
  }

  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.focus();
      return;
    }
    const list = opts();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const to =
      e.key === "ArrowDown" ? Math.min(i + 1, list.length - 1)
      : e.key === "ArrowUp" ? Math.max(i - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? list.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    list[to].focus();
  });

  _ensurePickerOutsideClickWatcher();
}

// renderToolbar()/renderFilters() rebuild this markup and call bindPicker
// again on every navigation, sort change and view change, so a listener
// added per call here would accumulate one per render for the life of the
// window. One delegated document listener, bound the first time any picker
// is wired and left in place, closes whatever picker is open by walking the
// live _openPickers registry instead -- cheap, since at most one or two are
// ever open at once -- and closes each through its own close() rather than
// touching pop.hidden/aria-expanded directly, so this can't orphan a
// picker's scroll/resize listeners either.
let _pickerOutsideClickBound = false;
function _ensurePickerOutsideClickWatcher() {
  if (_pickerOutsideClickBound) return;
  _pickerOutsideClickBound = true;
  document.addEventListener("click", (e) => {
    for (const [root, close] of [..._openPickers]) {
      if (root.contains(e.target)) continue;
      close();
    }
  });
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

  // Sort picker
  const sortPicker = container.querySelector("#lib-sort-picker");
  if (sortPicker) {
    bindPicker(sortPicker, {
      onSelect: (opt) => {
        for (const o of opt.parentElement.querySelectorAll(".axi-picker__opt")) {
          o.setAttribute("aria-selected", String(o === opt));
        }
        sortPicker.querySelector("#lib-sort-trigger").textContent = opt.textContent.trim();
        _callbacks.onSortChange?.({ field: opt.dataset.sortField });
      },
    });
  }

  // View toggle buttons
  container.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _callbacks.onViewChange?.(btn.dataset.view);
    });
  });

  // Import / Export / New pickers — action menus rather than a choice, so
  // selecting an option never marks it aria-selected, only runs the action
  // and closes.
  const importPicker = container.querySelector("#lib-import-dropdown");
  if (importPicker) {
    bindPicker(importPicker, {
      onSelect: (item) => {
        if (item.dataset.importType === "chatlink") _callbacks.onImportChatLink?.();
        else if (item.dataset.importType === "gw2skills") _callbacks.onImportGw2Skills?.();
        else if (item.dataset.importType === "axilink") _callbacks.onImportAxiLink?.();
        else if (item.dataset.importType === "sharecode") _callbacks.onImportShareCode?.();
        else if (item.dataset.importType === "axicode-file") _callbacks.onImportAxicodeFile?.();
      },
    });
  }

  const exportPicker = container.querySelector("#lib-export-dropdown");
  if (exportPicker) {
    bindPicker(exportPicker, {
      onSelect: () => {
        _callbacks.onExportAxicode?.("visible");
      },
    });
  }

  const newPicker = container.querySelector("#lib-new-dropdown");
  if (newPicker) {
    bindPicker(newPicker, {
      onSelect: (item) => {
        if (item.dataset.newType === "build") _callbacks.onNewBuild?.();
        else if (item.dataset.newType === "folder") _callbacks.onNewFolder?.();
        else if (item.dataset.newType === "comp") _callbacks.onNewComp?.();
      },
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
  const pickers = [...container.querySelectorAll(".lib-fd")];

  for (const dropdown of pickers) {
    bindPicker(dropdown, {
      group: pickers,
      // Multi-select: toggle the value, keep the dropdown open.
      onSelect: (btn) => {
        const type = btn.dataset.filterType;
        const value = btn.dataset.filterValue;
        const current = state.libraryPrefs.activeFilters[type] || [];
        const updated = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];

        btn.setAttribute("aria-selected", String(!current.includes(value)));

        // Update trigger label
        const trigger = dropdown.querySelector(".lib-fd__trigger span");
        const allSelected = dropdown.querySelectorAll('.axi-picker__opt[aria-selected="true"]');
        const baseLabel = dropdown.dataset.dropdown === "class-filter" ? "Class"
          : dropdown.dataset.dropdown === "mode-filter" ? "Mode" : "Tags";
        trigger.textContent = allSelected.length > 0 ? `${baseLabel} (${allSelected.length})` : baseLabel;
        dropdown.querySelector(".lib-fd__trigger")?.classList.toggle("lib-fd__trigger--active", allSelected.length > 0);

        _callbacks.onFilterChange?.({ type, value: updated.length > 0 ? updated : null });
        return false;
      },
    });
  }

  // Clear all filters
  container.querySelectorAll("[data-filter-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _callbacks.onFilterChange?.({ clear: true });
    });
  });

  // Save current filters as a smart folder
  container.querySelector("[data-filter-save-smart]")?.addEventListener("click", () => {
    _callbacks.onSaveFiltersAsSmartFolder?.(filtersToRule(state.libraryPrefs.activeFilters));
  });
}
