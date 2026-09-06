// Manage Team — the one place a team is administered.
//
// Team management used to live in two places that had each grown their own copy
// of it: Settings → Teams and the folder Share dialog both rendered the invite
// code, the member list and a Remove button, in different markup with different
// wording, and which one you got depended on how you arrived. Neither could
// answer the question an owner actually has — "who can do what, where" — because
// access was only ever reachable one folder at a time, through a right-click.
//
// So both entry points lead here instead. Settings → Teams is the list of teams;
// Share… is about one folder. Everything that is about the TEAM — its people,
// its folder access, its name, its invite code — is this dialog, once.
//
// Three tabs:
//   People       — who is in, what they can do across the team, and removing them
//   Folder access — a tree of the team's folders and, for the one picked, its
//                   blanket level, its exceptions and where everyone else's
//                   level comes from (owners); or your own levels (members)
//   Team         — the name, a manual pull, and leaving or deleting
//
// It uses only IPC that already exists. Assigning roles and per-invite links are
// deliberately absent: neither has a server API yet, and a control that cannot
// be honoured is worse than no control.

import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { showConfirmModal } from "./confirm-modal.js";
import { showPrompt } from "./prompt-modal.js";
import { loadTeamState, rootForTeam } from "./teams.js";
import { xMarkIcon } from "./library/heroicons.js";
import {
  renderFolderAccessBrowser, renderFolderTree, summarizeAccess, effectiveLevel,
  labelOf, accessSelect, everyoneLevel, EVERYONE,
} from "./library/folder-access.js";

const TABS = [
  { id: "people", label: "People" },
  { id: "access", label: "Folder access" },
  { id: "team", label: "Team" },
];

let _overlay = null;
let _escHandler = null;
let _teamId = null;
let _tab = "people";
let _onRefresh = null;
let _copyTimer = null;
// Folder access is one folder at a time now, so the tab has a place in it: which
// folder is picked, which branches are open, what the filter box holds, and
// whether the "everyone else" roll call is unfolded. All four are about reading
// the dialog rather than about the team, so none of it is persisted — it is set
// up on open and dies on close.
let _selectedKey = null;
let _expanded = null;
let _filter = "";
let _showOthers = false;
// Whether the picked folder is mid "add an exception", and who has been chosen
// but not yet given a level. Neither is a fact about the team either.
let _adding = false;
let _pending = null;

// Below this many folders the tree opens flat: it is a way to PICK a folder, and
// hiding folders behind twisties to save a few rows makes picking the harder of
// the two. Past it, opening the first level only keeps the pane in view.
const EXPAND_ALL_UPTO = 25;
// Everything one render needs, fetched together so a tab switch is instant and
// every tab is drawn from the same snapshot rather than three racing ones.
let _data = { members: [], grants: [], teamDefault: "write" };

