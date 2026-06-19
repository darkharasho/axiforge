"use strict";
const { getCompWebhooks, shareCompToWebhooks, WEBHOOK_RE } = require("../../src/main/compWebhooks");

function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async getSetting(key) { return key in data ? data[key] : null; },
    async setSetting(key, value) { data[key] = value; },
  };
}

const VALID = "https://discord.com/api/webhooks/123/abc";

describe("getCompWebhooks", () => {
  test("returns existing compWebhooks array unchanged", async () => {
    const list = [{ id: "w1", name: "A", url: VALID, threadMode: "none", threadId: null }];
    const store = makeStore({ "discord.compWebhooks": list });
    expect(await getCompWebhooks(store)).toEqual(list);
  });

  test("migrates legacy single webhook into a one-entry list", async () => {
    const store = makeStore({
      "discord.webhookUrl": VALID,
      "discord.threadMode": "custom",
      "discord.threadId": "999",
    });
    const result = await getCompWebhooks(store);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Default", url: VALID, threadMode: "custom", threadId: "999" });
    expect(typeof result[0].id).toBe("string");
    expect(result[0].id.length).toBeGreaterThan(0);
    // persisted so it's idempotent
    expect(store.data["discord.compWebhooks"]).toEqual(result);
  });

  test("migration drops threadId when mode is not custom", async () => {
    const store = makeStore({ "discord.webhookUrl": VALID, "discord.threadMode": "auto", "discord.threadId": "999" });
    const result = await getCompWebhooks(store);
    expect(result[0]).toMatchObject({ threadMode: "auto", threadId: null });
  });

  test("returns empty array when nothing configured", async () => {
    expect(await getCompWebhooks(makeStore())).toEqual([]);
  });

  test("ignores legacy webhook that fails the regex", async () => {
    const store = makeStore({ "discord.webhookUrl": "https://example.com/not-a-webhook" });
    expect(await getCompWebhooks(store)).toEqual([]);
  });
});

describe("shareCompToWebhooks", () => {
  const webhooks = [
    { id: "w1", name: "A", url: VALID, threadMode: "none", threadId: null },
    { id: "w2", name: "B", url: VALID, threadMode: "none", threadId: null },
    { id: "w3", name: "C", url: "bad-url", threadMode: "none", threadId: null },
  ];

  test("posts to selected ids only", async () => {
    const called = [];
    const out = await shareCompToWebhooks(webhooks, ["w2"], async (w) => { called.push(w.id); return { success: true }; });
    expect(called).toEqual(["w2"]);
    expect(out).toEqual({ success: true, results: [{ id: "w2", name: "B", success: true }] });
  });

  test("empty/missing ids posts to all", async () => {
    const called = [];
    await shareCompToWebhooks(webhooks.slice(0, 2), null, async (w) => { called.push(w.id); return { success: true }; });
    expect(called).toEqual(["w1", "w2"]);
  });

  test("marks invalid-url webhook as failed without calling shareOne", async () => {
    const called = [];
    const out = await shareCompToWebhooks(webhooks, ["w3"], async (w) => { called.push(w.id); return { success: true }; });
    expect(called).toEqual([]);
    expect(out.success).toBe(false);
    expect(out.results[0]).toMatchObject({ id: "w3", success: false });
  });

  test("aggregates partial failure as overall success=true", async () => {
    const out = await shareCompToWebhooks(webhooks.slice(0, 2), ["w1", "w2"], async (w) =>
      w.id === "w1" ? { success: true } : { success: false, error: "boom" });
    expect(out.success).toBe(true);
    expect(out.results.map((r) => r.success)).toEqual([true, false]);
    expect(out.results[1].error).toBe("boom");
  });

  test("unknown ids resolve to no targets and overall failure", async () => {
    const out = await shareCompToWebhooks(webhooks, ["nope"], async () => ({ success: true }));
    expect(out.success).toBe(false);
    expect(out.results).toEqual([]);
  });

  test("WEBHOOK_RE matches discord webhook urls", () => {
    expect(WEBHOOK_RE.test(VALID)).toBe(true);
    expect(WEBHOOK_RE.test("https://discordapp.com/api/webhooks/1/x")).toBe(true);
    expect(WEBHOOK_RE.test("https://example.com")).toBe(false);
  });
});
