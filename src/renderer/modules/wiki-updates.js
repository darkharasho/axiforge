import { state } from "./state.js";

/**
 * Request wiki fact resolution for entities missing wiki facts.
 * @param {Object[]} entities - Array of { id, name }
 * @returns {Promise<Object>} - Map of id → { pve, wvw, pvp, hasSplit }
 */
export async function requestWikiFacts(entities) {
  const unresolved = entities.filter(
    (e) => !state.wikiResolution.resolved.has(e.id) && !state.wikiResolution.pending.has(e.id)
  );
  if (unresolved.length === 0) return {};

  for (const e of unresolved) {
    state.wikiResolution.pending.add(e.id);
  }

  try {
    const result = await window.desktopApi.resolveEntityFacts(unresolved);

    const catalog = state.activeCatalog;
    if (catalog) {
      for (const [idStr, facts] of Object.entries(result)) {
        const id = Number(idStr);
        const entity =
          catalog.skillById?.get(id) ||
          catalog.traitById?.get(id) ||
          catalog.weaponSkillById?.get(id);

        if (entity) {
          entity.facts = facts.pve;
          entity.hasSplit = facts.hasSplit;
          if (facts.wvw) entity.wvwFacts = facts.wvw;
          if (facts.pvp) entity.pvpFacts = facts.pvp;
        }

        state.wikiResolution.resolved.add(id);
        state.wikiResolution.pending.delete(id);
      }
    }

    return result;
  } catch (err) {
    console.warn("[wiki-updates] Failed to resolve wiki facts:", err.message);
    for (const e of unresolved) {
      state.wikiResolution.pending.delete(e.id);
    }
    return {};
  }
}

/**
 * Reset wiki resolution tracking (e.g. when switching professions).
 */
export function resetWikiResolution() {
  state.wikiResolution.pending.clear();
  state.wikiResolution.resolved.clear();
}
