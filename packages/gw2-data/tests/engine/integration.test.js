"use strict";

const { StatEngine } = require("../../src/engine");

function makeCatalogs() {
  return {
    traitById: new Map(),
    skillById: new Map(),
    specializationById: new Map(),
    runeById: new Map(),
    foodById: new Map(),
    utilityById: new Map(),
    infusionById: new Map(),
    enrichmentById: new Map(),
  };
}

function makeCtx(overrides = {}) {
  return {
    profession: "Warrior",
    specializations: [],
    equipment: { slots: {}, weapons: {}, runes: {}, infusions: {} },
    gameMode: "pve",
    underwaterMode: false,
    activeWeaponSet: 1,
    skills: {},
    assumedBoons: null,
    sigilStacks: null,
    ...overrides,
  };
}

describe("StatEngine", () => {
  test("constructs with catalogs", () => {
    const engine = new StatEngine(makeCatalogs());
    expect(engine).toBeDefined();
  });

  test("computeAttributes returns full breakdown", () => {
    const engine = new StatEngine(makeCatalogs());
    const result = engine.computeAttributes(makeCtx());
    expect(result.base.Power).toBe(1000);
    expect(result.total.Power).toBe(1000);
    expect(result.derived.health).toBe(19212);
  });

  test("collectModifiers returns array", () => {
    const engine = new StatEngine(makeCatalogs());
    const mods = engine.collectModifiers(makeCtx());
    expect(Array.isArray(mods)).toBe(true);
  });

  test("computeTooltip returns damage for valid skill", () => {
    const catalogs = makeCatalogs();
    const engine = new StatEngine(catalogs);
    const skill = { id: 1, name: "Slash", facts: [{ type: "Damage", dmg_multiplier: 0.8, hit_count: 1 }] };
    const ctx = makeCtx({
      equipment: { slots: {}, weapons: { mainhand1: "sword" }, runes: {}, infusions: {} },
    });
    const result = engine.computeTooltip(ctx, skill, "sword");
    expect(result).toBeDefined();
    expect(result.damage).toBeGreaterThan(0);
  });

  test("analyzeBoons returns boons and conditions arrays", () => {
    const engine = new StatEngine(makeCatalogs());
    const skills = [{
      name: "Shout", description: "Grant might to allies.", icon: "",
      facts: [{ type: "Buff", status: "Might", apply_count: 3, duration: 8 }],
    }];
    const result = engine.analyzeBoons(skills, []);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
  });

  test("analyzeCombos returns fields and finishers arrays", () => {
    const engine = new StatEngine(makeCatalogs());
    const skills = [{
      name: "Flame Wall", icon: "", description: "",
      facts: [{ type: "ComboField", field_type: "Fire" }],
    }];
    const result = engine.analyzeCombos(skills, []);
    expect(result.fields).toHaveLength(1);
  });

  test("full pipeline: equip gear, compute attributes, get tooltip", () => {
    const catalogs = makeCatalogs();
    catalogs.specializationById.set(4, { id: 4, minorTraits: [] });
    catalogs.traitById.set(1444, {
      id: 1444, facts: [{ type: "AttributeAdjust", target: "Power", value: 150 }],
    });

    const engine = new StatEngine(catalogs);
    const ctx = makeCtx({
      specializations: [{ id: 4, majorChoices: { 1: 1444 } }],
      equipment: {
        slots: { chest: "Berserker's", legs: "Berserker's" },
        weapons: { mainhand1: "greatsword" },
        runes: {}, infusions: {},
      },
    });

    const attrs = engine.computeAttributes(ctx);
    expect(attrs.total.Power).toBeGreaterThan(1000);
    expect(attrs.traits.Power).toBe(150);

    const skill = { id: 5489, name: "Fireball", facts: [{ type: "Damage", dmg_multiplier: 0.75, hit_count: 1 }] };
    const tooltip = engine.computeTooltip(ctx, skill, "greatsword");
    expect(tooltip.damage).toBeGreaterThan(0);
  });
});
