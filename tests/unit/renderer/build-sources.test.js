"use strict";

// A comp in folder A can hold builds that live in folder B. Nothing in the UI
// said so, so "where did this build come from" meant opening the library and
// hunting. build-sources.js is the single resolver both sides read: the comp
// side asks "which of my builds come from elsewhere", the library side asks
// "which comps use this build, and do they live elsewhere".

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { builds: [], comps: [], folders: [] },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const {
  folderChain,
  folderPathText,
  buildUsage,
  compSources,
} = require("../../../src/renderer/modules/build-sources.js");

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

describe("folderChain", () => {
  test("returns the ancestors root-first", () => {
    expect(folderChain("support").map((f) => f.id)).toEqual(["wvw", "zerg", "support"]);
  });

  test("a root folder is a chain of one", () => {
    expect(folderChain("wvw").map((f) => f.id)).toEqual(["wvw"]);
  });

  test("no folder id (a build at the library root) is an empty chain", () => {
    expect(folderChain(null)).toEqual([]);
    expect(folderChain(undefined)).toEqual([]);
    expect(folderChain("")).toEqual([]);
  });

  // A folderId can outlive its folder: the folder is trashed, or a partial team
  // sync brings a build before the folder it points at.
  test("an id with no matching folder yields an empty chain rather than throwing", () => {
    expect(folderChain("deleted-folder")).toEqual([]);
  });

  test("a folder whose parent is missing still reports the folders it can reach", () => {
    state.folders = [{ id: "orphan", name: "Orphan", parentId: "gone" }];
    expect(folderChain("orphan").map((f) => f.name)).toEqual(["Orphan"]);
  });

  // Hand-edited folders.json or a bad sync merge can point two folders at each
  // other. Walking that without a guard hangs the renderer.
  test("a parent cycle terminates instead of looping forever", () => {
    state.folders = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    expect(folderChain("a").map((f) => f.id)).toEqual(["b", "a"]);
  });
});

describe("folderPathText", () => {
  test("joins the chain with the default separator", () => {
    expect(folderPathText("support")).toBe("WvW / Zerg / Support");
  });

  test("honours a custom separator", () => {
    expect(folderPathText("support", " › ")).toBe("WvW › Zerg › Support");
  });

  test("an unresolvable folder is the empty string, not 'undefined'", () => {
    expect(folderPathText(null)).toBe("");
    expect(folderPathText("deleted-folder")).toBe("");
  });
});

describe("buildUsage — the library side: who uses this build", () => {
  test("a build in no comp reports nothing to show", () => {
    state.comps = [{ id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["other"] }];
    const usage = buildUsage({ id: "b1", folderId: "zerg" });
    expect(usage.count).toBe(0);
    expect(usage.hasExternal).toBe(false);
    expect(usage.entries).toEqual([]);
  });

  test("a comp in the build's own folder is not external", () => {
    state.comps = [{ id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] }];
    const usage = buildUsage({ id: "b1", folderId: "zerg" });
    expect(usage.count).toBe(1);
    expect(usage.hasExternal).toBe(false);
    expect(usage.entries[0]).toMatchObject({
      isExternal: false,
      folderPath: "WvW / Zerg",
    });
    expect(usage.entries[0].comp.id).toBe("c1");
  });

  test("a comp in a different folder is external and lifts hasExternal", () => {
    state.comps = [
      { id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] },
      { id: "c2", name: "Guild Raid", folderId: "guild", buildIds: ["b1"] },
    ];
    const usage = buildUsage({ id: "b1", folderId: "zerg" });
    expect(usage.count).toBe(2);
    expect(usage.hasExternal).toBe(true);
    expect(usage.entries.map((e) => e.isExternal)).toEqual([false, true]);
    expect(usage.entries[1].folderPath).toBe("Guild");
  });

  // Both at the root is the same place, so it must not read as external.
  test("a rootless build in a rootless comp is not external", () => {
    state.comps = [{ id: "c1", name: "Loose", folderId: null, buildIds: ["b1"] }];
    const usage = buildUsage({ id: "b1", folderId: null });
    expect(usage.hasExternal).toBe(false);
    expect(usage.entries[0].folderPath).toBe("");
  });

  test("a rootless build used by a foldered comp is external", () => {
    state.comps = [{ id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] }];
    expect(buildUsage({ id: "b1", folderId: null }).hasExternal).toBe(true);
  });

  test("no build, or a build with no id, resolves to empty rather than throwing", () => {
    expect(buildUsage(null).count).toBe(0);
    expect(buildUsage({}).count).toBe(0);
  });
});

describe("compSources — the comp side: where do my builds come from", () => {
  beforeEach(() => {
    state.builds = [
      { id: "b1", title: "Firebrand", folderId: "support" },
      { id: "b2", title: "Scourge", folderId: "zerg" },
      { id: "b3", title: "Druid", folderId: "guild" },
    ];
  });

  test("a build outside the comp's folder is flagged, one inside is not", () => {
    const comp = { id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1", "b2"] };
    const { rows, externalCount, total } = compSources(comp);
    expect(total).toBe(2);
    expect(externalCount).toBe(1);
    expect(rows.map((r) => r.isExternal)).toEqual([true, false]);
    expect(rows[0]).toMatchObject({
      folderPath: "WvW / Zerg / Support",
      leafName: "Support",
      isExternal: true,
    });
    // A build sitting in the comp's own folder needs no path — the chip is silent.
    expect(rows[1].leafName).toBe("Zerg");
  });

  test("rows follow comp.buildIds order, not state.builds order", () => {
    const comp = { id: "c1", folderId: "zerg", buildIds: ["b3", "b1"] };
    expect(compSources(comp).rows.map((r) => r.build.id)).toEqual(["b3", "b1"]);
  });

  // A comp can list a build that no longer exists (deleted while a shared comp
  // still references it). Counting it as a source would report a phantom row.
  test("a buildId with no build behind it is skipped", () => {
    const comp = { id: "c1", folderId: "zerg", buildIds: ["b1", "ghost"] };
    const { rows, total } = compSources(comp);
    expect(total).toBe(1);
    expect(rows.map((r) => r.build.id)).toEqual(["b1"]);
  });

  test("each row carries the other comps that share the build", () => {
    state.comps = [
      { id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1"] },
      { id: "c2", name: "Guild Raid", folderId: "guild", buildIds: ["b1"] },
    ];
    const rows = compSources(state.comps[0]).rows;
    expect(rows[0].otherComps.map((e) => e.comp.name)).toEqual(["Guild Raid"]);
    expect(rows[0].otherComps[0].folderPath).toBe("Guild");
  });

  test("an empty or absent comp resolves to empty rather than throwing", () => {
    expect(compSources(null).total).toBe(0);
    expect(compSources({ id: "c1", folderId: "zerg" }).rows).toEqual([]);
  });
});
