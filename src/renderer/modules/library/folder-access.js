// Team access — the rules of who may do what, and the words for saying it.
//
// A teamspace used to have one setting per person for the whole library: owner
// or member. This is the surface for narrowing that folder by folder.
//
// It renders the server's rule, stated once in workers/sync/src/access.js and
// mirrored in src/main/folderAccess.js: the nearest grant walking up from an
// item wins, so "Inherited" means "whatever the folder above says". Given the
// folder chain, this module can name WHICH folder above, which is the whole
// reason a level can be read at a glance.
//
// A grant names a person, or names EVERYONE — the folder's blanket level. That
// distinction drives the shape of this surface: a folder is a blanket plus the
// handful of people who differ from it, NOT a column per member. A column per
// member is unreadable at twenty people and, worse, cannot say anything about
// the twenty-first — someone who joins tomorrow gets the blanket, and a wall of
// per-person cells has no way to express that.
//
// It lives in its own module, taking its data as arguments and returning HTML,
// so the wording and the inheritance rule can be tested without a modal's DOM.
//
// One quirk it has to carry: at the team root a grant is keyed by the TEAM id,
// because the root folder is not a synced item. Callers resolve that before
// handing rows over — everything here works in already-resolved keys.

import { escapeHtml } from "../utils.js";

// The pseudo-user a blanket grant is stored against. Must match
// workers/sync/src/access.js — the server keys the row, this only reads it back.
export const EVERYONE = "*";

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

export function describeAccess(access) {
  return DESCRIPTIONS[access] || "";
}

export function labelOf(access) {
  return ACCESS_CHOICES.find((c) => c.value === access)?.label || access;
}

/**
 * What one member's level is on one folder, and where it came from.
 *
 * The distinction is the point of the matrix: a grant set ON a folder is the
 * one that folder's cell can clear, and an inherited one has to be shown as
 * inherited — otherwise an owner cannot tell why somebody is read-only here
 * without opening every folder above it in turn.
 *
 * @param {object[]} grants every grant in the team, as the server returns them
 * @param {string[]} chain  folder keys from this folder outwards to the team
 *                          root, this folder first
 * @param {string} userId
 * @param {string} teamDefault the level a member gets with no grant at all
 * @returns {{access: string, source: "folder"|"inherited"|"default",
 *            fromKey: string|null, viaEveryone: boolean}}
 */
export function effectiveLevel(grants, chain, userId, teamDefault) {
  const keys = chain || [];
  for (let i = 0; i < keys.length; i++) {
    // A person's own grant beats the folder's blanket HERE; between folders the
    // nearer one wins either way. Same order as the server resolves them in.
    const mine = userId === EVERYONE
      ? null
      : (grants || []).find((g) => g.folderId === keys[i] && g.userId === userId);
    const blanket = (grants || []).find((g) => g.folderId === keys[i] && g.userId === EVERYONE);
    const hit = mine || blanket;
    if (!hit) continue;
    return {
      access: hit.access,
      source: i === 0 ? "folder" : "inherited",
      fromKey: keys[i],
      viaEveryone: !mine,
    };
  }
  return { access: teamDefault, source: "default", fromKey: null, viaEveryone: false };
}

/** The level a folder hands to anyone who is not excepted. */
export function everyoneLevel(grants, chain, teamDefault) {
  return effectiveLevel(grants, chain, EVERYONE, teamDefault);
}

/** The people named on ONE folder — the exceptions to its blanket. */
export function exceptionsAt(grants, folderKey, members) {
  return (grants || [])
    .filter((g) => g.folderId === folderKey && g.userId !== EVERYONE)
    .map((g) => ({
      userId: g.userId,
      access: g.access,
      login: members?.find((m) => m.userId === g.userId)?.login || g.login || g.userId,
      role: members?.find((m) => m.userId === g.userId)?.role || "member",
    }))
    .filter((e) => e.role !== "owner") // an owner's grant would be a lie; never offer one
    .sort((a, b) => String(a.login).localeCompare(String(b.login)));
}

/**
 * One person's access across the whole team, in a sentence.
 *
 * The People tab needs to answer "what can this person do?" without making the
 * reader cross-reference the folder list. The common cases — one level everywhere,
 * or one folder carved out — get named outright; past that, counting is more
 * honest than listing.
 *
 * @param {{key: string, name: string, chain: string[]}[]} rows every folder in the team
 */
