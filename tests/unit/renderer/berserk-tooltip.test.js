"use strict";

const detailPanel = require("../../../src/renderer/modules/detail-panel");

/**
 * Berserk skill tooltip completeness (#137)
 *
 * The WvW balance split for Berserk (30435 / 30185) had `complete: true` but
 * only included Adrenaline and Number of Targets facts, dropping Attack Speed
 * Increase and Duration. The PvE recharge (8s) was also incorrectly preserved
 * instead of the correct WvW value (11s).
 */
describe("Berserk skill tooltip completeness (#137)", () => {
  let gw2Data;

  beforeAll(() => {
    gw2Data = require("../../../src/main/gw2Data");
  });

  test("Berserk (30435) WvW facts include Attack Speed Increase", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior", "en", "wvw");
    const berserk = catalog.skills.find((s) => s.id === 30435);
    expect(berserk).toBeDefined();
    const attackSpeed = berserk.facts.find(
      (f) => f.type === "Percent" && /attack speed/i.test(f.text)
    );
    expect(attackSpeed).toBeDefined();
    expect(attackSpeed.percent).toBe(15);
  });

  test("Berserk (30435) WvW facts include Duration", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior", "en", "wvw");
    const berserk = catalog.skills.find((s) => s.id === 30435);
    const duration = berserk.facts.find(
      (f) => f.type === "Time" && /duration/i.test(f.text)
    );
    expect(duration).toBeDefined();
    expect(duration.duration).toBe(15);
  });

  test("Berserk (30435) WvW recharge is 11s, not PvE 8s", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior", "en", "wvw");
    const berserk = catalog.skills.find((s) => s.id === 30435);
    const recharge = berserk.facts.find((f) => f.type === "Recharge");
    expect(recharge).toBeDefined();
    expect(recharge.value).toBe(11);
  });

  test("Berserk (30185) WvW facts include Attack Speed Increase", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior", "en", "wvw");
    const berserk = catalog.skills.find((s) => s.id === 30185);
    expect(berserk).toBeDefined();
    const attackSpeed = berserk.facts.find(
      (f) => f.type === "Percent" && /attack speed/i.test(f.text)
    );
    expect(attackSpeed).toBeDefined();
    expect(attackSpeed.percent).toBe(15);
  });

  test("Berserk (30185) WvW facts include Duration", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior", "en", "wvw");
    const berserk = catalog.skills.find((s) => s.id === 30185);
    const duration = berserk.facts.find(
      (f) => f.type === "Time" && /duration/i.test(f.text)
    );
    expect(duration).toBeDefined();
    expect(duration.duration).toBe(15);
  });

  test("Berserk (30185) WvW recharge is 11s", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior", "en", "wvw");
    const berserk = catalog.skills.find((s) => s.id === 30185);
    const recharge = berserk.facts.find((f) => f.type === "Recharge");
    expect(recharge).toBeDefined();
    expect(recharge.value).toBe(11);
  });

  test("tooltip renders all key Berserk facts in WvW mode", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior", "en", "wvw");
    const berserk = catalog.skills.find((s) => s.id === 30435);
    const entity = {
      name: berserk.name,
      icon: berserk.icon,
      description: berserk.description,
      facts: berserk.facts,
    };
    const html = detailPanel.buildSkillCard(entity, "skill");
    expect(html).toContain("Attack Speed Increase");
    expect(html).toContain("Duration");
    expect(html).toContain("Adrenaline");
    expect(html).toContain("Number of Targets");
  });
});
