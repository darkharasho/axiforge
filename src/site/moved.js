// An item that moved to another account (the desktop's teamPublishMoves.js):
// its old host deleted the payload and left site/moved/<fileId>.json naming the
// new host. The move keeps the file id and key, so the same link works there.

const REPO = "axibuilds";
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The account `fileId` moved to from `base`, or null. Never throws. */
export async function movedOwner(base, fileId, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${base}moved/${encodeURIComponent(fileId)}.json`, { cache: "no-store" });
    if (!res?.ok) return null;
    const owner = (await res.json())?.owner;
    return typeof owner === "string" && GITHUB_LOGIN.test(owner) ? owner : null;
  } catch {
    return null;
  }
}

/** This page's URL on `owner`'s site: same query (file id, key, slug, theme). */
export function movedPageUrl(owner, loc) {
  return `https://${owner}.github.io/${REPO}/${loc.search || ""}${loc.hash || ""}`;
}

/** Whether this page is already on `owner`'s site, so following would loop. */
export function isOwnSite(owner, loc) {
  return String(loc.hostname || "").toLowerCase() === `${owner.toLowerCase()}.github.io`;
}
