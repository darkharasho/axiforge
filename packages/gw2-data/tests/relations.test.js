"use strict";

const { parseRelatedItems, parseRelatedGroups } = require("../src/wiki/relations");

describe("parseRelatedItems", () => {
  test("extracts skill name from list item with link", () => {
    const html = '<li><span class="skill-icon"><a href="/wiki/Fireball" title="Fireball">Fireball</a></span></li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Fireball");
  });

  test("extracts context from em-dash separated text", () => {
    const html = '<li><a href="/wiki/Fireball" title="Fireball">Fireball</a> \u2014 deals damage to foes</li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Fireball");
    expect(items[0].context).toBe("deals damage to foes");
  });

  test("returns empty array for empty HTML", () => {
    expect(parseRelatedItems("")).toEqual([]);
  });

  test("skips list items with no link title", () => {
    const html = '<li>Some text with no link</li><li><a href="/wiki/Fireball" title="Fireball">Fireball</a></li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Fireball");
  });

  test("extracts icon from img src", () => {
    const html = '<li><img src="https://wiki.guildwars2.com/images/fireball.png"/><a title="Fireball">Fireball</a></li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0].icon).toBe("https://wiki.guildwars2.com/images/fireball.png");
  });

  test("converts protocol-relative icon URLs to https", () => {
    const html = '<li><img src="//wiki.guildwars2.com/images/fireball.png"/><a title="Fireball">Fireball</a></li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0].icon).toBe("https://wiki.guildwars2.com/images/fireball.png");
  });

  test("omits icon and context properties when absent", () => {
    const html = '<li><a title="Fireball">Fireball</a></li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ name: "Fireball" });
    expect(items[0]).not.toHaveProperty("icon");
    expect(items[0]).not.toHaveProperty("context");
  });
});

describe("parseRelatedGroups", () => {
  test("groups traits by h4 headings", () => {
    const html = [
      '<h4>Strength</h4>',
      '<li><a title="Peak Performance">Peak Performance</a> \u2014 +20% strike damage</li>',
      '<h4>Arms</h4>',
      '<li><a title="Rending Strikes">Rending Strikes</a> \u2014 critical hits apply vulnerability</li>',
    ].join("");
    const groups = parseRelatedGroups(html);
    expect(groups).toHaveLength(2);
    expect(groups[0].groupName).toBe("Strength");
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].name).toBe("Peak Performance");
    expect(groups[1].groupName).toBe("Arms");
    expect(groups[1].items).toHaveLength(1);
  });

  test("returns single unnamed group if no headings", () => {
    const html = '<li><a title="Some Trait">Some Trait</a></li>';
    const groups = parseRelatedGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe("");
    expect(groups[0].items).toHaveLength(1);
  });
});
