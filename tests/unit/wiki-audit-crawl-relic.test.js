"use strict";

const { crawlEntity, SELECTORS } = require("../wiki-audit/crawl-relic");

// Mock a Playwright page that returns pre-canned results
function mockPage(opts = {}) {
  const { facts = [], recharge = null, missing = false, error = null } = opts;
  return {
    goto: jest.fn(async () => { if (error) throw new Error(error); }),
    url: jest.fn(() => "https://wiki.guildwars2.com/wiki/Test_Relic"),
    $: jest.fn(async (sel) => {
      if (sel === SELECTORS.noArticle) return missing ? {} : null;
      return null;
    }),
    $$eval: jest.fn(async () => facts),
    $eval: jest.fn(async (sel, fn) => {
      if (sel === SELECTORS.statistics && recharge != null) {
        return { recharge };
      }
      throw new Error("not found");
    }),
  };
}

describe("crawl-relic crawlEntity", () => {
  test("returns facts and recharge for a valid relic page", async () => {
    const page = mockPage({
      facts: [
        { name: "Damage", valueText: "266 (1.0)" },
        { name: "Number of Targets", valueText: "5" },
      ],
      recharge: 30,
    });

    const result = await crawlEntity(page, { id: 100074, name: "Relic of Cerus", type: "relic" }, "relic");

    expect(result.error).toBeNull();
    expect(result.facts).toHaveLength(3); // 2 facts + recharge
    expect(result.facts[2]).toEqual({ name: "Recharge", valueText: "30" });
  });

  test("returns empty facts for a missing wiki page", async () => {
    const page = mockPage({ missing: true });

    const result = await crawlEntity(page, { id: 99999, name: "Fake Relic", type: "relic" }, "relic");

    expect(result.error).toBe("Wiki page not found");
    expect(result.facts).toEqual([]);
  });

  test("returns facts without recharge when no statistics div", async () => {
    const page = mockPage({
      facts: [{ name: "Range", valueText: "600" }],
      recharge: null,
    });

    const result = await crawlEntity(page, { id: 100148, name: "Relic of Speed", type: "relic" }, "relic");

    expect(result.error).toBeNull();
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].name).toBe("Range");
  });

  test("retries once on navigation error", async () => {
    let callCount = 0;
    const page = mockPage({});
    page.goto = jest.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("timeout");
    });
    page.$$eval = jest.fn(async () => []);

    const result = await crawlEntity(page, { id: 100001, name: "Test Relic", type: "relic" }, "relic");

    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(result.error).toBeNull();
  });
});
