// Library context menu module — renders floating right-click menus.
// Detects target type (build, folder, multi-select, empty area) and shows
// the appropriate menu. All actions are delegated to caller-provided callbacks.

import { escapeHtml } from "../utils.js";
import { state } from "../state.js";
import { isSelected, getSelection, isCompSelected, getCompSelection } from "./selection.js";
import { shareFolder, unshareFolder, pullFolder } from "./folder-store.js";
import {
  playIcon,
  pencilIcon,
  documentDuplicateIcon,
  starIcon,
  folderArrowDownIcon,
  tagIcon,
  clipboardDocumentIcon,
  globeAltIcon,
  informationCircleIcon,
  trashIcon,
  folderOpenIcon,
  folderPlusIcon,
  documentPlusIcon,
  plusIcon,
  clipboardIcon,
  homeIcon,
  folderIcon,
  linkIcon,
  arrowDownTrayIcon,
  arrowUpTrayIcon,
  scissorsIcon,
  axiforgeIcon,
  compPlusIcon,
  squaresIcon,
  shareIcon,
} from "./heroicons.js";

let _callbacks = {};
let _activeMenu = null;
let _activeSubmenu = null;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Store callbacks and set up global close-on-click / Escape listeners.
 * @param {Object} callbacks
 */
export function initContextMenu(callbacks) {
  _callbacks = callbacks || {};

  document.addEventListener("mousedown", (e) => {
    if (_activeMenu && !_activeMenu.contains(e.target) &&
        !(_activeSubmenu && _activeSubmenu.contains(e.target))) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _activeMenu) {
      closeMenu();
    }
  });

  window.addEventListener("scroll", () => {
    if (_activeMenu) closeMenu();
  }, true);
}

/** Remove any active context menu from the DOM. */
export function closeMenu() {
  _closeSubmenu();
  if (_activeMenu) {
    _activeMenu.remove();
    _activeMenu = null;
  }
}

/**
 * Wire contextmenu listener to #lib-content.
 * Call this after #lib-content is rendered.
 */
export function wireContextMenuEvents() {
  const container = document.getElementById("lib-content");
  if (!container) return;

  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    const buildEl = e.target.closest("[data-build-id]");
    const folderEl = e.target.closest("[data-folder-id]");
    const compEl = e.target.closest("[data-comp-id]");

    if (buildEl) {
      const buildId = buildEl.dataset.buildId;
      // Multi-select: build is part of a selection with >1 items
      if (isSelected(buildId) && getSelection().length > 1) {
        showMultiSelectMenu(e.clientX, e.clientY, getSelection());
      } else {
        const build = state.builds.find((b) => b.id === buildId);
        showBuildMenu(e.clientX, e.clientY, buildId, build);
      }
    } else if (compEl) {
      const compId = compEl.dataset.compId;
      // Multi-select: comp is part of a selection with >1 items
      if (isCompSelected(compId) && getCompSelection().length > 1) {
        showMultiCompSelectMenu(e.clientX, e.clientY, getCompSelection());
      } else {
        const comp = state.comps?.find((c) => c.id === compId);
        showCompMenu(e.clientX, e.clientY, compId, comp);
      }
    } else if (folderEl) {
      const folderId = folderEl.dataset.folderId;
      const folder = state.folders.find((f) => f.id === folderId);
      showFolderMenu(e.clientX, e.clientY, folderId, folder);
    } else {
      showEmptyMenu(e.clientX, e.clientY);
    }
  });
}

// ─── Menu builders ─────────────────────────────────────────────────────────────

