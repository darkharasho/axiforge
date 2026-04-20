"use strict";

/**
 * Parametric property tests over the broad trait fixture set.
 *
 * Verifies engine invariants hold for all 210 stat-affecting traits
 * captured from the live GW2 API. No hand-written per-trait assertions —
 * the fixture data drives both the input and the expected output.
 *
 * Properties tested:
 *   1. AttributeAdjust WvW split — PvE picks facts[0], WvW picks facts[1]
 *   2. Conversion WvW split — same index logic for BuffConversion/AttributeConversion
 *   3. critChance WvW split — same index logic for Percent "Critical Chance Increase"
 *   4. petStatOnly — no modifiers emitted
 *   5. ignoreCritChance — no critChance modifier emitted
 *   6. berserkConditional — all emitted modifiers have condition "berserk"
 *   7. mightOverride — emits mightModifier, suppresses flatBonus from AttributeAdjust
 *
 * Run:  npx jest --rootDir packages/gw2-data modifiers-parametric
 */

const path = require("path");
const { collectModifiers } = require("../../src/engine/modifiers");
const { loadOverrides } = require("../../src/engine/overrides");
const { CONVERSION_TARGET_MAP } = require("../../src/engine/constants");

const BROAD = require(path.join(__dirname, "../fixtures/fixtures-broad.json"));
const OVERRIDES = loadOverrides();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DUMMY_SPEC_ID = 9999;

function getMods(trait, gameMode, weaponTypes = []) {
  const traitId = trait.id;
  const specId = trait.specId || DUMMY_SPEC_ID;
  const weapons = {};
  if (weaponTypes.length) weapons["mainhand1"] = weaponTypes[0];

  const ctx = {
    specializations: [{ specializationId: specId, majorChoices: { 1: traitId } }],
    gameMode,
    equipment: { weapons },
    activeWeaponSet: 1,
    underwaterMode: false,
  };
  const catalogs = {
    traitById: new Map([[traitId, trait.api]]),
    specializationById: new Map([[specId, { id: specId, minorTraits: [] }]]),
  };
  return collectModifiers(ctx, catalogs, OVERRIDES);
}

function getOverride(traitId) {
  return OVERRIDES.get(`trait:${traitId}`) || null;
}

