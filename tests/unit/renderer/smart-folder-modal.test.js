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
const {
  loadSmartFolders, getSmartFolder, listSmartFolders, matchesSmartFolder, ruleContext,
  SUPPORTED_FIELDS,
} = require("../../../src/renderer/modules/library/smart-folders");

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
    // Against the evaluator itself, not a hand-copied list: a field offered
    // here that the evaluator does not know silently matches nothing.
    expect(FIELD_DEFS.map((f) => f.field).sort()).toEqual([...SUPPORTED_FIELDS].sort());
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

  test("ownership field offers exactly the three ownership values", () => {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "ownership", op: "is", value: "personal" }] },
    });
    const valueSel = $('[data-cond-index="0"] [data-cond-value]');
    expect(valueSel).toBeTruthy();
    const values = [...valueSel.options].map((o) => o.value);
    expect(values.sort()).toEqual(["personal", "sharedByMe", "sharedWithMe"]);
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
    const list = $('[data-cond-index="0"] [data-cond-value]');
    expect(list).toBeTruthy();
    const options = [...list.querySelectorAll("[data-opt-value]")].map((o) => ({
      value: o.dataset.optValue,
      label: o.querySelector(".sfm-opt__label").textContent,
      on: o.getAttribute("aria-selected"),
    }));
    expect(options).toEqual([
      { value: "t1", label: "Guild One", on: "true" },
      { value: "t2", label: "Guild Two", on: "false" },
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

// A `change` event on a *value* control is the path no test drove before, and
// it is the one real users take: type a number, then blur or click Save.
describe("condition value controls", () => {
  function openWithUpdatedWithin() {
    openSmartFolderModal({
      id: "sf_x", name: "Recent",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "updatedAt", op: "withinDays", value: 14 }] },
    });
    return $('[data-cond-index="0"] [data-cond-value]');
  }

  test("a number value survives a change event as a number, and stays on screen", () => {
    const input = openWithUpdatedWithin();
    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const after = $('[data-cond-index="0"] [data-cond-value]');
    expect(after.value).toBe("30");
  });

  test("a number typed then saved persists as a number the evaluator accepts", async () => {
    openWithUpdatedWithin();
    $("#sfm-name").value = "Recent";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    const input = $('[data-cond-index="0"] [data-cond-value]');
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    $("#sfm-save").click();
    await flushAsync();

    const persisted = settings["library.smartFolders"][0];
    expect(persisted.rule.children).toEqual([
      { type: "condition", field: "updatedAt", op: "withinDays", value: 30 },
    ]);
  });

  // The first Save click after typing used to be swallowed: the change handler
  // re-rendered the body, so the button the user pressed was gone by mouseup.
  test("the Save button clicked right after typing still saves", async () => {
    openWithUpdatedWithin();
    $("#sfm-name").value = "Recent";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    const saveBtn = $("#sfm-save");
    const input = $('[data-cond-index="0"] [data-cond-value]');
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Blur fires `change` before the click lands.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    saveBtn.click();
    await flushAsync();

    expect(onSaved).toHaveBeenCalled();
  });

  test("a text value typed then blurred keeps the Save button alive too", async () => {
    openSmartFolderModal({
      id: "sf_t", name: "Titles",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "title", op: "contains", value: "" }] },
    });
    $("#sfm-name").value = "Titles";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    const saveBtn = $("#sfm-save");
    const input = $('[data-cond-index="0"] [data-cond-value]');
    input.value = "zerg";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    saveBtn.click();
    await flushAsync();

    expect(settings["library.smartFolders"][0].rule.children[0].value).toBe("zerg");
  });

  test("the live count still updates when a value changes", () => {
    openSmartFolderModal({
      id: "sf_t", name: "Titles",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "title", op: "contains", value: "" }] },
    });
    const input = $('[data-cond-index="0"] [data-cond-value]');
    input.value = "nothing matches this";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect($("#sfm-count").textContent).toBe("0");
  });

  test("a shape-mismatched value is not saved as a broken rule", async () => {
    openSmartFolderModal({
      id: "sf_x", name: "Recent",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "updatedAt", op: "withinDays", value: "30" }] },
    });
    $("#sfm-name").value = "Recent";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-save").click();
    await flushAsync();

    expect(settings["library.smartFolders"][0].rule.children).toEqual([]);
  });
});

