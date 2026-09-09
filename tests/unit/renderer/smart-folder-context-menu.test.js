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

const { initContextMenu, showSmartFolderMenu, closeMenu } = require("../../../src/renderer/modules/library/context-menu");
const { loadSmartFolders, getSmartFolder } = require("../../../src/renderer/modules/library/smart-folders");

let cb;

beforeEach(async () => {
  global.window.desktopApi = {
    getSetting: jest.fn(async () => null),
    setSetting: jest.fn(async () => {}),
  };
  await loadSmartFolders();
  document.body.innerHTML = "";
  cb = {
    onEditSmartFolder: jest.fn(),
    onRenameSmartFolder: jest.fn(),
    onDuplicateSmartFolder: jest.fn(),
    onDeleteSmartFolder: jest.fn(),
    onHideSmartFolder: jest.fn(),
  };
  initContextMenu(cb);
});

afterEach(() => closeMenu());

const labels = () =>
  [...document.querySelectorAll(".lib-ctx-item")].map((e) => e.textContent.trim());

describe("built-in menu", () => {
  test("offers duplicate and hide, but not edit or delete", () => {
    showSmartFolderMenu(10, 10, getSmartFolder("__sf-shared"));
    const l = labels();
    expect(l.some((t) => /duplicate/i.test(t))).toBe(true);
    expect(l.some((t) => /hide/i.test(t))).toBe(true);
    expect(l.some((t) => /^edit/i.test(t))).toBe(false);
    expect(l.some((t) => /delete/i.test(t))).toBe(false);
  });

  test("hide reports the built-in id", () => {
    showSmartFolderMenu(10, 10, getSmartFolder("__sf-untagged"));
    document.querySelectorAll(".lib-ctx-item").forEach((el) => {
      if (/hide/i.test(el.textContent)) el.click();
    });
    expect(cb.onHideSmartFolder).toHaveBeenCalledWith("__sf-untagged");
  });
});

describe("user menu", () => {
  const mine = {
    id: "sf_x", name: "Mine", builtin: false,
    rule: { type: "group", match: "all", children: [] },
  };

  test("offers the full set", () => {
    showSmartFolderMenu(10, 10, mine);
    const l = labels();
    expect(l.some((t) => /^edit/i.test(t))).toBe(true);
    expect(l.some((t) => /rename/i.test(t))).toBe(true);
    expect(l.some((t) => /duplicate/i.test(t))).toBe(true);
    expect(l.some((t) => /delete/i.test(t))).toBe(true);
    expect(l.some((t) => /hide/i.test(t))).toBe(false);
  });

  test("edit reports the record", () => {
    showSmartFolderMenu(10, 10, mine);
    document.querySelectorAll(".lib-ctx-item").forEach((el) => {
      if (/^edit/i.test(el.textContent.trim())) el.click();
    });
    expect(cb.onEditSmartFolder).toHaveBeenCalledWith(expect.objectContaining({ id: "sf_x" }));
  });
});
