/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [], folders: [], comps: [], currentFolder: null, buildSearch: "",
    libraryPrefs: { viewMode: "list", sortField: "sortOrder", sortDirection: "asc", activeFilters: {} },
  },
}));

const { filtersToRule } = require("../../../src/renderer/modules/library/toolbar");

describe("filtersToRule", () => {
  test("maps every toolbar filter onto the rule vocabulary", () => {
    const rule = filtersToRule({
      professions: ["Guardian"],
      eliteSpecs: ["Firebrand"],
      gameModes: ["wvw"],
      tags: ["support"],
    });

    expect(rule).toEqual({
      type: "group",
      match: "all",
      children: [
        { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
        { type: "condition", field: "eliteSpec", op: "isAnyOf", value: ["Firebrand"] },
        { type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] },
        { type: "condition", field: "tags", op: "hasAnyOf", value: ["support"] },
      ],
    });
  });

  test("tags become hasAnyOf, matching how the toolbar already behaves", () => {
    const rule = filtersToRule({ tags: ["a", "b"] });
    expect(rule.children[0].op).toBe("hasAnyOf");
  });

  test("empty filter arrays produce no conditions", () => {
    expect(filtersToRule({ professions: [], tags: [] }).children).toEqual([]);
  });

  test("no filters at all produce an empty rule", () => {
    expect(filtersToRule({}).children).toEqual([]);
    expect(filtersToRule(null).children).toEqual([]);
  });
});
