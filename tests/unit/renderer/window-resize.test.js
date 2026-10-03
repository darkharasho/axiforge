/**
 * @jest-environment jsdom
 *
 * Issue #318: the window is transparent on Linux and Windows so the frameless
 * corners can be rounded in CSS, and a transparent Electron window has no
 * native resize border — the app could not be resized at all. These grips are
 * the replacement, so what they must pin is that the drag reaches the main
 * process as an edge plus a screen-space delta, and that macOS, whose window is
 * opaque and resizes natively, gets no grips to shadow its own border.
 */
"use strict";

const { initWindowResize } = require("../../../src/renderer/modules/window-resize.js");

function fakeApi(overrides = {}) {
  return {
    needsManualResize: true,
    resizeWindowStart: jest.fn().mockResolvedValue(true),
    resizeWindowTo: jest.fn().mockResolvedValue(true),
    resizeWindowEnd: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function grip(edge) {
  return document.querySelector(`.af-resize[data-edge="${edge}"]`);
}

function pointer(type, props = {}) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: 1, button: 0, screenX: 0, screenY: 0, ...props });
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = "";
  // jsdom implements neither of these; the module calls both on a real drag.
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
});

describe("initWindowResize", () => {
  it("installs a grip for all four edges and all four corners", () => {
    initWindowResize(fakeApi());
    const edges = [...document.querySelectorAll(".af-resize")].map((n) => n.dataset.edge);
    expect(edges.sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
  });

  it("installs nothing when the platform resizes natively", () => {
    initWindowResize(fakeApi({ needsManualResize: false }));
    expect(document.querySelectorAll(".af-resize")).toHaveLength(0);
  });

  it("is idempotent — a second init does not double the grips", () => {
    const api = fakeApi();
    initWindowResize(api);
    initWindowResize(api);
    expect(document.querySelectorAll(".af-resize")).toHaveLength(8);
  });

  it("tells main which edge the drag started on", () => {
    const api = fakeApi();
    initWindowResize(api);
    grip("se").dispatchEvent(pointer("pointerdown", { screenX: 900, screenY: 700 }));
    expect(api.resizeWindowStart).toHaveBeenCalledWith("se");
  });

  it("reports the delta from where the drag started, in screen space", () => {
    const api = fakeApi();
    initWindowResize(api);
    const g = grip("se");
    g.dispatchEvent(pointer("pointerdown", { screenX: 900, screenY: 700 }));
    g.dispatchEvent(pointer("pointermove", { screenX: 950, screenY: 680 }));
    expect(api.resizeWindowTo).toHaveBeenCalledWith(50, -20);
    g.dispatchEvent(pointer("pointermove", { screenX: 900, screenY: 700 }));
    expect(api.resizeWindowTo).toHaveBeenLastCalledWith(0, 0);
  });

  it("ignores pointer movement when no drag is in flight", () => {
    const api = fakeApi();
    initWindowResize(api);
    grip("se").dispatchEvent(pointer("pointermove", { screenX: 950, screenY: 680 }));
    expect(api.resizeWindowTo).not.toHaveBeenCalled();
  });

  it("ends the drag on pointerup and stops reporting movement", () => {
    const api = fakeApi();
    initWindowResize(api);
    const g = grip("se");
    g.dispatchEvent(pointer("pointerdown", { screenX: 900, screenY: 700 }));
    g.dispatchEvent(pointer("pointerup", { screenX: 950, screenY: 700 }));
    expect(api.resizeWindowEnd).toHaveBeenCalled();
    api.resizeWindowTo.mockClear();
    g.dispatchEvent(pointer("pointermove", { screenX: 990, screenY: 700 }));
    expect(api.resizeWindowTo).not.toHaveBeenCalled();
  });

  it("ends the drag if the pointer is cancelled mid-gesture", () => {
    const api = fakeApi();
    initWindowResize(api);
    const g = grip("nw");
    g.dispatchEvent(pointer("pointerdown", { screenX: 100, screenY: 100 }));
    g.dispatchEvent(pointer("pointercancel", {}));
    expect(api.resizeWindowEnd).toHaveBeenCalled();
  });

  it("only starts on the primary button, so a right-click near the edge is not a resize", () => {
    const api = fakeApi();
    initWindowResize(api);
    grip("se").dispatchEvent(pointer("pointerdown", { button: 2, screenX: 900, screenY: 700 }));
    expect(api.resizeWindowStart).not.toHaveBeenCalled();
  });

  it("marks the grips no-drag so they are not swallowed by the titlebar drag region", () => {
    initWindowResize(fakeApi());
    for (const g of document.querySelectorAll(".af-resize")) {
      expect(g.classList.contains("no-drag")).toBe(true);
    }
  });
});
