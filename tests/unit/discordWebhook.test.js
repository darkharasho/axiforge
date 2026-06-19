"use strict";

jest.mock("node:https");

const https = require("node:https");
const { buildCompEmbed, buildCompEmbeds, shareCompToDiscord, buildBuildEmbed, shareBuildToDiscord, formatBuildDiscordCopy } = require("../../src/main/discordWebhook");

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
    expect(embed.author.icon_url).toMatch(/AxiForge-White\.png$/);
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

  test("builds entries with URLs are markdown links", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    expect(embed.fields[1].value).toContain("[Heal FB](https://x.github.io/axibuilds/?n=heal-fb&b=b1.key)");
  });

  test("builds entries without URLs are plain text", () => {
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

  test("shows builds in the comp that are not placed in any line", () => {
    // b3 is in buildIds but not in any party line slot
    const compWithExtra = {
      ...comp,
      partyLines: [{ id: "p1", capacity: 5, slots: ["b1", "b2"] }],
      buildIds: ["b1", "b2", "b3"],
    };
    const embed = buildCompEmbed(compWithExtra, builds, compUrl, buildUrls);
    // Legend lists the unplaced build
    const lines = embed.fields[1].value.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(embed.fields[1].value).toContain("Condi Scourge");
    // Grid gets an extra "➕" row for unassigned builds
    const rows = embed.fields[0].value.split("\n");
    expect(rows.some((r) => r.startsWith("➕"))).toBe(true);
  });

  test("does not duplicate placed builds listed in buildIds", () => {
    const compWithBuildIds = {
      ...comp,
      buildIds: ["b1", "b2", "b3"], // all already placed in lines
    };
    const embed = buildCompEmbed(compWithBuildIds, builds, compUrl, buildUrls);
    const lines = embed.fields[1].value.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const rows = embed.fields[0].value.split("\n");
    expect(rows.some((r) => r.startsWith("➕"))).toBe(false);
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
      bigUrls[id] = `https://x.github.io/axibuilds/r/${id}`;
    }
    const embed = buildCompEmbed(bigComp, manyBuilds, compUrl, bigUrls);
    // Should have more than 2 fields
    expect(embed.fields.length).toBeGreaterThan(2);
    // All builds field values within 1024 chars
    for (const field of embed.fields.slice(1)) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
    // Grid field preserved
    expect(embed.fields[0].value.match(/<:\w+:\d+>/g)).toHaveLength(50);
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

  test("none mode posts without thread_name or thread_id", async () => {
    mockHttpsResponse(204);
    await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl, { threadMode: "none" });
    const reqOpts = https.request.mock.calls[0][0];
    expect(reqOpts.path).toBe("/api/webhooks/123/abc");
    const req = https.request.mock.results[0].value;
    const payload = JSON.parse(req.write.mock.calls[0][0]);
    expect(payload.thread_name).toBeUndefined();
  });

  test("auto mode sends thread_name from comp name", async () => {
    mockHttpsResponse(204);
    await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl, { threadMode: "auto" });
    const reqOpts = https.request.mock.calls[0][0];
    expect(reqOpts.path).toBe("/api/webhooks/123/abc");
    const req = https.request.mock.results[0].value;
    const payload = JSON.parse(req.write.mock.calls[0][0]);
    expect(payload.thread_name).toBe("Test Comp");
  });

  test("custom mode appends thread_id to webhook URL", async () => {
    mockHttpsResponse(204);
    await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl, { threadMode: "custom", threadId: "9876543210" });
    const reqOpts = https.request.mock.calls[0][0];
    expect(reqOpts.path).toBe("/api/webhooks/123/abc?thread_id=9876543210");
    const req = https.request.mock.results[0].value;
    const payload = JSON.parse(req.write.mock.calls[0][0]);
    expect(payload.thread_name).toBeUndefined();
  });

  test("defaults to none mode when no options provided", async () => {
    mockHttpsResponse(204);
    await shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl);
    const req = https.request.mock.results[0].value;
    const payload = JSON.parse(req.write.mock.calls[0][0]);
    expect(payload.thread_name).toBeUndefined();
  });
});

