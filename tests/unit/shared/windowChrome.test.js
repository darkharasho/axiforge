/**
 * The frameless window's chrome options live here rather than inline in
 * createWindow because two processes need the same answer: main decides whether
 * the window is transparent, and preload has to tell the renderer whether to
 * install its own resize grips. Issue #318 — a transparent window has no native
 * resize border on Linux or Windows, so when main opts into transparency for the
 * rounded corners the app owes the user a replacement.
 */
"use strict";

const {
  WINDOW_MIN,
  windowChromeOptions,
  needsManualResize,
  resizeBounds,
} = require("../../../src/shared/windowChrome.js");

describe("windowChromeOptions", () => {
  it("is transparent on Linux and Windows so the CSS radius has something to show through", () => {
    for (const platform of ["linux", "win32"]) {
      expect(windowChromeOptions(platform)).toMatchObject({
        transparent: true,
        backgroundColor: "#00000000",
      });
    }
  });

  it("is opaque on macOS, which rounds and shadows a frameless window itself", () => {
    const opts = windowChromeOptions("darwin");
    expect(opts.transparent).toBeUndefined();
    expect(opts.backgroundColor).toBe("#050910");
    expect(opts.titleBarStyle).toBe("hidden");
  });

  it("never hands Electron resizable: false — the window is always meant to resize", () => {
    for (const platform of ["linux", "win32", "darwin"]) {
      expect(windowChromeOptions(platform).resizable).not.toBe(false);
    }
  });
});

describe("needsManualResize", () => {
  it("is true exactly when the window is transparent", () => {
    for (const platform of ["linux", "win32", "darwin"]) {
      expect(needsManualResize(platform)).toBe(
        windowChromeOptions(platform).transparent === true,
      );
    }
  });

  it("asks for grips on Linux and Windows and not on macOS", () => {
    expect(needsManualResize("linux")).toBe(true);
    expect(needsManualResize("win32")).toBe(true);
    expect(needsManualResize("darwin")).toBe(false);
  });
});

describe("resizeBounds", () => {
  const START = { x: 100, y: 200, width: 1600, height: 980 };

  it("grows east and south without moving the window's origin", () => {
    expect(resizeBounds(START, "se", 40, 30)).toEqual({
      x: 100,
      y: 200,
      width: 1640,
      height: 1010,
    });
  });

  it("moves the origin when dragging north or west, so the far edge stays put", () => {
    expect(resizeBounds(START, "nw", 40, 30)).toEqual({
      x: 140,
      y: 230,
      width: 1560,
      height: 950,
    });
  });

  it("changes one axis only for a single edge", () => {
    expect(resizeBounds(START, "e", 40, 30)).toEqual({
      x: 100,
      y: 200,
      width: 1640,
      height: 980,
    });
    expect(resizeBounds(START, "n", 40, 30)).toEqual({
      x: 100,
      y: 230,
      width: 1600,
      height: 950,
    });
  });

  it("clamps to the minimum size instead of collapsing", () => {
    const b = resizeBounds(START, "se", -10000, -10000);
    expect(b.width).toBe(WINDOW_MIN.width);
    expect(b.height).toBe(WINDOW_MIN.height);
  });

  it("stops the origin at the point where the minimum is hit when dragging north-west", () => {
    const b = resizeBounds(START, "nw", 10000, 10000);
    expect(b.width).toBe(WINDOW_MIN.width);
    expect(b.height).toBe(WINDOW_MIN.height);
    // The right and bottom edges are the anchor and must not have moved.
    expect(b.x + b.width).toBe(START.x + START.width);
    expect(b.y + b.height).toBe(START.y + START.height);
  });

  it("returns integers — Electron rejects fractional bounds", () => {
    const b = resizeBounds(START, "se", 10.4, 10.6);
    for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
  });

  it("ignores an unknown edge rather than throwing", () => {
    expect(resizeBounds(START, "", 40, 30)).toEqual(START);
  });
});
