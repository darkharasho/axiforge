"use strict";

const { serializeCompForPublish } = require("../../src/main/compPublish");

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
});
