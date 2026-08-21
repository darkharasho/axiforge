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
