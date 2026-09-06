"use strict";

// Regression: build.compIds is listed in BUILD_LOCAL_FIELDS (src/main/teamSync.js),
// so it is stripped off every build that crosses team sync. comp.buildIds is not.
// A machine that PULLED a shared comp therefore has comps that know their builds
// and builds that have no idea they are in a comp -- and every count that read
// build.compIds reported 0 for builds plainly sitting in a comp.

jest.mock("../../../src/renderer/modules/state.js", () => ({ state: { comps: [] } }));

const { state } = require("../../../src/renderer/modules/state.js");
const {
  compsContainingBuild,
  compCountForBuild,
  isBuildInAnyComp,
  buildIdsInAnyComp,
} = require("../../../src/renderer/modules/comps/comp-membership.js");

beforeEach(() => {
  state.comps = [];
});

describe("comp membership is read from the comps", () => {
  test("a pulled shared build with no compIds is still counted", () => {
    state.comps = [{ id: "main", name: "Main Zerg", buildIds: ["b1", "b2"] }];
    expect(compCountForBuild("b1")).toBe(1);
    expect(isBuildInAnyComp("b1")).toBe(true);
    expect(compsContainingBuild("b1").map((c) => c.name)).toEqual(["Main Zerg"]);
  });

  test("a build in several comps reports all of them, in state order", () => {
    state.comps = [
      { id: "a", name: "Main Zerg", buildIds: ["b1"] },
      { id: "b", name: "Havoc", buildIds: ["b9"] },
      { id: "c", name: "GvG", buildIds: ["b1", "b9"] },
    ];
    expect(compsContainingBuild("b1").map((c) => c.id)).toEqual(["a", "c"]);
    expect(compCountForBuild("b9")).toBe(2);
  });

  test("a compIds entry pointing at a comp that no longer exists counts for nothing", () => {
    state.comps = [{ id: "live", name: "Live", buildIds: [] }];
    expect(compCountForBuild("b1")).toBe(0);
    expect(isBuildInAnyComp("b1")).toBe(false);
  });

  test("comps with no buildIds at all are handled", () => {
    state.comps = [{ id: "empty", name: "Empty" }];
    expect(compsContainingBuild("b1")).toEqual([]);
  });

  test("a missing build id is not a member of anything", () => {
    state.comps = [{ id: "a", name: "A", buildIds: ["b1"] }];
    expect(compsContainingBuild(null)).toEqual([]);
    expect(compsContainingBuild(undefined)).toEqual([]);
    expect(compCountForBuild("nope")).toBe(0);
  });

  test("buildIdsInAnyComp unions every comp's roster", () => {
    state.comps = [
      { id: "a", name: "A", buildIds: ["b1", "b2"] },
      { id: "b", name: "B", buildIds: ["b2", "b3"] },
      { id: "c", name: "C" },
    ];
    expect([...buildIdsInAnyComp()].sort()).toEqual(["b1", "b2", "b3"]);
  });

  test("an empty library is not an error", () => {
    state.comps = undefined;
    expect(compsContainingBuild("b1")).toEqual([]);
    expect(buildIdsInAnyComp().size).toBe(0);
  });
});
