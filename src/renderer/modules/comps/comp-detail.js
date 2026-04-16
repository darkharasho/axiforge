// Comp detail view — renders party lines panel + build pool.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { wireCompDragDrop, destroyCompDragDrop } from "./comp-drag-drop.js";
import {
  showPublishProgress,
  advancePublishStep,
  failPublishStep,
  showPublishResult,
  completeAllPublishSteps,
  setPublishStatusEl,
  restorePublishProgress,
} from "../render-pages.js";
import { roleBadgeHtml } from "../roleEstimator.js";
import { axiforgeIcon, checkIcon, chevronDownIcon, arrowUpTrayIcon, clipboardDocumentIcon, globeAltIcon } from "../library/heroicons.js";
import { renderMiniBuildCard, renderMissingMiniBuildCard } from "../mini-build-card.js";
import { computeCompPartyCoverage, buildPartyCoverageHTML, bindPartyCoverageEvents, closePartyCoverageExpand } from "./comp-boon-coverage.js";
import {
  getEliteSpecName,
  getSpecIcon,
  profClass,
  getDisplayName,
  resolveStatPackage,
  getRuneName,
} from "../build-helpers.js";

let _callbacks = {};
let _notesDebounceTimer = null;
let _activeCtxMenu = null;
let _justDropped = false;
let _hoverTimer = null;
let _activeHoverCard = null;
let _cleanupResize = null;
let _lastSavedAt = null;
let _saveStatusInterval = null;

const SPLIT_KEY = "axiforge-comp-panel-split";
const SPLIT_DEFAULT = 40; // percent
const SPLIT_MIN_PX = 344; // fits P# label + 5 slots + controls + padding
const SPLIT_MAX_PCT = 72;

function getSavedSplit() {
  const v = parseFloat(localStorage.getItem(SPLIT_KEY));
  return isNaN(v) ? SPLIT_DEFAULT : Math.min(SPLIT_MAX_PCT, Math.max(0, v));
}

function clampSplitPct(pct, bodyWidth) {
  const minPct = bodyWidth > 0 ? (SPLIT_MIN_PX / bodyWidth) * 100 : SPLIT_MIN_PX;
  return Math.min(SPLIT_MAX_PCT, Math.max(minPct, pct));
}

