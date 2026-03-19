"use strict";

const { applyMoveSlotBetweenLines } = require("../../../src/renderer/modules/comps/comp-detail");

function makeLine(id, slots, capacity) {
  return { id, slots: [...slots], capacity };
}

function makeComp(lines) {
  return { partyLines: lines };
}

describe("applyMoveSlotBetweenLines", () => {
  it("moves a build from one line to another when destination has room", () => {
    const comp = makeComp([
      makeLine("a", ["build-1", "build-2"], 5),
      makeLine("b", ["build-3"], 5),
    ]);

    const result = applyMoveSlotBetweenLines(comp, "build-1", "a", 0, "b");

    expect(result).toBe(true);
    expect(comp.partyLines[0].slots).toEqual(["build-2"]);
    expect(comp.partyLines[1].slots).toEqual(["build-3", "build-1"]);
    expect(comp.partyLines[1].capacity).toBe(5); // unchanged
  });

  it("expands destination capacity and moves build when destination line is full", () => {
    const fullSlots = ["b1", "b2", "b3", "b4", "b5"];
    const comp = makeComp([
      makeLine("a", ["b0"], 5),
      makeLine("b", fullSlots, 5),
    ]);

    const result = applyMoveSlotBetweenLines(comp, "b0", "a", 0, "b");

    expect(result).toBe(true);
    expect(comp.partyLines[0].slots).toEqual([]); // removed from source
    expect(comp.partyLines[1].slots).toEqual(["b1", "b2", "b3", "b4", "b5", "b0"]); // added to dest
    expect(comp.partyLines[1].capacity).toBe(6); // expanded
  });

  it("returns false (no mutation) when source and destination are the same line — caller must re-render", () => {
    // This case happens when the user drags a slot out then drops it back on
    // the same line. applyMoveSlotBetweenLines must NOT mutate data; the caller
    // (onMoveSlotToLine) handles re-render so the slot is restored in the DOM.
    const comp = makeComp([
      makeLine("a", ["b1", "b2"], 5),
    ]);

    const result = applyMoveSlotBetweenLines(comp, "b1", "a", 0, "a");

    expect(result).toBe(false);
    expect(comp.partyLines[0].slots).toEqual(["b1", "b2"]); // unchanged
  });

  it("shrinks source capacity back to 5 after moving out of a 6-build line", () => {
    const comp = makeComp([
      makeLine("a", ["b1", "b2", "b3", "b4", "b5", "b6"], 6),
      makeLine("b", ["bx"], 5),
    ]);

    applyMoveSlotBetweenLines(comp, "b1", "a", 0, "b");

    expect(comp.partyLines[0].slots).toEqual(["b2", "b3", "b4", "b5", "b6"]);
    expect(comp.partyLines[0].capacity).toBe(5); // shrunk back from 6
  });

  it("keeps source capacity at 5 (minimum) even when only 2 builds remain after move", () => {
    const comp = makeComp([
      makeLine("a", ["b1", "b2", "b3"], 5),
      makeLine("b", ["bx"], 5),
    ]);

    applyMoveSlotBetweenLines(comp, "b1", "a", 0, "b");

    expect(comp.partyLines[0].slots).toEqual(["b2", "b3"]);
    expect(comp.partyLines[0].capacity).toBe(5); // stays at minimum 5
  });

  it("does nothing when a line id is not found", () => {
    const comp = makeComp([
      makeLine("a", ["b1"], 5),
    ]);

    const result = applyMoveSlotBetweenLines(comp, "b1", "a", 0, "nonexistent");

    expect(result).toBe(false);
    expect(comp.partyLines[0].slots).toEqual(["b1"]); // unchanged
  });
});
