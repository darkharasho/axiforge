"use strict";

function serializeCompForPublish(comp, buildsMap) {
  const { id, name, notes, tags, gameMode, partyLines, buildColors, categories } = comp;
  return {
    id, name, notes, tags, gameMode, partyLines, buildColors,
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

module.exports = { serializeCompForPublish, getCompPublishBuildIds };