function wireResizeHandle(container) {
  if (_cleanupResize) { _cleanupResize(); _cleanupResize = null; }

  const handle = container.querySelector(".comp-detail__resize-handle");
  const body   = container.querySelector(".comp-detail__body");
  const party  = container.querySelector(".comp-detail__party-panel");
  if (!handle || !body || !party) return;

  const bodyWidth = body.getBoundingClientRect().width;
  party.style.width = `${clampSplitPct(getSavedSplit(), bodyWidth)}%`;

  let dragging = false;

  function onMouseMove(e) {
    if (!dragging) return;
    const rect = body.getBoundingClientRect();
    const pct = clampSplitPct(((e.clientX - rect.left) / rect.width) * 100, rect.width);
    party.style.width = `${pct}%`;
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("comp-detail__resize-handle--dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const rect = body.getBoundingClientRect();
    const pct = (party.getBoundingClientRect().width / rect.width) * 100;
    localStorage.setItem(SPLIT_KEY, String(pct));
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  function onMouseDown(e) {
    e.preventDefault();
    dragging = true;
    handle.classList.add("comp-detail__resize-handle--dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  handle.addEventListener("mousedown", onMouseDown);

  _cleanupResize = () => {
    handle.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}

/**
 * Store callbacks for detail actions.
 * @param {{ onBack: Function, onRerender: Function, onOpenBuild: Function }} callbacks
 */
export function initCompDetail(callbacks) {
  _callbacks = callbacks || {};
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastEl = null;
let _toastTimer = null;
function showToast(message) {
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    _toastEl.className = "lib-toast";
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = message;
  _toastEl.className = "lib-toast lib-toast--success";
  void _toastEl.offsetWidth;
  _toastEl.classList.add("lib-toast--visible");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { _toastEl.classList.remove("lib-toast--visible"); }, 2000);
}

// ─── Discord Status ───────────────────────────────────────────────────────────

function showDiscordStatus(msg, isError = false) {
  const el = document.getElementById("compDiscordStatus");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("comp-detail__discord-status--error", isError);
  if (!isError) {
    setTimeout(() => { el.textContent = ""; }, 3000);
  }
}

// ─── Context Menu ────────────────────────────────────────────────────────────

function closeCompCtxMenu() {
  if (_activeCtxMenu) {
    _activeCtxMenu.remove();
    _activeCtxMenu = null;
  }
}

// ─── Slot Hover Card ──────────────────────────────────────────────────────────

function closeHoverCard() {
  if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
  if (_activeHoverCard) { _activeHoverCard.remove(); _activeHoverCard = null; }
}

function showSlotHoverCard(slotEl, build) {
  const card = document.createElement("div");
  const pClass = profClass(build.profession);
  card.className = `comp-slot-hover-card ${pClass}`;

  const icon = getSpecIcon(build);
  const name = escapeHtml(getDisplayName(build));
  const eliteSpec = getEliteSpecName(build);
  const profLine = [eliteSpec, build.profession].filter(Boolean).join(" · ");
  const gameMode = build.gameMode || "pve";
  const statPackage = resolveStatPackage(build);
  const runeName = getRuneName(build, state.upgradeCatalog);
  const relicName = build.equipment?.relic || "";
  const tags = build.tags || [];

  const equipParts = [];
  if (statPackage) equipParts.push(`<span class="comp-hover__stat">${escapeHtml(statPackage)}</span>`);
  if (runeName)    equipParts.push(`<span class="comp-hover__equip">${escapeHtml(runeName)}</span>`);
  if (relicName)   equipParts.push(`<span class="comp-hover__equip">${escapeHtml(relicName)}</span>`);

  const tagPills = tags.map((t) => `<span class="comp-hover__tag">${escapeHtml(t)}</span>`).join("");
  const roleBadge = roleBadgeHtml(build, state.upgradeCatalog);

  card.innerHTML = `
    <div class="comp-hover__header">
      <span class="comp-hover__icon">${icon}</span>
      <div class="comp-hover__title-group">
        <span class="comp-hover__name">${name}</span>
        ${profLine ? `<span class="comp-hover__prof">${escapeHtml(profLine)}</span>` : ""}
      </div>
      <span class="comp-hover__mode">${escapeHtml(gameMode)}</span>
    </div>
    ${equipParts.length ? `<div class="comp-hover__equip-row">${equipParts.join('<span class="comp-hover__sep">·</span>')}</div>` : ""}
    ${tagPills ? `<div class="comp-hover__tags">${tagPills}</div>` : ""}
    ${roleBadge ? `<div class="comp-hover__role">${roleBadge}</div>` : ""}
  `;

  card.style.visibility = "hidden";
  document.body.appendChild(card);
  _activeHoverCard = card;

  // Position above the slot, clamped to viewport
  const sr = slotEl.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const vw = window.innerWidth;
  let top = sr.top - cr.height - 8;
  let left = sr.left + sr.width / 2 - cr.width / 2;
  if (top < 4) top = sr.bottom + 8;
  if (left < 4) left = 4;
  if (left + cr.width > vw - 4) left = vw - cr.width - 4;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.style.visibility = "";
}

function showSlotContextMenu(x, y, comp, lineId, slotIdx) {
  closeCompCtxMenu();

  const menu = document.createElement("div");
  menu.className = "lib-ctx-menu";
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Remove from Line
  const removeItem = document.createElement("div");
  removeItem.className = "lib-ctx-item";
  removeItem.innerHTML =
    `<span class="lib-ctx-item__icon"></span>` +
    `<span class="lib-ctx-item__label">Remove from Line</span>`;
  removeItem.addEventListener("click", async (e) => {
    e.stopPropagation();
    closeCompCtxMenu();
    const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
    if (!line) return;
    const slots = [...(line.slots || [])];
    slots.splice(slotIdx, 1);
    line.slots = slots;
    await saveAndSync(comp);
    _callbacks.onRerender?.();
  });
  menu.appendChild(removeItem);

  // Open Build
  const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
  const buildId = line?.slots?.[slotIdx];
  const build = buildId ? resolveBuild(buildId) : null;

  if (build) {
    const openItem = document.createElement("div");
    openItem.className = "lib-ctx-item";
    openItem.innerHTML =
      `<span class="lib-ctx-item__icon"></span>` +
      `<span class="lib-ctx-item__label">Open Build</span>`;
    openItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeCompCtxMenu();
      _callbacks.onOpenBuild?.(build);
    });
    menu.appendChild(openItem);
  }

  document.body.appendChild(menu);
  _activeCtxMenu = menu;

  // Reposition if overflowing viewport
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (rect.right > vw) menu.style.left = `${Math.max(0, vw - rect.width - 4)}px`;
  if (rect.bottom > vh) menu.style.top = `${Math.max(0, vh - rect.height - 4)}px`;

  // Close on click elsewhere
  const onDocClick = (e) => {
    if (_activeCtxMenu && !_activeCtxMenu.contains(e.target)) {
      closeCompCtxMenu();
      document.removeEventListener("click", onDocClick, true);
    }
  };
  // Use setTimeout so the current contextmenu event doesn't immediately close it
  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);

  // Close on Escape
  const onKeydown = (e) => {
    if (e.key === "Escape") {
      closeCompCtxMenu();
      document.removeEventListener("keydown", onKeydown);
    }
  };
  document.addEventListener("keydown", onKeydown);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTotalCapacity(comp) {
  if (!comp.partyLines) return 0;
  return comp.partyLines.reduce((sum, pl) => sum + (pl.capacity || 0), 0);
}

export function getTotalFilledSlots(comp) {
  if (!comp.partyLines) return 0;
  return comp.partyLines.reduce((sum, pl) => sum + (pl.slots || []).length, 0);
}

/**
 * Pure data mutation: move a build slot from one party line to another.
 * Expands the destination line's capacity if it is already full.
 * Returns true if the move was applied, false if it was a no-op.
 */
export function applyMoveSlotBetweenLines(comp, buildId, fromLineId, fromSlotIdx, toLineId) {
  if (fromLineId === toLineId) return false;
  const fromLine = (comp.partyLines || []).find((pl) => pl.id === fromLineId);
  const toLine = (comp.partyLines || []).find((pl) => pl.id === toLineId);
  if (!fromLine || !toLine) return false;
  if ((toLine.slots || []).length >= (toLine.capacity || 5)) {
    toLine.capacity = (toLine.slots || []).length + 1;
  }
  const fromSlots = [...(fromLine.slots || [])];
  fromSlots.splice(fromSlotIdx, 1);
  fromLine.slots = fromSlots;
  // Shrink source capacity back to natural size after removing a build
  fromLine.capacity = Math.max(5, fromLine.slots.length);
  toLine.slots = [...(toLine.slots || []), buildId];
  return true;
}

function resolveBuild(buildId) {
  return state.builds.find((b) => b.id === buildId) || null;
}

function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function updateSaveStatusText() {
  const el = document.getElementById("compSaveStatus");
  if (!el || !_lastSavedAt) return;
  el.textContent = `Saved ${formatTimeAgo(_lastSavedAt)}`;
  el.classList.remove("comp-detail__save-status--saving");
}

function showSaving() {
  const el = document.getElementById("compSaveStatus");
  if (!el) return;
  el.textContent = "Saving\u2026";
  el.classList.add("comp-detail__save-status--saving");
}

function startSaveStatusTicker() {
  if (_saveStatusInterval) clearInterval(_saveStatusInterval);
  _saveStatusInterval = setInterval(updateSaveStatusText, 5000);
}

async function saveAndSync(comp) {
  showSaving();
  const saved = await window.desktopApi.saveComp(comp);
  state.activeComp = saved;
  state.comps = await window.desktopApi.listComps();
  _lastSavedAt = new Date();
  updateSaveStatusText();
  return saved;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render the comp detail view into #comps-container.
 */
export function renderCompDetail() {
  destroyCompDragDrop();
  closeCompCtxMenu();
  closeHoverCard();
  closePartyCoverageExpand();
  if (_cleanupResize) { _cleanupResize(); _cleanupResize = null; }
  if (_saveStatusInterval) { clearInterval(_saveStatusInterval); _saveStatusInterval = null; }
  _lastSavedAt = null;
  // Restore original publish status element when re-rendering
  const origPublishEl = document.getElementById("publishStatus");
  if (origPublishEl) setPublishStatusEl(origPublishEl);

  const container = document.getElementById("comps-container");
  if (!container) return;

  const comp = state.activeComp;
  if (!comp) return;

  const totalCap = getTotalFilledSlots(comp);
  const notesOpen = state.compNotesOpen || false;
  const notesBtnClass = notesOpen ? "comp-detail__notes-btn comp-detail__notes-btn--active" : "comp-detail__notes-btn";

  container.innerHTML = `
    <div class="comp-detail">
      <div class="comp-detail__topbar">
        <button type="button" class="comp-detail__back-btn" data-action="back">&larr; Back to Comps</button>
        <span class="comp-detail__divider">|</span>
        <span class="comp-detail__name" data-action="edit-name">${escapeHtml(comp.name || "Untitled Comp")}</span>
        <span class="comp-detail__spacer"></span>
        <span class="comp-detail__save-status" id="compSaveStatus"></span>
        <div class="comp-share-dropdown">
          <button type="button" class="btn btn-secondary comp-share-dropdown__trigger" data-action="share-toggle">
            Share ${chevronDownIcon}
          </button>
          <div class="comp-share-dropdown__menu">
            <button type="button" class="comp-share-dropdown__item" data-action="copy-share-code">
              ${axiforgeIcon} AxiCode
            </button>
            <button type="button" class="comp-share-dropdown__item" data-action="share-discord">
              ${arrowUpTrayIcon} Discord Embed
            </button>
            <button type="button" class="comp-share-dropdown__item" data-action="copy-plaintext">
              ${clipboardDocumentIcon} Discord Plaintext
            </button>
            <div class="comp-share-dropdown__divider"></div>
            <button type="button" class="comp-share-dropdown__item" data-action="copy-published-link"${comp.publishedFileId ? "" : ' disabled title="Publish first"'}>
              ${globeAltIcon} Published Link
            </button>
          </div>
        </div>
        <button type="button" class="btn btn-primary" data-action="publish">Publish</button>
        <div class="publish-status" id="compPublishStatus"></div>
        <span class="comp-detail__discord-status" id="compDiscordStatus"></span>
        <button type="button" class="${notesBtnClass}" data-action="toggle-notes">Notes</button>
        <span class="comp-detail__slot-counter">${totalCap} / 50 slots</span>
      </div>
      ${renderTagsRow(comp)}
      ${notesOpen ? renderNotesPanel(comp) : ""}
      <div class="comp-detail__body">
        <div class="comp-detail__party-panel">
          ${renderPartyLines(comp, totalCap)}
        </div>
        <div class="comp-detail__resize-handle" title="Drag to resize"></div>
        <div class="comp-detail__pool-panel">
          ${renderBuildPool(comp)}
        </div>
      </div>
    </div>
  `;

  bindDetailEvents(container, comp);
  wireResizeHandle(container);

  // Initialize save status badge from comp's updatedAt
  if (!_lastSavedAt && comp.updatedAt) {
    _lastSavedAt = new Date(comp.updatedAt);
  }
  updateSaveStatusText();
  startSaveStatusTicker();

  wireCompDragDrop({
    async onDropBuildToLine(buildId, lineId) {
      const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
      if (!line) return;
      const slots = line.slots || [];
      if (slots.length >= (line.capacity || 5)) {
        line.capacity = slots.length + 1;
      }
      if (getTotalFilledSlots(comp) >= 50) return;
      _justDropped = true;
      setTimeout(() => { _justDropped = false; }, 200);
      line.slots = [...slots, buildId];
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    },
    async onRemoveSlotFromLine(lineId, slotIdx) {
      const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
      if (!line) return;
      const slots = [...(line.slots || [])];
      slots.splice(slotIdx, 1);
      line.slots = slots;
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    },
    async onReorderSlotsInLine(lineId, newSlots) {
      const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
      if (!line) return;
      line.slots = newSlots;
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    },
    async onMoveSlotToLine(buildId, fromLineId, fromSlotIdx, toLineId) {
      if (!applyMoveSlotBetweenLines(comp, buildId, fromLineId, fromSlotIdx, toLineId)) {
        // Slot was returned to its original line (same fromLineId/toLineId) — the DOM
        // item was already removed by onAdd, so re-render to restore the correct visual.
        _callbacks.onRerender?.();
        return;
      }
      _justDropped = true;
      setTimeout(() => { _justDropped = false; }, 200);
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    },
    async onReorderLines(oldIdx, newIdx) {
      if (oldIdx === newIdx) return;
      const lines = comp.partyLines || [];
      if (oldIdx < 0 || oldIdx >= lines.length) return;
      if (newIdx < 0 || newIdx >= lines.length) return;
      const [moved] = lines.splice(oldIdx, 1);
      lines.splice(newIdx, 0, moved);
      comp.partyLines = lines;
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    },
  });

  // Async patch: compute boon coverage and patch into the placeholder
  if (_callbacks.getCatalog) {
    const compIdAtRender = comp.id;
    (async () => {
      let data;
      try {
        data = await computeCompPartyCoverage(
          comp, state.builds, state.catalogCache, _callbacks.getCatalog, state.upgradeCatalog
        );
      } catch (err) {
        console.error("[comp-boon-coverage] computation failed", err);
        return;
      }
      // Guard: bail if user navigated away or opened a different comp
      if (state.activeComp?.id !== compIdAtRender) return;
      const bodyEl = container.querySelector("#comp-boon-coverage-body");
      if (!bodyEl) return;
      bodyEl.innerHTML = buildPartyCoverageHTML(data);
      bindPartyCoverageEvents(bodyEl);
    })();
  }
}

function renderNotesPanel(comp) {
  return `
    <div class="comp-detail__notes-panel">
      <textarea class="comp-detail__notes-textarea" data-action="notes-input"
                placeholder="Add notes about this comp...">${escapeHtml(comp.notes || "")}</textarea>
    </div>
  `;
}

function renderTagsRow(comp) {
  const tags = comp.tags || [];
  if (tags.length === 0) return "";
  const pills = tags
    .map((t) => `<span class="comp-detail__tag">${escapeHtml(t)}</span>`)
    .join("");
  return `<div class="comp-detail__tags-row">${pills}</div>`;
}

function renderPartyLines(comp, totalCap) {
  const lines = comp.partyLines || [];
  const lineRows = lines
    .map((pl, idx) => renderPartyLine(pl, idx, totalCap))
    .join("");

  const canAdd = totalCap < 50;  // totalCap is now filled slots
  const collapsed = state.compPrefs.boonCoverageCollapsed;
  return `
    ${lineRows}
    <div class="comp-line comp-line--add ${canAdd ? "" : "comp-line--disabled"}"
         data-action="add-line">
      <span class="comp-line__add-text">+ Add Line</span>
    </div>
    <div class="comp-line-trash">
      <span class="comp-line-trash__text">Remove</span>
    </div>
    <div class="comp-boon-cov">
      <div class="comp-boon-cov__header" data-action="toggle-boon-coverage">
        <span class="comp-boon-cov__chevron">${collapsed ? "▸" : "▾"}</span>
        <span class="comp-boon-cov__title">PARTY COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body${collapsed ? " comp-boon-cov__body--hidden" : ""}"
           id="comp-boon-coverage-body">
      </div>
    </div>
  `;
}

const PARTY_NUMBER_EMOJIS = [
  "\u0031\uFE0F\u20E3", "\u0032\uFE0F\u20E3", "\u0033\uFE0F\u20E3",
  "\u0034\uFE0F\u20E3", "\u0035\uFE0F\u20E3", "\u0036\uFE0F\u20E3",
  "\u0037\uFE0F\u20E3", "\u0038\uFE0F\u20E3", "\u0039\uFE0F\u20E3",
  "\uD83D\uDD1F",
];

function renderPartyLine(pl, idx, totalCap) {
  const capacity = pl.capacity || 5;
  const slots = pl.slots || [];

  const slotBoxes = [];

  // Filled slots
  for (let i = 0; i < slots.length && i < capacity; i++) {
    const buildId = slots[i];
    const build = resolveBuild(buildId);
    if (build) {
      const icon = getSpecIcon(build);
      const pClass = profClass(build.profession);
      const title = escapeHtml(build.title || "Untitled");
      slotBoxes.push(
        `<div class="comp-slot comp-slot--filled ${pClass}" title="${title}"
              data-action="click-filled-slot" data-line-id="${escapeHtml(pl.id)}" data-slot-idx="${i}" data-build-id="${escapeHtml(buildId)}">
          <span class="comp-slot__icon">${icon}</span>
        </div>`
      );
    } else {
      // Build reference not found — show as missing
      const truncId = buildId.length > 8 ? buildId.slice(0, 8) + "\u2026" : buildId;
      slotBoxes.push(
        `<div class="comp-slot comp-slot--missing" title="Missing build (${escapeHtml(truncId)})">
          <span class="comp-slot__missing-icon">?</span>
        </div>`
      );
    }
  }

  // Empty slots — fill the current row (multiple of 5), not the full capacity
  const filledCount = Math.min(slots.length, capacity);
  const visibleCapacity = Math.max(5, Math.ceil(Math.max(filledCount, 1) / 5) * 5);
  for (let i = filledCount; i < visibleCapacity; i++) {
    slotBoxes.push(
      `<div class="comp-slot comp-slot--empty" data-action="click-empty-slot" data-line-id="${escapeHtml(pl.id)}">
        <span class="comp-slot__plus">+</span>
      </div>`
    );
  }

  const multiRow = filledCount > 5;
  return `
    <div class="comp-line${multiRow ? " comp-line--multirow" : ""}" data-line-id="${escapeHtml(pl.id)}">
      <span class="comp-line__label">${PARTY_NUMBER_EMOJIS[idx] || `P${idx + 1}`}</span>
      <div class="comp-line__slots" data-capacity="${capacity}">${slotBoxes.join("")}</div>
      <div class="comp-line__controls">
        <button type="button" class="comp-line__btn" data-action="duplicate-line"
                data-line-id="${escapeHtml(pl.id)}" title="Duplicate line">&#10697;</button>
        <button type="button" class="comp-line__btn comp-line__btn--remove" data-action="remove-line"
                data-line-id="${escapeHtml(pl.id)}" title="Remove line">&times;</button>
      </div>
    </div>
  `;
}

// ─── Build Pool ──────────────────────────────────────────────────────────────

function renderBuildPool(comp) {
  // Builds in this comp are those listed in comp.buildIds
  const buildIdSet = new Set(comp.buildIds || []);
  const compBuilds = state.builds.filter((b) => buildIdSet.has(b.id));
  const search = (state.compPoolSearch || "").toLowerCase();

  const poolEntries = compBuilds.map((build) => ({ type: "build", build }));

  // Filter by search (missing builds don't match searches)
  const filtered = poolEntries.filter((entry) => {
    if (entry.type === "missing") return !search;
    const b = entry.build;
    if (!search) return true;
    const name = (b.title || "").toLowerCase();
    const prof = (b.profession || "").toLowerCase();
    const elite = (getEliteSpecName(b) || "").toLowerCase();
    return name.includes(search) || prof.includes(search) || elite.includes(search);
  });

  const cards = filtered.map((entry) => {
    if (entry.type === "missing") return renderMissingMiniBuildCard(entry.id);
    const b = entry.build;
    const otherComps = (state.comps || []).filter(
      (c) => c.id !== comp.id && (c.buildIds || []).includes(b.id),
    );
    const totalComps = otherComps.length + 1;
    const otherNames = otherComps.map((c) => c.name || "Untitled Comp");
    const tooltip = totalComps === 1
      ? "Linked build — lives in your library"
      : `Linked in ${totalComps} comps: ${[comp.name, ...otherNames].join(", ")}`;
    const label = totalComps > 1 ? `${totalComps} comps` : "linked";
    return renderMiniBuildCard(b, state.upgradeCatalog, {
      linkBadge: { label, tooltip },
    });
  }).join("");

  return `
    <div class="comp-pool">
      <div class="comp-pool-header">
        <span class="comp-pool-title">BUILDS <span class="comp-pool-count">(${compBuilds.length})</span></span>
        <div class="comp-pool-header__right">
          <input type="text" class="comp-pool-search" placeholder="Search..."
                 value="${escapeHtml(state.compPoolSearch || "")}" data-action="pool-search" />
          <button type="button" class="comp-pool-add" data-action="pool-add">+ Add</button>
        </div>
      </div>
      <div class="comp-pool-list">
        ${cards || '<p class="comp-pool-empty">No builds in pool</p>'}
      </div>
    </div>
  `;
}

// ─── Add Build Picker Modal ──────────────────────────────────────────────────

function openAddBuildModal(comp) {
  // Remove any existing modal
  document.querySelector(".comp-picker-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "comp-picker-overlay";

  // Available builds: those not already in this comp
  const currentBuildIds = new Set(comp.buildIds || []);
  const compFolder = comp.folderId ? state.folders?.find((f) => f.id === comp.folderId) : null;
  const available = state.builds.filter((b) => {
    if (currentBuildIds.has(b.id)) return false;
    if (comp.gameMode && b.gameMode !== comp.gameMode) return false;
    // For shared comps, only show builds from the same folder
    if (compFolder?.shared && b.folderId !== comp.folderId) return false;
    return true;
  });

  const selected = new Set();
  let searchTerm = "";

  function renderModalList() {
    const filtered = available.filter((b) => {
      if (!searchTerm) return true;
      const s = searchTerm.toLowerCase();
      const name = (b.title || "").toLowerCase();
      const prof = (b.profession || "").toLowerCase();
      const elite = (getEliteSpecName(b) || "").toLowerCase();
      return name.includes(s) || prof.includes(s) || elite.includes(s);
    });

    const rows = filtered.map((b) => {
      const icon = getSpecIcon(b);
      const pClass = profClass(b.profession);
      const checked = selected.has(b.id) ? "checked" : "";
      const displayName = escapeHtml(getDisplayName(b));
      const gear = escapeHtml(resolveStatPackage(b));
      const otherCompCount = (b.compIds || []).length;
      const compBadge = otherCompCount > 0
        ? `<span class="comp-picker-row__comp-count" title="Used in ${otherCompCount} comp${otherCompCount === 1 ? "" : "s"}">${otherCompCount} comp${otherCompCount === 1 ? "" : "s"}</span>`
        : "";
      return `
        <label class="comp-picker-row ${pClass}" data-build-id="${escapeHtml(b.id)}">
          <input type="checkbox" class="comp-picker-row__checkbox" value="${escapeHtml(b.id)}" ${checked} />
          <span class="comp-picker-row__icon">${icon}</span>
          <span class="comp-picker-row__name">${displayName}</span>
          ${compBadge}
          <span class="comp-picker-row__prof">${gear}</span>
        </label>
      `;
    }).join("");

    return rows || '<p class="comp-picker-empty">No builds available to add</p>';
  }

  function render() {
    overlay.innerHTML = `
      <div class="comp-picker-modal">
        <div class="comp-picker-modal__header">
          <span class="comp-picker-modal__title">Add Builds to Comp</span>
          <input type="text" class="comp-picker-modal__search" placeholder="Search builds..."
                 value="${escapeHtml(searchTerm)}" />
        </div>
        <div class="comp-picker-modal__list">
          ${renderModalList()}
        </div>
        <div class="comp-picker-modal__footer">
          <button type="button" class="comp-picker-modal__btn comp-picker-modal__btn--cancel"
                  data-action="picker-cancel">Cancel</button>
          <button type="button" class="comp-picker-modal__btn comp-picker-modal__btn--add"
                  data-action="picker-add" ${selected.size === 0 ? "disabled" : ""}>
            Add Selected (${selected.size})
          </button>
        </div>
      </div>
    `;

    // Bind modal events
    const searchInput = overlay.querySelector(".comp-picker-modal__search");
    searchInput?.addEventListener("input", (e) => {
      searchTerm = e.target.value;
      render();
      // Restore focus and cursor position
      const newInput = overlay.querySelector(".comp-picker-modal__search");
      if (newInput) {
        newInput.focus();
        newInput.selectionStart = newInput.selectionEnd = e.target.selectionStart;
      }
    });

    overlay.querySelectorAll(".comp-picker-row__checkbox").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) {
          selected.add(cb.value);
        } else {
          selected.delete(cb.value);
        }
        // Update footer button text without full re-render
        const addBtn = overlay.querySelector("[data-action='picker-add']");
        if (addBtn) {
          addBtn.textContent = `Add Selected (${selected.size})`;
          addBtn.disabled = selected.size === 0;
        }
      });
    });

    overlay.querySelector("[data-action='picker-cancel']")?.addEventListener("click", () => {
      overlay.remove();
    });

    overlay.querySelector("[data-action='picker-add']")?.addEventListener("click", async () => {
      if (selected.size === 0) return;
      // Add this comp to each selected build's compIds
      for (const buildId of selected) {
        const build = state.builds.find((b) => b.id === buildId);
        if (build) {
          const newCompIds = [...new Set([...(build.compIds || []), comp.id])];
          await window.desktopApi.saveBuild({ ...build, compIds: newCompIds });
        }
      }
      // Add to comp's buildIds and lock gameMode if not already set
      comp.buildIds = [...new Set([...(comp.buildIds || []), ...selected])];
      if (!comp.gameMode) {
        const firstSelectedBuild = state.builds.find((b) => selected.has(b.id));
        comp.gameMode = firstSelectedBuild?.gameMode || null;
      }
      await saveAndSync(comp);
      state.builds = await window.desktopApi.listBuilds();
      overlay.remove();
      _callbacks.onRerender?.();
    });
  }

  render();

  // Close on overlay background click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindDetailEvents(container, comp) {
  // Back button
  container.querySelector("[data-action='back']")?.addEventListener("click", () => {
    state.compPage = "list";
    state.activeComp = null;
    state.compNotesOpen = false;
    _callbacks.onRerender?.();
  });

  // ── Inline name editing ────────────────────────────────────────────────────
  const nameEl = container.querySelector("[data-action='edit-name']");
  if (nameEl) {
    nameEl.addEventListener("click", () => {
      // Replace the span with an input
      const input = document.createElement("input");
      input.type = "text";
      input.className = "comp-detail__name-input";
      input.value = comp.name || "";
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      let cancelled = false;

      const commitRename = async () => {
        if (cancelled) return;
        const newName = input.value.trim() || "Untitled Comp";
        comp.name = newName;
        await saveAndSync(comp);
        _callbacks.onRerender?.();
      };

      const cancelRename = () => {
        cancelled = true;
        _callbacks.onRerender?.();
      };

      input.addEventListener("blur", () => commitRename());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelRename();
        }
      });
    });
  }

  // ── Publish ────────────────────────────────────────────────────────────────
  container.querySelector("[data-action='publish']")?.addEventListener("click", async () => {
    // Point publish ticker at the comp-local status element
    const compEl = container.querySelector("#compPublishStatus");
    if (compEl) setPublishStatusEl(compEl);
    try {
      state.publishProgress[comp.id] = { currentStep: "saving" };
      showPublishProgress(comp.id);
      // Pre-compute boon coverage HTML to include in the published payload
      let boonCoverageHtml = "";
      try {
        const covData = await computeCompPartyCoverage(
          comp, state.builds, state.catalogCache, _callbacks.getCatalog, state.upgradeCatalog
        );
        boonCoverageHtml = buildPartyCoverageHTML(covData);
      } catch { /* skip if computation fails */ }
      const result = await window.desktopApi.publishComp(comp.id, boonCoverageHtml);
      advancePublishStep("pages");
      if (result?.pagesUrl) {
        state.publishProgress[comp.id] = { ...state.publishProgress[comp.id], result: result.pagesUrl };
        await window.desktopApi.writeClipboardText(result.pagesUrl);
        showPublishResult(result.pagesUrl);
      } else {
        state.publishProgress[comp.id] = { ...state.publishProgress[comp.id], result: "complete" };
        completeAllPublishSteps();
      }
      state.comps = await window.desktopApi.listComps();
      const pubLinkEl = container.querySelector("[data-action='copy-published-link']");
      if (pubLinkEl) { pubLinkEl.disabled = false; pubLinkEl.removeAttribute("title"); }
    } catch (err) {
      if (state.publishProgress[comp.id]) {
        state.publishProgress[comp.id].error = { step: "loading", message: err.message };
      }
      failPublishStep("loading", err.message);
    }
  });

  // ── Restore publish status if comp has active publish state ─────────────────
  if (state.publishProgress[comp.id]) {
    const compEl = container.querySelector("#compPublishStatus");
    if (compEl) {
      setPublishStatusEl(compEl);
      restorePublishProgress(comp.id);
    }
  }

  // ── Share dropdown ──────────────────────────────────────────────────────────
  const shareDropdown = container.querySelector(".comp-share-dropdown");
  const shareTrigger = container.querySelector("[data-action='share-toggle']");
  if (shareDropdown && shareTrigger) {
    shareTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = shareDropdown.classList.toggle("comp-share-dropdown--open");
      if (isOpen) {
        setTimeout(() => {
          const close = () => {
            shareDropdown.classList.remove("comp-share-dropdown--open");
            document.removeEventListener("click", close);
          };
          document.addEventListener("click", close);
        }, 0);
      }
    });

    // Flash an item as "Copied!" briefly
    function flashItem(item, orig) {
      item.innerHTML = `${checkIcon} Copied!`;
      item.classList.add("comp-share-dropdown__item--copied");
      setTimeout(() => {
        item.innerHTML = orig;
        item.classList.remove("comp-share-dropdown__item--copied");
      }, 1500);
    }

    // AxiCode
    const axiBtn = shareDropdown.querySelector("[data-action='copy-share-code']");
    const axiBtnDefault = axiBtn?.innerHTML;
    axiBtn?.addEventListener("click", async () => {
      if (axiBtn.classList.contains("comp-share-dropdown__item--copied")) return;
      try {
        const code = await window.desktopApi.encodeCompShareCode(comp.id);
        await window.desktopApi.writeClipboardText(code);
        flashItem(axiBtn, axiBtnDefault);
      } catch {
        axiBtn.innerHTML = "Failed";
        axiBtn.classList.add("comp-share-dropdown__item--error");
        setTimeout(() => {
          axiBtn.innerHTML = axiBtnDefault;
          axiBtn.classList.remove("comp-share-dropdown__item--error");
        }, 1500);
      }
    });

    // Discord Embed
    const embedBtn = shareDropdown.querySelector("[data-action='share-discord']");
    const embedBtnDefault = embedBtn?.innerHTML;
    embedBtn?.addEventListener("click", async () => {
      const webhookUrl = await window.desktopApi.getSetting("discord.webhookUrl");
      if (!webhookUrl) {
        showDiscordStatus("Set webhook URL in Settings first", true);
        return;
      }
      embedBtn.disabled = true;
      embedBtn.innerHTML = "Sharing...";
      try {
        const result = await window.desktopApi.shareCompToDiscord(comp.id);
        if (result.success) {
          flashItem(embedBtn, embedBtnDefault);
          showDiscordStatus("Shared to Discord!");
        } else {
          showDiscordStatus(result.error || "Failed to share", true);
          embedBtn.innerHTML = embedBtnDefault;
        }
      } catch (err) {
        showDiscordStatus(err.message || "Failed to share", true);
        embedBtn.innerHTML = embedBtnDefault;
      } finally {
        embedBtn.disabled = false;
      }
    });

    // Discord Plaintext
    const plainBtn = shareDropdown.querySelector("[data-action='copy-plaintext']");
    const plainBtnDefault = plainBtn?.innerHTML;
    plainBtn?.addEventListener("click", async () => {
      if (plainBtn.classList.contains("comp-share-dropdown__item--copied")) return;
      try {
        const text = await window.desktopApi.generateCompPlaintext(comp.id);
        await window.desktopApi.writeClipboardText(text);
        flashItem(plainBtn, plainBtnDefault);
      } catch {
        plainBtn.innerHTML = "Failed";
        plainBtn.classList.add("comp-share-dropdown__item--error");
        setTimeout(() => {
          plainBtn.innerHTML = plainBtnDefault;
          plainBtn.classList.remove("comp-share-dropdown__item--error");
        }, 1500);
      }
    });

    // Published Link
    const pubLinkBtn = shareDropdown.querySelector("[data-action='copy-published-link']");
    const pubLinkBtnDefault = pubLinkBtn?.innerHTML;
    pubLinkBtn?.addEventListener("click", async () => {
      if (pubLinkBtn.disabled || pubLinkBtn.classList.contains("comp-share-dropdown__item--copied")) return;
      try {
        const url = await window.desktopApi.getCompPublishedUrl(comp.id);
        if (!url) return;
        await window.desktopApi.writeClipboardText(url);
        flashItem(pubLinkBtn, pubLinkBtnDefault);
        showToast("Link copied!");
      } catch {
        pubLinkBtn.innerHTML = "Failed";
        pubLinkBtn.classList.add("comp-share-dropdown__item--error");
        setTimeout(() => {
          pubLinkBtn.innerHTML = pubLinkBtnDefault;
          pubLinkBtn.classList.remove("comp-share-dropdown__item--error");
        }, 1500);
      }
    });
  }

  // ── Notes toggle ───────────────────────────────────────────────────────────
  container.querySelector("[data-action='toggle-notes']")?.addEventListener("click", () => {
    state.compNotesOpen = !state.compNotesOpen;
    _callbacks.onRerender?.();
  });

  // ── Notes textarea auto-save ───────────────────────────────────────────────
  const notesTextarea = container.querySelector("[data-action='notes-input']");
  if (notesTextarea) {
    notesTextarea.addEventListener("input", () => {
      if (_notesDebounceTimer) clearTimeout(_notesDebounceTimer);
      _notesDebounceTimer = setTimeout(async () => {
        comp.notes = notesTextarea.value;
        await saveAndSync(comp);
      }, 300);
    });
  }

  // Add line
  container.querySelector("[data-action='add-line']")?.addEventListener("click", async () => {
    if (getTotalFilledSlots(comp) >= 50) return;
    const newLine = { id: crypto.randomUUID(), capacity: 5, slots: [] };
    comp.partyLines = [...(comp.partyLines || []), newLine];
    await saveAndSync(comp);
    _callbacks.onRerender?.();
  });

  // Remove line
  container.querySelectorAll("[data-action='remove-line']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const lineId = btn.dataset.lineId;
      comp.partyLines = (comp.partyLines || []).filter((pl) => pl.id !== lineId);
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    });
  });

  // Duplicate line
  container.querySelectorAll("[data-action='duplicate-line']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const lineId = btn.dataset.lineId;
      const source = (comp.partyLines || []).find((pl) => pl.id === lineId);
      if (!source) return;
      if (getTotalFilledSlots(comp) + (source.slots || []).length > 50) return;

      const clone = {
        id: crypto.randomUUID(),
        capacity: source.capacity,
        slots: [...source.slots],
      };

      const idx = comp.partyLines.indexOf(source);
      comp.partyLines = [
        ...comp.partyLines.slice(0, idx + 1),
        clone,
        ...comp.partyLines.slice(idx + 1),
      ];
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    });
  });


  // ── Filled slot click → open build ─────────────────────────────────────────
  container.querySelectorAll("[data-action='click-filled-slot']").forEach((slot) => {
    // Hover → show delayed build card
    slot.addEventListener("mouseenter", () => {
      const build = resolveBuild(slot.dataset.buildId);
      if (!build) return;
      _hoverTimer = setTimeout(() => showSlotHoverCard(slot, build), 600);
    });
    slot.addEventListener("mouseleave", closeHoverCard);

    // Left click → open build in editor
    slot.addEventListener("click", (e) => {
      closeHoverCard();
      e.stopPropagation();
      const buildId = slot.dataset.buildId;
      const build = buildId ? resolveBuild(buildId) : null;
      if (build) {
        _callbacks.onOpenBuild?.(build);
      }
    });

    // Right click → context menu
    slot.addEventListener("contextmenu", (e) => {
      closeHoverCard();
      e.preventDefault();
      e.stopPropagation();
      const lineId = slot.dataset.lineId;
      const slotIdx = parseInt(slot.dataset.slotIdx, 10);
      showSlotContextMenu(e.clientX, e.clientY, comp, lineId, slotIdx);
    });
  });

  // ── Boon coverage collapse toggle ──────────────────────────────────────────
  container.querySelector("[data-action='toggle-boon-coverage']")?.addEventListener("click", () => {
    closePartyCoverageExpand();
    state.compPrefs.boonCoverageCollapsed = !state.compPrefs.boonCoverageCollapsed;
    const collapsed = state.compPrefs.boonCoverageCollapsed;
    const bodyEl = container.querySelector("#comp-boon-coverage-body");
    if (bodyEl) bodyEl.classList.toggle("comp-boon-cov__body--hidden", collapsed);
    const chevronEl = container.querySelector(".comp-boon-cov__chevron");
    if (chevronEl) chevronEl.textContent = collapsed ? "▸" : "▾";
  });

  // ── Build Pool Events ──────────────────────────────────────────────────────

  bindPoolEvents(container, comp);
}

