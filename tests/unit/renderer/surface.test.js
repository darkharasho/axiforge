"use strict";

const {
  SURFACES,
  DEFAULT_SURFACE_ID,
  resolveSurfaceId,
  applySurface,
} = require("../../../src/renderer/modules/accents.js");

// jest.config sets testEnvironment: "node", so <html> is stubbed here rather
// than pulling jsdom in for one file.
function fakeRoot() {
  const attrs = {};
  const classes = new Set();
  return {
    attrs,
    classes,
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
  };
}

let root;

beforeEach(() => {
  root = fakeRoot();
  global.document = { documentElement: root };
});

afterEach(() => {
  delete global.document;
  jest.useRealTimers();
});

test("the three surfaces are axi, flat and glass, in that order", () => {
  expect(SURFACES.map((s) => s.id)).toEqual(["axi", "flat", "glass"]);
  expect(SURFACES.map((s) => s.label)).toEqual(["Axi", "Flat", "Glass"]);
  expect(DEFAULT_SURFACE_ID).toBe("axi");
});

test("resolveSurfaceId passes through the ids the design language defines", () => {
  expect(resolveSurfaceId("axi")).toBe("axi");
  expect(resolveSurfaceId("flat")).toBe("flat");
  expect(resolveSurfaceId("glass")).toBe("glass");
});

test("resolveSurfaceId falls back to axi for anything else", () => {
  expect(resolveSurfaceId(null)).toBe("axi");
  expect(resolveSurfaceId(undefined)).toBe("axi");
  expect(resolveSurfaceId("")).toBe("axi");
  expect(resolveSurfaceId("frosted")).toBe("axi");
  // AxiForge's LEGACY_THEME_TO_ACCENT exists because its share URLs are
  // immutable. There is no such history for the surface, so a legacy accent id
  // is just an unknown value here rather than something to translate.
  expect(resolveSurfaceId("blood_legion")).toBe("axi");
});

test("resolveSurfaceId does not reach the prototype chain", () => {
  expect(resolveSurfaceId("constructor")).toBe("axi");
  expect(resolveSurfaceId("__proto__")).toBe("axi");
  expect(resolveSurfaceId("toString")).toBe("axi");
});

test("applySurface puts a theme on <html>", () => {
  expect(applySurface("glass")).toBe("glass");
  expect(root.attrs["data-axi-theme"]).toBe("glass");
});

test("applySurface treats flat as a theme like any other", () => {
  expect(applySurface("flat")).toBe("flat");
  expect(root.attrs["data-axi-theme"]).toBe("flat");
});

test("applySurface removes the attribute for axi rather than naming the language", () => {
  applySurface("glass");
  expect(applySurface("axi")).toBe("axi");
  expect(root.attrs["data-axi-theme"]).toBeUndefined();
});

test("applySurface crossfades by default", () => {
  applySurface("glass");
  expect(root.classes.has("theme-transitioning")).toBe(true);
});

test("applySurface skips the crossfade when asked, so startup does not flash", () => {
  applySurface("glass", { transition: false });
  expect(root.classes.has("theme-transitioning")).toBe(false);
  expect(root.attrs["data-axi-theme"]).toBe("glass");
});
