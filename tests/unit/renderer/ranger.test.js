"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Ranger", [
  { specId: 0, expected: ["fake:attack", "12478", "fake:return"] },
  { specId: 55, expected: ["fake:attack", "12478", "fake:return"] },
  { specId: 72, expected: ["fake:attack", "12478", "fake:return", "63344"] },
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

  test("Untamed default shows normal pet bar at F1-F3", async () => {
    const untamed = await resolve({ specId: 72 });
    expect(untamed.signatures).toEqual(["fake:attack", "12478", "fake:return", "63344"]);
  });
});

describe("renderer mechanics selection — Untamed F5 three-state Unleash cycle", () => {
  const resolve = setupMechanicsHarness("Ranger");

  test("Untamed has F5 Unleash skill as a toggleable slot", async () => {
    const untamed = await resolve({ specId: 72 });
    const f5Slot = untamed.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5Slot).toBeDefined();
    expect(f5Slot.skill).toBeDefined();
    expect(f5Slot.isUnleashToggle).toBe(true);
  });

  // State 1: Default (activeKit=0) — F5="Unleash Pet", normal pet, normal weapons
  test("default: F5 shows Unleash Pet", async () => {
    const state = await resolve({ specId: 72 });
    const f5 = state.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5.skill.id).toBe(63344); // Unleash Pet
  });

  test("default: F1-F3 are normal pet commands", async () => {
    const state = await resolve({ specId: 72 });
    const sigs = state.signatures;
    expect(sigs[0]).toBe("fake:attack");
    expect(sigs[1]).toBe("12478");
    expect(sigs[2]).toBe("fake:return");
  });

  // State 2: Unleash Pet (activeKit=63344) — F5="Unleash Ranger", unleashed pet, normal weapons
  test("Unleash Pet: F5 shows Unleash Ranger", async () => {
    const state = await resolve({ specId: 72, activeKit: 63344 });
    const f5 = state.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5.skill.id).toBe(63147); // Unleash Ranger
  });

  test("Unleash Pet: F1-F3 show empowered pet commands", async () => {
    const state = await resolve({ specId: 72, activeKit: 63344 });
    const sigs = state.signatures;
    expect(sigs[0]).toBe("63209"); // Venomous Outburst
    expect(sigs[1]).toBe("63258"); // Rending Vines
    expect(sigs[2]).toBe("63094"); // Enveloping Haze
  });

  // State 3: Unleash Ranger (activeKit=63147) — F5="Unleash Pet", normal pet, unleashed weapons
  test("Unleash Ranger: F5 shows Unleash Pet", async () => {
    const state = await resolve({ specId: 72, activeKit: 63147 });
    const f5 = state.result.mechSlots.find((s) => s.fKeyLabel === "F5");
    expect(f5.skill.id).toBe(63344); // Unleash Pet
  });

  test("Unleash Ranger: F1-F3 are normal pet commands", async () => {
    const state = await resolve({ specId: 72, activeKit: 63147 });
    const sigs = state.signatures;
    expect(sigs[0]).toBe("fake:attack");
    expect(sigs[1]).toBe("12478");
    expect(sigs[2]).toBe("fake:return");
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
