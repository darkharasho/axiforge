"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

function serializeCompForPublish(comp, buildsMap) {
  const { id, name, notes, tags, gameMode, partyLines, buildColors, categories, images } = comp;
  return {
    id, name, notes, tags, gameMode, partyLines, buildColors,
    // Screenshots pasted into comp notes, keyed by the ~img:<key> tokens the
    // notes markdown references.
    images: images || {},
    // Class icons for the :Firebrand: emoji used in the notes, keyed by name.
    notesClassIcons: resolveNotesClassIcons(notes),
    // Comp-scoped build categories, so published comps can render tag slots
    // (the "tag:<id>" entries in partyLines.slots) with their icon and hover.
    categories: categories || [],
    builds: { ...buildsMap },
  };
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

module.exports = { serializeCompForPublish, getCompPublishBuildIds, resolveNotesClassIcons };