// The round trip the branch never covered: save through the modal, read the
// record back out of the store, and evaluate it against the library.
describe("round trip through the store", () => {
  test("a rule saved in the modal matches builds when evaluated", async () => {
    openSmartFolderModal({
      name: "", icon: "funnel",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "updatedAt", op: "withinDays", value: 14 }] },
    });
    $("#sfm-name").value = "Recent";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    const input = $('[data-cond-index="0"] [data-cond-value]');
    input.value = "3650";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    $("#sfm-save").click();
    await flushAsync();

    const stored = listSmartFolders().find((f) => f.name === "Recent");
    expect(stored).toBeTruthy();
    const ctx = ruleContext();
    const matched = state.builds.filter((b) => matchesSmartFolder(stored, b, ctx));
    expect(matched).toHaveLength(2);
  });
});

/**
 * The multi-valued controls are toggle buttons rather than a native
 * `<select multiple>`: an `<option>` cannot carry a profession icon, and a
 * ctrl-click listbox loses the whole selection on one stray click.
 */
describe("multi-value option lists", () => {
  function openTags(value = []) {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "tags", op: "hasAnyOf", value }] },
    });
    return $('[data-cond-index="0"] [data-cond-value]');
  }

  test("clicking an option turns it on, and clicking it again turns it off", () => {
    const list = openTags();
    const wvw = list.querySelector('[data-opt-value="wvw"]');

    wvw.click();
    expect(wvw.getAttribute("aria-selected")).toBe("true");
    expect(wvw.classList.contains("sfm-opt--on")).toBe(true);

    wvw.click();
    expect(wvw.getAttribute("aria-selected")).toBe("false");
    expect(wvw.classList.contains("sfm-opt--on")).toBe(false);
  });

  test("toggling edits the list in place -- a long spec list must not scroll back to the top", () => {
    const list = openTags();
    const wvw = list.querySelector('[data-opt-value="wvw"]');
    wvw.click();
    expect($('[data-cond-index="0"] [data-cond-value]')).toBe(list);
  });

  test("a toggled option reaches the saved rule", async () => {
    openTags();
    $('[data-cond-index="0"] [data-opt-value="wvw"]').click();
    $("#sfm-name").value = "WvW";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-save").click();
    await flushAsync();

    expect(onSaved).toHaveBeenCalled();
    expect(getSmartFolder(onSaved.mock.calls[0][0].id).rule.children[0].value).toEqual(["wvw"]);
  });

  test("profession options carry the class icon", () => {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "profession", op: "isAnyOf", value: [] }] },
    });
    const opt = $('[data-cond-index="0"] [data-opt-value="Guardian"]');
    expect(opt.querySelector(".sfm-opt__icon")).toBeTruthy();
  });

  test("a field with nothing to choose from says so instead of rendering an empty box", () => {
    state.teams = [];
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "team", op: "isAnyOf", value: [] }] },
    });
    const list = $('[data-cond-index="0"] [data-cond-value]');
    expect(list.querySelector(".sfm-opts__empty")).toBeTruthy();
    expect(list.querySelector("[data-opt-value]")).toBeNull();
  });
});

/**
 * Loadout fields harvest their options differently: weapons and stats from
 * what the library actually holds (so the list stays short and every entry
 * can match something), armor weight from the fixed three.
 */
describe("loadout field options", () => {
  function optionsFor(field, op) {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field, op, value: [] }] },
    });
    return [...document.querySelectorAll('[data-cond-index="0"] [data-opt-value]')].map((o) => ({
      value: o.dataset.optValue,
      label: o.querySelector(".sfm-opt__label").textContent,
    }));
  }

  test("weapons list only what the library equips, in catalog order", () => {
    state.builds = [
      makeBuild({ id: "b1", equipment: { weapons: { mainhand1: "staff", offhand1: "" } } }),
      makeBuild({ id: "b2", equipment: { weapons: { mainhand1: "axe", offhand1: "focus" } } }),
    ];
    expect(optionsFor("weapons", "hasAnyOf")).toEqual([
      { value: "axe", label: "Axe" },
      { value: "focus", label: "Focus" },
      { value: "staff", label: "Staff" },
    ]);
  });

  test("stats list the prefixes in use, skipping legacy numeric ids", () => {
    state.builds = [
      makeBuild({ id: "b1", equipment: { statPackage: "Berserker's", slots: { head: "Assassin's" } } }),
      makeBuild({ id: "b2", equipment: { statPackage: "161", slots: {} } }),
    ];
    expect(optionsFor("stats", "hasAnyOf").map((o) => o.value)).toEqual(["Assassin's", "Berserker's"]);
  });

  test("armor weight offers the fixed three even when the library holds none", () => {
    state.builds = [];
    expect(optionsFor("armorWeight", "isAnyOf")).toEqual([
      { value: "light", label: "Light" },
      { value: "medium", label: "Medium" },
      { value: "heavy", label: "Heavy" },
    ]);
  });
});
