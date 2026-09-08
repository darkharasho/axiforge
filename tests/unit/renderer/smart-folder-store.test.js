/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: { builds: [], folders: [], comps: [], currentFolder: null },
}));

const mod = require("../../../src/renderer/modules/library/smart-folders");
const {
  BUILTIN_SMART_FOLDERS,
  loadSmartFolders,
  listSmartFolders,
  getSmartFolder,
  saveSmartFolder,
  deleteSmartFolder,
  setBuiltinHidden,
} = mod;

let settings;

beforeEach(async () => {
  settings = {};
  global.window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => {
      settings[k] = v;
    }),
  };
  await loadSmartFolders();
});

describe("built-ins", () => {
  test("ships the five seeded rules", () => {
    const ids = BUILTIN_SMART_FOLDERS.map((f) => f.id);
    expect(ids).toEqual([
      "__sf-main",
      "__sf-recent",
      "__sf-shared",
      "__sf-unfiled",
      "__sf-untagged",
    ]);
  });

  test("Main Repository has no conditions, so it matches everything", () => {
    const main = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-main");
    expect(main.rule.children).toEqual([]);
  });

  test("every built-in is flagged builtin", () => {
    expect(BUILTIN_SMART_FOLDERS.every((f) => f.builtin === true)).toBe(true);
  });

  test("listSmartFolders returns them with no user data present", () => {
    expect(listSmartFolders().map((f) => f.id)).toEqual(BUILTIN_SMART_FOLDERS.map((f) => f.id));
  });
});

describe("user smart folders", () => {
  test("save assigns an id and persists", async () => {
    const saved = await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    expect(saved.id).toMatch(/^sf_/);
    expect(settings["library.smartFolders"]).toHaveLength(1);
    expect(listSmartFolders().map((f) => f.name)).toContain("Mine");
  });

  test("save with an existing id updates in place rather than appending", async () => {
    const saved = await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    await saveSmartFolder({ ...saved, name: "Renamed" });
    expect(settings["library.smartFolders"]).toHaveLength(1);
    expect(getSmartFolder(saved.id).name).toBe("Renamed");
  });

  test("user folders sort after built-ins", async () => {
    await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    const list = listSmartFolders();
    expect(list[list.length - 1].name).toBe("Mine");
  });

  test("delete removes it", async () => {
    const saved = await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    await deleteSmartFolder(saved.id);
    expect(listSmartFolders().map((f) => f.id)).not.toContain(saved.id);
    expect(settings["library.smartFolders"]).toEqual([]);
  });
});

describe("hiding built-ins", () => {
  test("a hidden built-in drops out of the list", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    expect(listSmartFolders().map((f) => f.id)).not.toContain("__sf-untagged");
  });

  test("but is still resolvable by id, so a stale navigation can recover", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    expect(getSmartFolder("__sf-untagged")).toBeTruthy();
  });

  test("unhiding restores it", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    await setBuiltinHidden("__sf-untagged", false);
    expect(listSmartFolders().map((f) => f.id)).toContain("__sf-untagged");
  });

  test("only hidden ids are persisted — no dead sort order", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    expect(settings["library.smartFolderOverrides"]).toEqual({ hidden: ["__sf-untagged"] });
  });
});

describe("corrupt settings degrade instead of breaking the library", () => {
  test("a non-array smartFolders setting falls back to built-ins only", async () => {
    settings["library.smartFolders"] = "not an array";
    await loadSmartFolders();
    expect(listSmartFolders().map((f) => f.id)).toEqual(BUILTIN_SMART_FOLDERS.map((f) => f.id));
  });

  test("malformed entries are dropped and valid ones survive", async () => {
    settings["library.smartFolders"] = [
      null,
      { name: "no id" },
      { id: "sf_ok", name: "Good", rule: { type: "group", match: "all", children: [] } },
    ];
    await loadSmartFolders();
    const ids = listSmartFolders().map((f) => f.id);
    expect(ids).toContain("sf_ok");
    expect(ids).toHaveLength(BUILTIN_SMART_FOLDERS.length + 1);
  });

  test("a getSetting rejection still leaves the built-ins usable", async () => {
    global.window.desktopApi.getSetting = jest.fn(async () => {
      throw new Error("no settings store");
    });
    await loadSmartFolders();
    expect(listSmartFolders().map((f) => f.id)).toEqual(BUILTIN_SMART_FOLDERS.map((f) => f.id));
  });
});
