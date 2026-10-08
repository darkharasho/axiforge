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

describe("serializeCompForPublish", () => {
  test("includes comp fields", () => {
    const comp = makeComp();
    const result = serializeCompForPublish(comp, {});
    expect(result.id).toBe("comp-1");
    expect(result.name).toBe("Test Comp");
    expect(result.notes).toBe("Some notes");
    expect(result.tags).toEqual(["t4", "cms"]);
    expect(result.gameMode).toBe("pve");
    expect(result.partyLines).toEqual(comp.partyLines);
  });

  test("includes comp categories so published comps can render tag slots", () => {
    const categories = [
      { id: "cat-dps", name: "DPS", icon: "img/tags/might.png", buildIds: ["build-1"] },
    ];
    const result = serializeCompForPublish(makeComp({ categories }), {});
    expect(result.categories).toEqual(categories);
  });

  test("includes notes images so pasted screenshots survive publishing", () => {
    const images = { 1: "data:image/jpeg;base64,AAAA" };
    const result = serializeCompForPublish(makeComp({ images }), {});
    expect(result.images).toEqual(images);
  });

  test("defaults images to an empty object when the comp has none", () => {
    const result = serializeCompForPublish(makeComp({ images: undefined }), {});
    expect(result.images).toEqual({});
  });

  test("bakes class icons for :Name: emoji used in the notes", () => {
    const comp = makeComp({ notes: "Bring :Firebrand: and :Reaper: to mid" });
    const result = serializeCompForPublish(comp, {});
    expect(Object.keys(result.notesClassIcons).sort()).toEqual(["Firebrand", "Reaper"]);
    expect(result.notesClassIcons.Firebrand).toMatch(/<svg/);
  });

  test("canonicalizes the emoji name so :firebrand: still resolves", () => {
    const result = serializeCompForPublish(makeComp({ notes: "go :firebrand:" }), {});
    expect(result.notesClassIcons.Firebrand).toMatch(/<svg/);
  });

  test("ignores :tokens: that are not class names", () => {
    const result = serializeCompForPublish(makeComp({ notes: "ping :everyone: at :30:" }), {});
    expect(result.notesClassIcons).toEqual({});
  });

  test("defaults notesClassIcons to an empty object when there are no notes", () => {
    const result = serializeCompForPublish(makeComp({ notes: "" }), {});
    expect(result.notesClassIcons).toEqual({});
  });

  test("defaults categories to an empty array when the comp has none", () => {
    const result = serializeCompForPublish(makeComp({ categories: undefined }), {});
    expect(result.categories).toEqual([]);
  });

  test("does not include publishedFileId/Key/Slug on the output", () => {
    const comp = makeComp({ publishedFileId: "abc", publishedKey: "key", publishedSlug: "slug" });
    const result = serializeCompForPublish(comp, {});
    expect(result.publishedKey).toBeUndefined();
  });
});

describe("serializeCompForPublish v2", () => {
  test("links members instead of embedding builds and drops coverage HTML", () => {
    const members = { "build-1": { fileId: "aaaa1111", key: "K1", owner: "me" } };
    const result = serializeCompForPublish(makeComp({ boonCoverageHtml: "<div>8 MB</div>" }), members);
    expect(result.v).toBe(2);
    expect(result.members).toEqual(members);
    expect(result).not.toHaveProperty("builds");
    expect(result).not.toHaveProperty("boonCoverageHtml");
  });
});

