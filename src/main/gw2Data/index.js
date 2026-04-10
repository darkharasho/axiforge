const { getProfessionList, getProfessionCatalog, getUpgradeCatalog, _setStaticData, initWikiClient } = require("./catalog");
const { getWikiSummary, getWikiRelatedData } = require("./wiki");
const { initDiskCache, clearDiskCache } = require("./fetch");

module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  getWikiSummary,
  getWikiRelatedData,
  initDiskCache,
  clearDiskCache,
  _setStaticData,
  initWikiClient,
};
