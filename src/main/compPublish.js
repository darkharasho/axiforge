"use strict";

function serializeCompForPublish(comp, buildsMap) {
  const { id, name, notes, tags, gameMode, partyLines } = comp;
  return {
    id, name, notes, tags, gameMode, partyLines,
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
    .flatMap((l) => (l.slots || []).filter(Boolean));
  return [...new Set([...fromBuildIds, ...fromSlots])];
}

module.exports = { serializeCompForPublish, getCompPublishBuildIds };
