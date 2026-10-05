/** @jest-environment jsdom */
"use strict";

// Every library view must carry the publish mark. The views build their rows by
// string concatenation, so the guard is structural: every call site that draws
// the sync indicator must draw the combined indicators instead.
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(
  path.join(__dirname, "../../../src/renderer/modules/library/content.js"), "utf8",
);

test("no view draws the sync indicator without the publish mark", () => {
  const bare = src.match(/\$\{itemSyncIndicatorHtml\(/g) || [];
  expect(bare).toHaveLength(0);
});

test("all ten build/comp rows across the five views draw both indicators", () => {
  const combined = src.match(/\$\{itemIndicatorsHtml\("(build|comp)", [bc]\)\}/g) || [];
  expect(combined).toHaveLength(10);
});

test("the combined helper appends the publish mark to the sync indicator", () => {
  expect(src).toMatch(/function itemIndicatorsHtml\(type, item\) \{\s*return itemSyncIndicatorHtml\(type, item\) \+ itemPublishBadgeHtml\(type, item, state\.builds\);\s*\}/);
});
