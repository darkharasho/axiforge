"use strict";

/**
 * Hydrates raw JSON catalog data (arrays) into the Map-based shape
 * expected by the engine's computeAttributes function.
 */
function hydrateCatalogs(raw) {
  return {
    traitById: new Map((raw.traits || []).map((t) => [t.id, t])),
    skillById: new Map((raw.skills || []).map((s) => [s.id, s])),
    specializationById: new Map((raw.specializations || []).map((s) => [s.id, s])),
    runeById: new Map((raw.runes || []).map((r) => [r.id, r])),
    foodById: new Map((raw.foods || []).map((f) => [f.id, f])),
    utilityById: new Map((raw.utilities || []).map((u) => [u.id, u])),
    infusionById: new Map((raw.infusions || []).map((i) => [i.id, i])),
    enrichmentById: new Map((raw.enrichments || []).map((e) => [e.id, e])),
  };
}

module.exports = { hydrateCatalogs };
