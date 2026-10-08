"use strict";

// The same comp must show the same party coverage in the desktop app and on its
// published link. Desktop: store builds + catalog maps + upgrade catalog.
// Viewer: serialized builds + catalogs rebuilt from the payload + baked bonus.
const { serializeForPublish } = require("../../../src/main/buildPublish");
const { computeCompPartyCoverage } = require("../../../src/renderer/modules/comps/comp-boon-coverage.js");
const { catalogFromPublishedBuild, upgradeCatalogFromPublishedBuild } = require("../../../src/site/published-catalog.js");

const SKILLS = [
  { id: 100, name: "Healing Surge", description: "Heal.", slot: "Heal", type: "Heal",
    facts: [{ type: "Buff", status: "Might", duration: 10, apply_count: 5 }] },
  { id: 200, name: "Signet of Fury", description: "Fury.", slot: "Utility", type: "Utility",
    facts: [{ type: "Buff", status: "Fury", duration: 6, apply_count: 0 }] },
];
const CATALOG_ARRAYS = { skills: SKILLS, weaponSkills: [], traits: [], specializations: [], professionWeapons: {}, legends: [], pets: [] };
const EMPTY_UPGRADES = {
  runeById: new Map(), sigilById: new Map(), infusionById: new Map(), enrichmentById: new Map(),
  foodById: new Map(), utilityById: new Map(), relicByName: new Map(), relicById: new Map(),
};
const SLOTS = ["head", "shoulders", "chest", "hands", "legs", "feet", "back", "amulet", "ring1", "ring2", "accessory1", "accessory2"];

function storeBuild(id, gameMode) {
  return {
    id, title: `Support ${id}`, profession: "Guardian", gameMode, specializations: [],
    skills: { heal: { id: 100, name: "Healing Surge" }, utility: [{ id: 200, name: "Signet of Fury" }], elite: null },
    equipment: { slots: Object.fromEntries(SLOTS.map((s) => [s, "Minstrel's"])), weapons: {}, runes: {}, sigils: {}, infusions: {} },
  };
}

function desktopCatalog() {
  return {
    skills: SKILLS, skillById: new Map(SKILLS.map((s) => [s.id, s])),
    weaponSkills: [], weaponSkillById: new Map(), traits: [], traitById: new Map(),
    specializationById: new Map(), professionWeapons: {}, legendById: new Map(), petById: new Map(),
  };
}

// Maps are not comparable across the two runs by identity; flatten to plain data.
function flatten({ lines }) {
  return lines.map((l) => ({
    label: l.label,
    hasFilledSlots: l.hasFilledSlots,
    boons: [...l.boons].map(([name, e]) => [name, e.count,
      e.providers.map((p) => [p.buildId, p.sources.map((s) => [s.name, s.effectiveDuration, s.stacks])])]),
    conditions: [...l.conditions].map(([name, e]) => [name, e.count]),
  }));
}

describe.each(["pve", "wvw"])("desktop vs viewer coverage (%s)", (gameMode) => {
  test("identical lines, boons and durations", async () => {
    const builds = [storeBuild("b1", gameMode), storeBuild("b2", gameMode)];
    const comp = { id: "c", partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2"] }] };

    const cache = new Map();
    const desktop = await computeCompPartyCoverage(comp, builds, cache, async (p, m) => {
      cache.set(`${p}_${m}`, desktopCatalog());
    }, EMPTY_UPGRADES);

    const published = builds.map((b) => serializeForPublish(b, CATALOG_ARRAYS, EMPTY_UPGRADES));
    const viewer = await computeCompPartyCoverage(comp, published, new Map(), async () => null, null, {
      catalogFor: catalogFromPublishedBuild,
      upgradeCatalogFor: upgradeCatalogFromPublishedBuild,
      durationBonusFor: (b) => b.boonDurationBonus,
    });

    expect(flatten(viewer)).toEqual(flatten(desktop));
    expect(desktop.lines[0].boons.get("Might").count).toBe(2);
  });
});

// Axicode imports store specializations as traitChoices (1-based position per
// tier) with majorChoices all zero. Publish resolves them to trait ids, so the
// viewer counts the chosen traits; the desktop must count the same ones.
describe("desktop vs viewer coverage for traitChoices-only specializations", () => {
  const MAJOR_TRAITS = [
    { id: 401, name: "T1a", tier: 1, facts: [] },
    { id: 402, name: "T1b", tier: 1, facts: [] },
    { id: 501, name: "T2a", tier: 2, facts: [] },
    { id: 502, name: "Swift Trait", tier: 2, description: "Grant swiftness.",
      facts: [{ type: "Buff", status: "Swiftness", duration: 5, apply_count: 1 }] },
    { id: 601, name: "T3a", tier: 3, facts: [] },
    { id: 602, name: "T3b", tier: 3, facts: [] },
  ];
  const SPEC = { id: 16, name: "Honor", elite: false, minorTraits: [], majorTraits: MAJOR_TRAITS.map((t) => t.id) };

  function traitChoicesBuild(id) {
    return {
      ...storeBuild(id, "wvw"),
      // Exactly what buildStore.normalizeSpecializations keeps for an axicode import.
      specializations: [{
        id: 16, name: "Honor", elite: false, icon: "", background: "", minorTraits: [],
        majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] },
        traitChoices: [1, 2, 1],
      }],
    };
  }

  test("both sides count the trait the traitChoices select", async () => {
    const builds = [traitChoicesBuild("b1")];
    const comp = { id: "c", partyLines: [{ id: "l1", capacity: 5, slots: ["b1"] }] };

    const cache = new Map();
    const desktop = await computeCompPartyCoverage(comp, builds, cache, async (p, m) => {
      cache.set(`${p}_${m}`, {
        ...desktopCatalog(),
        traits: MAJOR_TRAITS, traitById: new Map(MAJOR_TRAITS.map((t) => [t.id, t])),
        specializations: [SPEC], specializationById: new Map([[SPEC.id, SPEC]]),
      });
    }, EMPTY_UPGRADES);

    const arrays = { ...CATALOG_ARRAYS, traits: MAJOR_TRAITS, specializations: [SPEC] };
    const published = builds.map((b) => serializeForPublish(b, arrays, EMPTY_UPGRADES));
    const viewer = await computeCompPartyCoverage(comp, published, new Map(), async () => null, null, {
      catalogFor: catalogFromPublishedBuild,
      upgradeCatalogFor: upgradeCatalogFromPublishedBuild,
      durationBonusFor: (b) => b.boonDurationBonus,
    });

    expect(viewer.lines[0].boons.has("Swiftness")).toBe(true);
    expect(desktop.lines[0].boons.has("Swiftness")).toBe(true);
    expect(flatten(viewer)).toEqual(flatten(desktop));
  });
});
