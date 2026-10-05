/** @jest-environment jsdom */
"use strict";

// A duplicate is a new, unpublished record: carrying the original's
// publishedFileId/Key would make the copy claim the original's published page.
const fs = require("node:fs");
const path = require("node:path");

const lib = fs.readFileSync(path.join(__dirname, "../../../src/renderer/modules/library/library.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "../../../src/renderer/renderer.js"), "utf8");

test("both library duplicates strip the publish receipt", () => {
  expect(lib).toMatch(/async function handleDuplicate\(buildId\) \{[\s\S]*?const copy = withoutPublishReceipt\(build\);/);
  expect(lib).toMatch(/async function handleDuplicateComp\(compId\) \{[\s\S]*?const copy = withoutPublishReceipt\(comp\);/);
});

test("sync splices replace the arrays instead of mutating them", () => {
  expect(renderer).not.toMatch(/state\.builds\[idx\] = data\.item/);
  expect(renderer).not.toMatch(/state\.comps\[idx\] = data\.item/);
  expect(renderer).not.toMatch(/state\.builds\.push\(data\.item\)/);
  expect(renderer).not.toMatch(/state\.comps\.push\(data\.item\)/);
});
