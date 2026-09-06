/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { libraryPrefs: { sidebarWidth: 200 } },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const {
  initSidebarResize,
  applySidebarWidth,
  clampSidebarWidth,
  MIN_SIDEBAR_W,
  MAX_SIDEBAR_W,
  DEFAULT_SIDEBAR_W,
} = require("../../../src/renderer/modules/library/sidebar-resize.js");

function mount({ collapsed = false, width = 200 } = {}) {
  document.body.innerHTML = `
    <div class="lib-page">
      <div id="lib-sidebar" class="lib-sidebar ${collapsed ? "lib-sidebar--collapsed" : ""}"></div>
      <div id="lib-sidebar-resizer" class="lib-resizer"></div>
      <div id="lib-main" class="lib-main"></div>
    </div>`;
  const sidebar = document.getElementById("lib-sidebar");
  // jsdom has no layout, so the drag's starting width has to be faked.
  sidebar.getBoundingClientRect = () => ({ width, left: 0, right: width, top: 0, bottom: 0, height: 0, x: 0, y: 0 });
  return {
    page: document.querySelector(".lib-page"),
    sidebar,
    handle: document.getElementById("lib-sidebar-resizer"),
  };
}

const widthOf = (page) => page.style.getPropertyValue("--lib-sidebar-w");

function drag(handle, fromX, toX) {
  handle.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: fromX, bubbles: true }));
  document.dispatchEvent(new MouseEvent("pointermove", { clientX: toX, bubbles: true }));
  document.dispatchEvent(new MouseEvent("pointerup", { clientX: toX, bubbles: true }));
}

beforeEach(() => {
  state.libraryPrefs = { sidebarWidth: 200 };
});

describe("clampSidebarWidth", () => {
  test("keeps the sidebar inside a usable range", () => {
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_W);
    expect(clampSidebarWidth(9999)).toBe(MAX_SIDEBAR_W);
    expect(clampSidebarWidth(260)).toBe(260);
  });

  test("falls back to the default for junk", () => {
    expect(clampSidebarWidth(undefined)).toBe(DEFAULT_SIDEBAR_W);
    expect(clampSidebarWidth("wide")).toBe(DEFAULT_SIDEBAR_W);
    expect(clampSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_W);
  });
});

describe("applySidebarWidth", () => {
  test("writes the stored width onto the page", () => {
    const { page } = mount();
    state.libraryPrefs.sidebarWidth = 320;
    applySidebarWidth();
    expect(widthOf(page)).toBe("320px");
  });

  test("does nothing when the library page is not in the DOM", () => {
    document.body.innerHTML = "";
    expect(() => applySidebarWidth()).not.toThrow();
  });
});

describe("initSidebarResize", () => {
  test("a drag widens the sidebar and persists once, on release", () => {
    const { page, handle } = mount();
    const onCommit = jest.fn();
    initSidebarResize({ onCommit });

    drag(handle, 200, 300);

    expect(widthOf(page)).toBe("300px");
    expect(state.libraryPrefs.sidebarWidth).toBe(300);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test("a drag past the maximum clamps instead of running away", () => {
    const { page, handle } = mount();
    initSidebarResize({});
    drag(handle, 200, 5000);
    expect(widthOf(page)).toBe(`${MAX_SIDEBAR_W}px`);
  });

  test("a drag past the minimum clamps instead of collapsing", () => {
    const { page, handle } = mount();
    initSidebarResize({});
    drag(handle, 200, -500);
    expect(widthOf(page)).toBe(`${MIN_SIDEBAR_W}px`);
  });

  test("the is-resizing class is added for the drag and removed after", () => {
    const { page, handle } = mount();
    initSidebarResize({});
    handle.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 200, bubbles: true }));
    expect(page.classList.contains("is-resizing")).toBe(true);
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 240, bubbles: true }));
    expect(page.classList.contains("is-resizing")).toBe(false);
  });

  test("moves after release do not keep resizing the sidebar", () => {
    const { page, handle } = mount();
    initSidebarResize({});
    drag(handle, 200, 300);
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 450, bubbles: true }));
    expect(widthOf(page)).toBe("300px");
  });

  test("a collapsed sidebar cannot be dragged", () => {
    const { page, handle } = mount({ collapsed: true });
    initSidebarResize({});
    drag(handle, 200, 400);
    expect(page.classList.contains("is-resizing")).toBe(false);
    expect(state.libraryPrefs.sidebarWidth).toBe(200);
  });

  test("double-click resets to the default width", () => {
    const { page, handle } = mount();
    const onCommit = jest.fn();
    initSidebarResize({ onCommit });
    state.libraryPrefs.sidebarWidth = 400;
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(widthOf(page)).toBe(`${DEFAULT_SIDEBAR_W}px`);
    expect(onCommit).toHaveBeenCalled();
  });

  test("arrow keys nudge the width", () => {
    const { handle } = mount();
    initSidebarResize({});
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(state.libraryPrefs.sidebarWidth).toBe(208);
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }));
    expect(state.libraryPrefs.sidebarWidth).toBe(176);
  });

  test("binding twice does not double-apply a drag", () => {
    const { page, handle } = mount();
    const onCommit = jest.fn();
    initSidebarResize({ onCommit });
    initSidebarResize({ onCommit });
    drag(handle, 200, 300);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(widthOf(page)).toBe("300px");
  });
});
