"use strict";

const https = require("node:https");
const { getDiscordEmoji, getDisplayName, getSpecLineEmoji } = require("./discordEmoji");

const TITLE_LIMIT = 256;
const DESC_LIMIT = 4096;
const TOTAL_CHAR_LIMIT = 6000;
const FIELD_LIMIT = 25;
const COLOR_PVE = 0xFFD700;
const COLOR_WVW = 0xDC143C;
const LOGO_URL = "https://raw.githubusercontent.com/darkharasho/axiforge/main/public/favicon.png";
const GITHUB_URL = "https://github.com/darkharasho/axiforge";

// Profession colors — match the CSS class colors used in the app UI
const PROFESSION_COLORS = {
  Guardian:     0x6EA8FF,
  Warrior:      0xFF9944,
  Necromancer:  0x4DCA7A,
  Engineer:     0xCC8844,
  Ranger:       0x77CC55,
  Thief:        0xCC6677,
  Mesmer:       0xB07ACC,
  Elementalist: 0xDD5555,
  Revenant:     0xAA6655,
};
// Braille Pattern Blank — renders as whitespace but forces embed width
const WIDTH_PAD = "\u2800".repeat(45);

const PARTY_NUMBER_EMOJIS = [
  "1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3",
  "4\uFE0F\u20E3", "5\uFE0F\u20E3", "6\uFE0F\u20E3",
  "7\uFE0F\u20E3", "8\uFE0F\u20E3", "9\uFE0F\u20E3",
  "\uD83D\uDD1F",
];

function formatPartyGrid(emojis, partyIdx) {
  const label = PARTY_NUMBER_EMOJIS[partyIdx] || `P${partyIdx + 1}`;
  if (emojis.length <= 5) {
    return `${label} ${emojis.join(" ")}`;
  }
  // Break into rows of 5, first row gets the number label, rest get ⬛
  const rows = [];
  for (let i = 0; i < emojis.length; i += 5) {
    const chunk = emojis.slice(i, i + 5).join(" ");
    rows.push(i === 0 ? `${label} ${chunk}` : `\u2B1B ${chunk}`);
  }
  return rows.join("\n");
}

function buildCompEmbed(comp, builds, compUrl, buildUrls) {
  // Grid: one row of emojis per party line, broken at 5
  const buildColors = comp.buildColors || {};
  const gridRows = [];
  const placed = new Set();
  (comp.partyLines || []).forEach((line, idx) => {
    const emojis = [];
    (line.slots || []).forEach((slotId) => {
      // Slots may hold category references ("tag:<id>") — those aren't builds.
      if (slotId) placed.add(slotId);
      const build = builds[slotId];
      if (!build) return;
      const emoji = getDiscordEmoji(build, buildColors[slotId] || "normal");
      if (emoji) emojis.push(emoji);
    });
    if (emojis.length > 0) gridRows.push(formatPartyGrid(emojis, idx));
  });

  // Builds that belong to the comp but aren't placed in any line.
  const extraBuildIds = (comp.buildIds || []).filter(
    (id) => id && !placed.has(id) && builds[id]
  );

  // Extra grid row for unassigned builds, broken into rows of 5
  const extraEmojis = [];
  for (const id of extraBuildIds) {
    const emoji = getDiscordEmoji(builds[id], buildColors[id] || "normal");
    if (emoji) extraEmojis.push(emoji);
  }
  for (let i = 0; i < extraEmojis.length; i += 5) {
    const chunk = extraEmojis.slice(i, i + 5).join(" ");
    gridRows.push(`➕ ${chunk}`);
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
      const emoji = getDiscordEmoji(build, buildColors[slotId] || "normal");
      const name = getDisplayName(build);
      const url = buildUrls[slotId];
      const nameStr = url ? `[${name}](${url})` : name;
      legendLines.push(`${emoji} ${nameStr}`);
    }
  }
  // Append unassigned builds to the legend so they're listed too
  for (const id of extraBuildIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const build = builds[id];
    const emoji = getDiscordEmoji(build, buildColors[id] || "normal");
    const name = getDisplayName(build);
    const url = buildUrls[id];
    const nameStr = url ? `[${name}](${url})` : name;
    legendLines.push(`${emoji} ${nameStr}`);
  }

  // Grid in left inline field, legend split across right-column fields
  const grid = gridRows.join("\n") || "\u200b";

  // Split legend into chunks that fit Discord's 1024-char field limit
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
  // Overflow: row break + blank left + builds right (keeps right-column alignment)
  for (let i = 1; i < legendChunks.length; i++) {
    fields.push({ name: "\u200b", value: "\u200b", inline: false });
    fields.push({ name: "\u200b", value: "\u200b", inline: true });
    fields.push({ name: "\u200b", value: legendChunks[i], inline: true });
  }

  return {
    title: comp.name || "Untitled Comp",
    url: compUrl,
    description: comp.notes ? `${comp.notes}\n${WIDTH_PAD}` : WIDTH_PAD,
    color: comp.gameMode === "wvw" ? COLOR_WVW : COLOR_PVE,
    fields,
    author: {
      name: "AxiForge",
      url: GITHUB_URL,
      icon_url: LOGO_URL,
    },
  };
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max - 1) + "\u2026";
}