export function summarizeAccess(rows, grants, userId, teamDefault) {
  const levels = (rows || []).map((r) => ({
    name: r.name,
    access: effectiveLevel(grants, r.chain, userId, teamDefault).access,
  }));
  if (!levels.length) return "No folders shared yet";

  const counts = new Map();
  for (const { access } of levels) counts.set(access, (counts.get(access) || 0) + 1);
  if (counts.size === 1) return `${labelOf(levels[0].access)} everywhere`;

  const [common] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const exceptions = levels.filter((l) => l.access !== common[0]);
  if (exceptions.length === 1) {
    return `${labelOf(common[0])}, except ${exceptions[0].name} (${labelOf(exceptions[0].access).toLowerCase()})`;
  }
  return `${labelOf(common[0])} in ${common[1]} of ${levels.length} folders`;
}

/** The one-line "what you may do here" a member gets instead of a dead control. */
export function describeMyAccess(access) {
  const what = describeAccess(access);
  return what ? `${labelOf(access)} — you ${what}.` : "";
}

// ─── The folder access browser ────────────────────────────────────────────────
//
// A tree on the left, one folder's whole picture on the right.
//
// This replaced a flat list of every folder as its own card. That list read the
// team's rules in folder order, which meant the surface grew with the FOLDER
// TREE whether or not anything was set, and answering "who can touch this
// folder?" still meant resolving inheritance in your head. Picking a folder and
// being told the answer outright is the job; the tree is how you pick.
//
// Two things this owes the reader, and the reasons the old list could not:
//
//   Where a level came from. A person can be read-only here because of this
//   folder's blanket, because of a blanket three folders up, because of their
//   own grant three folders up, or because of the team default — and the four
//   are indistinguishable if you only print the level. Every row names its
//   source, so nobody has to open the folders above to work out why.
//
//   What is SET here versus what merely applies here. A folder that sets
//   nothing has nothing to clear, and saying so before the reader touches a
//   control is cheaper than letting them discover it.
//
// The people list is folded to the exceptions plus a one-line summary of the
// rest, because "everyone else gets Read only" is the whole point of a blanket
// grant and printing it thirty times says nothing extra. Unfolding it is one
// click for when you do want the roll call.

/** True when this folder has any grant of its own — the tree's dot. */
export function folderMarks(grants, folderKey) {
  const here = (grants || []).filter((g) => g.folderId === folderKey);
  return { own: here.length > 0, blocks: here.some((g) => g.access === "none") };
}

/**
 * The rows the tree actually draws.
 *
 * Collapsed folders hide their descendants — except while filtering, when a
 * match must be reachable no matter what is collapsed, so its ancestors are
 * pulled in and collapse is ignored entirely.
 */
export function visibleRows(rows, expanded, filter = "") {
  const all = rows || [];
  const needle = String(filter || "").trim().toLowerCase();

  if (needle) {
    const keep = new Set();
    for (const row of all) {
      if (!String(row.name).toLowerCase().includes(needle)) continue;
      for (const key of row.chain) keep.add(key);
    }
    return all.filter((r) => keep.has(r.key));
  }

  const open = expanded instanceof Set ? expanded : new Set(expanded || []);
  // chain is [self, parent, …, root]; every ancestor must be open.
  return all.filter((r) => r.chain.slice(1).every((key) => open.has(key)));
}

/** Folder keys that have at least one child, so only those get a twisty. */
function _parents(rows) {
  const set = new Set();
  for (const row of rows || []) if (row.chain.length > 1) set.add(row.chain[1]);
  return set;
}

function _nameOf(rows, key) {
  return (rows || []).find((r) => r.key === key)?.name || "";
}

/**
 * The tree pane, rendered on its own so a keystroke in the filter box can
 * redraw it without rebuilding — and refocusing — the input above it.
 */
export function renderFolderTree({ rows, grants, selectedKey, expanded, filter = "" }) {
  const shown = visibleRows(rows, expanded, filter);
  if (!shown.length) {
    return `<p class="tm-fa__empty">No folder matches that.</p>`;
  }
  const parents = _parents(rows);
  const open = expanded instanceof Set ? expanded : new Set(expanded || []);
  const filtering = Boolean(String(filter || "").trim());

  return shown.map((row) => {
    const marks = folderMarks(grants, row.key);
    const isParent = parents.has(row.key);
    const isOpen = filtering || open.has(row.key);
    const twisty = isParent
      ? `<button class="tm-fa__twisty" data-act="toggle-folder" data-key="${escapeHtml(row.key)}"
           type="button" aria-label="${isOpen ? "Collapse" : "Expand"} ${escapeHtml(row.name)}"
           aria-expanded="${isOpen}">${isOpen ? "▾" : "▸"}</button>`
      : `<span class="tm-fa__twisty"></span>`;
    const dot = marks.own
      ? `<span class="tm-fa__dot${marks.blocks ? " tm-fa__dot--blocks" : ""}"
           title="${marks.blocks ? "Someone has no access here" : "This folder sets its own access"}"></span>`
      : "";

    return `
      <div class="tm-fa__node${row.key === selectedKey ? " tm-fa__node--on" : ""}${row.depth === 0 ? " tm-fa__node--root" : ""}"
        data-act="pick-folder" data-key="${escapeHtml(row.key)}" role="treeitem" tabindex="0"
        aria-selected="${row.key === selectedKey}" style="--depth:${Number(row.depth) || 0}">
        ${twisty}<span class="tm-fa__node-name">${escapeHtml(row.name)}</span>${dot}
      </div>`;
  }).join("");
}

