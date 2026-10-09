/** @jest-environment jsdom */
"use strict";

// The table view's columns are a registry the user can show, hide and reorder
// (Discord "More Columns"). Everything that decides WHICH columns draw, in what
// order and how they sort lives in table-columns.js, so it is tested here
// without rendering the library.

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    teams: [],
    teamSession: null,
    syncAuthors: {},
    teamMemberNames: {},
    libraryPrefs: { sortField: "sortOrder", sortDirection: "asc" },
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const cols = require("../../../src/renderer/modules/library/table-columns.js");

const ids = (list) => list.map((c) => c.id);

beforeEach(() => {
  state.folders = [];
  state.teams = [];
  state.teamSession = null;
  state.syncAuthors = {};
  state.teamMemberNames = {};
});

describe("normalizeColumnPrefs", () => {
  test("no saved prefs gives today's columns, with the new ones hidden", () => {
    const prefs = cols.normalizeColumnPrefs(null);
    const visible = ids(cols.visibleColumns(prefs));
    expect(visible).toEqual([
      "action", "icon", "name", "profession", "spec", "mode", "role", "tags", "created", "modified",
    ]);
    expect(prefs.find((p) => p.id === "path").visible).toBe(false);
    expect(prefs.find((p) => p.id === "owner").visible).toBe(false);
  });

  test("locked columns never appear in the prefs list", () => {
    const prefs = cols.normalizeColumnPrefs(null);
    expect(ids(prefs)).not.toEqual(expect.arrayContaining(["action"]));
    expect(ids(prefs)).not.toContain("icon");
    expect(ids(prefs)).not.toContain("name");
  });

  test("keeps saved order, drops unknown and duplicate ids, appends missing columns", () => {
    const prefs = cols.normalizeColumnPrefs([
      { id: "modified", visible: true },
      { id: "bogus", visible: true },
      { id: "path", visible: true },
      { id: "modified", visible: false },
      { id: "name", visible: false },
    ]);
    expect(ids(prefs).slice(0, 2)).toEqual(["modified", "path"]);
    expect(prefs.find((p) => p.id === "modified").visible).toBe(true);
    expect(ids(prefs)).not.toContain("bogus");
    expect(ids(prefs)).not.toContain("name");
    // Every reorderable column is present exactly once.
    expect(new Set(ids(prefs)).size).toBe(prefs.length);
    expect(prefs.length).toBe(cols.TABLE_COLUMNS.filter((c) => !c.locked).length);
  });

  test("garbage input falls back to defaults", () => {
    expect(cols.normalizeColumnPrefs("nope")).toEqual(cols.normalizeColumnPrefs(null));
    expect(cols.normalizeColumnPrefs([null, 3, { visible: true }])).toEqual(cols.normalizeColumnPrefs(null));
  });
});

describe("visibleColumns / gridTemplate", () => {
  test("locked columns lead, then visible columns in saved order", () => {
    const prefs = cols.normalizeColumnPrefs([
      { id: "owner", visible: true },
      { id: "profession", visible: false },
      { id: "modified", visible: true },
    ]);
    const visible = ids(cols.visibleColumns(prefs));
    expect(visible.slice(0, 5)).toEqual(["action", "icon", "name", "owner", "modified"]);
    expect(visible).not.toContain("profession");
  });

  test("the grid template has one track per visible column", () => {
    const defaults = cols.visibleColumns(cols.normalizeColumnPrefs(null));
    expect(cols.gridTemplate(defaults)).toBe("22px 22px 1fr 116px 100px 72px 116px 80px 88px 92px");
    const fewer = cols.visibleColumns(cols.toggleColumn(cols.normalizeColumnPrefs(null), "tags"));
    expect(cols.gridTemplate(fewer)).toBe("22px 22px 1fr 116px 100px 72px 116px 88px 92px");
  });
});

describe("toggleColumn / moveColumn", () => {
  test("toggle flips one column and leaves the input untouched", () => {
    const prefs = cols.normalizeColumnPrefs(null);
    const next = cols.toggleColumn(prefs, "path");
    expect(next.find((p) => p.id === "path").visible).toBe(true);
    expect(prefs.find((p) => p.id === "path").visible).toBe(false);
  });

  test("toggling a locked or unknown column is a no-op", () => {
    const prefs = cols.normalizeColumnPrefs(null);
    expect(cols.toggleColumn(prefs, "name")).toEqual(prefs);
    expect(cols.toggleColumn(prefs, "bogus")).toEqual(prefs);
  });

  test("move puts a column at the target index", () => {
    const prefs = cols.normalizeColumnPrefs(null);
    const moved = cols.moveColumn(prefs, "modified", 0);
    expect(moved[0].id).toBe("modified");
    expect(moved.length).toBe(prefs.length);
    const back = cols.moveColumn(moved, "modified", moved.length - 1);
    expect(back[back.length - 1].id).toBe("modified");
  });

  test("move clamps out-of-range targets and ignores unknown ids", () => {
    const prefs = cols.normalizeColumnPrefs(null);
    expect(cols.moveColumn(prefs, "profession", 99).at(-1).id).toBe("profession");
    expect(cols.moveColumn(prefs, "bogus", 0)).toEqual(prefs);
  });
});

