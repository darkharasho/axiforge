"use strict";
const { assertCanMoveOutOfTeam, assertFolderTreeFits, decideCompBuildPublish } = require("../../src/main/teamGuards");

// findTeamRoot stub: folder ids are "<team>/<name>"; "p/..." means personal.
function makeDeps({ canDelete = async () => true, canWrite = () => true } = {}) {
  const calls = [];
  const writeChecks = [];
  const teamSync = {
    canDeleteIn: async (teamId, itemId) => {
      calls.push([teamId, itemId]);
      return canDelete(teamId, itemId);
    },
    // Per-folder access, checked on both sides of a move before anything is
    // written. Defaults to permissive so the ownership tests below still ask
    // only about ownership.
    assertCanWrite: async (folderId) => {
      writeChecks.push(folderId);
      if (!canWrite(folderId)) throw new Error("You do not have permission to change things in that folder.");
    },
  };
  const findTeamRoot = async (folderId) => {
    if (!folderId) return null;
    const team = String(folderId).split("/")[0];
    if (team === "p") return null;
    return { id: `root-${team}`, teamId: team };
  };
  return { deps: { teamSync, findTeamRoot }, calls, writeChecks };
}

test("personal → personal is a no-op and never consults canDelete", async () => {
  const { deps, calls } = makeDeps({ canDelete: async () => false });
  const roots = await assertCanMoveOutOfTeam(deps, {
    itemId: "b1", oldFolderId: "p/a", newFolderId: "p/b", label: "build",
  });
  expect(roots).toEqual({ oldRoot: null, newRoot: null });
  expect(calls).toEqual([]);
});

test("team → same team is a no-op and never consults canDelete", async () => {
  const { deps, calls } = makeDeps({ canDelete: async () => false });
  const roots = await assertCanMoveOutOfTeam(deps, {
    itemId: "b1", oldFolderId: "t1/a", newFolderId: "t1/b", label: "build",
  });
  expect(roots.oldRoot).toEqual({ id: "root-t1", teamId: "t1" });
  expect(roots.newRoot).toEqual({ id: "root-t1", teamId: "t1" });
  expect(calls).toEqual([]);
});

test("team → other team is allowed when canDelete is true", async () => {
  const { deps, calls } = makeDeps({ canDelete: async () => true });
  const roots = await assertCanMoveOutOfTeam(deps, {
    itemId: "b1", oldFolderId: "t1/a", newFolderId: "t2/b", label: "build",
  });
  expect(roots.oldRoot.teamId).toBe("t1");
  expect(roots.newRoot.teamId).toBe("t2");
  expect(calls).toEqual([["t1", "b1"]]);
});

test("team → personal throws when canDelete is false, checking the OLD team root", async () => {
  const { deps, calls } = makeDeps({ canDelete: async () => false });
  await expect(assertCanMoveOutOfTeam(deps, {
    itemId: "b1", oldFolderId: "t1/a", newFolderId: null, label: "build",
  })).rejects.toThrow("Only the team owner or the build's creator can move it out of the team.");
  expect(calls).toEqual([["t1", "b1"]]);
});

test("the label is interpolated into the refusal message", async () => {
  const { deps } = makeDeps({ canDelete: async () => false });
  await expect(assertCanMoveOutOfTeam(deps, {
    itemId: "f1", oldFolderId: "t1/a", newFolderId: "p/x", label: "folder",
  })).rejects.toThrow("Only the team owner or the folder's creator can move it out of the team.");
});

test("a folder you may only read refuses the write before anything moves", async () => {
  const { deps } = makeDeps({ canWrite: (id) => id !== "t1/locked" });
  await expect(assertCanMoveOutOfTeam(deps, {
    itemId: "b1", oldFolderId: "t1/a", newFolderId: "t1/locked", label: "build",
  })).rejects.toThrow("You do not have permission to change things in that folder.");
});

