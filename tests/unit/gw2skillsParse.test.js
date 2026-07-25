"use strict";
const { parsePreloadFromHtml } = require("../../src/main/gw2skillsParse.js");

function makeHtml(preloadJs) {
  return `
    <script>
    window.onload = function() {
      var SI = null;
      E = new BuildEditor({
        version: "9.1.2",
        dbid: 1772970067,
        showinfo: SI || undefined,
        preload: ${preloadJs}
      });
      E.init();
    };
    </script>`;
}

describe("parsePreloadFromHtml (acorn core)", () => {
  it("extracts dbid", () => {
    const r = parsePreloadFromHtml(makeHtml(`{ chatlink: "AAAA", mode: "pve", equipment: {} }`));
    expect(r.dbid).toBe("1772970067");
  });
  it("extracts chatlink and mode from an unquoted-key literal", () => {
    const r = parsePreloadFromHtml(makeHtml(`{ chatlink: "DQYfHSkb", mode: "wvw", equipment: { buff: { food: 534, utility: 40 } } }`));
    expect(r.preload.chatlink).toBe("DQYfHSkb");
    expect(r.preload.mode).toBe("wvw");
    expect(r.preload.equipment.buff.food).toBe(534);
  });
  // Real gw2skills preloads use NUMERIC object keys in `skill`/`pet`/etc. — valid
  // JS the old `vm` eval accepted, but JSON5 rejects (this was the live import
  // failure: "JSON5: invalid character '6'"). Verbatim shape from a real page.
  it("parses numeric object keys (the real-build case json5 could not)", () => {
    const r = parsePreloadFromHtml(makeHtml(
      `{ chatlink: "DQMA", mode: "pvp", profession: 7, skill: {t: [{8:1687,6:1589,7:1675,9:1722,10:1743},{}], a: [{},{}]}, trait: [[55,0,0,0],[57,0,0,0]] }`
    ));
    expect(r.preload.chatlink).toBe("DQMA");
    expect(r.preload.skill.t[0]).toEqual({ 6: 1589, 7: 1675, 8: 1687, 9: 1722, 10: 1743 });
    expect(r.preload.trait[0]).toEqual([55, 0, 0, 0]);
  });
  it("parses negative numbers and nested quoted keys", () => {
    const r = parsePreloadFromHtml(makeHtml(
      `{ chatlink: "X", mode: "pve", equipment: { weapon: { "w11": { item: [-1, 0], up: [[46, 0]] } } } }`
    ));
    expect(r.preload.equipment.weapon.w11.item).toEqual([-1, 0]);
  });
  it("tolerates a bare `undefined` value inside preload", () => {
    const r = parsePreloadFromHtml(makeHtml(`{ chatlink: "X", mode: "pve", note: undefined, equipment: {} }`));
    expect(r.preload.chatlink).toBe("X");
    expect(r.preload.note).toBeUndefined();
  });
  it("throws a clear error when preload is absent", () => {
    expect(() => parsePreloadFromHtml(`<script>new BuildEditor({ dbid: 1, showinfo: SI })</script>`))
      .toThrow(/preload/i);
  });
});
