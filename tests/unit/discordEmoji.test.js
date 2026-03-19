"use strict";

const { getDiscordEmoji, getDisplayName } = require("../../src/main/discordEmoji");

describe("getDiscordEmoji", () => {
  test("returns elite spec emoji when build has elite specialization", () => {
    const build = {
      profession: "Guardian",
      specializations: [
        { name: "Radiance", elite: false },
        { name: "Firebrand", elite: true },
      ],
    };
    expect(getDiscordEmoji(build)).toBe("<:Firebrand:1472731858981879880>");
  });

  test("falls back to profession emoji when no elite spec", () => {
    const build = {
      profession: "Guardian",
      specializations: [{ name: "Radiance", elite: false }],
    };
    expect(getDiscordEmoji(build)).toBe("<:Guardian:1469132552752206010>");
  });

  test("returns empty string when no match", () => {
    const build = { profession: "UnknownClass" };
    expect(getDiscordEmoji(build)).toBe("");
  });

  test("returns empty string for null/undefined build fields", () => {
    expect(getDiscordEmoji({})).toBe("");
    expect(getDiscordEmoji({ specializations: null })).toBe("");
  });

  test("handles all 9 core professions", () => {
    const cores = [
      "Elementalist", "Engineer", "Guardian", "Mesmer",
      "Necromancer", "Ranger", "Revenant", "Thief", "Warrior",
    ];
    for (const p of cores) {
      const emoji = getDiscordEmoji({ profession: p });
      expect(emoji).toMatch(/^<:\w+:\d+>$/);
    }
  });
});

describe("getDisplayName", () => {
  test("returns title when present", () => {
    expect(getDisplayName({ title: "Heal FB", profession: "Guardian" })).toBe("Heal FB");
  });

  test("title takes precedence over elite spec name", () => {
    const build = {
      title: "Heal FB",
      profession: "Guardian",
      specializations: [{ name: "Firebrand", elite: true }],
    };
    expect(getDisplayName(build)).toBe("Heal FB");
  });

  test("falls back to elite spec name when no title", () => {
    const build = {
      profession: "Guardian",
      specializations: [{ name: "Firebrand", elite: true }],
    };
    expect(getDisplayName(build)).toBe("Firebrand");
  });

  test("falls back to profession", () => {
    expect(getDisplayName({ profession: "Guardian" })).toBe("Guardian");
  });

  test("falls back to Untitled", () => {
    expect(getDisplayName({})).toBe("Untitled");
  });
});
