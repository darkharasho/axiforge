"use strict";

const { getTotalFilledSlots } = require("../../../src/renderer/modules/comps/comp-detail");

function makeLine(id, slots, capacity) {
  return { id, slots: [...slots], capacity };
}

function makeComp(lines) {
  return { partyLines: lines };
}

describe("getTotalFilledSlots", () => {
  it("returns 0 for a comp with no party lines", () => {
    expect(getTotalFilledSlots({ partyLines: [] })).toBe(0);
    expect(getTotalFilledSlots({})).toBe(0);
  });

  it("counts only filled slots, not capacity", () => {
    const comp = makeComp([
      makeLine("a", ["b1", "b2", "b3"], 5),
      makeLine("b", ["b4"], 5),
    ]);
    expect(getTotalFilledSlots(comp)).toBe(4);
  });

  it("correctly counts a line with more slots than default capacity", () => {
    // Party 1 has 14 builds with capacity 14, party 2 has 5 builds
    const comp = makeComp([
      makeLine("a", Array.from({ length: 14 }, (_, i) => `b${i}`), 14),
      makeLine("b", Array.from({ length: 5 }, (_, i) => `c${i}`), 5),
    ]);
    expect(getTotalFilledSlots(comp)).toBe(19);
  });

  it("allows adding the 50th slot when total capacity exceeds 50 but filled slots are 49", () => {
    // Reproduce bug: party 1 has 14 builds (capacity 14), 7 more parties of 5 = 49 filled
    // Old getTotalCapacity would return 14 + 7*5 = 49 capacity, then expand to 50+ on drop
    const lines = [
      makeLine("a", Array.from({ length: 14 }, (_, i) => `a${i}`), 14),
    ];
    // Add 7 more parties with 5 slots each = 35 more
    for (let p = 0; p < 7; p++) {
      lines.push(makeLine(`p${p}`, Array.from({ length: 5 }, (_, i) => `p${p}b${i}`), 5));
    }
    const comp = makeComp(lines);
    // Total filled = 14 + 35 = 49
    expect(getTotalFilledSlots(comp)).toBe(49);
    // Should NOT be blocked — room for 1 more
    expect(getTotalFilledSlots(comp) >= 50).toBe(false);
  });

  it("blocks adding when 50 slots are actually filled", () => {
    const lines = [
      makeLine("a", Array.from({ length: 10 }, (_, i) => `a${i}`), 10),
    ];
    for (let p = 0; p < 8; p++) {
      lines.push(makeLine(`p${p}`, Array.from({ length: 5 }, (_, i) => `p${p}b${i}`), 5));
    }
    const comp = makeComp(lines);
    // Total filled = 10 + 40 = 50
    expect(getTotalFilledSlots(comp)).toBe(50);
    expect(getTotalFilledSlots(comp) >= 50).toBe(true);
  });
});
