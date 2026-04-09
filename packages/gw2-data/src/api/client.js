"use strict";

const GW2_API_ROOT = "https://api.guildwars2.com";
const MAX_IDS_PER_REQUEST = 180;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 3;
const RATE_LIMIT_DELAY_MS = 2000;
const USER_AGENT = "@axi/gw2-data (https://github.com/darkharasho/axiforge)";

class Gw2ApiClient {
  /**
   * @param {Object} options
   * @param {import('../wiki/cache').CacheAdapter} options.cache - Cache adapter
   * @param {Function} [options.fetch] - Fetch implementation (defaults to global fetch)
   * @param {string} [options.apiRoot] - GW2 API root URL
   * @param {string} [options.lang] - Language code (default: "en")
   */
  constructor(options = {}) {
    this._cache = options.cache;
    this._fetch = options.fetch || globalThis.fetch;
    this._apiRoot = options.apiRoot || GW2_API_ROOT;
    this._lang = options.lang || "en";
    this._queue = [];
    this._activeRequests = 0;
  }

  async fetchJson(url) {
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await this._enqueue(() =>
        this._fetch(url, {
          headers: { "User-Agent": USER_AGENT },
        })
      );
      if (res.ok) {
        return res.json();
      }
      if (res.status === 429) {
        await this._delay(RATE_LIMIT_DELAY_MS);
        continue;
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
      if (res.status >= 500) {
        await this._delay(500 * (attempt + 1));
        continue;
      }
      throw lastError;
    }
    throw lastError;
  }

  async fetchByIds(endpoint, ids, lang) {
    const dedupedIds = [...new Set(ids)];
    const chunks = this._chunk(dedupedIds, MAX_IDS_PER_REQUEST);
    const langParam = lang || this._lang;
    const results = [];

    for (const chunk of chunks) {
      const url = `${this._apiRoot}${endpoint}?ids=${chunk.join(",")}&lang=${langParam}`;
      const data = await this.fetchJson(url);
      results.push(...data);
    }

    return results;
  }

  async fetchCached(key, url, ttlMs) {
    const cached = this._cache.get(key);
    if (cached !== null) return cached;

    const data = await this.fetchJson(url);
    this._cache.set(key, data, ttlMs);
    return data;
  }

  _chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this._queue.length > 0 && this._activeRequests < MAX_CONCURRENT) {
      const { fn, resolve, reject } = this._queue.shift();
      this._activeRequests++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this._activeRequests--;
          this._drain();
        });
    }
  }
}

module.exports = {
  Gw2ApiClient,
  GW2_API_ROOT,
  MAX_IDS_PER_REQUEST,
  USER_AGENT,
};
