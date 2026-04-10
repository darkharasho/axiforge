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

  it("collects burstRecharge from overrides", () => {
    const traitId = 1831;
    const trait = { slot: "Major", description: "Primal Rage", facts: [] };
    const catalogs = makeCatalogs({ [traitId]: trait });
    const ctx = makeCtx([{ id: 1, majorChoices: { 1: traitId } }]);
    const overrides = makeOverrides({ "trait:1831": { burstRechargeReduction: 10 } });

    const mods = collectModifiers(ctx, catalogs, overrides);
    const burstMods = mods.filter((m) => m.type === "burstRecharge");
    expect(burstMods).toHaveLength(1);
    expect(burstMods[0]).toMatchObject({
      source: `trait:${traitId}`,
      type: "burstRecharge",
      value: 10,
      condition: null,
    });
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
});
