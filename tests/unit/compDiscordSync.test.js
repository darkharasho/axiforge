"use strict";

const { POSTS_KEY, recordCompPost, postedCompIds, syncCompDiscordPosts, compsAffectedByRound } = require("../../src/main/compDiscordSync");
const { buildCompEmbeds, compEmbedsSig } = require("../../src/main/discordWebhook");

function memStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getSetting: jest.fn(async (k) => (data[k] === undefined ? null : JSON.parse(JSON.stringify(data[k])))),
    setSetting: jest.fn(async (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); }),
  };
}

const build = (id, title) => ({ id, title, profession: "Guardian", specializations: [{ name: "Firebrand", elite: true }] });

function ctxFor(comp, builds) {
  return { comp, builds, compUrl: "https://x/c", buildUrls: {} };
}
const sigOf = (ctx) => compEmbedsSig(buildCompEmbeds(ctx.comp, ctx.builds, ctx.compUrl, ctx.buildUrls));

const webhooks = [{ id: "w1", url: "https://discord.com/api/webhooks/1/a" }];

describe("recordCompPost", () => {
  test("stores posts newest first, deduped by message id", async () => {
    const store = memStore();
    await recordCompPost(store, "c1", webhooks[0], { messageId: "m1", threadId: null }, "s1");
    await recordCompPost(store, "c1", webhooks[0], { messageId: "m2", threadId: "t" }, "s2");
    await recordCompPost(store, "c1", webhooks[0], { messageId: "m1", threadId: null }, "s3");
    expect(store.data[POSTS_KEY].c1.map((p) => p.messageId)).toEqual(["m1", "m2"]);
    expect(store.data[POSTS_KEY].c1[0].sig).toBe("s3");
    expect(await postedCompIds(store)).toEqual(["c1"]);
  });

  test("ignores a share without a message id", async () => {
    const store = memStore();
    await recordCompPost(store, "c1", webhooks[0], null, "s");
    expect(store.setSetting).not.toHaveBeenCalled();
  });
});

describe("syncCompDiscordPosts", () => {
  const comp = { id: "c1", name: "Zerg", partyLines: [{ id: "p1", slots: ["b1"] }], buildIds: ["b1"] };
  const builds = { b1: build("b1", "Heal FB") };

  test("does not edit when the embeds are unchanged", async () => {
    const ctx = ctxFor(comp, builds);
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "w1", messageId: "m1", threadId: null, sig: sigOf(ctx) }] } });
    const editPost = jest.fn();
    const out = await syncCompDiscordPosts(store, ["c1"], { webhooks, loadContext: async () => ctx, editPost });
    expect(editPost).not.toHaveBeenCalled();
    expect(out.edited).toEqual([]);
  });

  test("edits on rename, added build, or line change and stores the new sig", async () => {
    const before = ctxFor(comp, builds);
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "w1", messageId: "m1", threadId: "t1", sig: sigOf(before) }] } });
    const variants = [
      ctxFor({ ...comp, name: "Zerg v2" }, builds),
      ctxFor({ ...comp, buildIds: ["b1", "b2"] }, { ...builds, b2: build("b2", "Quick FB") }),
      ctxFor({ ...comp, partyLines: [{ id: "p1", slots: [] }, { id: "p2", slots: ["b1"] }] }, builds),
      ctxFor(comp, { b1: build("b1", "Renamed FB") }),
    ];
    for (const ctx of variants) {
      const editPost = jest.fn(async () => ({ success: true, sig: sigOf(ctx) }));
      const out = await syncCompDiscordPosts(store, ["c1"], { webhooks, loadContext: async () => ctx, editPost });
      expect(editPost).toHaveBeenCalledTimes(1);
      expect(editPost.mock.calls[0][4]).toBe(webhooks[0].url);
      expect(editPost.mock.calls[0][5]).toMatchObject({ messageId: "m1", threadId: "t1" });
      expect(out.edited).toEqual([{ compId: "c1", messageId: "m1" }]);
      expect(store.data[POSTS_KEY].c1[0].sig).toBe(sigOf(ctx));
    }
  });

  test("forgets a post Discord says is gone", async () => {
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "w1", messageId: "m1", sig: "old" }] } });
    await syncCompDiscordPosts(store, ["c1"], {
      webhooks, loadContext: async () => ctxFor(comp, builds), editPost: async () => ({ success: false, gone: true }),
    });
    expect(store.data[POSTS_KEY].c1).toBeUndefined();
  });

  test("keeps the old sig on a transient failure so the next round retries", async () => {
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "w1", messageId: "m1", sig: "old" }] } });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await syncCompDiscordPosts(store, ["c1"], {
      webhooks, loadContext: async () => ctxFor(comp, builds), editPost: async () => ({ success: false, error: "rate limited" }),
    });
    warn.mockRestore();
    expect(store.data[POSTS_KEY].c1[0].sig).toBe("old");
  });

  test("forgets posts whose webhook was removed from settings", async () => {
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "gone", messageId: "m1", sig: "old" }] } });
    const editPost = jest.fn();
    await syncCompDiscordPosts(store, ["c1"], { webhooks, loadContext: async () => ctxFor(comp, builds), editPost });
    expect(editPost).not.toHaveBeenCalled();
    expect(store.data[POSTS_KEY].c1).toBeUndefined();
  });

  test("keeps posts of a comp that can't be loaded (trashed)", async () => {
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "w1", messageId: "m1", sig: "old" }] } });
    await syncCompDiscordPosts(store, ["c1"], { webhooks, loadContext: async () => null, editPost: jest.fn() });
    expect(store.data[POSTS_KEY].c1).toHaveLength(1);
  });
});

