// Share Modal — the one surface for getting a folder into a team and getting the
// invite code back out. Right-click a folder (list page or sidebar) → "Share…".
//
// It renders one of three states and re-renders in place as they change, so the
// user never has to leave for Settings mid-flow:
//   1. no team session  → sign in to GitHub right here
//   2. personal folder  → pick or create a team, then share
//   3. shared folder    → invite code, members, sync, stop sharing
//
// The invite block is its own render function on purpose: per-invite records
// (roles, revoke) would grow there without touching the rest of the modal.

import { escapeHtml } from "../utils.js";
import { state } from "../state.js";
import { showConfirmModal } from "../confirm-modal.js";
import { loadTeamState, teamRootFor } from "../teams.js";
import { shareFolderToTeam, stopSharingFolder, pullTeamFor } from "./folder-store.js";
import { xMarkIcon } from "./heroicons.js";

let _overlay = null;
let _escHandler = null;
let _folderId = null;
let _onRefresh = null;
let _copyTimer = null;
// A team created by the "New team…" path but whose folder upload then failed.
// Remembered so a retry reuses it instead of creating a duplicate every click.
let _pendingNewTeamId = null;
let _onTeamSyncEnabled = null;

/**
 * @param {{ onTeamSyncEnabled?: Function }} [callbacks]
 *   onTeamSyncEnabled — same hook Settings fires, so the "signed out" banner
 *   comes down when the user signs in from here instead.
 */