describe("planCompMembers", () => {
  const { planCompMembers } = require("../../src/main/compPublish");
  let n = 0;
  const deps = { slugOf: (b) => b.title.toLowerCase(), newFileId: () => `new${++n}`, newKey: () => "NEWKEY" };

  test("own builds are uploaded and linked under the publisher", () => {
    const plan = planCompMembers({ ...deps, owner: "me", compBuilds: [
      { id: "b1", title: "One" },
      { id: "b2", title: "Two", publishedFileId: "keep2222", publishedKey: "K2", publishedOwner: "me", publishedSlug: "two" },
    ] });
    expect(plan.uploads.map((u) => u.build.id)).toEqual(["b1", "b2"]);
    expect(plan.members.b2).toEqual({ fileId: "keep2222", key: "K2", owner: "me", slug: "two", theme: "" });
    expect(plan.members.b1.owner).toBe("me");
    expect(plan.uploads[0].needsRecord).toBe(true);
    expect(plan.uploads[1].needsRecord).toBe(false);
  });

  test("a teammate's published build is linked from their repo, never uploaded", () => {
    const plan = planCompMembers({ ...deps, owner: "me", compBuilds: [
      { id: "b3", title: "Theirs", publishedFileId: "mate3333", publishedKey: "K3", publishedOwner: "mate" },
    ] });
    expect(plan.uploads).toHaveLength(0);
    expect(plan.members.b3).toEqual({ fileId: "mate3333", key: "K3", owner: "mate", slug: "theirs", theme: "" });
    expect(plan.foreign).toEqual([{ id: "b3", title: "Theirs", owner: "mate" }]);
  });

  test("each member carries the slug and theme its v1 spaUrl used", () => {
    const themeOf = (b) => (b.profession === "Guardian" ? "guardian" : "");
    const plan = planCompMembers({ ...deps, themeOf, owner: "me", compBuilds: [
      { id: "b1", title: "One", profession: "Guardian" },
      { id: "b3", title: "Renamed", profession: "Necromancer", publishedFileId: "mate3333", publishedKey: "K3", publishedOwner: "mate", publishedSlug: "theirs" },
      { id: "b4", title: "Unslugged", publishedFileId: "mate4444", publishedKey: "K4", publishedOwner: "mate" },
    ] });
    // Own builds: the slug this publish writes. A teammate's: the slug their link was published under.
    expect(plan.members.b1).toMatchObject({ slug: "one", theme: "guardian" });
    expect(plan.members.b3).toMatchObject({ slug: "theirs", theme: "" });
    expect(plan.members.b4).toMatchObject({ slug: "unslugged" });
  });

  test("force takes over a teammate's build", () => {
    const plan = planCompMembers({ ...deps, owner: "me", force: true, compBuilds: [
      { id: "b3", title: "Theirs", publishedFileId: "mate3333", publishedKey: "K3", publishedOwner: "mate" },
    ] });
    expect(plan.uploads).toHaveLength(1);
    expect(plan.members.b3.owner).toBe("me");
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

  test("excludes category tag slots ('tag:<id>') — they are not builds", () => {
    const comp = {
      id: "c1", name: "Test",
      buildIds: ["build-1"],
      partyLines: [{ id: "l1", slots: ["build-1", "tag:cat-dps", "build-2"] }],
    };
    const ids = getCompPublishBuildIds(comp);
    expect(ids).toContain("build-1");
    expect(ids).toContain("build-2");
    expect(ids.some((id) => String(id).startsWith("tag:"))).toBe(false);
  });
});

describe("teamGuards receipt helpers", () => {
  const { withoutReceiptHashes, memberStampTargets } = require("../../src/main/teamGuards");

  test("withoutReceiptHashes drops only the hash receipt", () => {
    const input = { id: "b", publishedFileId: "f", publishedHash: "h", publishedMemberHashes: { a: "1" }, publishedFormat: "2:h" };
    expect(withoutReceiptHashes(input)).toEqual({ id: "b", publishedFileId: "f" });
    expect(input.publishedHash).toBe("h");
  });

  test("stamped members are put to their own team root, personal ones nowhere", async () => {
    const roots = { fT2: { teamId: "T2" }, fT1: { teamId: "T1" } };
    const findTeamRoot = async (folderId) => roots[folderId] || null;
    const targets = await memberStampTargets([
      { id: "a", folderId: "fT2" }, { id: "b", folderId: "personal" }, { id: "c", folderId: null }, { id: "d", folderId: "fT1" },
    ], findTeamRoot);
    expect(targets).toEqual([{ teamId: "T2", buildId: "a" }, { teamId: "T1", buildId: "d" }]);
  });
});
