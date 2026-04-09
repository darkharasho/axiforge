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
const { parseRelatedItems, parseRelatedGroups } = require("./wiki/relations");
const { mergeFacts } = require("./facts/merge");
const { buildMatchTables, valueChanged, VALUE_KEYS } = require("./facts/match");
const { normalizeFactType, stripGw2Markup, stripWikiMarkup } = require("./facts/normalize");

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
};
