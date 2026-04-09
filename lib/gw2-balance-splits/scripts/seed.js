#!/usr/bin/env node
/**
 * seed.js — Build splits.json by scraping the GW2 Wiki for balance-split data.
 *
 * The GW2 wiki uses {{skill fact|...|game mode=wvw}} templates inside
 * {{Skill infobox}} / {{Trait infobox}} to mark mode-specific values.
 * This script discovers all split skills/traits via wiki categories,
 * then parses the wikitext to extract WvW-specific facts.
 *
 * Usage: node lib/gw2-balance-splits/scripts/seed.js
 *
 * Dependencies: cheerio (npm install cheerio — for HTML fallback only)
 */

const path = require("path");
const fs = require("fs/promises");

const WIKI_API = "https://wiki.guildwars2.com/api.php";
const GW2_API = "https://api.guildwars2.com/v2";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "splits.json");
const USER_AGENT = "AxiForge-BalanceSplits/1.0 (https://github.com/darkharasho/axiforge; balance-splits-seeder)";

// Rate-limit: 1 request per 200ms to be kind to the wiki
const RATE_LIMIT_MS = 200;
let lastRequestTime = 0;
async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, lastRequestTime + RATE_LIMIT_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

// ── Progress bar ──

function progressBar(current, total, width = 30) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(width * pct);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pctStr = (pct * 100).toFixed(1).padStart(5);
  return `  ${bar} ${pctStr}% (${current}/${total})`;
}

// ── Discovery: find all skills/traits with balance splits ──

async function discoverSplitPages(category) {
  const pages = [];
  let cmcontinue = "";
  do {
    const url = `${WIKI_API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(category)}&cmnamespace=0&cmlimit=500&format=json${cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : ""}`;
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    for (const member of data.query?.categorymembers || []) {
      pages.push(member.title);
    }
    cmcontinue = data.continue?.cmcontinue || "";
  } while (cmcontinue);
  return pages;
}

// ── Wikitext fact parsing ──

/**
 * Determine if WvW is grouped with PvP in the split field.
 * E.g. "pve, wvw pvp" or "pve, pvp wvw" → WvW shares PvP values.
 *       "pve wvw, pvp" → WvW shares PvE values (no actual WvW split from base).
 *       "pve, wvw, pvp" → WvW has its own group.
 *
 * Returns: { wvwHasSplit: boolean, wvwGroupedWithPvp: boolean }
 */
function parseSplitGrouping(splitField) {
  const lower = splitField.toLowerCase().trim();
  // Split by comma to get groups
  const groups = lower.split(",").map((g) => g.trim());

  // Find which group contains "wvw"
  const wvwGroup = groups.find((g) => g.split(/\s+/).includes("wvw"));
  if (!wvwGroup) return { wvwHasSplit: false, wvwGroupedWithPvp: false };

  const pveGroup = groups.find((g) => g.split(/\s+/).includes("pve"));
  const tokens = wvwGroup.split(/\s+/);
  const wvwWithPve = tokens.includes("pve");
  const wvwWithPvp = tokens.includes("pvp");

  // If WvW is in the same group as PvE, there's no actual WvW split from base
  if (wvwWithPve) return { wvwHasSplit: false, wvwGroupedWithPvp: false };

  return { wvwHasSplit: true, wvwGroupedWithPvp: wvwWithPvp };
}

/**
 * Parse {{skill fact|...}} templates from wikitext and extract WvW-specific values.
 *
 * Wiki format examples:
 *   {{skill fact|damage|weapon=rifle|coefficient=1.81|game mode=pve}}
 *   {{skill fact|damage|weapon=rifle|coefficient=1.35|game mode=wvw}}
 *   {{skill fact|healing|1930|coefficient=1.0|game mode=wvw}}
 *   {{skill fact|blindness|3|game mode=pvp wvw}}
 *   {{skill fact|targets|5}}  (no game mode = applies to all)
 *   {{skill fact|Endurance gained|5|game mode = pvp}}  (WvW uses PvP value when grouped)
 *
 * @param {string} wikitext - Raw wikitext content
 * @param {boolean} wvwGroupedWithPvp - If true, treat "game mode=pvp" facts as WvW values
 */
