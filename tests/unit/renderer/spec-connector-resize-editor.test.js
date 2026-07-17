/**
 * @jest-environment jsdom
 *
 * Spec connector lines must be redrawn whenever the spec panel's box changes —
 * including browser/OS ZOOM, which (unlike window resize) does NOT fire a window
 * 'resize' event. The original #148 fix used window.resize and so missed zoom,
 * leaving the SVG viewBox stale and skewing the lines (bug re-reported for the
 * editor). The robust fix observes each .spec-card__body with a ResizeObserver.
 *
 * The connector geometry needs real layout (getBoundingClientRect), which jsdom
 * does not provide, so we verify the WIRING: a size change schedules a redraw,
 * and observing the same body twice does not stack observers.
 */

const { observeSpecConnector } = require("../../../src/renderer/modules/specializations.js");

let roCallbacks;
let observeCalls;

beforeEach(() => {
  roCallbacks = [];
  observeCalls = [];
  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; roCallbacks.push(cb); }
    observe(el) { observeCalls.push(el); }
    disconnect() {}
  };
});

afterEach(() => {
  delete global.ResizeObserver;
  jest.restoreAllMocks();
});

test("observeSpecConnector observes the body and schedules a redraw on resize", () => {
  const rafSpy = jest.spyOn(global, "requestAnimationFrame").mockReturnValue(1);
  const body = document.createElement("div");

  observeSpecConnector(body);
  expect(observeCalls).toContain(body);

  // Simulate a size change (window resize OR zoom reflow).
  roCallbacks[0]([{ target: body }]);
  expect(rafSpy).toHaveBeenCalled();
});

test("observeSpecConnector is idempotent — one observer per body", () => {
  const body = document.createElement("div");
  observeSpecConnector(body);
  observeSpecConnector(body);
  expect(observeCalls.filter((el) => el === body)).toHaveLength(1);
});

test("observeSpecConnector no-ops without ResizeObserver (jsdom-guarded)", () => {
  delete global.ResizeObserver;
  const body = document.createElement("div");
  expect(() => observeSpecConnector(body)).not.toThrow();
});
