"use strict";
const { assertCanMoveOutOfTeam, decideCompBuildPublish } = require("../../src/main/teamGuards");

// findTeamRoot stub: folder ids are "<team>/<name>"; "p/..." means personal.
function makeDeps({ canDelete = async () => true } = {}) {
  const calls = [];
  const teamSync = {
    canDelete: async (teamId, itemId) => {
      calls.push([teamId, itemId]);
      return canDelete(teamId, itemId);
    },
  };
  const findTeamRoot = async (folderId) => {
    if (!folderId) return null;
    const team = String(folderId).split("/")[0];
    if (team === "p") return null;
    return { id: `root-${team}`, teamId: team };
  };
  return { deps: { teamSync, findTeamRoot }, calls };
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