/** Split a string by `|` while skipping `|` chars inside `{{...}}` template nesting. */
function splitRespectingTemplates(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" && s[i + 1] === "{") { depth++; i++; }
    else if (s[i] === "}" && s[i + 1] === "}") { depth--; i++; }
    else if (s[i] === "|" && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function parseWikitextFacts(wikitext, wvwGroupedWithPvp = false) {
  const wvwFacts = [];
  let hasPveOnly = false; // true if any fact is tagged game mode=pve (signals PvE-exclusive facts)

  // Match all {{skill fact|...}} templates, including those with nested templates
  // like {{fraction|7.5}} inside parameter values. The alternation handles one level
  // of {{...}} nesting so that inner braces don't prematurely terminate the match.
  const factPattern = /\{\{skill fact\|((?:[^{}]|\{\{[^}]*\}\})+)\}\}/gi;
  let match;
  while ((match = factPattern.exec(wikitext)) !== null) {
    const raw = match[1];
    const parts = splitRespectingTemplates(raw).map((s) => s.trim());
    if (parts.length === 0) continue;

    // Parse key=value pairs, stripping wiki markup from values
    const params = {};
    const positional = [];
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) {
        const key = part.slice(0, eqIdx).trim().toLowerCase();
        const val = stripWikiMarkup(part.slice(eqIdx + 1).trim());
        params[key] = val;
      } else {
        positional.push(stripWikiMarkup(part.trim()));
      }
    }

    // Check game mode — include if wvw (or no mode specified = universal)
    const gameMode = (params["game mode"] || "").toLowerCase();
    const isWvw = gameMode.includes("wvw");
    const isPvpOnly = gameMode === "pvp";
    const isUniversal = !gameMode;
    const isPveOnly = gameMode === "pve";

    if (isPveOnly) {
      // Track that this page has PvE-exclusive facts — the universal facts represent
      // the complete WvW fact set (skills like "Eye of the Storm!" remove PvE boons).
      hasPveOnly = true;
      continue;
    }

    // When WvW is grouped with PvP, treat PvP-only facts as WvW facts
    const treatAsPvpWvw = isPvpOnly && wvwGroupedWithPvp;
    const isWvwRelevant = isWvw || treatAsPvpWvw;

    if (!isWvwRelevant && !isUniversal) continue; // Skip (e.g. pvp-only when not grouped with wvw)

    const factType = positional[0]?.toLowerCase() || "";
    const fact = mapWikiFactToApiFact(factType, positional, params, isWvwRelevant, isUniversal);
    if (fact) {
      // Tag so we know if this is WvW-specific or universal
      fact._wvwSpecific = isWvwRelevant && !isUniversal;
      wvwFacts.push(fact);
    }
  }

  return { facts: wvwFacts, hasPveOnly };
}

/**
 * Map a wiki {{skill fact|type|...}} to GW2 API fact format.
 */
