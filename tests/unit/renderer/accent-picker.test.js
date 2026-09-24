/**
 * @jest-environment jsdom
 */
"use strict";

// settings-modal.js pulls transitive deps at module scope; the repo's existing
// settings-modal tests (tests/unit/settingsModalNav.test.js) stub the same four,
// and this test follows that convention. The pragma must be the file's FIRST
// docblock or jest ignores it and the test runs under the node environment
// with no `document`.
jest.mock("../../../src/renderer/modules/state.js", () => ({ state: {} }));
jest.mock("../../../src/renderer/modules/custom-select.js", () => ({ renderCustomSelect: jest.fn() }));
jest.mock("../../../src/renderer/modules/utils.js", () => ({
  escapeHtml: (s) => String(s),
  delay: () => Promise.resolve(),
}));

const { ACCENTS } = require("../../../src/renderer/modules/accents.js");
const { renderAccentGrid } = require("../../../src/renderer/modules/settings-modal.js");

describe("renderAccentGrid", () => {
  let grid;
  beforeEach(() => {
    grid = document.createElement("div");
  });

  it("renders one card per package accent, in package order", () => {
    renderAccentGrid(grid, "axi-gold");
    const cards = grid.querySelectorAll(".af-accent-card");
    expect(cards).toHaveLength(ACCENTS.length);
    expect([...cards].map((c) => c.dataset.accent)).toEqual(ACCENTS.map((a) => a.id));
  });

  it("labels each card from the package", () => {
    renderAccentGrid(grid, "axi-gold");
    const labels = [...grid.querySelectorAll(".af-accent-card__label")].map((n) => n.textContent);
    expect(labels).toEqual(ACCENTS.map((a) => a.label));
  });

  it("marks exactly the active card", () => {
    renderAccentGrid(grid, "violet-purple");
    const active = grid.querySelectorAll(".af-accent-card--active");
    expect(active).toHaveLength(1);
    expect(active[0].dataset.accent).toBe("violet-purple");
  });

  it("marks the default card active for a legacy stored id", () => {
    renderAccentGrid(grid, "prof-mesmer");
    const active = grid.querySelector(".af-accent-card--active");
    expect(active.dataset.accent).toBe("violet-purple");
  });

  it("marks the default card active for an empty stored id", () => {
    renderAccentGrid(grid, "");
    expect(grid.querySelector(".af-accent-card--active").dataset.accent).toBe("axi-gold");
  });

  it("carries no Full/Accent type tag - the distinction no longer exists", () => {
    renderAccentGrid(grid, "axi-gold");
    expect(grid.textContent).not.toMatch(/\bFull\b/);
  });
});
