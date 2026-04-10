"use strict";

const { CONVERSION_TARGET_MAP } = require("./constants");

// ---------------------------------------------------------------------------
// Modifiers module — collects active trait IDs and classifies facts into
// typed modifier objects. Pure functions — no DOM, no renderer state.
// ---------------------------------------------------------------------------

/**
 * Collect all active trait IDs — major choices + minor (auto-selected) traits.
 *
 * @param {Object} ctx - Build context
 * @param {Array} ctx.specializations - Array of specialization objects
 * @param {Object} catalogs - Catalog data
 * @param {Object} catalogs.specializationById - Map<number, { minorTraits: number[] }>
 * @returns {Set<number>}
 */
function collectActiveTraitIds(ctx, catalogs) {
  const ids = new Set();
  if (!ctx || !Array.isArray(ctx.specializations)) return ids;

  for (const spec of ctx.specializations) {
    if (!spec) continue;

    // Collect major trait choices
    for (const id of Object.values(spec.majorChoices || {})) {
      const n = Number(id);
      if (n) ids.add(n);
    }

    // Collect minor traits from catalog
    const specId = Number(spec.specializationId || spec.id) || 0;
    const specData = (specId && catalogs?.specializationById)
      ? catalogs.specializationById.get(specId)
      : null;
    for (const minorId of specData?.minorTraits || []) {
      if (minorId) ids.add(Number(minorId));
    }
  }

  return ids;
}

/**
 * Check whether a trait is fury-related: has a Buff(Fury) fact or is marked
 * with implicitFury in overrides.
 *
 * @param {Object} trait - Trait object with facts array
 * @param {number} traitId - The trait's ID
 * @param {Map} overrides - Overrides map (string key → object)
 * @returns {boolean}
 */
function isFuryTrait(trait, traitId, overrides) {
  const override = overrides?.get(`trait:${traitId}`);
  if (override?.implicitFury) return true;
  return trait.facts?.some((f) => f.type === "Buff" && f.status === "Fury") || false;
}

/**
 * Collect typed modifier objects from active traits.
 *
 * Modifier types emitted:
 *   - flatBonus:      { source, type, target, value, condition }
 *   - conversion:     { source, type, sourceAttr, target, percent, condition }
 *   - critChance:     { source, type, value, condition }
 *   - mightModifier:  { source, type, power, condi, condition }
 *   - burstRecharge:  { source, type, value, condition }
 *
 * @param {Object} ctx - Build context (has .specializations, .gameMode)
 * @param {Object} catalogs - Catalog data (has .traitById, .specializationById)
 * @param {Map} overrides - Overrides map from loadOverrides()
 * @returns {Array<Object>}
 */
function collectModifiers(ctx, catalogs, overrides) {
  const modifiers = [];
  if (!catalogs?.traitById) return modifiers;

  const gameMode = ctx?.gameMode || "pve";
  const activeTraitIds = collectActiveTraitIds(ctx, catalogs);
  if (!activeTraitIds.size) return modifiers;

  for (const traitId of activeTraitIds) {
    const source = `trait:${traitId}`;
    const override = overrides?.get(source) || null;

    // 1. Skip pet-stat-only traits
    if (override?.petStatOnly) continue;

    const trait = catalogs.traitById.get(traitId);

    // 2. mightOverride — emit mightModifier (no trait facts needed)
    if (override?.mightOverride) {
      modifiers.push({
        source,
        type: "mightModifier",
        power: override.mightOverride.power,
        condi: override.mightOverride.condi,
        condition: null,
      });
    }

    // 3. burstRechargeReduction from overrides
    if (override?.burstRechargeReduction != null) {
      modifiers.push({
        source,
        type: "burstRecharge",
        value: override.burstRechargeReduction,
        condition: null,
      });
    }

    if (!trait?.facts) continue;

    // Use per-mode facts when the wiki pipeline has separated them;
    // fall back to trait.facts (which may contain mixed-mode duplicates).
    const modeFacts = gameMode === "wvw" && trait.wvwFacts ? trait.wvwFacts
      : gameMode === "pvp" && trait.pvpFacts ? trait.pvpFacts
      : trait.facts;

    const fury = isFuryTrait(trait, traitId, overrides);
    const condition = override?.berserkConditional ? "berserk"
      : fury ? "fury" : null;

    // 4. AttributeAdjust facts — flatBonus
    const byTarget = new Map();
    for (const fact of modeFacts) {
      if (fact.type !== "AttributeAdjust" || !fact.target || fact.value == null) continue;
      if (!byTarget.has(fact.target)) byTarget.set(fact.target, []);
      byTarget.get(fact.target).push(fact.value);
    }
    for (const [target, values] of byTarget) {
      const statKey = CONVERSION_TARGET_MAP[target] || target;
      const idx = gameMode === "wvw" ? Math.min(1, values.length - 1) : 0;
      modifiers.push({
        source,
        type: "flatBonus",
        target: statKey,
        value: values[idx],
        condition,
      });
    }

    // 5. BuffConversion / AttributeConversion facts — conversion
    //    Group by source+target pair and pick PvE (index 0) or WvW (index 1),
    //    mirroring the dedup logic used for AttributeAdjust facts above.
    const convByPair = new Map();
    for (const fact of modeFacts) {
      if (fact.type !== "AttributeConversion" && fact.type !== "BuffConversion") continue;
      if (!fact.source || !fact.target || !fact.percent) continue;
      const pairKey = `${fact.source}|${fact.target}`;
      if (!convByPair.has(pairKey)) convByPair.set(pairKey, []);
      convByPair.get(pairKey).push(fact);
    }
    for (const [, facts] of convByPair) {
      const idx = gameMode === "wvw" ? Math.min(1, facts.length - 1) : 0;
      const fact = facts[idx];
      const targetKey = CONVERSION_TARGET_MAP[fact.target] || fact.target;
      modifiers.push({
        source,
        type: "conversion",
        sourceAttr: fact.source,
        target: targetKey,
        percent: fact.percent,
        condition: null,
      });
    }

    // 6. Fury traits with "Critical Chance Increase" Percent facts — critChance
    if (fury) {
      const critFacts = modeFacts.filter(
        (f) => f.type === "Percent" && f.text === "Critical Chance Increase" && f.percent
      );
      if (critFacts.length > 0) {
        const idx = gameMode === "wvw" ? Math.min(1, critFacts.length - 1) : 0;
        modifiers.push({
          source,
          type: "critChance",
          value: critFacts[idx].percent,
          condition: "fury",
        });
      }
    }

    // 7. Minor traits with "burst" in description and "Recharge Reduced" Percent facts
    if (trait.slot === "Minor" && trait.description?.toLowerCase().includes("burst")) {
      const rechargeFacts = modeFacts.filter(
        (f) => f.type === "Percent" && f.text === "Recharge Reduced" && f.percent
      );
      for (const fact of rechargeFacts) {
        modifiers.push({
          source,
          type: "burstRecharge",
          value: fact.percent,
          condition: null,
        });
      }
    }
  }

  return modifiers;
}

module.exports = { collectActiveTraitIds, isFuryTrait, collectModifiers };