// Group API facts by a key, return groups with count ≥ minCount
function groupFacts(facts, keyFn, minCount = 2) {
  const groups = new Map();
  for (const f of facts) {
    const k = keyFn(f);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  return [...groups.entries()]
    .filter(([, arr]) => arr.length >= minCount)
    .map(([key, arr]) => ({ key, facts: arr }));
}

// ---------------------------------------------------------------------------
// Property 1: AttributeAdjust WvW split
// For traits with 2+ facts for the same target, engine picks by mode index.
// ---------------------------------------------------------------------------

describe("Property: AttributeAdjust WvW split (all applicable traits)", () => {
  const ATTR_KEY = (f) =>
    f.type === "AttributeAdjust" && f.target ? f.target : null;

  for (const fixture of BROAD.traits) {
    const override = getOverride(fixture.id);
    // Skip: petStatOnly (no modifiers), mightOverride (suppresses AttributeAdjust),
    // weaponConditional (multiplies values — split logic still applies but value differs)
    if (override?.petStatOnly || override?.mightOverride || override?.weaponConditional) continue;

    const splits = groupFacts(fixture.api.facts || [], ATTR_KEY);
    if (!splits.length) continue;

    for (const { key: target, facts } of splits) {
      const statKey = CONVERSION_TARGET_MAP[target] || target;
      const pveExpected = facts[0].value;
      const wvwExpected = facts[Math.min(1, facts.length - 1)].value;

      test(`${fixture.id} ${fixture.api.name} [${fixture.profession}]: ${target} PvE=${pveExpected} WvW=${wvwExpected}`, () => {
        const pveMods = getMods(fixture, "pve");
        const wvwMods = getMods(fixture, "wvw");

        const pveMod = pveMods.find((m) => m.type === "flatBonus" && m.target === statKey);
        const wvwMod = wvwMods.find((m) => m.type === "flatBonus" && m.target === statKey);

        expect(pveMod?.value).toBe(pveExpected);
        expect(wvwMod?.value).toBe(wvwExpected);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Property 2: BuffConversion / AttributeConversion WvW split
// ---------------------------------------------------------------------------

describe("Property: Conversion WvW split (all applicable traits)", () => {
  const CONV_KEY = (f) =>
    (f.type === "BuffConversion" || f.type === "AttributeConversion") && f.source && f.target
      ? `${f.source}|${f.target}`
      : null;

  for (const fixture of BROAD.traits) {
    const splits = groupFacts(fixture.api.facts || [], CONV_KEY);
    if (!splits.length) continue;

    for (const { key, facts } of splits) {
      const [source, rawTarget] = key.split("|");
      const target = CONVERSION_TARGET_MAP[rawTarget] || rawTarget;
      const pveExpected = facts[0].percent;
      const wvwExpected = facts[Math.min(1, facts.length - 1)].percent;

      test(`${fixture.id} ${fixture.api.name} [${fixture.profession}]: ${source}→${target} PvE=${pveExpected}% WvW=${wvwExpected}%`, () => {
        const pveMods = getMods(fixture, "pve");
        const wvwMods = getMods(fixture, "wvw");

        const pveMod = pveMods.find(
          (m) => m.type === "conversion" && m.sourceAttr === source && m.target === target
        );
        const wvwMod = wvwMods.find(
          (m) => m.type === "conversion" && m.sourceAttr === source && m.target === target
        );

        expect(pveMod?.percent).toBe(pveExpected);
        expect(wvwMod?.percent).toBe(wvwExpected);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Property 3: critChance Percent WvW split
// ---------------------------------------------------------------------------

describe("Property: critChance WvW split (all applicable traits)", () => {
  const CRIT_KEY = (f) =>
    f.type === "Percent" && f.text === "Critical Chance Increase" && f.percent ? "crit" : null;

  for (const fixture of BROAD.traits) {
    const override = getOverride(fixture.id);
    if (override?.ignoreCritChance) continue;

    const splits = groupFacts(fixture.api.facts || [], CRIT_KEY);
    if (!splits.length) continue;

    const facts = splits[0].facts;
    const pveExpected = facts[0].percent;
    const wvwExpected = facts[Math.min(1, facts.length - 1)].percent;

    test(`${fixture.id} ${fixture.api.name} [${fixture.profession}]: critChance PvE=${pveExpected}% WvW=${wvwExpected}%`, () => {
      const pveMods = getMods(fixture, "pve");
      const wvwMods = getMods(fixture, "wvw");

      const pveCrit = pveMods.find((m) => m.type === "critChance");
      const wvwCrit = wvwMods.find((m) => m.type === "critChance");

      expect(pveCrit?.value).toBe(pveExpected);
      expect(wvwCrit?.value).toBe(wvwExpected);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 4: petStatOnly — no modifiers emitted
// ---------------------------------------------------------------------------

describe("Property: petStatOnly traits emit no player modifiers", () => {
  for (const fixture of BROAD.traits) {
    const override = getOverride(fixture.id);
    if (!override?.petStatOnly) continue;

    test(`${fixture.id} ${fixture.api.name}: no modifiers (petStatOnly)`, () => {
      expect(getMods(fixture, "pve")).toHaveLength(0);
      expect(getMods(fixture, "wvw")).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 5: ignoreCritChance — critChance modifier suppressed
// ---------------------------------------------------------------------------

describe("Property: ignoreCritChance traits emit no critChance modifier", () => {
  for (const fixture of BROAD.traits) {
    const override = getOverride(fixture.id);
    if (!override?.ignoreCritChance) continue;

    test(`${fixture.id} ${fixture.api.name}: no critChance modifier (ignoreCritChance)`, () => {
      const pveMods = getMods(fixture, "pve");
      const wvwMods = getMods(fixture, "wvw");
      expect(pveMods.filter((m) => m.type === "critChance")).toHaveLength(0);
      expect(wvwMods.filter((m) => m.type === "critChance")).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 6: berserkConditional — all flatBonus/critChance mods have condition "berserk"
// ---------------------------------------------------------------------------

describe("Property: berserkConditional traits set condition='berserk' on all modifiers", () => {
  for (const fixture of BROAD.traits) {
    const override = getOverride(fixture.id);
    if (!override?.berserkConditional) continue;

    test(`${fixture.id} ${fixture.api.name}: all modifiers have condition "berserk"`, () => {
      for (const mode of ["pve", "wvw"]) {
        const mods = getMods(fixture, mode);
        for (const mod of mods) {
          if (mod.type === "mightModifier") continue; // mightModifier condition is always null
          expect(mod.condition).toBe("berserk");
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Property 7: mightOverride — emits mightModifier, suppresses flatBonus
// ---------------------------------------------------------------------------

describe("Property: mightOverride traits emit mightModifier and no flatBonus", () => {
  for (const fixture of BROAD.traits) {
    const override = getOverride(fixture.id);
    if (!override?.mightOverride) continue;

    test(`${fixture.id} ${fixture.api.name}: emits mightModifier, no flatBonus`, () => {
      for (const mode of ["pve", "wvw"]) {
        const mods = getMods(fixture, mode);
        expect(mods.filter((m) => m.type === "mightModifier").length).toBeGreaterThan(0);
        expect(mods.filter((m) => m.type === "flatBonus")).toHaveLength(0);
        // Verify override values are applied
        const might = mods.find((m) => m.type === "mightModifier");
        if (override.mightOverride.power != null) {
          expect(might.power).toBe(override.mightOverride.power);
        }
        if (override.mightOverride.condi != null) {
          expect(might.condi).toBe(override.mightOverride.condi);
        }
      }
    });
  }
});
