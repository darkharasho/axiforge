"use strict";
const { serveBakedGw2Api, _resetBakedCache } = require("../../src/main/gw2ApiBaked.js");

const BAKED = {
  professions: [{ id: "Engineer", code: 3 }, { id: "Guardian", code: 1 }],
  skills: [{ id: 5812, name: "Grenade Kit", flags: [] }, { id: 5825, name: "Bomb Kit", flags: [] }],
  specializations: [{ id: 6, name: "Explosives", elite: false }],
  pets: [{ id: 42, name: "Juvenile Jungle Stalker" }],
  traits: [{ id: 214, name: "Glass Cannon" }],
};
const loadJson = async (ep) => BAKED[ep];

describe("serveBakedGw2Api", () => {
  beforeEach(() => _resetBakedCache());

  it("returns null for non-GW2 URLs", async () => {
    expect(await serveBakedGw2Api("https://example.com/x", loadJson)).toBeNull();
  });

  it("serves ?ids=all", async () => {
    const res = await serveBakedGw2Api("https://api.guildwars2.com/v2/professions?ids=all&v=latest", loadJson);
    expect(await res.json()).toHaveLength(2);
  });

  it("filters ?ids=<list> preserving only matches", async () => {
    const res = await serveBakedGw2Api("https://api.guildwars2.com/v2/skills?ids=5812,9999,5825&v=latest", loadJson);
    const body = await res.json();
    expect(body.map((s) => s.id)).toEqual([5812, 5825]);
  });

  it("serves a single resource by path id (string professions)", async () => {
    const res = await serveBakedGw2Api("https://api.guildwars2.com/v2/professions/Engineer?v=latest", loadJson);
    expect((await res.json()).code).toBe(3);
  });

  it("serves ?search=<name> as an array of matching ids", async () => {
    const res = await serveBakedGw2Api("https://api.guildwars2.com/v2/skills?search=bomb&v=latest", loadJson);
    expect(await res.json()).toEqual([5825]);
  });
});
