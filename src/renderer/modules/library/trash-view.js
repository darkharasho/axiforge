// The trash view — what the library shows once deleting stages instead of destroys.
//
// Kept apart from content.js on purpose: the rows here are records that no
// longer exist as far as the rest of the library is concerned, so none of the
// build/folder/comp rendering, selection or drag-drop machinery applies to them.
// The only two things you can do to a trashed item are put it back or finish
// the job, and both are per-row buttons rather than the shared context menu.

import { escapeHtml } from "../utils.js";
import { folderIcon, compIcon, trashIcon, documentDuplicateIcon } from "./heroicons.js";

// Mirrors RETENTION_DAYS in src/main/trash.js. The renderer only uses it to
// count down in the UI; main is what actually purges.
export const RETENTION_DAYS = 30;
const DAY_MS = 86400000;
// Below this, the row is tinted. A countdown you have to read is not a warning.
const EXPIRING_DAYS = 7;

/**
 * How much longer this item can still be restored.
 * @param {string} deletedAt - ISO stamp
 * @param {Date|string} now
 */
export function daysLeft(deletedAt, now = new Date()) {
  const elapsed = new Date(now).getTime() - new Date(deletedAt).getTime();
  return Math.max(0, RETENTION_DAYS - Math.floor(elapsed / DAY_MS));
}

/** A one-line description of what restoring this row brings back. */
export function trashItemLabel(item) {
  if (item.type === "folder") return "Folder, with everything inside it";
  if (item.type === "comp") return "Comp";
  return item.profession || "Build";
}

const ICONS = { folder: folderIcon, comp: compIcon, build: documentDuplicateIcon };

function rowHtml(item, now) {
  const left = daysLeft(item.deletedAt, now);
  const expiring = left <= EXPIRING_DAYS ? " lib-trash__row--expiring" : "";
  return `
    <div class="lib-trash__row${expiring}" data-trash-row="1" data-trash-type="${escapeHtml(item.type)}" data-trash-id="${escapeHtml(item.id)}">
      <span class="lib-trash__icon">${ICONS[item.type] || ICONS.build}</span>
      <div class="lib-trash__text">
        <div class="lib-trash__name"></div>
        <div class="lib-trash__meta">${escapeHtml(trashItemLabel(item))} · ${left === 1 ? "1 day left" : `${left} days left`}</div>
      </div>
      <div class="lib-trash__actions">
        <button type="button" class="lib-trash__btn" data-trash-restore="1">Put Back</button>
        <button type="button" class="lib-trash__btn lib-trash__btn--danger" data-trash-purge="1">Delete Permanently</button>
      </div>
    </div>
  `;
}

/**
 * @param {HTMLElement} container
 * @param {Array<{type: string, id: string, name: string, deletedAt: string}>} items
 * @param {{now?: Date, onRestore?: fn, onPurge?: fn, onEmpty?: fn}} handlers
 */
export function renderTrashView(container, items, handlers = {}) {
  const { now = new Date(), onRestore, onPurge, onEmpty } = handlers;
  const list = Array.isArray(items) ? items : [];

  if (!list.length) {
    container.innerHTML = `
      <div class="lib-trash lib-trash--empty">
        <span class="lib-trash__empty-icon">${trashIcon}</span>
        <p class="lib-trash__empty-title">The trash is empty</p>
        <p class="lib-trash__empty-hint">Deleted builds, comps and folders wait here for ${RETENTION_DAYS} days before they are removed for good.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="lib-trash">
      <div class="lib-trash__header">
        <p class="lib-trash__hint">Items are removed for good ${RETENTION_DAYS} days after you delete them.</p>
        <button type="button" class="lib-trash__btn lib-trash__btn--danger" data-trash-empty="1">Empty Trash</button>
      </div>
      <div class="lib-trash__list">${list.map((item) => rowHtml(item, now)).join("")}</div>
    </div>
  `;

  // Names are user text (a build title, a folder name) and must never be parsed
  // as markup, so they go in as textContent after the template is in place.
  container.querySelectorAll("[data-trash-row]").forEach((row, i) => {
    row.querySelector(".lib-trash__name").textContent = list[i].name || "Untitled";
    const ref = { type: list[i].type, id: list[i].id };
    row.querySelector("[data-trash-restore]").addEventListener("click", () => onRestore?.(ref));
    row.querySelector("[data-trash-purge]").addEventListener("click", () => onPurge?.(ref));
  });
  container.querySelector("[data-trash-empty]")?.addEventListener("click", () => onEmpty?.());
}
