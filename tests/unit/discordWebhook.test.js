"use strict";

jest.mock("node:https");

const https = require("node:https");
const { buildCompEmbed, shareCompToDiscord } = require("../../src/main/discordWebhook");

function makeBuild(id, profession, eliteSpec, title) {
  return {
    id,
    profession,
    title,
    specializations: eliteSpec ? [{ name: eliteSpec, elite: true }] : [],
  };
}

describe("buildCompEmbed", () => {
  const comp = {
    name: "Test Comp",
    gameMode: "pve",
    partyLines: [
      { id: "p1", capacity: 5, slots: ["b1", "b2"] },
      { id: "p2", capacity: 5, slots: ["b3"] },
    ],
  };
  const builds = {
    b1: makeBuild("b1", "Guardian", "Firebrand", "Heal FB"),
    b2: makeBuild("b2", "Elementalist", "Catalyst", "Power Cata"),
    b3: makeBuild("b3", "Necromancer", "Scourge", "Condi Scourge"),
  };
  const compUrl = "https://x.github.io/axibuilds/?n=test&c=abc.key";
  const buildUrls = {
    b1: "https://x.github.io/axibuilds/?n=heal-fb&b=b1.key",
    b2: "https://x.github.io/axibuilds/?n=power-cata&b=b2.key",
  };

  test("produces valid embed structure with inline fields", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    expect(embed.title).toBe("Test Comp");
    expect(embed.url).toBe(compUrl);
    expect(embed.color).toBe(0xFFD700);
    expect(embed.fields).toHaveLength(2);
    expect(embed.fields[0].name).toBe("Comp");
    expect(embed.fields[0].inline).toBe(true);
    expect(embed.fields[1].name).toBe("Builds");
    expect(embed.fields[1].inline).toBe(true);
    expect(embed.author.name).toBe("AxiForge");
    expect(embed.author.url).toContain("github.com");
    expect(embed.author.icon_url).toMatch(/build_logo\.png$/);
  });

  test("grid field has one row per party line", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    const rows = embed.fields[0].value.split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[0].match(/<:\w+:\d+>/g)).toHaveLength(2);
    expect(rows[1].match(/<:\w+:\d+>/g)).toHaveLength(1);
  });

  test("builds field has one line per unique build", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    const lines = embed.fields[1].value.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  test("builds field entries with URLs are markdown links", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    expect(embed.fields[1].value).toContain("[Heal FB](https://x.github.io/axibuilds/?n=heal-fb&b=b1.key)");
  });

  test("builds field entries without URLs are plain text", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    expect(embed.fields[1].value).toContain("Condi Scourge");
    expect(embed.fields[1].value).not.toContain("[Condi Scourge]");
  });

  test("skips missing builds in grid", () => {
    const compWithMissing = {
      ...comp,
      partyLines: [{ id: "p1", capacity: 5, slots: ["b1", "deleted-id"] }],
    };
    const embed = buildCompEmbed(compWithMissing, builds, compUrl, buildUrls);
    expect(embed.fields[0].value.match(/<:\w+:\d+>/g)).toHaveLength(1);
  });

  test("omits party lines with zero resolved builds", () => {
    const compEmpty = {
      ...comp,
      partyLines: [
        { id: "p1", capacity: 5, slots: ["b1"] },
        { id: "p2", capacity: 5, slots: ["deleted-id"] },
      ],
    };
    const embed = buildCompEmbed(compEmpty, builds, compUrl, buildUrls);
    expect(embed.fields[0].value.split("\n")).toHaveLength(1);
  });

  test("deduplicates builds in legend", () => {
    const compDup = {
      ...comp,
      partyLines: [
        { id: "p1", capacity: 5, slots: ["b1", "b1"] },
      ],
    };
    const embed = buildCompEmbed(compDup, builds, compUrl, buildUrls);
    const lines = embed.fields[1].value.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  test("uses red color for WvW", () => {
    const wvwComp = { ...comp, gameMode: "wvw" };
    const embed = buildCompEmbed(wvwComp, builds, compUrl, buildUrls);
    expect(embed.color).toBe(0xDC143C);
  });

  test("splits builds across multiple fields when exceeding 1024 chars", () => {
    const manyBuilds = {};
    const slots = [];
    for (let i = 0; i < 50; i++) {
      const id = `b${i}`;
      slots.push(id);
      manyBuilds[id] = makeBuild(id, "Guardian", "Firebrand", "A".repeat(70) + ` Build ${i}`);
    }
    const bigComp = {
      name: "Big Comp",
      gameMode: "pve",
      partyLines: [{ id: "p1", capacity: 50, slots }],
    };
    const bigUrls = {};
    for (const id of slots) {
      bigUrls[id] = `https://x.github.io/axibuilds/?n=${id}&b=${id}.key`;
    }
    const embed = buildCompEmbed(bigComp, manyBuilds, compUrl, bigUrls);
    // Should have more than 2 fields (Comp + multiple Builds chunks)
    expect(embed.fields.length).toBeGreaterThan(2);
    // Every builds field value must be within 1024 chars
    for (const field of embed.fields.slice(1)) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
    // Grid field preserved intact
    expect(embed.fields[0].value.match(/<:\w+:\d+>/g)).toHaveLength(50);
    // Overflow comes in pairs: blank spacer (inline) + builds chunk (inline)
    for (let i = 2; i < embed.fields.length; i++) {
      expect(embed.fields[i].inline).toBe(true);
    }
  });
});

