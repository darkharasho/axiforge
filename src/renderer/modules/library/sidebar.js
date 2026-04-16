// Library sidebar module — renders smart folders, custom folders, and collapse/expand.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { countBuildsInFolder } from "./folder-store.js";
import {
  folderIcon,
  folderOpenIcon,
  folderPlusIcon,
  chevronRightIcon,
  chevronDownIcon,
  chevronDoubleLeftIcon,
  chevronDoubleRightIcon,
  compIcon,
  shareIcon,
} from "./heroicons.js";

let _callbacks = {};

/**
 * Store callbacks for sidebar actions.
 * @param {{ onNavigate, onPrefsChange, onNewFolder }} callbacks
 */
export function initSidebar(callbacks) {
  _callbacks = callbacks || {};
}

/**
 * Full re-render of the sidebar into #lib-sidebar.
 */
export function renderSidebar() {
  const container = document.getElementById("lib-sidebar");
  if (!container) return;

  const { sidebarOpen, sidebarExpandedFolders } = state.libraryPrefs;

  if (!sidebarOpen) {
    container.classList.add("lib-sidebar--collapsed");
    container.classList.remove("lib-sidebar--open");
    container.innerHTML = `
      <button type="button" class="lib-sidebar__expand-btn" id="lib-sidebar-expand" title="Expand sidebar" aria-label="Expand sidebar">
        ${chevronDoubleRightIcon}
      </button>
    `;
    container.querySelector("#lib-sidebar-expand")?.addEventListener("click", () => {
      _callbacks.onPrefsChange?.({ sidebarOpen: true });
    });
    return;
  }

  const expanded = new Set(sidebarExpandedFolders || []);
  const profExpanded = expanded.has("__smart-profession");
  const modeExpanded = expanded.has("__smart-gamemode");

  container.classList.remove("lib-sidebar--collapsed");
  container.classList.add("lib-sidebar--open");
  container.innerHTML = `
    <div class="lib-sidebar__header">
      <button type="button" class="lib-sidebar__collapse-btn" id="lib-sidebar-collapse" title="Collapse sidebar" aria-label="Collapse sidebar">
        ${chevronDoubleLeftIcon}
      </button>
    </div>
    <nav class="lib-sidebar__nav">
      ${renderSmartFolders(profExpanded, modeExpanded)}
      ${renderMyFolders(expanded)}
    </nav>
  `;

  bindSidebarEvents(container);
}

// ─── Internal renderers ────────────────────────────────────────────────────────

