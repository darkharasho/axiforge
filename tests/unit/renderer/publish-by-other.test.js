"use strict";
const { publishWithOwnerCheck } = require("../../../src/renderer/modules/publish-guard.js");

test("passes through on success", async () => {
  const invoke = jest.fn(async () => ({ pagesUrl: "u" }));
  expect(await publishWithOwnerCheck(invoke, jest.fn())).toEqual({ pagesUrl: "u" });
  expect(invoke).toHaveBeenCalledWith({});
});

test("asks, then forces when confirmed; returns null when declined", async () => {
  const invoke = jest.fn(async (opts) => { if (!opts.force) throw new Error("PUBLISHED_BY_OTHER:vette"); return { pagesUrl: "new" }; });
  const confirm = jest.fn(async () => true);
  expect(await publishWithOwnerCheck(invoke, confirm)).toEqual({ pagesUrl: "new" });
  expect(confirm).toHaveBeenCalledWith("vette");
  expect(invoke).toHaveBeenLastCalledWith({ force: true });
  confirm.mockResolvedValue(false);
  invoke.mockClear();
  expect(await publishWithOwnerCheck(invoke, confirm)).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("other errors propagate", async () => {
  await expect(publishWithOwnerCheck(async () => { throw new Error("boom"); }, jest.fn())).rejects.toThrow("boom");
});
