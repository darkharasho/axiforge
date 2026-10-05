/** @jest-environment jsdom */
"use strict";

test("pasting comp JSON saves the comp without the original's publish receipt", async () => {
  const { handlePasteComp } = require("../../../src/renderer/modules/comps/comp-list.js");
  const comp = {
    id: "c1", name: "Pasted", buildIds: [], publishedFileId: "f1", publishedKey: "k1",
    publishedHash: "h", publishedMemberHashes: { b1: "m" }, publishedAt: "2026-01-01T00:00:00.000Z",
  };
  window.desktopApi = {
    readClipboardText: jest.fn(async () => JSON.stringify(comp)),
    saveComp: jest.fn(async (c) => c),
    listComps: jest.fn(async () => []),
  };
  await handlePasteComp();
  expect(window.desktopApi.saveComp).toHaveBeenCalledTimes(1);
  const saved = window.desktopApi.saveComp.mock.calls[0][0];
  expect(saved.name).toBe("Pasted");
  for (const k of ["id", "publishedFileId", "publishedKey", "publishedHash", "publishedMemberHashes", "publishedAt"]) {
    expect(saved).not.toHaveProperty(k);
  }
});
