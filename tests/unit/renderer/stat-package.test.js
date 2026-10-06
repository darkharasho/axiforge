"use strict";

const esm = require("../../../src/renderer/modules/stat-package.js");
const cjs = require("../../../src/shared/statPackage");

describe("stat-package parity with src/shared/statPackage", () => {
  test("slot key lists match", () => {
    expect(esm.STAT_SLOT_KEYS).toEqual(cjs.STAT_SLOT_KEYS);
  });

  const cases = [
    [{}, "Minstrel's"],
    [undefined, "Minstrel's"],
    [{ head: "", chest: "" }, "Minstrel's"],
    [{ head: "Berserker's", chest: "" }, "Minstrel's"],
    [{}, ""],
  ];
  test.each(cases)("expandStatPackage agrees for %j / %j", (slots, pkg) => {
    expect(esm.expandStatPackage(slots, pkg)).toEqual(cjs.expandStatPackage(slots, pkg));
  });
});

describe("expandStatPackage", () => {
  test("fills every slot when all are empty", () => {
    const out = cjs.expandStatPackage({}, "Minstrel's");
    expect(Object.keys(out)).toEqual(cjs.STAT_SLOT_KEYS);
    expect(Object.values(out).every((v) => v === "Minstrel's")).toBe(true);
  });

  test("leaves a partially filled build alone", () => {
    const slots = { head: "Berserker's", chest: "" };
    expect(cjs.expandStatPackage(slots, "Minstrel's")).toBe(slots);
  });

  test("no package, no change", () => {
    expect(cjs.expandStatPackage({}, "")).toEqual({});
  });
});
