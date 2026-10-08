"use strict";

const { formatStamp, isOldOwnPage, planFormatMigrations } = require("../../src/main/formatMigration");
const { buildFingerprint, compFingerprint } = require("../../src/main/publishFingerprint");
const { PAYLOAD_VERSION } = require("../../src/main/buildEncryption");
const { COMP_FORMAT_VERSION } = require("../../src/main/compPublish");

// A build published by `owner` whose receipt matches its content.
function build(id, over = {}) {
  const b = {
    id, title: `Build ${id}`, profession: "Ranger", notes: "",
    publishedFileId: `f-${id}`, publishedKey: `k-${id}`, publishedSlug: `slug-${id}`, publishedOwner: "me",
    ...over,
  };
  if (!("publishedHash" in over)) b.publishedHash = buildFingerprint(b);
  return b;
}

function comp(id, buildIds, over = {}) {
  const c = {
    id, name: `Comp ${id}`, buildIds, partyLines: [{ capacity: 5, slots: buildIds }],
    publishedFileId: `f-${id}`, publishedKey: `k-${id}`, publishedOwner: "me",
    ...over,
  };
  if (!("publishedHash" in over)) c.publishedHash = compFingerprint(c);
  return c;
}

const memberIdsOf = (c) => c.buildIds;

describe("formatStamp", () => {
  test("names the format the kind is published in, pinned to the hash", () => {
    expect(formatStamp("build", "abc")).toBe(`${PAYLOAD_VERSION}:abc`);
    expect(formatStamp("comp", "abc")).toBe(`${PAYLOAD_VERSION}.${COMP_FORMAT_VERSION}:abc`);
  });
});

describe("isOldOwnPage", () => {
  test("an unstamped page this owner published, matching local content, is old", () => {
    expect(isOldOwnPage(build("b1"), "build", "me")).toBe(true);
  });

  test("a page stamped for its current hash is already in the current format", () => {
    const b = build("b1");
    b.publishedFormat = formatStamp("build", b.publishedHash);
    expect(isOldOwnPage(b, "build", "me")).toBe(false);
  });

  test("a stamp written for an earlier upload no longer counts", () => {
    const b = build("b1");
    b.publishedFormat = formatStamp("build", "someolderhash");
    expect(isOldOwnPage(b, "build", "me")).toBe(true);
  });

  test("a stamp from an older format counts as old", () => {
    const b = build("b1");
    b.publishedFormat = `1:${b.publishedHash}`;
    expect(isOldOwnPage(b, "build", "me")).toBe(true);
  });

  test("an edited build is never redone: that would publish unpublished edits", () => {
    const b = build("b1");
    b.notes = "edited after publishing";
    expect(isOldOwnPage(b, "build", "me")).toBe(false);
  });

  test("another owner's page, an unpublished build, or a trashed one is left alone", () => {
    expect(isOldOwnPage(build("b1", { publishedOwner: "teammate" }), "build", "me")).toBe(false);
    expect(isOldOwnPage(build("b1", { publishedFileId: "" }), "build", "me")).toBe(false);
    expect(isOldOwnPage(build("b1", { publishedHash: "" }), "build", "me")).toBe(false);
    expect(isOldOwnPage(build("b1", { deletedAt: "2026-10-01T00:00:00.000Z" }), "build", "me")).toBe(false);
  });

  test("a comp checks its own fingerprint and the comp format", () => {
    const c = comp("c1", ["b1"]);
    expect(isOldOwnPage(c, "comp", "me")).toBe(true);
    c.publishedFormat = formatStamp("comp", c.publishedHash);
    expect(isOldOwnPage(c, "comp", "me")).toBe(false);
    c.publishedFormat = formatStamp("build", c.publishedHash);
    expect(isOldOwnPage(c, "comp", "me")).toBe(true);
  });
});

describe("planFormatMigrations", () => {
  test("picks old own builds and skips the ones the publish already writes", () => {
    const builds = [build("b1"), build("b2"), build("b3", { publishedOwner: "teammate" })];
    const plan = planFormatMigrations({ builds, owner: "me", excludeIds: ["b1"], memberIdsOf });
    expect(plan.builds.map((b) => b.id)).toEqual(["b2"]);
    expect(plan.comps).toEqual([]);
  });

  test("a comp links every member's existing page, a teammate's under their owner", () => {
    const builds = [build("b1"), build("b2", { publishedOwner: "teammate" })];
    const plan = planFormatMigrations({
      builds, comps: [comp("c1", ["b1", "b2"])], owner: "me", memberIdsOf,
      themeOf: (b) => (b.id === "b1" ? "ranger" : ""),
    });
    expect(plan.comps).toHaveLength(1);
    expect(plan.comps[0].members).toEqual({
      b1: { fileId: "f-b1", key: "k-b1", owner: "me", slug: "slug-b1", theme: "ranger" },
      b2: { fileId: "f-b2", key: "k-b2", owner: "teammate", slug: "slug-b2", theme: "" },
    });
  });

  test("a comp with a member that has no page, or is missing here, is left for a manual publish", () => {
    const builds = [build("b1"), build("b2", { publishedFileId: "", publishedKey: "" })];
    const plan = planFormatMigrations({
      builds, comps: [comp("c1", ["b1", "b2"]), comp("c2", ["b1", "gone"])], owner: "me", memberIdsOf,
    });
    expect(plan.comps).toEqual([]);
  });

  test("an edited comp is not redone", () => {
    const c = comp("c1", ["b1"]);
    c.notes = "edited";
    const plan = planFormatMigrations({ builds: [build("b1")], comps: [c], owner: "me", memberIdsOf });
    expect(plan.comps).toEqual([]);
  });

  test("the batch is capped, comps first", () => {
    const builds = [build("b1"), build("b2"), build("b3")];
    const plan = planFormatMigrations({
      builds, comps: [comp("c1", ["b1"])], owner: "me", memberIdsOf, limit: 2,
    });
    expect(plan.comps.map((x) => x.comp.id)).toEqual(["c1"]);
    expect(plan.builds.map((b) => b.id)).toEqual(["b1"]);
  });
});
