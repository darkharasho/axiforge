"use strict";

// The client-side mirror of the server's per-folder access rule.
//
// It exists so an edit is refused BEFORE it is written locally and queued: the
// server is the authority, but a client that only finds out by being refused
// tells the user "saved" and then "forbidden" a few seconds later. The two
// implementations must agree — see tests/unit/worker-sync-grants.test.js for the
// authoritative half.

const { accessAt, buildAccessMap, rank, LEVELS } = require("../../src/main/folderAccess");

// root (a team root, teamId set) → raids → wing1
const FOLDERS = [
  { id: "root", parentId: null, teamId: "team-1", role: "member" },
  { id: "raids", parentId: "root" },
  { id: "wing1", parentId: "raids" },
  { id: "personal", parentId: null },
];

const at = (folderId, grants = {}, role = "member") =>
  accessAt({ folders: FOLDERS, folderId, teamId: "team-1", grants, role });

describe("accessAt", () => {
  test("no grants anywhere is what every team had before this existed", () => {
    expect(at("raids")).toBe("write");
    expect(at("root")).toBe("write");
  });

  test("an owner is never restricted, whatever the grants say", () => {
    expect(at("raids", { raids: "none" }, "owner")).toBe("delete");
  });

  test("a grant on the folder decides it", () => {
    expect(at("raids", { raids: "read" })).toBe("read");
  });

  test("and reaches everything inside it", () => {
    expect(at("wing1", { raids: "read" })).toBe("read");
  });

  test("the nearest one wins, so a narrow grant re-opens a broad one", () => {
    expect(at("wing1", { raids: "read", wing1: "write" })).toBe("write");
  });

  test("a grant on the TEAM id is the team-wide default", () => {
    // Keyed by the team id, not the root folder's local id: the root folder is
    // not a synced item, so the server has nowhere else to hang it.
    expect(at("raids", { "team-1": "read" })).toBe("read");
    expect(at("root", { "team-1": "read" })).toBe("read");
  });

  test("a folder-level grant beats the team-wide one", () => {
    expect(at("raids", { "team-1": "read", raids: "delete" })).toBe("delete");
  });

  test("a personal folder is not restricted by a team's grants", () => {
    expect(accessAt({ folders: FOLDERS, folderId: "personal", teamId: "team-1", grants: { "team-1": "none" }, role: "member" }))
      .toBe("none");
  });

  test("a cyclic parent chain falls back rather than spinning", () => {
    const cyclic = [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }];
    expect(accessAt({ folders: cyclic, folderId: "a", teamId: "t", grants: {}, role: "member" })).toBe("write");
  });

  test("an unknown folder id falls back to the team default", () => {
    expect(at("ghost", { "team-1": "read" })).toBe("read");
  });
});

describe("buildAccessMap", () => {
  const root = FOLDERS[0];

  test("covers every folder in the team and nothing outside it", () => {
    const map = buildAccessMap({ folders: FOLDERS, root, teamId: "team-1", grants: {}, role: "member" });
    expect(Object.keys(map).sort()).toEqual(["raids", "root", "wing1"]);
  });

  test("one key answers for a folder and for the things sitting in it", () => {
    // A build's access is its folder's entry; a folder's access is its own. Both
    // are the same lookup, so the renderer needs no walking logic of its own.
    const map = buildAccessMap({ folders: FOLDERS, root, teamId: "team-1", grants: { raids: "read" }, role: "member" });
    expect(map.raids).toBe("read");
    expect(map.wing1).toBe("read");
    expect(map.root).toBe("write");
  });

  test("an owner's map is full access throughout", () => {
    const map = buildAccessMap({ folders: FOLDERS, root, teamId: "team-1", grants: { raids: "none" }, role: "owner" });
    expect(Object.values(map)).toEqual(["delete", "delete", "delete"]);
  });
});

describe("rank", () => {
  test("orders the levels least to most", () => {
    expect(rank("none")).toBeLessThan(rank("read"));
    expect(rank("read")).toBeLessThan(rank("write"));
    expect(rank("write")).toBeLessThan(rank("delete"));
  });

  test("an unknown level is the most restrictive, not the least", () => {
    expect(rank("wibble")).toBe(0);
    expect(rank(undefined)).toBeLessThan(LEVELS.read);
  });
});
