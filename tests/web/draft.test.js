const { createDraftApi } = require("../../src/web/webApi/draft.js");

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test("listBuilds is empty before any save", async () => {
  const api = createDraftApi({ storage: memStorage() });
  expect(await api.listBuilds()).toEqual([]);
});

test("saveBuild persists a single draft, assigns id, and round-trips", async () => {
  const storage = memStorage();
  const api = createDraftApi({ storage });
  const saved = await api.saveBuild({ name: "Test", profession: "guardian" });
  expect(saved.id).toBe("web-draft");

  const api2 = createDraftApi({ storage }); // fresh instance, same storage
  const builds = await api2.listBuilds();
  expect(builds).toHaveLength(1);
  expect(builds[0].name).toBe("Test");
});

test("saveBuild overwrites — only ever one draft", async () => {
  const api = createDraftApi({ storage: memStorage() });
  await api.saveBuild({ name: "A", profession: "guardian" });
  await api.saveBuild({ name: "B", profession: "ranger" });
  const builds = await api.listBuilds();
  expect(builds).toHaveLength(1);
  expect(builds[0].name).toBe("B");
});

test("deleteBuild clears the draft", async () => {
  const api = createDraftApi({ storage: memStorage() });
  await api.saveBuild({ name: "A", profession: "guardian" });
  await api.deleteBuild("web-draft");
  expect(await api.listBuilds()).toEqual([]);
});

test("folders/comps/history are empty in single-build scope", async () => {
  const api = createDraftApi({ storage: memStorage() });
  expect(await api.listFolders()).toEqual([]);
  expect(await api.listComps()).toEqual([]);
  expect(await api.getBuildHistory("web-draft")).toEqual([]);
});
