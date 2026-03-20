# Discord Comp Sharing

**Date:** 2026-03-19
**Status:** Draft

## Overview

Share published comps to Discord via webhook. Posts an embed with a compact emoji grid showing party composition and a legend with linked build names.

## Embed Layout

```
┌─────────────────────────────────────────┐
│  Comp Name                    (clickable)│
│─────────────────────────────────────────│
│  <:FB:> <:Lumi:> <:Cata:> <:Scou:> <:Harb:>  │
│  <:FB:> <:Cata:> <:Scou:> <:Dru:> <:Troub:>  │
│                                         │
│  <:FB:>    [Heal Firebrand](url)        │
│  <:Lumi:>  [Alac Luminary](url)         │
│  <:Cata:>  [Power Catalyst](url)        │
│  <:Scou:>  [Condi Scourge](url)         │
│  <:Harb:>  [Condi Harbinger](url)       │
│  <:Dru:>   [Heal Druid](url)           │
│  <:Troub:> [Alac Troubadour](url)       │
└─────────────────────────────────────────┘
```

- **Grid:** One row per party line, emoji-only, no text. Empty slots skipped. Party lines with zero resolved builds are omitted entirely.
- **Legend:** One line per unique build (deduplicated by build ID across all parties). Emoji + markdown-linked build name. Builds without a published URL show plain text (no link).
- **Build display name:** Use the same logic as the app: elite spec name → build title → profession → "Untitled". Implemented inline in `discordWebhook.js` (duplicated from renderer's `getDisplayName` since this runs in main process).
- **Title:** Comp name, clickable — links to the published comp page via embed `url` field.
- **Color:** Based on game mode — gold (`0xFFD700`) for PVE, red (`0xDC143C`) for WVW.
- **Character limit:** Discord embed descriptions are capped at 4096 characters. If the generated description exceeds this, truncate the legend (keeping the grid intact) and append "..." at the end.

## Architecture

### 1. Emoji Map — `src/main/discordEmoji.js`

Hardcoded map of GW2 profession/elite spec names → Discord emoji strings.

```js
const DISCORD_EMOJI = {
  // Core professions
  Elementalist: "<:Elementalist:1469132399848853637>",
  Engineer:     "<:Engineer:1484322965368602746>",
  Guardian:     "<:Guardian:1469132552752206010>",
  // ... all 9 core + all elite specs + Amalgam + Antiquary
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
```

Note: `getEliteSpecName` is intentionally duplicated from `src/renderer/modules/build-helpers.js` because this module runs in the main process (Node.js) and cannot import renderer modules.

Lookup priority: elite spec name (from `build.specializations` where `elite === true`) → `build.profession` → empty string.

### 2. Webhook Module — `src/main/discordWebhook.js`

Builds the embed payload and POSTs to the configured webhook URL.

```js
async function shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl)
```

**Parameters:**
- `comp` — comp object with `name`, `gameMode`, `partyLines`
- `builds` — map of buildId → build object (converted from array by the IPC handler)
- `compUrl` — published comp page URL
- `buildUrls` — map of buildId → published build page URL
- `webhookUrl` — Discord webhook URL from settings

**Payload structure:**
```json
{
  "embeds": [{
    "title": "Comp Name",
    "url": "https://owner.github.io/repo/?n=slug&c=fileId.key",
    "description": "<emoji grid>\n\n<legend lines>",
    "color": 16766720
  }]
}
```

**Grid generation:**
- Iterate `comp.partyLines`
- For each line, iterate `slots`, look up build in `builds` map
- Slots referencing deleted/missing builds are skipped (no placeholder)
- Get emoji via `getDiscordEmoji(build)`
- Join emojis with space, one line per party
- Omit party lines that produce zero emojis (all slots empty or missing)

**Legend generation:**
- Collect all unique build IDs across all party lines (deduplicated, preserving first-seen order)
- Skip build IDs that don't resolve (deleted builds)
- For each resolved build: get emoji + display name
- If build has a published URL in `buildUrls`, wrap name in markdown link `[name](url)`
- One line per build: `<emoji> [Build Name](url)` or `<emoji> Build Name`

**POST:** Uses Node.js `https` module (not `fetch`, for Electron compatibility):
```js
const https = require("node:https");
```
Posts JSON payload to webhook URL.

**Return value:** `{ success: true }` or `{ success: false, error: "message" }`

**Error handling by HTTP status:**
- `204` — Success (Discord returns no content on success)
- `401` / `404` — Invalid or deleted webhook → `"Webhook URL is invalid or has been deleted"`
- `429` — Rate limited → `"Rate limited by Discord. Try again in a few seconds."`
- Other errors — `"Discord returned status {code}"`
- Network errors — `"Network error: {message}"`

### 3. IPC Handler — `src/main/index.js`

New handler:
```js
ipcMain.handle("discord:share-comp", async (_e, compId) => { ... });
```

Responsibilities:
1. Load comp from `compStore` by ID
2. Validate comp is published (`publishedFileId`, `publishedKey`, `publishedSlug` all present)
3. Load webhook URL from settings (`store.getSetting("discord.webhookUrl")`)
4. Validate webhook URL is present and matches Discord webhook URL pattern
5. Load all builds from `store.listBuilds()` and convert to a map: `{ [build.id]: build }`
6. Construct comp URL: read `targetOwner` from auth record (`auth.onboarding.targetOwner`), use `TARGET_REPO` constant, build `https://${owner}.github.io/${repo}/?n=${comp.publishedSlug}&c=${comp.publishedFileId}.${comp.publishedKey}`
7. Construct per-build URLs: for each build in party line slots that has `publishedSlug`, `publishedFileId`, `publishedKey`, build `https://${owner}.github.io/${repo}/?n=${build.publishedSlug}&b=${build.publishedFileId}.${build.publishedKey}`
8. Call `shareCompToDiscord()` with assembled data
9. Return result to renderer

### 4. Preload Bridge — `src/preload/index.js`

```js
shareCompToDiscord: (compId) => ipcRenderer.invoke("discord:share-comp", compId),
```

### 5. Settings — Webhook URL

**Setting key:** `discord.webhookUrl`

**UI:** Text input in the comp detail view's share controls area. When no webhook URL is configured and the user clicks the share button, show an inline prompt to paste their webhook URL. Saved via `window.desktopApi.setSetting("discord.webhookUrl", url)`.

**Validation:** Both at save time and before POSTing in the IPC handler — must start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/`.

**Storage:** Uses existing `store.getSetting()` / `store.setSetting()` — no schema changes needed.

### 6. Comp Detail UI — Share Button

**Location:** `src/renderer/modules/comps/comp-detail.js`, near existing publish/share controls.

**Visibility conditions:**
- Comp is published (has `publishedFileId`, `publishedKey`, `publishedSlug`)

**Behavior:**
- If webhook URL is not configured: clicking opens an inline input to paste the URL
- If webhook URL is configured: click calls `window.desktopApi.shareCompToDiscord(compId)`
- Disabled while request is in-flight (prevent double-send)
- On success: brief "Shared to Discord!" status message
- On failure: inline error message (e.g., "Failed: invalid webhook URL")

## Emoji Map (Complete)

```
Amalgam:        <:Amalgam:1469132309138767973>
Antiquary:      <:Antiquary:1469132340365099061>
Berserker:      <:Berserker:1469132341371994174>
Bladesworn:     <:Bladesworn:1469132343326277763>
Catalyst:       <:Catalyst:1469132344886689917>
Chronomancer:   <:Chronomancer:1469132346296107018>
Conduit:        <:Conduit:1469132392798224465>
Daredevil:      <:Daredevil:1469132393951793331>
Deadeye:        <:Deadeye:1469132396208066624>
Dragonhunter:   <:Dragonhunter:1469132397252575292>
Druid:          <:Druid:1469132398514933975>
Elementalist:   <:Elementalist:1469132399848853637>
Engineer:       <:Engineer:1484322965368602746>
Evoker:         <:Evoker:1484323009438154924>
Firebrand:      <:Firebrand:1472731858981879880>
Galeshot:       <:Galeshot:1469132551376470016>
Guardian:       <:Guardian:1469132552752206010>
Harbinger:      <:Harbinger:1469132554069348465>
Herald:         <:Herald:1469132555428298926>
Holosmith:      <:Holosmith:1469132557030260971>
Luminary:       <:Luminary:1469132578731851878>
Mechanist:      <:Mechanist:1469132580195401890>
Mesmer:         <:Mesmer:1469132581806145662>
Mirage:         <:Mirage:1469132583060111462>
Necromancer:    <:Necromancer:1469132584243171368>
Paragon:        <:Paragon:1469132585429893172>
Ranger:         <:Ranger:1469132669550985389>
Reaper:         <:Reaper:1469132671056875570>
Renegade:       <:Renegade:1469132673917128826>
Revenant:       <:Revenant:1469132675695771689>
Ritualist:      <:Ritualist:1469132678375931914>
Scourge:        <:Scourge:1469132763444547717>
Scrapper:       <:Scrapper:1469132764883452070>
Soulbeast:      <:Soulbeast:1469132766619893854>
Specter:        <:Specter:1469132768448352369>
Spellbreaker:   <:Spellbreaker:1469132769459175445>
Tempest:        <:Tempest:1469132792616190139>
Thief:          <:Thief:1469132794071355525>
Troubadour:     <:Troubadour:1469132796151726182>
Untamed:        <:Untamed:1469132799696175288>
Vindicator:     <:Vindicator:1469132800958660816>
Virtuoso:       <:Virtuoso:1469132851520737280>
Warrior:        <:Warrior:1469132852938407987>
Weaver:         <:Weaver:1469132854524121243>
Willbender:     <:Willbender:1469132856520605707>
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/main/discordEmoji.js` | Create — emoji map + lookup |
| `src/main/discordWebhook.js` | Create — embed builder + POST |
| `src/main/index.js` | Modify — add IPC handler |
| `src/preload/index.js` | Modify — add bridge method |
| `src/renderer/modules/comps/comp-detail.js` | Modify — add share button + webhook URL prompt |