describe("buildBuildEmbed", () => {
  const build = makeBuild("b1", "Guardian", "Firebrand", "Heal FB");
  build.updatedAt = "2026-03-20T12:00:00Z";
  build.gameMode = "pve";
  const buildUrl = "https://x.github.io/axibuilds/r/b1";
  const chatLink = "[&DQkAAAA=]";
  const specIconUrl = "https://render.guildwars2.com/file/abc/123.png";
  const profIconUrl = "https://render.guildwars2.com/file/def/456.png";
  const meta = { professionIconUrl: profIconUrl, specIconUrl, eliteSpecName: "Firebrand", gameMode: "pve", role: "Heal Support" };

  test("produces embed with profession color", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.color).toBe(0x6EA8FF); // Guardian blue
  });

  test("title includes emoji and build name", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.title).toContain("Firebrand");
    expect(embed.title).toContain("Heal FB");
  });

  test("url is the build URL", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.url).toBe(buildUrl);
  });

  test("description contains build URL; chat link is in Build Code field", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.description).toContain(buildUrl);
    const buildCodeField = (embed.fields || []).find(f => f.name === "Build Code");
    expect(buildCodeField).toBeDefined();
    expect(buildCodeField.value).toContain("```");
    expect(buildCodeField.value).toContain(chatLink);
  });

  test("thumbnail uses profession big icon URL", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.thumbnail).toEqual({ url: profIconUrl });
  });

  test("footer contains tags and last updated date", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.footer.text).toContain("PVE");
    expect(embed.footer.text).toContain("Firebrand");
    expect(embed.footer.text).toContain("Heal Support");
    expect(embed.footer.text).toMatch(/Last updated:.*Mar.*20.*2026/);
  });

  test("footer has text but no icon_url (icon removed from footer design)", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.footer).toBeDefined();
    expect(embed.footer.text).toBeDefined();
    expect(embed.footer.icon_url).toBeUndefined();
  });

  test("has AxiForge author block", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, meta);
    expect(embed.author.name).toBe("AxiForge");
  });

  test("omits thumbnail when no icon URLs", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, {});
    expect(embed.thumbnail).toBeUndefined();
  });

  test("falls back to spec icon for thumbnail when no profession icon", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, { specIconUrl });
    expect(embed.thumbnail).toEqual({ url: specIconUrl });
  });

  test("omits footer when no tags and no updatedAt", () => {
    const noDate = { ...build, updatedAt: null };
    const embed = buildBuildEmbed(noDate, buildUrl, chatLink, {});
    expect(embed.footer).toBeUndefined();
  });

  test("excludes Unknown role from footer tags", () => {
    const embed = buildBuildEmbed(build, buildUrl, chatLink, { ...meta, role: "Unknown" });
    expect(embed.footer.text).not.toContain("Unknown");
  });

  test("omits chat link code block when no chat link", () => {
    const embed = buildBuildEmbed(build, buildUrl, null, meta);
    expect(embed.description).not.toContain("```");
    expect(embed.description).toContain(buildUrl);
  });

  test("uses Necromancer color for Necromancer build", () => {
    const necro = makeBuild("b2", "Necromancer", "Scourge", "Condi Scourge");
    const embed = buildBuildEmbed(necro, buildUrl, chatLink, meta);
    expect(embed.color).toBe(0x4DCA7A);
  });

  test("uses Elementalist color for Elementalist build", () => {
    const ele = makeBuild("b3", "Elementalist", "Catalyst", "Power Cata");
    const embed = buildBuildEmbed(ele, buildUrl, chatLink, meta);
    expect(embed.color).toBe(0xDD5555);
  });
});

describe("shareBuildToDiscord", () => {
  const webhookUrl = "https://discord.com/api/webhooks/123/abc";
  const build = makeBuild("b1", "Guardian", "Firebrand", "Heal FB");
  build.updatedAt = "2026-03-20T12:00:00Z";
  const buildUrl = "https://x.github.io/axibuilds/r/b1";
  const chatLink = "[&DQkAAAA=]";
  const embedMeta = { specIconUrl: "https://render.guildwars2.com/file/abc/123.png", gameMode: "pve", role: "Heal Support" };

  function mockHttpsResponse(statusCode) {
    const res = {
      statusCode,
      on: jest.fn((event, cb) => {
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

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("204 returns success", async () => {
    mockHttpsResponse(204);
    const result = await shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, webhookUrl);
    expect(result).toEqual({ success: true });
  });

  test("sends embed with build title in payload", async () => {
    mockHttpsResponse(204);
    await shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, webhookUrl);
    const req = https.request.mock.results[0].value;
    const payload = JSON.parse(req.write.mock.calls[0][0]);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].title).toContain("Heal FB");
  });

  test("auto mode sends thread_name from build name", async () => {
    mockHttpsResponse(204);
    await shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, webhookUrl, { threadMode: "auto" });
    const req = https.request.mock.results[0].value;
    const payload = JSON.parse(req.write.mock.calls[0][0]);
    expect(payload.thread_name).toBe("Heal FB");
  });

  test("custom mode appends thread_id", async () => {
    mockHttpsResponse(204);
    await shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, webhookUrl, { threadMode: "custom", threadId: "999" });
    const reqOpts = https.request.mock.calls[0][0];
    expect(reqOpts.path).toContain("thread_id=999");
  });

  test("429 returns rate limit error", async () => {
    mockHttpsResponse(429);
    const result = await shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, webhookUrl);
    expect(result).toEqual({ success: false, error: "Rate limited by Discord. Try again in a few seconds." });
  });
});

