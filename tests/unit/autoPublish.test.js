"use strict";

const { autoPublishDecision, isPublishable, bulkPublishCandidates } = require("../../src/main/autoPublish");
const { annotateBuild, annotateComp, buildReceipt, compReceipt } = require("../../src/main/publishFingerprint");

const build = (over = {}) => annotateBuild({ id: "b1", title: "Heal FB", profession: "Guardian", ...over });
const published = (over = {}) => {
  const base = { id: "b1", title: "Heal FB", profession: "Guardian", publishedFileId: "f", publishedKey: "k", publishedOwner: "me", ...over };
  return base;
};

describe("autoPublishDecision", () => {
  test("a never-published build is enqueued", () => {
    expect(autoPublishDecision("build", build(), { targetOwner: "me" })).toBe("enqueue");
  });

  test("a save that did not change the published content is skipped", () => {
    const rec = published();
    const current = annotateBuild({ ...rec, ...buildReceipt(rec) });
    expect(autoPublishDecision("build", current, { targetOwner: "me" })).toBe("skip");
  });

  test("a changed published build is enqueued", () => {
    const rec = published();
    const stale = annotateBuild({ ...rec, ...buildReceipt(rec), notes: "edited" });
    expect(autoPublishDecision("build", stale, { targetOwner: "me" })).toBe("enqueue");
  });

  test("a build published by someone else asks first", () => {
    const rec = published({ publishedOwner: "mate", publishedHash: "old" });
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "me" })).toBe("ask-owner");
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "me", choice: "mine" })).toBe("enqueue");
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "me", choice: "theirs" })).toBe("skip");
  });

  test("a team build whose target is the team owner is not foreign", () => {
    const rec = published({ publishedOwner: "guild", publishedHash: "old" });
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "guild" })).toBe("enqueue");
  });

  test("an unknown target (signed out) never asks", () => {
    const rec = published({ publishedOwner: "mate", publishedHash: "old" });
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: null })).toBe("enqueue");
  });

  test("unpublishable or trashed records are skipped", () => {
    expect(autoPublishDecision("build", build({ profession: "" }), {})).toBe("skip");
    expect(autoPublishDecision("build", build({ deletedAt: "2026-10-07T00:00:00.000Z" }), {})).toBe("skip");
    expect(autoPublishDecision("build", build({ archivedAt: "2026-10-07T00:00:00.000Z" }), {})).toBe("skip");
    expect(autoPublishDecision("comp", annotateComp({ id: "c", name: "Untitled Comp" }), {})).toBe("skip");
    expect(autoPublishDecision("comp", annotateComp({ id: "c", name: "  " }), {})).toBe("skip");
    expect(autoPublishDecision("build", null, {})).toBe("skip");
  });

  test("comps follow the same rules", () => {
    const comp = { id: "c", name: "Raid", publishedFileId: "cf", publishedKey: "ck", publishedOwner: "me" };
    const current = annotateComp({ ...comp, ...compReceipt(comp, []) });
    expect(autoPublishDecision("comp", current, { targetOwner: "me" })).toBe("skip");
    expect(autoPublishDecision("comp", annotateComp({ ...current, notes: "x" }), { targetOwner: "me" })).toBe("enqueue");
  });
});

describe("isPublishable", () => {
  test.each([
    ["build", { profession: "Guardian" }, true],
    ["build", { profession: "" }, false],
    ["comp", { name: "Raid" }, true],
    ["comp", { name: "Untitled Comp" }, false],
    ["comp", {}, false],
  ])("%s %j → %s", (kind, rec, expected) => {
    expect(isPublishable(kind, rec)).toBe(expected);
  });
});

describe("bulkPublishCandidates", () => {
  test("lists never-published, publishable, live records only", () => {
    const builds = [
      build({ id: "new" }),
      build({ id: "pub", publishedFileId: "f" }),
      build({ id: "noprof", profession: "" }),
      build({ id: "trash", deletedAt: "2026-10-07T00:00:00.000Z" }),
      build({ id: "archived", archivedAt: "2026-10-07T00:00:00.000Z" }),
    ];
    const comps = [
      annotateComp({ id: "c1", name: "Raid" }),
      annotateComp({ id: "c2", name: "Untitled Comp" }),
      annotateComp({ id: "c3", name: "Old raid", archivedAt: "2026-10-07T00:00:00.000Z" }),
    ];
    expect(bulkPublishCandidates({ builds, comps })).toEqual([
      { kind: "build", id: "new" },
      { kind: "comp", id: "c1" },
    ]);
  });
});
