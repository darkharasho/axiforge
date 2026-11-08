"use strict";

/**
 * Fury-gating of trait stat bonuses (issue #333).
 *
 * Some traits grant attributes only *while you have fury* (Raging Storm, No
 * Quarter, Sharpening Sorrow, ...). The engine gates those on the assumed-Fury
 * toggle. Many more traits merely *grant* fury as a side effect and carry a
 * Buff(Fury) fact for it, yet their stat bonus is a flat passive. Roaring
 * Reveille is one: the wiki-enriched catalog maps "Charge grants Fury" to a
 * Buff(Fury) fact, and its +120/+60 Concentration vanished from the panel
 * unless Fury was toggled on.
 */

const { computeAttributes, isFuryTrait } = require("@axiapps/gw2-data/engine");

function makeCtx(traitId, gameMode = "pve", assumedBoons = null) {
  return {
    profession: "Warrior",
    specializations: [{ specializationId: 11, majorChoices: { 1: traitId } }],
    equipment: { slots: {}, weapons: {}, runes: {}, infusions: {} },
    gameMode,
    activeWeaponSet: 1,
    skills: {},
    assumedBoons,
  };
}

function makeCatalogs(trait) {
  return {
    traitById: new Map([[trait.id, trait]]),
    skillById: new Map(),
    specializationById: new Map(),
  };
}

// Shape produced by the desktop catalog after wiki enrichment.
const ROARING_REVEILLE = {
  id: 1471,
  name: "Roaring Reveille",
  slot: "Major",
  description: "Warhorn skills apply additional boons. Your concentration is increased.",
  facts: [
    { type: "Buff", text: "Fury", status: "Fury", duration: 5, apply_count: 1 },
    { type: "Buff", text: "Resistance", status: "Resistance", duration: 3, apply_count: 1 },
    { type: "AttributeAdjust", text: "Concentration", target: "Concentration", value: 120 },
  ],
  wvwFacts: [
    { type: "Buff", text: "Fury", status: "Fury", duration: 5, apply_count: 1 },
    { type: "Buff", text: "Resistance", status: "Resistance", duration: 3, apply_count: 1 },
    { type: "AttributeAdjust", text: "Concentration", target: "Concentration", value: 60 },
  ],
};
ROARING_REVEILLE.pvpFacts = ROARING_REVEILLE.wvwFacts;

const RAGING_STORM = {
  id: 214,
  name: "Raging Storm",
  slot: "Major",
  description: "Critically striking a foe grants fury. Gain ferocity while under the effects of fury.",
  facts: [
    { type: "Buff", text: "Fury", status: "Fury", duration: 4, apply_count: 1 },
    { type: "AttributeAdjust", text: "Ferocity", target: "CritDamage", value: 180 },
  ],
};

describe("fury-gating of trait stats (#333)", () => {
  test("Roaring Reveille Concentration counts without Fury assumed (PvE 120)", () => {
    const r = computeAttributes(makeCtx(1471, "pve"), makeCatalogs(ROARING_REVEILLE));
    expect(r.total.Concentration).toBe(120);
  });

  test("Roaring Reveille Concentration counts in WvW (60) and PvP (60)", () => {
    expect(computeAttributes(makeCtx(1471, "wvw"), makeCatalogs(ROARING_REVEILLE)).total.Concentration).toBe(60);
    expect(computeAttributes(makeCtx(1471, "pvp"), makeCatalogs(ROARING_REVEILLE)).total.Concentration).toBe(60);
  });

  test("a trait that only grants fury is not a fury-gated trait", () => {
    expect(isFuryTrait(ROARING_REVEILLE, 1471, new Map())).toBe(false);
  });

  test("a trait whose description gates stats on fury stays fury-gated", () => {
    expect(isFuryTrait(RAGING_STORM, 214, new Map())).toBe(true);
    const off = computeAttributes(makeCtx(214, "pve"), makeCatalogs(RAGING_STORM));
    const on = computeAttributes(makeCtx(214, "pve", { fury: true }), makeCatalogs(RAGING_STORM));
    expect(on.total.Ferocity - off.total.Ferocity).toBe(180);
  });

  test.each([
    "Gain fury when you swap weapons. Fury gives an increased critical chance.",
    "Critical hits on foes within the range threshold have a chance to grant fury. Fury grants you ferocity.",
    "Gain fury when you activate Bladesong Sorrow. Fury increases your expertise.",
    "Landing a critical hit while under the effects of fury increases the duration of fury. Gain increased ferocity while under the effects of fury.",
    "Critical-hit chance is further increased while you are under the effect of fury.",
  ])("recognises fury-conditional wording: %s", (description) => {
    const trait = { id: 1, description, facts: [{ type: "Buff", status: "Fury" }] };
    expect(isFuryTrait(trait, 1, new Map())).toBe(true);
  });

  test.each([
    "Gain fury when entering shroud. Gain additional precision.",
    "Warhorn skills apply additional boons. Your concentration is increased.",
    "Gain fury when you immobilize or disable a foe.",
  ])("does not gate traits that just grant fury: %s", (description) => {
    const trait = { id: 1, description, facts: [{ type: "Buff", status: "Fury" }] };
    expect(isFuryTrait(trait, 1, new Map())).toBe(false);
  });
});
