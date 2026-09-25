/**
 * @jest-environment jsdom
 *
 * A --fixed picker popover is placed by writing left/top from the trigger's
 * getBoundingClientRect(). The clamp that keeps a wide popover on screen
 * reads pop.offsetWidth -- and .axi-picker__pop carries `min-width: 100%`,
 * which on a position: fixed box resolves against the containing block, the
 * viewport. So before the inline minWidth is written the popover is as wide
 * as the window, the clamp computes `innerWidth - innerWidth - 8`, and the
 * popover lands at -8: hard against the left edge of the screen instead of
 * under its button.
 *
 * It only ever happened on a picker's FIRST open, because the inline minWidth
 * survived until the toolbar re-rendered and every later open measured
 * correctly -- which is why it presented as "sometimes".
 *
 * jsdom does no layout, so offsetWidth is stubbed to model the one CSS fact
 * that causes this: a fixed popover with no inline width is viewport-wide.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [], builds: [], comps: [], currentFolder: { type: "all" }, folderAccess: {},
    buildSearch: "", libraryPrefs: { sortField: "updatedAt", viewMode: "list", activeFilters: {}, filters: {} },
    buildSyncStatus: {}, folderSyncStatus: {},
  },
}));
jest.mock("../../../src/renderer/modules/library/folder-store.js", () => ({
  libraryBuilds: jest.fn(() => [{ profession: "Guardian", gameMode: "pve", tags: [] }]),
}));

const { renderToolbar, initToolbar } = require("../../../src/renderer/modules/library/toolbar.js");

// A trigger sitting well to the right, the case the old clamp got wrong.
const TRIGGER = { left: 880, right: 1000, top: 40, bottom: 66, width: 120, height: 26 };

function setup() {
  document.body.innerHTML = `<div id="lib-toolbar"></div><div id="lib-filters"></div>`;
  initToolbar({});
  renderToolbar();

  const btn = document.getElementById("lib-sort-trigger");
  const pop = document.getElementById("lib-sort-pop");
  btn.getBoundingClientRect = () => ({ ...TRIGGER, x: TRIGGER.left, y: TRIGGER.top });

  // `min-width: 100%` against the viewport until an inline width says otherwise.
  Object.defineProperty(pop, "offsetWidth", {
    configurable: true,
    get() {
      const inline = parseFloat(this.style.minWidth);
      return Number.isFinite(inline) ? inline : window.innerWidth;
    },
  });
  return { btn, pop };
}

describe("a --fixed picker opens under its trigger", () => {
  it("places the popover at the trigger, not against the screen edge", () => {
    const { btn, pop } = setup();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(pop.hidden).toBe(false);
    expect(parseFloat(pop.style.left)).toBeCloseTo(TRIGGER.left, 0);
    expect(parseFloat(pop.style.top)).toBeCloseTo(TRIGGER.bottom + 6, 0);
  });

  it("never places the popover off the left edge", () => {
    const { btn, pop } = setup();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(parseFloat(pop.style.left)).toBeGreaterThanOrEqual(0);
  });

  it("is right on the first open, not only on later ones", () => {
    // The old code self-corrected once an inline minWidth existed, so a test
    // that opened twice would have passed against the bug.
    const { btn, pop } = setup();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const firstLeft = parseFloat(pop.style.left);

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(parseFloat(pop.style.left)).toBeCloseTo(firstLeft, 0);
  });
});
