# Discord Comp Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Share to Discord" button in the comp detail view that posts a webhook embed with an emoji party grid and linked build legend.

**Architecture:** Three new modules — emoji map (`discordEmoji.js`), webhook poster (`discordWebhook.js`), and wiring (IPC handler + preload bridge + UI button). All main-process logic is CJS. The renderer adds a button next to the existing Publish button.

**Tech Stack:** Node.js `https` module for webhook POST, Jest for tests, existing Electron IPC patterns.

**Spec:** `docs/superpowers/specs/2026-03-19-discord-comp-sharing-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/discordEmoji.js` | Create | Emoji map + `getDiscordEmoji(build)` lookup |
| `src/main/discordWebhook.js` | Create | Embed builder + HTTP POST to webhook |
| `src/main/index.js` | Modify | Add `discord:share-comp` IPC handler |
| `src/preload/index.js` | Modify | Add `shareCompToDiscord` bridge method |
| `src/renderer/modules/comps/comp-detail.js` | Modify | Add Share to Discord button + webhook URL prompt |
| `tests/unit/discordEmoji.test.js` | Create | Tests for emoji lookup |
| `tests/unit/discordWebhook.test.js` | Create | Tests for embed builder |

---

### Task 1: Discord Emoji Map

**Files:**
- Create: `tests/unit/discordEmoji.test.js`
- Create: `src/main/discordEmoji.js`

- [ ] **Step 1: Write failing tests for emoji lookup**

```js
// tests/unit/discordEmoji.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/discordEmoji.test.js --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement discordEmoji.js**

Create `src/main/discordEmoji.js` with the full hardcoded emoji map and lookup functions:

```js
// src/main/discordEmoji.js
"use strict";

const DISCORD_EMOJI = {
  // Core professions
  Elementalist: "<:Elementalist:1469132399848853637>",
  Engineer:     "<:Engineer:1484322965368602746>",
  Guardian:     "<:Guardian:1469132552752206010>",
  Mesmer:       "<:Mesmer:1469132581806145662>",
  Necromancer:  "<:Necromancer:1469132584243171368>",
  Ranger:       "<:Ranger:1469132669550985389>",
  Revenant:     "<:Revenant:1469132675695771689>",
  Thief:        "<:Thief:1469132794071355525>",
  Warrior:      "<:Warrior:1469132852938407987>",
  // Elite specs
  Amalgam:      "<:Amalgam:1469132309138767973>",
  Antiquary:    "<:Antiquary:1469132340365099061>",
  Berserker:    "<:Berserker:1469132341371994174>",
  Bladesworn:   "<:Bladesworn:1469132343326277763>",
  Catalyst:     "<:Catalyst:1469132344886689917>",
  Chronomancer: "<:Chronomancer:1469132346296107018>",
  Conduit:      "<:Conduit:1469132392798224465>",
  Daredevil:    "<:Daredevil:1469132393951793331>",
  Deadeye:      "<:Deadeye:1469132396208066624>",
  Dragonhunter: "<:Dragonhunter:1469132397252575292>",
  Druid:        "<:Druid:1469132398514933975>",
  Evoker:       "<:Evoker:1484323009438154924>",
  Firebrand:    "<:Firebrand:1472731858981879880>",
  Galeshot:     "<:Galeshot:1469132551376470016>",
  Harbinger:    "<:Harbinger:1469132554069348465>",
  Herald:       "<:Herald:1469132555428298926>",
  Holosmith:    "<:Holosmith:1469132557030260971>",
  Luminary:     "<:Luminary:1469132578731851878>",
  Mechanist:    "<:Mechanist:1469132580195401890>",
  Mirage:       "<:Mirage:1469132583060111462>",
  Paragon:      "<:Paragon:1469132585429893172>",
  Reaper:       "<:Reaper:1469132671056875570>",
  Renegade:     "<:Renegade:1469132673917128826>",
  Ritualist:    "<:Ritualist:1469132678375931914>",
  Scourge:      "<:Scourge:1469132763444547717>",
  Scrapper:     "<:Scrapper:1469132764883452070>",
  Soulbeast:    "<:Soulbeast:1469132766619893854>",
  Specter:      "<:Specter:1469132768448352369>",
  Spellbreaker: "<:Spellbreaker:1469132769459175445>",
  Tempest:      "<:Tempest:1469132792616190139>",
  Troubadour:   "<:Troubadour:1469132796151726182>",
  Untamed:      "<:Untamed:1469132799696175288>",
  Vindicator:   "<:Vindicator:1469132800958660816>",
  Virtuoso:     "<:Virtuoso:1469132851520737280>",
  Weaver:       "<:Weaver:1469132854524121243>",
  Willbender:   "<:Willbender:1469132856520605707>",
};

