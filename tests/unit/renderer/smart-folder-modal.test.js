/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [], folders: [], comps: [], currentFolder: null, buildSearch: "",
    libraryPrefs: { viewMode: "list", sortField: "sortOrder", sortDirection: "asc", activeFilters: {} },
    teams: [],
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const {
  initSmartFolderModal,
  openSmartFolderModal,
  closeSmartFolderModal,
  FIELD_DEFS,
} = require("../../../src/renderer/modules/library/smart-folder-modal");
const { loadSmartFolders, getSmartFolder } = require("../../../src/renderer/modules/library/smart-folders");

function makeBuild(o = {}) {
  return {
    id: "b1", title: "Zerg Firebrand", profession: "Guardian", gameMode: "wvw",
    folderId: null, tags: ["wvw"], pinned: false, sortOrder: 0,
    specializations: [{ name: "Firebrand", elite: true }],
    updatedAt: "2026-09-01T00:00:00Z", ...o,
  };
}

let settings, onSaved;

beforeEach(async () => {
  settings = {};
  global.window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => { settings[k] = v; }),
  };
  await loadSmartFolders();
  document.body.innerHTML = "";
  state.builds = [makeBuild({ id: "b1", gameMode: "wvw" }), makeBuild({ id: "b2", gameMode: "pve" })];
  state.folders = [];
  state.teams = [];
  onSaved = jest.fn();
  initSmartFolderModal({ onSaved, onDeleted: jest.fn() });
});

afterEach(() => closeSmartFolderModal());

const $ = (sel) => document.querySelector(sel);

/**
 * Flush the real save promise chain -- click -> _handleSave -> saveSmartFolder
 * -> persistFolders -> window.desktopApi.setSetting -- rather than assuming a
 * fixed number of microtask ticks, which is an implementation detail of how
 * deeply that chain happens to be nested today.
 */
async function flushAsync() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("field definitions", () => {
  test("every field the evaluator supports is offered", () => {
    expect(FIELD_DEFS.map((f) => f.field).sort()).toEqual(
      ["createdAt", "eliteSpec", "gameMode", "location", "notes", "ownership", "pinned", "profession", "tags", "team", "title", "updatedAt"].sort(),
    );
  });

  test("value-less operators are marked so no input renders", () => {
    const tags = FIELD_DEFS.find((f) => f.field === "tags");
    expect(tags.ops.find((o) => o.op === "isEmpty").valueKind).toBe("none");
  });

  test("date operators take a number", () => {
    const updated = FIELD_DEFS.find((f) => f.field === "updatedAt");
    expect(updated.ops.every((o) => o.valueKind === "number")).toBe(true);
  });
});

