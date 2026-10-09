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

// Publish-on-save hangs off autoPublishAfterSave, so a write path that skips it
// leaves the record unpublished. Imports did: every import handler wrote with
// store.upsertBuild / compStore.upsertComp directly, and an imported build sat
// at "never published" until it was edited.
describe("every handler that writes a build or comp publishes it", () => {
  // Name → body, for handlers and the import helper they share.
  function blocks() {
    const out = new Map();
    const re = /\n  (?:handle\("([^"]+)"|async function (writeAxiImport)\()/g;
    const starts = [...src.matchAll(re)].map((m) => ({ name: m[1] || m[2], at: m.index }));
    starts.forEach((s, i) => out.set(s.name, src.slice(s.at, starts[i + 1]?.at ?? src.length)));
    return out;
  }

  test.each([
    "builds:import-chat-link",
    "builds:import-gw2skills",
    "writeAxiImport",
    "comps:import-share-code",
  ])("%s", (name) => {
    const body = blocks().get(name);
    expect(body).toBeTruthy();
    expect(body).toMatch(/autoPublishAfterSave\(/);
  });

  test("no other handler writes a record without publishing it", () => {
    const writes = /store\.upsertBuild\(|compStore\.upsertComp\(/;
    const skipped = [...blocks()]
      .filter(([, body]) => writes.test(body) && !/autoPublishAfterSave\(/.test(body))
      .map(([name]) => name);
    expect(skipped).toEqual([]);
  });
});
