const { createStubsApi } = require("../../src/web/webApi/stubs.js");

test("auth + onboarding report signed-out / unconfigured", async () => {
  const s = createStubsApi();
  expect(await s.getSession()).toEqual({ signedIn: false });
  expect(await s.getOnboardingStatus()).toEqual({ configured: false });
  expect(await s.listTargets()).toEqual([]);
  expect(await s.getSharedLibraryConfig()).toBeNull();
});

test("event registrars accept a callback and do not throw", () => {
  const s = createStubsApi();
  expect(() => s.onUpdateAvailable(() => {})).not.toThrow();
  expect(() => s.onDownloadProgress(() => {})).not.toThrow();
  expect(() => s.onSyncStatus(() => {})).not.toThrow();
});

test("resolveEntityFacts returns one null per requested name", async () => {
  const s = createStubsApi();
  expect(await s.resolveEntityFacts(["a", "b"])).toEqual([null, null]);
});

test("every method is callable and never throws synchronously", () => {
  const s = createStubsApi();
  for (const key of Object.keys(s)) {
    expect(() => s[key](["x"], "y")).not.toThrow();
  }
});
