// Comp detail view — renders party lines panel + build pool placeholder.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { getProfessionSvg } from "../profession-icons.js";

let _callbacks = {};

/**
 * Store callbacks for detail actions.
 * @param {{ onBack: Function, onRerender: Function }} callbacks
 */
export function initCompDetail(callbacks) {
  _callbacks = callbacks || {};
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

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render the comp detail view into #comps-container.
 */
export function renderCompDetail() {
  const container = document.getElementById("comps-container");
  if (!container) return;

  const comp = state.activeComp;
  if (!comp) return;

  const totalCap = getTotalCapacity(comp);

  container.innerHTML = `
    <div class="comp-detail">
      <div class="comp-detail__topbar">
        <button type="button" class="comp-detail__back-btn" data-action="back">&larr; Back to Comps</button>
        <span class="comp-detail__divider">|</span>
        <span class="comp-detail__name">${escapeHtml(comp.name || "Untitled Comp")}</span>
        <span class="comp-detail__spacer"></span>
        <button type="button" class="comp-detail__notes-btn" disabled>Notes</button>
        <span class="comp-detail__slot-counter">${totalCap} / 50 slots</span>
      </div>
      ${renderTagsRow(comp)}
      <div class="comp-detail__body">
        <div class="comp-detail__party-panel">
          ${renderPartyLines(comp, totalCap)}
        </div>
        <div class="comp-detail__pool-panel">
          <p style="padding:20px;color:#888;">Build pool &mdash; coming in Task 6</p>
        </div>
      </div>
    </div>
  `;

  bindDetailEvents(container, comp);
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
        `<div class="comp-slot comp-slot--filled ${pClass}" title="${title}">
          <span class="comp-slot__icon">${icon}</span>
        </div>`
      );
    } else {
      // Build reference not found — show as empty
      slotBoxes.push(
        `<div class="comp-slot comp-slot--empty" data-action="click-empty-slot" data-line-id="${escapeHtml(pl.id)}">
          <span class="comp-slot__plus">+</span>
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

// ─── Event binding ────────────────────────────────────────────────────────────

function bindDetailEvents(container, comp) {
  // Back button
  container.querySelector("[data-action='back']")?.addEventListener("click", () => {
    state.compPage = "list";
    state.activeComp = null;
    _callbacks.onRerender?.();
  });

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
}
