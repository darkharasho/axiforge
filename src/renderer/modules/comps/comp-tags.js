// The comp tag UI: the row of pills on the comp detail, and the popover that
// edits them. The popover started life inside the comp list as a bulk-only
// affordance; the comp detail and the single-comp context menu want exactly the
// same thing, so it lives here rather than being reimplemented and drifting.
//
// It edits a SET of comps because "tag these three" and "tag this one" are the
// same operation with a different list length — a checkbox is checked only when
// every comp in the set carries the tag, and toggling it adds or removes across
// the whole set.

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";

let _open = null;

/** Every tag anyone has used, so you pick from the vocabulary you already have. */
export function collectAllCompTags() {
  const tagSet = new Set();
  for (const c of state.comps || []) {
    if (c.tags) for (const t of c.tags) tagSet.add(t);
  }
  return [...tagSet].sort();
}

export function closeCompTagPopover() {
  if (!_open) return;
  const { el, teardown } = _open;
  _open = null;
  teardown();
  el.remove();
}

/**
 * @param {Element|{left:number,bottom:number}} anchor element to hang under, or a point
 * @param {object} opts
 * @param {string[]} opts.ids comps to edit
 * @param {(ids:string[], tags:string[])=>Promise<void>} opts.onAddTags
 * @param {(ids:string[], tags:string[])=>Promise<void>} opts.onRemoveTags
 */
export function openCompTagPopover(anchor, { ids, onAddTags, onRemoveTags } = {}) {
  closeCompTagPopover();
  if (!ids || ids.length === 0) return null;

  const allTags = collectAllCompTags();
  const selected = (state.comps || []).filter((c) => ids.includes(c.id));
  const onEvery = (tag) => selected.length > 0 && selected.every((c) => (c.tags || []).includes(tag));

  const popover = document.createElement("div");
  popover.className = "comp-tag-popover";
  popover.innerHTML = `
    <div class="comp-tag-popover__header">Manage Tags</div>
    <div class="comp-tag-popover__list">
      ${allTags.length === 0
        ? `<div class="comp-tag-popover__empty">No tags yet</div>`
        : allTags.map((t) => `
        <label class="comp-tag-popover__item">
          <input type="checkbox" data-comp-tag="${escapeHtml(t)}" ${onEvery(t) ? "checked" : ""} />
          <span>${escapeHtml(t)}</span>
        </label>
      `).join("")}
    </div>
    <div class="comp-tag-popover__add">
      <input type="text" placeholder="New tag…" class="comp-tag-popover__input" />
      <button type="button" class="comp-tag-popover__add-btn">Add</button>
    </div>
  `;

  popover.style.position = "fixed";
  popover.style.zIndex = "9999";
  popover.style.visibility = "hidden";
  document.body.appendChild(popover);

  // Placed after insertion so the measured height can keep it on screen — a
  // popover opened from a tag row near the bottom would otherwise run off.
  const rect = anchor instanceof Element
    ? anchor.getBoundingClientRect()
    : { left: anchor?.left || 0, bottom: anchor?.bottom || 0 };
  const own = popover.getBoundingClientRect();
  const maxLeft = window.innerWidth - own.width - 4;
  const maxTop = window.innerHeight - own.height - 4;
  popover.style.left = `${Math.max(4, Math.min(rect.left, maxLeft))}px`;
  popover.style.top = `${Math.max(4, Math.min(rect.bottom + 4, maxTop))}px`;
  popover.style.visibility = "";

  popover.querySelectorAll("[data-comp-tag]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const tag = cb.dataset.compTag;
      if (cb.checked) await onAddTags?.(ids, [tag]);
      else await onRemoveTags?.(ids, [tag]);
    });
  });

  const addBtn = popover.querySelector(".comp-tag-popover__add-btn");
  const addInput = popover.querySelector(".comp-tag-popover__input");
  if (addBtn && addInput) {
    const doAdd = async () => {
      const tag = addInput.value.trim();
      if (!tag) return;
      addInput.value = "";
      await onAddTags?.(ids, [tag]);
    };
    addBtn.addEventListener("click", doAdd);
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doAdd();
      if (e.key === "Escape") closeCompTagPopover();
    });
  }

  const onOutside = (e) => {
    if (popover.contains(e.target)) return;
    if (anchor instanceof Element && anchor.contains(e.target)) return;
    closeCompTagPopover();
  };
  const onKey = (e) => { if (e.key === "Escape") closeCompTagPopover(); };
  const teardown = () => {
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey);
  };
  setTimeout(() => {
    if (!_open) return;
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
  }, 0);

  _open = { el: popover, teardown };
  return popover;
}

/**
 * The pill row on the comp detail. Always rendered, even with no tags: it used
 * to vanish when a comp had none, which meant the only place to add the first
 * one was the list view's bulk bar — you had to leave the comp to tag the comp.
 */
export function renderCompTagsRow(comp) {
  const tags = comp?.tags || [];
  const pills = tags
    .map((t) => `
      <span class="comp-detail__tag">
        ${escapeHtml(t)}
        <button type="button" class="comp-detail__tag-remove" data-action="remove-tag"
                data-tag="${escapeHtml(t)}" title="Remove tag">&times;</button>
      </span>`)
    .join("");
  const addLabel = tags.length === 0 ? "+ Add tags" : "+ Tag";
  return `
    <div class="comp-detail__tags-row">
      ${pills}
      <button type="button" class="comp-detail__tag-add" data-action="edit-tags">${addLabel}</button>
    </div>
  `;
}
