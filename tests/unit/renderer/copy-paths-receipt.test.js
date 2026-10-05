/** @jest-environment jsdom */
"use strict";

// Every copy path writes a NEW, unpublished record. If it kept the original's
// publishedFileId/Key it would claim (and overwrite) the original's page.

const RECEIPT = {
  publishedFileId: "f1", publishedKey: "k1", publishedSlug: "s", publishedOwner: "o",
  publishedAt: "2026-01-01T00:00:00.000Z", publishedHash: "h", publishedMemberHashes: { b1: "m" },
};
const expectNoReceipt = (saved) => {
  for (const k of Object.keys(RECEIPT)) expect(saved).not.toHaveProperty(k);
};

let captured;
jest.mock("../../../src/renderer/modules/comps/comp-list.js", () => ({
  initCompList: jest.fn((cb) => { captured = cb; }),
  renderCompList: jest.fn(),
  clearCompSelection: jest.fn(),
  handlePasteComp: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/comps/comp-detail.js", () => ({
  initCompDetail: jest.fn(),
  renderCompDetail: jest.fn(),
}));

let state;
beforeEach(() => {
  jest.resetModules();
  ({ state } = require("../../../src/renderer/modules/state"));
  window.desktopApi = {
    saveComp: jest.fn(async (c) => ({ id: "new", ...c })),
    saveBuild: jest.fn(async (b) => ({ id: "new", ...b })),
    listComps: jest.fn(async () => []),
    listBuilds: jest.fn(async () => []),
    listFolders: jest.fn(async () => []),
  };
});

test("comps-page Duplicate saves a copy without the receipt", async () => {
  const { initComps } = require("../../../src/renderer/modules/comps/comps.js");
  state.comps = [{ id: "c1", name: "Alpha", createdAt: "x", updatedAt: "y", buildIds: [], ...RECEIPT }];
  initComps({});
  await captured.onDuplicateComp("c1");
  const saved = window.desktopApi.saveComp.mock.calls[0][0];
  expect(saved.name).toBe("Copy of Alpha");
  expect(saved).not.toHaveProperty("id");
  expectNoReceipt(saved);
});

test(".axicode 'copy' resolution saves builds and comps without the receipt", async () => {
  jest.doMock("../../../src/renderer/modules/import-conflict-modal.js", () => ({
    showImportConflictModal: jest.fn(async () => new Map([["b1", "copy"], ["c1", "copy"]])),
  }));
  const { handleAxicodeImport } = require("../../../src/renderer/modules/library/axicode-io.js");
  const { state: st } = require("../../../src/renderer/modules/state");
  const build = { id: "b1", title: "B", ...RECEIPT };
  const comp = { id: "c1", name: "C", buildIds: [], ...RECEIPT };
  st.builds = [build]; st.comps = [comp]; st.folders = [];
  window.desktopApi.importAxicodeFile = jest.fn(async () => ({ data: { builds: [build], folders: [], comps: [comp] } }));
  await handleAxicodeImport(null, jest.fn(), jest.fn());
  expect(window.desktopApi.saveBuild).toHaveBeenCalledTimes(1);
  expect(window.desktopApi.saveComp).toHaveBeenCalledTimes(1);
  expectNoReceipt(window.desktopApi.saveBuild.mock.calls[0][0]);
  expectNoReceipt(window.desktopApi.saveComp.mock.calls[0][0]);
});
