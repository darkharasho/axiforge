/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: { builds: [], folders: [], comps: [], currentFolder: null },
}));

const { state } = require("../../../src/renderer/modules/state");
const {
  matchesSmartFolder,
  ruleContext,
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
  // Ownership is authorship, not team role: `syncAuthors` is itemId -> the user
  // id that created it, as main resolved it out of the sync state, and
  // `sessionUserId` is who is asking.
  const ctx = {
    folders: FOLDERS,
    now: CTX.now,
    sessionUserId: "u-me",
    syncAuthors: { "b-mine": "u-me", "b-theirs": "u-them", "b-nobody": null },
  };
  const mine = (folderId) => build({ id: "b-mine", folderId });
  const theirs = (folderId) => build({ id: "b-theirs", folderId });

  // The bug (#300): an owner saw every teammate's build as "Shared by me",
  // because the answer came from the ROOT's role and never looked at who wrote
  // the build.
  test("a teammate's build in a team I own is sharedWithMe, not sharedByMe", () => {
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedByMe")]), theirs("t-mine"), ctx)).toBe(false);
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedWithMe")]), theirs("t-mine"), ctx)).toBe(true);
  });

  // The other half of it: a member could never match "Shared by me" at all, so
  // their own contributions were filed as somebody else's.
  test("my own build in a team I joined is sharedByMe", () => {
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedByMe")]), mine("t-theirs"), ctx)).toBe(true);
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedWithMe")]), mine("t-theirs"), ctx)).toBe(false);
  });

  test("my own build in a team I own is sharedByMe", () => {
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedByMe")]), mine("t-mine"), ctx)).toBe(true);
  });

  test("a teammate's build reaches through subfolders of a team root", () => {
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedWithMe")]), theirs("t-theirs-sub"), ctx)).toBe(true);
  });

  // Nothing in the map means nothing has ever been pushed for it, which can
  // only be true of a build made on this machine.
  test("a build the sync state has never seen counts as mine", () => {
    const fresh = build({ id: "b-unsynced", folderId: "t-theirs" });
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedByMe")]), fresh, ctx)).toBe(true);
  });

  // Present but null: the server sent the item without a creator, so authorship
  // is unknown rather than absent, and the team role is the only answer left.
  test("an unknown author falls back to the team role", () => {
    const nobody = build({ id: "b-nobody" });
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedByMe")]), { ...nobody, folderId: "t-mine" }, ctx)).toBe(true);
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedWithMe")]), { ...nobody, folderId: "t-theirs" }, ctx)).toBe(true);
  });

  // A ctx with no session (sync off, or the map failed to load) must not turn
  // the whole library into somebody else's work.
  test("with no session at all every team build falls back to the team role", () => {
    const noSession = { folders: FOLDERS, now: CTX.now };
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedByMe")]), theirs("t-mine"), noSession)).toBe(true);
    expect(matchesSmartFolder(sf([cond("ownership", "is", "sharedWithMe")]), mine("t-theirs"), noSession)).toBe(true);
  });

  test("personal covers unfiled builds and non-team folders only", () => {
    const rule = sf([cond("ownership", "is", "personal")]);
    expect(matchesSmartFolder(rule, mine(null), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, mine("f-plain"), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, mine("t-mine"), ctx)).toBe(false);
    expect(matchesSmartFolder(rule, theirs("t-theirs"), ctx)).toBe(false);
  });

  // The "Shared" built-in. Both sides of every team space, whoever wrote them —
  // an owner has to see what teammates file into a team they own.
  test("isNot personal is both sides of every team space", () => {
    const rule = sf([cond("ownership", "isNot", "personal")]);
    expect(matchesSmartFolder(rule, mine("t-mine"), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, theirs("t-mine"), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, theirs("t-theirs-sub"), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, mine("f-plain"), ctx)).toBe(false);
    expect(matchesSmartFolder(rule, mine(null), ctx)).toBe(false);
  });

  test("team isAnyOf matches by team id", () => {
    const rule = sf([cond("team", "isAnyOf", ["team-b"])]);
    expect(matchesSmartFolder(rule, mine("t-theirs-sub"), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, mine("t-mine"), ctx)).toBe(false);
  });

  test("an unknown ownership value matches nothing under either operator", () => {
    expect(matchesSmartFolder(sf([cond("ownership", "is", "somebody-else")]), mine(null), ctx)).toBe(false);
    // isNot is deliberately not the negation of an unknown value: it would
    // otherwise match the entire library.
    expect(matchesSmartFolder(sf([cond("ownership", "isNot", "somebody-else")]), mine(null), ctx)).toBe(false);
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

/**
 * Loadout fields. All three read out of `equipment`, which older records and
 * hand-edited JSON may be missing entirely -- so every case below has a
 * counterpart asserting the absent shape is falsy rather than a throw.
 */
describe("weapons", () => {
  const staffScepter = build({
    equipment: { weapons: { mainhand1: "staff", mainhand2: "scepter", offhand2: "focus", offhand1: "" } },
  });

  test("has any of matches a weapon in either set", () => {
    expect(matchesSmartFolder(sf([cond("weapons", "hasAnyOf", ["focus"])]), staffScepter, CTX)).toBe(true);
    expect(matchesSmartFolder(sf([cond("weapons", "hasAnyOf", ["greatsword"])]), staffScepter, CTX)).toBe(false);
  });

  test("has all of needs every named weapon on the build", () => {
    expect(matchesSmartFolder(sf([cond("weapons", "hasAllOf", ["staff", "focus"])]), staffScepter, CTX)).toBe(true);
    expect(matchesSmartFolder(sf([cond("weapons", "hasAllOf", ["staff", "rifle"])]), staffScepter, CTX)).toBe(false);
  });

  test("empty slots are not a weapon", () => {
    expect(matchesSmartFolder(sf([cond("weapons", "hasAnyOf", [""])]), staffScepter, CTX)).toBe(false);
  });

  test("a build with no equipment matches nothing rather than throwing", () => {
    expect(matchesSmartFolder(sf([cond("weapons", "hasAnyOf", ["staff"])]), build(), CTX)).toBe(false);
    expect(matchesSmartFolder(sf([cond("weapons", "hasNoneOf", ["staff"])]), build(), CTX)).toBe(true);
  });
});

describe("stats", () => {
  const mixed = build({
    equipment: { statPackage: "Berserker's", slots: { head: "Berserker's", chest: "Assassin's", legs: "" } },
  });

  test("collects the package and every per-slot prefix", () => {
    expect(matchesSmartFolder(sf([cond("stats", "hasAllOf", ["Berserker's", "Assassin's"])]), mixed, CTX)).toBe(true);
  });

  test("a numeric statPackage is ignored -- it is an API id, not a prefix", () => {
    const legacy = build({ equipment: { statPackage: "161", slots: {} } });
    expect(matchesSmartFolder(sf([cond("stats", "isNotEmpty", undefined)]), legacy, CTX)).toBe(false);
  });

  test("is set / is unset split builds that have gear from those that do not", () => {
    expect(matchesSmartFolder(sf([cond("stats", "isNotEmpty", undefined)]), mixed, CTX)).toBe(true);
    expect(matchesSmartFolder(sf([cond("stats", "isEmpty", undefined)]), build(), CTX)).toBe(true);
  });
});

describe("armorWeight", () => {
  test("derives from the profession", () => {
    const heavy = sf([cond("armorWeight", "isAnyOf", ["heavy"])]);
    expect(matchesSmartFolder(heavy, build({ profession: "Guardian" }), CTX)).toBe(true);
    expect(matchesSmartFolder(heavy, build({ profession: "Necromancer" }), CTX)).toBe(false);
    expect(matchesSmartFolder(sf([cond("armorWeight", "isAnyOf", ["light"])]), build({ profession: "Necromancer" }), CTX)).toBe(true);
  });

  test("an unknown profession has no weight and so matches neither side", () => {
    const odd = build({ profession: "Bartender" });
    expect(matchesSmartFolder(sf([cond("armorWeight", "isAnyOf", ["heavy"])]), odd, CTX)).toBe(false);
    expect(matchesSmartFolder(sf([cond("armorWeight", "isNoneOf", ["heavy"])]), odd, CTX)).toBe(true);
  });
});

// ruleContext() is what every live call site passes, so a field the evaluator
// reads but the context never carries is a filter that silently answers wrongly
// in the app while every unit test above still passes.
describe("ruleContext", () => {
  afterEach(() => {
    state.folders = [];
    state.teamSession = null;
    state.syncAuthors = {};
  });

  test("carries the identity and the author map the ownership field needs", () => {
    state.folders = [{ id: "f1" }];
    state.teamSession = { userId: "u-me", login: "me" };
    state.syncAuthors = { b1: "u-them" };
    expect(ruleContext()).toMatchObject({
      folders: [{ id: "f1" }],
      sessionUserId: "u-me",
      syncAuthors: { b1: "u-them" },
    });
  });

  test("degrades to no identity when team sync is off", () => {
    expect(ruleContext()).toMatchObject({ sessionUserId: null, syncAuthors: {} });
  });
});
