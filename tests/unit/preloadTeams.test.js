"use strict";
// Drives the real preload bridge (not its source text): the teams:* bindings
// must surface the main process's carefully worded errors, not Electron's
// "Error invoking remote method '…': Error: …" wrapper.

let exposed = null;
const ipcRenderer = { invoke: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn() };
jest.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_key, api) => { exposed = api; } },
  ipcRenderer,
}));

require("../../src/preload/index.js");

beforeEach(() => { ipcRenderer.invoke.mockReset(); });

test("the remote-method wrapper is stripped off rejections", async () => {
  ipcRenderer.invoke.mockRejectedValue(new Error(
    "Error invoking remote method 'teams:migrate-org-library': Error: Migration failed and the team \"EWW\" (t1) could not be removed: Network error Delete it in Settings → Teams before trying the migration again."
  ));
  await expect(exposed.migrateOrgLibrary({})).rejects.toThrow(
    /^Migration failed and the team "EWW" \(t1\) could not be removed/
  );
});

test("an unwrapped error message is passed through untouched", async () => {
  ipcRenderer.invoke.mockRejectedValue(new Error("Nothing to migrate."));
  await expect(exposed.joinTeam("X")).rejects.toThrow(/^Nothing to migrate\.$/);
});

test("the original error object (and its code) is preserved", async () => {
  const err = new Error("Error invoking remote method 'teams:list': Error: offline");
  err.code = "SYNC_OFFLINE";
  ipcRenderer.invoke.mockRejectedValue(err);
  await expect(exposed.listTeams()).rejects.toMatchObject({ code: "SYNC_OFFLINE", message: "offline" });
});

test("resolved values are untouched and arguments are forwarded", async () => {
  ipcRenderer.invoke.mockResolvedValue([{ team: { id: "t" }, role: "owner" }]);
  await expect(exposed.shareFolderToTeam("f1", "t1")).resolves.toEqual([{ team: { id: "t" }, role: "owner" }]);
  expect(ipcRenderer.invoke).toHaveBeenCalledWith("teams:share-folder", "f1", "t1");
});
