/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: { builds: [], folders: [], comps: [], currentFolder: null },
}));

const {
  matchesSmartFolder,
} = require("../../../src/renderer/modules/library/smart-folders");

const CTX = { folders: [], now: Date.parse("2026-09-08T00:00:00Z") };

function sf(children, match = "all") {
  return { id: "sf-test", name: "Test", rule: { type: "group", match, children } };
}
function cond(field, op, value) {
  return { type: "condition", field, op, value };
}
function build(overrides = {}) {
  return {
    id: "b1",
    title: "Zerg Firebrand",
    profession: "Guardian",
    gameMode: "wvw",
    tags: ["wvw", "support"],
    notes: "boonball",
    pinned: false,
    folderId: null,
    specializations: [
      { name: "Honor", elite: false },
      { name: "Firebrand", elite: true },
    ],
    updatedAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("group semantics", () => {
  test("empty conditions match everything — the Main Repository case", () => {
    expect(matchesSmartFolder(sf([]), build(), CTX)).toBe(true);
  });

  test("match:all requires every condition", () => {
    const rule = sf([
      cond("profession", "isAnyOf", ["Guardian"]),
      cond("gameMode", "isAnyOf", ["pve"]),
    ]);
    expect(matchesSmartFolder(rule, build(), CTX)).toBe(false);
  });

  test("match:any requires only one condition", () => {
    const rule = sf(
      [cond("profession", "isAnyOf", ["Guardian"]), cond("gameMode", "isAnyOf", ["pve"])],
      "any",
    );
    expect(matchesSmartFolder(rule, build(), CTX)).toBe(true);
  });

  test("recurses into nested groups the editor cannot yet produce", () => {
    const rule = sf([
      cond("profession", "isAnyOf", ["Guardian"]),
      {
        type: "group",
        match: "any",
        children: [cond("gameMode", "isAnyOf", ["pve"]), cond("gameMode", "isAnyOf", ["wvw"])],
      },
    ]);
    expect(matchesSmartFolder(rule, build(), CTX)).toBe(true);
  });
});

describe("totality", () => {
  test("unknown field is false, not a throw", () => {
    expect(matchesSmartFolder(sf([cond("nope", "isAnyOf", ["x"])]), build(), CTX)).toBe(false);
  });

  test("unknown operator is false, not a throw", () => {
    expect(matchesSmartFolder(sf([cond("profession", "nope", ["x"])]), build(), CTX)).toBe(false);
  });

  test("malformed value is false, not a throw", () => {
    expect(matchesSmartFolder(sf([cond("profession", "isAnyOf", null)]), build(), CTX)).toBe(false);
  });

  test("a smart folder with no rule matches nothing", () => {
    expect(matchesSmartFolder({ id: "x", name: "x" }, build(), CTX)).toBe(false);
  });
});

describe("profession / gameMode", () => {
  test("isAnyOf matches", () => {
    expect(matchesSmartFolder(sf([cond("profession", "isAnyOf", ["Guardian", "Warrior"])]), build(), CTX)).toBe(true);
  });

  test("isNoneOf excludes", () => {
    expect(matchesSmartFolder(sf([cond("profession", "isNoneOf", ["Guardian"])]), build(), CTX)).toBe(false);
  });

  test("missing gameMode is treated as pve", () => {
    const b = build({ gameMode: "" });
    expect(matchesSmartFolder(sf([cond("gameMode", "isAnyOf", ["pve"])]), b, CTX)).toBe(true);
  });
});

describe("eliteSpec", () => {
  test("matches the elite specialization", () => {
    expect(matchesSmartFolder(sf([cond("eliteSpec", "isAnyOf", ["Firebrand"])]), build(), CTX)).toBe(true);
  });

  test("does not match a non-elite specialization line", () => {
    expect(matchesSmartFolder(sf([cond("eliteSpec", "isAnyOf", ["Honor"])]), build(), CTX)).toBe(false);
  });

  test("a build with no elite spec matches isNoneOf", () => {
    const b = build({ specializations: [{ name: "Honor", elite: false }] });
    expect(matchesSmartFolder(sf([cond("eliteSpec", "isNoneOf", ["Firebrand"])]), b, CTX)).toBe(true);
  });
});

describe("tags", () => {
  test("hasAnyOf", () => {
    expect(matchesSmartFolder(sf([cond("tags", "hasAnyOf", ["support", "dps"])]), build(), CTX)).toBe(true);
  });

  test("hasAllOf requires all", () => {
    expect(matchesSmartFolder(sf([cond("tags", "hasAllOf", ["wvw", "dps"])]), build(), CTX)).toBe(false);
  });

  test("hasNoneOf excludes", () => {
    expect(matchesSmartFolder(sf([cond("tags", "hasNoneOf", ["support"])]), build(), CTX)).toBe(false);
  });

  test("isEmpty is true for a missing tags array", () => {
    const b = build({ tags: undefined });
    expect(matchesSmartFolder(sf([cond("tags", "isEmpty")]), b, CTX)).toBe(true);
  });

  test("isEmpty is true for a zero-length tags array", () => {
    expect(matchesSmartFolder(sf([cond("tags", "isEmpty")]), build({ tags: [] }), CTX)).toBe(true);
  });

  test("isNotEmpty is the negation", () => {
    expect(matchesSmartFolder(sf([cond("tags", "isNotEmpty")]), build(), CTX)).toBe(true);
  });
});

describe("title / notes", () => {
  test("contains is case-insensitive", () => {
    expect(matchesSmartFolder(sf([cond("title", "contains", "ZERG")]), build(), CTX)).toBe(true);
  });

  test("notContains excludes", () => {
    expect(matchesSmartFolder(sf([cond("notes", "notContains", "boon")]), build(), CTX)).toBe(false);
  });

  test("an empty search string matches everything", () => {
    expect(matchesSmartFolder(sf([cond("title", "contains", "")]), build(), CTX)).toBe(true);
  });
});

describe("pinned", () => {
  test("isTrue", () => {
    expect(matchesSmartFolder(sf([cond("pinned", "isTrue")]), build({ pinned: true }), CTX)).toBe(true);
  });

  test("isFalse treats a missing flag as not pinned", () => {
    expect(matchesSmartFolder(sf([cond("pinned", "isFalse")]), build({ pinned: undefined }), CTX)).toBe(true);
  });
});

describe("location", () => {
  const FOLDERS = [
    { id: "f-root", name: "wvw", parentId: null },
    { id: "f-child", name: "zerg", parentId: "f-root" },
    { id: "f-other", name: "raids", parentId: null },
  ];
  const ctx = { folders: FOLDERS, now: CTX.now };

  test("isUnfiled matches a build with no folder", () => {
    expect(matchesSmartFolder(sf([cond("location", "isUnfiled")]), build({ folderId: null }), ctx)).toBe(true);
  });

  test("isUnfiled does not match a filed build", () => {
    expect(matchesSmartFolder(sf([cond("location", "isUnfiled")]), build({ folderId: "f-root" }), ctx)).toBe(false);
  });

  test("inFolder matches the folder itself", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-root")]), build({ folderId: "f-root" }), ctx)).toBe(true);
  });

  test("inFolder includes subfolders", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-root")]), build({ folderId: "f-child" }), ctx)).toBe(true);
  });

  test("inFolder excludes a sibling tree", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-root")]), build({ folderId: "f-other" }), ctx)).toBe(false);
  });

  test("notInFolder is the exact negation, so an unfiled build satisfies it", () => {
    expect(matchesSmartFolder(sf([cond("location", "notInFolder", "f-root")]), build({ folderId: null }), ctx)).toBe(true);
  });

  test("a rule pointing at a deleted folder matches nothing instead of throwing", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-gone")]), build({ folderId: "f-root" }), ctx)).toBe(false);
  });
});

