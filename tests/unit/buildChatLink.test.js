"use strict";

const { mapBuildToTemplateInput } = require("../../src/main/buildChatLink");

describe("mapBuildToTemplateInput", () => {
  const baseBuild = {
    profession: "Guardian",
    specializations: [
      { id: 42, majorChoices: { 1: 566, 2: 567, 3: 568 } },
      { id: 16, majorChoices: { 1: 600, 2: 601, 3: 602 } },
      { id: 27, majorChoices: { 1: 1896, 2: 1898, 3: 1955 } },
    ],
    skills: {
      heal: { id: 9083 },
      utility: [{ id: 9093 }, { id: 9150 }, { id: 9153 }],
      elite: { id: 30461 },
    },
    underwaterSkills: {
      heal: { id: 9083 },
      utility: [{ id: 9093 }, null, null],
      elite: null,
    },
    equipment: {
      weapons: { mainhand1: "Greatsword", offhand1: "", mainhand2: "Sword", offhand2: "Focus" },
    },
    selectedLegends: ["", ""],
    selectedUnderwaterLegends: ["", ""],
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  };

  it("maps profession as-is", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.profession).toBe("Guardian");
  });

  it("maps specializations with trait IDs", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.specializations).toEqual([
      { id: 42, traits: [566, 567, 568] },
      { id: 16, traits: [600, 601, 602] },
      { id: 27, traits: [1896, 1898, 1955] },
    ]);
  });

  it("pads specializations to 3 when fewer exist", () => {
    const build = { ...baseBuild, specializations: [{ id: 42, majorChoices: { 1: 566, 2: 567, 3: 568 } }] };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
    expect(input.specializations[1]).toEqual({ id: null });
    expect(input.specializations[2]).toEqual({ id: null });
  });

  it("pads specializations when array is empty", () => {
    const build = { ...baseBuild, specializations: [] };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
  });

  it("maps terrestrial skills", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.terrestrial).toEqual({
      heal: 9083,
      utilities: [9093, 9150, 9153],
      elite: 30461,
    });
  });

  it("maps aquatic skills with nulls for missing", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.aquatic).toEqual({
      heal: 9083,
      utilities: [9093, undefined, undefined],
      elite: undefined,
    });
  });

  it("maps weapons, filtering empties", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.weapons).toEqual(["Greatsword", "Sword", "Focus"]);
  });

  it("maps revenant legends from Legend strings", () => {
    const build = {
      ...baseBuild,
      profession: "Revenant",
      selectedLegends: ["Legend2", "Legend5"],
      selectedUnderwaterLegends: ["Legend3", "Legend6"],
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.revenantLegends).toEqual([2, 5, 3, 6]);
  });

  it("omits revenantLegends for non-Revenant", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.revenantLegends).toBeUndefined();
  });

  it("maps ranger pets", () => {
    const build = {
      ...baseBuild,
      profession: "Ranger",
      selectedPets: { terrestrial1: 1, terrestrial2: 5, aquatic1: 12, aquatic2: 3 },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.rangerPets).toEqual([1, 5, 12, 3]);
  });

  it("omits rangerPets for non-Ranger", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.rangerPets).toBeUndefined();
  });

  it("handles completely empty build gracefully", () => {
    const build = {
      profession: "",
      specializations: [],
      skills: { heal: null, utility: [], elite: null },
      underwaterSkills: { heal: null, utility: [], elite: null },
      equipment: { weapons: {} },
      selectedLegends: ["", ""],
      selectedUnderwaterLegends: ["", ""],
      selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
    expect(input.skills.terrestrial.heal).toBeUndefined();
  });
});