function mapWikiFactToApiFact(factType, positional, params, isWvw, isUniversal) {
  const coefficient = parseFloat(params.coefficient || params.coeff || "0");

  switch (factType) {
    case "damage": {
      const coeff = !isNaN(coefficient) && coefficient > 0 ? coefficient : 1.0;
      const hitCount = parseInt(params["hit count"] || params.hits || "1", 10) || 1;
      return { type: "Damage", text: "Damage", dmg_multiplier: coeff, hit_count: hitCount };
    }
    case "healing": {
      const base = parseFloat(positional[1] || "0");
      return {
        type: "AttributeAdjust",
        text: "Healing",
        value: !isNaN(base) ? base : 0,
        target: "Healing",
        hit_count: 1,
        ...(coefficient > 0 ? { coefficient } : {}),
      };
    }
    case "recharge":
    case "cooldown": {
      const val = parseFloat(positional[1] || params.value || "0");
      return !isNaN(val) && val > 0 ? { type: "Recharge", text: "Recharge", value: val } : null;
    }
    case "recharge time": {
      const dur = parseFloat(positional[1] || "0");
      const label = params.alt ? stripWikiMarkup(params.alt) : "Recharge Time";
      return dur > 0 ? { type: "Time", text: label, duration: dur, icon: "https://render.guildwars2.com/file/AAB7C5387A08367C2F023F19FEE70E1556AD4375/1770202.png" } : null;
    }
    case "duration":
    case "alt": {
      const dur = parseFloat(positional[1] || params.duration || "0");
      return !isNaN(dur) && dur > 0 ? { type: "Time", text: params.alt || "Duration", duration: dur } : null;
    }
    case "radius": {
      const dist = parseInt(positional[1] || params.distance || "0", 10);
      if (!(dist > 0)) return null;
      const RADIUS_ICON = "https://render.guildwars2.com/file/B0CD8077991E4FB1622D2930337ED7F9B54211D5/156665.png";
      // Always type "Radius" with distance field so catalog matching normalises it
      // to "Distance" (the GW2 API type), enabling Pass 1 text+type matching.
      const label = params.alt ? stripWikiMarkup(params.alt) : "Radius";
      return { type: "Radius", text: label, distance: dist, icon: RADIUS_ICON };
    }
    case "range threshold": {
      const val = parseInt(positional[1] || "0", 10);
      const label = params.alt ? stripWikiMarkup(params.alt) : "Range Threshold";
      const RANGE_ICON = "https://render.guildwars2.com/file/9352ED3244417304995F26CB01AE76BB7E547052/156661.png";
      return val > 0 ? { type: "Number", text: label, value: val, icon: RANGE_ICON } : null;
    }
    case "blast radius":
    case "healing radius":
    case "barrier radius":
    case "radius increase": {
      // GW2 API stores named radius variants (e.g. "Blast Radius") as type "Number"
      // with a value field, not type "Radius". Match that shape so fact merging works.
      const dist = parseInt(positional[1] || params.distance || "0", 10);
      const RADIUS_ICON = "https://render.guildwars2.com/file/B0CD8077991E4FB1622D2930337ED7F9B54211D5/156665.png";
      return dist > 0 ? { type: "Number", text: capitalize(factType), value: dist, icon: RADIUS_ICON } : null;
    }
    case "barrier": {
      // Barrier facts are AttributeAdjust in the GW2 API (target: "Healing").
      // Wiki format: {{skill fact|barrier|1753|coefficient=0.4|alt=Ally Barrier}}
      const base = parseFloat(positional[1] || "0");
      const label = params.alt ? stripWikiMarkup(params.alt) : "Barrier";
      const BARRIER_ICON = "https://render.guildwars2.com/file/357922487919E8E84B914EAC13D5796DDDC42D14/1770209.png";
      return {
        type: "AttributeAdjust",
        text: label,
        value: !isNaN(base) ? base : 0,
        target: "Healing",
        hit_count: 1,
        ...(coefficient > 0 ? { coefficient } : {}),
        icon: BARRIER_ICON,
      };
    }
    case "range": {
      const val = parseInt(positional[1] || params.value || "0", 10);
      // Reject val <= 1: some wiki pages used {{skill fact|range|1}} as a boolean
      // flag rather than an actual range value. No GW2 skill has range <= 1.
      return val > 1 ? { type: "Range", text: "Range", value: val } : null;
    }
    case "targets": {
      const val = parseInt(positional[1] || "0", 10);
      return val > 0 ? { type: "Number", text: "Number of Targets", value: val } : null;
    }
    case "conditions removed": {
      const val = parseInt(positional[1] || "0", 10);
      return val > 0 ? { type: "Number", text: "Conditions Removed", value: val } : null;
    }
    case "combo": {
      const field = positional[1] || "";
      if (field.toLowerCase() === "blast" || field.toLowerCase() === "whirl" || field.toLowerCase() === "projectile" || field.toLowerCase() === "leap") {
        return { type: "ComboFinisher", text: "Combo Finisher", finisher_type: capitalize(field), percent: 100 };
      }
      return { type: "ComboField", text: "Combo Field", field_type: capitalize(field) };
    }
    case "stun break":
    case "breaks stun":
    case "breakstun":
      return { type: "StunBreak", text: "Stun Break", value: true };
    case "unblockable":
      return { type: "Unblockable", text: "Unblockable", value: true };
    // Attribute conversion: {{skill fact|gain|Target|Source|percent}}
    case "gain":
    case "attribute": {
      const target = positional[1] || "";
      const source = positional[2] || "";
      const pct = parseFloat(positional[3] || params.percent || "0");
      if (target && source && pct > 0) {
        return { type: "AttributeConversion", text: `Gain ${capitalize(target)} Based on a Percentage of ${capitalize(source)}`, source: capitalize(source), target: capitalize(target), percent: pct };
      }
      return null;
    }
    // Percentage recharge reductions: {{skill fact|recharge reduced|alt=Label|value}}
    case "recharge reduced": {
      const label = stripWikiMarkup(params.alt || "Recharge Reduced");
      const val = parseFloat(positional[1] || "0");
      return val > 0 ? { type: "Number", text: label, value: `${val}%`, icon: "https://wiki.guildwars2.com/images/f/f7/Count_Recharge.png" } : null;
    }
    // Percentage facts: {{skill fact|percent|VALUE|alt=Label}}
    case "percent": {
      const pct = parseFloat(positional[1] || "0");
      const label = params.alt ? stripWikiMarkup(params.alt) : "Percent";
      return pct > 0 ? { type: "Percent", text: label, percent: pct } : null;
    }
    // Timed effects: {{skill fact|effect|name|duration|desc=...|stacks=N|alt=Label}}
    case "effect": {
      const dur = parseFloat(positional[2] || "0");
      const desc = stripWikiMarkup(params.desc || params.description || positional[1] || "");
      const stacks = parseInt(params.stacks || params["apply count"] || "1", 10) || 1;
      if (dur > 0 && desc) {
        // Use alt param for display text (e.g. "Adrenaline Stage 1") if provided,
        // otherwise fall back to the effect description.
        const text = params.alt ? stripWikiMarkup(params.alt) : desc;
        return { type: "Buff", text, status: stripWikiMarkup(positional[1] || desc), duration: dur, apply_count: stacks };
      }
      return null;
    }
    // Wiki-specific fact types that don't map to GW2 API facts — skip these
    case "text":
    case "pierces":
    case "explosion":
    case "blocks missiles":
    case "reflect":
    case "block":
    case "combat only":
    case "combat":
    case "enemy target":
    case "ally target":
    case "condition effect ignored":
    case "condition removed":
    case "breaks enemy targeting":
    case "cannot critical hit":
    case "capture":
    case "dismounts":
    case "misc":
    case "blade":
    case "launch":
    case "knockback":
    case "pull":
    case "knockdown":
    case "float":
    case "sink":
    case "daze": {
      const dur = parseFloat(positional[1] || "0");
      return dur > 0 ? { type: "Time", text: "Daze", duration: dur, icon: "https://render.guildwars2.com/file/9AE125E930C92FEA0DD99E7EBAEDE4CF5EC556B6/433474.png" } : null;
    }
    case "stun": {
      const dur = parseFloat(positional[1] || "0");
      return dur > 0 ? { type: "Time", text: "Stun", duration: dur, icon: "https://render.guildwars2.com/file/1999B9DB355005D2DD19F66DFFBAA6D466057508/522727.png" } : null;
    }
    case "defiance break":
    case "defiance bar": {
      const val = parseFloat(positional[1] || "0");
      return val > 0 ? { type: "Number", text: "Defiance Break", value: val } : null;
    }
    case "break barrier":
    case "palm strike":
      return null;
    default: {
      // Boons and conditions: might, fury, quickness, bleeding, burning, etc.
      const cleanType = stripWikiMarkup(factType);
      const duration = parseFloat(positional[1] || "0");
      // positional[2] is apply_count for boon/condition facts: {{skill fact|might|8|3}}
      const stacks = parseInt(params.stacks || params["apply count"] || positional[2] || "1", 10) || 1;
      if (duration > 0 || stacks > 1) {
        return {
          type: "Buff",
          text: capitalize(cleanType),
          status: capitalize(cleanType),
          duration: duration || 0,
          apply_count: stacks,
        };
      }
      return null;
    }
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/** Strip wiki markup like [[link]], [[link|text]], [[link#anchor|text]], and {{sic}} from text.
 *  Converts {{fraction|N}} templates to their decimal value instead of stripping them. */
function stripWikiMarkup(s) {
  return s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1") // [[link|text]] → text
    .replace(/\{\{fraction\|([^}]+)\}\}/gi, "$1")       // {{fraction|7.5}} → "7.5"
    .replace(/\{\{[^}]*\}\}/g, "")                      // {{template}} → ""
    .replace(/\[\[[^\]]*$/g, "")                         // truncated [[link → "" (broken by | split)
    .replace(/^[^\[]*\]\]/g, (m) => m.replace("]]", "")) // leftover ]] from broken links
    .trim();
}

