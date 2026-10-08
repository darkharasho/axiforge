"use strict";

const { PAYLOAD_VERSION } = require("./buildEncryption");
const { COMP_FORMAT_VERSION } = require("./compPublish");
const { buildFingerprint, compFingerprint } = require("./publishFingerprint");

// Pages published before the current payload format still open, but they are
// the large old files. Each publish quietly re-uploads a batch of them in the
// current format, under the same file id and key, so no link changes.
//
// A record says which format its page is in with `publishedFormat`:
// "<format>:<publishedHash>". The hash pins the stamp to the upload it was
// written for. An app that predates the stamp keeps an unknown field on a comp
// it republishes, but it always moves the hash with new content, so the stamp
// no longer matches and the page counts as old again.

const MIGRATION_BATCH = 25;

function buildFormat() {
  return String(PAYLOAD_VERSION);
}

function compFormat() {
  return `${PAYLOAD_VERSION}.${COMP_FORMAT_VERSION}`;
}

function formatStamp(kind, publishedHash) {
  return `${kind === "comp" ? compFormat() : buildFormat()}:${publishedHash}`;
}

// A page this owner published whose file is older than the current format.
// Only a page that matches local content is redone: re-uploading one that is
// out of date would publish edits nobody chose to publish.
function isOldOwnPage(record, kind, owner) {
  const r = record || {};
  if (!r.publishedFileId || !r.publishedKey || !r.publishedHash) return false;
  if (r.deletedAt) return false;
  if ((r.publishedOwner || "") !== owner) return false;
  if (r.publishedFormat === formatStamp(kind, r.publishedHash)) return false;
  const current = kind === "comp" ? compFingerprint(r) : buildFingerprint(r);
  return current === r.publishedHash;
}

/**
 * Pick the old-format pages a publish to `owner` should redo alongside its own
 * upload. `excludeIds` are records that publish already writes.
 *
 * A comp is redone only when every member build is here with a published page
 * to link: members are linked as they stand, never re-uploaded, since a
 * member's page may be deliberately behind its local edits.
 *
 * @returns {{ builds: object[], comps: { comp: object, members: object }[] }}
 */
function planFormatMigrations({ builds = [], comps = [], owner, excludeIds = [], memberIdsOf, themeOf = () => "", limit = MIGRATION_BATCH }) {
  const skip = new Set(excludeIds);
  const byId = new Map(builds.map((b) => [b.id, b]));
  const out = { builds: [], comps: [] };
  let room = limit;

  for (const comp of comps) {
    if (room <= 0) break;
    if (skip.has(comp.id) || !isOldOwnPage(comp, "comp", owner)) continue;
    const members = {};
    let linkable = true;
    for (const id of memberIdsOf(comp)) {
      const b = byId.get(id);
      if (!b || !b.publishedFileId || !b.publishedKey) { linkable = false; break; }
      members[id] = {
        fileId: b.publishedFileId, key: b.publishedKey, owner: b.publishedOwner || owner,
        slug: b.publishedSlug || "", theme: themeOf(b) || "",
      };
    }
    if (!linkable) continue;
    out.comps.push({ comp, members });
    room--;
  }

  for (const build of builds) {
    if (room <= 0) break;
    if (skip.has(build.id) || !isOldOwnPage(build, "build", owner)) continue;
    out.builds.push(build);
    room--;
  }
  return out;
}

module.exports = { MIGRATION_BATCH, formatStamp, isOldOwnPage, planFormatMigrations };