function embedCharCount(embed) {
  let count = 0;
  if (embed.title) count += embed.title.length;
  if (embed.description) count += embed.description.length;
  if (embed.author?.name) count += embed.author.name.length;
  if (embed.footer?.text) count += embed.footer.text.length;
  for (const f of embed.fields || []) {
    count += (f.name || "").length + (f.value || "").length;
  }
  return count;
}

/**
 * Build one or more embeds for a comp, splitting across multiple embeds
 * when a single embed would exceed Discord's 6000-char or 25-field limits.
 * First embed: title + author + grid field.  Continuation embeds: legend fields.
 */
function buildCompEmbeds(comp, builds, compUrl, buildUrls) {
  const embed = buildCompEmbed(comp, builds, compUrl, buildUrls);

  // Enforce per-field limits
  embed.title = truncate(embed.title, TITLE_LIMIT);
  if (embed.description) embed.description = truncate(embed.description, DESC_LIMIT);

  // If within limits, return as single embed
  if (embedCharCount(embed) <= TOTAL_CHAR_LIMIT && (embed.fields || []).length <= FIELD_LIMIT) {
    return [embed];
  }

  // Split: first embed gets header + grid, rest get legend fields
  const gridField = embed.fields[0]; // "Comp" field with emoji grid
  const legendFields = embed.fields.slice(1); // "Builds" legend chunks

  const gridEmbed = {
    title: embed.title,
    url: embed.url,
    description: embed.description,
    color: embed.color,
    author: embed.author,
    fields: [gridField],
  };

  const embeds = [gridEmbed];
  let current = { color: embed.color, fields: [] };

  for (const field of legendFields) {
    const testFields = [...current.fields, field];
    const testEmbed = { ...current, fields: testFields };
    if (current.fields.length > 0 &&
        (testFields.length > FIELD_LIMIT || embedCharCount(testEmbed) > TOTAL_CHAR_LIMIT)) {
      embeds.push(current);
      current = { color: embed.color, fields: [field] };
    } else {
      current.fields.push(field);
    }
  }
  if (current.fields.length) embeds.push(current);

  return embeds;
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

async function shareCompToDiscord(comp, builds, compUrl, buildUrls, webhookUrl, options = {}) {
  const { threadMode = "none", threadId } = options;
  const embeds = buildCompEmbeds(comp, builds, compUrl, buildUrls);
  const payload = { username: "AxiForge", avatar_url: LOGO_URL, embeds };

  let targetUrl = webhookUrl;
  if (threadMode === "custom" && threadId) {
    // Reply to an existing thread or forum post
    const sep = webhookUrl.includes("?") ? "&" : "?";
    targetUrl = `${webhookUrl}${sep}thread_id=${threadId}`;
  } else if (threadMode === "auto") {
    // Create a new forum post using the comp name
    payload.thread_name = comp.name || "Untitled Comp";
  }

  try {
    const res = await postWebhook(targetUrl, payload);
    if (res.status === 204 || res.status === 200) {
      return { success: true };
    }
    if (res.status === 401 || res.status === 404) {
      return { success: false, error: "Webhook URL is invalid or has been deleted" };
    }
    if (res.status === 429) {
      return { success: false, error: "Rate limited by Discord. Try again in a few seconds." };
    }
    const detail = res.body ? `: ${res.body}` : "";
    return { success: false, error: `Discord returned status ${res.status}${detail}` };
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` };
  }
}

/**
 * Build a compact spec overview like:
 *   (icon) `Fire            3 | 2 | 1`
 *   (icon) `Tempest         1 | 2 | 2`
 *
 * @param {Array} specializations - build.specializations
 * @param {string} profession - build.profession
 * @param {object} [catalog] - profession catalog with .specializations and .traits
 */
function formatSpecCard(specializations, profession, catalog) {
  if (!Array.isArray(specializations)) return null;

  // Build a lookup: for each spec id → ordered major trait IDs per tier (1/2/3)
  // from the catalog, so we can derive position indices from majorChoices.
  const tierMap = new Map(); // specId → { 1: [id,id,id], 2: [...], 3: [...] }
  if (catalog) {
    const traitById = new Map();
    for (const t of catalog.traits || []) {
      traitById.set(Number(t.id), t);
    }
    for (const catSpec of catalog.specializations || []) {
      const byTier = { 1: [], 2: [], 3: [] };
      for (const traitId of catSpec.majorTraits || []) {
        const t = traitById.get(Number(traitId));
        if (t && byTier[t.tier]) byTier[t.tier].push(Number(t.id));
      }
      tierMap.set(Number(catSpec.id), byTier);
    }
  }

  const names = [];
  const entries = [];
  for (const spec of specializations) {
    if (!spec || !spec.name) continue;

    const choices = [];
    const catalogTiers = tierMap.get(Number(spec.id));
    for (let tier = 1; tier <= 3; tier++) {
      // 1. Direct position indices (axicode imports)
      if (Array.isArray(spec.traitChoices) && spec.traitChoices[tier - 1]) {
        choices.push(spec.traitChoices[tier - 1]);
        continue;
      }
      // 2. Reverse-map from majorChoices using catalog tier data
      const chosen = Number(spec.majorChoices?.[tier]) || 0;
      const tierTraits = catalogTiers?.[tier]
        || (spec.majorTraitsByTier?.[tier] || []).map((t) => Number(t?.id));
      if (chosen && tierTraits.length) {
        const idx = tierTraits.indexOf(chosen);
        choices.push(idx >= 0 ? idx + 1 : "–");
      } else {
        choices.push("–");
      }
    }
    const emoji = getSpecLineEmoji(profession, spec.name, spec.elite);
    const prefix = emoji ? `${emoji} ` : "";
    names.push(spec.name);
    entries.push({ prefix, choices });
  }
  if (!entries.length) return null;
  const maxLen = Math.max(...names.map((n) => n.length));
  return entries.map((e, i) => {
    const padded = names[i].padEnd(maxLen);
    return `${e.prefix}\`${padded}  ${e.choices.join(" | ")}\``;
  }).join("\n");
}

