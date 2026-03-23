const GW2_API_ROOT = process.env.GW2_API_ROOT || "https://api.guildwars2.com/v2";
const WIKI_API_ROOT = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "axiforge-desktop";

const cache = new Map();

async function fetchGw2ByIds(endpoint, ids, lang = "en") {
  if (!Array.isArray(ids) || !ids.length) return [];
  const chunks = chunk(ids, 180);
  const results = await Promise.all(
    chunks.map((idsChunk) => {
      const query = idsChunk.join(",");
      const url = `${GW2_API_ROOT}/${endpoint}?ids=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang)}`;
      return fetchCachedJson(`${endpoint}:${lang}:${query}`, url, 1000 * 60 * 60)
        .then((data) => (Array.isArray(data) ? data.filter(Boolean) : []));
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
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
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
