"use strict";
// Axi access policy for the sync Worker.
//
// The Axi apps can revoke access for people who violate their terms of use
// (see README "Access policy"). The list is published at config.axi.link as a manifest
// whose `denylist` holds only SHA-256 hashes of "kind:normalized" identifiers;
// this module answers whether a GitHub user id is on it.
//
// Caching: the denylist is kept in the SYNC_RL KV namespace for 230 s and in a
// per-isolate memo for 60 s, so an unban takes effect within 5 minutes. The
// memo is a WeakMap keyed by the KV binding (or by `env` when there is none),
// which keeps tests isolated without any reset hook.
//
// Fails OPEN: if the manifest cannot be fetched or parsed nobody is refused
// here. The check is off entirely unless env.POLICY_MANIFEST_URL is set.
const { sha256Hex } = require("./db");

const POLICY_KV_KEY = "policy:manifest";
const POLICY_KV_TTL_SECONDS = 230;
const POLICY_MEMO_TTL_MS = 60 * 1000;
const POLICY_FETCH_TIMEOUT_MS = 3000;
const GITHUB_ID = /^[1-9]\d{0,19}$/;

const memo = new WeakMap();

async function githubUserHash(githubId) {
  const normalized = String(githubId).normalize("NFC").trim().toLowerCase().normalize("NFC");
  if (!GITHUB_ID.test(normalized)) return null;
  return sha256Hex("github_user:" + normalized);
}

function parseDenylist(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((h) => typeof h === "string").map((h) => h.toLowerCase());
}

async function readKv(kv) {
  if (!kv) return null;
  try {
    const raw = await kv.get(POLICY_KV_KEY);
    return raw ? parseDenylist(JSON.parse(raw)) : null;
  } catch (err) {
    console.warn("[policy] denylist cache get failed:", err && err.message || err);
    return null;
  }
}

async function writeKv(kv, list) {
  if (!kv) return;
  try {
    await kv.put(POLICY_KV_KEY, JSON.stringify(list), { expirationTtl: POLICY_KV_TTL_SECONDS });
  } catch (err) {
    console.warn("[policy] denylist cache put failed:", err && err.message || err);
  }
}

async function fetchDenylist(url, deps) {
  try {
    const res = await (deps.policyFetchImpl || fetch)(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.policyTimeoutMs || POLICY_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn("[policy] manifest fetch failed: HTTP", res.status);
      return null;
    }
    const list = parseDenylist((await res.json()).denylist);
    if (!list) console.warn("[policy] manifest has no denylist");
    return list;
  } catch (err) {
    console.warn("[policy] manifest fetch failed:", err && err.message || err);
    return null;
  }
}

// → Set of hashes, or null when the policy is off or unavailable.
async function loadDenylist(env, deps) {
  const url = env.POLICY_MANIFEST_URL;
  if (!url) return null;
  const nowMs = (deps.now || Date.now)();
  const memoKey = env.SYNC_RL || env;
  const hit = memo.get(memoKey);
  if (hit && hit.until > nowMs) return hit.set;

  let list = await readKv(env.SYNC_RL);
  if (!list) {
    list = await fetchDenylist(url, deps);
    if (list) await writeKv(env.SYNC_RL, list);
  }
  const set = list ? new Set(list) : null;
  memo.set(memoKey, { set, until: nowMs + POLICY_MEMO_TTL_MS });
  return set;
}

async function isGithubUserBlocked(env, deps = {}, githubId) {
  const set = await loadDenylist(env, deps);
  if (!set || set.size === 0) return false;
  const hash = await githubUserHash(githubId);
  return hash !== null && set.has(hash);
}

module.exports = { githubUserHash, isGithubUserBlocked, POLICY_KV_KEY, POLICY_KV_TTL_SECONDS, POLICY_MEMO_TTL_MS, POLICY_FETCH_TIMEOUT_MS };
