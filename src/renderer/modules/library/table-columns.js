// Library table view columns — which ones draw, in what order, and how they sort.
//
// The table used to spell its columns out by hand in the header and in every
// row kind, so adding one meant editing five places that had to agree. Now the
// columns are one registry and the user picks which of them show (Discord
// "More Columns"). The leading action, icon and name columns are locked: they
// carry the row's identity and its controls, so they always show and always
// lead. Everything else can be hidden and reordered.
//
// This module only decides; content.js draws the cells.

import { state } from "../state.js";
import { teamRootFor } from "../teams.js";
import { folderPathText } from "../build-sources.js";
import { publishStatus } from "../publish-status.js";
import { gameModeLabel } from "./smart-folders.js";

/**
 * @typedef {object} TableColumn
 * @property {string} id         also the cell's `lib-tv__<id>` class
 * @property {string} label      header text ("" for the locked glyph columns)
 * @property {string} width      the column's grid track
 * @property {boolean} [locked]  always shown, always first, not reorderable
 * @property {boolean} [hidden]  off until the user turns it on
 * @property {string} [sortField] libraryPrefs.sortField it sorts by, if any
 */

/** @type {TableColumn[]} in default order */
export const TABLE_COLUMNS = [
  { id: "action", label: "", width: "22px", locked: true },
  { id: "icon", label: "", width: "22px", locked: true },
  { id: "name", label: "Name", width: "1fr", locked: true, sortField: "title" },
  { id: "profession", label: "Profession", width: "116px", sortField: "profession" },
  { id: "spec", label: "Elite Spec", width: "100px", sortField: "eliteSpec" },
  { id: "mode", label: "Mode", width: "72px", sortField: "gameMode" },
  { id: "role", label: "Role", width: "116px" },
  { id: "tags", label: "Tags", width: "80px" },
  { id: "created", label: "Created", width: "88px", sortField: "createdAt" },
  { id: "modified", label: "Modified", width: "92px", sortField: "updatedAt" },
  { id: "path", label: "Path", width: "160px", hidden: true, sortField: "path" },
  { id: "owner", label: "Owner", width: "110px", hidden: true, sortField: "owner" },
  { id: "published", label: "Published", width: "96px", hidden: true, sortField: "publishStatus" },
];

const BY_ID = new Map(TABLE_COLUMNS.map((c) => [c.id, c]));
const LOCKED = TABLE_COLUMNS.filter((c) => c.locked);

/**
 * The saved `library.tableColumns` setting made safe to use: an ordered list
 * of every reorderable column, each `{ id, visible }`. Unknown and repeated ids
 * are dropped (a column removed in a later version, a hand-edited settings
 * file), and columns the saved list does not know about yet are appended with
 * their default visibility, so a new column never appears out of nowhere.
 *
 * @returns {Array<{id: string, visible: boolean}>}
 */
export function normalizeColumnPrefs(saved) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(saved) ? saved : []) {
    const col = entry && BY_ID.get(entry.id);
    if (!col || col.locked || seen.has(col.id)) continue;
    seen.add(col.id);
    out.push({ id: col.id, visible: entry.visible !== false });
  }
  for (const col of TABLE_COLUMNS) {
    if (col.locked || seen.has(col.id)) continue;
    out.push({ id: col.id, visible: !col.hidden });
  }
  return out;
}

/** The columns to draw, locked first, then the visible ones in saved order. */
export function visibleColumns(prefs) {
  return [
    ...LOCKED,
    ...normalizeColumnPrefs(prefs).filter((p) => p.visible).map((p) => BY_ID.get(p.id)),
  ];
}

/** The CSS grid-template-columns value shared by the header and every row. */
export function gridTemplate(columns) {
  return columns.map((c) => c.width).join(" ");
}

/** A copy of `prefs` with one column shown or hidden. Locked ids are ignored. */
export function toggleColumn(prefs, id) {
  return normalizeColumnPrefs(prefs).map((p) => (p.id === id ? { ...p, visible: !p.visible } : p));
}

/** A copy of `prefs` with `id` moved to `toIndex`, clamped to the list. */
export function moveColumn(prefs, id, toIndex) {
  const list = normalizeColumnPrefs(prefs);
  const from = list.findIndex((p) => p.id === id);
  if (from === -1) return list;
  const [entry] = list.splice(from, 1);
  const to = Math.max(0, Math.min(list.length, toIndex));
  list.splice(to, 0, entry);
  return list;
}

/** Label for a column id, for the column menu. */
export function columnLabel(id) {
  return BY_ID.get(id)?.label || id;
}

// ─── Derived cell values ──────────────────────────────────────────────────────

/** The first elite specialization's name, or null. */
export function eliteSpecName(build) {
  for (const s of build?.specializations || []) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

/**
 * Who made a team item. Ownership only means something inside a team space,
 * so anything outside one is blank, whoever made it.
 *
 * Inside one, the author map decides (see loadSyncAuthors in teams.js): no
 * entry means the item has never synced, so it was made here and is yours; a
 * null entry means the server sent no creator. That, and a teammate whose name
 * has not loaded yet, stay blank rather than show a guess.
 */
export function ownerLabel(item) {
  if (!item || !teamRootFor(item.folderId)) return "";
  const me = state.teamSession?.userId || null;
  const authors = state.syncAuthors || {};
  if (!Object.prototype.hasOwnProperty.call(authors, item.id)) return me ? "You" : "";
  const author = authors[item.id];
  if (!author) return "";
  if (author === me) return "You";
  return state.teamMemberNames?.[author] || "";
}

// Published first, then out of date, then never: the order you scan for when
// sorting by it is "what is live".
const PUBLISH_RANK = { current: 0, stale: 1, never: 2 };

const DERIVED_SORT = {
  eliteSpec: (b) => eliteSpecName(b) || "",
  gameMode: (b) => gameModeLabel(b.gameMode || "pve"),
  path: (b) => folderPathText(b.folderId),
  owner: (b) => ownerLabel(b),
  publishStatus: (b) => PUBLISH_RANK[publishStatus(b)] ?? 9,
};

function sortValue(build, field) {
  const derive = DERIVED_SORT[field];
  const v = derive ? derive(build) : build[field];
  if (v == null) return "";
  return typeof v === "string" ? v.toLowerCase() : v;
}

/**
 * The library's build order: pinned first, then `field` in `direction`. Shared
 * by the top level (folder-store getVisibleBuilds) and expanded table folders,
 * which used to carry their own copy of it.
 */
export function compareBuilds(a, b, field, direction) {
  if (a.pinned && !b.pinned) return -1;
  if (!a.pinned && b.pinned) return 1;
  const dir = direction === "asc" ? 1 : -1;
  const av = sortValue(a, field);
  const bv = sortValue(b, field);
  if (av < bv) return -1 * dir;
  if (av > bv) return 1 * dir;
  return 0;
}