function showBuildMenu(x, y, buildId, build) {
  const isPinned = build?.pinned;
  const items = [
    _item(playIcon, "Load", null, () => _callbacks.onLoadBuild?.(buildId)),
    _item(pencilIcon, "Rename", "F2", () => _callbacks.onRename?.(buildId)),
    _item(documentDuplicateIcon, "Duplicate", "Ctrl+D", () => _callbacks.onDuplicate?.(buildId)),
    _sep(),
    _item(starIcon, isPinned ? "Unpin" : "Pin", null, () => _callbacks.onTogglePin?.(buildId, !isPinned)),
    _submenuItem(folderArrowDownIcon, "Move to Folder", _buildMoveToFolderItems(buildId)),
    _item(tagIcon, "Edit Tags", null, () => _callbacks.onEditTags?.(buildId)),
    _sep(),
    _item(clipboardDocumentIcon, "Copy", "Ctrl+C", () => _callbacks.onCopyJson?.(buildId)),
    _item(scissorsIcon, "Cut", "Ctrl+X", () => _callbacks.onCutJson?.(buildId)),
    _item(linkIcon, "Copy Chat Link", null, () => _callbacks.onCopyChatLink?.(buildId)),
    _item(axiforgeIcon, "Copy AxiCode", null, () => _callbacks.onCopyShareCode?.(buildId)),
    _submenuItem(arrowUpTrayIcon, "Share to Discord", [
      _item(clipboardDocumentIcon, "Copy Link", null, () => _callbacks.onDiscordCopy?.(buildId)),
      _item(arrowUpTrayIcon, "Discord Embed", null, () => _callbacks.onDiscordEmbed?.(buildId)),
    ]),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
    _item(globeAltIcon, "Publish", null, () => _callbacks.onPublish?.(buildId)),
    _sep(),
    _item(informationCircleIcon, "Build Info", null, () => _callbacks.onBuildInfo?.(buildId)),
    ..._buildUnlinkOrDeleteItems(buildId, build),
  ];
  _showMenu(x, y, items);
}

function showMultiSelectMenu(x, y, ids) {
  const count = ids.length;
  const items = [
    _header(`${count} builds selected`),
    _sep(),
    _submenuItem(folderArrowDownIcon, "Move to Folder", _buildMoveToFolderItems(ids)),
    _item(tagIcon, "Add Tags", null, () => _callbacks.onEditTags?.(ids)),
    _item(starIcon, "Pin All", null, () => _callbacks.onPinAll?.(ids, true)),
    _sep(),
    _item(clipboardDocumentIcon, "Copy", "Ctrl+C", () => _callbacks.onCopyJson?.(ids)),
    _item(scissorsIcon, "Cut", "Ctrl+X", () => _callbacks.onCutJson?.(ids)),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
    _sep(),
    ..._multiSelectUnlinkOrDeleteItems(ids),
  ];
  _showMenu(x, y, items);
}

function showCompMenu(x, y, compId, comp) {
  const items = [
    _item(playIcon, "Open", null, () => _callbacks.onOpenComp?.(compId)),
    _item(pencilIcon, "Rename", "F2", () => _callbacks.onRenameComp?.(compId)),
    _item(documentDuplicateIcon, "Duplicate", "Ctrl+D", () => _callbacks.onDuplicateComp?.(compId)),
    _sep(),
    _submenuItem(folderArrowDownIcon, "Move to Folder", _buildMoveToFolderItemsForComps([compId])),
    _sep(),
    _item(clipboardDocumentIcon, "Copy JSON", "Ctrl+C", () => _callbacks.onCopyCompJson?.(compId)),
    _item(scissorsIcon, "Cut", "Ctrl+X", () => _callbacks.onCutCompJson?.(compId)),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
    _item(clipboardIcon, "Paste", "Ctrl+V", () => _callbacks.onPasteJson?.(compId)),
    _sep(),
    _item(trashIcon, "Delete", "Del", () => _callbacks.onDeleteComps?.([compId]), true),
  ];
  _showMenu(x, y, items);
}

function showMultiCompSelectMenu(x, y, ids) {
  const count = ids.length;
  const items = [
    _header(`${count} comps selected`),
    _sep(),
    _submenuItem(folderArrowDownIcon, "Move to Folder", _buildMoveToFolderItemsForComps(ids)),
    _sep(),
    _item(clipboardDocumentIcon, "Copy JSON", "Ctrl+C", () => _callbacks.onCopyCompJson?.(ids)),
    _item(scissorsIcon, "Cut", "Ctrl+X", () => _callbacks.onCutCompJson?.(ids)),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
    _sep(),
    _item(trashIcon, `Delete ${count} Comps`, null, () => _callbacks.onDeleteComps?.(ids), true),
  ];
  _showMenu(x, y, items);
}

