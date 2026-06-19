"use strict";
const { getBuildWebhooks, shareBuildToWebhooks } = require("../../src/main/buildWebhooks");

function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async getSetting(key) { return key in data ? data[key] : null; },
    async setSetting(key, value) { data[key] = value; },
  };
}

const VALID = "https://discord.com/api/webhooks/123/abc";

describe("getBuildWebhooks", () => {
  test("returns existing buildWebhooks array unchanged", async () => {
    const list = [{ id: "w1", name: "A", url: VALID, threadMode: "none", threadId: null }];
    expect(await getBuildWebhooks(makeStore({ "discord.buildWebhooks": list }))).toEqual(list);
  });

  test("migrates legacy build webhook from build-specific settings, persisting", async () => {
    const store = makeStore({
      "discord.buildWebhookUrl": VALID,
      "discord.buildThreadMode": "custom",
      "discord.buildThreadId": "55",
    });
    const list = await getBuildWebhooks(store);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Default", url: VALID, threadMode: "custom", threadId: "55" });
    expect(store.data["discord.buildWebhooks"]).toEqual(list);
  });

  test("does not migrate from the comp legacy key", async () => {
    expect(await getBuildWebhooks(makeStore({ "discord.webhookUrl": VALID }))).toEqual([]);
  });

  test("returns [] when nothing is configured", async () => {
    expect(await getBuildWebhooks(makeStore())).toEqual([]);
  });
});

describe("shareBuildToWebhooks (reuses the generic poster)", () => {
  test("targets selected ids and aggregates results", async () => {
    const hooks = [
      { id: "a", name: "DEFI", url: VALID },
      { id: "b", name: "EWW", url: VALID },
    ];
    const res = await shareBuildToWebhooks(hooks, ["b"], async () => ({ success: true }));
    expect(res.success).toBe(true);
    expect(res.results).toEqual([{ id: "b", name: "EWW", success: true }]);
  });
});