describe("shareCompToDiscord", () => {
  const webhookUrl = "https://discord.com/api/webhooks/123/abc";
  const comp = {
    name: "Test Comp",
    gameMode: "pve",
    partyLines: [{ id: "p1", capacity: 5, slots: ["b1"] }],
  };
  const builds = { b1: makeBuild("b1", "Guardian", "Firebrand", "Heal FB") };
  const compUrl = "https://x.github.io/axibuilds/?n=test&c=abc.key";
  const buildUrls = {};

  function mockHttpsResponse(statusCode) {
    const res = {
      statusCode,
      on: jest.fn((event, cb) => {
        if (event === "data") { /* no body chunks */ }
        if (event === "end") cb();
        return res;
      }),
    };
    const req = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation((_opts, callback) => {
      callback(res);
      return req;
    });
  }

  function mockHttpsError(message) {
    const req = {
      on: jest.fn((event, cb) => {
        if (event === "error") cb(new Error(message));
        return req;
      }),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation(() => req);
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("204 returns success", async () => {
    mockHttpsResponse(204);
    const result = await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    expect(result).toEqual({ success: true });
  });

  test("200 returns success", async () => {
    mockHttpsResponse(200);
    const result = await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    expect(result).toEqual({ success: true });
  });

  test("401 returns invalid webhook error", async () => {
    mockHttpsResponse(401);
    const result = await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    expect(result).toEqual({ success: false, error: "Webhook URL is invalid or has been deleted" });
  });

  test("404 returns invalid webhook error", async () => {
    mockHttpsResponse(404);
    const result = await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    expect(result).toEqual({ success: false, error: "Webhook URL is invalid or has been deleted" });
  });

  test("429 returns rate limit error", async () => {
    mockHttpsResponse(429);
    const result = await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    expect(result).toEqual({ success: false, error: "Rate limited by Discord. Try again in a few seconds." });
  });

  test("500 returns generic status error", async () => {
    mockHttpsResponse(500);
    const result = await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    expect(result).toEqual({ success: false, error: "Discord returned status 500" });
  });

  test("network error returns error with message", async () => {
    mockHttpsError("connect ECONNREFUSED");
    const result = await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    expect(result).toEqual({ success: false, error: "Network error: connect ECONNREFUSED" });
  });
});
