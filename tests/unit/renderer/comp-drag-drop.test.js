"use strict";

// Tests for comp-drag-drop.js
// Jest testEnvironment is "node", so we mock document globally.

let capturedSortableInstances = [];
jest.mock("sortablejs", () => {
  return jest.fn().mockImplementation(function (el, options) {
    capturedSortableInstances.push({ el, options });
    this.destroy = jest.fn();
  });
});

const {
  wireCompDragDrop,
  destroyCompDragDrop,
  collapseHoverExpanded,
} = require("../../../src/renderer/modules/comps/comp-drag-drop");

function buildFakeSlotsEl({ slotCount = 3, capacity = 5, lineId = "line-1" } = {}) {
  const filledSlots = [];
  for (let i = 0; i < slotCount; i++) {
    filledSlots.push({
      className: "comp-slot comp-slot--filled",
      dataset: { buildId: `build-${i}`, lineId, slotIdx: String(i) },
    });
  }

  const fakeLineEl = { className: "comp-line", dataset: { lineId }, style: {} };

  return {
    className: "comp-line__slots",
    children: filledSlots,
    style: {},
    dataset: { capacity: String(capacity) },
    closest: (sel) => {
      if (sel === ".comp-line") return fakeLineEl;
      if (sel === "[data-line-id]") return fakeLineEl;
      return null;
    },
    querySelectorAll: (sel) => (sel === ".comp-slot--filled" ? filledSlots : []),
  };
}

function makeCallbacks() {
  return {
    onReorderSlotsInLine: jest.fn(),
    onDropBuildToLine: jest.fn(),
    onMoveSlotToLine: jest.fn(),
    onReorderLines: jest.fn(),
  };
}

// Fake party panel element — captures classList add/remove calls
function makeFakePartyPanel() {
  const classes = new Set();
  return {
    classList: {
      add: jest.fn((c) => classes.add(c)),
      remove: jest.fn((c) => classes.delete(c)),
      has: (c) => classes.has(c),
    },
  };
}

beforeEach(() => {
  capturedSortableInstances = [];
});

afterEach(() => {
  destroyCompDragDrop();
  delete global.document;
});

function setupDoc(slotsEls, partyPanel) {
  const pp = partyPanel || makeFakePartyPanel();
  global.document = {
    querySelector: jest.fn((sel) => {
      if (sel === ".comp-detail__party-panel") return pp;
      return null;
    }),
    querySelectorAll: jest.fn((sel) => {
      if (sel === ".comp-line__slots") return slotsEls;
      return [];
    }),
    _partyPanel: pp,
  };
  return pp;
}

// ── Drag-session CSS class ────────────────────────────────────────────────────

describe("comp-dragging class management", () => {
  it("adds comp-dragging to the party panel on onStart", () => {
    const slotsEl = buildFakeSlotsEl({ slotCount: 5, capacity: 5 });
    const pp = setupDoc([slotsEl]);
    wireCompDragDrop(makeCallbacks());

    const lineSortable = capturedSortableInstances.find((i) => i.el === slotsEl);
    lineSortable.options.onStart();

    expect(pp.classList.add).toHaveBeenCalledWith("comp-dragging");
  });

  it("removes comp-dragging from the party panel on onEnd", () => {
    const slotsEl = buildFakeSlotsEl({ slotCount: 5, capacity: 5 });
    const pp = setupDoc([slotsEl]);
    wireCompDragDrop(makeCallbacks());

    const lineSortable = capturedSortableInstances.find((i) => i.el === slotsEl);
    lineSortable.options.onStart();
    lineSortable.options.onEnd();

    expect(pp.classList.remove).toHaveBeenCalledWith("comp-dragging");
  });

  it("collapseHoverExpanded removes comp-dragging", () => {
    const pp = setupDoc([]);
    // manually add the class first
    pp.classList.add("comp-dragging");

    collapseHoverExpanded();

    expect(pp.classList.remove).toHaveBeenCalledWith("comp-dragging");
  });

  it("collapseHoverExpanded is safe when party panel is not found", () => {
    global.document = {
      querySelector: jest.fn().mockReturnValue(null),
      querySelectorAll: jest.fn().mockReturnValue([]),
    };
    expect(() => collapseHoverExpanded()).not.toThrow();
  });
});

// ── onMove — capacity enforcement ────────────────────────────────────────────

describe("onMove — capacity enforcement", () => {
  it("blocks cross-list drops when target line is at capacity", () => {
    const slotsEl = buildFakeSlotsEl({ slotCount: 5, capacity: 5 });
    const otherEl = buildFakeSlotsEl({ slotCount: 2, lineId: "line-2" });
    setupDoc([slotsEl, otherEl]);
    wireCompDragDrop(makeCallbacks());

    const sortable = capturedSortableInstances.find((i) => i.el === slotsEl);
    expect(typeof sortable.options.onMove).toBe("function");

    // Target line is full — should block the drop
    const result = sortable.options.onMove({ from: otherEl, to: slotsEl });
    expect(result).toBe(false);
  });

  it("allows reorder within the same line", () => {
    const slotsEl = buildFakeSlotsEl({ slotCount: 5, capacity: 5 });
    setupDoc([slotsEl]);
    wireCompDragDrop(makeCallbacks());

    const sortable = capturedSortableInstances.find((i) => i.el === slotsEl);
    // Same from and to — always allowed
    const result = sortable.options.onMove({ from: slotsEl, to: slotsEl });
    expect(result).toBe(true);
  });
});

// ── destroyCompDragDrop cleans up ─────────────────────────────────────────────

describe("destroyCompDragDrop", () => {
  it("removes comp-dragging class on destroy", () => {
    const slotsEl = buildFakeSlotsEl();
    const pp = setupDoc([slotsEl]);
    wireCompDragDrop(makeCallbacks());

    // simulate drag started
    const lineSortable = capturedSortableInstances.find((i) => i.el === slotsEl);
    lineSortable.options.onStart();

    destroyCompDragDrop();

    expect(pp.classList.remove).toHaveBeenCalledWith("comp-dragging");
  });
});