function getEliteSpecName(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

function getDiscordEmoji(build) {
  const elite = getEliteSpecName(build);
  if (elite && DISCORD_EMOJI[elite]) return DISCORD_EMOJI[elite];
  if (build.profession && DISCORD_EMOJI[build.profession]) return DISCORD_EMOJI[build.profession];
  return "";
}

function getDisplayName(build) {
  return build.title || getEliteSpecName(build) || build.profession || "Untitled";
}

module.exports = { getDiscordEmoji, getDisplayName, DISCORD_EMOJI };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/discordEmoji.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/discordEmoji.js tests/unit/discordEmoji.test.js
git commit -m "feat: add Discord emoji map for GW2 specs and professions"
```

---

### Task 2: Discord Webhook Module

**Files:**
- Create: `tests/unit/discordWebhook.test.js`
- Create: `src/main/discordWebhook.js`

- [ ] **Step 1: Write failing tests for embed builder**

```js
// tests/unit/discordWebhook.test.js
"use strict";

const { buildCompEmbed } = require("../../src/main/discordWebhook");

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

  test("produces valid embed structure", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    expect(embed.title).toBe("Test Comp");
    expect(embed.url).toBe(compUrl);
    expect(embed.color).toBe(0xFFD700); // PVE gold
    expect(typeof embed.description).toBe("string");
  });

  test("grid section has one row per party line", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    const [grid] = embed.description.split("\n\n");
    const rows = grid.split("\n");
    expect(rows).toHaveLength(2);
    // Party 1 has 2 emojis, party 2 has 1
    expect(rows[0].match(/<:\w+:\d+>/g)).toHaveLength(2);
    expect(rows[1].match(/<:\w+:\d+>/g)).toHaveLength(1);
  });

  test("legend section has one line per unique build", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    const parts = embed.description.split("\n\n");
    const legend = parts.slice(1).join("\n\n");
    const lines = legend.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  test("legend entries with URLs are markdown links", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    expect(embed.description).toContain("[Heal FB](https://x.github.io/axibuilds/?n=heal-fb&b=b1.key)");
  });

  test("legend entries without URLs are plain text", () => {
    const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
    // b3 has no URL in buildUrls
    expect(embed.description).toContain("Condi Scourge");
    expect(embed.description).not.toContain("[Condi Scourge]");
  });

  test("skips missing builds in grid", () => {
    const compWithMissing = {
      ...comp,
      partyLines: [{ id: "p1", capacity: 5, slots: ["b1", "deleted-id"] }],
    };
    const embed = buildCompEmbed(compWithMissing, builds, compUrl, buildUrls);
    const [grid] = embed.description.split("\n\n");
    expect(grid.match(/<:\w+:\d+>/g)).toHaveLength(1);
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
    const [grid] = embed.description.split("\n\n");
    expect(grid.split("\n")).toHaveLength(1);
  });

  test("deduplicates builds in legend", () => {
    const compDup = {
      ...comp,
      partyLines: [
        { id: "p1", capacity: 5, slots: ["b1", "b1"] },
      ],
    };
    const embed = buildCompEmbed(compDup, builds, compUrl, buildUrls);
    const parts = embed.description.split("\n\n");
    const legend = parts.slice(1).join("\n\n");
    const lines = legend.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  test("uses red color for WvW", () => {
    const wvwComp = { ...comp, gameMode: "wvw" };
    const embed = buildCompEmbed(wvwComp, builds, compUrl, buildUrls);
    expect(embed.color).toBe(0xDC143C);
  });

  test("truncates description at 4096 chars while preserving grid", () => {
    // Create a comp with many builds to exceed the limit
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
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(embed.description).toMatch(/\.\.\.$/);
    // Grid section (before first \n\n) must be preserved intact
    const [grid] = embed.description.split("\n\n");
    expect(grid.match(/<:\w+:\d+>/g)).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/discordWebhook.test.js --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement discordWebhook.js**

Create `src/main/discordWebhook.js`:

```js
// src/main/discordWebhook.js
"use strict";

const https = require("node:https");
const { getDiscordEmoji, getDisplayName } = require("./discordEmoji");

const EMBED_DESC_LIMIT = 4096;
const COLOR_PVE = 0xFFD700;
const COLOR_WVW = 0xDC143C;

function buildCompEmbed(comp, builds, compUrl, buildUrls) {
  // ── Grid: one row of emojis per party line ──
  const gridRows = [];
  for (const line of comp.partyLines || []) {
    const emojis = [];
    for (const slotId of line.slots || []) {
      const build = builds[slotId];
      if (!build) continue;
      const emoji = getDiscordEmoji(build);
      if (emoji) emojis.push(emoji);
    }
    if (emojis.length > 0) gridRows.push(emojis.join(" "));
  }

  // ── Legend: one line per unique build ──
  const seen = new Set();
  const legendLines = [];
  for (const line of comp.partyLines || []) {
    for (const slotId of line.slots || []) {
      if (seen.has(slotId)) continue;
      seen.add(slotId);
      const build = builds[slotId];
      if (!build) continue;
      const emoji = getDiscordEmoji(build);
      const name = getDisplayName(build);
      const url = buildUrls[slotId];
      const nameStr = url ? `[${name}](${url})` : name;
      legendLines.push(`${emoji} ${nameStr}`);
    }
  }

  // ── Assemble description with truncation ──
  const grid = gridRows.join("\n");
  let description = grid + "\n\n" + legendLines.join("\n");

  if (description.length > EMBED_DESC_LIMIT) {
    const prefix = grid + "\n\n";
    const remaining = EMBED_DESC_LIMIT - prefix.length - 3; // 3 for "..."
    const truncatedLegend = legendLines.join("\n").slice(0, remaining);
    // Cut at last complete line
    const lastNewline = truncatedLegend.lastIndexOf("\n");
    description = prefix + (lastNewline > 0 ? truncatedLegend.slice(0, lastNewline) : truncatedLegend) + "...";
  }

  return {
    title: comp.name || "Untitled Comp",
    url: compUrl,
    description,
    color: comp.gameMode === "wvw" ? COLOR_WVW : COLOR_PVE,
  };
}

function postWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", (err) => reject(err));
    req.write(data);
    req.end();
  });
}

async function shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl) {
  const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);
  const payload = { embeds: [embed] };

  try {
    const res = await postWebhook(webhookUrl, payload);
    if (res.status === 204 || res.status === 200) {
      return { success: true };
    }
    if (res.status === 401 || res.status === 404) {
      return { success: false, error: "Webhook URL is invalid or has been deleted" };
    }
    if (res.status === 429) {
      return { success: false, error: "Rate limited by Discord. Try again in a few seconds." };
    }
    return { success: false, error: `Discord returned status ${res.status}` };
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` };
  }
}

module.exports = { buildCompEmbed, shareCompToDiscord };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/discordWebhook.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/discordWebhook.js tests/unit/discordWebhook.test.js
git commit -m "feat: add Discord webhook embed builder for comp sharing"
```

---

### Task 3: IPC Handler + Preload Bridge

**Files:**
- Modify: `src/main/index.js` (after the `settings:set` handler, around line 634)
- Modify: `src/preload/index.js` (after `setSetting`, around line 66)

- [ ] **Step 1: Add IPC handler to index.js**

Add after the `settings:set` handler (line 634 of `src/main/index.js`):

```js
  ipcMain.handle("discord:share-comp", async (_e, compId) => {
    const { shareCompToDiscord } = require("./discordWebhook");

    // 1. Load webhook URL
    const webhookUrl = await store.getSetting("discord.webhookUrl");
    if (!webhookUrl || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)) {
      return { success: false, error: "Discord webhook URL is not configured or invalid" };
    }

    // 2. Load and validate comp
    const allComps = await compStore.listComps();
    const comp = allComps.find((c) => c.id === compId);
    if (!comp) return { success: false, error: "Comp not found" };
    if (!comp.publishedFileId || !comp.publishedKey || !comp.publishedSlug) {
      return { success: false, error: "Comp must be published before sharing" };
    }

    // 3. Resolve owner for URL construction (matches existing publish pattern)
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    if (!owner) return { success: false, error: "GitHub publishing not configured" };
    const repo = auth?.onboarding?.repoName || TARGET_REPO;

    // 4. Build comp URL
    const compUrl = `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(comp.publishedSlug)}&c=${comp.publishedFileId}.${comp.publishedKey}`;

    // 5. Load builds and construct maps
    const allBuilds = await store.listBuilds();
    const buildsMap = {};
    const buildUrls = {};
    for (const build of allBuilds) {
      buildsMap[build.id] = build;
      if (build.publishedSlug && build.publishedFileId && build.publishedKey) {
        buildUrls[build.id] = `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(build.publishedSlug)}&b=${build.publishedFileId}.${build.publishedKey}`;
      }
    }

    // 6. Share
    return shareCompToDiscord(comp, buildsMap, compUrl, buildUrls, webhookUrl);
  });
