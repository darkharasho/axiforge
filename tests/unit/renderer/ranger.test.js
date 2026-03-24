"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Ranger", [
  { specId: 0, expected: ["fake:attack", "12478", "fake:return"] },
  { specId: 55, expected: ["fake:attack", "12478", "fake:return"] },
  { specId: 72, expected: ["63209", "63258", "63094", "63344"] },
]);

describe("renderer mechanics selection — Ranger core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Ranger");

  test("core uses Attack command, pet F2 skill, and Return command", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual(["fake:attack", "12478", "fake:return"]);
  });

  test("Soulbeast matches core F1-F3 when not in beastmode", async () => {
    const core = await resolve({ specId: 0 });
    const soulbeast = await resolve({ specId: 55 });
    expect(soulbeast.signatures).toEqual(core.signatures);
  });

  test("Untamed default (Unleash Pet) shows empowered pet commands at F1-F3", async () => {
    const untamed = await resolve({ specId: 72 });
    expect(untamed.signatures).toEqual(["63209", "63258", "63094", "63344"]);
  });
});

describe("renderer mechanics selection — Untamed F5 Unleash toggle", () => {
  const resolve = setupMechanicsHarness("Ranger");

  test("Untamed has F5 Unleash skill as a toggleable slot", async () => {
    const untamed = await resolve({ specId: 72 });
    const f5Slot = untamed.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5Slot).toBeDefined();
    expect(f5Slot.skill).toBeDefined();
    expect(f5Slot.isUnleashToggle).toBe(true);
  });

  test("F5 shows Unleash Pet by default (current state)", async () => {
    const defaultState = await resolve({ specId: 72 });
    const f5 = defaultState.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5.skill.id).toBe(63344); // Unleash Pet (current state)
  });

  test("F5 shows Unleash Ranger when toggled", async () => {
    const unleashed = await resolve({ specId: 72, activeKit: 63147 });
    const f5 = unleashed.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5.skill.id).toBe(63147); // Unleash Ranger (current state)
  });

  test("Unleash Ranger active shows normal pet commands at F1-F3", async () => {
    const unleashed = await resolve({ specId: 72, activeKit: 63147 });
    const sigs = unleashed.signatures;
    expect(sigs[0]).toBe("fake:attack");
    expect(sigs[1]).toBe("12478");
    expect(sigs[2]).toBe("fake:return");
  });

  test("Default state (Unleash Pet) shows empowered pet commands at F1-F3", async () => {
    const untamed = await resolve({ specId: 72 });
    const sigs = untamed.signatures;
    expect(sigs[0]).toBe("63209"); // Venomous Outburst
    expect(sigs[1]).toBe("63258"); // Rending Vines
    expect(sigs[2]).toBe("63094"); // Enveloping Haze
  });
});

describe("renderer mechanics selection — Ranger aquatic pets underwater", () => {
  const resolve = setupMechanicsHarness("Ranger");

  // Lashtail Devourer (pet ID 33) is the aquatic pet in the test fixtures.
  // Its skills array is [12523, 12524, 12525]; for aquatic slots the harness
  // picks index 1 (12524) as the F2 pet skill instead of index 0.
  const aquaticPets = { aquatic1: 33, aquatic2: 0 };

  test("underwater mode switches to aquatic pet slot for F2 skill", async () => {
    const underwater = await resolve({
      specId: 0,
      underwaterMode: true,
      selectedPets: aquaticPets,
      activePetSlot: "aquatic1",
    });
    // Aquatic F2 uses skill index 1 of the aquatic pet's skills array (12524)
    expect(underwater.signatures).toEqual(["fake:attack", "12524", "fake:return"]);
  });

  test("underwater F2 skill differs from terrestrial F2 when different pets are assigned", async () => {
    const terrestrial = await resolve({ specId: 0 });
    const underwater = await resolve({
      specId: 0,
      underwaterMode: true,
      selectedPets: aquaticPets,
      activePetSlot: "aquatic1",
    });
    // Black Bear (terrestrial1=1) uses skill index 0 → 12478
    // Lashtail Devourer (aquatic1=33) uses skill index 1 → 12524
    expect(terrestrial.signatures[1]).toBe("12478");
    expect(underwater.signatures[1]).toBe("12524");
  });

  test("underwater with no aquatic pet assigned shows empty F2 slot", async () => {
    const underwater = await resolve({
      specId: 0,
      underwaterMode: true,
      selectedPets: { aquatic1: 0, aquatic2: 0 },
      activePetSlot: "aquatic1",
    });
    expect(underwater.signatures).toEqual(["fake:attack", "empty", "fake:return"]);
  });

  test("Untamed underwater has F5 Unleash toggle", async () => {
    const underwater = await resolve({
      specId: 72,
      underwaterMode: true,
      selectedPets: aquaticPets,
      activePetSlot: "aquatic1",
    });
    const f5 = underwater.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5).toBeDefined();
    expect(f5.isUnleashToggle).toBe(true);
  });
});
