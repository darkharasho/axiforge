// Mirrors src/shared/traitChoices.js (CJS, used by the main process). The
// renderer and the SPA cannot import that CJS module -- Vite serves first-party
// CommonJS untransformed in dev -- so it is reimplemented here as ESM.
// tests/unit/renderer/trait-choices.test.js locks the two in sync.

function traitId(entry) {
  if (entry == null) return 0;
  return Number(typeof entry === "object" ? entry.id : entry) || 0;
}

function hasTierLists(tiers) {
  return Boolean(tiers) && [1, 2, 3].some((t) => Array.isArray(tiers[t]) && tiers[t].length > 0);
}

/**
 * The spec's majorChoices, resolved from axicode traitChoices (1-based tier
 * positions) when no major trait is chosen yet. See src/shared/traitChoices.js.
 */
export function resolveMajorChoices(spec, catalogTiers) {
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
