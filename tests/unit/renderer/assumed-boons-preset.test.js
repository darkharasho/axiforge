"use strict";

// "All boons" preset for the Assumed Boons panel (#345).
const { fullBoonPreset } = require("../../../src/renderer/modules/equipment-boons");

test("full preset maxes stacking boons and turns on every toggle boon", () => {
  const preset = fullBoonPreset();
  expect(preset.might).toBe(25);
  expect(preset.stability).toBe(25);
  for (const key of ["fury", "alacrity", "quickness", "protection", "regeneration",
    "resolution", "resistance", "swiftness", "vigor", "aegis"]) {
    expect(preset[key]).toBe(true);
  }
});

test("empty preset clears everything", () => {
  const { emptyBoonPreset } = require("../../../src/renderer/modules/equipment-boons");
  const preset = emptyBoonPreset();
  expect(preset.might).toBe(0);
  expect(preset.stability).toBe(0);
  expect(Object.values(preset).every((v) => !v)).toBe(true);
});
