"use strict";

const https = require("node:https");
const { getDiscordEmoji, getDisplayName } = require("./discordEmoji");

const EMBED_DESC_LIMIT = 4096;
const COLOR_PVE = 0xFFD700;
const COLOR_WVW = 0xDC143C;
const LOGO_URL = "https://raw.githubusercontent.com/darkharasho/axiforge/main/public/img/build_logo.png";
const GITHUB_URL = "https://github.com/darkharasho/axiforge";
// Braille Pattern Blank — renders as whitespace but forces embed width
const WIDTH_PAD = "\u2800".repeat(45);

function buildCompEmbed(comp, builds, compUrl, buildUrls) {
  // Grid: one row of emojis per party line
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

  // Legend: one line per unique build
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

  // Assemble: grid in left field, legend in right field(s)
  const grid = gridRows.join("\n") || "\u200b";

  // Split legend across multiple fields if needed (Discord caps fields at 1024 chars)
  const legendChunks = [];
  let chunk = "";
  for (const line of legendLines) {
    if (chunk && (chunk + "\n" + line).length > 1024) {
      legendChunks.push(chunk);
      chunk = line;
    } else {
      chunk = chunk ? chunk + "\n" + line : line;
    }
  }
  if (chunk) legendChunks.push(chunk);
  if (!legendChunks.length) legendChunks.push("\u200b");

  const fields = [
    { name: "Comp", value: grid, inline: true },
    { name: "Builds", value: legendChunks[0], inline: true },
  ];
  // Overflow chunks: blank left column + builds in right column
  for (let i = 1; i < legendChunks.length; i++) {
    fields.push({ name: "\u200b", value: "\u200b", inline: true });
    fields.push({ name: "\u200b", value: legendChunks[i], inline: true });
  }

  return {
    title: comp.name || "Untitled Comp",
    url: compUrl,
    description: WIDTH_PAD,
    color: comp.gameMode === "wvw" ? COLOR_WVW : COLOR_PVE,
    fields,
    author: {
      name: "AxiForge",
      url: GITHUB_URL,
      icon_url: LOGO_URL,
    },
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