// Equipment emoji — weapons, trinkets, relic, armor (per weight class)
const WEAPON_EMOJI = {
  Axe:        "<:Axe:1486805523566166036>",
  Dagger:     "<:Dagger:1486805417219854429>",
  Focus:      "<:Focus:1486805416259096626>",
  Greatsword: "<:Greatsword:1486805410802569396>",
  Hammer:     "<:Hammer:1486805522404343808>",
  HarpoonGun: "<:HarpoonGun:1486805406348087497>",
  Longbow:    "<:Longbow:1486805520789803008>",
  Mace:       "<:Mace:1486805402682130543>",
  Pistol:     "<:Pistol:1486805512447197274>",
  Rifle:      "<:Rifle:1486805399771283566>",
  Scepter:    "<:Scepter:1486805397946761347>",
  Shield:     "<:Shield:1486805396516769883>",
  ShortBow:   "<:ShortBow:1486805394704830616>",
  Spear:      "<:Spear:1486805393001676910>",
  Staff:      "<:Staff:1486805391580069918>",
  Sword:      "<:Sword:1486805389239521305>",
  Torch:      "<:Torch:1486805387381444791>",
  Trident:    "<:Trident:1486805386265886941>",
  Warhorn:    "<:Warhorn:1486805384759869491>",
};

