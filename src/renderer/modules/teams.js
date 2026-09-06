// Renderer team state — the single place the UI reads team session / membership
// / outbox from. Everything here works off state.folders, where a team's root
// folder carries { shared: true, teamId, role }.

import { state } from "./state.js";
import { loadAccessMap } from "./library/access.js";

/** Nearest ancestor (or self) that is a team root folder. */
export function teamRootFor(folderId, folders = state.folders) {
  let current = folderId ? folders.find((f) => f.id === folderId) : null;
  while (current) {
    if (current.teamId) return current;
    if (!current.parentId) return null;
    current = folders.find((f) => f.id === current.parentId);
  }
  return null;
}

/** The root folder for a team id, or null when the team has no local root yet. */
export function rootForTeam(teamId, folders = state.folders) {
  return folders.find((f) => f.teamId === teamId) || null;
}

/** True when folderId lives in a team the current user owns. */
export function isTeamOwner(folderId) {
  return teamRootFor(folderId)?.role === "owner";
}

/** Sidebar/badge label for a team root folder. */
export function teamLabel(folder) {
  return `Team: ${folder.name} · ${folder.role || "member"}`;
}

/** Refresh session, teams, outbox and folders from main. Safe when sync is off. */
export async function loadTeamState() {
  state.teamSession = await window.desktopApi.getTeamSession().catch(() => null);
  if (!state.teamSession) {
    state.teams = [];
    state.outbox = {};
    state.folderAccess = {};
    return;
  }
  state.teams = await window.desktopApi.listTeams().catch(() => []);
  state.outbox = await window.desktopApi.listOutbox().catch(() => ({}));
  // listTeams reconciles membership, so roots may have been created or detached.
  state.folders = await window.desktopApi.listFolders();
  // After the folders, not before: the map is keyed by folder id and main
  // resolves it over the same tree, so a stale read here would grey out the
  // wrong folders for one render.
  await loadAccessMap();
}

/**
 * Restore badges for work still queued (or conflicted) after a restart, from
 * state.outbox. Only conflicts are seeded for folders: a conflicted entry is
 * sticky until the user resolves it, whereas a pending folder op has no
 * per-item "synced" event to clear its badge again (main suppresses those for
 * type "folder"), so a pending folder clock would never go away.
 */
export function seedSyncStatusFromOutbox() {
  for (const [teamId, entries] of Object.entries(state.outbox || {})) {
    for (const entry of entries || []) {
      const { itemId, type } = entry;
      if (type !== "build" && type !== "comp" && type !== "folder") continue;
      if (type === "folder") {
        if (!entry.conflict) continue;
        state.folderSyncStatus[itemId] = "conflict";
      } else {
        const statusMap = type === "build" ? "buildSyncStatus" : "compSyncStatus";
        state[statusMap][itemId] = entry.conflict ? "conflict" : "pending";
        if (!entry.conflict) continue;
      }
      state.conflicts[`${type}:${itemId}`] = {
        teamId, itemId, type, title: _itemTitle(type, itemId), current: entry.conflict,
      };
    }
  }
}

function _itemTitle(type, itemId) {
  const list = type === "build" ? state.builds : type === "comp" ? state.comps : state.folders;
  const item = (list || []).find((i) => i.id === itemId);
  return item?.title || item?.name || "";
}
