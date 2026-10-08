"use strict";

// index.js is the Electron entry point and can't be loaded under Jest, so the
// publish wiring this plan depends on is pinned at the source level.
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "../../src/main/index.js"), "utf8");

describe("publish wiring", () => {
  test("publishing a build no longer re-uploads comps", () => {
    expect(src).not.toMatch(/affectedComps/);
    expect(src).not.toMatch(/compRestamps/);
  });

  test("comp publish takes no coverage HTML", () => {
    expect(src).toMatch(/handle\("comps:publish-comp", \(event, compId, opts\)/);
    expect(src).not.toMatch(/boonCoverageHtml\)/);
  });

  test("publish fetches each build's catalog for its own game mode", () => {
    const calls = src.match(/getProfessionCatalog\([^)]*"en"[^)]*\)/g) || [];
    const publishCalls = calls.filter((c) => /build\.profession|cb\.profession/.test(c));
    expect(publishCalls.length).toBeGreaterThan(0);
    for (const call of publishCalls) expect(call).toMatch(/gameMode/);
  });
});