```

- [ ] **Step 2: Add preload bridge method**

Add after the `setSetting` line (line 66 of `src/preload/index.js`):

```js
  shareCompToDiscord: (compId) => ipcRenderer.invoke("discord:share-comp", compId),
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `npx jest --no-coverage`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: wire Discord comp sharing IPC handler and preload bridge"
```

---

### Task 4: Share to Discord Button in Comp Detail UI

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js`

- [ ] **Step 1: Add the Share to Discord button to the topbar HTML**

In `renderCompDetail()` (around line 368), add the Discord share button after the Publish button. The button should only appear when the comp is published:

```js
// After the existing publish button line:
//   <button type="button" class="btn btn-primary" data-action="publish">Publish</button>
// Add:
${comp.publishedFileId ? '<button type="button" class="btn btn-secondary" data-action="share-discord">Share to Discord</button>' : ""}
```

Also add a status element for the Discord share feedback, near the existing `compPublishStatus`:

```html
<span class="comp-detail__discord-status" id="compDiscordStatus"></span>
```

- [ ] **Step 2: Add click handler for the share button**

In `bindDetailEvents()` (after the publish handler around line 833), add the Discord share event handler:

```js
  // ── Share to Discord ────────────────────────────────────────────────────────
  const discordBtn = container.querySelector("[data-action='share-discord']");
  if (discordBtn) {
    discordBtn.addEventListener("click", async () => {
      // Check if webhook URL is configured
      let webhookUrl = await window.desktopApi.getSetting("discord.webhookUrl");
      if (!webhookUrl) {
        const url = prompt("Paste your Discord webhook URL:");
        if (!url) return;
        if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
          showDiscordStatus("Invalid webhook URL", true);
          return;
        }
        await window.desktopApi.setSetting("discord.webhookUrl", url);
        webhookUrl = url;
      }

      discordBtn.disabled = true;
      showDiscordStatus("Sharing...");
      try {
        const result = await window.desktopApi.shareCompToDiscord(comp.id);
        if (result.success) {
          showDiscordStatus("Shared to Discord!");
        } else {
          showDiscordStatus(result.error || "Failed to share", true);
        }
      } catch (err) {
        showDiscordStatus(err.message || "Failed to share", true);
      } finally {
        discordBtn.disabled = false;
      }
    });
  }
```

- [ ] **Step 3: Add the showDiscordStatus helper**

Add near the top of the file (with the other helper functions):

```js
function showDiscordStatus(msg, isError = false) {
  const el = document.getElementById("compDiscordStatus");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("comp-detail__discord-status--error", isError);
  if (!isError) {
    setTimeout(() => { el.textContent = ""; }, 3000);
  }
}
```

- [ ] **Step 4: Manually test the button appears and works**

1. Open the app, navigate to a published comp
2. Verify "Share to Discord" button appears next to Publish
3. Click it — if no webhook URL configured, a prompt should appear
4. After entering a valid webhook URL, the comp should be posted to Discord
5. Verify the embed looks correct in Discord (emoji grid + legend + links)
6. Verify button is hidden for unpublished comps

- [ ] **Step 5: Run all tests to verify nothing broke**

Run: `npx jest --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: add Share to Discord button in comp detail view"
```