function bindPoolEvents(container, comp) {
  // Pool search
  container.querySelector("[data-action='pool-search']")?.addEventListener("input", (e) => {
    state.compPoolSearch = e.target.value;
    const cursorPos = e.target.selectionStart;
    // Re-render just the pool panel
    const poolPanel = container.querySelector(".comp-detail__pool-panel");
    if (poolPanel) {
      poolPanel.innerHTML = renderBuildPool(comp);
      // Re-bind pool events after re-render
      bindPoolEvents(container, comp);
      // Restore focus to the search input
      const newInput = container.querySelector("[data-action='pool-search']");
      if (newInput) {
        newInput.focus();
        newInput.selectionStart = newInput.selectionEnd = cursorPos;
      }
    }
  });

  // Pool add button
  container.querySelector("[data-action='pool-add']")?.addEventListener("click", () => {
    openAddBuildModal(comp);
  });

  // Pool card open buttons
  container.querySelectorAll("[data-action='pool-open']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const buildId = btn.dataset.buildId;
      const build = buildId ? state.builds.find((b) => b.id === buildId) : null;
      if (build) _callbacks.onOpenBuild?.(build);
    });
  });

  // Pool card remove buttons
  container.querySelectorAll("[data-action='pool-remove']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const buildId = btn.dataset.buildId;
      if (!buildId) return;

      // Remove this comp from the build's compIds
      const build = state.builds.find((b) => b.id === buildId);
      if (build) {
        const newCompIds = (build.compIds || []).filter((id) => id !== comp.id);
        await window.desktopApi.saveBuild({ ...build, compIds: newCompIds });
      }

      // Remove from buildIds and party line slots
      comp.buildIds = (comp.buildIds || []).filter((id) => id !== buildId);
      for (const line of (comp.partyLines || [])) {
        line.slots = (line.slots || []).filter((id) => id !== buildId);
      }

      await saveAndSync(comp);
      state.builds = await window.desktopApi.listBuilds();
      _callbacks.onRerender?.();
    });
  });
}