function renderSmartFolders(profExpanded, modeExpanded) {
  const current = state.currentFolder;
  const allActive = !current || current.type === "all";
  const allCompsActive = current?.id === "__all-comps";

  const totalBuilds = state.builds.length;
  const totalComps = (state.comps || []).length;

  // Build profession items
  const professions = [...new Set(state.builds.map((b) => b.profession).filter(Boolean))].sort();
  const profItems = professions
    .map((prof) => {
      const count = state.builds.filter((b) => b.profession === prof).length;
      const isActive = current?.type === "smart-profession" && current.id === prof;
      return `
        <button type="button"
          class="lib-nav-item lib-nav-item--sub ${isActive ? "lib-nav-item--active" : ""}"
          data-navigate-profession="${escapeHtml(prof)}"
        >
          <span class="lib-nav-item__icon">${folderIcon}</span>
          <span class="lib-nav-item__label">${escapeHtml(prof)}</span>
          <span class="lib-nav-item__count">${count}</span>
        </button>
      `;
    })
    .join("");

  // Build game mode items
  const gameModes = [...new Set(state.builds.map((b) => b.gameMode || "pve").filter(Boolean))].sort();
  const modeItems = gameModes
    .map((mode) => {
      const count = state.builds.filter((b) => (b.gameMode || "pve") === mode).length;
      const isActive = current?.type === "smart-gamemode" && current.id === mode;
      const label = gameModeLabel(mode);
      return `
        <button type="button"
          class="lib-nav-item lib-nav-item--sub ${isActive ? "lib-nav-item--active" : ""}"
          data-navigate-gamemode="${escapeHtml(mode)}"
        >
          <span class="lib-nav-item__icon">${folderIcon}</span>
          <span class="lib-nav-item__label">${escapeHtml(label)}</span>
          <span class="lib-nav-item__count">${count}</span>
        </button>
      `;
    })
    .join("");

  return `
    <div class="lib-sidebar__section">
      <div class="lib-sidebar__section-label">Smart Folders</div>
      <button type="button"
        class="lib-nav-item ${allActive ? "lib-nav-item--active" : ""}"
        data-navigate-all="1"
      >
        <span class="lib-nav-item__icon">${folderOpenIcon}</span>
        <span class="lib-nav-item__label">All Builds</span>
        <span class="lib-nav-item__count">${totalBuilds}</span>
      </button>

      ${professions.length > 0 ? `
        <button type="button"
          class="lib-nav-item lib-nav-item--group"
          data-toggle-group="__smart-profession"
        >
          <span class="lib-nav-item__chevron">${profExpanded ? chevronDownIcon : chevronRightIcon}</span>
          <span class="lib-nav-item__icon">${folderIcon}</span>
          <span class="lib-nav-item__label">By Profession</span>
        </button>
        ${profExpanded ? `<div class="lib-nav-group">${profItems}</div>` : ""}
      ` : ""}

      ${gameModes.length > 0 ? `
        <button type="button"
          class="lib-nav-item lib-nav-item--group"
          data-toggle-group="__smart-gamemode"
        >
          <span class="lib-nav-item__chevron">${modeExpanded ? chevronDownIcon : chevronRightIcon}</span>
          <span class="lib-nav-item__icon">${folderIcon}</span>
          <span class="lib-nav-item__label">By Game Mode</span>
        </button>
        ${modeExpanded ? `<div class="lib-nav-group">${modeItems}</div>` : ""}
      ` : ""}

      ${totalComps > 0 ? `
        <button type="button"
          class="lib-nav-item ${allCompsActive ? "lib-nav-item--active" : ""}"
          data-navigate-all-comps="1"
        >
          <span class="lib-nav-item__icon">${compIcon}</span>
          <span class="lib-nav-item__label">All Comps</span>
          <span class="lib-nav-item__count">${totalComps}</span>
        </button>
      ` : ""}
    </div>
  `;
}

function renderMyFolders(expanded) {
  const topLevel = state.folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const sharedFolders = topLevel.filter((f) => f.shared);
  const personalFolders = topLevel.filter((f) => !f.shared);

  const sharedItems = sharedFolders.map((f) => renderFolderItem(f, expanded, 0)).join("");
  const personalItems = personalFolders.map((f) => renderFolderItem(f, expanded, 0)).join("");

  let html = "";

  if (sharedFolders.length > 0) {
    html += `
      <div class="lib-sidebar__section">
        <div class="lib-sidebar__section-label">Shared Folders</div>
        ${sharedItems}
      </div>
    `;
  }

  html += `
    <div class="lib-sidebar__section">
      <div class="lib-sidebar__section-header">
        <div class="lib-sidebar__section-label">My Folders</div>
        <button type="button" class="lib-sidebar__new-folder-btn" id="lib-new-folder-btn" title="New folder" aria-label="New folder">
          ${folderPlusIcon}
        </button>
      </div>
      ${personalItems || `<div class="lib-sidebar__empty">No folders yet</div>`}
    </div>
  `;

  return html;
}

