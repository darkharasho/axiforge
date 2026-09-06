// What the current user may do, as the library UI needs to ask it.
//
// The server is the authority and src/main/folderAccess.js is the client-side
// mirror of its rule; neither is reachable from a render pass. `teams:access`
// resolves that rule once, for every team folder, into folderId → level — so
// this module is a lookup and some wording, and cannot drift from the rule by
// re-deriving it.
//
// Why it exists: a read-only member used to find out by being refused. The
// control looked live, they clicked it, and an error toast arrived. A greyed
// control that says why is the same information, before the click.
//
// One level is deliberately not modelled here: `delete` vs `write`. The extra
// thing a delete grant buys you is removing a TEAMMATE's work, and the renderer
// cannot tell whose is whose — that is the server's creator rule, which still
// answers it. So everything that changes a folder asks the same question,
// canWrite(), and a write-level member keeps a live Delete for their own work.

import { state } from "../state.js";

const LEVELS = { none: 0, read: 1, write: 2, delete: 3 };

/** Pull the resolved map from main. Safe when sync is off (leaves it empty). */
export async function loadAccessMap() {
  try {
    state.folderAccess = (await window.desktopApi?.teamAccessMap?.()) || {};
  } catch {
    // A failed fetch must not lock the library down: an empty map reads as
    // "personal", the server still refuses anything it should, and the user
    // gets the old error-toast behaviour rather than a UI they cannot use.
    state.folderAccess = {};
  }
}

/**
 * The caller's level in a folder.
 *
 * A folder with no entry is a personal one — the map only covers team folders —
 * and personal work is never restricted, so it answers "delete". That also
 * covers the library root (folderId null).
 *
 * @param {string|null|undefined} folderId
 * @returns {"none"|"read"|"write"|"delete"}
 */
export function accessTo(folderId) {
  if (!folderId) return "delete";
  return state.folderAccess?.[folderId] || "delete";
}

/** True when the caller may add to or change things in this folder. */
export function canWrite(folderId) {
  return LEVELS[accessTo(folderId)] >= LEVELS.write;
}

/**
 * What a read-only folder means, as the hover text on anything it refuses.
 *
 * The first line is the whole answer and is the only part a narrow tooltip
 * needs; the rest is there because "read-only" left people guessing at the
 * edges of it — whether they could still export, whether Duplicate counted as
 * a change, whether the copy they made was theirs. Those are cheap to answer
 * once, in the place they are already looking, and expensive to answer in
 * Discord every time. Kept as literal newlines: a `title` renders them, and
 * nothing here is worth a custom tooltip widget.
 *
 * Duplicate is called out by name because it is the one refusal that reads as
 * a mistake — copying is allowed, so why not this? Because the duplicate lands
 * back in the same folder. Copy-and-paste elsewhere is the move.
 */
const READ_ONLY_TOOLTIP = [
  "Read-only — the team owner controls who can change this folder",
  "",
  "You can: open it, copy it, export it, share or publish it, and pin it.",
  "You can't: rename, duplicate, retag, move, delete, or save changes to it.",
  "",
  "Copy it into a folder of your own and that copy is yours to edit.",
].join("\n");

/**
 * Why a write is refused here, or null when it isn't.
 *
 * Phrased as what is true rather than what failed — the user has not done
 * anything wrong yet, they are being told the shape of the folder before they
 * try. Suitable as a `title`, and as the `disabledTooltip` a context-menu item
 * takes.
 */
export function writeDeniedReason(folderId) {
  return canWrite(folderId) ? null : READ_ONLY_TOOLTIP;
}

/**
 * The folder the library is currently looking at, or null when there isn't one.
 *
 * state.currentFolder is a folder record on some paths and a { type, id } tag on
 * others, and only some of those tags name a folder at all — a smart folder or
 * the Trash spans many, so there is no single access answer for them. Lives here
 * because the toolbar and the context menu must resolve it identically or they
 * disagree about the same click.
 */
export function currentFolderId() {
  const cur = state.currentFolder;
  if (!cur) return null;
  if (cur.type === "comp") return (state.comps || []).find((c) => c.id === cur.id)?.folderId ?? null;
  return (state.folders || []).some((f) => f.id === cur.id) ? cur.id : null;
}