export function initShareModal(callbacks = {}) {
  if (typeof document === "undefined") return;
  if (callbacks.onTeamSyncEnabled) _onTeamSyncEnabled = callbacks.onTeamSyncEnabled;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "shm-overlay shm-overlay--hidden";
  _overlay.innerHTML = `
    <div class="shm" role="dialog" aria-modal="true" aria-labelledby="shm-title">
      <div class="shm__header">
        <h3 class="shm__title" id="shm-title">Share</h3>
        <button class="shm__close" id="shm-close" type="button" aria-label="Close">${xMarkIcon}</button>
      </div>
      <div class="shm__body" id="shm-body"></div>
      <div class="shm__status" id="shm-status" hidden></div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _overlay.querySelector("#shm-close").addEventListener("click", closeShareModal);
  _overlay.addEventListener("mousedown", (e) => {
    if (e.target === _overlay) closeShareModal();
  });
  _overlay.querySelector("#shm-body").addEventListener("click", _onBodyClick);
}

/**
 * Open the share dialog for a folder.
 * @param {string} folderId
 * @param {{ onRefresh?: Function }} [opts]
 */
export async function openShareModal(folderId, opts = {}) {
  if (!_overlay) initShareModal();
  if (!_overlay) return;

  _folderId = folderId;
  _onRefresh = opts.onRefresh || null;
  _pendingNewTeamId = null;

  _overlay.classList.remove("shm-overlay--hidden");
  // Re-opening without an intervening close would otherwise orphan the previous
  // handler permanently.
  if (_escHandler) document.removeEventListener("keydown", _escHandler);
  _escHandler = (e) => { if (e.key === "Escape") closeShareModal(); };
  document.addEventListener("keydown", _escHandler);

  _render();
}

export function closeShareModal() {
  if (!_overlay) return;
  _overlay.classList.add("shm-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
  if (_copyTimer) { clearTimeout(_copyTimer); _copyTimer = null; }
  _folderId = null;
  _pendingNewTeamId = null;
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

function _folder() {
  return state.folders.find((f) => f.id === _folderId) || null;
}

/** The { team, role } record backing a team root folder, when we have one. */
function _teamRecord(teamRoot) {
  return (state.teams || []).find((t) => t.team.id === teamRoot?.teamId) || null;
}

function _render() {
  const body = _overlay.querySelector("#shm-body");
  const title = _overlay.querySelector("#shm-title");
  const folder = _folder();
  const teamRoot = folder ? teamRootFor(_folderId) : null;

  _setStatus("");

  if (!folder) {
    title.textContent = "Share";
    body.innerHTML = `<p class="shm__hint">That folder no longer exists.</p>`;
    return;
  }

  if (!state.teamSession) {
    title.textContent = `Share "${folder.name}"`;
    body.innerHTML = _renderSignedOut();
    return;
  }

  if (teamRoot) {
    title.textContent = `Sharing "${teamRoot.name}"`;
    body.innerHTML = _renderShared(teamRoot);
    _loadMembers(teamRoot);
    return;
  }

  title.textContent = `Share "${folder.name}"`;
  body.innerHTML = _renderPicker(folder);
}

function _renderSignedOut() {
  return `
    <p class="shm__hint">
      Team sync keeps a folder in step across everyone you share it with. It signs in
      with the same GitHub account Publishing uses.
    </p>
    <div class="shm__actions">
      <button class="shm__btn shm__btn--primary" data-act="enable" type="button">Enable team sync</button>
    </div>
  `;
}

function _renderPicker(folder) {
  const teams = state.teams || [];
  // Preselect the first team: with one team — the common case — sharing is then
  // a single click, and nobody meets an empty picker that refuses to submit.
  // After a failed "New team…" attempt the team already exists — preselect it so
  // the retry shares into it rather than creating another one.
  const preselect = _pendingNewTeamId && teams.some(({ team }) => team.id === _pendingNewTeamId)
    ? _pendingNewTeamId
    : teams[0]?.team?.id || null;
  const options = teams.map(({ team }) => `
    <label class="shm__team-option">
      <input type="radio" name="shm-team" value="${escapeHtml(team.id)}" ${team.id === preselect ? "checked" : ""}>
      <span class="shm__team-name">${escapeHtml(team.name)}</span>
    </label>
  `).join("");

  return `
    <p class="shm__hint">
      <strong>${escapeHtml(folder.name)}</strong> and every build and comp inside it become
      visible and editable by everyone in the team.
    </p>
    <div class="shm__teams">
      ${options}
      <label class="shm__team-option">
        <input type="radio" name="shm-team" value="__new" ${teams.length ? "" : "checked"}>
        <span class="shm__team-name">New team…</span>
      </label>
      <input class="shm__input" id="shm-new-team" type="text" placeholder="Team name"
        ${teams.length ? "hidden" : ""}>
    </div>
    <div class="shm__actions">
      <button class="shm__btn shm__btn--primary" data-act="share" type="button">Share folder</button>
    </div>
  `;
}

function _renderShared(teamRoot) {
  const record = _teamRecord(teamRoot);
  const isOwner = teamRoot.role === "owner";
  // The engine only un-shares a SUB-folder of a team; the root is unshared by
  // leaving or deleting the team in Settings → Teams.
  const canStopSharing = isOwner && teamRoot.id !== _folderId;
  return `
    <div class="shm__section">
      <div class="shm__section-label">Invite</div>
      ${_renderInviteSection(record, isOwner)}
    </div>
    <div class="shm__section">
      <div class="shm__section-label">Members</div>
      <div class="shm__members" id="shm-members"><p class="shm__hint">Loading…</p></div>
    </div>
    <div class="shm__footer">
      <button class="shm__btn" data-act="pull" type="button">Pull now</button>
      ${canStopSharing ? `<button class="shm__btn shm__btn--danger" data-act="stop-sharing" type="button">Stop sharing</button>` : ""}
    </div>
  `;
}

/**
 * The invite block. Today a team has exactly one rotating code, so this is a
 * code plus Copy plus Rotate. Per-invite records would replace the body here.
 */
function _renderInviteSection(record, isOwner) {
  if (!isOwner) {
    return `<p class="shm__hint">Only the team owner can invite people.</p>`;
  }
  const code = record?.team?.inviteCode || "";
  if (!code) {
    return `<p class="shm__hint">No invite code yet — reopen this dialog once the team has synced.</p>`;
  }
  return `
    <p class="shm__hint">Anyone with this code can join the team and get this folder.</p>
    <div class="shm__invite">
      <code class="shm__invite-code" id="shm-invite-code">${escapeHtml(code)}</code>
      <button class="shm__btn shm__btn--small" data-act="copy-invite" type="button">Copy</button>
      <button class="shm__btn shm__btn--small" data-act="rotate" type="button"
        title="Invalidate the old code">Rotate</button>
    </div>
  `;
}

async function _loadMembers(teamRoot) {
  const box = _overlay.querySelector("#shm-members");
  if (!box) return;
  let members;
  try {
    members = await window.desktopApi.listTeamMembers(teamRoot.teamId);
  } catch (err) {
    box.innerHTML = `<p class="shm__hint">Could not load members: ${escapeHtml(err?.message || String(err))}</p>`;
    return;
  }
  // The dialog may have closed or re-rendered while the request was in flight.
  // Test the captured node itself — a re-render replaces #shm-members, so a
  // presence check would pass while `box` is detached.
  if (!box.isConnected) return;

  const isOwner = teamRoot.role === "owner";
  box.innerHTML = members.map((m) => `
    <div class="shm__member" data-user-id="${escapeHtml(m.userId)}">
      <span class="shm__member-name">${escapeHtml(m.login)}</span>
      <span class="shm__member-role">${escapeHtml(m.role)}</span>
      ${isOwner && m.role !== "owner"
        ? `<button class="shm__btn shm__btn--small shm__btn--danger" data-act="remove-member" type="button">Remove</button>`
        : ""}
    </div>
  `).join("");
}

// ─── Actions ───────────────────────────────────────────────────────────────────

function _onBodyClick(e) {
  const radio = e.target.closest('input[name="shm-team"]');
  if (radio) {
    const input = _overlay.querySelector("#shm-new-team");
    if (input) {
      input.hidden = radio.value !== "__new";
      if (!input.hidden) input.focus();
    }
    return;
  }

  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === "enable") return _handleEnable(btn);
  if (act === "share") return _handleShare(btn);
  if (act === "copy-invite") return _handleCopyInvite(btn);
  if (act === "rotate") return _handleRotate();
  if (act === "remove-member") return _handleRemoveMember(btn);
  if (act === "pull") return _handlePull(btn);
  if (act === "stop-sharing") return _handleStopSharing();
}

async function _handleEnable(btn) {
  await _busy(btn, "Enabling…", async () => {
    await window.desktopApi.enableTeamSync();
    await loadTeamState();
    // Same hook Settings fires — without it the "team sync signed out" banner
    // stays up telling a freshly signed-in user they are signed out.
    _onTeamSyncEnabled?.();
    _onRefresh?.();
    _render();
  });
}

async function _handleShare(btn) {
  const choice = _overlay.querySelector('input[name="shm-team"]:checked');
  if (!choice) { _setStatus("Pick a team, or create a new one.", true); return; }

  await _busy(btn, "Sharing…", async () => {
    let teamId = choice.value;
    if (teamId === "__new") {
      // A previous attempt may already have created the team and only failed on
      // the upload. Reuse it — otherwise every retry leaves an orphan team.
      if (_pendingNewTeamId) {
        teamId = _pendingNewTeamId;
      } else {
        const name = _overlay.querySelector("#shm-new-team")?.value.trim();
        if (!name) { _setStatus("Enter a name for the new team.", true); return; }
        const { team } = await window.desktopApi.createTeam(name);
        teamId = team.id;
        _pendingNewTeamId = team.id;
        await loadTeamState();
      }
    }
    let result;
    try {
      result = (await shareFolderToTeam(_folderId, teamId)) || {};
    } catch (err) {
      // Re-render so the picker reflects the team that now exists (and
      // preselects it); _busy's catch paints the error after this returns.
      _render();
      throw err;
    }
    const { uploaded = 0, failed = [] } = result;
    _pendingNewTeamId = null;
    await loadTeamState();
    _onRefresh?.();
    _render();
    _setStatus(
      failed.length
        ? `Shared ${uploaded} items; ${failed.length} failed: ${failed.map((f) => f.message).join("; ")}`
        : `Shared ${uploaded} items. Send your team the invite code.`,
      failed.length > 0,
    );
  });
}

async function _handleCopyInvite(btn) {
  const code = _overlay.querySelector("#shm-invite-code")?.textContent || "";
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
  const teamRoot = teamRootFor(_folderId);
  if (!teamRoot) return;
  try {
    await window.desktopApi.rotateInvite(teamRoot.teamId);
    await loadTeamState();
    _render();
    _setStatus("New invite code generated.");
  } catch (err) {
    _setStatus(err?.message || "Could not rotate the invite code.", true);
  }
}

async function _handleRemoveMember(btn) {
  const row = btn.closest(".shm__member");
  const login = row?.querySelector(".shm__member-name")?.textContent || "this member";
  const ok = await showConfirmModal({
    title: `Remove ${login}?`,
    body: "They keep their local copies but stop receiving updates.",
    confirmLabel: "Remove",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  const teamRoot = teamRootFor(_folderId);
  if (!teamRoot) return;
  try {
    await window.desktopApi.removeTeamMember(teamRoot.teamId, row.dataset.userId);
    row.remove();
    _setStatus(`${login} removed.`);
  } catch (err) {
    _setStatus(err?.message || "Could not remove that member.", true);
  }
}

async function _handlePull(btn) {
  await _busy(btn, "Pulling…", async () => {
    await pullTeamFor(_folderId);
    _onRefresh?.();
    _setStatus("Up to date with the team.");
  });
}

async function _handleStopSharing() {
  const folder = _folder();
  const teamRoot = teamRootFor(_folderId);
  // Only a sub-folder can be un-shared — the root is handled by leaving/deleting
  // the team, and stopSharingFolder rejects it outright.
  if (!folder || !teamRoot || teamRoot.id === _folderId) return;
  const ok = await showConfirmModal({
    title: "Stop sharing this folder?",
    body: `<strong>${escapeHtml(folder.name)}</strong> and everything in it will be removed from the team. Your copy stays in this folder; teammates lose it.`,
    confirmLabel: "Stop sharing",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    await stopSharingFolder(_folderId);
    await loadTeamState();
    _onRefresh?.();
    closeShareModal();
  } catch (err) {
    _setStatus(err?.message || "Could not stop sharing this folder.", true);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Run an async action with the button disabled, surfacing failures inline. */
async function _busy(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } catch (err) {
    _setStatus(err?.message || String(err), true);
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

function _setStatus(message, isError = false) {
  const el = _overlay?.querySelector("#shm-status");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.toggle("shm__status--error", Boolean(message) && isError);
}