test("and so does taking something OUT of one", async () => {
  const { deps } = makeDeps({ canWrite: (id) => id !== "t1/locked" });
  await expect(assertCanMoveOutOfTeam(deps, {
    itemId: "b1", oldFolderId: "t1/locked", newFolderId: "t1/b", label: "build",
  })).rejects.toThrow("You do not have permission to change things in that folder.");
});

test("a plain save asks the write question once, about the folder it is in", async () => {
  const { deps, writeChecks } = makeDeps();
  await assertCanMoveOutOfTeam(deps, {
    itemId: "b1", oldFolderId: "t1/a", newFolderId: "t1/a", label: "build",
  });
  expect(writeChecks).toEqual(["t1/a"]);
});

// ── decideCompBuildPublish ────────────────────────────────────────────────
test("an unpublished build is published normally and needs a record", () => {
  expect(decideCompBuildPublish({ build: {}, owner: "me", force: false, slug: "s" }))
    .toEqual({ foreignOwner: null, needsRecord: true });
});

test("a build published by us needs a record only when the slug changed", () => {
  const build = { publishedFileId: "f", publishedKey: "k", publishedSlug: "s", publishedOwner: "me" };
  expect(decideCompBuildPublish({ build, owner: "me", force: false, slug: "s" }))
    .toEqual({ foreignOwner: null, needsRecord: false });
  expect(decideCompBuildPublish({ build, owner: "me", force: false, slug: "other" }))
    .toEqual({ foreignOwner: null, needsRecord: true });
});

test("a build published by someone else is skipped, not re-uploaded", () => {
  const build = { publishedFileId: "f", publishedKey: "k", publishedSlug: "s", publishedOwner: "alice" };
  expect(decideCompBuildPublish({ build, owner: "bob", force: false, slug: "s" }))
    .toEqual({ foreignOwner: "alice", needsRecord: false });
});

test("force takes over a foreign build and re-stamps the owner", () => {
  const build = { publishedFileId: "f", publishedKey: "k", publishedSlug: "s", publishedOwner: "alice" };
  expect(decideCompBuildPublish({ build, owner: "bob", force: true, slug: "s" }))
    .toEqual({ foreignOwner: null, needsRecord: true });
});

test("a foreign owner without a usable published copy is published normally", () => {
  const build = { publishedOwner: "alice" };
  expect(decideCompBuildPublish({ build, owner: "bob", force: false, slug: "s" }))
    .toEqual({ foreignOwner: null, needsRecord: true });
  const noKey = { publishedOwner: "alice", publishedFileId: "f" };
  expect(decideCompBuildPublish({ build: noKey, owner: "bob", force: false, slug: "s" }))
    .toEqual({ foreignOwner: null, needsRecord: true });
});

describe("assertFolderTreeFits", () => {
  // a (depth 1) → b (2) → c (3); x is a top-level folder with child x1 and grandchild x2.
  const folders = [
    { id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" },
    { id: "x", parentId: null }, { id: "x1", parentId: "x" }, { id: "x2", parentId: "x1" },
    { id: "y", parentId: null },
  ];
  test("a leaf folder can move under a depth-2 parent (lands at depth 3)", () => {
    expect(() => assertFolderTreeFits({ folders, folderId: "y", newParentId: "b" })).not.toThrow();
  });
  test("a folder with one level of children fits under a top-level parent", () => {
    expect(() => assertFolderTreeFits({ folders, folderId: "x1", newParentId: "a" })).not.toThrow();
  });
  test("a folder whose grandchildren would exceed the limit is refused", () => {
    // x has height 2 (x1, x2); under a (depth 1) → x=2, x1=3, x2=4 → too deep.
    expect(() => assertFolderTreeFits({ folders, folderId: "x", newParentId: "a" })).toThrow("FOLDER_TOO_DEEP");
  });
  test("a leaf cannot move under a depth-3 parent", () => {
    expect(() => assertFolderTreeFits({ folders, folderId: "y", newParentId: "c" })).toThrow("FOLDER_TOO_DEEP");
  });
  test("moving to top level never fails on depth", () => {
    expect(() => assertFolderTreeFits({ folders, folderId: "x", newParentId: null })).not.toThrow();
  });
});
