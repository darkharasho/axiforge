"use strict";
const fs = require("node:fs");
const path = require("node:path");
const MAIN = fs.readFileSync(path.join(__dirname, "../../src/main/index.js"), "utf8");
const PRELOAD = fs.readFileSync(path.join(__dirname, "../../src/preload/index.js"), "utf8");

const CHANNELS = ["teams:get-session", "teams:enable", "teams:disable", "teams:list", "teams:create", "teams:join", "teams:leave", "teams:delete", "teams:rename", "teams:members", "teams:remove-member", "teams:rotate-invite", "teams:share-folder", "teams:stop-sharing", "teams:pull", "teams:pull-all", "teams:resolve-conflict", "teams:outbox", "teams:legacy-status", "teams:migrate-org-library"];

test("every teams:* channel is handled in main and exposed in preload", () => {
  for (const ch of CHANNELS) {
    expect(MAIN).toContain(`handle("${ch}"`);
    expect(PRELOAD).toContain(`"${ch}"`);
  }
});

test("main no longer references the GitHub-org engine or its IPC", () => {
  expect(MAIN).not.toMatch(/require\("\.\/sharedLibrary"\)/);
  expect(MAIN).not.toMatch(/handle\("shared-library:/);
  expect(MAIN).not.toMatch(/sharedLibrary\.isOwner/);
  expect(MAIN).not.toMatch(/schedulePush\(|deleteBuildRemote\(|deleteCompRemote\(|schedulePushFolderMeta\(/);
});

test("the migration handler forwards progress on the team-share-progress channel", () => {
  const src = MAIN.slice(MAIN.indexOf('handle("teams:migrate-org-library"'));
  expect(src.slice(0, 400)).toContain('team-share-progress');
  expect(src.slice(0, 400)).toContain('migration: true');
});

test("mutating handlers enqueue outbox ops", () => {
  for (const needle of ['"build", "put"', '"build", "delete"', '"comp", "put"', '"comp", "delete"', '"folder", "put"', '"folder", "delete"']) {
    expect(MAIN).toContain(needle);
  }
});

test("publish handlers guard against publishing a teammate's item without force", () => {
  expect(MAIN.match(/PUBLISHED_BY_OTHER:/g).length).toBeGreaterThanOrEqual(2);
});

test("GitHub-org sync code is gone", () => {
  expect(fs.existsSync(path.join(__dirname, "../../src/main/sharedLibrary.js"))).toBe(false);
  const gh = fs.readFileSync(path.join(__dirname, "../../src/main/githubApi.js"), "utf8");
  for (const fn of ["ensureSharedRepo", "getRepoTree", "putSharedFile", "deleteSharedFile", "getOrgRole", "getHeadSha", "SHARED_REPO"]) {
    expect(gh).not.toContain(fn);
  }
  const ss = fs.readFileSync(path.join(__dirname, "../../src/main/syncStore.js"), "utf8");
  expect(ss).not.toMatch(/remoteShas/);
});

// Source slice for one handler: from its handle("...") to the next top-level
// handle( at the same indentation.
function handlerSource(channel) {
  const start = MAIN.indexOf(`handle("${channel}"`);
  expect(start).toBeGreaterThan(-1);
  const next = MAIN.indexOf('\n  handle("', start + 1);
  return MAIN.slice(start, next === -1 ? MAIN.length : next);
}

test("ownership guards run BEFORE the local write in save handlers", () => {
  const cases = [
    ["builds:save", "store.upsertBuild("],
    ["comps:save", "compStore.upsertComp("],
    ["folders:save", "folderStore.upsertFolder("],
  ];
  for (const [channel, writeCall] of cases) {
    const src = handlerSource(channel);
    const guard = src.indexOf("assertCanMoveOutOfTeam(");
    const write = src.indexOf(writeCall);
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  }
});

test("folders:save handles cross-team folder moves via enqueueFolderTree", () => {
  const src = handlerSource("folders:save");
  expect(src).toContain('enqueueFolderTree(');
  expect(src).toMatch(/enqueueFolderTree\([^)]*"put"\)/);
  expect(src).toMatch(/enqueueFolderTree\([^)]*"delete"\)/);
  // Team root folders can only be renamed/moved from Settings → Teams.
  expect(src).toContain("Rename or move the team from Settings");
});

test("every outbox enqueue is wrapped in safeEnqueue so a failed enqueue cannot fail the IPC", () => {
  expect(MAIN).toContain("async function safeEnqueue(");
  const re = /teamSync\.(enqueue|enqueueFolderTree)\(/g;
  let m;
  let seen = 0;
  while ((m = re.exec(MAIN))) {
    seen++;
    const lineStart = MAIN.lastIndexOf("\n", m.index) + 1;
    const line = MAIN.slice(lineStart, m.index);
    expect(line).toContain("safeEnqueue(() =>");
  }
  expect(seen).toBeGreaterThanOrEqual(10);
});

test("tag and import handlers enqueue their mutations", () => {
  // Tag handlers go through the shared enqueueCompPuts helper (itself safeEnqueue-wrapped).
  for (const ch of ["comps:add-tags", "comps:remove-tags"]) {
    expect(handlerSource(ch)).toContain("enqueueCompPuts(");
  }
  for (const ch of ["builds:import-chat-link", "builds:import-gw2skills"]) {
    expect(handlerSource(ch)).toContain("safeEnqueue(");
  }
});

test("comp publishing leaves builds published by someone else alone", () => {
  expect(MAIN).toContain("decideCompBuildPublish(");
  expect(MAIN).toContain("skippedForeignBuilds");
});

test("polling is stopped on quit and only started when a team session exists", () => {
  expect(MAIN).toMatch(/app\.on\("will-quit"[\s\S]{0,900}teamSyncRef\.stopPolling\(\)/);
  expect(MAIN).toMatch(/if \(await teamSync\.getSession\(\)\) teamSync\.startPolling\(\);/);
});

test("folders:save checks the whole subtree's depth BEFORE the local write", () => {
  const src = handlerSource("folders:save");
  const guard = src.indexOf("assertFolderTreeFits(");
  const write = src.indexOf("folderStore.upsertFolder(");
  expect(guard).toBeGreaterThan(-1);
  expect(guard).toBeLessThan(write);
});

test("builds:save treats a missing folderId as 'unchanged' (upsertBuild preserves it), not as a move to personal", () => {
  const src = handlerSource("builds:save");
  expect(src).toContain("newFolderId: build.folderId ?? oldFolderId");
  expect(src).not.toContain("newFolderId: build.folderId ?? null");
});

test("the migrated renderer files no longer use the shared-library compat shims and preload no longer defines them", () => {
  // Scoped to the files migrated in this task. settings-modal.js is rewritten
  // in a later task and still holds the old shared-library pane.
  const migrated = [
    "modules/teams.js",
    "modules/choice-modal.js",
    "modules/sync-status.js",
    "modules/state.js",
    "renderer.js",
    "modules/library/library.js",
    "modules/library/folder-store.js",
    "modules/library/context-menu.js",
    "modules/library/drag-drop.js",
  ].map((f) => path.join(__dirname, "../../src/renderer", f));
  const src = migrated.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const name of [
    "getSharedLibraryConfig(", "pullAllShared(", "desktopApi.pullFolder(", "desktopApi.shareFolder(",
    "desktopApi.unshareFolder(", "listOrgs(", "setupSharedLibrary(", "connectSharedLibrary(",
    "disconnectSharedLibrary(", "forcePush(", "sharedLibraryConfig",
  ]) {
    expect(src).not.toContain(name);
  }
  for (const name of ["getSharedLibraryConfig", "pullAllShared", "listOrgs", "setupSharedLibrary", "connectSharedLibrary", "disconnectSharedLibrary", "forcePush"]) {
    expect(PRELOAD).not.toContain(name);
  }
});

test("library UI is wired to teams", () => {
  const cm = fs.readFileSync(path.join(__dirname, "../../src/renderer/modules/library/context-menu.js"), "utf8");
  expect(cm).toContain("Share to team…");
  expect(cm).toContain("Stop sharing");
  expect(cm).toContain("Pull now");
  expect(cm).toContain("shareFolderToTeam(");
  expect(cm).toContain("stopSharingFolder(");
  const sb = fs.readFileSync(path.join(__dirname, "../../src/renderer/modules/library/sidebar.js"), "utf8");
  expect(sb).toContain("Team Folders");
  expect(sb).toContain("teamLabel(");
  // No assertion on orgName — Task 6 adds an orphan banner keyed on it (R4).
  // Assert the badges are team-driven instead.
  const ct = fs.readFileSync(path.join(__dirname, "../../src/renderer/modules/library/content.js"), "utf8");
  expect(ct).toContain("teamLabel(");
  expect(ct).not.toMatch(/Shared with \$\{escapeHtml\(/);
});
