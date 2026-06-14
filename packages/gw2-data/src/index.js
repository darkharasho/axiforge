"use strict";

const { WikiClient, WIKI_API_ROOT } = require("./wiki/client");
const { MemoryCache, DiskCache } = require("./wiki/cache");
const { Gw2ApiClient, GW2_API_ROOT } = require("./api/client");
const {
  parseSplitGrouping,
  parseWikitextFacts,
  mapWikiFactToApiFact,
  parseInfoboxParams,
} = require("./wiki/parser");
const { parseFactsByMode, groupFactsByMode } = require("./wiki/resolver");
const { parseRelatedItems, parseRelatedGroups } = require("./wiki/relations");
const { mergeFacts } = require("./facts/merge");
const { buildMatchTables, valueChanged, VALUE_KEYS } = require("./facts/match");
const { normalizeFactType, stripGw2Markup, stripWikiMarkup } = require("./facts/normalize");
const engine = require("./engine");

module.exports = {
  // Wiki layer
  WikiClient,
  WIKI_API_ROOT,

  // GW2 API layer
  Gw2ApiClient,
  GW2_API_ROOT,

  // Cache
  MemoryCache,
  DiskCache,

  // Parser
  parseSplitGrouping,
  parseWikitextFacts,
  mapWikiFactToApiFact,
  parseInfoboxParams,

  // Resolver (mode-split: PvE/WvW/PvP facts the GW2 API lacks)
  parseFactsByMode,
  groupFactsByMode,

  // Relations
  parseRelatedItems,
  parseRelatedGroups,

  // Facts
  mergeFacts,
  buildMatchTables,
  valueChanged,
  VALUE_KEYS,
  normalizeFactType,
  stripGw2Markup,
  stripWikiMarkup,

  // Engine
  StatEngine: engine.StatEngine,
  computeAttributes: engine.computeAttributes,
  computeSlotStats: engine.computeSlotStats,
  collectModifiers: engine.collectModifiers,
  computeTooltip: engine.computeTooltip,
  analyzeBoons: engine.analyzeBoons,
  analyzeCombos: engine.analyzeCombos,
  loadOverrides: engine.loadOverrides,
  buildInteractionGraph: engine.buildInteractionGraph,
};
