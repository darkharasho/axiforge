"use strict";

/**
 * Pick the fact list that applies to a game mode.
 *
 * The wiki pipeline splits mode-specific facts out of the API's single `facts`
 * list: `facts` holds the PvE values, `wvwFacts` / `pvpFacts` hold the
 * competitive splits (see packages/gw2-data/src/wiki/resolver.js). An entity
 * with no split simply has no per-mode arrays.
 *
 * An *empty* per-mode array is meaningful — it means every fact on the page is
 * tagged for other modes, e.g. Feverish Pulse's alacrity is PvE-only — so it is
 * returned as-is rather than falling back to PvE. The catalog only records the
 * per-mode arrays when the wiki actually parsed fact templates, so an empty
 * array never stands for "the wiki told us nothing".
 *
 * @param {Object} entity - Skill, trait or relic with `facts` and optional mode splits
 * @param {string} [gameMode] - "pve" | "wvw" | "pvp"
 * @returns {Object[]}
 */
function factsForMode(entity, gameMode) {
  if (!entity) return [];
  if (gameMode === "wvw" && Array.isArray(entity.wvwFacts)) return entity.wvwFacts;
  if (gameMode === "pvp" && Array.isArray(entity.pvpFacts)) return entity.pvpFacts;
  return entity.facts || [];
}

module.exports = { factsForMode };
