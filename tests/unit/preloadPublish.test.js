"use strict";

let exposed = null;
const ipcRenderer = { invoke: jest.fn(async () => true), on: jest.fn(), removeAllListeners: jest.fn() };
jest.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_key, api) => { exposed = api; } },
  ipcRenderer,
}));

require("../../src/preload/index.js");

test.each([
  ["getPublishSnapshot", [], "publish:snapshot"],
  ["retryPublish", ["build", "b1"], "publish:retry"],
  ["setPublishChoice", ["build", "b1", "mine"], "publish:set-choice"],
  ["getPublishLink", ["comp", "c1"], "publish:get-link"],
  ["getBulkPublishCount", [], "publish:bulk-candidates"],
  ["bulkPublish", [], "publish:bulk-enqueue"],
  ["resumePublishing", [], "publish:resume"],
  ["resumePublishing", [{ keepUnauthorized: true }], "publish:resume"],
])("%s invokes %s", async (method, args, channel) => {
  await exposed[method](...args);
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(channel, ...args);
});

test.each([
  ["onPublishStatus", "publish:status"],
  ["onPublishOwnerChoice", "publish:needs-owner-choice"],
])("%s subscribes to %s, replacing any earlier listener", (method, channel) => {
  const cb = jest.fn();
  exposed[method](cb);
  expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith(channel);
  const handler = ipcRenderer.on.mock.calls.find(([c]) => c === channel)[1];
  handler({}, { x: 1 });
  expect(cb).toHaveBeenCalledWith({ x: 1 });
});