function renderFolderItem(folder, expanded, depth) {
  const current = state.currentFolder;
  const isActive = current?.type === "custom" && current.id === folder.id;
  const isExpanded = expanded.has(folder.id);
  const count = countBuildsInFolder(folder.id);
  const children = state.folders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const hasChildren = children.length > 0;

  const indent = depth * 12;

  const childItems = hasChildren && isExpanded
    ? children.map((c) => renderFolderItem(c, expanded, depth + 1)).join("")
    : "";

  return `
    <div class="lib-folder-item">
      <button type="button"
        class="lib-nav-item ${isActive ? "lib-nav-item--active" : ""}"
        style="padding-left: ${16 + indent}px"
        data-navigate-folder="${escapeHtml(folder.id)}"
      >
        ${hasChildren
          ? `<span class="lib-nav-item__chevron" data-toggle-folder="${escapeHtml(folder.id)}">${isExpanded ? chevronDownIcon : chevronRightIcon}</span>`
          : `<span class="lib-nav-item__chevron lib-nav-item__chevron--spacer"></span>`
        }
        <span class="lib-nav-item__icon">${isExpanded ? folderOpenIcon : folderIcon}</span>
        <span class="lib-nav-item__label">${escapeHtml(folder.name)}</span>
        ${folder.shared ? `<span class="lib-nav-item__shared-badge" title="Shared with ${escapeHtml(folder.orgName || 'org')}">${shareIcon}</span>` : ""}
        ${_renderSyncIndicator(folder.id)}
        <span class="lib-nav-item__count">${count}</span>
      </button>
      ${hasChildren && isExpanded ? `<div class="lib-nav-group">${childItems}</div>` : ""}
    </div>
  `;
}