describe("opening", () => {
  test("a new folder starts with one empty condition row", () => {
    openSmartFolderModal(null);
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(1);
    expect($("#sfm-name").value).toBe("");
  });

  test("an existing folder is loaded into the form", () => {
    openSmartFolderModal({
      id: "sf_x", name: "WvW", icon: "funnel",
      rule: { type: "group", match: "any", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    expect($("#sfm-name").value).toBe("WvW");
    expect($("#sfm-match").value).toBe("any");
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(1);
  });

  // This is the path the toolbar's "Save as smart folder" button uses:
  // filtersToRule() builds a rule but no id, so the record opens as a new,
  // unsaved folder pre-filled with that rule rather than as an edit.
  test("a record without an id opens as a new folder, pre-filled with its rule", () => {
    openSmartFolderModal({
      name: "", icon: "funnel",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    expect($("#sfm-title").textContent).toBe("New Smart Folder");
    expect($("#sfm-name").value).toBe("");
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(1);
    expect($('[data-cond-index="0"] [data-cond-field]').value).toBe("gameMode");
    expect($('[data-cond-index="0"] [data-cond-op]').value).toBe("isAnyOf");
    expect($("#sfm-delete")).toBeNull();
  });
});

describe("live match count", () => {
  test("reflects the current rule", () => {
    openSmartFolderModal({
      id: "sf_x", name: "WvW",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    expect($("#sfm-count").textContent).toContain("1");
    expect($("#sfm-total").textContent).toContain("2");
  });

  test("updates when a condition changes", () => {
    openSmartFolderModal({
      id: "sf_x", name: "WvW",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    const opSel = $('[data-cond-index="0"] [data-cond-op]');
    opSel.value = "isNoneOf";
    opSel.dispatchEvent(new Event("change", { bubbles: true }));
    expect($("#sfm-count").textContent).toContain("1");
  });

  test("an empty rule matches everything", () => {
    openSmartFolderModal({ id: "sf_x", name: "All", rule: { type: "group", match: "all", children: [] } });
    expect($("#sfm-count").textContent).toContain("2");
  });
});

describe("editing conditions", () => {
  test("add condition appends a row", () => {
    openSmartFolderModal(null);
    $("#sfm-add-cond").click();
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(2);
  });

  test("remove drops the row", () => {
    openSmartFolderModal(null);
    $("#sfm-add-cond").click();
    $('[data-cond-index="0"] [data-cond-remove]').click();
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(1);
  });

  test("changing the field resets the operator and value", () => {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "title", op: "contains", value: "zerg" }] },
    });
    const fieldSel = $('[data-cond-index="0"] [data-cond-field]');
    fieldSel.value = "pinned";
    fieldSel.dispatchEvent(new Event("change", { bubbles: true }));

    expect($('[data-cond-index="0"] [data-cond-op]').value).toBe("isTrue");
    expect($('[data-cond-index="0"] [data-cond-value]')).toBeNull();
  });

  test("negative operators mark the row so exclusions are legible", () => {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "tags", op: "hasNoneOf", value: ["retired"] }] },
    });
    expect($('[data-cond-index="0"]').classList.contains("sfm-cond--negative")).toBe(true);
  });

  test("ownership field offers exactly the two ownership values", () => {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "ownership", op: "is", value: "mine" }] },
    });
    const valueSel = $('[data-cond-index="0"] [data-cond-value]');
    expect(valueSel).toBeTruthy();
    const values = [...valueSel.options].map((o) => o.value);
    expect(values.sort()).toEqual(["mine", "sharedWithMe"]);
  });

  test("team field offers the user's teams", () => {
    state.teams = [
      { team: { id: "t1", name: "Guild One", seq: 1 }, role: "owner" },
      { team: { id: "t2", name: "Guild Two", seq: 2 }, role: "member" },
    ];
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "team", op: "isAnyOf", value: ["t1"] }] },
    });
    const valueSel = $('[data-cond-index="0"] [data-cond-value]');
    expect(valueSel).toBeTruthy();
    const options = [...valueSel.options].map((o) => ({ value: o.value, label: o.textContent }));
    expect(options).toEqual([
      { value: "t1", label: "Guild One" },
      { value: "t2", label: "Guild Two" },
    ]);
  });
});

describe("saving", () => {
  test("persists and reports the saved folder", async () => {
    openSmartFolderModal(null);
    $("#sfm-name").value = "Mine";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-save").click();
    await flushAsync();

    expect(onSaved).toHaveBeenCalled();
    expect(settings["library.smartFolders"][0].name).toBe("Mine");
  });

  test("refuses to save without a name", async () => {
    openSmartFolderModal(null);
    $("#sfm-save").click();
    await Promise.resolve();

    expect(onSaved).not.toHaveBeenCalled();
    expect($("#sfm-status").textContent).toMatch(/name/i);
  });

  test("incomplete condition rows are dropped rather than saved as broken rules", async () => {
    openSmartFolderModal(null);
    $("#sfm-name").value = "Mine";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-save").click();
    await flushAsync();

    expect(settings["library.smartFolders"][0].rule.children).toEqual([]);
  });

  test("a settings write failure keeps the modal open and reports the error", async () => {
    global.window.desktopApi.setSetting = jest.fn(async () => {
      throw new Error("disk full");
    });
    openSmartFolderModal(null);
    $("#sfm-name").value = "Mine";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-save").click();
    await flushAsync();

    expect(onSaved).not.toHaveBeenCalled();
    expect($("#sfm-status").textContent).toMatch(/disk full/i);
    // The modal stayed open -- closeSmartFolderModal() would have re-added
    // this class, so its absence is proof the failure did not close it.
    expect($(".sfm-overlay").classList.contains("sfm-overlay--hidden")).toBe(false);
    expect($("#sfm-name").value).toBe("Mine");
  });

  test("cancel persists nothing", async () => {
    openSmartFolderModal(null);
    $("#sfm-name").value = "Mine";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-cancel").click();
    await Promise.resolve();

    expect(settings["library.smartFolders"]).toBeUndefined();
  });
});

describe("delete", () => {
  test("is offered only for an existing user folder", () => {
    openSmartFolderModal(null);
    expect($("#sfm-delete")).toBeNull();

    closeSmartFolderModal();
    openSmartFolderModal({ id: "sf_x", name: "X", rule: { type: "group", match: "all", children: [] } });
    expect($("#sfm-delete")).toBeTruthy();
  });

  test("is not offered for a built-in", () => {
    closeSmartFolderModal();
    openSmartFolderModal(getSmartFolder("__sf-main"));
    expect($("#sfm-delete")).toBeNull();
  });
});