const TRINKET_EMOJI = {
  amulet:   "<:amulet:1486805585755111464>",
  backpack: "<:backpack:1486805583129612481>",
  earring:  "<:earring:1486805580457971897>",
  relic:    "<:relic:1486805577970618610>",
  ring:     "<:ring:1486805575923794220>",
};

// Armor emoji keyed by weight → slot
const ARMOR_EMOJI = {
  heavy: {
    head:      "<:heavyheadgear:1486805056555712522>",
    shoulders: "<:heavyshoulders:1486805052063744143>",
    chest:     "<:heavychest:1486805059755970580>",
    hands:     "<:heavygloves:1486805057805750413>",
    legs:      "<:heavyleggings:1486805054387257384>",
    feet:      "<:heavyboots:1486805085148151859>",
  },
  medium: {
    head:      "<:mediumheadgear:1486805024284868650>",
    shoulders: "<:mediumshoulders:1486805021067710615>",
    chest:     "<:mediumchest:1486805032480411890>",
    hands:     "<:mediumgloves:1486805026784673863>",
    legs:      "<:mediumleggings:1486805022254563374>",
    feet:      "<:mediumboots:1486805035831656551>",
  },
  light: {
    head:      "<:lighthelm:1486805044727779608>",
    shoulders: "<:lightpauldrons:1486805038566342666>",
    chest:     "<:lightchest:1486805048137744384>",
    hands:     "<:lightgloves:1486805046795702272>",
    legs:      "<:lightleggings:1486805041665937588>",
    feet:      "<:lightboots:1486805050419576884>",
  },
};

const PROFESSION_WEIGHT = {
  Elementalist: "light", Mesmer: "light", Necromancer: "light",
  Engineer: "medium", Ranger: "medium", Thief: "medium",
  Guardian: "heavy", Warrior: "heavy", Revenant: "heavy",
};

const WEAPON_KEY_MAP = {
  axe: "Axe", dagger: "Dagger", focus: "Focus", greatsword: "Greatsword",
  hammer: "Hammer", harpoongun: "HarpoonGun", longbow: "Longbow", mace: "Mace",
  pistol: "Pistol", rifle: "Rifle", scepter: "Scepter", shield: "Shield",
  shortbow: "ShortBow", spear: "Spear", staff: "Staff", sword: "Sword",
  torch: "Torch", trident: "Trident", warhorn: "Warhorn",
};

function getWeaponEmoji(weaponType) {
  if (!weaponType) return "";
  const key = WEAPON_KEY_MAP[weaponType.toLowerCase()] || weaponType;
  return WEAPON_EMOJI[key] || "";
}

function resolveSigilNames(sigilIds, upgradeCatalog) {
  if (!upgradeCatalog || !sigilIds.length) return [];
  return sigilIds.map((id) => {
    const item = upgradeCatalog.sigilById?.get(Number(id));
    return item ? item.name.replace(/^Superior Sigil of /i, "") : null;
  }).filter(Boolean);
}

function resolveRuneName(runeId, upgradeCatalog) {
  if (!upgradeCatalog || !runeId || runeId === "0") return null;
  const item = upgradeCatalog.runeById?.get(Number(runeId));
  return item ? item.name.replace(/^Superior Rune of (the )?/i, "") : null;
}

/**
 * Equipment card with slot emoji as labels:
 *
 *   (helm)      `Stat  Rune | Rune  Stat` (hands)
 *   (shoulders) `Stat  Rune | Rune  Stat` (leggings)
 *   (chest)     `Stat  Rune | Rune  Stat` (boots)
 *
 *   (Axe) (Focus)  `Stat | Force · Impact`
 *   (Greatsword)   `Stat | Force · Air`
 *
 *   (backpack) `Stat | Stat` (amulet)
 *   (earring)  `Stat | Stat` (ring)
 *   (earring)  `Stat | Stat` (ring)
 *   (relic) `Relic of Fireworks`
 */
/**
 * Returns the equipment field string — weapon emoji + name for both sets.
 */