// ── Infobox parameter parsing ──

/**
 * Parse WvW-specific infobox parameters like `| recharge wvw = 25`.
 * When wvwGroupedWithPvp is true, also reads `| recharge pvp = 35`.
 * These are simpler splits (usually just cooldown/energy/initiative changes)
 * that don't use {{skill fact}} templates.
 */
function parseInfoboxParams(wikitext, wvwGroupedWithPvp = false) {
  const facts = [];
  // Match both "wvw" and optionally "pvp" suffixed params
  const suffixes = wvwGroupedWithPvp ? "(?:wvw|pvp)" : "wvw";
  const pattern = new RegExp(`\\|\\s*(\\w[\\w\\s]*?)\\s+${suffixes}\\s*=\\s*([^\\n|]+)`, "g");
  let match;
  while ((match = pattern.exec(wikitext)) !== null) {
    const param = match[1].trim().toLowerCase();
    const value = parseFloat(match[2].trim());
    if (isNaN(value)) continue;

    switch (param) {
      case "recharge":
        facts.push({ type: "Recharge", text: "Recharge", value });
        break;
      case "energy":
        facts.push({ type: "Number", text: "Energy Cost", value });
        break;
      case "initiative":
        facts.push({ type: "Number", text: "Initiative Cost", value });
        break;
      case "upkeep":
        facts.push({ type: "Number", text: "Upkeep Cost", value });
        break;
    }
  }
  return facts;
}

