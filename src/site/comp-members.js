import { fetchPayload } from "./payload.js";
import { movedOwner } from "./moved.js";

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

/**
 * The member build's own page, for slot and pool-card links: the URL the
 * desktop publishes for it, slug and theme included. Members written before
 * comps recorded those fall back to the build's title and this page's theme.
 */
export function memberSpaUrl(member, build, loc) {
  const page = member.owner ? `https://${member.owner}.github.io/${REPO}/` : `${loc.origin}${loc.pathname}`;
  const slug = member.slug || slugify(build.title);
  const theme = member.theme !== undefined ? member.theme : new URLSearchParams(loc.search || "").get("t");
  return `${page}?n=${encodeURIComponent(slug)}&b=${member.fileId}.${member.key}${theme ? `&t=${encodeURIComponent(theme)}` : ""}`;
}

/**
 * Fetch every member of a v2 comp in parallel. Returns the {id: build} map v1
 * comps embed, so the rest of the page renders both formats the same way. A
 * member that can't be fetched or decrypted becomes {id, unavailable: true}.
 * `baseForOwner(owner)` resolves an owner's data base (pinned to its newest
 * commit in the viewer); without it, `memberDataBase`.
 */
export async function loadCompMembers(comp, { fallbackBase, loc, fetchImpl, baseForOwner = null }) {
  const baseOf = async (m) => (m?.owner && baseForOwner ? baseForOwner(m.owner) : memberDataBase(m, fallbackBase));
  const load = async (m) => {
    const base = await baseOf(m);
    try {
      return { m, build: await fetchPayload(`${base}builds/${encodeURIComponent(m.fileId)}.enc`, m.key, fetchImpl) };
    } catch (err) {
      // Moved to another account since this comp was published (moved.js):
      // same file id and key, new host.
      const owner = err?.status === 404 ? await movedOwner(base, m.fileId, fetchImpl) : null;
      if (!owner || owner === m.owner) throw err;
      const moved = { ...m, owner };
      return { m: moved, build: await fetchPayload(`${await baseOf(moved)}builds/${encodeURIComponent(m.fileId)}.enc`, m.key, fetchImpl) };
    }
  };
  const entries = await Promise.all(Object.entries(comp.members || {}).map(async ([buildId, member]) => {
    try {
      const { m, build } = await load(member);
      return [buildId, { ...build, id: buildId, spaUrl: memberSpaUrl(m, build, loc) }];
    } catch {
      return [buildId, { id: buildId, unavailable: true }];
    }
  }));
  return Object.fromEntries(entries);
}
