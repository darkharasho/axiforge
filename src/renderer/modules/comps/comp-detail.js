// Comp detail view — renders party lines panel + build pool.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { getProfessionSvg } from "../profession-icons.js";
import { wireCompDragDrop, destroyCompDragDrop } from "./comp-drag-drop.js";
import { roleBadgeHtml } from "../roleEstimator.js";
import { computeCompBoonCoverage, buildBoonCoverageHTML, bindBoonCoverageEvents, closeBoonTooltip } from "./comp-boon-coverage.js";

let _callbacks = {};
let _notesDebounceTimer = null;
let _activeCtxMenu = null;
let _justDropped = false;
let _hoverTimer = null;
let _activeHoverCard = null;
let _cleanupResize = null;

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
  const runeName = getRuneName(build);
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

function getEliteSpecName(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

function getSpecIcon(build) {
  const eliteSpec = getEliteSpecName(build);
  const name = eliteSpec || build.profession;
  if (!name) return "";
  return getProfessionSvg(name) || "";
}

function profClass(profession) {
  if (!profession) return "";
  return `lib-prof--${profession.toLowerCase()}`;
}

function getTotalCapacity(comp) {
  if (!comp.partyLines) return 0;
  return comp.partyLines.reduce((sum, pl) => sum + (pl.capacity || 0), 0);
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

async function saveAndSync(comp) {
  const saved = await window.desktopApi.saveComp(comp);
  state.activeComp = saved;
  state.comps = await window.desktopApi.listComps();
  return saved;
}

/**
 * Extract the primary rune name from the equipment runes object.
 * Runes are stored as numeric IDs; resolve via upgrade catalog when available.
 */
function getRuneName(build) {
  const runes = build.equipment?.runes;
  if (!runes || typeof runes !== "object") return "";
  const counts = {};
  for (const v of Object.values(runes)) {
    if (v) counts[String(v)] = (counts[String(v)] || 0) + 1;
  }
  let bestId = "";
  let bestCount = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > bestCount) { bestId = id; bestCount = count; }
  }
  if (!bestId) return "";

  // Try to resolve the ID to a human name via the upgrade catalog
  const runeDef = state.upgradeCatalog?.runeById?.get(Number(bestId));
  if (runeDef?.name) {
    // "Superior Rune of the Scholar" → "Scholar"
    return runeDef.name.replace(/^(?:Superior|Major|Minor) Rune of (?:the )?/i, "");
  }

  // Fall back: if already a non-numeric label, return as-is
  return /^\d+$/.test(bestId) ? "" : bestId;
}

/**
 * Resolve a human-readable stat package label for a build.
 * Falls back to deriving from equipment slot values when statPackage is a raw ID.
 */
function resolveStatPackage(build) {
  const pkg = build.equipment?.statPackage || "";
  if (pkg && !/^\d+$/.test(pkg)) return pkg; // already a label

  // Derive from the most common slot stat combo
  const slots = build.equipment?.slots;
  if (slots && typeof slots === "object") {
    const counts = {};
    for (const v of Object.values(slots)) {
      if (v && typeof v === "string") counts[v] = (counts[v] || 0) + 1;
    }
    let best = "";
    let bestCount = 0;
    for (const [label, count] of Object.entries(counts)) {
      if (count > bestCount) { best = label; bestCount = count; }
    }
    if (best) return best;
  }

  return ""; // can't resolve — show nothing rather than a raw ID
}