describe("compsAffectedByRound", () => {
  const comps = [
    { id: "c1", buildIds: ["b1"] },
    { id: "c2", buildIds: ["b2"] },
    { id: "c3", buildIds: ["b1"] },
  ];
  const members = (c) => c.buildIds;

  test("picks posted comps that published or contain a published build", () => {
    const results = [{ kind: "comp", id: "c2", ok: true }, { kind: "build", id: "b1", ok: true }];
    expect(compsAffectedByRound(results, comps, ["c1", "c2"], members)).toEqual(["c1", "c2"]);
  });

  test("ignores failed results and unposted comps", () => {
    const results = [{ kind: "comp", id: "c1", ok: false }, { kind: "build", id: "b1", ok: true }];
    expect(compsAffectedByRound(results, comps, ["c2"], members)).toEqual([]);
  });
});

describe("team-shared posts", () => {
  const { discordHookId } = require("../../src/main/compDiscordSync");
  const base = { id: "c1", name: "Zerg", partyLines: [{ id: "p1", slots: ["b1"] }], buildIds: ["b1"] };
  const builds = { b1: build("b1", "Heal FB") };
  // A teammate configured the same Discord webhook under their own local id.
  const mine = [{ id: "local-x", url: "https://discord.com/api/webhooks/1/a" }];

  test("discordHookId reads the webhook id out of the URL", () => {
    expect(discordHookId("https://discord.com/api/webhooks/123/tok")).toBe("123");
    expect(discordHookId("https://discordapp.com/api/webhooks/9/t?wait=true")).toBe("9");
    expect(discordHookId("https://example.com/x")).toBeNull();
    expect(discordHookId(null)).toBeNull();
  });

  test("recordCompPost returns the shared entry without the token or local webhook id", async () => {
    const store = memStore();
    const shared = await recordCompPost(store, "c1", webhooks[0], { messageId: "m1", threadId: "t" }, "s1");
    expect(shared).toEqual({ hookId: "1", messageId: "m1", threadId: "t" });
    expect(store.data[POSTS_KEY].c1[0]).toMatchObject({ webhookId: "w1", hookId: "1", shared: true });
  });

  test("edits a teammate's post through a local webhook with the same Discord id", async () => {
    const comp = { ...base, discordPosts: [{ hookId: "1", messageId: "m9", threadId: "t9" }] };
    const ctx = ctxFor(comp, builds);
    const store = memStore();
    const editPost = jest.fn(async () => ({ success: true, sig: sigOf(ctx) }));
    const updateShared = jest.fn();
    const out = await syncCompDiscordPosts(store, ["c1"], { webhooks: mine, loadContext: async () => ctx, editPost, updateShared });
    expect(editPost).toHaveBeenCalledTimes(1);
    expect(editPost.mock.calls[0][4]).toBe(mine[0].url);
    expect(editPost.mock.calls[0][5]).toMatchObject({ messageId: "m9", threadId: "t9" });
    expect(out.edited).toEqual([{ compId: "c1", messageId: "m9" }]);
    // Remembered locally (with its sig) so the next round skips an unchanged embed.
    expect(store.data[POSTS_KEY].c1[0]).toMatchObject({ webhookId: "local-x", messageId: "m9", sig: sigOf(ctx), shared: true });
    expect(updateShared).not.toHaveBeenCalled();

    const again = jest.fn();
    await syncCompDiscordPosts(store, ["c1"], { webhooks: mine, loadContext: async () => ctx, editPost: again, updateShared });
    expect(again).not.toHaveBeenCalled();
  });

  test("leaves a shared post alone when no local webhook matches", async () => {
    const comp = { ...base, discordPosts: [{ hookId: "777", messageId: "m9", threadId: null }] };
    const store = memStore();
    const editPost = jest.fn();
    const updateShared = jest.fn();
    await syncCompDiscordPosts(store, ["c1"], { webhooks: mine, loadContext: async () => ctxFor(comp, builds), editPost, updateShared });
    expect(editPost).not.toHaveBeenCalled();
    expect(updateShared).not.toHaveBeenCalled();
    expect(store.data[POSTS_KEY]).toBeUndefined();
  });

  test("a deleted message is dropped from the shared list for everyone", async () => {
    const comp = { ...base, discordPosts: [{ hookId: "1", messageId: "m9", threadId: null }, { hookId: "2", messageId: "m8", threadId: null }] };
    const store = memStore();
    const updateShared = jest.fn();
    await syncCompDiscordPosts(store, ["c1"], {
      webhooks: mine, loadContext: async () => ctxFor(comp, builds), updateShared,
      editPost: async () => ({ success: false, gone: true, messageGone: true }),
    });
    expect(updateShared.mock.calls[0].slice(0, 2)).toEqual(["c1", [{ hookId: "2", messageId: "m8", threadId: null }]]);
  });

  test("a webhook only this user can't reach is forgotten locally but stays shared", async () => {
    const comp = { ...base, discordPosts: [{ hookId: "1", messageId: "m1", threadId: null }] };
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "w1", hookId: "1", messageId: "m1", sig: "old", shared: true }] } });
    const updateShared = jest.fn();
    await syncCompDiscordPosts(store, ["c1"], {
      webhooks, loadContext: async () => ctxFor(comp, builds), updateShared,
      editPost: async () => ({ success: false, gone: true }),
    });
    expect(store.data[POSTS_KEY].c1).toBeUndefined();
    expect(updateShared).not.toHaveBeenCalled();
  });

  test("shares posts recorded before team sharing existed, once", async () => {
    const ctx = ctxFor(base, builds);
    const store = memStore({ [POSTS_KEY]: { c1: [{ webhookId: "w1", messageId: "m1", threadId: "t1", sig: sigOf(ctx) }] } });
    const updateShared = jest.fn();
    await syncCompDiscordPosts(store, ["c1"], { webhooks, loadContext: async () => ctx, editPost: jest.fn(), updateShared });
    expect(updateShared.mock.calls[0].slice(0, 2)).toEqual(["c1", [{ hookId: "1", messageId: "m1", threadId: "t1" }]]);
    expect(store.data[POSTS_KEY].c1[0].shared).toBe(true);

    // A teammate later removed it (message deleted): it is not pushed back.
    updateShared.mockClear();
    await syncCompDiscordPosts(store, ["c1"], { webhooks, loadContext: async () => ctx, editPost: jest.fn(), updateShared });
    expect(updateShared).not.toHaveBeenCalled();
  });

  test("mergeSharedPosts dedupes by message id, newest first, capped", () => {
    const { mergeSharedPosts } = require("../../src/main/compDiscordSync");
    const list = [{ hookId: "1", messageId: "a", threadId: null }];
    expect(mergeSharedPosts(list, { hookId: "1", messageId: "b", threadId: "t" }).map((p) => p.messageId)).toEqual(["b", "a"]);
    expect(mergeSharedPosts(list, { hookId: "1", messageId: "a", threadId: null })).toHaveLength(1);
    let many = [];
    for (let i = 0; i < 15; i++) many = mergeSharedPosts(many, { hookId: "1", messageId: `m${i}`, threadId: null });
    expect(many).toHaveLength(10);
  });
});

describe("applySharedPostDelta", () => {
  const { applySharedPostDelta } = require("../../src/main/compDiscordPosts");
  const p = (id) => ({ hookId: "1", messageId: id, threadId: null });

  test("adds and removes what changed, keeping posts shared meanwhile", () => {
    const prev = [p("a"), p("b")];
    const next = [p("c"), p("a")]; // b deleted, c added
    const current = [p("z"), p("a"), p("b")]; // z shared by someone meanwhile
    expect(applySharedPostDelta(current, next, prev).map((x) => x.messageId)).toEqual(["c", "z", "a"]);
  });
});
