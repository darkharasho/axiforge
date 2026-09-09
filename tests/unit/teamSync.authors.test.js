"use strict";

// Who wrote each shared item.
//
// The renderer cannot answer this: `createdBy` only exists in main's sync state,
// written when an item is pushed (it is ours) or pulled (the server said whose
// it is). `authorMap()` resolves it once for every team the user is in, so the
// smart-folder "Shared by me" / "Shared with me" filters can ask about the
// AUTHOR rather than about the team's role — which is what they used to do, and
// which told an owner that every teammate's build was their own (#300).

const { makeHarness } = require("../helpers/teamSyncHarness");
const { FLUSH_DEBOUNCE_MS } = require("../../src/main/teamSync");

async function withTeam(h, { role = "owner", teamId = "t1", rootId = "root" } = {}) {
  await h.folderStore.upsertFolder({ id: rootId, name: "EWW", parentId: null, shared: true, teamId, role });
  return rootId;
}

describe("authorMap", () => {
  test("one entry per synced item, across every team", async () => {
    const h = await makeHarness();
    await withTeam(h);
    await withTeam(h, { role: "member", teamId: "t2", rootId: "root2" });
    await h.syncStore.setVersion("t1", "b1", { version: 1, createdBy: "me" });
    await h.syncStore.setVersion("t1", "b2", { version: 3, createdBy: "u-them" });
    await h.syncStore.setVersion("t2", "b3", { version: 1, createdBy: "u-other" });

    expect(await h.sync.authorMap()).toEqual({ b1: "me", b2: "u-them", b3: "u-other" });
    await h.cleanup();
  });

  // Absent and null are different answers and the renderer decides between them:
  // absent means never pushed (so it was made here), null means the server sent
  // the item without a creator. Collapsing them would file every item an older
  // server returned as somebody else's work.
  test("an item with no creator is kept as an explicit null, not dropped", async () => {
    const h = await makeHarness();
    await withTeam(h);
    await h.syncStore.setVersion("t1", "b1", { version: 1, createdBy: null });

    const map = await h.sync.authorMap();
    expect(map).toHaveProperty("b1", null);
    expect(map).not.toHaveProperty("b-never-synced");
    await h.cleanup();
  });

  test("a team with no local root contributes nothing", async () => {
    const h = await makeHarness();
    await h.syncStore.setVersion("t-detached", "b1", { version: 1, createdBy: "me" });
    expect(await h.sync.authorMap()).toEqual({});
    await h.cleanup();
  });

  // The whole point of resolving it in main: pushing an item stamps it as ours,
  // so a build made here and synced still reads as ours afterwards.
  test("pushing an item records the caller as its author", async () => {
    const h = await makeHarness();
    const root = await withTeam(h);
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: root });
    await h.sync.enqueue("t1", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);

    expect(await h.sync.authorMap()).toMatchObject({ b1: "me" });
    await h.cleanup();
  });
});
