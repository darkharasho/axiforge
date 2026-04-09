"use strict";

const { MemoryCache } = require("./cache");
const {
  parseSplitGrouping,
  parseWikitextFacts,
  parseInfoboxParams,
} = require("./parser");

const WIKI_API_ROOT = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "@axi/gw2-data (https://github.com/darkharasho/axiforge)";
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const RATE_LIMIT_MS = 200;

class WikiClient {
  constructor(options = {}) {
    this._cache = options.cache || new MemoryCache();
    this._fetch = options.fetch || globalThis.fetch;
    this._wikiApiRoot = options.wikiApiRoot || WIKI_API_ROOT;
    this._cacheTTL = options.cacheTTL || DEFAULT_TTL_MS;
    this._lastFetchTimestamp = null;
    this._lastRequestTime = 0;
  }

  async _rateLimitedFetch(url) {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
    this._lastRequestTime = Date.now();
    return this._fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
  }

  async getWikitext(title) {
    const cacheKey = `wikitext:${title}`;
    const cached = await this._cache.get(cacheKey);
    if (cached !== null) return cached;

    const url =
      `${this._wikiApiRoot}?action=query&titles=${encodeURIComponent(title)}` +
      `&prop=revisions&rvprop=content&format=json&formatversion=1`;

    const res = await this._rateLimitedFetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (page.missing) return null;

    const wikitext = page.revisions?.[0]?.["*"] || null;
    if (wikitext) {
      await this._cache.set(cacheKey, wikitext, this._cacheTTL);
    }
    return wikitext;
  }

  async getRecentChanges(since) {
    const url =
      `${this._wikiApiRoot}?action=query&list=recentchanges` +
      `&rcnamespace=0&rcprop=title|timestamp&rclimit=500` +
      `&rcend=${encodeURIComponent(since)}&format=json`;

    const res = await this._rateLimitedFetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const changes = data.query?.recentchanges || [];
    return [...new Set(changes.map((c) => c.title))];
  }

  async refresh() {
    if (!this._lastFetchTimestamp) {
      this._lastFetchTimestamp = new Date().toISOString();
      return [];
    }

    const changed = await this.getRecentChanges(this._lastFetchTimestamp);
    for (const title of changed) {
      await this._cache.invalidate(`wikitext:${title}`);
      await this._cache.invalidate(`facts:${title}`);
    }
    this._lastFetchTimestamp = new Date().toISOString();
    return changed;
  }

  parseFacts(wikitext) {
    const splitMatch = wikitext.match(/\|\s*split\s*=\s*(.+)/i);
    let splitGrouping = null;
    let wvwGroupedWithPvp = false;

    if (splitMatch) {
      splitGrouping = parseSplitGrouping(splitMatch[1].trim());
      wvwGroupedWithPvp = splitGrouping.wvwGroupedWithPvp;
    }

    let { facts, hasPveOnly } = parseWikitextFacts(wikitext, wvwGroupedWithPvp);

    if (facts.length === 0 && splitGrouping?.wvwHasSplit) {
      facts = parseInfoboxParams(wikitext, wvwGroupedWithPvp);
    }

    return { facts, hasPveOnly, splitGrouping };
  }
}

module.exports = { WikiClient, WIKI_API_ROOT };