/**
 * The whole surface: filter, tree, and the selected folder's pane.
 *
 * @param {{rows: object[], members: object[], grants: object[], teamDefault?: string,
 *          selectedKey?: string|null, expanded?: Set<string>|string[], filter?: string,
 *          showOthers?: boolean, adding?: boolean,
 *          pending?: {folderKey: string, userId: string}|null}} args
 */
export function renderFolderAccessBrowser({
  rows, members, grants, teamDefault = "write",
  selectedKey = null, expanded = new Set(), filter = "",
  showOthers = false, adding = false, pending = null,
}) {
  if (!rows?.length) return `<p class="tm__hint">Nothing is shared with this team yet.</p>`;
  const row = rows.find((r) => r.key === selectedKey) || rows[0];

  return `
    <div class="tm-fa">
      <div class="tm-fa__side">
        <input class="tm-fa__filter" id="tm-fa-filter" type="search" data-act="filter-folders"
          placeholder="Find a folder…" aria-label="Find a folder" value="${escapeHtml(filter)}" />
        <div class="tm-fa__tree" id="tm-fa-tree" role="tree" aria-label="Folders">
          ${renderFolderTree({ rows, grants, selectedKey: row.key, expanded, filter })}
        </div>
      </div>
      <div class="tm-fa__pane" data-folder-key="${escapeHtml(row.key)}">
        ${_pane({ row, rows, members, grants, teamDefault, showOthers, adding, pending })}
      </div>
    </div>`;
}

function _pane({ row, rows, members, grants, teamDefault, showOthers, adding, pending }) {
  const isRoot = row.depth === 0;
  const blanket = everyoneLevel(grants, row.chain, teamDefault);
  const setHere = blanket.source === "folder";
  const exceptions = exceptionsAt(grants, row.key, members);
  const people = (members || []).filter((m) => m.role !== "owner");

  const pendingHere = pending && pending.folderKey === row.key
    ? people.find((m) => m.userId === pending.userId) || null
    : null;
  const taken = new Set([...exceptions.map((e) => e.userId), ...(pendingHere ? [pendingHere.userId] : [])]);
  const addable = people.filter((m) => !taken.has(m.userId));

  const trail = row.chain.slice(1).reverse().map((key) => _nameOf(rows, key));
  const crumb = isRoot ? "The whole team" : trail.join(" / ");

  return `
    <div class="tm-fa__crumb">${escapeHtml(crumb)}<b>${escapeHtml(row.name)}</b></div>
    ${_blanketCard({ row, rows, isRoot, blanket, setHere, teamDefault, grants })}
    <div class="tm-fa__label">Set on this folder</div>
    ${_setHereList({ row, exceptions, blanket, pendingHere, addable, adding })}
    ${_lockoutWarning({ row, isRoot, blanket, setHere, exceptions })}
    ${_othersSection({ row, members, grants, teamDefault, rows, taken, showOthers })}
  `;
}

function _blanketCard({ row, rows, isRoot, blanket, setHere, teamDefault, grants }) {
  const parent = isRoot ? null : everyoneLevel(grants, row.chain.slice(1), teamDefault);
  const inheritLabel = isRoot
    ? `Team default · ${labelOf(teamDefault)}`
    : `Inherited · ${labelOf(parent.access)}`;

  // The three things this line can mean, said in words rather than left to the
  // reader to infer from a control that looks identical in all three.
  const subtitle = isRoot
    ? "The team default — every folder falls back to this"
    : setHere
      ? "Set on this folder · applies to anyone who joins later"
      : parent.source === "default"
        ? "Nothing set here — follows the team default"
        : `Nothing set here — follows <b>${escapeHtml(_nameOf(rows, parent.fromKey))}</b>`;

  return `
    <div class="tm-fa__blanket${setHere || isRoot ? "" : " tm-fa__blanket--inherited"}">
      <div class="tm-fa__blanket-text">
        <div class="tm-fa__blanket-title">Everyone in the team</div>
        <div class="tm-fa__blanket-sub">${subtitle}</div>
      </div>
      ${accessSelect({
        userId: EVERYONE,
        value: setHere ? blanket.access : "inherit",
        inheritLabel,
        ariaLabel: `Everyone, in ${row.name}`,
      })}
    </div>`;
}

