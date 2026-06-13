"use strict";

const {
  addCategorySlotToLine,
  getTotalFilledSlots,
  isTagSlot,
  tagSlotCategoryId,
  makeTagSlot,
  TAG_SLOT_PREFIX,
} = require("../../../src/renderer/modules/comps/comp-detail");

function makeComp({ buildIds = [], categories = [], lines = [] } = {}) {
  return {
    buildIds: [...buildIds],
    categories: categories.map((c) => ({ ...c, buildIds: [...(c.buildIds || [])] })),
    partyLines: lines.map((l) => ({ ...l, slots: [...l.slots] })),
  };
}

describe("tag-slot encoding helpers", () => {
  it("round-trips a category id through makeTagSlot / tagSlotCategoryId", () => {
    const token = makeTagSlot("cat-123");
    expect(token).toBe(`${TAG_SLOT_PREFIX}cat-123`);
    expect(isTagSlot(token)).toBe(true);
    expect(tagSlotCategoryId(token)).toBe("cat-123");
  });

  it("does not treat a plain build id (UUID) as a tag slot", () => {
    const uuid = "3f1b9c2a-7d4e-4a1b-9c2a-7d4e4a1b9c2a";
    expect(isTagSlot(uuid)).toBe(false);
    expect(tagSlotCategoryId(uuid)).toBeNull();
  });
});

describe("addCategorySlotToLine", () => {
  it("appends exactly one tag slot for the category, not one per build", () => {
    const comp = makeComp({
      buildIds: ["b1", "b2", "b3"],
      categories: [{ id: "cat-dps", name: "DPS", buildIds: ["b1", "b3"] }],
      lines: [{ id: "p1", capacity: 5, slots: [] }],
    });

    const ok = addCategorySlotToLine(comp, "cat-dps", "p1");

    expect(ok).toBe(true);
    expect(comp.partyLines[0].slots).toEqual([makeTagSlot("cat-dps")]);
  });

  it("appends after existing slots without disturbing them", () => {
    const comp = makeComp({
      buildIds: ["b1"],
      categories: [{ id: "c", name: "Heals", buildIds: ["b1"] }],
      lines: [{ id: "p1", capacity: 5, slots: ["b1"] }],
    });

    addCategorySlotToLine(comp, "c", "p1");

    expect(comp.partyLines[0].slots).toEqual(["b1", makeTagSlot("c")]);
  });

  it("adds the tag slot even when the category has no member builds", () => {
    // The slot is a placeholder/icon — membership only affects the hover preview.
    const comp = makeComp({
      buildIds: [],
      categories: [{ id: "c", name: "Empty", buildIds: [] }],
      lines: [{ id: "p1", capacity: 5, slots: [] }],
    });

    expect(addCategorySlotToLine(comp, "c", "p1")).toBe(true);
    expect(comp.partyLines[0].slots).toEqual([makeTagSlot("c")]);
  });

  it("expands line capacity when the slot overflows the current capacity", () => {
    const comp = makeComp({
      categories: [{ id: "c", name: "Tag", buildIds: [] }],
      lines: [{ id: "p1", capacity: 5, slots: ["b1", "b2", "b3", "b4", "b5"] }],
    });

    addCategorySlotToLine(comp, "c", "p1");

    expect(comp.partyLines[0].slots).toHaveLength(6);
    expect(comp.partyLines[0].capacity).toBeGreaterThanOrEqual(6);
  });

  it("refuses to add past the global 50-slot cap", () => {
    const filler = { id: "filler", capacity: 50, slots: Array.from({ length: 50 }, (_, i) => `f${i}`) };
    const comp = makeComp({
      categories: [{ id: "c", name: "DPS", buildIds: [] }],
      lines: [filler, { id: "p1", capacity: 5, slots: [] }],
    });

    expect(getTotalFilledSlots(comp)).toBe(50);
    expect(addCategorySlotToLine(comp, "c", "p1")).toBe(false);
    expect(comp.partyLines[1].slots).toEqual([]);
  });

  it("returns false for an unknown category or line, leaving the comp untouched", () => {
    const comp = makeComp({
      categories: [{ id: "c", name: "DPS", buildIds: [] }],
      lines: [{ id: "p1", capacity: 5, slots: [] }],
    });

    expect(addCategorySlotToLine(comp, "nope", "p1")).toBe(false);
    expect(addCategorySlotToLine(comp, "c", "nope")).toBe(false);
    expect(comp.partyLines[0].slots).toEqual([]);
  });

  it("counts a tag slot toward the filled-slot total", () => {
    const comp = makeComp({
      categories: [{ id: "c", name: "DPS", buildIds: [] }],
      lines: [{ id: "p1", capacity: 5, slots: ["b1"] }],
    });

    addCategorySlotToLine(comp, "c", "p1");

    expect(getTotalFilledSlots(comp)).toBe(2);
  });
});
