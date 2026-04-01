const GW2_API_ROOT = process.env.GW2_API_ROOT || "https://api.guildwars2.com/v2";
const WIKI_API_ROOT = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "axiforge-desktop";

const cache = new Map();

// Simple queue to limit concurrent GW2 API requests and avoid 429s.
const MAX_CONCURRENT = 3;
let activeRequests = 0;
const requestQueue = [];

function enqueueRequest(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject });
    drainQueue();
  });
}

function drainQueue() {
  while (activeRequests < MAX_CONCURRENT && requestQueue.length > 0) {
    const { fn, resolve, reject } = requestQueue.shift();
    activeRequests++;
    fn().then(resolve, reject).finally(() => {
      activeRequests--;
      drainQueue();
    });
  }
}

// Endpoints whose data essentially never changes get a 24h cache.
// Professions, specializations, and legends are now hardcoded static JSON.
// Only "races" remains here as a long-cache endpoint if it's ever fetched.
const LONG_CACHE_ENDPOINTS = new Set(["races"]);
const TTL_LONG = 1000 * 60 * 60 * 24 * 7; // 7 days (resets on app restart anyway)
const TTL_DEFAULT = 1000 * 60 * 60;    // 1 hour

async function fetchGw2ByIds(endpoint, ids, lang = "en") {
  if (!Array.isArray(ids) || !ids.length) return [];
  const ttl = LONG_CACHE_ENDPOINTS.has(endpoint) ? TTL_LONG : TTL_DEFAULT;
  const chunks = chunk(ids, 180);
  const results = await Promise.all(
    chunks.map((idsChunk) => {
      const query = idsChunk.join(",");
      const url = `${GW2_API_ROOT}/${endpoint}?ids=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang)}`;
      return enqueueRequest(() =>
        fetchCachedJson(`${endpoint}:${lang}:${query}`, url, ttl)
      ).then((data) => (Array.isArray(data) ? data.filter(Boolean) : []));
    })
  );
  return results.flat();
}

async function fetchCachedJson(key, url, ttlMs) {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  const data = await fetchJson(url);
  cache.set(key, { value: data, expiresAt: Date.now() + ttlMs });
  return data;
}

async function fetchJson(url) {
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  let lastErr;
  let lastStatus;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = lastStatus === 429 ? 2000 * attempt : 800 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
    } catch (networkErr) {
      lastErr = networkErr;
      continue;
    }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => "");
    lastStatus = res.status;
    lastErr = new Error(`Request failed (${res.status}) for ${url}${text ? `: ${text.slice(0, 180)}` : ""}`);
    if (!RETRYABLE.has(res.status)) break;
  }
  throw lastErr;
}

function dedupeNumbers(values) {
  const set = new Set();
  const out = [];
  for (const value of values || []) {
    const num = Number(value);
    if (!Number.isFinite(num) || !num) continue;
    if (set.has(num)) continue;
    set.add(num);
    out.push(num);
  }
  return out;
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

module.exports = {
  GW2_API_ROOT,
  WIKI_API_ROOT,
  USER_AGENT,
  cache,
  fetchGw2ByIds,
  fetchCachedJson,
  fetchJson,
  dedupeNumbers,
  chunk,
};
