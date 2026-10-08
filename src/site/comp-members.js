import { fetchPayload } from "./payload.js";

const REPO = "axibuilds";

// Mirrors slugifyBuildName (src/main/buildEncryption.js) so a member link reads
// the same as the one the desktop builds.
function slugify(name) {
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "build";
}

/** Where a member's .enc lives: its publisher's repo, or this page's own base. */
export function memberDataBase(member, fallbackBase) {
  return member?.owner ? `https://raw.githubusercontent.com/${member.owner}/${REPO}/main/site/` : fallbackBase;
}

/** The member build's own page, for slot and pool-card links. */
export function memberSpaUrl(member, build, loc) {
  const page = member.owner ? `https://${member.owner}.github.io/${REPO}/` : `${loc.origin}${loc.pathname}`;
  return `${page}?n=${encodeURIComponent(slugify(build.title))}&b=${member.fileId}.${member.key}`;
}

/**
 * Fetch every member of a v2 comp in parallel. Returns the {id: build} map v1
 * comps embed, so the rest of the page renders both formats the same way. A
 * member that can't be fetched or decrypted becomes {id, unavailable: true}.
 */
export async function loadCompMembers(comp, { fallbackBase, loc, fetchImpl }) {
  const entries = await Promise.all(Object.entries(comp.members || {}).map(async ([buildId, m]) => {
    try {
      const url = `${memberDataBase(m, fallbackBase)}builds/${encodeURIComponent(m.fileId)}.enc`;
      const build = await fetchPayload(url, m.key, fetchImpl);
      return [buildId, { ...build, id: buildId, spaUrl: memberSpaUrl(m, build, loc) }];
    } catch {
      return [buildId, { id: buildId, unavailable: true }];
    }
  }));
  return Object.fromEntries(entries);
}
