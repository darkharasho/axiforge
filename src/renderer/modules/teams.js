// Renderer team state — the single place the UI reads team session / membership
// / outbox from. Everything here works off state.folders, where a team's root
// folder carries { shared: true, teamId, role }.

import { state } from "./state.js";

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
    return;
  }
  state.teams = await window.desktopApi.listTeams().catch(() => []);
  state.outbox = await window.desktopApi.listOutbox().catch(() => ({}));
  // listTeams reconciles membership, so roots may have been created or detached.
  state.folders = await window.desktopApi.listFolders();
}