/**
 * Parse PvE-specific healing facts from wikitext to capture healing coefficients.
 * WvW and PvE often share the same base value but have different coefficients
 * (e.g. PvE coefficient=0.75, WvW coefficient=0.5). The GW2 API doesn't expose
 * these coefficients so we scrape them from the wiki.
 *
 * Returns only facts that carry a coefficient, so this is safe to call on any page —
 * the result is empty for skills without healing facts or without coefficient info.
 */
function parsePveHealingFacts(wikitext) {
  const pveFacts = [];
  const factPattern = /\{\{skill fact\|((?:[^{}]|\{\{[^}]*\}\})+)\}\}/gi;
  let match;
  while ((match = factPattern.exec(wikitext)) !== null) {
    const raw = match[1];
    const parts = splitRespectingTemplates(raw).map((s) => s.trim());
    if (!parts.length) continue;

    const params = {};
    const positional = [];
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) {
        params[part.slice(0, eqIdx).trim().toLowerCase()] = part.slice(eqIdx + 1).trim();
      } else {
        positional.push(part.trim());
      }
    }

    const gameMode = (params["game mode"] || "").toLowerCase();
    // Keep PvE-specific ("pve") or universal (no game mode) healing facts.
    // Skip anything WvW-only or PvP-only.
    if (gameMode && !gameMode.includes("pve")) continue;

    const factType = (positional[0] || "").toLowerCase();
    if (factType !== "healing") continue;

    const coefficient = parseFloat(params.coefficient || params.coeff || "0");
    if (!(coefficient > 0)) continue; // Only useful when a coefficient is present

    const base = parseFloat(positional[1] || "0");
    pveFacts.push({
      type: "AttributeAdjust",
      text: "Healing",
      value: !isNaN(base) ? base : 0,
      target: "Healing",
      hit_count: 1,
      coefficient,
    });
  }
  return pveFacts;
}

// ── Wiki image URL lookup ──

// Attribute stat icons from the GW2 wiki, keyed by the attribute name used in
// AttributeConversion fact `target`/`source` fields.
const ATTRIBUTE_ICONS = {
  "Power":            "https://wiki.guildwars2.com/images/d/d6/Power_attribute.png",
  "Precision":        "https://wiki.guildwars2.com/images/d/dd/Precision_attribute.png",
  "Toughness":        "https://wiki.guildwars2.com/images/c/c8/Toughness_attribute.png",
  "Vitality":         "https://wiki.guildwars2.com/images/b/be/Vitality_attribute.png",
  "Ferocity":         "https://wiki.guildwars2.com/images/3/31/Ferocity_attribute.png",
  "Condition Damage": "https://wiki.guildwars2.com/images/f/fc/Condition_Damage_attribute.png",
  "Healing Power":    "https://wiki.guildwars2.com/images/0/0c/Healing_Power_attribute.png",
  "Concentration":    "https://wiki.guildwars2.com/images/9/9c/Concentration_attribute.png",
  "Expertise":        "https://wiki.guildwars2.com/images/b/b8/Expertise_attribute.png",
};

// Standard boon/condition names whose icons come from the GW2 API base facts —
// no need to fetch wiki images for these.
const STANDARD_BUFF_NAMES = new Set([
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness", "Regeneration",
  "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
  "Bleeding", "Blinded", "Burning", "Chilled", "Confusion", "Crippled",
  "Fear", "Immobile", "Poisoned", "Slow", "Taunt", "Torment", "Vulnerability", "Weakness",
]);

