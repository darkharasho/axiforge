"use strict";

const { getDiscordEmoji, getDisplayName, tagEmojiMention } = require("../../src/main/discordEmoji");

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

describe("tagEmojiMention", () => {
  test("maps a built-in tag icon path to its Discord emoji mention", () => {
    expect(tagEmojiMention("img/tags/strips.png", "Strips")).toBe("<:Strips:1434444303756820520>");
    expect(tagEmojiMention("img/tags/might.png", "Might")).toBe("<:Might:1434444297255518389>");
  });

  test("sanitizes the emoji name (Discord allows only [A-Za-z0-9_])", () => {
    expect(tagEmojiMention("img/tags/regen.png", "Regen / Heal!")).toBe("<:Regen___Heal_:1434444299071918111>");
  });

  test("falls back to 'tag' when no usable name is given", () => {
    expect(tagEmojiMention("img/tags/utility.png", "")).toBe("<:tag:1443686727347601438>");
  });

  test("returns null for an unknown icon path", () => {
    expect(tagEmojiMention("img/tags/nope.png", "Nope")).toBeNull();
    expect(tagEmojiMention("", "X")).toBeNull();
    expect(tagEmojiMention(undefined, "X")).toBeNull();
  });

  test("derives an id from a raw Discord CDN url (custom icon fallback)", () => {
    expect(tagEmojiMention("https://cdn.discordapp.com/emojis/123456789012345678.png", "Custom"))
      .toBe("<:Custom:123456789012345678>");
  });

  test("uses the animated prefix for a .gif CDN url", () => {
    expect(tagEmojiMention("https://cdn.discordapp.com/emojis/999.gif", "Anim"))
      .toBe("<a:Anim:999>");
  });
});