describe("formatBuildDiscordCopy", () => {
  const build = makeBuild("b1", "Guardian", "Firebrand", "Heal FB");
  const buildUrl = "https://x.github.io/axibuilds/r/b1";

  test("formats as markdown link with emoji when URL provided", () => {
    const text = formatBuildDiscordCopy(build, buildUrl);
    expect(text).toContain("[Heal FB]");
    expect(text).toContain(buildUrl);
    expect(text).toMatch(/<:Firebrand:\d+>/);
  });

  test("formats as plain text with emoji when no URL", () => {
    const text = formatBuildDiscordCopy(build, null);
    expect(text).toContain("Heal FB");
    expect(text).not.toContain("[");
    expect(text).toMatch(/<:Firebrand:\d+>/);
  });

  test("uses profession emoji when no elite spec", () => {
    const coreBuild = makeBuild("b2", "Guardian", null, "Core Guard");
    const text = formatBuildDiscordCopy(coreBuild, buildUrl);
    expect(text).toMatch(/<:Guardian:\d+>/);
    expect(text).toContain("[Core Guard]");
  });
});

describe("buildCompEmbeds — embed limit splitting", () => {
  function makeLargeComp(buildCount) {
    const slots = [];
    const builds = {};
    const buildUrls = {};
    for (let i = 0; i < buildCount; i++) {
      const id = `b${i}`;
      slots.push(id);
      builds[id] = makeBuild(id, "Guardian", "Firebrand", "A".repeat(60) + ` Build ${i}`);
      buildUrls[id] = `https://x.github.io/axibuilds/?n=${"a".repeat(50)}&b=${id}.key`;
    }
    const comp = {
      name: "Big Comp",
      gameMode: "pve",
      partyLines: [{ id: "p1", capacity: buildCount, slots }],
    };
    return { comp, builds, buildUrls };
  }

  const compUrl = "https://x.github.io/axibuilds/?n=test&c=abc.key";

  test("returns single-element array for small comp", () => {
    const comp = {
      name: "Small Comp",
      gameMode: "pve",
      partyLines: [{ id: "p1", capacity: 5, slots: ["b1", "b2"] }],
    };
    const builds = {
      b1: makeBuild("b1", "Guardian", "Firebrand", "Heal FB"),
      b2: makeBuild("b2", "Elementalist", "Catalyst", "Power Cata"),
    };
    const embeds = buildCompEmbeds(comp, builds, compUrl, {});
    expect(embeds).toHaveLength(1);
    expect(embeds[0].title).toBe("Small Comp");
    expect(embeds[0].fields).toHaveLength(2);
  });

  test("splits into multiple embeds when total chars exceed 6000", () => {
    const { comp, builds, buildUrls } = makeLargeComp(40);
    const embeds = buildCompEmbeds(comp, builds, compUrl, buildUrls);
    expect(embeds.length).toBeGreaterThan(1);
    // First embed has title and author
    expect(embeds[0].title).toBe("Big Comp");
    expect(embeds[0].author).toBeDefined();
    // All embeds share the same color
    for (const e of embeds) {
      expect(e.color).toBe(embeds[0].color);
    }
  });

  test("no single embed exceeds 6000 total characters", () => {
    const { comp, builds, buildUrls } = makeLargeComp(40);
    const embeds = buildCompEmbeds(comp, builds, compUrl, buildUrls);
    for (const embed of embeds) {
      let count = 0;
      if (embed.title) count += embed.title.length;
      if (embed.description) count += embed.description.length;
      if (embed.author?.name) count += embed.author.name.length;
      if (embed.footer?.text) count += embed.footer.text.length;
      for (const f of embed.fields || []) {
        count += (f.name || "").length + (f.value || "").length;
      }
      expect(count).toBeLessThanOrEqual(6000);
    }
  });

  test("no single embed exceeds 25 fields", () => {
    const { comp, builds, buildUrls } = makeLargeComp(40);
    const embeds = buildCompEmbeds(comp, builds, compUrl, buildUrls);
    for (const embed of embeds) {
      expect((embed.fields || []).length).toBeLessThanOrEqual(25);
    }
  });

  test("continuation embeds have no title or author", () => {
    const { comp, builds, buildUrls } = makeLargeComp(40);
    const embeds = buildCompEmbeds(comp, builds, compUrl, buildUrls);
    expect(embeds.length).toBeGreaterThan(1);
    for (const e of embeds.slice(1)) {
      expect(e.title).toBeUndefined();
      expect(e.author).toBeUndefined();
    }
  });

  test("truncates comp title exceeding 256 characters", () => {
    const comp = {
      name: "A".repeat(300),
      gameMode: "pve",
      partyLines: [{ id: "p1", capacity: 5, slots: ["b1"] }],
    };
    const builds = { b1: makeBuild("b1", "Guardian", "Firebrand", "Heal FB") };
    const embeds = buildCompEmbeds(comp, builds, compUrl, {});
    expect(embeds[0].title.length).toBeLessThanOrEqual(256);
    expect(embeds[0].title.endsWith("\u2026")).toBe(true);
  });

  test("truncates comp description exceeding 4096 characters", () => {
    const comp = {
      name: "Test Comp",
      notes: "N".repeat(5000),
      gameMode: "pve",
      partyLines: [{ id: "p1", capacity: 5, slots: ["b1"] }],
    };
    const builds = { b1: makeBuild("b1", "Guardian", "Firebrand", "Heal FB") };
    const embeds = buildCompEmbeds(comp, builds, compUrl, {});
    expect(embeds[0].description.length).toBeLessThanOrEqual(4096);
    expect(embeds[0].description.endsWith("\u2026")).toBe(true);
  });
});