function showFolderMenu(x, y, folderId, folder) {
  const isShared = folder?.shared;
  const hasSharedLibrary = !!state.sharedLibraryConfig;

  const items = [
    _item(folderOpenIcon, "Open Folder", null, () => _callbacks.onOpenFolder?.(folderId)),
    _item(pencilIcon, "Rename", "F2", () => _callbacks.onRenameFolder?.(folderId)),
    _sep(),
    _item(folderPlusIcon, "New Sub-folder", null, () => _callbacks.onNewSubfolder?.(folderId)),
    _item(documentPlusIcon, "New Build in Folder", null, () => _callbacks.onNewBuildInFolder?.(folderId)),
    _submenuItem(arrowDownTrayIcon, "Import in Folder", [
      _item(linkIcon, "Build Link", null, () => _callbacks.onImportChatLink?.(folderId)),
      _item(arrowDownTrayIcon, "GW2Skills", null, () => _callbacks.onImportGw2Skills?.(folderId)),
      _item(axiforgeIcon, "AxiCode", null, () => _callbacks.onImportShareCode?.(folderId)),
      _sep(),
      _item(arrowDownTrayIcon, ".axicode File", null, () => _callbacks.onImportAxicodeFile?.(folderId)),
    ]),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicodeFolder?.(folderId)),
    _sep(),
    _item(clipboardIcon, "Paste", "Ctrl+V", () => _callbacks.onPasteJson?.(folderId)),
    _sep(),
    ...(isShared ? [
      _item(shareIcon, "Sync Now", null, async () => {
        await pullFolder(folderId);
        _callbacks.onRefresh?.();
      }),
      _item(trashIcon, "Unshare Folder", null, async () => {
        if (confirm(`Stop sharing "${folder?.name || folderId}"? Your local copies will be kept.`)) {
          await unshareFolder(folderId);
          _callbacks.onRefresh?.();
        }
      }, true),
    ] : hasSharedLibrary ? [
      _item(shareIcon, "Share to Org", null, async () => {
        if (confirm(`Share "${folder?.name || folderId}" to your org? All builds in this folder will be visible to org members.`)) {
          await shareFolder(folderId);
          _callbacks.onRefresh?.();
        }
      }),
    ] : []),
    _item(trashIcon, "Delete Folder", null, () => _callbacks.onDeleteFolder?.(folderId), true),
  ];
  _showMenu(x, y, items);
}

function showEmptyMenu(x, y) {
  const insideComp = state.currentFolder?.type === "comp";
  const items = [
    _item(plusIcon, "New Build", "Ctrl+N", () => _callbacks.onNewBuild?.()),
    ...(insideComp ? [] : [
      _item(compPlusIcon, "New Comp", null, () => _callbacks.onNewComp?.()),
      _item(folderPlusIcon, "New Folder", null, () => _callbacks.onNewFolder?.()),
    ]),
    _sep(),
    _item(clipboardIcon, "Paste", "Ctrl+V", () => _callbacks.onPasteJson?.()),
    _submenuItem(arrowDownTrayIcon, "Import", [
      _item(linkIcon, "Build Link", null, () => _callbacks.onImportChatLink?.()),
      _item(arrowDownTrayIcon, "GW2Skills", null, () => _callbacks.onImportGw2Skills?.()),
      _item(axiforgeIcon, "AxiCode", null, () => _callbacks.onImportShareCode?.()),
      _sep(),
      _item(arrowDownTrayIcon, ".axicode File", null, () => _callbacks.onImportAxicodeFile?.()),
    ]),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("visible")),
    _sep(),
    _item(null, "Select All", "Ctrl+A", () => _callbacks.onSelectAll?.()),
  ];
  _showMenu(x, y, items);
}