function formatEquipCard(equipment) {
  if (!equipment) return null;
  const wep = equipment.weapons || {};
  const lines = [];

  for (const [mh, oh, label] of [["mainhand1", "offhand1", "Set 1"], ["mainhand2", "offhand2", "Set 2"]]) {
    const mhType = wep[mh];
    if (!mhType) continue;
    const ohType = wep[oh];

    const parts = [];
    parts.push(`${getWeaponEmoji(mhType)} \`${mhType[0].toUpperCase() + mhType.slice(1)}\``);
    if (ohType) {
      parts.push(`${getWeaponEmoji(ohType)} \`${ohType[0].toUpperCase() + ohType.slice(1)}\``);
    }
    lines.push(parts.join(" / "));
  }

  return lines.length ? lines.join("\n") : null;
}

function buildBuildEmbed(build, buildUrl, chatLink, embedMeta = {}) {
  const { professionIconUrl, specIconUrl, eliteSpecName, gameMode, role } = embedMeta;
  const name = getDisplayName(build);
  const emoji = getDiscordEmoji(build);
  const color = PROFESSION_COLORS[build.profession] || COLOR_PVE;

  const descParts = [];
  if (buildUrl) descParts.push(buildUrl);

  const updatedAt = build.updatedAt
    ? new Date(build.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;

  // Footer: tags + last updated
  const tags = [];
  if (gameMode) tags.push(gameMode.toUpperCase());
  if (eliteSpecName) tags.push(eliteSpecName);
  if (role && role !== "Unknown") tags.push(role);
  const footerParts = [];
  if (tags.length) footerParts.push(tags.join(" · "));
  if (updatedAt) footerParts.push(`Last updated: ${updatedAt}`);

  const embed = {
    title: `${emoji} ${name}`,
    url: buildUrl || undefined,
    description: descParts.join("\n") || undefined,
    color,
    author: {
      name: "AxiForge",
      url: GITHUB_URL,
      icon_url: LOGO_URL,
    },
  };

  // Spec + equipment fields
  const fields = [];
  const specCard = formatSpecCard(build.specializations, build.profession, embedMeta.catalog);
  if (specCard) fields.push({ name: "Build", value: specCard });
  const equipCard = formatEquipCard(build.equipment);
  if (equipCard) fields.push({ name: "Weapons", value: equipCard });
  if (chatLink) fields.push({ name: "Build Code", value: `\`\`\`\n${chatLink}\n\`\`\`` });
  if (fields.length) embed.fields = fields;

  // Thumbnail: profession big icon (class art)
  const thumbUrl = professionIconUrl || specIconUrl;
  if (thumbUrl) {
    embed.thumbnail = { url: thumbUrl };
  }

  // Footer: tags + date as text (no icon)
  if (footerParts.length) {
    embed.footer = { text: footerParts.join("  |  ") };
  }

  return embed;
}

async function shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, webhookUrl, options = {}) {
  const { threadMode = "none", threadId } = options;
  const embed = buildBuildEmbed(build, buildUrl, chatLink, embedMeta);
  const payload = { username: "AxiForge", avatar_url: LOGO_URL, embeds: [embed] };

  let targetUrl = webhookUrl;
  if (threadMode === "custom" && threadId) {
    const sep = webhookUrl.includes("?") ? "&" : "?";
    targetUrl = `${webhookUrl}${sep}thread_id=${threadId}`;
  } else if (threadMode === "auto") {
    payload.thread_name = getDisplayName(build);
  }

  try {
    const res = await postWebhook(targetUrl, payload);
    if (res.status === 204 || res.status === 200) {
      return { success: true };
    }
    if (res.status === 401 || res.status === 404) {
      return { success: false, error: "Webhook URL is invalid or has been deleted" };
    }
    if (res.status === 429) {
      return { success: false, error: "Rate limited by Discord. Try again in a few seconds." };
    }
    const detail = res.body ? `: ${res.body}` : "";
    return { success: false, error: `Discord returned status ${res.status}${detail}` };
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` };
  }
}

function formatBuildDiscordCopy(build, buildUrl) {
  const emoji = getDiscordEmoji(build);
  const name = getDisplayName(build);
  if (buildUrl) return `${emoji} [${name}](${buildUrl})`;
  return `${emoji} ${name}`;
}

module.exports = { buildCompEmbed, buildCompEmbeds, shareCompToDiscord, buildBuildEmbed, shareBuildToDiscord, formatBuildDiscordCopy };
