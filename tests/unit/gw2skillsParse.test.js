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

describe("parsePreloadFromHtml (json5 core)", () => {
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
  it("tolerates a bare `undefined` value inside preload", () => {
    const r = parsePreloadFromHtml(makeHtml(`{ chatlink: "X", mode: "pve", note: undefined, equipment: {} }`));
    expect(r.preload.chatlink).toBe("X");
    expect(r.preload.note).toBeNull();
  });
  it("throws a clear error when preload is absent", () => {
    expect(() => parsePreloadFromHtml(`<script>new BuildEditor({ dbid: 1, showinfo: SI })</script>`))
      .toThrow(/preload/i);
  });
});
