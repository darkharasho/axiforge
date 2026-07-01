const fs = require("node:fs/promises");
const path = require("node:path");

const GW2_API_ROOT = process.env.GW2_API_ROOT || "https://api.guildwars2.com/v2";
const WIKI_API_ROOT = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "axiforge-desktop";

const cache = new Map();

// ─── Disk cache (persists across app restarts) ──────────────────────────────

let _diskCachePath = null;
let _diskCache = {};      // { [key]: { value, expiresAt } }
let _diskDirty = false;
let _flushTimer = null;
const FLUSH_DELAY = 2000; // debounce writes by 2s

async function initDiskCache(dir) {
  _diskCachePath = path.join(dir, "api-cache.json");
  try {
    const raw = await fs.readFile(_diskCachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Prune expired entries on load
      const now = Date.now();
      for (const k of Object.keys(parsed)) {
        if (parsed[k] && parsed[k].expiresAt > now) {
          _diskCache[k] = parsed[k];
        }
      }
    }
  } catch {
    _diskCache = {};
  }
}

async function _flushDiskCache() {
  if (!_diskCachePath || !_diskDirty) return;
  _diskDirty = false;
  try {
    await fs.writeFile(_diskCachePath, JSON.stringify(_diskCache), "utf8");
  } catch { /* best-effort */ }
}

function _scheduleDiskFlush() {
  _diskDirty = true;
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => _flushDiskCache(), FLUSH_DELAY);
}

async function clearDiskCache() {
  cache.clear();
  _diskCache = {};
  _diskDirty = false;
  if (_flushTimer) clearTimeout(_flushTimer);
  if (_diskCachePath) {
    try { await fs.unlink(_diskCachePath); } catch { /* ok if missing */ }
  }
}

// ─── Request queue ──────────────────────────────────────────────────────────

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

// ─── Cache TTLs ─────────────────────────────────────────────────────────────

// All API responses are now cached for 24 hours on disk.
// Endpoints whose data essentially never changes get a 7-day cache.
const LONG_CACHE_ENDPOINTS = new Set(["races", "professions", "specializations", "traits", "skills", "legends", "pets"]);
const TTL_LONG = 1000 * 60 * 60 * 24 * 7; // 7 days
const TTL_DEFAULT = 1000 * 60 * 60 * 24;   // 24 hours

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
  // L1: in-memory cache
  const memCached = cache.get(key);
  if (memCached && Date.now() < memCached.expiresAt) {
    return memCached.value;
  }
  // L2: disk cache
  const diskEntry = _diskCache[key];
  if (diskEntry && Date.now() < diskEntry.expiresAt) {
    cache.set(key, diskEntry); // promote to memory
    return diskEntry.value;
  }
  // L3: network
  const data = await fetchJson(url);
  const entry = { value: data, expiresAt: Date.now() + ttlMs };
  cache.set(key, entry);
  _diskCache[key] = entry;
  _scheduleDiskFlush();
  return data;
}

// ─── Remote data snapshots (relicFacts, upgradeIds) ─────────────────────────

// Wiki/API-derived data snapshots are published to a hosted URL so updates
// reach users without an app release. loadSnapshot fetches remote-first, reuses
// the same memory+disk cache as the API layer, VALIDATES the payload before
// trusting it (a truncated/broken publish must never override the shipped copy),
// and falls back to the baked-in file — or a stale-but-valid cache when offline.
const SNAPSHOT_TIMEOUT_MS = 8000;

async function loadSnapshot(key, url, ttlMs, { validate, fallback } = {}) {
  const ok = (v) => {
    if (v == null) return false;
    try { return typeof validate === "function" ? !!validate(v) : true; }
    catch { return false; }
  };
  const bakeFallback = async () =>
    (typeof fallback === "function" ? await fallback() : fallback);

  // L1/L2: fresh, valid cache
  const memHit = cache.get(key);
  if (memHit && Date.now() < memHit.expiresAt && ok(memHit.value)) {
    return { value: memHit.value, source: "cache" };
  }
  const diskHit = _diskCache[key];
  if (diskHit && Date.now() < diskHit.expiresAt && ok(diskHit.value)) {
    cache.set(key, diskHit);
    return { value: diskHit.value, source: "cache" };
  }

  // L3: network
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`snapshot ${key}: HTTP ${res.status}`);
    const data = await res.json();
    if (!ok(data)) throw new Error(`snapshot ${key}: failed validation`);
    const entry = { value: data, expiresAt: Date.now() + ttlMs };
    cache.set(key, entry);
    _diskCache[key] = entry;
    _scheduleDiskFlush();
    return { value: data, source: "remote" };
  } catch (err) {
    // Offline / bad publish: prefer a stale-but-valid cache over the shipped
    // copy (it's likely newer), else fall back to the baked-in file.
    if (diskHit && ok(diskHit.value)) return { value: diskHit.value, source: "stale", error: err };
    if (memHit && ok(memHit.value)) return { value: memHit.value, source: "stale", error: err };
    return { value: await bakeFallback(), source: "baked", error: err };
  }
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
  initDiskCache,
  clearDiskCache,
  fetchGw2ByIds,
  fetchCachedJson,
  loadSnapshot,
  fetchJson,
  dedupeNumbers,
  chunk,
};