describe("ownerLabel", () => {
  const teamRoot = { id: "root", name: "Raid Team", teamId: "t1", parentId: null, role: "member" };
  const sub = { id: "sub", name: "Heals", parentId: "root" };

  beforeEach(() => {
    state.folders = [teamRoot, sub];
    state.teamSession = { userId: "me" };
    state.teamMemberNames = { u2: "Vette" };
  });

  test("outside a team it is blank, whoever made it", () => {
    state.syncAuthors = { b1: "u2" };
    expect(cols.ownerLabel({ id: "b1", folderId: null })).toBe("");
    state.folders.push({ id: "personal", name: "Mine", parentId: null });
    expect(cols.ownerLabel({ id: "b1", folderId: "personal" })).toBe("");
  });

  test("a teammate's build shows their name, nested folders included", () => {
    state.syncAuthors = { b1: "u2" };
    expect(cols.ownerLabel({ id: "b1", folderId: "sub" })).toBe("Vette");
  });

  test("my own build, or one not pushed yet, reads as You", () => {
    state.syncAuthors = { b1: "me" };
    expect(cols.ownerLabel({ id: "b1", folderId: "root" })).toBe("You");
    expect(cols.ownerLabel({ id: "b2", folderId: "root" })).toBe("You");
  });

  test("unknown author or a name not loaded yet is blank, not a guess", () => {
    state.syncAuthors = { b1: null, b2: "u9" };
    expect(cols.ownerLabel({ id: "b1", folderId: "root" })).toBe("");
    expect(cols.ownerLabel({ id: "b2", folderId: "root" })).toBe("");
  });

  test("with no session there is nobody to call You", () => {
    state.teamSession = null;
    expect(cols.ownerLabel({ id: "b2", folderId: "root" })).toBe("");
  });
});

describe("compareBuilds", () => {
  const sortIds = (builds, field, dir = "asc") =>
    [...builds].sort((a, b) => cols.compareBuilds(a, b, field, dir)).map((b) => b.id);

  test("plain fields sort case-insensitively, pinned first", () => {
    const builds = [
      { id: "a", title: "beta" },
      { id: "b", title: "Alpha" },
      { id: "c", title: "zed", pinned: true },
    ];
    expect(sortIds(builds, "title")).toEqual(["c", "b", "a"]);
    expect(sortIds(builds, "title", "desc")).toEqual(["c", "a", "b"]);
  });

  test("derived fields: elite spec, path, mode", () => {
    state.folders = [{ id: "f1", name: "Zerg", parentId: null }, { id: "f2", name: "Arena", parentId: null }];
    const builds = [
      { id: "a", folderId: "f1", gameMode: "wvw", specializations: [{ elite: true, name: "Willbender" }] },
      { id: "b", folderId: "f2", gameMode: "pve", specializations: [{ elite: true, name: "Firebrand" }] },
    ];
    expect(sortIds(builds, "eliteSpec")).toEqual(["b", "a"]);
    expect(sortIds(builds, "path")).toEqual(["b", "a"]);
    expect(sortIds(builds, "gameMode", "desc")).toEqual(["a", "b"]);
  });

  test("publish status sorts published, out of date, then never", () => {
    const builds = [
      { id: "never" },
      { id: "stale", publishedFileId: "x", publishedHash: "h1", contentHash: "h2" },
      { id: "current", publishedFileId: "y", publishedHash: "h", contentHash: "h" },
    ];
    expect(sortIds(builds, "publishStatus")).toEqual(["current", "stale", "never"]);
  });
});

describe("ensureTeamMemberNames", () => {
  const { ensureTeamMemberNames } = require("../../../src/renderer/modules/teams.js");
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test("asks each team once and fills names, display name over login", async () => {
    state.teamSession = { userId: "me" };
    state.teams = [{ team: { id: "names-a" } }, { team: { id: "names-b" } }];
    const listTeamMembers = jest.fn(async (teamId) => (teamId === "names-a"
      ? [{ userId: "u1", displayName: "Vette", login: "vette" }]
      : [{ userId: "u2", login: "iruixos" }]));
    window.desktopApi = { listTeamMembers };
    const onLoaded = jest.fn();
    ensureTeamMemberNames(onLoaded);
    ensureTeamMemberNames(onLoaded);
    await flush();
    expect(listTeamMembers).toHaveBeenCalledTimes(2);
    expect(state.teamMemberNames).toEqual({ u1: "Vette", u2: "iruixos" });
    expect(onLoaded).toHaveBeenCalledTimes(2);
  });

  test("a failed fetch is retried on the next call", async () => {
    state.teamSession = { userId: "me" };
    state.teams = [{ team: { id: "names-flaky" } }];
    const listTeamMembers = jest.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ userId: "u3", login: "ge0rge" }]);
    window.desktopApi = { listTeamMembers };
    ensureTeamMemberNames();
    await flush();
    ensureTeamMemberNames();
    await flush();
    expect(listTeamMembers).toHaveBeenCalledTimes(2);
    expect(state.teamMemberNames.u3).toBe("ge0rge");
  });

  test("no session, no fetch", () => {
    state.teamSession = null;
    state.teams = [{ team: { id: "names-nosession" } }];
    window.desktopApi = { listTeamMembers: jest.fn() };
    ensureTeamMemberNames();
    expect(window.desktopApi.listTeamMembers).not.toHaveBeenCalled();
  });
});
