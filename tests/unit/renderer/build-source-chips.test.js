"use strict";

// The chips are the quick-glance half of build sources. Their whole value is in
// what they DON'T draw: a chip on every card is wallpaper, a chip only on the
// builds that come from somewhere else is a signal. These tests pin the silence
// as hard as the markup.

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { builds: [], comps: [], folders: [] },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const {
  foreignFolderChipHtml,
  buildUsageChipHtml,
  compSourceBadgeHtml,
} = require("../../../src/renderer/modules/build-source-chips.js");

beforeEach(() => {
  state.builds = [];
  state.comps = [];
  state.folders = [
    { id: "wvw", name: "WvW", parentId: null },
    { id: "zerg", name: "Zerg", parentId: "wvw" },
    { id: "support", name: "Support", parentId: "zerg" },
    { id: "guild", name: "Guild", parentId: null },
  ];
});

describe("foreignFolderChipHtml — comp side", () => {
  test("a build in the comp's own folder draws nothing", () => {
    const comp = { id: "c1", folderId: "zerg", buildIds: ["b1"] };
    expect(foreignFolderChipHtml({ id: "b1", folderId: "zerg" }, comp)).toBe("");
  });

  test("a build from elsewhere shows its leaf folder and the full path on hover", () => {
    const comp = { id: "c1", folderId: "zerg", buildIds: ["b1"] };
    const html = foreignFolderChipHtml({ id: "b1", folderId: "support" }, comp);
    expect(html).toContain("Support");
    expect(html).toContain('title="WvW / Zerg / Support"');
    expect(html).toContain("src-chip--foreign");
  });

  test("the chip carries the ids the click handler needs", () => {
    const comp = { id: "c1", folderId: "zerg", buildIds: ["b1"] };
    const html = foreignFolderChipHtml({ id: "b1", folderId: "guild" }, comp);
    expect(html).toContain('data-src-build="b1"');
    expect(html).toContain('data-src-comp="c1"');
  });

  // A build at the library root inside a foldered comp IS from somewhere else,
  // but its leaf name is "" -- an unlabelled chip reads as a rendering bug.
  test("a build at the library root is named, not blank", () => {
    const comp = { id: "c1", folderId: "zerg", buildIds: ["b1"] };
    const html = foreignFolderChipHtml({ id: "b1", folderId: null }, comp);
    expect(html).toContain("Library root");
  });

  test("folder names are escaped", () => {
    state.folders = [{ id: "x", name: '<img src=x onerror="alert(1)">', parentId: null }];
    const html = foreignFolderChipHtml({ id: "b1", folderId: "x" }, { id: "c1", folderId: "zerg" });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("buildUsageChipHtml — library side", () => {
  test("a build in no comp draws nothing", () => {
    expect(buildUsageChipHtml({ id: "b1", folderId: "zerg" })).toBe("");
  });

  test("comps in the build's own folder get the quiet chip", () => {
    state.comps = [{ id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] }];
    const html = buildUsageChipHtml({ id: "b1", folderId: "zerg" });
    expect(html).toContain("1 comp");
    expect(html).toContain("src-chip--local");
    expect(html).not.toContain("src-chip--external");
  });

  test("a comp living elsewhere makes the chip loud", () => {
    state.comps = [
      { id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] },
      { id: "c2", name: "Guild Raid", folderId: "guild", buildIds: ["b1"] },
    ];
    const html = buildUsageChipHtml({ id: "b1", folderId: "zerg" });
    expect(html).toContain("2 comps");
    expect(html).toContain("src-chip--external");
  });

  test("the tooltip names every comp and where it lives", () => {
    state.comps = [
      { id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] },
      { id: "c2", name: "Guild Raid", folderId: "guild", buildIds: ["b1"] },
    ];
    const html = buildUsageChipHtml({ id: "b1", folderId: "zerg" });
    expect(html).toContain("Zerg Frontline — WvW / Zerg");
    expect(html).toContain("Guild Raid — Guild");
  });

  test("a comp with no name still reads as something", () => {
    state.comps = [{ id: "c1", folderId: "zerg", buildIds: ["b1"] }];
    expect(buildUsageChipHtml({ id: "b1", folderId: "zerg" })).toContain("Untitled Comp");
  });

  // Grid, icon and table rows have no room for "3 comps"; the glyph plus the
  // count plus the tooltip carries it.
  test("compact mode drops the word but keeps the count and the tooltip", () => {
    state.comps = [{ id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] }];
    const html = buildUsageChipHtml({ id: "b1", folderId: "zerg" }, { compact: true });
    expect(html).toContain(">1<");
    expect(html).not.toContain("1 comp<");
    expect(html).toContain("Zerg Frontline");
  });

  // A bare digit next to a role badge reads as a stray number rather than a
  // count of comps, so compact must still carry the comp glyph.
  test("compact mode is never a bare number -- it keeps the comp glyph", () => {
    state.comps = [{ id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] }];
    const html = buildUsageChipHtml({ id: "b1", folderId: "zerg" }, { compact: true });
    expect(html).toContain("<svg");
    expect(html).toContain("src-chip--compact");
  });

  test("comp names are escaped", () => {
    state.comps = [{ id: "c1", name: '"><script>x</script>', folderId: "zerg", buildIds: ["b1"] }];
    const html = buildUsageChipHtml({ id: "b1", folderId: "zerg" });
    expect(html).not.toContain("<script>");
  });
});

describe("compSourceBadgeHtml — the comp row in the library", () => {
  beforeEach(() => {
    state.builds = [
      { id: "b1", title: "Firebrand", folderId: "support" },
      { id: "b2", title: "Scourge", folderId: "zerg" },
    ];
  });

  test("a comp drawing only on its own folder shows the plain count", () => {
    const html = compSourceBadgeHtml({ id: "c1", folderId: "zerg", buildIds: ["b2"] });
    expect(html).toContain("1 build");
    expect(html).not.toContain("external");
  });

  test("a comp reaching outside says how far", () => {
    const html = compSourceBadgeHtml({ id: "c1", folderId: "zerg", buildIds: ["b1", "b2"] });
    expect(html).toContain("2 builds");
    expect(html).toContain("1 external");
    expect(html).toContain('data-src-comp="c1"');
  });

  test("an empty comp still renders a count", () => {
    expect(compSourceBadgeHtml({ id: "c1", folderId: "zerg", buildIds: [] })).toContain("0 builds");
  });

  // Phantom ids must not inflate the count -- see compSources().
  test("a buildId with no build behind it is not counted", () => {
    const html = compSourceBadgeHtml({ id: "c1", folderId: "zerg", buildIds: ["b2", "ghost"] });
    expect(html).toContain("1 build");
  });
});
