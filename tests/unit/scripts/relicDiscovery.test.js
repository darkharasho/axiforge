/**
 * Issue #337 — Visions of Eternity Set 4 relics were missing because the
 * weekly wiki sync 403s on GitHub Actions IPs, so the relic list silently went
 * stale. The sync now falls back to discovering new relics via the GW2 API
 * (type === "Relic"), which CI can reach.
 */
const { RELIC_ITEM_IDS } = require("../../../src/main/gw2Data/upgradeIds");
const upgradeIdsJson = require("../../../src/main/gw2Data/upgradeIds.json");
const { discoverNewItemsByType } = require("../../../scripts/lib/apiItemDiscovery.cjs");

// Relics—Visions of Eternity Set 4
const VOE_SET_4 = {
  109936: "Relic of the Lantern",
  109942: "Relic of the Last Tyrant",
  109980: "Relic of the Eternal Alchemy",
  109998: "Relic of the Tyrian Hero",
  110009: "Relic of the Curator",
  110152: "Relic of the Visionary",
};

describe("Visions of Eternity Set 4 relics (#337)", () => {
  test.each(Object.entries(VOE_SET_4))("%s %s is in RELIC_ITEM_IDS", (id) => {
    expect(RELIC_ITEM_IDS).toContain(Number(id));
  });

  test("runtime upgradeIds.json matches upgradeIds.js relics", () => {
    expect(upgradeIdsJson.RELIC_ITEM_IDS).toEqual(RELIC_ITEM_IDS);
  });
});

describe("discoverNewItemsByType", () => {
  const catalog = {
    100: { id: 100, name: "Relic of Old", type: "Relic" },
    200: { id: 200, name: "Some Armor", type: "Armor" },
    300: { id: 300, name: "Relic of New", type: "Relic" },
    400: { id: 400, name: "Relic of Newer", type: "Relic" },
    500: { id: 500, name: "A Trophy", type: "Trophy" },
  };
  const fetchItems = jest.fn(async (ids) => ids.map((id) => catalog[id]).filter(Boolean));

  beforeEach(() => fetchItems.mockClear());

  test("returns only new items of the type, above the known max id", async () => {
    const found = await discoverNewItemsByType({
      allIds: [100, 200, 300, 400, 500],
      existingIds: [100],
      type: "Relic",
      fetchItems,
    });
    expect(found).toEqual([
      { id: 300, name: "Relic of New" },
      { id: 400, name: "Relic of Newer" },
    ]);
    // Only scans ids past the watermark — never the whole item catalog.
    expect(fetchItems.mock.calls.flat(2)).not.toContain(100);
  });

  test("batches requests", async () => {
    await discoverNewItemsByType({
      allIds: [100, 200, 300, 400, 500],
      existingIds: [100],
      type: "Relic",
      fetchItems,
      batchSize: 2,
    });
    expect(fetchItems.mock.calls.map((c) => c[0])).toEqual([[200, 300], [400, 500]]);
  });

  test("does not rescan ids at or below the highest known id", async () => {
    const found = await discoverNewItemsByType({
      allIds: [100, 200, 300, 400, 500],
      existingIds: [100, 300],
      type: "Relic",
      fetchItems,
    });
    expect(found).toEqual([{ id: 400, name: "Relic of Newer" }]);
    expect(fetchItems.mock.calls.flat(2)).toEqual([400, 500]);
  });

  test("refuses to run without existing ids (no watermark → would scan everything)", async () => {
    await expect(
      discoverNewItemsByType({ allIds: [1, 2], existingIds: [], type: "Relic", fetchItems }),
    ).rejects.toThrow(/watermark/);
  });
});
