// The archive view — what the library shows for things you are done with but
// not done needing.
//
// Deliberately shaped like trash-view.js, and deliberately different in the two
// ways that matter: there is no countdown, because nothing here expires, and
// there is no destructive button, because nothing here is on its way out. An
// archived item is a live record that has simply been put away, so the only
// action is to bring it back — plus "Open", since a build you archived is still
// perfectly openable and that is often all you came for.

import { escapeHtml, formatRelativeTime } from "../utils.js";
import { folderIcon, compIcon, archiveIcon, documentDuplicateIcon } from "./heroicons.js";

/** A one-line description of what un-archiving this row brings back. */
export function archiveItemLabel(item) {
  if (item.type === "folder") return "Folder, with everything inside it";
  if (item.type === "comp") return "Comp";
  return item.profession || "Build";
}

const ICONS = { folder: folderIcon, comp: compIcon, build: documentDuplicateIcon };

function rowHtml(item) {
  // A folder row stands in for its whole subtree, so there is nothing sensible
  // to open — un-archiving is the only move.
  const openBtn = item.type === "folder"
    ? ""
    : `<button type="button" class="lib-archive__btn" data-archive-open="1">Open</button>`;
  return `
    <div class="lib-archive__row" data-archive-row="1" data-archive-type="${escapeHtml(item.type)}" data-archive-id="${escapeHtml(item.id)}">
      <span class="lib-archive__icon">${ICONS[item.type] || ICONS.build}</span>
      <div class="lib-archive__text">
        <div class="lib-archive__name"></div>
        <div class="lib-archive__meta">${escapeHtml(archiveItemLabel(item))} · archived ${escapeHtml(formatRelativeTime(item.archivedAt))}</div>
      </div>
      <div class="lib-archive__actions">
        ${openBtn}
        <button type="button" class="lib-archive__btn lib-archive__btn--primary" data-archive-restore="1">Unarchive</button>
      </div>
    </div>
  `;
}

/**
 * @param {HTMLElement} container
 * @param {Array<{type: string, id: string, name: string, archivedAt: string}>} items
 * @param {{onRestore?: fn, onOpen?: fn}} handlers
 */
export function renderArchiveView(container, items, handlers = {}) {
  const { onRestore, onOpen } = handlers;
  const list = Array.isArray(items) ? items : [];

  if (!list.length) {
    container.innerHTML = `
      <div class="lib-archive lib-archive--empty">
        <span class="lib-archive__empty-icon">${archiveIcon}</span>
        <p class="lib-archive__empty-title">Nothing archived</p>
        <p class="lib-archive__empty-hint">Archive a build, comp or folder to move it out of your library without deleting it. Archived items keep working — comps still use them, published links still resolve — they just stop cluttering the shelf.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="lib-archive">
      <div class="lib-archive__header">
        <p class="lib-archive__hint">Archived items are kept indefinitely. Nothing here is deleted.</p>
      </div>
      <div class="lib-archive__list">${list.map((item) => rowHtml(item)).join("")}</div>
    </div>
  `;

  // Names are user text and must never be parsed as markup, so they go in as
  // textContent once the template is in place.
  container.querySelectorAll("[data-archive-row]").forEach((row, i) => {
    row.querySelector(".lib-archive__name").textContent = list[i].name || "Untitled";
    const ref = { type: list[i].type, id: list[i].id };
    row.querySelector("[data-archive-restore]").addEventListener("click", () => onRestore?.(ref));
    row.querySelector("[data-archive-open]")?.addEventListener("click", () => onOpen?.(ref));
  });
}
