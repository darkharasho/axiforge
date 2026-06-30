const { createCatalogApi } = require("../../src/web/webApi/catalog.js");

function fakeFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => url.endsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => map[key] };
  };
}

test("getProfessionCatalog fetches the right file and memoizes", async () => {
  let calls = 0;
  const base = fakeFetch({ "catalogs/guardian-wvw.json": { ok: true } });
  const fetchImpl = async (u) => { calls++; return base(u); };
  const api = createCatalogApi({ fetchImpl });

  const a = await api.getProfessionCatalog("guardian", "wvw");
  const b = await api.getProfessionCatalog("guardian", "wvw");
  expect(a).toEqual({ ok: true });
  expect(b).toEqual({ ok: true });
  expect(calls).toBe(1); // memoized
});

test("getProfessionCatalog defaults to pve", async () => {
  const api = createCatalogApi({ fetchImpl: fakeFetch({ "catalogs/ranger-pve.json": { mode: "pve" } }) });
  expect(await api.getProfessionCatalog("ranger")).toEqual({ mode: "pve" });
});

test("listProfessions and getUpgradeCatalog read their files", async () => {
  const api = createCatalogApi({
    fetchImpl: fakeFetch({ "catalogs/professions.json": [{ id: "guardian" }], "catalogs/upgrades.json": { runes: [] } }),
  });
  expect(await api.listProfessions()).toEqual([{ id: "guardian" }]);
  expect(await api.getUpgradeCatalog()).toEqual({ runes: [] });
});

test("a missing catalog rejects with a clear error", async () => {
  const api = createCatalogApi({ fetchImpl: fakeFetch({}) });
  await expect(api.getProfessionCatalog("guardian")).rejects.toThrow(/catalog/i);
});
