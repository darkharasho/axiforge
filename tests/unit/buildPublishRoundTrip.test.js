"use strict";

/**
 * Round-trip test: serializeForPublish → JSON → SPA state → weapon skill resolution.
 * Tests the full publish-to-SPA data flow for weapon skills.
 *
 * Also verifies that un-enriched builds (missing professionWeapons/catalogWeaponSkills)
 * produce empty weapon skills — demonstrating why the publish handler must not silently
 * fall back to raw build data.
 */

const { serializeForPublish } = require("../../src/main/buildPublish");
const { getEquippedWeaponSkills } = require("../../src/renderer/modules/skills");
const { resolveEquippedWeaponSkills } = require("../../src/renderer/modules/equipment-weapon-skills");

// Use REALISTIC casing: lowercase weapon names and catalog keys
// (matching real GW2_WEAPONS.id and normalizeWeaponKey output)
function makeRealisticBuild() {
  return {
    title: "Power Reaper",
    profession: "Necromancer",
    specializations: [
      { id: 39, name: "Soul Reaping", elite: false, icon: "sr.png", background: "sr-bg.png",
        minorTraits: [{ id: 1, name: "Minor 1", icon: "m1.png", description: "desc" }],
        majorChoices: { 1: 100, 2: 200, 3: 300 },
        majorTraitsByTier: { 1: [{ id: 100, name: "T1", icon: "t1.png" }], 2: [], 3: [] } },
      { id: 34, name: "Spite", elite: false, icon: "sp.png", background: "sp-bg.png",
        minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 34, name: "Reaper", elite: true, icon: "rp.png", background: "rp-bg.png",
        minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    skills: {
      heal: { id: 10527, name: "Well of Blood", icon: "wob.png", description: "Heal" },
      utility: [{ id: 10532, name: "Well of Suffering", icon: "wos.png", description: "Utility" }],
      elite: { id: 10549, name: "Lich Form", icon: "lf.png", description: "Elite" },
    },
    equipment: {
      statPackage: "Berserker",
      weapons: { mainhand1: "greatsword", offhand1: "", mainhand2: "dagger", offhand2: "focus" },
      runes: {}, sigils: {}, slots: {}, infusions: {}, relic: "", food: "", utility: "", enrichment: "",
    },
    gameMode: "pve",
    tags: ["dps"],
    notes: "",
    selectedLegends: ["", ""],
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  };
}

function makeRealisticCatalog() {
  return {
    professionWeapons: {
      greatsword: {
        flags: ["TwoHand", "Mainhand"],
        skills: [
          { id: 1, slot: "Weapon_1", offhand: "", attunement: "" },
          { id: 2, slot: "Weapon_2", offhand: "", attunement: "" },
          { id: 3, slot: "Weapon_3", offhand: "", attunement: "" },
          { id: 4, slot: "Weapon_4", offhand: "", attunement: "" },
          { id: 5, slot: "Weapon_5", offhand: "", attunement: "" },
        ],
      },
      dagger: {
        flags: ["Mainhand"],
        skills: [
          { id: 11, slot: "Weapon_1", offhand: "", attunement: "" },
          { id: 12, slot: "Weapon_2", offhand: "", attunement: "" },
          { id: 13, slot: "Weapon_3", offhand: "", attunement: "" },
        ],
      },
      focus: {
        flags: ["Offhand"],
        skills: [
          { id: 21, slot: "Weapon_4", offhand: "", attunement: "" },
          { id: 22, slot: "Weapon_5", offhand: "", attunement: "" },
        ],
      },
    },
    weaponSkills: [
      { id: 1, name: "Dusk Strike", icon: "ds.png", slot: "Weapon_1" },
      { id: 2, name: "Infusing Terror", icon: "it.png", slot: "Weapon_2" },
      { id: 3, name: "Death Spiral", icon: "dsp.png", slot: "Weapon_3" },
      { id: 4, name: "Nightfall", icon: "nf.png", slot: "Weapon_4" },
      { id: 5, name: "Grasping Darkness", icon: "gd.png", slot: "Weapon_5" },
      { id: 11, name: "Necrotic Slash", icon: "ns.png", slot: "Weapon_1" },
      { id: 12, name: "Life Siphon", icon: "ls.png", slot: "Weapon_2" },
      { id: 13, name: "Dark Pact", icon: "dp.png", slot: "Weapon_3" },
      { id: 21, name: "Spinal Shivers", icon: "ss.png", slot: "Weapon_4" },
      { id: 22, name: "Reapers Touch", icon: "rt.png", slot: "Weapon_5" },
    ],
    skills: [
      { id: 10574, name: "Death Shroud", icon: "ds-icon.png", description: "Enter DS", slot: "Profession_1", professions: ["Necromancer"], inProfessionEndpoint: true },
    ],
    legends: [],
    pets: [],
    specializations: [],
  };
}

/**
 * Simulates the SPA's populateStateFromBuild (from render-build.js)
 * to build the activeCatalog that getEquippedWeaponSkills uses.
 */
function buildSpaCatalog(build) {
  // Collect all skills (simplified version of collectAllSkills from render-build.js)
  const allSkills = [];
  for (const source of [build.landSkills, build.waterSkills]) {
    if (!source) continue;
    const ws = source.weaponSkills || {};
    for (const set of [ws.set1, ws.set2, ws.aquatic1, ws.aquatic2]) {
      if (Array.isArray(set)) allSkills.push(...set);
    }
  }
  if (Array.isArray(build.catalogSkills)) allSkills.push(...build.catalogSkills);

  return {
    profession: { id: build.profession },
    skills: allSkills,
    skillById: new Map(allSkills.filter(s => s && s.id).map(s => [s.id, s])),
    weaponSkills: build.catalogWeaponSkills || [],
    weaponSkillById: new Map((build.catalogWeaponSkills || []).map(s => [s.id, s])),
    specializations: (build.specializations || []).map(s => ({
      ...s,
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    })),
    specializationById: new Map((build.specializations || []).map(s => [s.id, {
      ...s,
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    }])),
    traits: [],
    traitById: new Map(),
    legends: [],
    legendById: new Map(),
    pets: [],
    petById: new Map(),
    professionWeapons: build.professionWeapons || {},
  };
}

describe("Publish → SPA round-trip: weapon skills", () => {
  test("weapon skills survive the full round-trip (serialize → JSON → SPA catalog → resolve)", () => {
    const build = makeRealisticBuild();
    const catalog = makeRealisticCatalog();

    // Step 1: Serialize for publish (like buildPublish.js)
    const serialized = serializeForPublish(build, catalog, null);

    // Step 2: Simulate encryption/decryption JSON round-trip
    const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));

    // Step 3: Verify serialized data has weapon data
    expect(jsonRoundTrip.professionWeapons).toBeDefined();
    expect(Object.keys(jsonRoundTrip.professionWeapons)).toContain("greatsword");
    expect(jsonRoundTrip.catalogWeaponSkills).toBeDefined();
    expect(jsonRoundTrip.catalogWeaponSkills.length).toBeGreaterThan(0);

    // Step 4: Build SPA catalog (like populateStateFromBuild in render-build.js)
    const spaCatalog = buildSpaCatalog(jsonRoundTrip);

    // Step 5: Verify SPA catalog has weapon data
    expect(spaCatalog.professionWeapons.greatsword).toBeDefined();
    expect(spaCatalog.weaponSkillById.size).toBeGreaterThan(0);

    // Step 6: Resolve weapon skills for set 1 (greatsword)
    const weaponSkillsSet1 = getEquippedWeaponSkills(spaCatalog, {
      mainhand: jsonRoundTrip.equipment.weapons.mainhand1,
      offhand: jsonRoundTrip.equipment.weapons.offhand1,
    });
    expect(weaponSkillsSet1.filter(Boolean)).toHaveLength(5);
    expect(weaponSkillsSet1[0].name).toBe("Dusk Strike");

    // Step 7: Resolve weapon skills for set 2 (dagger + focus)
    const weaponSkillsSet2 = getEquippedWeaponSkills(spaCatalog, {
      mainhand: jsonRoundTrip.equipment.weapons.mainhand2,
      offhand: jsonRoundTrip.equipment.weapons.offhand2,
    });
    expect(weaponSkillsSet2.filter(Boolean)).toHaveLength(5);
    expect(weaponSkillsSet2[0].name).toBe("Necrotic Slash");
    expect(weaponSkillsSet2[3].name).toBe("Spinal Shivers");
  });

  test("resolveEquippedWeaponSkills works with SPA state shape", () => {
    const build = makeRealisticBuild();
    const catalog = makeRealisticCatalog();
    const serialized = serializeForPublish(build, catalog, null);
    const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));
    const spaCatalog = buildSpaCatalog(jsonRoundTrip);

    // Simulate SPA editor state (like populateStateFromBuild)
    const editor = {
      profession: jsonRoundTrip.profession,
      equipment: jsonRoundTrip.equipment,
      activeWeaponSet: 1,
      activeAttunement: "",
      activeAttunement2: "",
      activeKit: 0,
      underwaterMode: false,
      specializations: [],
    };

    const result = resolveEquippedWeaponSkills(spaCatalog, editor);
    expect(result.filter(Boolean)).toHaveLength(5);
    expect(result[0].name).toBe("Dusk Strike");
  });

  test("weapon skills work when build uses capitalized weapon names (legacy format)", () => {
    const build = makeRealisticBuild();
    // Simulate a legacy build with capitalized weapon names
    build.equipment.weapons = {
      mainhand1: "Greatsword", offhand1: "",
      mainhand2: "Dagger", offhand2: "Focus",
    };
    const catalog = makeRealisticCatalog();
    const serialized = serializeForPublish(build, catalog, null);
    const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));
    const spaCatalog = buildSpaCatalog(jsonRoundTrip);

    // getEquippedWeaponSkills lowercases the weapon name, so it should still match
    const weaponSkillsSet1 = getEquippedWeaponSkills(spaCatalog, {
      mainhand: jsonRoundTrip.equipment.weapons.mainhand1,
      offhand: jsonRoundTrip.equipment.weapons.offhand1,
    });
    expect(weaponSkillsSet1.filter(Boolean)).toHaveLength(5);
    expect(weaponSkillsSet1[0].name).toBe("Dusk Strike");
  });

  test("un-enriched build produces no weapon skills on the SPA", () => {
    // This is the root cause of issue #100: if serializeForPublish fails silently,
    // the raw build is published without professionWeapons or catalogWeaponSkills.
    const rawBuild = makeRealisticBuild();
    // Raw build has no enrichment fields
    expect(rawBuild.professionWeapons).toBeUndefined();
    expect(rawBuild.catalogWeaponSkills).toBeUndefined();

    // SPA tries to build catalog from the un-enriched build
    const spaCatalog = buildSpaCatalog(rawBuild);
    expect(Object.keys(spaCatalog.professionWeapons)).toHaveLength(0);
    expect(spaCatalog.weaponSkillById.size).toBe(0);

    // Weapon skill resolution fails — returns all nulls
    const result = getEquippedWeaponSkills(spaCatalog, {
      mainhand: rawBuild.equipment.weapons.mainhand1,
      offhand: rawBuild.equipment.weapons.offhand1,
    });
    expect(result.filter(Boolean)).toHaveLength(0);
  });

  test("resolveWeaponSet fails when weapon name case doesn't match catalog keys", () => {
    const build = makeRealisticBuild();
    // Use capitalized weapon names (build store) with lowercase catalog keys
    build.equipment.weapons = {
      mainhand1: "Greatsword", offhand1: "",
      mainhand2: "", offhand2: "",
    };
    const catalog = makeRealisticCatalog();
    const serialized = serializeForPublish(build, catalog, null);

    // resolveWeaponSet does NOT lowercase — it does direct lookup
    // "Greatsword" won't match catalog key "greatsword"
    // This demonstrates a latent bug: if builds ever have capitalized weapon names,
    // the pre-resolved weaponSkills in the serialized build will be empty.
    expect(serialized.weaponSkills.set1).toHaveLength(0);
    // But the SPA's getEquippedWeaponSkills DOES lowercase, so it still works
  });

  test("SPA weapon skill resolution works regardless of weapon name casing", () => {
    const build = makeRealisticBuild();
    build.equipment.weapons = {
      mainhand1: "Greatsword", offhand1: "",
      mainhand2: "", offhand2: "",
    };
    const catalog = makeRealisticCatalog();
    const serialized = serializeForPublish(build, catalog, null);
    const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));
    const spaCatalog = buildSpaCatalog(jsonRoundTrip);

    // SPA re-resolves weapon skills via getEquippedWeaponSkills which lowercases
    const result = getEquippedWeaponSkills(spaCatalog, {
      mainhand: "Greatsword",
      offhand: "",
    });
    // getEquippedWeaponSkills lowercases to "greatsword" → matches catalog key
    expect(result.filter(Boolean)).toHaveLength(5);
  });
});