const _sidebarSyncSpinner = `<svg class="sync-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
const _sidebarSyncCheck = `<svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>`;

function _renderSyncIndicator(folderId) {
  const syncStatus = state.folderSyncStatus?.[folderId];
  if (!syncStatus) return "";
  if (syncStatus === "syncing") {
    return `<span class="lib-nav-item__sync-indicator lib-nav-item__sync-indicator--syncing" title="Syncing\u2026">${_sidebarSyncSpinner}</span>`;
  }
  if (syncStatus === "synced") {
    return `<span class="lib-nav-item__sync-indicator lib-nav-item__sync-indicator--synced" title="Synced">${_sidebarSyncCheck}</span>`;
  }
  return "";
}

function gameModeLabel(id) {
  if (id === "pve") return "PvE";
  if (id === "pvp") return "PvP";
  if (id === "wvw") return "WvW";
  return id;
}

// ─── Event binding ─────────────────────────────────────────────────────────────

function bindSidebarEvents(container) {
  // Collapse
  container.querySelector("#lib-sidebar-collapse")?.addEventListener("click", () => {
    _callbacks.onPrefsChange?.({ sidebarOpen: false });
  });

  // Navigate to All Builds
  container.querySelectorAll("[data-navigate-all]").forEach((el) => {
    el.addEventListener("click", () => {
      _callbacks.onNavigate?.({ type: "all" });
    });
  });

  // Navigate to All Comps
  container.querySelectorAll("[data-navigate-all-comps]").forEach((el) => {
    el.addEventListener("click", () => {
      _callbacks.onNavigate?.({ type: "smart", id: "__all-comps" });
    });
  });

  // Navigate to profession smart folder
  container.querySelectorAll("[data-navigate-profession]").forEach((el) => {
    el.addEventListener("click", () => {
      _callbacks.onNavigate?.({ type: "smart-profession", id: el.dataset.navigateProfession });
    });
  });

  // Navigate to game mode smart folder
  container.querySelectorAll("[data-navigate-gamemode]").forEach((el) => {
    el.addEventListener("click", () => {
      _callbacks.onNavigate?.({ type: "smart-gamemode", id: el.dataset.navigateGamemode });
    });
  });

  // Navigate to custom folder
  container.querySelectorAll("[data-navigate-folder]").forEach((el) => {
    el.addEventListener("click", (e) => {
      // Don't navigate if the chevron toggle was clicked
      if (e.target.closest("[data-toggle-folder]")) return;
      _callbacks.onNavigate?.({ type: "custom", id: el.dataset.navigateFolder });
    });
  });

  // Toggle smart folder groups (profession / gamemode)
  container.querySelectorAll("[data-toggle-group]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.toggleGroup;
      toggleExpanded(key);
    });
  });

  // Toggle individual custom folder expand/collapse via chevron
  container.querySelectorAll("[data-toggle-folder]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = el.dataset.toggleFolder;
      toggleExpanded(key);
    });
  });

  // New folder button (sidebar uses its own callback)
  container.querySelector("#lib-new-folder-btn")?.addEventListener("click", () => {
    _callbacks.onNewFolderSidebar?.();
  });
}

/**
 * Insert an inline text input for naming a folder.
 * Returns a Promise<string|null> — the name, or null if Escape-cancelled.
 * Blur or Enter with empty text defaults to "New Folder".
 *
 * @param {HTMLElement} afterEl - Insert after this element
 * @param {string} defaultValue - Pre-filled text (empty for new folders)
 * @param {Object} [options]
 * @param {string} [options.fallbackName="New Folder"] - Name used on blur/Enter with empty input
 * @param {HTMLElement} [options.container] - Alternative container to append to (for content-area inline)
 * @param {string} [options.className] - Extra class for the row element
 */
export function insertInlineInput(afterEl, defaultValue = "", options = {}) {
  const { fallbackName = "New Folder", container, className, icon } = options;
  const displayIcon = icon || folderIcon;

  // Detect view type from container contents
  const isTable = afterEl?.tagName === "TR" || afterEl?.closest("table") || container?.querySelector("table");
  const isGrid = container?.querySelector(".lib-grid");
  const isIconView = container?.querySelector(".lib-icon-grid");

  return new Promise((resolve) => {
    let row;
    if (isTable) {
      // Find the table body to insert into
      const tbody = afterEl?.closest("tbody") || container?.querySelector("tbody");
      row = document.createElement("tr");
      row.className = "lib-table__row lib-table__row--folder";
      row.innerHTML = `
        <td class="lib-table__td lib-table__td--pin"></td>
        <td class="lib-table__td lib-table__td--icon"><span class="lib-table__folder-icon">${displayIcon}</span></td>
        <td class="lib-table__td lib-table__td--name" colspan="7"><input type="text" class="lib-inline-input" placeholder="${fallbackName}" value="" /></td>
      `;
      if (afterEl?.tagName === "TR") {
        afterEl.insertAdjacentElement("afterend", row);
      } else if (tbody) {
        tbody.appendChild(row);
      }
    } else if (isGrid) {
      // Grid view: create a card-shaped inline input
      row = document.createElement("div");
      row.className = "lib-grid-card lib-grid-card--folder lib-grid-card--editing";
      row.innerHTML = `
        <div class="lib-grid-card__folder-icon">${displayIcon}</div>
        <input type="text" class="lib-inline-input lib-grid-card__inline-input" placeholder="${fallbackName}" value="" />
      `;
      const grid = container.querySelector(".lib-grid--folders") || container.querySelector(".lib-grid");
      if (grid) grid.appendChild(row);
    } else if (isIconView) {
      // Icon view: create an icon-shaped inline input
      row = document.createElement("div");
      row.className = "lib-icon-item lib-icon-item--folder lib-icon-item--editing";
      row.innerHTML = `
        <div class="lib-icon-item__icon lib-icon-item__icon--folder">${displayIcon}</div>
        <input type="text" class="lib-inline-input lib-icon-item__inline-input" placeholder="${fallbackName}" value="" />
      `;
      const grid = container.querySelector(".lib-icon-grid");
      if (grid) grid.appendChild(row);
    } else {
      row = document.createElement("div");
      row.className = `lib-nav-item lib-nav-item--editing${className ? ` ${className}` : ""}`;
      row.innerHTML = `
        <span class="lib-nav-item__icon">${displayIcon}</span>
        <input type="text" class="lib-inline-input" placeholder="${fallbackName}" value="" />
      `;
      if (container) {
        container.appendChild(row);
      } else if (afterEl) {
        afterEl.insertAdjacentElement("afterend", row);
      } else {
        const section = document.querySelector(".lib-sidebar__section:last-child");
        if (section) section.appendChild(row);
      }
    }

    const input = row.querySelector("input");
    input.value = defaultValue;

    input.focus();
    if (defaultValue) input.select();

    let resolved = false;
    function finish(value) {
      if (resolved) return;
      resolved = true;
      row.remove();
      resolve(value);
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(input.value.trim() || fallbackName);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });
    input.addEventListener("blur", () => {
      finish(input.value.trim() || fallbackName);
    });
  });
}

function toggleExpanded(key) {
  const current = new Set(state.libraryPrefs.sidebarExpandedFolders || []);
  if (current.has(key)) {
    current.delete(key);
  } else {
    current.add(key);
  }
  _callbacks.onPrefsChange?.({ sidebarExpandedFolders: [...current] });
}
