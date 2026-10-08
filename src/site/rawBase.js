// The viewer reads published data from raw.githubusercontent.com. raw's CDN
// serves /main/ up to ~5 minutes stale, so a page resolves the newest commit
// first and reads files pinned to it; a pinned URL can't answer with an older
// copy. Any failure falls back to /main/.

const SHA = /^[0-9a-f]{40}$/;
const LOOKUP_TIMEOUT_MS = 3000;
const TIMED_OUT = Symbol("timed out");
const pinned = new Map(); // "owner/repo" → Promise<base>, for this page load

function ownerRepo(location) {
  const m = (location.hostname || "").match(/^([^.]+)\.github\.io$/);
  if (!m) return null;
  const repo = (location.pathname || "/").split("/").filter(Boolean)[0] || "";
  return repo ? { owner: m[1], repo } : null;
}

export function resolveDataBase(location, searchParams) {
  const explicit = searchParams.get("remoteBase");
  if (explicit) return explicit;
  const where = ownerRepo(location);
  return where ? `https://raw.githubusercontent.com/${where.owner}/${where.repo}/main/site/` : "";
}

async function lookupPinnedBase(owner, repo, fetchImpl, timeoutMs) {
  const fallback = `https://raw.githubusercontent.com/${owner}/${repo}/main/site/`;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits/main`, {
        headers: { Accept: "application/vnd.github.sha" },
        cache: "no-store",
        signal: controller?.signal,
      }),
      timedOut,
    ]);
    if (res === TIMED_OUT || !res?.ok) return fallback;
    const body = await Promise.race([res.text(), timedOut]);
    if (body === TIMED_OUT) return fallback;
    const sha = String(body).trim();
    return SHA.test(sha) ? `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/site/` : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** Data base for one owner's repo, pinned to its newest commit; one lookup per page load. */
export function pinnedRawBase(owner, repo, fetchImpl = globalThis.fetch, { timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const key = `${owner}/${repo}`;
  if (!pinned.has(key)) pinned.set(key, lookupPinnedBase(owner, repo, fetchImpl, timeoutMs));
  return pinned.get(key);
}

/** resolveDataBase, pinned to the newest commit when the page is on github.io. */
export async function resolvePinnedBase(location, searchParams, fetchImpl = globalThis.fetch) {
  const explicit = searchParams.get("remoteBase");
  if (explicit) return explicit;
  const where = ownerRepo(location);
  return where ? pinnedRawBase(where.owner, where.repo, fetchImpl) : "";
}

export function _resetPinnedBases() {
  pinned.clear();
}
