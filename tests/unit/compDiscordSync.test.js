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
    await recordCompPost(store, "c1", "w1", { messageId: "m1", threadId: null }, "s1");
    await recordCompPost(store, "c1", "w1", { messageId: "m2", threadId: "t" }, "s2");
    await recordCompPost(store, "c1", "w1", { messageId: "m1", threadId: null }, "s3");
    expect(store.data[POSTS_KEY].c1.map((p) => p.messageId)).toEqual(["m1", "m2"]);
    expect(store.data[POSTS_KEY].c1[0].sig).toBe("s3");
    expect(await postedCompIds(store)).toEqual(["c1"]);
  });

  test("ignores a share without a message id", async () => {
    const store = memStore();
    await recordCompPost(store, "c1", "w1", null, "s");
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
