// Serves the playground's GW2 data from baked static JSON (see scripts/bake-catalogs.mjs).
// No runtime GW2/wiki calls. Results are memoized in memory for the session.
// base is root-absolute ("/catalogs") so it resolves correctly no matter the
// page path — short links render the SPA at /b/<slug>, where a relative
// "./catalogs" would wrongly resolve against /b/<slug>/.
function createCatalogApi({ fetchImpl = globalThis.fetch.bind(globalThis), base = "/catalogs" } = {}) {
  const memo = new Map();

  async function loadJson(file) {
    if (memo.has(file)) return memo.get(file);
    const promise = (async () => {
      const res = await fetchImpl(`${base}/${file}`);
      if (!res.ok) throw new Error(`Failed to load catalog "${file}" (${res.status}).`);
      return res.json();
    })();
    memo.set(file, promise);
    try {
      return await promise;
    } catch (err) {
      memo.delete(file); // allow retry after a transient failure
      throw err;
    }
  }

  return {
    listProfessions: () => loadJson("professions.json"),
    getUpgradeCatalog: () => loadJson("upgrades.json"),
    getProfessionCatalog: (professionId, gameMode = "pve") =>
      loadJson(`${professionId}-${gameMode}.json`),
    clearGw2Cache: async () => { memo.clear(); },
  };
}

export { createCatalogApi };
