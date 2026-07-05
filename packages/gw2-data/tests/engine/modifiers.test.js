"use strict";

const { collectActiveTraitIds, isFuryTrait, collectModifiers } = require("../../src/engine/modifiers");

// ---------------------------------------------------------------------------
// Helpers — build minimal catalog and context objects for tests
// ---------------------------------------------------------------------------

function makeCtx(specs = [], gameMode = "pve") {
  return { specializations: specs, gameMode };
}

function makeCatalogs(traitMap = {}, specMap = {}) {
  return {
    traitById: new Map(Object.entries(traitMap).map(([k, v]) => [Number(k), v])),
    specializationById: new Map(Object.entries(specMap).map(([k, v]) => [Number(k), v])),
  };
}

function makeOverrides(entries = {}) {
  return new Map(Object.entries(entries));
}

// ---------------------------------------------------------------------------
// collectActiveTraitIds
// ---------------------------------------------------------------------------

describe("collectActiveTraitIds()", () => {
  it("collects major trait choices", () => {
    const ctx = makeCtx([
      { id: 4, majorChoices: { 1: 1444, 2: 1449, 3: 1437 } },
    ]);
    const catalogs = makeCatalogs({}, {});
    const ids = collectActiveTraitIds(ctx, catalogs);
    expect(ids).toContain(1444);
    expect(ids).toContain(1449);
    expect(ids).toContain(1437);
    expect(ids.size).toBe(3);
  });

  it("collects minor traits from spec data", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: {} }]);
    const catalogs = makeCatalogs({}, { 4: { minorTraits: [100, 200, 300] } });
    const ids = collectActiveTraitIds(ctx, catalogs);
    expect(ids).toContain(100);
    expect(ids).toContain(200);
    expect(ids).toContain(300);
  });

  it("supports specializationId key (editor format)", () => {
    const ctx = makeCtx([{ specializationId: 5, majorChoices: { 1: 555 } }]);
    const catalogs = makeCatalogs({}, { 5: { minorTraits: [999] } });
    const ids = collectActiveTraitIds(ctx, catalogs);
    expect(ids).toContain(555);
    expect(ids).toContain(999);
  });

  it("returns empty set with no specializations", () => {
    const ids = collectActiveTraitIds(makeCtx([]), makeCatalogs());
    expect(ids.size).toBe(0);
  });

  it("returns empty set when ctx.specializations is missing", () => {
    const ids = collectActiveTraitIds({}, makeCatalogs());
    expect(ids.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isFuryTrait
// ---------------------------------------------------------------------------

describe("isFuryTrait()", () => {
  it("returns true for a trait with a Buff(Fury) fact", () => {
    const trait = {
      facts: [
        { type: "Buff", status: "Fury" },
        { type: "AttributeAdjust", target: "Ferocity", value: 150 },
      ],
    };
    expect(isFuryTrait(trait, 9999, makeOverrides())).toBe(true);
  });

  it("returns true for the implicit fury trait (1719) via overrides", () => {
    const overrides = makeOverrides({ "trait:1719": { implicitFury: true } });
    const trait = { facts: [] }; // no Buff(Fury) fact
    expect(isFuryTrait(trait, 1719, overrides)).toBe(true);
  });

  it("returns false for a non-fury trait", () => {
    const trait = {
      facts: [{ type: "AttributeAdjust", target: "Power", value: 120 }],
    };
    expect(isFuryTrait(trait, 1234, makeOverrides())).toBe(false);
  });

  it("returns false when facts array is empty", () => {
    expect(isFuryTrait({ facts: [] }, 1234, makeOverrides())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectModifiers
// ---------------------------------------------------------------------------

describe("collectModifiers()", () => {
  it("collects flatBonus from AttributeAdjust facts", () => {
    const traitId = 1001;
    const trait = {
      slot: "Major",
      description: "Some trait",
      facts: [
        { type: "AttributeAdjust", target: "Power", value: 120 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const flatMods = mods.filter((m) => m.type === "flatBonus");
    expect(flatMods).toHaveLength(1);
    expect(flatMods[0]).toMatchObject({
      source: `trait:${traitId}`,
      type: "flatBonus",
      target: "Power",
      value: 120,
      condition: null,
    });
  });

  it("classifies fury-gated bonuses with condition: 'fury'", () => {
    const traitId = 1002;
    const trait = {
      slot: "Major",
      description: "Fury trait",
      facts: [
        { type: "Buff", status: "Fury" },
        { type: "AttributeAdjust", target: "Ferocity", value: 180 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const flatMods = mods.filter((m) => m.type === "flatBonus");
    expect(flatMods).toHaveLength(1);
    expect(flatMods[0].condition).toBe("fury");
    expect(flatMods[0].target).toBe("Ferocity");
  });

  it("keeps flat bonuses unconditional for fury-granter traits (unconditionalStats override)", () => {
    // Furious Demise (803): grants Fury on shroud entry, but its +180 Precision
    // is a flat passive that must not be gated behind assumed fury.
    const traitId = 803;
    const trait = {
      slot: "Minor",
      description: "Gain fury when entering shroud. Gain additional precision.",
      facts: [
        { type: "Buff", status: "Fury" },
        { type: "AttributeAdjust", target: "Precision", value: 180 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);
    const overrides = makeOverrides({ "trait:803": { unconditionalStats: true } });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const flatMods = mods.filter((m) => m.type === "flatBonus");
    expect(flatMods).toHaveLength(1);
    expect(flatMods[0]).toMatchObject({
      target: "Precision",
      value: 180,
      condition: null,
    });
  });

  it("excludes pet stat traits (trait 1016 via overrides)", () => {
    const traitId = 1016;
    const trait = {
      slot: "Major",
      description: "Pet trait",
      facts: [
        { type: "AttributeAdjust", target: "Power", value: 300 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);
    const overrides = makeOverrides({ "trait:1016": { petStatOnly: true } });

    const mods = collectModifiers(ctx, catalogs, overrides);
    expect(mods).toHaveLength(0);
  });

  it("collects conversion from BuffConversion facts", () => {
    const traitId = 1003;
    const trait = {
      slot: "Major",
      description: "Conversion trait",
      facts: [
        { type: "BuffConversion", source: "Toughness", target: "Power", percent: 10 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const convMods = mods.filter((m) => m.type === "conversion");
    expect(convMods).toHaveLength(1);
    expect(convMods[0]).toMatchObject({
      source: `trait:${traitId}`,
      type: "conversion",
      sourceAttr: "Toughness",
      target: "Power",
      percent: 10,
      condition: null,
    });
  });

  it("normalizes BoonDuration target via CONVERSION_TARGET_MAP", () => {
    const traitId = 1004;
    const trait = {
      slot: "Major",
      description: "Boon duration trait",
      facts: [
        { type: "BuffConversion", source: "Vitality", target: "BoonDuration", percent: 15 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const convMods = mods.filter((m) => m.type === "conversion");
    expect(convMods[0].target).toBe("Concentration");
  });

  it("collects critChance from Percent fact on fury trait", () => {
    const traitId = 1005;
    const trait = {
      slot: "Major",
      description: "Crit chance while furious",
      facts: [
        { type: "Buff", status: "Fury" },
        { type: "Percent", text: "Critical Chance Increase", percent: 10 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const critMods = mods.filter((m) => m.type === "critChance");
    expect(critMods).toHaveLength(1);
    expect(critMods[0]).toMatchObject({
      source: `trait:${traitId}`,
      type: "critChance",
      value: 10,
      condition: "fury",
    });
  });

  it("collects mightModifier from overrides (trait 1765)", () => {
    const traitId = 1765;
    const trait = {
      slot: "Major",
      description: "Notoriety",
      facts: [],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);
    const overrides = makeOverrides({
      "trait:1765": { mightOverride: { power: 40, condi: 20 } },
    });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const mightMods = mods.filter((m) => m.type === "mightModifier");
    expect(mightMods).toHaveLength(1);
    expect(mightMods[0]).toMatchObject({
      source: `trait:${traitId}`,
      type: "mightModifier",
      power: 40,
      condi: 20,
      condition: null,
    });
  });

  it("handles WvW game mode indexing (uses second fact value)", () => {
    const traitId = 1006;
    const trait = {
      slot: "Major",
      description: "WvW trait",
      facts: [
        // Two AttributeAdjust facts for same target: [0]=PvE, [1]=WvW
        { type: "AttributeAdjust", target: "Power", value: 150 },
        { type: "AttributeAdjust", target: "Power", value: 100 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctxWvw = makeCtx([{ id: 1, majorChoices: { 1: traitId } }], "wvw");

    const mods = collectModifiers(ctxWvw, catalogs, makeOverrides());
    const flatMods = mods.filter((m) => m.type === "flatBonus" && m.target === "Power");
    expect(flatMods).toHaveLength(1);
    expect(flatMods[0].value).toBe(100); // WvW value (index 1)
  });

  it("uses PvE value (index 0) by default", () => {
    const traitId = 1007;
    const trait = {
      slot: "Major",
      description: "PvE trait",
      facts: [
        { type: "AttributeAdjust", target: "Precision", value: 200 },
        { type: "AttributeAdjust", target: "Precision", value: 150 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }], "pve");

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const flatMods = mods.filter((m) => m.type === "flatBonus" && m.target === "Precision");
    expect(flatMods[0].value).toBe(200);
  });

  it("does not collect burstRecharge from Primal Rage (no recharge reduction)", () => {
    const traitId = 1831;
    const trait = { slot: "Major", description: "Primal Rage", facts: [] };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);
    const overrides = makeOverrides({ "trait:1831": { description: "no burst recharge" } });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const burstMods = mods.filter((m) => m.type === "burstRecharge");
    expect(burstMods).toHaveLength(0);
  });

  it("collects burstRecharge from minor trait with Recharge Reduced Percent fact", () => {
    const traitId = 2001;
    const trait = {
      slot: "Minor",
      description: "Reduces burst skill recharge",
      facts: [
        { type: "Percent", text: "Recharge Reduced", percent: 20 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const burstMods = mods.filter((m) => m.type === "burstRecharge");
    expect(burstMods).toHaveLength(1);
    expect(burstMods[0].value).toBe(20);
  });

  it("returns empty array when no active traits", () => {
    const catalogs = makeCatalogs({});
    const ctx = makeCtx([]);
    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    expect(mods).toEqual([]);
  });

  it("returns empty array when catalogs.traitById is missing", () => {
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: 999 } }]);
    const mods = collectModifiers(ctx, {}, makeOverrides());
    expect(mods).toEqual([]);
  });

  // Blood Reaction bug: GW2 API returns multiple BuffConversion facts for
  // same source→target pair with different percentages (PvE/WvW variants).
  // Only the first (PvE) or second (WvW) should be used — not all summed.
  it("marks berserkConditional override traits with condition: 'berserk'", () => {
    const traitId = 2046;
    const trait = {
      slot: "Minor",
      description: "Fatal Frenzy",
      facts: [
        { type: "AttributeAdjust", target: "Power", value: 150 },
        { type: "AttributeAdjust", target: "ConditionDamage", value: 300 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);
    const overrides = makeOverrides({ "trait:2046": { berserkConditional: true } });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const flatMods = mods.filter((m) => m.type === "flatBonus");
    expect(flatMods).toHaveLength(2);
    expect(flatMods[0].condition).toBe("berserk");
    expect(flatMods[1].condition).toBe("berserk");
  });

  it("uses wvwFacts for flatBonus when gameMode is wvw and wvwFacts exists", () => {
    const traitId = 2046;
    const trait = {
      slot: "Minor",
      description: "Fatal Frenzy",
      facts: [
        { type: "AttributeAdjust", target: "Power", value: 300 },
        { type: "AttributeAdjust", target: "ConditionDamage", value: 300 },
      ],
      wvwFacts: [
        { type: "AttributeAdjust", target: "Power", value: 150 },
        { type: "AttributeAdjust", target: "ConditionDamage", value: 300 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const overrides = makeOverrides({ "trait:2046": { berserkConditional: true } });

    const wvwMods = collectModifiers(
      makeCtx([{ id: 1, majorChoices: { 1: traitId } }], "wvw"),
      catalogs, overrides
    );
    const wvwFlat = wvwMods.filter((m) => m.type === "flatBonus");
    expect(wvwFlat).toHaveLength(2);
    const powerMod = wvwFlat.find((m) => m.target === "Power");
    const condiMod = wvwFlat.find((m) => m.target === "ConditionDamage");
    expect(powerMod.value).toBe(150);
    expect(condiMod.value).toBe(300);

    // PvE should still use trait.facts
    const pveMods = collectModifiers(
      makeCtx([{ id: 1, majorChoices: { 1: traitId } }], "pve"),
      catalogs, overrides
    );
    const pveFlat = pveMods.filter((m) => m.type === "flatBonus");
    const pvePower = pveFlat.find((m) => m.target === "Power");
    expect(pvePower.value).toBe(300);
  });

  it("uses wvwFacts for conversions when gameMode is wvw and wvwFacts exists", () => {
    const traitId = 2011;
    const trait = {
      slot: "Major",
      description: "Blood Reaction",
      facts: [
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 12 },
        { type: "BuffConversion", source: "Power", target: "ConditionDamage", percent: 15 },
      ],
      wvwFacts: [
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 5 },
        { type: "BuffConversion", source: "Power", target: "ConditionDamage", percent: 10 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });

    const wvwMods = collectModifiers(
      makeCtx([{ id: 1, majorChoices: { 1: traitId } }], "wvw"),
      catalogs, makeOverrides()
    );
    const convMods = wvwMods.filter((m) => m.type === "conversion");
    expect(convMods).toHaveLength(2);
    expect(convMods.find((m) => m.target === "Ferocity").percent).toBe(5);
    expect(convMods.find((m) => m.target === "ConditionDamage").percent).toBe(10);
  });

  it("deduplicates BuffConversion facts by source+target (PvE picks first)", () => {
    const traitId = 2011;
    const trait = {
      slot: "Major",
      description: "Blood Reaction",
      facts: [
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 12 },
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 10 },
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 5 },
        { type: "BuffConversion", source: "Power", target: "ConditionDamage", percent: 10 },
        { type: "BuffConversion", source: "Power", target: "ConditionDamage", percent: 15 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }], "pve");

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const convMods = mods.filter((m) => m.type === "conversion");
    expect(convMods).toHaveLength(2);
    expect(convMods[0]).toMatchObject({ sourceAttr: "Precision", target: "Ferocity", percent: 12 });
    expect(convMods[1]).toMatchObject({ sourceAttr: "Power", target: "ConditionDamage", percent: 10 });
  });

  it("deduplicates BuffConversion facts by source+target (WvW picks second)", () => {
    const traitId = 2011;
    const trait = {
      slot: "Major",
      description: "Blood Reaction",
      facts: [
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 12 },
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 10 },
        { type: "BuffConversion", source: "Precision", target: "CritDamage", percent: 5 },
        { type: "BuffConversion", source: "Power", target: "ConditionDamage", percent: 10 },
        { type: "BuffConversion", source: "Power", target: "ConditionDamage", percent: 15 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }], "wvw");

    const mods = collectModifiers(ctx, catalogs, makeOverrides());
    const convMods = mods.filter((m) => m.type === "conversion");
    expect(convMods).toHaveLength(2);
    expect(convMods[0]).toMatchObject({ sourceAttr: "Precision", target: "Ferocity", percent: 10 });
    expect(convMods[1]).toMatchObject({ sourceAttr: "Power", target: "ConditionDamage", percent: 15 });
  });

  it("skips AttributeAdjust facts for traits with mightOverride (Pinnacle of Strength)", () => {
    const traitId = 1453;
    const trait = {
      slot: "Minor",
      description: "Might applied to you grants more power. Your critical-hit chance is increased.",
      facts: [
        { type: "AttributeAdjust", target: "Power", value: 10 },
        { type: "Percent", text: "Critical Chance Increase", percent: 5 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait }, { 4: { minorTraits: [1453] } });
    const ctx = makeCtx([{ specializationId: 4, majorChoices: {} }]);
    const overrides = makeOverrides({
      "trait:1453": { mightOverride: { power: 40 } },
    });

    const mods = collectModifiers(ctx, catalogs, overrides);
    // Should NOT have a flatBonus for Power (the +10 is part of mightOverride)
    const flatMods = mods.filter((m) => m.type === "flatBonus");
    expect(flatMods).toHaveLength(0);
    // Should have a mightModifier
    const mightMods = mods.filter((m) => m.type === "mightModifier");
    expect(mightMods).toHaveLength(1);
    expect(mightMods[0]).toMatchObject({ power: 40, condition: null });
  });

  it("ignores critChance for traits with ignoreCritChance override (issue #209)", () => {
    // Traits like Precise Strike (1011), Hidden Killer (1215), and Burst Precision (1336)
    // have percent:100 "Critical Chance Increase" facts that represent skill-specific bonuses,
    // not passive crit chance increases. They must be excluded.
    const traitId = 1011;
    const trait = {
      slot: "Minor",
      description: "Opening Strike has an increased chance to critically strike.",
      facts: [
        { type: "Percent", text: "Critical Chance Increase", percent: 100 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait }, { 8: { minorTraits: [1011] } });
    const ctx = makeCtx([{ specializationId: 8, majorChoices: {} }]);
    const overrides = makeOverrides({
      "trait:1011": { ignoreCritChance: true },
    });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const critMods = mods.filter((m) => m.type === "critChance");
    expect(critMods).toHaveLength(0);
  });

  it("collects passive critChance from non-fury traits (Pinnacle of Strength)", () => {
    const traitId = 1453;
    const trait = {
      slot: "Minor",
      description: "Might applied to you grants more power. Your critical-hit chance is increased.",
      facts: [
        { type: "AttributeAdjust", target: "Power", value: 10 },
        { type: "Percent", text: "Critical Chance Increase", percent: 5 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait }, { 4: { minorTraits: [1453] } });
    const ctx = makeCtx([{ specializationId: 4, majorChoices: {} }]);
    const overrides = makeOverrides({
      "trait:1453": { mightOverride: { power: 40 } },
    });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const critMods = mods.filter((m) => m.type === "critChance");
    expect(critMods).toHaveLength(1);
    expect(critMods[0]).toMatchObject({
      source: "trait:1453",
      type: "critChance",
      value: 5,
      condition: null,
    });
  });

  it("emits critChance with condition:'berserk' for berserkConditional trait (Smash Brawler)", () => {
    const traitId = 2049;
    const trait = {
      slot: "Major",
      description: "Smash Brawler",
      facts: [
        { type: "Percent", text: "Critical Chance Increase", percent: 15 },
        { type: "Percent", text: "Critical Chance Increase", percent: 5 },
      ],
    };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 18, majorChoices: { 1: traitId } }]);
    const overrides = makeOverrides({ "trait:2049": { berserkConditional: true } });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const critMods = mods.filter((m) => m.type === "critChance");
    expect(critMods).toHaveLength(1);
    expect(critMods[0]).toMatchObject({
      source: "trait:2049",
      type: "critChance",
      value: 15,
      condition: "berserk",
    });
  });
});

// ---------------------------------------------------------------------------
// Trait heal-amount facts vs Healing Power stat facts (issue: GW2Skills-imported
// Spectre build showed 3020 Healing Power — trait heal amounts like Shadow
// Savior's 596 were counted as flat Healing Power stat bonuses)
// ---------------------------------------------------------------------------

describe("collectModifiers() — heal-amount facts are not stat bonuses", () => {
  function modsForTrait(traitId, trait, ctxExtra = {}) {
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = { ...makeCtx([{ id: 20, majorChoices: { 1: traitId } }]), ...ctxExtra };
    return collectModifiers(ctx, catalogs, makeOverrides());
  }

  it("ignores heal-amount facts (target Healing, text 'Healing') — Shadow Savior", () => {
    const mods = modsForTrait(1297, {
      slot: "Major",
      facts: [
        { text: "Healing", type: "AttributeAdjust", value: 596, target: "Healing" },
        { text: "Radius", type: "Distance", distance: 360 },
      ],
    });
    expect(mods.filter((m) => m.type === "flatBonus")).toHaveLength(0);
  });

  it("ignores barrier and life-siphon facts (target Healing, other texts)", () => {
    const mods = modsForTrait(1160, {
      slot: "Major",
      facts: [
        { text: "Barrier", type: "AttributeAdjust", value: 1044, target: "Healing" },
        { text: "Life Siphon Healing", type: "AttributeAdjust", value: 325, target: "Healing" },
      ],
    });
    expect(mods.filter((m) => m.type === "flatBonus")).toHaveLength(0);
  });

  it("keeps textless target-Healing facts as HealingPower stat bonuses — Imbued Haste", () => {
    const mods = modsForTrait(2148, {
      slot: "Major",
      facts: [
        { type: "AttributeAdjust", value: 250, target: "Healing" },
        { type: "AttributeAdjust", value: 150, target: "Healing" },
      ],
    }, { gameMode: "wvw" });
    const heal = mods.filter((m) => m.type === "flatBonus" && m.target === "HealingPower");
    expect(heal).toHaveLength(1);
    expect(heal[0].value).toBe(150); // WvW split picks index 1
  });

  it("keeps 'Healing Power …' texted facts as stat bonuses — Last Rites style", () => {
    const mods = modsForTrait(1931, {
      slot: "Major",
      facts: [
        { text: "Healing Power above 75% Health", type: "AttributeAdjust", value: 150, target: "Healing" },
      ],
    });
    const heal = mods.filter((m) => m.type === "flatBonus" && m.target === "HealingPower");
    expect(heal).toHaveLength(1);
    expect(heal[0].value).toBe(150);
  });

  it("keeps textless AttributeAdjust facts for other targets — Preparedness", () => {
    const mods = modsForTrait(1232, {
      slot: "Minor",
      facts: [
        { type: "AttributeAdjust", value: 150, target: "ConditionDuration" },
      ],
    });
    const exp = mods.filter((m) => m.type === "flatBonus" && m.target === "Expertise");
    expect(exp).toHaveLength(1);
    expect(exp[0].value).toBe(150);
  });

  it("ignores life-siphon damage amounts (target Power) — Vampiric Presence", () => {
    const mods = modsForTrait(1844, {
      slot: "Minor",
      facts: [
        { text: "Life Siphon Damage", type: "AttributeAdjust", value: 32, target: "Power" },
        { text: "Damage while in Shroud", type: "AttributeAdjust", value: 62, target: "Power" },
      ],
    });
    expect(mods.filter((m) => m.type === "flatBonus")).toHaveLength(0);
  });

  it("keeps attribute-named texted facts — Zealous Blade, Aeromancer's Training", () => {
    const mods = modsForTrait(646, {
      slot: "Major",
      facts: [
        { text: "Power While Wielding Greatsword", type: "AttributeAdjust", value: 120, target: "Power" },
        { text: "Additional Ferocity", type: "AttributeAdjust", value: 150, target: "CritDamage" },
      ],
    });
    const flat = mods.filter((m) => m.type === "flatBonus");
    expect(flat.map((m) => [m.target, m.value]).sort()).toEqual([["Ferocity", 150], ["Power", 120]]);
  });
});

// ---------------------------------------------------------------------------
// Second Opinion (2284) — condition damage doubled while wielding a scepter.
// Uses the real overrides.json entry + real API fact shape.
// ---------------------------------------------------------------------------

describe("collectModifiers() — Second Opinion weaponConditional (real overrides)", () => {
  const { loadOverrides } = require("../../src/engine/overrides");
  const OVERRIDES = loadOverrides();
  const TRAIT = {
    slot: "Major",
    facts: [
      { text: "Attribute Conversion", type: "BuffConversion", percent: 7, source: "ConditionDamage", target: "Healing" },
      { type: "AttributeAdjust", value: 90, target: "ConditionDamage" },
      { text: "Additional Condition Damage", type: "AttributeAdjust", value: 90, target: "ConditionDamage" },
    ],
  };

  function mods(weapons, gameMode = "wvw") {
    const catalogs = makeCatalogs({ 2284: TRAIT });
    const ctx = {
      ...makeCtx([{ id: 71, majorChoices: { 1: 2284 } }], gameMode),
      equipment: { weapons },
      activeWeaponSet: 1,
      underwaterMode: false,
    };
    return collectModifiers(ctx, catalogs, OVERRIDES);
  }

  it("without a scepter: +90 Condition Damage", () => {
    const condi = mods({ mainhand1: "dagger" }).filter((m) => m.type === "flatBonus" && m.target === "ConditionDamage");
    expect(condi).toHaveLength(1);
    expect(condi[0].value).toBe(90);
  });

  it("with a scepter in the active set: doubled to +180 Condition Damage", () => {
    const condi = mods({ mainhand1: "scepter", offhand1: "pistol" }).filter((m) => m.type === "flatBonus" && m.target === "ConditionDamage");
    expect(condi).toHaveLength(1);
    expect(condi[0].value).toBe(180);
  });

  it("keeps the 7% ConditionDamage → HealingPower conversion", () => {
    const conv = mods({ mainhand1: "scepter" }).filter((m) => m.type === "conversion");
    expect(conv).toHaveLength(1);
    expect(conv[0]).toMatchObject({ sourceAttr: "ConditionDamage", target: "HealingPower", percent: 7 });
  });
});