describe("ownership / team", () => {
  const FOLDERS = [
    { id: "t-mine", name: "My Team", parentId: null, teamId: "team-a", shared: true, role: "owner" },
    { id: "t-theirs", name: "Their Team", parentId: null, teamId: "team-b", shared: true, role: "member" },
    { id: "t-theirs-sub", name: "wvw", parentId: "t-theirs" },
    { id: "f-plain", name: "personal", parentId: null },
  ];
  const ctx = { folders: FOLDERS, now: CTX.now };

  test("sharedWithMe matches a build under a team the user does not own", () => {
    const rule = sf([cond("ownership", "is", "sharedWithMe")]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs" }), ctx)).toBe(true);
  });

  test("sharedWithMe reaches through subfolders of a team root", () => {
    const rule = sf([cond("ownership", "is", "sharedWithMe")]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs-sub" }), ctx)).toBe(true);
  });

  test("a team the user owns is theirs, not shared with them", () => {
    const rule = sf([cond("ownership", "is", "sharedWithMe")]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-mine" }), ctx)).toBe(false);
  });

  test("mine covers both unfiled builds and owned teams", () => {
    const rule = sf([cond("ownership", "is", "mine")]);
    expect(matchesSmartFolder(rule, build({ folderId: null }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "f-plain" }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "t-mine" }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs" }), ctx)).toBe(false);
  });

  test("team isAnyOf matches by team id", () => {
    const rule = sf([cond("team", "isAnyOf", ["team-b"])]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs-sub" }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "t-mine" }), ctx)).toBe(false);
  });

  test("an unknown ownership value matches nothing", () => {
    const rule = sf([cond("ownership", "is", "somebody-else")]);
    expect(matchesSmartFolder(rule, build({ folderId: null }), ctx)).toBe(false);
  });
});

describe("dates", () => {
  const now = Date.parse("2026-09-08T00:00:00Z");
  const ctx = { folders: [], now };

  test("withinDays matches a recent timestamp", () => {
    const b = build({ updatedAt: "2026-09-01T00:00:00Z" });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(true);
  });

  test("withinDays excludes an older timestamp", () => {
    const b = build({ updatedAt: "2026-01-01T00:00:00Z" });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(false);
  });

  test("olderThanDays is the complement for records that have a timestamp", () => {
    const b = build({ createdAt: "2026-01-01T00:00:00Z" });
    expect(matchesSmartFolder(sf([cond("createdAt", "olderThanDays", 14)]), b, ctx)).toBe(true);
  });

  test("a record with no timestamp matches neither operator", () => {
    const b = build({ updatedAt: undefined });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(false);
    expect(matchesSmartFolder(sf([cond("updatedAt", "olderThanDays", 14)]), b, ctx)).toBe(false);
  });

  test("an unparseable timestamp matches neither operator", () => {
    const b = build({ updatedAt: "not a date" });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(false);
    expect(matchesSmartFolder(sf([cond("updatedAt", "olderThanDays", 14)]), b, ctx)).toBe(false);
  });

  test("a non-numeric day count matches nothing", () => {
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", "soon")]), build(), ctx)).toBe(false);
  });
});
