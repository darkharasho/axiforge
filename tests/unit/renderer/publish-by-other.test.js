"use strict";
const { publishWithOwnerCheck, publishedByOtherBody } =
  require("../../../src/renderer/modules/publish-guard.js");

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

// The body is fed straight to innerHTML by showConfirmModal, and `login` is
// teammate-controlled (a team item's publishedOwner). The escaping has to live
// in the helper: a call site that forgot would be a stored XSS in a renderer
// with full desktopApi access.
test("publishedByOtherBody escapes the login itself", () => {
  const html = publishedByOtherBody('<img src=x onerror=alert(1)>');
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  // The helper's own markup survives.
  expect(html).toContain("<strong>");
});

test("publishedByOtherBody renders an ordinary login unchanged", () => {
  expect(publishedByOtherBody("vette")).toContain("<strong>vette</strong>");
});