// ─── Build unlink / delete items ──────────────────────────────────────────────

function _buildUnlinkOrDeleteItems(buildId, build) {
  const compIds = Array.isArray(build?.compIds) ? build.compIds : [];
  const inCompView = state.currentFolder?.type === "comp";

  if (inCompView) {
    return [
      _item(squaresIcon, "Unlink from Comp", null, () =>
        _callbacks.onRemoveBuildFromComp?.(buildId, state.currentFolder.id)),
    ];
  }

  const items = [];
  if (compIds.length > 0) {
    const comps = (state.comps || []).filter((c) => compIds.includes(c.id));
    if (comps.length === 1) {
      const c = comps[0];
      items.push(
        _item(squaresIcon, `Unlink from ${escapeHtml(c.name)}`, null, () =>
          _callbacks.onRemoveBuildFromComp?.(buildId, c.id)),
      );
    } else if (comps.length > 1) {
      items.push(
        _submenuItem(squaresIcon, `Unlink from Comp (${comps.length})`, comps.map((c) =>
          _item(null, escapeHtml(c.name), null, () =>
            _callbacks.onRemoveBuildFromComp?.(buildId, c.id)),
        )),
      );
    }
  }
  items.push(_item(trashIcon, "Delete", "Del", () => _callbacks.onDelete?.([buildId]), true));
  return items;
}

function _multiSelectUnlinkOrDeleteItems(ids) {
  const count = ids.length;
  const inCompView = state.currentFolder?.type === "comp";

  if (inCompView) {
    return [
      _item(squaresIcon, `Unlink ${count} Builds`, null, () => {
        for (const id of ids) _callbacks.onRemoveBuildFromComp?.(id, state.currentFolder.id);
      }),
    ];
  }

  const items = [];
  const linkedIds = ids.filter((id) => {
    const b = state.builds.find((x) => x.id === id);
    return b && Array.isArray(b.compIds) && b.compIds.length > 0;
  });

  if (linkedIds.length > 0) {
    items.push(
      _item(squaresIcon, `Unlink ${linkedIds.length} from Comps`, null, () => {
        for (const id of linkedIds) {
          const b = state.builds.find((x) => x.id === id);
          for (const compId of (b?.compIds || [])) {
            _callbacks.onRemoveBuildFromComp?.(id, compId);
          }
        }
      }),
    );
  }
  items.push(_item(trashIcon, `Delete ${count} Builds`, null, () => _callbacks.onDelete?.(ids), true));
  return items;
}

// ─── Move to Folder submenu items ──────────────────────────────────────────────

function _buildMoveToFolderItems(buildIdOrIds) {
  const ids = Array.isArray(buildIdOrIds) ? buildIdOrIds : [buildIdOrIds];

  const topLevelFolders = state.folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const items = [
    _item(folderPlusIcon, "New Folder...", null, () => _callbacks.onNewFolderAndMove?.(ids)),
    _sep(),
    _item(homeIcon, "Root (no folder)", null, () => _callbacks.onMoveTo?.(ids, null)),
    ...topLevelFolders.map((f) =>
      _item(folderIcon, escapeHtml(f.name), null, () => _callbacks.onMoveTo?.(ids, f.id))
    ),
  ];

  return items;
}

function _buildMoveToFolderItemsForComps(compIds) {
  const topLevelFolders = state.folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const items = [
    _item(homeIcon, "Root (no folder)", null, () => _callbacks.onMoveComps?.(compIds, null)),
    ...topLevelFolders.map((f) =>
      _item(folderIcon, escapeHtml(f.name), null, () => _callbacks.onMoveComps?.(compIds, f.id))
    ),
  ];

  return items;
}

// ─── Menu rendering ────────────────────────────────────────────────────────────

function _showMenu(x, y, items) {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "lib-ctx-menu";
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const item of items) {
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  _activeMenu = menu;

  // Reposition if overflowing viewport
  _repositionMenu(menu, x, y);
}

