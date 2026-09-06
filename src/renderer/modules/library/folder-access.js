// The per-folder access editor, and the words it uses.
//
// A teamspace used to have one setting per person for the whole library: owner
// or member. This is the surface for narrowing that folder by folder — open
// Share… on a team folder and each member gets a level here.
//
// It lives in its own module, taking its data as arguments and returning HTML,
// so the wording and the fallback rules can be tested without the modal's DOM or
// share-modal.js's import graph.
//
// The rule it renders is the server's, stated once in workers/sync/src/access.js
// and mirrored in src/main/folderAccess.js: the nearest grant walking up from an
// item wins, so "Inherited" here means "whatever the folder above says".

import { escapeHtml } from "../utils.js";

/** Ordered so the <select> reads as a ramp from least to most. */
export const ACCESS_CHOICES = [
  { value: "inherit", label: "Inherited" },
  { value: "none", label: "No access" },
  { value: "read", label: "Read only" },
  { value: "write", label: "Can edit" },
  { value: "delete", label: "Can delete" },
];

const DESCRIPTIONS = {
  none: "cannot see this folder at all",
  read: "can see it but change nothing",
  write: "can add and edit, and remove their own work",
  delete: "can also remove anyone's work",
};

/**
 * What one member's level is here, and where that came from.
 *
 * The distinction matters for the UI: a grant set ON this folder is the one this
 * dialog can clear, and an inherited one has to be described rather than edited,
 * or the owner cannot tell why somebody is read-only.
 *
 * @param {object[]} grants every grant in the team, as the server returns them
 * @param {string} folderId the folder this dialog is about
 * @param {string} userId
 * @param {string} teamDefault the level a member gets with no grant at all
 */
export function levelFor(grants, folderId, userId, teamDefault) {
  const own = (grants || []).find((g) => g.folderId === folderId && g.userId === userId);
  if (own) return { access: own.access, source: "folder" };
  // Any other grant this person has is, by definition, on an ancestor or a
  // sibling; we cannot tell which from here without the tree, and the honest
  // label for "something else decides this" is Inherited either way.
  const elsewhere = (grants || []).some((g) => g.userId === userId);
  return { access: null, source: elsewhere ? "inherited" : "default", teamDefault };
}

export function describeAccess(access) {
  return DESCRIPTIONS[access] || "";
}

/**
 * The Access section of the Share dialog.
 *
 * Owners are listed but not editable, and say why: an owner can hand out and
 * take back any grant in the team, so a level set against one would be a lie.
 *
 * @param {{members: object[], grants: object[], folderId: string, isOwner: boolean,
 *          teamDefault?: string, isTeamRoot?: boolean}} args
 */
export function renderAccessSection({ members, grants, folderId, isOwner, teamDefault = "write", isTeamRoot = false }) {
  if (!isOwner) {
    const mine = (grants || []).find((g) => g.folderId === folderId);
    return mine
      ? `<p class="shm__hint">Your access here: <strong>${escapeHtml(labelOf(mine.access))}</strong> — you ${escapeHtml(describeAccess(mine.access))}.</p>`
      : `<p class="shm__hint">Only the team owner can change who may use this folder.</p>`;
  }

  const scope = isTeamRoot
    ? "Applies to the whole team unless a folder inside it says otherwise."
    : "Applies to this folder and everything inside it.";

  const rows = (members || []).map((m) => {
    if (m.role === "owner") {
      return `
        <div class="shm__access-row" data-user-id="${escapeHtml(m.userId)}">
          <span class="shm__member-name">${escapeHtml(m.login)}</span>
          <span class="shm__access-fixed" title="An owner can change any of these, so restricting one would not hold.">Owner — full access</span>
        </div>`;
    }
    const { access, source } = levelFor(grants, folderId, m.userId, teamDefault);
    const current = access || "inherit";
    const options = ACCESS_CHOICES.map((c) => {
      const label = c.value === "inherit" && source !== "folder"
        ? `Inherited (${labelOf(teamDefault)})`
        : c.label;
      return `<option value="${c.value}"${c.value === current ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
    return `
      <div class="shm__access-row" data-user-id="${escapeHtml(m.userId)}">
        <span class="shm__member-name">${escapeHtml(m.login)}</span>
        <select class="shm__access-select" data-act="set-access" aria-label="Access for ${escapeHtml(m.login)}">${options}</select>
      </div>`;
  }).join("");

  return `<p class="shm__hint">${escapeHtml(scope)}</p>${rows}`;
}

function labelOf(access) {
  return ACCESS_CHOICES.find((c) => c.value === access)?.label || access;
}
