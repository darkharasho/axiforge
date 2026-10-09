"use strict";

// Shared builds used to publish to whichever member last edited them, so a link
// kept showing that member's copy. These move them to the team's one target and
// leave a pointer where the old copy was.

const { itemsToMove, planMovedStubs } = require("../../src/main/teamPublishMoves");

const ROOT = { id: "root", teamId: "t1", publishOwner: "Owner", role: "member" };
const rootFor = (r) => (r.folderId === "root" ? ROOT : null);
const pub = (id, over = {}) => ({ id, folderId: "root", publishedFileId: `f-${id}`, publishedKey: "k", publishedOwner: "vette", ...over });

describe("itemsToMove", () => {
  test("my copies of team items move to the team target", () => {
    const records = [
      { kind: "build", record: pub("mine") },
      { kind: "comp", record: pub("mycomp") },
      { kind: "build", record: pub("there", { publishedOwner: "owner" }) },  // already home (any case)
      { kind: "build", record: pub("theirs", { publishedOwner: "ge0rge" }) }, // ge0rge's app moves it
      { kind: "build", record: pub("personal", { folderId: null }) },
      { kind: "build", record: pub("never", { publishedFileId: undefined }) },
      { kind: "build", record: pub("gone", { deletedAt: "t" }) },
    ];
    expect(itemsToMove({ records, rootFor, viewerLogin: "Vette" })).toEqual([
      { kind: "build", id: "mine" }, { kind: "comp", id: "mycomp" },
    ]);
  });

  test("a team owner moves the copies of members who have left", () => {
    const owned = { ...ROOT, role: "owner" };
    const records = [
      { kind: "build", record: pub("left", { publishedOwner: "gone-member" }) },
      { kind: "build", record: pub("stayed", { publishedOwner: "ge0rge" }) },
    ];
    const memberLogins = new Map([["t1", new Set(["owner", "ge0rge"])]]);
    expect(itemsToMove({ records, rootFor: () => owned, viewerLogin: "owner", memberLogins })).toEqual([{ kind: "build", id: "left" }]);
    // Without the member list it can't tell, so it leaves them.
    expect(itemsToMove({ records, rootFor: () => owned, viewerLogin: "owner" })).toEqual([]);
  });

  test("a team with no target moves nothing", () => {
    expect(itemsToMove({ records: [{ kind: "build", record: pub("x") }], rootFor: () => ({ ...ROOT, publishOwner: undefined }), viewerLogin: "vette" })).toEqual([]);
  });
});

describe("planMovedStubs", () => {
  test("deletes my stale payloads and points each at its new host", () => {
    const records = [
      { kind: "build", record: pub("b", { publishedOwner: "owner" }) },
      { kind: "comp", record: pub("c", { publishedOwner: "guild" }) },
      { kind: "build", record: pub("still-mine", { publishedOwner: "Vette" }) },
      { kind: "build", record: pub("not-here", { publishedOwner: "owner" }) },
    ];
    const sitePaths = new Set(["site/builds/f-b.enc", "site/comps/f-c.enc", "site/builds/f-still-mine.enc"]);
    expect(planMovedStubs({ records, viewerLogin: "vette", sitePaths })).toEqual({
      "site/builds/f-b.enc": null,
      "site/moved/f-b.json": '{"owner":"owner"}\n',
      "site/comps/f-c.enc": null,
      "site/moved/f-c.json": '{"owner":"guild"}\n',
    });
  });

  test("nothing stale, nothing to commit", () => {
    expect(planMovedStubs({ records: [{ kind: "build", record: pub("b", { publishedOwner: "owner" }) }], viewerLogin: "vette", sitePaths: new Set() })).toEqual({});
  });
});