export function initTeamModal() {
  if (typeof document === "undefined" || _overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "tm-overlay tm-overlay--hidden";
  _overlay.innerHTML = `
    <div class="tm" role="dialog" aria-modal="true" aria-labelledby="tm-title">
      <div class="tm__header">
        <div class="tm__heading">
          <h3 class="tm__title" id="tm-title">Team</h3>
          <p class="tm__meta" id="tm-meta"></p>
        </div>
        <span class="tm__role" id="tm-role" hidden></span>
        <button class="tm__close" id="tm-close" type="button" aria-label="Close">${xMarkIcon}</button>
      </div>
      <div class="tm__tabs" id="tm-tabs" role="tablist"></div>
      <div class="tm__body" id="tm-body"></div>
      <div class="tm__status" id="tm-status" hidden></div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _overlay.querySelector("#tm-close").addEventListener("click", closeTeamModal);
  _overlay.addEventListener("mousedown", (e) => { if (e.target === _overlay) closeTeamModal(); });
  _overlay.querySelector("#tm-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) { _tab = tab.dataset.tab; _render(); }
  });
  _overlay.querySelector("#tm-body").addEventListener("click", _onBodyClick);
  _overlay.querySelector("#tm-body").addEventListener("change", _onBodyChange);
  // Filtering redraws the tree ALONE. Re-rendering the tab would rebuild the
  // input the user is typing into and take the caret with it.
  _overlay.querySelector("#tm-body").addEventListener("input", (e) => {
    if (!e.target.matches("#tm-fa-filter")) return;
    _filter = e.target.value;
    _renderTree();
  });
  // The tree is a listbox by behaviour, so it has to answer the keyboard.
  _overlay.querySelector("#tm-body").addEventListener("keydown", (e) => {
    const node = e.target.closest?.(".tm-fa__node");
    if (!node || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    _selectFolder(node.dataset.key);
  });
}

/**
 * @param {string} teamId
 * @param {{tab?: string, focusFolderId?: string, onRefresh?: Function}} [opts]
 *   focusFolderId — opened from a folder's Share dialog: that folder is the one
 *   SELECTED, so the deep link lands on the answer rather than on a list with
 *   the answer highlighted somewhere in it.
 */
export async function openTeamModal(teamId, opts = {}) {
  if (!_overlay) initTeamModal();
  if (!_overlay || !teamId) return;

  _teamId = teamId;
  _tab = TABS.some((t) => t.id === opts.tab) ? opts.tab : "people";
  _onRefresh = opts.onRefresh || null;
  _selectedKey = opts.focusFolderId
    ? (rootForTeam(teamId)?.id === opts.focusFolderId ? teamId : opts.focusFolderId)
    : null;
  _expanded = null;
  _filter = "";
  _showOthers = false;
  _data = { members: [], grants: [], teamDefault: "write" };
  _adding = false;
  _pending = null;

  _overlay.classList.remove("tm-overlay--hidden");
  if (_escHandler) document.removeEventListener("keydown", _escHandler);
  _escHandler = (e) => { if (e.key === "Escape") closeTeamModal(); };
  document.addEventListener("keydown", _escHandler);

  _render();
  await _load();
}

export function closeTeamModal() {
  if (!_overlay) return;
  _overlay.classList.add("tm-overlay--hidden");
  if (_escHandler) { document.removeEventListener("keydown", _escHandler); _escHandler = null; }
  if (_copyTimer) { clearTimeout(_copyTimer); _copyTimer = null; }
  _teamId = null;
  _selectedKey = null;
  _expanded = null;
  _filter = "";
  _showOthers = false;
  _adding = false;
  _pending = null;
}

// ─── Data ──────────────────────────────────────────────────────────────────────

function _record() {
  return (state.teams || []).find((t) => t.team.id === _teamId) || null;
}

function _isOwner() {
  return _record()?.role === "owner";
}

/**
 * The team's folders, outermost first, each with the key its grants are stored
 * under and the chain that key inherits along.
 *
 * The root's key is the TEAM id, not the folder id: the root folder is not a
 * synced item, so the server has nowhere else to hang a team-wide grant. Every
 * caller past this point works in keys and never has to know that again.
 */
function _folderRows() {
  const root = rootForTeam(_teamId);
  if (!root) return [];
  const rows = [];
  const walk = (folder, depth, parentChain) => {
    const key = folder.id === root.id ? _teamId : folder.id;
    const chain = [key, ...parentChain];
    rows.push({ id: folder.id, key, name: folder.name, depth, chain });
    (state.folders || [])
      .filter((f) => f.parentId === folder.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)))
      .forEach((child) => walk(child, depth + 1, chain));
  };
  walk(root, 0, []);
  return rows;
}

/**
 * Make sure something sensible is picked and that it can actually be seen.
 *
 * Selection outlives a reload — grants change under the pane constantly — but a
 * folder can be deleted or the deep link can name one this team does not have,
 * so a key that no longer exists falls back to the root rather than to an empty
 * pane. Expansion is decided once, on the first render that has folders.
 */
function _ensureSelection(rows) {
  if (!rows.length) return;
  const keys = new Set(rows.map((r) => r.key));
  if (!_selectedKey || !keys.has(_selectedKey)) _selectedKey = rows[0].key;
  if (!_expanded) {
    _expanded = new Set(rows.length <= EXPAND_ALL_UPTO ? rows.map((r) => r.key) : [rows[0].key]);
  }
  // However the selection arrived — deep link, restored key — its ancestors are
  // opened, because a selected folder nobody can see in the tree is a dead end.
  const picked = rows.find((r) => r.key === _selectedKey);
  for (const key of picked.chain.slice(1)) _expanded.add(key);
}

function _selectFolder(key) {
  if (!key || key === _selectedKey) return;
  _selectedKey = key;
  // All three are about the folder you were looking at, not the one you picked.
  _adding = false;
  _pending = null;
  _showOthers = false;
  _render();
}

/** Redraw the tree in place, leaving the filter input and its caret alone. */
function _renderTree() {
  const host = _overlay?.querySelector("#tm-fa-tree");
  if (!host) return;
  host.innerHTML = renderFolderTree({
    rows: _folderRows(), grants: _data.grants,
    selectedKey: _selectedKey, expanded: _expanded, filter: _filter,
  });
}

async function _load() {
  const teamId = _teamId;
  try {
    const [members, payload] = await Promise.all([
      window.desktopApi.listTeamMembers(teamId),
      window.desktopApi.listTeamGrants(teamId).catch(() => ({ grants: [], defaults: {} })),
    ]);
    // The dialog may have closed or moved to another team while these were in
    // flight; painting the old team's people over the new one would be worse
    // than the loading state.
    if (_teamId !== teamId) return;
    _data = {
      members: members || [],
      grants: payload?.grants || [],
      teamDefault: payload?.defaults?.member || "write",
    };
    _render();
  } catch (err) {
    if (_teamId !== teamId) return;
    _setStatus(err?.message || String(err), true);
  }
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

function _render() {
  if (!_overlay || !_teamId) return;
  const record = _record();
  const rows = _folderRows();
  _ensureSelection(rows);

  _overlay.querySelector("#tm-title").textContent = record?.team?.name || "Team";
  const shared = Math.max(rows.length - 1, 0);
  _overlay.querySelector("#tm-meta").textContent = _data.members.length
    ? `${_data.members.length} ${_data.members.length === 1 ? "member" : "members"} · ${shared} shared ${shared === 1 ? "folder" : "folders"}`
    : "Loading…";
  const role = _overlay.querySelector("#tm-role");
  role.textContent = _isOwner() ? "You're an owner" : "You're a member";
  role.hidden = !record;

  _overlay.querySelector("#tm-tabs").innerHTML = TABS.map((t) => `
    <button class="tm__tab${t.id === _tab ? " tm__tab--active" : ""}" data-tab="${t.id}"
      type="button" role="tab" aria-selected="${t.id === _tab}">${t.label}</button>`).join("");

  const body = _overlay.querySelector("#tm-body");
  if (_tab === "people") body.innerHTML = _renderPeople(record, rows);
  else if (_tab === "access") body.innerHTML = _renderAccess(rows);
  else body.innerHTML = _renderTeamTab(record);
}

/**
 * One member: who they are, what that adds up to, and their team-wide level.
 *
 * The team-wide level IS a grant on the root, so the row carries the root key
 * and reuses the folder list's control and its change handler — setting someone
 * to "Read only" here and setting it on the root folder card are the same write,
 * because they are the same fact. Folder access then reads as the exceptions to
 * what is set here, which is the order an owner actually thinks in.
 *
 * Owners get a stated level, not a control: an owner can hand back any grant in
 * the team in the same breath, so a level set against one would be a lie.
 */
function _renderPerson(m, rows, isOwner) {
  const summary = m.role === "owner"
    ? "Full access everywhere"
    : summarizeAccess(rows, _data.grants, m.userId, _data.teamDefault);
  // The root key, not the root folder id — see _folderRows.
  const own = effectiveLevel(_data.grants, [_teamId], m.userId, _data.teamDefault);

  const control = m.role === "owner"
    ? `<span class="tm__person-fixed">Owner</span>`
    : isOwner
      ? accessSelect({
        userId: m.userId,
        value: own.source === "folder" ? own.access : "inherit",
        inheritLabel: `Team default (${labelOf(everyoneLevel(_data.grants, [_teamId], _data.teamDefault).access)})`,
        ariaLabel: `${m.login}, across the whole team`,
      })
      : `<span class="tm__person-fixed">${escapeHtml(labelOf(own.access))}</span>`;

  return `
    <div class="tm__person" data-user-id="${escapeHtml(m.userId)}"
      data-folder-key="${escapeHtml(_teamId)}">
      ${_renderAvatar(m)}
      <span class="tm__person-who">
        <span class="tm__person-line">
          <span class="tm__person-name">${escapeHtml(m.login)}</span>
          <span class="tm__person-role">${escapeHtml(m.role)}</span>
        </span>
        <span class="tm__person-access">${escapeHtml(summary)}</span>
      </span>
      ${control}
      ${isOwner && m.role !== "owner"
        ? `<button class="tm__btn tm__btn--small tm__btn--danger" data-act="remove-member" type="button">Remove</button>`
        : `<span></span>`}
    </div>`;
}

/**
 * A face, or the initial standing in for one.
 *
 * The monogram is not a fallback drawn after the image fails — it is the cell's
 * own content, with the image laid over it. A broken or slow avatar URL then
 * degrades to a readable initial instead of a blank hole.
 */
function _renderAvatar(m) {
  const name = m.displayName || m.login || "?";
  const initial = String(name).trim().charAt(0).toUpperCase() || "?";
  const img = m.avatarUrl
    ? `<img class="tm__avatar-img" src="${escapeHtml(m.avatarUrl)}" alt="" loading="lazy" />`
    : "";
  return `<span class="tm__avatar" aria-hidden="true">${escapeHtml(initial)}${img}</span>`;
}

function _renderPeople(record, rows) {
  const isOwner = _isOwner();
  const people = _data.members.length
    ? _data.members.map((m) => _renderPerson(m, rows, isOwner)).join("")
    : `<p class="tm__hint">Loading…</p>`;

  return `
    <div class="tm__section">
      <div class="tm__section-label">Invite people</div>
      ${_renderInvite(record, isOwner)}
    </div>
    <div class="tm__section">
      <div class="tm__section-label">Members</div>
      <div class="tm__people">${people}</div>
      ${isOwner
        ? `<p class="tm__hint tm__hint--foot">Everyone joins as a member. The level here applies across the whole team; narrow it for one folder under <button class="tm__link" data-act="go-access" type="button">Folder access</button>.</p>`
        : ""}
    </div>
  `;
}

/**
 * The invite block. A team has exactly one rotating code, so this is a code plus
 * Copy plus Rotate — rotating locks out everyone who has the old code, which is
 * why the confirmation says so. Per-invite links (their own role, expiry and
 * revoke) would replace the body here without touching the rest of the dialog.
 */
function _renderInvite(record, isOwner) {
  if (!isOwner) return `<p class="tm__hint">Only the team owner can invite people.</p>`;
  const code = record?.team?.inviteCode || "";
  if (!code) return `<p class="tm__hint">No invite code yet — reopen this dialog once the team has synced.</p>`;
  return `
    <p class="tm__hint">Anyone with this code can join the team.</p>
    <div class="tm__invite">
      <code class="tm__invite-code" id="tm-invite-code">${escapeHtml(code)}</code>
      <button class="tm__btn tm__btn--small" data-act="copy-invite" type="button">Copy</button>
      <button class="tm__btn tm__btn--small" data-act="rotate" type="button"
        title="Invalidate the old code">Rotate</button>
    </div>
  `;
}

function _renderAccess(rows) {
  const isOwner = _isOwner();
  if (!isOwner) {
    // A member gets their own levels and nothing else: what the rest of the
    // team may do is not theirs to see or to set.
    const me = state.teamSession?.userId;
    const mine = rows.map((r) => {
      const { access } = effectiveLevel(_data.grants, r.chain, me, _data.teamDefault);
      return `<div class="tm__mine" style="--depth:${r.depth}">
        <span class="tm__mine-name">${escapeHtml(r.name)}</span>
        <span class="tm__mine-level">${escapeHtml(labelOf(access))}</span>
      </div>`;
    }).join("");
    return `
      <p class="tm__hint">What you may do in each of this team's folders. Only the owner can change it.</p>
      ${rows.length ? mine : `<p class="tm__hint">Nothing is shared with this team yet.</p>`}`;
  }

  return `
    <p class="tm__hint">
      Pick a folder to see who can do what in it. Set it for <strong>everyone</strong> first, then name
      the people who differ — the nearest setting wins, so a folder left <em>Inherited</em> follows the
      one above it and anyone who joins later is covered without being listed.
    </p>
    ${renderFolderAccessBrowser({
      rows, members: _data.members, grants: _data.grants,
      teamDefault: _data.teamDefault, selectedKey: _selectedKey,
      expanded: _expanded, filter: _filter, showOthers: _showOthers,
      adding: _adding, pending: _pending,
    })}
  `;
}

function _renderTeamTab(record) {
  const isOwner = _isOwner();
  return `
    <div class="tm__section">
      <div class="tm__section-label">Name</div>
      <div class="tm__row">
        <span class="tm__value">${escapeHtml(record?.team?.name || "")}</span>
        ${isOwner ? `<button class="tm__btn tm__btn--small" data-act="rename" type="button">Rename</button>` : ""}
      </div>
    </div>
    <div class="tm__section">
      <div class="tm__section-label">Sync</div>
      <p class="tm__hint">Changes sync on their own. Pull if you want to be sure you have the latest right now.</p>
      <button class="tm__btn" data-act="pull" type="button">Pull now</button>
    </div>
    <div class="tm__section">
      <div class="tm__section-label">Danger zone</div>
      ${isOwner
        ? `<p class="tm__hint">Deleting the team removes the shared folder from every member. Everyone's local copies are kept as personal folders.</p>
           <button class="tm__btn tm__btn--danger" data-act="delete-team" type="button">Delete team</button>`
        : `<p class="tm__hint">Leaving keeps your local copy of the folder as a personal one; you stop receiving updates.</p>
           <button class="tm__btn tm__btn--danger" data-act="leave-team" type="button">Leave team</button>`}
    </div>
  `;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

async function _onBodyChange(e) {
  const picker = e.target.closest('select[data-act="pick-person"]');
  if (picker) {
    const folderKey = picker.closest("[data-folder-key]")?.dataset.folderKey;
    if (!picker.value || !folderKey) return;
    _pending = { folderKey, userId: picker.value };
    _adding = false;
    _render();
    return;
  }

  const select = e.target.closest('select[data-act="set-access"]');
  if (!select) return;
  const folderKey = select.closest("[data-folder-key]")?.dataset.folderKey;
  const userId = select.dataset.userId;
  if (!folderKey || !userId || !select.value) return; // "Choose a level…" is not a level

  select.disabled = true;
  try {
    await window.desktopApi.setTeamGrant(_teamId, folderKey, userId, select.value);
    // Re-read rather than patch: a grant set here changes what every folder
    // BELOW it inherits, and those folders are on screen too.
    await _reloadGrants();
    _adding = false;
    _pending = null;
    _render();
    _setStatus(userId === EVERYONE ? "Everyone's access updated." : "Access updated.");
    await _refreshLibrary();
  } catch (err) {
    _setStatus(err?.message || String(err), true);
    // Put the list back where the server still has it, rather than leaving a
    // control showing a level that was refused.
    _render();
  }
}

function _onBodyClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "go-access") { _tab = "access"; _render(); return; }
  if (act === "pick-folder") { _selectFolder(btn.dataset.key); return; }
  if (act === "toggle-folder") {
    // The twisty is nested inside the node, so closest() hands it over first and
    // opening a branch never doubles as picking it.
    if (_expanded.has(btn.dataset.key)) _expanded.delete(btn.dataset.key);
    else _expanded.add(btn.dataset.key);
    _renderTree();
    return;
  }
  if (act === "toggle-others") { _showOthers = !_showOthers; _render(); return; }
  if (act === "add-exception") { _adding = true; _render(); return; }
  if (act === "cancel-exception") { _adding = false; _pending = null; _render(); return; }
  if (act === "clear-exception") return _handleClearException(btn);
  if (act === "copy-invite") return _handleCopyInvite(btn);
  if (act === "rotate") return _handleRotate();
  if (act === "remove-member") return _handleRemoveMember(btn);
  if (act === "rename") return _handleRename();
  if (act === "pull") return _handlePull(btn);
  if (act === "delete-team") return _handleDelete();
  if (act === "leave-team") return _handleLeave();
}

/** Drop one person's exception: back to whatever the folder says for everyone. */
async function _handleClearException(btn) {
  const wrap = btn.closest("[data-user-id]");
  const folderKey = btn.closest("[data-folder-key]")?.dataset.folderKey;
  if (!wrap || !folderKey) return;
  btn.disabled = true;
  try {
    await window.desktopApi.setTeamGrant(_teamId, folderKey, wrap.dataset.userId, "inherit");
    await _reloadGrants();
    _render();
    _setStatus("Exception removed.");
    await _refreshLibrary();
  } catch (err) {
    _setStatus(err?.message || String(err), true);
    _render();
  }
}

async function _handleCopyInvite(btn) {
  const code = _overlay.querySelector("#tm-invite-code")?.textContent || "";
  if (!code) return;
  try {
    await window.desktopApi.writeClipboardText(code);
  } catch {
    _setStatus(`Could not copy. The code is ${code}.`, true);
    return;
  }
  btn.textContent = "Copied!";
  if (_copyTimer) clearTimeout(_copyTimer);
  _copyTimer = setTimeout(() => {
    if (btn.isConnected) btn.textContent = "Copy";
    _copyTimer = null;
  }, 2000);
}

async function _handleRotate() {
  const ok = await showConfirmModal({
    title: "Rotate invite code?",
    body: "The old code stops working immediately. Anyone already in the team stays.",
    confirmLabel: "Rotate",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    await window.desktopApi.rotateInvite(_teamId);
    await loadTeamState();
    _render();
    _setStatus("New invite code generated.");
  } catch (err) {
    _setStatus(err?.message || "Could not rotate the invite code.", true);
  }
}

async function _handleRemoveMember(btn) {
  const row = btn.closest(".tm__person");
  const login = row?.querySelector(".tm__person-name")?.textContent || "this member";
  const ok = await showConfirmModal({
    title: `Remove ${login}?`,
    body: "They keep their local copies but stop receiving updates.",
    confirmLabel: "Remove",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    await window.desktopApi.removeTeamMember(_teamId, row.dataset.userId);
    _data.members = _data.members.filter((m) => m.userId !== row.dataset.userId);
    _render();
    _setStatus(`${login} removed.`);
  } catch (err) {
    _setStatus(err?.message || "Could not remove that member.", true);
  }
}

/**
 * Rename a team, from the Team tab or from a right-click on its shared folder.
 * Renaming the root folder IS renaming the team — teamSync.renameTeam rewrites
 * the folder from the server's answer, and _ensureRootFolder would revert a
 * local-only rename anyway — so both gestures have to land on the same call.
 *
 * Returns null on success or when cancelled, or a message on failure: the two
 * callers report it differently (a status line in the dialog, a toast in the
 * library) and neither can show the other's.
 */
export async function promptRenameTeam(teamId, { onRefresh } = {}) {
  const current = (state.teams || []).find((t) => t.team.id === teamId);
  // Electron's renderer has no window.prompt() — it throws. Use the modal helper.
  const name = await showPrompt("New team name", current?.team?.name || "");
  if (!name?.trim()) return null;
  try {
    await window.desktopApi.renameTeam(teamId, name.trim());
    await loadTeamState();
  } catch (err) {
    return err?.message || String(err);
  }
  try {
    await onRefresh?.();
  } catch {
    // The caller's refresh failing must not read as the rename failing — the
    // rename already went through, on the server and in the root folder.
  }
  return null;
}

async function _handleRename() {
  const err = await promptRenameTeam(_teamId, { onRefresh: _onRefresh });
  if (err) { _setStatus(err, true); return; }
  _render();
}

async function _handlePull(btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Pulling…";
  try {
    await window.desktopApi.pullTeam(_teamId);
    await _refreshLibrary();
    _setStatus("Up to date with the team.");
  } catch (err) {
    _setStatus(err?.message || String(err), true);
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = original; }
  }
}

async function _handleDelete() {
  const ok = await showConfirmModal({
    title: "Delete this team?",
    body: "Every member loses the shared folder. Everyone's local copies are kept as personal folders.",
    confirmLabel: "Delete team",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    await window.desktopApi.deleteTeam(_teamId);
    closeTeamModal();
    await _refreshLibrary();
  } catch (err) {
    _setStatus(err?.message || String(err), true);
  }
}

async function _handleLeave() {
  const ok = await showConfirmModal({
    title: "Leave this team?",
    body: "Your local copy of the folder is kept as a personal folder.",
    confirmLabel: "Leave",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    await window.desktopApi.leaveTeam(_teamId);
    closeTeamModal();
    await _refreshLibrary();
  } catch (err) {
    _setStatus(err?.message || String(err), true);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function _reloadGrants() {
  const payload = await window.desktopApi.listTeamGrants(_teamId).catch(() => null);
  if (!payload) return;
  _data.grants = payload.grants || [];
  _data.teamDefault = payload.defaults?.member || _data.teamDefault;
}

async function _refreshLibrary() {
  try {
    await _onRefresh?.();
  } catch {
    // The caller's refresh failing must not read as the action itself failing —
    // the grant, rename or removal already went through.
  }
}

function _setStatus(message, isError = false) {
  const el = _overlay?.querySelector("#tm-status");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.toggle("tm__status--error", Boolean(message) && isError);
}