/**
 * Look up wiki image URLs for a list of buff/effect status names.
 * Uses `File:NAME.png` convention — the GW2 wiki hosts in-game icons this way.
 * Returns a map of statusName → imageUrl for those that exist.
 * Batches up to 50 titles per request to stay within the wiki API limit.
 */
async function lookupWikiImageUrls(statusNames) {
  const unique = [...new Set(statusNames.filter((n) => n && !STANDARD_BUFF_NAMES.has(n)))];
  if (!unique.length) return {};
  const result = {};
  const BATCH = 50;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const titles = batch.map((n) => `File:${n}.png`).join("|");
    const url = `${WIKI_API}?action=query&prop=imageinfo&titles=${encodeURIComponent(titles)}&iiprop=url&format=json`;
    try {
      const res = await rateLimitedFetch(url);
      const data = await res.json();
      for (const page of Object.values(data.query?.pages || {})) {
        if (page.missing !== undefined) continue;
        const imageUrl = page.imageinfo?.[0]?.url;
        if (!imageUrl) continue;
        const statusName = (page.title || "").replace(/^File:/i, "").replace(/\.png$/i, "");
        if (statusName) result[statusName] = imageUrl;
      }
    } catch {
      // Non-fatal — just skip icons for this batch
    }
  }
  return result;
}

// ── GW2 API fact lookup ──

/**
 * Fetch facts from the GW2 API for a skill or trait.
 * Returns a flat array of all facts (including traited_facts).
 * Returns [] on any failure.
 */
async function fetchApiFacts(entityId, entityType) {
  const endpoint = entityType === "trait" ? "traits" : "skills";
  const url = `${GW2_API}/${endpoint}/${entityId}`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const facts = [...(data.facts || []), ...(data.traited_facts || [])];
    // Strip GW2 in-game markup (<c=@abilitytype>text</c>) from text fields so
    // icon lookup by normalized text works correctly.
    return facts.map((f) =>
      f.text && f.text.includes("<c=") ? { ...f, text: f.text.replace(/<c=[^>]*>(.*?)<\/c>/gi, "$1").trim() } : f
    );
  } catch {
    return [];
  }
}

// ── Extraction from wiki page ──

