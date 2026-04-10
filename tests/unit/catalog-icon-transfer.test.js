"use strict";

/**
 * Tests for _transferIcons — carries API fact icons forward to wiki-parsed facts.
 * Wiki facts have accurate values but no icon URLs; this bridges the gap.
 */

const { _transferIcons } = require("../../src/main/gw2Data/catalog");

describe("_transferIcons", () => {
  test("transfers icon from API Buff fact to matching wiki Buff fact by status", () => {
    const apiFacts = [
      { type: "Buff", status: "Signet of Fury", icon: "https://render.guildwars2.com/icon1.png", duration: 0 },
    ];
    const wikiFacts = [
      { type: "Buff", status: "Signet of Fury (effect)", duration: 0, description: "180 Precision" },
    ];
    _transferIcons(apiFacts, wikiFacts);
    expect(wikiFacts[0].icon).toBe("https://render.guildwars2.com/icon1.png");
  });

  test("transfers icon from API Number fact to matching wiki Number fact by text", () => {
    const apiFacts = [
      { type: "Number", text: "Adrenaline", icon: "https://render.guildwars2.com/icon2.png", value: 30 },
    ];
    const wikiFacts = [
      { type: "Number", text: "Adrenaline", value: 30 },
    ];
    _transferIcons(apiFacts, wikiFacts);
    expect(wikiFacts[0].icon).toBe("https://render.guildwars2.com/icon2.png");
  });

  test("does not overwrite existing wiki fact icon", () => {
    const apiFacts = [
      { type: "Number", text: "Damage", icon: "https://render.guildwars2.com/api-icon.png", value: 100 },
    ];
    const wikiFacts = [
      { type: "Number", text: "Damage", icon: "https://render.guildwars2.com/wiki-icon.png", value: 200 },
    ];
    _transferIcons(apiFacts, wikiFacts);
    expect(wikiFacts[0].icon).toBe("https://render.guildwars2.com/wiki-icon.png");
  });

  test("handles empty or missing arrays gracefully", () => {
    expect(() => _transferIcons(null, [])).not.toThrow();
    expect(() => _transferIcons([], null)).not.toThrow();
    expect(() => _transferIcons([], [])).not.toThrow();
  });

  test("multiple wiki facts get correct icons from API facts", () => {
    const apiFacts = [
      { type: "Buff", status: "Signet of Fury", icon: "https://render.guildwars2.com/signet.png", duration: 0 },
      { type: "Number", text: "Adrenaline", icon: "https://render.guildwars2.com/adrenaline.png", value: 30 },
    ];
    const wikiFacts = [
      { type: "Buff", status: "Signet of Fury (effect)", duration: 0, description: "180 Precision" },
      { type: "Buff", status: "Signet of Fury (effect)", text: "Active Bonus", duration: 4, description: "360 Precision, 360 Ferocity" },
      { type: "Number", text: "Adrenaline", value: 30 },
    ];
    _transferIcons(apiFacts, wikiFacts);
    expect(wikiFacts[0].icon).toBe("https://render.guildwars2.com/signet.png");
    expect(wikiFacts[1].icon).toBe("https://render.guildwars2.com/signet.png");
    expect(wikiFacts[2].icon).toBe("https://render.guildwars2.com/adrenaline.png");
  });
});
