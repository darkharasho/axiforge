"use strict";

/**
 * Regression test for issue #245: App vs Published Build using different formulas.
 *
 * Root cause: render-build.js built specializationById with minorTraits as enriched
 * objects (e.g. { id: 100, name: "...", facts: [...] }). The engine's
 * collectActiveTraitIds calls Number(minorId) on each item — Number(object) = NaN,
 * so ALL minor traits were silently skipped in the SPA.
 *
 * Fix: normalize minorTraits to IDs when building the specializationById map.
 * This makes the engine correctly apply minor trait conversions and mightModifiers.
 */

const { collectActiveTraitIds } = require("../../packages/gw2-data/src/engine/modifiers");

describe("SPA minor traits normalization (issue #245)", () => {
  it("correctly collects minor trait IDs when minorTraits are numbers", () => {
    const ctx = { specializations: [{ id: 18, majorChoices: {} }] };
    const catalogs = {
      specializationById: new Map([[18, { minorTraits: [1707, 1708, 1709] }]]),
    };
    const ids = collectActiveTraitIds(ctx, catalogs);
    expect(ids).toContain(1707);
    expect(ids).toContain(1708);
    expect(ids).toContain(1709);
  });

  it("correctly collects minor trait IDs when minorTraits are enriched objects (SPA publish format)", () => {
    // The SPA builds specializationById from build.specializations where
    // minorTraits are objects like { id: 1707, name: "Berserker's Power", facts: [...] }.
    // Before the fix, Number({ id: 1707, ... }) = NaN, so these were silently dropped.
    const ctx = { specializations: [{ id: 18, majorChoices: {} }] };
    const catalogs = {
      specializationById: new Map([[18, {
        minorTraits: [
          { id: 1707, name: "Berserker's Power", facts: [] },
          { id: 1708, name: "King of Fires", facts: [] },
          { id: 1709, name: "Primal Fury", facts: [] },
        ],
      }]]),
    };
    const ids = collectActiveTraitIds(ctx, catalogs);
    expect(ids).toContain(1707);
    expect(ids).toContain(1708);
    expect(ids).toContain(1709);
  });

  it("applies mightModifier override when minor Berserker trait is active", () => {
    // Trait 1765 (Notoriety) has mightOverride { power: 40, condi: 20 }.
    // If it's a minor trait and minorTraits are objects, the override is never applied
    // → engine uses default 30/30 per stack instead of 40/20.
    const { computeAttributes } = require("../../packages/gw2-data/src/engine/attributes");

    const ctx = {
      profession: "Warrior",
      specializations: [{ id: 18, specializationId: 18, majorChoices: {} }],
      equipment: { slots: {}, weapons: {}, runes: {}, sigils: {}, infusions: {} },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: {},
      assumedBoons: { might: 1 }, // 1 Might stack to test per-stack values
    };

    // With minorTraits as IDs (correct) — trait 1765 override applies (40P/20CD per stack)
    const catalogsWithIds = {
      specializationById: new Map([[18, { minorTraits: [1765] }]]),
      traitById: new Map([[1765, { id: 1765, name: "Notoriety", facts: [] }]]),
      skillById: new Map(),
      runeById: new Map(),
      foodById: new Map(),
      utilityById: new Map(),
      infusionById: new Map(),
      enrichmentById: new Map(),
    };
    const resultWithIds = computeAttributes(ctx, catalogsWithIds);
    // Trait 1765 mightOverride: 40 Power per stack
    expect(resultWithIds.boons.Power).toBe(40);
    expect(resultWithIds.boons.ConditionDamage).toBe(20);

    // With minorTraits as objects (pre-fix SPA bug) — trait 1765 NOT applied (30P/30CD default)
    const catalogsWithObjects = {
      specializationById: new Map([[18, {
        minorTraits: [{ id: 1765, name: "Notoriety", facts: [] }],
      }]]),
      traitById: new Map([[1765, { id: 1765, name: "Notoriety", facts: [] }]]),
      skillById: new Map(),
      runeById: new Map(),
      foodById: new Map(),
      utilityById: new Map(),
      infusionById: new Map(),
      enrichmentById: new Map(),
    };
    const resultWithObjects = computeAttributes(ctx, catalogsWithObjects);
    // Bug: without fix, objects in minorTraits → default 30/30 per stack
    // After fix: objects handled → 40/20 per stack
    expect(resultWithObjects.boons.Power).toBe(40);
    expect(resultWithObjects.boons.ConditionDamage).toBe(20);
  });
});