/**
 * The people named ON this folder — the only rows here that are rules.
 *
 * A person is picked first and given a level second: until a level is chosen
 * there is no grant to store, and storing one at the blanket's own level would
 * be an exception that excepts nothing.
 */
function _setHereList({ row, exceptions, blanket, pendingHere, addable, adding }) {
  const sameAsEveryone = `Same as everyone (${labelOf(blanket.access)})`;

  const rowsHtml = exceptions.map((e) => `
    <div class="tm-fa__person tm-fa__exception" data-user-id="${escapeHtml(e.userId)}">
      ${_avatar(e)}
      <span class="tm-fa__person-text">
        <span class="tm-fa__person-name tm-fa__exception-name">${escapeHtml(e.login)}</span>
        <span class="tm-fa__person-note">${e.access === blanket.access
          ? "Matches <b>Everyone</b> here" : "Overrides <b>Everyone</b> here"}</span>
      </span>
      ${accessSelect({ userId: e.userId, value: e.access, inheritLabel: sameAsEveryone,
        ariaLabel: `${e.login}, in ${row.name}` })}
      <button class="tm-fa__icon tm-fa__icon--drop" data-act="clear-exception" type="button"
        aria-label="Remove the exception for ${escapeHtml(e.login)}">&times;</button>
    </div>`).join("");

  const pendingHtml = pendingHere ? `
    <div class="tm-fa__person tm-fa__exception tm-fa__exception--pending" data-user-id="${escapeHtml(pendingHere.userId)}">
      ${_avatar(pendingHere)}
      <span class="tm-fa__person-text">
        <span class="tm-fa__person-name tm-fa__exception-name">${escapeHtml(pendingHere.login)}</span>
        <span class="tm-fa__person-note">Not set yet</span>
      </span>
      ${accessSelect({ userId: pendingHere.userId, value: "", placeholder: "Choose a level…",
        inheritLabel: sameAsEveryone, ariaLabel: `${pendingHere.login}, in ${row.name}` })}
      <button class="tm-fa__icon tm-fa__icon--drop" data-act="cancel-exception" type="button"
        aria-label="Cancel">&times;</button>
    </div>` : "";

  const adderHtml = adding && addable.length ? `
    <div class="tm-fa__person">
      <span class="tm-fa__avatar tm-fa__avatar--ghost">+</span>
      <span class="tm-fa__person-text"><span class="tm-fa__person-name">Different access for…</span></span>
      <select class="tm-fa__select" data-act="pick-person" aria-label="Who is the exception for?">
        <option value="">Choose a person…</option>
        ${addable.map((m) => `<option value="${escapeHtml(m.userId)}">${escapeHtml(m.login)}</option>`).join("")}
      </select>
      <button class="tm-fa__icon tm-fa__icon--drop" data-act="cancel-exception" type="button"
        aria-label="Cancel">&times;</button>
    </div>` : "";

  const empty = !rowsHtml && !pendingHtml
    ? `<p class="tm-fa__none">Nobody is singled out here.</p>` : "";

  const add = addable.length && !adding && !pendingHere
    ? `<button class="tm-fa__add" data-act="add-exception" type="button">+ Add a person…</button>` : "";

  return `<div class="tm-fa__set">${empty}${rowsHtml}${pendingHtml}${adderHtml}${add}</div>`;
}

/**
 * "No access" is the one level that takes something away rather than granting
 * it, and it takes everything below this folder with it. Saying so where it is
 * set beats letting it be discovered by the person who lost the folder.
 */
function _lockoutWarning({ row, isRoot, blanket, setHere, exceptions }) {
  const names = [];
  if (setHere && blanket.access === "none") names.push("Everyone");
  for (const e of exceptions) if (e.access === "none") names.push(e.login);
  if (!names.length) return "";

  const who = names.length === 1 ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 && names[0] !== "Everyone" ? "loses" : "lose";
  const what = isRoot ? "the library" : `“${row.name}”`;

  return `
    <p class="tm-fa__warn"><span aria-hidden="true">⚠</span><span><b>${escapeHtml(who)} ${verb} ${escapeHtml(what)}.</b>
    No access here hides every folder beneath it too. Anything of theirs already synced stays on the
    server — they just stop seeing it.</span></p>`;
}