describe("shareCompToDiscord — multi-embed payload", () => {
  const webhookUrl = "https://discord.com/api/webhooks/123/abc";

  function mockHttpsResponse(statusCode, body = "") {
    const res = {
      statusCode,
      on: jest.fn((event, cb) => {
        if (event === "data" && body) cb(body);
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
    return req;
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("sends multiple embeds for large comp", () => {
    const req = mockHttpsResponse(204);
    const slots = [];
    const builds = {};
    const buildUrls = {};
    for (let i = 0; i < 40; i++) {
      const id = `b${i}`;
      slots.push(id);
      builds[id] = makeBuild(id, "Guardian", "Firebrand", "A".repeat(60) + ` Build ${i}`);
      buildUrls[id] = `https://x.github.io/axibuilds/?n=${"a".repeat(50)}&b=${id}.key`;
    }
    const comp = {
      name: "Big Comp",
      gameMode: "pve",
      partyLines: [{ id: "p1", capacity: 40, slots }],
    };
    return shareCompToDiscord(comp, builds, "https://x.github.io/axibuilds/?n=test&c=abc.key", buildUrls, webhookUrl).then((result) => {
      expect(result).toEqual({ success: true });
      const payload = JSON.parse(req.write.mock.calls[0][0]);
      expect(payload.embeds.length).toBeGreaterThan(1);
    });
  });

  test("includes Discord error body in error message for 400", () => {
    mockHttpsResponse(400, '{"message":"Invalid Form Body","code":50035}');
    const comp = {
      name: "Test Comp",
      gameMode: "pve",
      partyLines: [{ id: "p1", capacity: 5, slots: ["b1"] }],
    };
    const builds = { b1: makeBuild("b1", "Guardian", "Firebrand", "Heal FB") };
    return shareCompToDiscord(comp, builds, "https://example.com", {}, webhookUrl).then((result) => {
      expect(result.success).toBe(false);
      expect(result.error).toContain("400");
      expect(result.error).toContain("Invalid Form Body");
    });
  });
});

describe("shareBuildToDiscord — error body", () => {
  const webhookUrl = "https://discord.com/api/webhooks/123/abc";

  function mockHttpsResponse(statusCode, body = "") {
    const res = {
      statusCode,
      on: jest.fn((event, cb) => {
        if (event === "data" && body) cb(body);
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

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("includes Discord error body in error message for 400", () => {
    mockHttpsResponse(400, '{"message":"Invalid Form Body"}');
    const build = makeBuild("b1", "Guardian", "Firebrand", "Heal FB");
    return shareBuildToDiscord(build, "https://example.com", "[&DQk=]", {}, webhookUrl).then((result) => {
      expect(result.success).toBe(false);
      expect(result.error).toContain("400");
      expect(result.error).toContain("Invalid Form Body");
    });
  });
});