async function extractFromWikitext(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=wikitext&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const wikitext = data.parse?.wikitext?.["*"];
    if (!wikitext) return null;

    // Get skill/trait ID
    const idMatch = wikitext.match(/\|\s*id\s*=\s*(\d+)/);
    const entityId = idMatch ? Number(idMatch[1]) : null;
    if (!entityId) return null;

    // Check if this page actually has splits
    const splitMatch = wikitext.match(/\|\s*split\s*=\s*([^\n|]+)/i);
    if (!splitMatch) return null;

    const { wvwHasSplit, wvwGroupedWithPvp } = parseSplitGrouping(splitMatch[1]);
    if (!wvwHasSplit) return null;

    // Determine entity type
    const isTraitMatch = /\{\{Trait infobox/i.test(wikitext);
    const entityType = isTraitMatch ? "trait" : "skill";

    // Parse all facts and keep WvW-relevant ones
    const { facts: allFacts, hasPveOnly } = parseWikitextFacts(wikitext, wvwGroupedWithPvp);
    const hasWvwSpecific = allFacts.some((f) => f._wvwSpecific);
    // Use template facts when they are explicitly WvW-tagged OR when the page has
    // PvE-exclusive facts (game mode=pve) — those PvE-only facts are absent from
    // the universal fact list, which therefore represents the complete WvW fact set.
    const useTemplateFacts = hasWvwSpecific || hasPveOnly;

    let facts;
    if (useTemplateFacts && allFacts.length > 0) {
      // Clean up internal tags
      facts = allFacts.map(({ _wvwSpecific, ...rest }) => rest);
    } else {
      // Fallback: parse infobox WvW params (e.g. | recharge wvw = 25)
      facts = parseInfoboxParams(wikitext, wvwGroupedWithPvp);
    }

    if (facts.length === 0) return null;

    // Look up wiki image URLs for Buff/effect facts so that facts which have no
    // matching PvE base entry (genuinely new in WvW) still carry an icon.
    const buffStatusNames = facts
      .filter((f) => (f.type === "Buff" || f.type === "PrefixedBuff") && f.status)
      .map((f) => f.status);
    if (buffStatusNames.length > 0) {
      const iconMap = await lookupWikiImageUrls(buffStatusNames);
      if (Object.keys(iconMap).length > 0) {
        facts = facts.map((f) => {
          if ((f.type === "Buff" || f.type === "PrefixedBuff") && f.status && iconMap[f.status] && !f.icon) {
            return { ...f, icon: iconMap[f.status] };
          }
          return f;
        });
      }

      // Fallback: many "(effect)" buffs have no dedicated File:NAME (effect).png.
      // The wiki falls back to the base name (e.g., File:Elements of Rage.png).
      const stillMissing = facts
        .filter((f) => (f.type === "Buff" || f.type === "PrefixedBuff") && f.status && !f.icon)
        .map((f) => f.status.replace(/\s*\(effect\)\s*$/i, "").trim())
        .filter(Boolean);
      if (stillMissing.length > 0) {
        const fallbackMap = await lookupWikiImageUrls(stillMissing);
        if (Object.keys(fallbackMap).length > 0) {
          facts = facts.map((f) => {
            if ((f.type === "Buff" || f.type === "PrefixedBuff") && f.status && !f.icon) {
              const baseName = f.status.replace(/\s*\(effect\)\s*$/i, "").trim();
              if (fallbackMap[baseName]) return { ...f, icon: fallbackMap[baseName] };
            }
            return f;
          });
        }
      }
    }

    // AttributeConversion: icon = target attribute icon.
    facts = facts.map((f) => {
      if (f.type === "AttributeConversion" && f.target && !f.icon) {
        const icon = ATTRIBUTE_ICONS[f.target];
        if (icon) return { ...f, icon };
      }
      return f;
    });

    // GW2 API icon enrichment: for any fact still missing an icon, fetch the entity
    // from the GW2 API and match by normalized fact text to transfer render-CDN icons.
    // This covers wiki-specific fact types like "critical chance increase", "duration increase",
    // etc. that don't have File:NAME.png on the wiki but do have icons in the API.
    if (facts.some((f) => !f.icon)) {
      const apiFacts = await fetchApiFacts(entityId, entityType);
      if (apiFacts.length > 0) {
        const apiIconByText = new Map();
        for (const f of apiFacts) {
          if (f.text && f.icon) {
            const key = f.text.toLowerCase().trim();
            if (!apiIconByText.has(key)) apiIconByText.set(key, f.icon);
          }
        }
        if (apiIconByText.size > 0) {
          facts = facts.map((f) => {
            if (!f.icon && f.text) {
              const icon = apiIconByText.get(f.text.toLowerCase().trim());
              if (icon) return { ...f, icon };
            }
            return f;
          });
        }
        // Type-based fallback for Percent facts: wiki text ("Percent") often differs from
        // the API label ("Chance on Critical Hit", etc.), so text matching fails.
        // Use the first Percent fact icon from the API as the fallback.
        const apiPercentIcon = apiFacts.find((f) => f.type === "Percent" && f.icon)?.icon;
        if (apiPercentIcon) {
          facts = facts.map((f) =>
            f.type === "Percent" && !f.icon ? { ...f, icon: apiPercentIcon } : f
          );
        }
      }
    }

    // Also collect PvE-specific healing coefficients so PvE tooltips can show them.
    const pveFacts = parsePveHealingFacts(wikitext);

    // complete:true means these facts are the full WvW fact set (from wiki {{skill fact}}
    // templates). Any base PvE fact absent from this list is removed in WvW.
    // complete:false (infobox-param fallback) means only the changed facts are listed;
    // all other PvE facts remain unchanged in WvW.
    return { id: entityId, type: entityType, facts, pveFacts, complete: useTemplateFacts && allFacts.length > 0 };
  } catch {
    return null;
  }
}

// ── Validation ──

const VALID_FACT_TYPES = new Set([
  "Damage", "Buff", "Number", "Recharge", "Distance",
  "ComboField", "ComboFinisher", "NoData", "Time", "Radius",
  "Range", "Percent", "PrefixedBuff", "AttributeAdjust", "AttributeConversion",
  "Unblockable", "StunBreak", "HealingAdjust",
]);

function validateSplitEntry(entry) {
  if (!entry || !Array.isArray(entry.facts) || entry.facts.length === 0) return false;
  return entry.facts.every((f) => f.type && VALID_FACT_TYPES.has(f.type));
}

// ── Main ──

async function main() {
  console.log("=== GW2 Balance Splits Seeder ===\n");

  // Step 1: Discover pages with balance splits
  console.log("Discovering split pages...");
  const [skillPages, traitPages] = await Promise.all([
    discoverSplitPages("Category:Split skills"),
    discoverSplitPages("Category:Split traits"),
  ]);
  const allPages = [
    ...skillPages.map((p) => ({ title: p, hint: "skill" })),
    ...traitPages.map((p) => ({ title: p, hint: "trait" })),
  ];

  console.log(`  Found ${skillPages.length} split skills, ${traitPages.length} split traits (${allPages.length} total)\n`);

  if (allPages.length === 0) {
    console.log("No split pages found. Writing empty registry.");
    await writeOutput({}, {});
    return;
  }

  // Step 2: Extract WvW facts for each page
  console.log("Extracting WvW facts...\n");
  const skills = {};
  const traits = {};
  const methods = { wikitext: 0, failed: 0 };

  for (let i = 0; i < allPages.length; i++) {
    const { title } = allPages[i];

    const result = await extractFromWikitext(title);
    if (result && validateSplitEntry(result)) {
      methods.wikitext++;
      const bucket = result.type === "trait" ? traits : skills;
      const modes = { wvw: { facts: result.facts, complete: result.complete } };
      if (result.pveFacts && result.pveFacts.length > 0) {
        modes.pve = { facts: result.pveFacts };
      }
      bucket[String(result.id)] = {
        name: title.replace(/_/g, " "),
        modes,
      };
    } else {
      methods.failed++;
    }

    // Progress bar
    const statusIcon = result && validateSplitEntry(result) ? "✓" : "✗";
    const shortName = title.length > 30 ? title.slice(0, 27) + "..." : title.padEnd(30);
    process.stdout.write(`\r${progressBar(i + 1, allPages.length)}  ${statusIcon} ${shortName}`);
  }
  process.stdout.write("\n\n");

  // Step 3: Write output
  await writeOutput(skills, traits);

  console.log(`\n=== Done ===`);
  console.log(`  Skills: ${Object.keys(skills).length}`);
  console.log(`  Traits: ${Object.keys(traits).length}`);
  console.log(`  Extracted: ${methods.wikitext}, Failed: ${methods.failed}`);
}

async function writeOutput(skills, traits) {
  const output = {
    version: 1,
    updatedAt: new Date().toISOString(),
    skills: skills || {},
    traits: traits || {},
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

// Export for testing (no-op when run as a script)
module.exports = {
  // Parsing helpers (used by tests)
  parseSplitGrouping, parseWikitextFacts, mapWikiFactToApiFact, parseInfoboxParams,
  // Shared infrastructure (used by crawl-patches.js)
  rateLimitedFetch, lookupWikiImageUrls, extractFromWikitext,
  validateSplitEntry, writeOutput,
};

/**
 * Re-extract a single page by wiki page name or numeric ID and merge into splits.json.
 * Does NOT update updatedAt so the patch crawler's date anchor is preserved.
 *
 * Usage:
 *   npm run seed -- "Transcendent Tempest"   (page name)
 *   npm run seed -- 1839                      (entry ID)
 */
async function extractOne(arg) {
  const existing = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));

  let pageTitle;
  if (/^\d+$/.test(arg)) {
    const entry = existing.skills[arg] || existing.traits[arg];
    if (!entry) {
      console.error(`No entry with ID ${arg} in splits.json. Try the wiki page name instead.`);
      process.exit(1);
    }
    pageTitle = entry.name;
  } else {
    pageTitle = arg;
  }

  console.log(`Re-extracting: ${pageTitle}...`);
  const result = await extractFromWikitext(pageTitle);
  if (!result || !validateSplitEntry(result)) {
    console.error(`Failed to extract valid split data for "${pageTitle}".`);
    process.exit(1);
  }

  const bucket = result.type === "trait" ? existing.traits : existing.skills;
  const existingEntry = bucket[String(result.id)] || {};
  const modes = { ...(existingEntry.modes || {}) };
  modes.wvw = { facts: result.facts, complete: result.complete };
  if (result.pveFacts?.length) modes.pve = { facts: result.pveFacts };
  bucket[String(result.id)] = { name: existingEntry.name || pageTitle, modes };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(existing, null, 2) + "\n");
  console.log(`Updated ${result.type} "${pageTitle}" (ID ${result.id}) — ${result.facts.length} WvW facts.`);
}

// Only run when executed directly (not when require()'d by tests)
if (require.main === module) {
  const arg = process.argv[2];
  const task = arg ? extractOne(arg) : main();
  task.catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