function _repositionMenu(menu, x, y) {
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x;
  let top = y;

  if (rect.right > vw) {
    left = Math.max(0, vw - rect.width - 4);
  }
  if (rect.bottom > vh) {
    top = Math.max(0, vh - rect.height - 4);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

// ─── Item factories ────────────────────────────────────────────────────────────

function _item(icon, label, shortcut, onClick, danger = false) {
  const el = document.createElement("div");
  el.className = "lib-ctx-item" + (danger ? " lib-ctx-item--danger" : "");

  el.innerHTML =
    `<span class="lib-ctx-item__icon">${icon || ""}</span>` +
    `<span class="lib-ctx-item__label">${label}</span>` +
    (shortcut ? `<span class="lib-ctx-item__shortcut">${escapeHtml(shortcut)}</span>` : "");

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    onClick?.();
  });

  return el;
}

function _header(label) {
  const el = document.createElement("div");
  el.className = "lib-ctx-item lib-ctx-item--disabled lib-ctx-item--header";
  el.innerHTML =
    `<span class="lib-ctx-item__icon"></span>` +
    `<span class="lib-ctx-item__label">${escapeHtml(label)}</span>`;
  return el;
}

function _sep() {
  const el = document.createElement("div");
  el.className = "lib-ctx-sep";
  return el;
}

function _submenuItem(icon, label, submenuItems) {
  const el = document.createElement("div");
  el.className = "lib-ctx-item lib-ctx-item--submenu";

  // Use chevron-right inline SVG as the submenu indicator
  const chevronSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/></svg>`;

  el.innerHTML =
    `<span class="lib-ctx-item__icon">${icon || ""}</span>` +
    `<span class="lib-ctx-item__label">${label}</span>` +
    `<span class="lib-ctx-item__arrow">${chevronSvg}</span>`;

  el.addEventListener("mouseenter", (e) => {
    _closeSubmenu();
    _openSubmenu(el, submenuItems);
  });

  el.addEventListener("mouseleave", (e) => {
    // Keep submenu open if mouse moves into it
    if (_activeSubmenu && _activeSubmenu.contains(e.relatedTarget)) return;
    // Small delay to allow moving cursor into submenu
    setTimeout(() => {
      if (_activeSubmenu && !_activeSubmenu.matches(":hover") && !el.matches(":hover")) {
        _closeSubmenu();
      }
    }, 80);
  });

  return el;
}

// ─── Submenu helpers ───────────────────────────────────────────────────────────

function _openSubmenu(parentEl, items) {
  const sub = document.createElement("div");
  sub.className = "lib-ctx-menu lib-ctx-menu--sub";
  sub.style.position = "fixed";
  sub.style.zIndex = "10000";

  for (const item of items) {
    sub.appendChild(item);
  }

  document.body.appendChild(sub);
  _activeSubmenu = sub;

  // Position submenu to the right of parent item
  const parentRect = parentEl.getBoundingClientRect();
  let left = parentRect.right + 2;
  let top = parentRect.top;

  sub.style.left = `${left}px`;
  sub.style.top = `${top}px`;

  // Reposition if overflowing viewport
  const subRect = sub.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (subRect.right > vw) {
    left = parentRect.left - subRect.width - 2;
  }
  if (subRect.bottom > vh) {
    top = Math.max(0, vh - subRect.height - 4);
  }

  sub.style.left = `${left}px`;
  sub.style.top = `${top}px`;

  sub.addEventListener("mouseleave", (e) => {
    if (e.relatedTarget && parentEl.contains(e.relatedTarget)) return;
    setTimeout(() => {
      if (_activeSubmenu === sub && !sub.matches(":hover") && !parentEl.matches(":hover")) {
        _closeSubmenu();
      }
    }, 80);
  });
}

function _closeSubmenu() {
  if (_activeSubmenu) {
    _activeSubmenu.remove();
    _activeSubmenu = null;
  }
}