function getDisplayName(build) {
  const elite = getEliteSpecName(build);
  return build.title || elite || build.profession || "Untitled";
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render the comp detail view into #comps-container.
 */
export function renderCompDetail() {
  destroyCompDragDrop();
  closeCompCtxMenu();
  closeHoverCard();
  closeBoonTooltip();
  if (_cleanupResize) { _cleanupResize(); _cleanupResize = null; }

  const container = document.getElementById("comps-container");
  if (!container) return;

  const comp = state.activeComp;
  if (!comp) return;

  const totalCap = getTotalCapacity(comp);
  const notesOpen = state.compNotesOpen || false;
  const notesBtnClass = notesOpen ? "comp-detail__notes-btn comp-detail__notes-btn--active" : "comp-detail__notes-btn";

  container.innerHTML = `
    <div class="comp-detail">
      <div class="comp-detail__topbar">
        <button type="button" class="comp-detail__back-btn" data-action="back">&larr; Back to Comps</button>
        <span class="comp-detail__divider">|</span>
        <span class="comp-detail__name" data-action="edit-name">${escapeHtml(comp.name || "Untitled Comp")}</span>
        <span class="comp-detail__spacer"></span>
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

  wireCompDragDrop({
    async onDropBuildToLine(buildId, lineId) {
      const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
      if (!line) return;
      const slots = line.slots || [];
      if (slots.length >= (line.capacity || 5)) return;
      if (getTotalCapacity(comp) >= 50) return;
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
        data = await computeCompBoonCoverage(
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
      bodyEl.innerHTML = buildBoonCoverageHTML(data);
      bindBoonCoverageEvents(bodyEl);
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

  const canAdd = totalCap < 50;
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
        <span class="comp-boon-cov__title">BOON COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body${collapsed ? " comp-boon-cov__body--hidden" : ""}"
           id="comp-boon-coverage-body">
      </div>
    </div>
  `;
}

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

  // Empty slots (remaining capacity)
  const filledCount = Math.min(slots.length, capacity);
  for (let i = filledCount; i < capacity; i++) {
    slotBoxes.push(
      `<div class="comp-slot comp-slot--empty" data-action="click-empty-slot" data-line-id="${escapeHtml(pl.id)}">
        <span class="comp-slot__plus">+</span>
      </div>`
    );
  }

  return `
    <div class="comp-line" data-line-id="${escapeHtml(pl.id)}">
      <span class="comp-line__label">P${idx + 1}</span>
      <div class="comp-line__slots" data-capacity="${capacity}" style="max-height: ${Math.ceil(capacity / 5) * 42 + (Math.ceil(capacity / 5) - 1) * 5}px;">${slotBoxes.join("")}</div>
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
  // Builds in this comp are those with compId matching
  const compBuilds = state.builds.filter((b) => b.compId === comp.id);
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
    if (entry.type === "missing") return renderMissingPoolCard(entry.id);
    return renderPoolCard(entry.build);
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

function renderPoolCard(build) {
  const icon = getSpecIcon(build);
  const pClass = profClass(build.profession);
  const name = escapeHtml(getDisplayName(build));
  const gameMode = build.gameMode || "pve";

  // Equipment details
  const statPackage = resolveStatPackage(build);
  const runeName = getRuneName(build);
  const relicName = build.equipment?.relic || "";

  // Build bottom line parts (stat · rune · relic)
  const bottomParts = [];
  if (statPackage) {
    bottomParts.push(`<span class="comp-pool-card__stat">${escapeHtml(statPackage)}</span>`);
  }
  if (runeName) {
    if (bottomParts.length) bottomParts.push(`<span class="comp-pool-card__sep">&middot;</span>`);
    bottomParts.push(`<span class="comp-pool-card__equip">${escapeHtml(runeName)}</span>`);
  }
  if (relicName) {
    if (bottomParts.length) bottomParts.push(`<span class="comp-pool-card__sep">&middot;</span>`);
    bottomParts.push(`<span class="comp-pool-card__equip">${escapeHtml(relicName)}</span>`);
  }

  // Tag pills
  const tagPills = (build.tags || [])
    .map((t) => `<span class="comp-pool-tag">${escapeHtml(t)}</span>`)
    .join("");

  return `
    <div class="comp-pool-card ${pClass}" data-build-id="${escapeHtml(build.id)}">
      <div class="comp-pool-card__icon">${icon}</div>
      <div class="comp-pool-card__info">
        <div class="comp-pool-card__top">
          <span class="comp-pool-card__name">${name}</span>
          ${tagPills}
          ${roleBadgeHtml(build, state.upgradeCatalog)}
        </div>
        ${bottomParts.length ? `<div class="comp-pool-card__bottom">${bottomParts.join("")}</div>` : ""}
      </div>
      <span class="comp-pool-card__mode">${escapeHtml(gameMode)}</span>
      <button type="button" class="comp-pool-card__open" data-action="pool-open"
              data-build-id="${escapeHtml(build.id)}" title="Open build">&#8599;</button>
      <button type="button" class="comp-pool-card__remove" data-action="pool-remove"
              data-build-id="${escapeHtml(build.id)}" title="Remove from comp">&times;</button>
    </div>
  `;
}

function renderMissingPoolCard(buildId) {
  const truncId = buildId.length > 12 ? buildId.slice(0, 12) + "\u2026" : buildId;
  return `
    <div class="comp-pool-card comp-pool-card--missing" data-build-id="${escapeHtml(buildId)}">
      <div class="comp-pool-card__icon comp-pool-card__icon--missing">?</div>
      <div class="comp-pool-card__info">
        <div class="comp-pool-card__top">
          <span class="comp-pool-card__name comp-pool-card__name--missing">Missing Build</span>
        </div>
        <div class="comp-pool-card__bottom">
          <span class="comp-pool-card__equip">${escapeHtml(truncId)}</span>
        </div>
      </div>
      <button type="button" class="comp-pool-card__remove" data-action="pool-remove"
              data-build-id="${escapeHtml(buildId)}" title="Remove from comp">&times;</button>
    </div>
  `;
}

// ─── Add Build Picker Modal ──────────────────────────────────────────────────

function openAddBuildModal(comp) {
  // Remove any existing modal
  document.querySelector(".comp-picker-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "comp-picker-overlay";

  // Available builds: those not already in this comp (and not in another comp)
  const available = state.builds.filter((b) => {
    if (b.compId) return false;
    if (comp.gameMode && b.gameMode !== comp.gameMode) return false;
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
      return `
        <label class="comp-picker-row ${pClass}" data-build-id="${escapeHtml(b.id)}">
          <input type="checkbox" class="comp-picker-row__checkbox" value="${escapeHtml(b.id)}" ${checked} />
          <span class="comp-picker-row__icon">${icon}</span>
          <span class="comp-picker-row__name">${displayName}</span>
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
      // Move each selected build into this comp
      for (const buildId of selected) {
        const build = state.builds.find((b) => b.id === buildId);
        if (build) {
          await window.desktopApi.saveBuild({ ...build, compId: comp.id, folderId: null });
        }
      }
      // Add to comp's buildIds and lock gameMode if not already set
      comp.buildIds = [...new Set([...(comp.buildIds || []), ...selected])];
      if (!comp.gameMode) {
        const firstSelectedBuild = state.builds.find((b) => selected.has(b.id));
        comp.gameMode = firstSelectedBuild?.gameMode || null;
      }
      await saveAndSync(comp);
      // Reload builds since we modified them
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
    if (getTotalCapacity(comp) >= 50) return;
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
      if (getTotalCapacity(comp) + (source.capacity || 5) > 50) return;

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

      // Clear compId on the build — moves it back to root
      const build = state.builds.find((b) => b.id === buildId);
      if (build) {
        await window.desktopApi.saveBuild({ ...build, compId: null });
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
