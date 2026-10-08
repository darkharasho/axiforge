"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { decideCompBuildPublish } = require("./teamGuards");

const ICONS_SVG_DIR = path.join(__dirname, "../../node_modules/gw2-class-icons/wiki/svg");

// Discord-style class emoji in comp notes: ":Firebrand:". Only names that map
// to a real class icon are resolved; ":everyone:" and the like stay as text.
const CLASS_EMOJI_TOKEN = /:([A-Za-z]+):/g;

let _classIconNames = null;

// Canonical class name by lowercase name, read once from the icon package so
// ":firebrand:" resolves the same as ":Firebrand:".
function classIconNames() {
  if (_classIconNames) return _classIconNames;
  _classIconNames = new Map();
  try {
    for (const file of fs.readdirSync(ICONS_SVG_DIR)) {
      if (!file.endsWith(".svg")) continue;
      const name = file.slice(0, -4);
      _classIconNames.set(name.toLowerCase(), name);
    }
  } catch {
    // No icon package — comps publish without class icons rather than failing.
  }
  return _classIconNames;
}

/**
 * SVG for every class emoji used in the notes, keyed by canonical name. Baked
 * into the payload the way build.professionIcon is, so the published page
 * doesn't have to ship all 45 icons.
 *
 * @param {string} notes
 * @returns {Object<string, string>}
 */
function resolveNotesClassIcons(notes) {
  const icons = {};
  if (!notes) return icons;
  const byKey = classIconNames();
  for (const match of String(notes).matchAll(CLASS_EMOJI_TOKEN)) {
    const name = byKey.get(match[1].toLowerCase());
    if (!name || icons[name]) continue;
    try {
      icons[name] = fs.readFileSync(path.join(ICONS_SVG_DIR, `${name}.svg`), "utf8");
    } catch {
      // Skip an icon we can't read — the token just stays as text.
    }
  }
  return icons;
}

/**
 * The published comp (payload v2). Member builds are linked, not embedded:
 * `members[buildId] = { fileId, key, owner }` names each build's own published
 * file, which the viewer fetches. That keeps the comp a few KB, and a build
 * re-published on its own shows up in every comp that uses it without
 * re-uploading those comps.
 */
function serializeCompForPublish(comp, members) {
  const { id, name, notes, tags, gameMode, partyLines, buildColors, categories, images } = comp;
  return {
    v: 2,
    id, name, notes, tags, gameMode, partyLines, buildColors,
    // Screenshots pasted into comp notes, keyed by the ~img:<key> tokens the
    // notes markdown references.
    images: images || {},
    // Class icons for the :Firebrand: emoji used in the notes, keyed by name.
    notesClassIcons: resolveNotesClassIcons(notes),
    // Comp-scoped build categories, so published comps can render tag slots
    // (the "tag:<id>" entries in partyLines.slots) with their icon and hover.
    categories: categories || [],
    members: { ...members },
  };
}

/**
 * Decide, for each member of a comp being published under `owner`, where its
 * published file lives. A build a teammate published is linked from their repo
 * and left alone (unless `force`). Every other member is (re-)uploaded under
 * `owner` in the same commit as the comp, reusing its file id and key when it
 * has them so existing build links stay valid.
 *
 * Each member also records the slug and theme (`themeOf(build)`, "" for none)
 * its page link carries, so the viewer links it exactly as v1 comps did: a
 * teammate's build under the slug it was published with, our own under the
 * slug this publish writes.
 */
function planCompMembers({ compBuilds, owner, force = false, slugOf, themeOf = () => "", newFileId, newKey }) {
  const members = {};
  const uploads = [];
  const foreign = [];
  for (const build of compBuilds) {
    const slug = slugOf(build);
    const theme = themeOf(build) || "";
    const { foreignOwner, needsRecord } = decideCompBuildPublish({ build, owner, force, slug });
    if (foreignOwner) {
      members[build.id] = {
        fileId: build.publishedFileId, key: build.publishedKey, owner: foreignOwner,
        slug: build.publishedSlug || slug, theme,
      };
      foreign.push({ id: build.id, title: build.title || build.profession || "Build", owner: foreignOwner });
      continue;
    }
    const fileId = build.publishedFileId || newFileId();
    const key = build.publishedKey || newKey();
    members[build.id] = { fileId, key, owner, slug, theme };
    uploads.push({ build, fileId, key, slug, needsRecord });
  }
  return { members, uploads, foreign };
}

/**
 * Returns the complete set of build IDs that must be included when publishing
 * a comp — the union of comp.buildIds and every build ID referenced in any
 * party line slot. This defends against divergence where a slot references a
 * build that is missing from comp.buildIds, which would produce an empty,
 * unlinkable slot on the published SPA page.
 *
 * @param {object} comp
 * @returns {string[]} deduplicated array of build IDs
 */
function getCompPublishBuildIds(comp) {
  const fromBuildIds = (comp.buildIds || []);
  const fromSlots = (comp.partyLines || [])
    // Slots may hold category references ("tag:<id>") — those aren't builds, skip them.
    .flatMap((l) => (l.slots || []).filter((s) => s && !String(s).startsWith("tag:")));
  return [...new Set([...fromBuildIds, ...fromSlots])];
}

module.exports = { serializeCompForPublish, getCompPublishBuildIds, resolveNotesClassIcons, planCompMembers };
