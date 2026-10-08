"use strict";

// The one rule for turning an axicode import's traitChoices into majorChoices.
//
// Axicode imports store each specialization's major traits as traitChoices:
// 1-based positions within each tier. The build store keeps them alongside
// majorChoices (trait ids), which stay all zero until something resolves them.
// Publish, the editor, the SPA build page and the desktop comp coverage all
// need the same resolution, or a comp's coverage differs between the desktop
// and its published link. src/renderer/modules/trait-choices.js mirrors this
// as ESM; tests/unit/renderer/trait-choices.test.js locks the two in sync.

function traitId(entry) {
  if (entry == null) return 0;
  return Number(typeof entry === "object" ? entry.id : entry) || 0;
}

function hasTierLists(tiers) {
  return Boolean(tiers) && [1, 2, 3].some((t) => Array.isArray(tiers[t]) && tiers[t].length > 0);
}

/**
 * The spec's majorChoices, resolved from traitChoices when no major trait is
 * chosen yet. A spec with any chosen major trait is returned untouched: a tier
 * left blank there is the user's choice, not an unresolved import.
 *
 * Tier lists come from the spec's own majorTraitsByTier when stored, else from
 * `catalogTiers` ({1: [...], 2: [...], 3: [...]}, trait objects or ids, in
 * catalog order). A missing or out-of-range position takes the tier's first trait.
 *
 * @returns {{1: number, 2: number, 3: number}}
 */
function resolveMajorChoices(spec, catalogTiers) {
  const s = spec || {};
  const majorChoices = s.majorChoices || { 1: 0, 2: 0, 3: 0 };
  const tc = Array.isArray(s._traitChoices) ? s._traitChoices
    : Array.isArray(s.traitChoices) ? s.traitChoices : null;
  if (!tc || Object.values(majorChoices).some((v) => Number(v))) return majorChoices;

  const tiers = hasTierLists(s.majorTraitsByTier) ? s.majorTraitsByTier : (catalogTiers || {});
  const resolved = {};
  for (const tier of [1, 2, 3]) {
    const list = Array.isArray(tiers[tier]) ? tiers[tier] : [];
    const posIdx = (Number(tc[tier - 1]) || 1) - 1;
    resolved[tier] = traitId(list[posIdx]) || traitId(list[0]) || 0;
  }
  return resolved;
}

module.exports = { resolveMajorChoices };
