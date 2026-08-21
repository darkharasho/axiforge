"use strict";
const fs = require("node:fs");
const path = require("node:path");
const MAIN = fs.readFileSync(path.join(__dirname, "../../src/main/index.js"), "utf8");
const PRELOAD = fs.readFileSync(path.join(__dirname, "../../src/preload/index.js"), "utf8");

const CHANNELS = ["teams:get-session", "teams:enable", "teams:disable", "teams:list", "teams:create", "teams:join", "teams:leave", "teams:delete", "teams:rename", "teams:members", "teams:remove-member", "teams:rotate-invite", "teams:share-folder", "teams:stop-sharing", "teams:pull", "teams:pull-all", "teams:resolve-conflict", "teams:outbox"];

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