/**
 * Everyone who is NOT a rule here, folded to one line by default.
 *
 * The fold is the point: a blanket grant's whole value is that it covers people
 * without naming them, so naming all thirty of them back would undo the idea.
 * Unfolded, each row still says where its level came from.
 */
function _othersSection({ row, members, grants, teamDefault, rows, taken, showOthers }) {
  const others = (members || []).filter((m) => !taken.has(m.userId));
  if (!others.length) return "";

  const levels = others.map((m) => ({
    m,
    eff: m.role === "owner" ? null : effectiveLevel(grants, row.chain, m.userId, teamDefault),
  }));
  const nonOwner = levels.filter((l) => l.eff);
  const uniform = nonOwner.length
    && nonOwner.every((l) => l.eff.access === nonOwner[0].eff.access)
    ? nonOwner[0].eff.access : null;

  const toggle = `<button class="tm-fa__toggle" data-act="toggle-others" type="button">${
    showOthers ? "hide" : "show them"}</button>`;

  const head = `<div class="tm-fa__label">Everyone else${showOthers ? ` · ${others.length}` : ""}</div>`;

  if (!showOthers) {
    const faces = `<span class="tm-fa__stack">${levels.map((l) => _avatar(l.m)).join("")}</span>`;
    const what = uniform
      ? `get <b>${escapeHtml(labelOf(uniform))}</b>`
      : "have mixed levels";
    const count = others.length === 1 ? "1 other" : `${others.length} others`;
    return `${head}<div class="tm-fa__fold">${faces}<span>${count} ${what} — ${toggle}</span></div>`;
  }

  const body = levels.map(({ m, eff }) => `
    <div class="tm-fa__person" data-user-id="${escapeHtml(m.userId)}">
      ${_avatar(m)}
      <span class="tm-fa__person-text">
        <span class="tm-fa__person-name">${escapeHtml(m.login)}</span>
        <span class="tm-fa__person-note">${eff ? _sourceNote(eff, rows) : "Owner — can always reach everything"}</span>
      </span>
      ${eff
        ? accessSelect({ userId: m.userId, value: "inherit",
          inheritLabel: labelOf(eff.access), ariaLabel: `${m.login}, in ${row.name}` })
        : `<span class="tm-fa__fixed">Full access</span>`}
      <span class="tm-fa__icon-space"></span>
    </div>`).join("");

  return `${head}<div class="tm-fa__others">${body}</div>
    <p class="tm-fa__foldnote">These follow other folders — pick a level to make it a rule here. ${toggle}</p>`;
}

/** Where a level that is not set here actually came from, in one phrase. */
function _sourceNote(eff, rows) {
  if (eff.source === "default") return "Team default";
  const where = escapeHtml(_nameOf(rows, eff.fromKey));
  if (eff.source === "folder") {
    return eff.viaEveryone ? "From <b>Everyone</b> on this folder" : "Set on this folder";
  }
  return eff.viaEveryone
    ? `From <b>Everyone</b> on <b>${where}</b>`
    : `Their own level on <b>${where}</b>`;
}

/**
 * A face, or the initial standing in for one — the image is laid OVER the
 * monogram rather than swapped in for it, so a slow or broken avatar URL reads
 * as a letter instead of a hole.
 */
function _avatar(m) {
  const name = m.displayName || m.login || "?";
  const initial = String(name).trim().charAt(0).toUpperCase() || "?";
  const img = m.avatarUrl
    ? `<img class="tm-fa__avatar-img" src="${escapeHtml(m.avatarUrl)}" alt="" loading="lazy" />`
    : "";
  return `<span class="tm-fa__avatar" aria-hidden="true">${escapeHtml(initial)}${img}</span>`;
}

/**
 * The level control, wherever a level is set.
 *
 * Exported because a person's TEAM-WIDE level is set on the People tab and is
 * the same thing as a grant on the root: same options, same wording, same
 * "inherit clears it". Two copies of this would drift.
 */
export function accessSelect({ userId, value, inheritLabel, ariaLabel, placeholder = "" }) {
  const options = [
    placeholder ? `<option value="" selected>${escapeHtml(placeholder)}</option>` : "",
    ...ACCESS_CHOICES.map((c) => {
      const label = c.value === "inherit" ? inheritLabel : c.label;
      const selected = !placeholder && c.value === value ? " selected" : "";
      return `<option value="${c.value}"${selected}>${escapeHtml(label)}</option>`;
    }),
  ].join("");
  return `<select class="tm-fa__select" data-act="set-access" data-user-id="${escapeHtml(userId)}"
    aria-label="${escapeHtml(ariaLabel)}">${options}</select>`;
}
