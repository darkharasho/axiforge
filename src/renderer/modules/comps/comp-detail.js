// Comp detail view — renders party lines panel + build pool.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { getProfessionSvg } from "../profession-icons.js";
import { wireCompDragDrop, destroyCompDragDrop } from "./comp-drag-drop.js";

let _callbacks = {};
let _notesDebounceTimer = null;
let _activeCtxMenu = null;

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
 * Runes is a map of slot->name; we pick the most common non-empty value.
 */
function getRuneName(build) {
  const runes = build.equipment?.runes;
  if (!runes || typeof runes !== "object") return "";
  const counts = {};
  for (const v of Object.values(runes)) {
    if (v) counts[v] = (counts[v] || 0) + 1;
  }
  let best = "";
  let bestCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > bestCount) { best = name; bestCount = count; }
  }
  return best;
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
        <div class="comp-detail__pool-panel">
          ${renderBuildPool(comp)}
        </div>
      </div>
    </div>
  `;

  bindDetailEvents(container, comp);

  wireCompDragDrop({
    async onDropBuildToLine(buildId, lineId) {
      const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
      if (!line) return;
      const slots = line.slots || [];
      if (slots.length >= (line.capacity || 5)) return;
      if (getTotalCapacity(comp) >= 50) return;
      line.slots = [...slots, buildId];
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

  return `
    ${lineRows}
    <div class="comp-line comp-line--add ${canAdd ? "" : "comp-line--disabled"}"
         data-action="add-line">
      <span class="comp-line__add-text">+ Add Line</span>
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
      <div class="comp-line__slots">${slotBoxes.join("")}</div>
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
  const buildIds = comp.buildIds || [];
  const search = (state.compPoolSearch || "").toLowerCase();

  // Resolve builds — keep missing IDs as placeholders
  const poolEntries = buildIds.map((id) => {
    const build = resolveBuild(id);
    return build ? { type: "build", build } : { type: "missing", id };
  });

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
        <span class="comp-pool-title">BUILDS <span class="comp-pool-count">(${buildIds.length})</span></span>
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
  const statPackage = build.equipment?.statPackage || "";
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
        </div>
        ${bottomParts.length ? `<div class="comp-pool-card__bottom">${bottomParts.join("")}</div>` : ""}
      </div>
      <span class="comp-pool-card__mode">${escapeHtml(gameMode)}</span>
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

  const poolIds = new Set(comp.buildIds || []);
  const available = state.builds.filter((b) => !poolIds.has(b.id));

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
      const prof = escapeHtml(b.profession || "");
      return `
        <label class="comp-picker-row ${pClass}" data-build-id="${escapeHtml(b.id)}">
          <input type="checkbox" class="comp-picker-row__checkbox" value="${escapeHtml(b.id)}" ${checked} />
          <span class="comp-picker-row__icon">${icon}</span>
          <span class="comp-picker-row__name">${displayName}</span>
          <span class="comp-picker-row__prof">${prof}</span>
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
      comp.buildIds = [...(comp.buildIds || []), ...selected];
      await saveAndSync(comp);
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

  // Click empty slot — increment capacity
  container.querySelectorAll("[data-action='click-empty-slot']").forEach((slot) => {
    slot.addEventListener("click", async (e) => {
      e.stopPropagation();
      const lineId = slot.dataset.lineId;
      if (getTotalCapacity(comp) >= 50) return;
      const line = (comp.partyLines || []).find((pl) => pl.id === lineId);
      if (!line) return;
      line.capacity = (line.capacity || 5) + 1;
      await saveAndSync(comp);
      _callbacks.onRerender?.();
    });
  });

  // ── Filled slot click → open build ─────────────────────────────────────────
  container.querySelectorAll("[data-action='click-filled-slot']").forEach((slot) => {
    // Left click → open build in editor
    slot.addEventListener("click", (e) => {
      e.stopPropagation();
      const buildId = slot.dataset.buildId;
      const build = buildId ? resolveBuild(buildId) : null;
      if (build) {
        _callbacks.onOpenBuild?.(build);
      }
    });

    // Right click → context menu
    slot.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const lineId = slot.dataset.lineId;
      const slotIdx = parseInt(slot.dataset.slotIdx, 10);
      showSlotContextMenu(e.clientX, e.clientY, comp, lineId, slotIdx);
    });
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

  // Pool card remove buttons
  container.querySelectorAll("[data-action='pool-remove']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const buildId = btn.dataset.buildId;
      if (!buildId) return;

      // Remove from buildIds
      comp.buildIds = (comp.buildIds || []).filter((id) => id !== buildId);

      // Remove from all party line slots
      for (const line of (comp.partyLines || [])) {
        line.slots = (line.slots || []).filter((id) => id !== buildId);
      }

      await saveAndSync(comp);
      _callbacks.onRerender?.();
    });
  });
}
