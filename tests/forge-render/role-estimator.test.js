const { estimateRole } = require("../../packages/forge-render/src/role-estimator.js");

describe("forge-render role estimator", () => {
  test("full berserker gear scores Power DPS", () => {
    const slots = {};
    for (const k of ["helm", "shoulders", "chest", "gloves", "leggings", "boots",
                     "amulet", "ring1", "ring2", "accessory1", "accessory2", "backpack"]) {
      slots[k] = "Berserker";
    }
    const build = {
      profession: "Warrior",
      gameMode: "pve",
      equipment: { slots, weapons: { mainhand1: "greatsword" } },
    };
    expect(estimateRole(build)).toBe("Power DPS");
  });

  test("no equipped slots yields null", () => {
    expect(estimateRole({ equipment: { slots: {} } })).toBeNull();
  });
});
