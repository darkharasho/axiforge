"use strict";

const { serializeCompForPublish, getCompPublishBuildIds } = require("../../src/main/compPublish");

function makeComp(overrides = {}) {
  return {
    id: "comp-1",
    name: "Test Comp",
    notes: "Some notes",
    tags: ["t4", "cms"],
    gameMode: "pve",
    partyLines: [
      { id: "line-1", capacity: 5, slots: ["build-1", "build-2"] },
    ],
    buildIds: ["build-1", "build-2", "build-3"],
    ...overrides,
  };
}

function makeBuildEntry(id, spaUrl) {
  return { id, title: `Build ${id}`, profession: "Guardian", spaUrl };
}

describe("serializeCompForPublish", () => {
  test("includes comp fields", () => {
    const comp = makeComp();
    const buildsMap = {
      "build-1": makeBuildEntry("build-1", "https://x.github.io/axibuilds/?b=abc.key"),
      "build-2": makeBuildEntry("build-2", "https://x.github.io/axibuilds/?b=def.key"),
      "build-3": makeBuildEntry("build-3", "https://x.github.io/axibuilds/?b=ghi.key"),
    };
    const result = serializeCompForPublish(comp, buildsMap);
    expect(result.id).toBe("comp-1");
    expect(result.name).toBe("Test Comp");
    expect(result.notes).toBe("Some notes");
    expect(result.tags).toEqual(["t4", "cms"]);
    expect(result.gameMode).toBe("pve");
    expect(result.partyLines).toEqual(comp.partyLines);
  });

  test("includes all builds in buildsMap regardless of party line assignment", () => {
    const comp = makeComp();
    const buildsMap = {
      "build-1": makeBuildEntry("build-1", "https://x.github.io/axibuilds/?b=abc.key"),
      "build-2": makeBuildEntry("build-2", "https://x.github.io/axibuilds/?b=def.key"),
      "build-3": makeBuildEntry("build-3", "https://x.github.io/axibuilds/?b=ghi.key"),
    };
    const result = serializeCompForPublish(comp, buildsMap);
    expect(Object.keys(result.builds)).toHaveLength(3);
    expect(result.builds["build-3"].spaUrl).toBe("https://x.github.io/axibuilds/?b=ghi.key");
  });

  test("each build entry includes spaUrl", () => {
    const comp = makeComp();
    const buildsMap = {
      "build-1": makeBuildEntry("build-1", "https://x.github.io/axibuilds/?b=abc.key"),
      "build-2": makeBuildEntry("build-2", "https://x.github.io/axibuilds/?b=def.key"),
      "build-3": makeBuildEntry("build-3", null),
    };
    const result = serializeCompForPublish(comp, buildsMap);
    expect(result.builds["build-1"].spaUrl).toBe("https://x.github.io/axibuilds/?b=abc.key");
    expect(result.builds["build-3"].spaUrl).toBeNull();
  });

  test("does not include publishedFileId/Key/Slug on the output", () => {
    const comp = makeComp({ publishedFileId: "abc", publishedKey: "key", publishedSlug: "slug" });
    const buildsMap = { "build-1": makeBuildEntry("build-1", "https://x.io/?b=x.y") };
    const result = serializeCompForPublish(comp, buildsMap);
    expect(result.publishedKey).toBeUndefined();
  });

  test("slot referencing a build absent from buildsMap produces undefined entry — documents bug", () => {
    // When a slot's buildId is not in buildsMap, comp.builds[buildId] is undefined.
    // The SPA then renders an empty slot with no link. This test documents the root
    // cause that getCompPublishBuildIds (and the publish handler) must defend against.
    const comp = makeComp({
      buildIds: ["build-1"],          // build-2 missing from buildIds
      partyLines: [{ id: "line-1", capacity: 5, slots: ["build-1", "build-2"] }],
    });
    const buildsMap = {
      "build-1": makeBuildEntry("build-1", "https://x.io/?b=a.k"),
      // build-2 NOT in buildsMap because it was not in comp.buildIds
    };
    const result = serializeCompForPublish(comp, buildsMap);
    expect(result.builds["build-1"]).toBeDefined();
    expect(result.builds["build-2"]).toBeUndefined(); // empty slot — the bug
  });
});

// ─── getCompPublishBuildIds ────────────────────────────────────────────────────

describe("getCompPublishBuildIds", () => {
  test("returns all buildIds when partyLines slots are a subset", () => {
    const comp = makeComp(); // buildIds: [1,2,3], slots: [1,2]
    const ids = getCompPublishBuildIds(comp);
    expect(ids).toEqual(expect.arrayContaining(["build-1", "build-2", "build-3"]));
  });

  test("includes slot buildIds missing from comp.buildIds", () => {
    const comp = makeComp({
      buildIds: ["build-1"],
      partyLines: [{ id: "l1", capacity: 5, slots: ["build-1", "build-2"] }],
    });
    const ids = getCompPublishBuildIds(comp);
    expect(ids).toContain("build-1");
    expect(ids).toContain("build-2"); // was in slot but not buildIds
  });

  test("deduplicates build IDs that appear in both buildIds and slots", () => {
    const comp = makeComp({
      buildIds: ["build-1", "build-2"],
      partyLines: [{ id: "l1", capacity: 5, slots: ["build-1", "build-1", "build-2"] }],
    });
    const ids = getCompPublishBuildIds(comp);
    const unique = [...new Set(ids)];
    expect(ids).toHaveLength(unique.length);
  });

  test("handles comp with no partyLines", () => {
    const comp = makeComp({ partyLines: [] });
    const ids = getCompPublishBuildIds(comp);
    expect(ids).toEqual(expect.arrayContaining(["build-1", "build-2", "build-3"]));
  });

  test("handles comp with missing buildIds and partyLines", () => {
    const comp = { id: "c1", name: "Empty" };
    const ids = getCompPublishBuildIds(comp);
    expect(ids).toEqual([]);
  });

  test("handles slots with null/undefined entries gracefully", () => {
    const comp = {
      id: "c1", name: "Test",
      buildIds: ["build-1"],
      partyLines: [{ id: "l1", slots: ["build-1", null, undefined, "build-2"] }],
    };
    const ids = getCompPublishBuildIds(comp);
    expect(ids).toContain("build-1");
    expect(ids).toContain("build-2");
    expect(ids).not.toContain(null);
    expect(ids).not.toContain(undefined);
  });
});
