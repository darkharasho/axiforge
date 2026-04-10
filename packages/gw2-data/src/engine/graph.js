"use strict";

/**
 * Build a trait/skill interaction graph from wiki relations data.
 *
 * @param {Set<number>} activeTraitIds - Currently active trait IDs
 * @param {Map<number, { skills: number[], traits: number[] }>} relations - Relations data per trait
 * @returns {Map<number, { relatedSkills: Set<number>, relatedTraits: Set<number> }>}
 */
function buildInteractionGraph(activeTraitIds, relations) {
  const graph = new Map();

  for (const traitId of activeTraitIds) {
    const rel = relations.get(traitId);
    graph.set(traitId, {
      relatedSkills: new Set(rel?.skills || []),
      relatedTraits: new Set(rel?.traits || []),
    });
  }

  return graph;
}

module.exports = { buildInteractionGraph };
