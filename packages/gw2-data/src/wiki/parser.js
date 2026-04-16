"use strict";

const { stripWikiMarkup } = require("../facts/normalize");

// Wiki uses human-readable attribute names; normalize to API stat keys.
const WIKI_ATTR_MAP = {
  "Condition Damage": "ConditionDamage",
  "Healing Power": "HealingPower",
  "Boon Duration": "BoonDuration",
  "Condition Duration": "ConditionDuration",
  "Critical Damage": "CritDamage",
};
function normalizeAttr(name) {
  return WIKI_ATTR_MAP[name] || name;
}

// Fact types to silently ignore
const SKIP_TYPES = new Set([
  "text",
  "pierces",
  "explosion",
  "blocks missiles",
  "reflect",
  "block",
  "combat",
  "combat only",
  "enemy",
  "ally",
  "condition effect ignored",
  "condition removed",
  "breaks enemy targeting",
  "cannot critical hit",
  "capture",
  "dismounts",
  "misc",
  "blade",
  "launch",
  "knockback",
  "pull",
  "knockdown",
  "float",
  "sink",
  "daze",
  "stun",
]);

const BOONS = new Set([
  "aegis",
  "alacrity",
  "fury",
  "might",
  "protection",
  "quickness",
  "regeneration",
  "resistance",
  "resolution",
  "stability",
  "swiftness",
  "vigor",
]);

const CONDITIONS = new Set([
  "bleeding",
  "blind", "blinded",
  "burning",
  "chill", "chilled",
  "confusion",
  "cripple", "crippled",
  "fear",
  "immobilize", "immobilized",
  "poison", "poisoned",
  "slow",
  "taunt",
  "torment",
  "vulnerability",
  "weakness",
]);

// Wiki fact types whose numeric value is a percentage (e.g. "damage reduction|33" → 33%).
// These fall through to the generic Number handler without this set, losing the % symbol.
const PERCENT_TYPES = new Set([
  "critical chance",
  "critical chance increase",
  "damage increase",
  "damage reduction",
  "condition damage increase",
  "condition duration increase",
  "condition duration reduction",
  "attack speed increase",
  "movement speed increase",
  "movement speed reduction",
  "endurance recovery rate",
  "healing effectiveness increase",
  "healing effectiveness reduction",
  "incoming damage increase",
  "incoming damage reduction",
  "incoming healing increase",
  "incoming healing reduction",
  "life force cost",
  "life force drain",
  "outgoing damage increase",
  "outgoing damage reduction",
  "outgoing healing increase",
  "outgoing healing reduction",
  "strike damage increase",
  "strike damage reduction",
  "condition damage reduction",
  "boon duration increase",
  "maximum health increase",
  "maximum health reduction",
]);

/**
 * Split a string on `|` while respecting `{{...}}` nesting.
 * @param {string} s
 * @returns {string[]}
 */
function splitRespectingTemplates(s) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" && s[i + 1] === "{") {
      depth++;
      current += "{{";
      i++; // skip second {
    } else if (ch === "}" && s[i + 1] === "}") {
      depth--;
      current += "}}";
      i++; // skip second }
    } else if (ch === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Analyze a `| split = ...` field value to determine WvW grouping.
 * @param {string} splitField  e.g. "pve, wvw, pvp" or "pve, wvw pvp"
 * @returns {{ wvwHasSplit: boolean, wvwGroupedWithPvp: boolean }}
 */
function parseSplitGrouping(splitField) {
  if (!splitField) return { wvwHasSplit: false, wvwGroupedWithPvp: false };

  // Each comma-separated token is a "group" (possibly space-separated modes)
  const groups = splitField.split(",").map((g) => g.trim().toLowerCase());

  // Does WvW appear alone in its own comma-separated group?
  const wvwAloneGroup = groups.find((g) => g === "wvw");
  // Does WvW appear grouped with PvP (same comma-group)?
  const wvwPvpGroup = groups.find((g) => g.includes("wvw") && g.includes("pvp"));
  // Does WvW appear grouped with PvE (same comma-group) but NOT alone?
  const wvwPveGroup = groups.find(
    (g) => g.includes("wvw") && g.includes("pve") && !g.includes("pvp")
  );

  if (wvwAloneGroup) {
    return { wvwHasSplit: true, wvwGroupedWithPvp: false };
  }
  if (wvwPvpGroup) {
    return { wvwHasSplit: true, wvwGroupedWithPvp: true };
  }
  if (wvwPveGroup) {
    // WvW grouped with PvE means no real WvW split
    return { wvwHasSplit: false, wvwGroupedWithPvp: false };
  }

  return { wvwHasSplit: false, wvwGroupedWithPvp: false };
}

/**
 * Convert a single wiki fact into GW2 API fact format.
 *
 * @param {string} factType       - e.g. "damage", "recharge", "might"
 * @param {string[]} positional   - positional pipe args (stripped)
 * @param {Object} params         - named params e.g. { coefficient: "0.8", hits: "3" }
 * @param {boolean} isWvw         - whether this is WvW context
 * @param {boolean} isUniversal   - whether fact applies to all modes
 * @returns {Object|null}
 */
function mapWikiFactToApiFact(factType, positional, params, isWvw, isUniversal) {
  const type = factType.toLowerCase().trim();

  if (SKIP_TYPES.has(type)) return null;

  // Helper to get numeric positional[0]
  const pos0Num = () => parseFloat(stripWikiMarkup(positional[0]) || "0");

  // ── Damage ───────────────────────────────────────────────────────────
  if (type === "damage") {
    // Coefficient may come as a named param or as positional[0]
    const rawCoefficient = params.coefficient || positional[0] || "0";
    const coefficient = parseFloat(stripWikiMarkup(rawCoefficient));
    const hits = parseInt(stripWikiMarkup(params.hits) || "1", 10);
    return {
      type: "Damage",
      text: "Damage",
      dmg_multiplier: coefficient,
      hit_count: hits,
    };
  }

  // ── Recharge / Cooldown ───────────────────────────────────────────────
  if (
    type === "recharge" ||
    type === "cooldown" ||
    type === "recharge time"
  ) {
    return { type: "Recharge", text: "Recharge", value: pos0Num() };
  }

  // ── Duration (standalone) ─────────────────────────────────────────────
  if (type === "duration" || type === "duration alt") {
    return { type: "Time", text: "Duration", duration: pos0Num() };
  }

  // ── Range ─────────────────────────────────────────────────────────────
  if (type === "range") {
    const val = pos0Num();
    if (val <= 1) return null; // boolean flag artifact
    return { type: "Range", text: "Range", value: val };
  }

  // ── Radius variants ───────────────────────────────────────────────────
  if (
    type === "radius" ||
    type === "blast radius" ||
    type === "healing radius" ||
    type === "barrier radius"
  ) {
    return { type: "Radius", text: "Radius", distance: pos0Num() };
  }

  // ── Targets ───────────────────────────────────────────────────────────
  if (type === "targets") {
    return { type: "Number", text: "Number of Targets", value: pos0Num() };
  }

  // ── Conditions Removed ────────────────────────────────────────────────
  if (type === "conditions removed") {
    return { type: "Number", text: "Conditions Removed", value: pos0Num() };
  }

  // ── Healing ───────────────────────────────────────────────────────────
  if (type === "healing") {
    // Base may come as named param or positional[0]: {{skill fact|healing|372|coefficient=0.25}}
    const base = parseInt(stripWikiMarkup(params.base || positional[0]) || "0", 10);
    const coefficient = parseFloat(stripWikiMarkup(params.coefficient) || "0");
    return {
      type: "AttributeAdjust",
      text: "Healing",
      target: "Healing",
      value: base,
      coefficient,
    };
  }

  // ── Barrier ───────────────────────────────────────────────────────────
  if (type === "barrier") {
    const base = parseInt(stripWikiMarkup(params.base || positional[0]) || "0", 10);
    const coefficient = parseFloat(stripWikiMarkup(params.coefficient) || "0");
    return {
      type: "AttributeAdjust",
      text: "Barrier",
      target: "Barrier",
      value: base,
      coefficient,
    };
  }

  // ── Defiance / CC ─────────────────────────────────────────────────────
  if (type === "defiance break" || type === "defiance bar") {
    return { type: "Number", text: "Defiance Break", value: pos0Num() };
  }

  // ── Percent / Recharge Reduced ────────────────────────────────────────
  if (type === "percent" || type === "recharge reduced") {
    return { type: "Percent", text: type === "recharge reduced" ? "Recharge Reduced" : "Percent", percent: pos0Num() };
  }

  // ── Combo ─────────────────────────────────────────────────────────────
  if (type === "combo") {
    const val = positional[0] ? stripWikiMarkup(positional[0]).trim() : "";
    // If it's a field name (water, fire, light, etc.) treat as ComboField
    const FINISHERS = new Set(["blast", "leap", "projectile", "whirl"]);
    const lowerVal = val.toLowerCase();
    if (FINISHERS.has(lowerVal)) {
      return {
        type: "ComboFinisher",
        text: "Combo Finisher",
        finisher_type: val.charAt(0).toUpperCase() + val.slice(1),
      };
    }
    // Otherwise it's a combo field
    return {
      type: "ComboField",
      text: "Combo Field",
      field_type: val.charAt(0).toUpperCase() + val.slice(1),
    };
  }

  // ── Stun Break ────────────────────────────────────────────────────────
  if (type === "stun break" || type === "breaks stun" || type === "breakstun") {
    return { type: "StunBreak", text: "Stun Break", value: true };
  }

  // ── Unblockable ───────────────────────────────────────────────────────
  if (type === "unblockable") {
    return { type: "Unblockable", text: "Unblockable", value: true };
  }

  // ── Effect ────────────────────────────────────────────────────────────
  // {{skill fact|effect|Signet of Fury (effect)|desc=180 [[Precision]]|effect bonus=Precision}}
  // {{skill fact|effect|Signet of Fury (effect)|alt=Active Bonus|4|desc=360 [[Precision]], 360 [[Ferocity]]}}
  if (type === "effect") {
    const status = positional[0] ? stripWikiMarkup(positional[0]).trim() : "";
    const duration = parseFloat(stripWikiMarkup(positional[1]) || "0");
    const alt = params.alt ? stripWikiMarkup(params.alt).trim() : "";
    const desc = params.desc ? stripWikiMarkup(params.desc).trim() : "";
    const fact = {
      type: "Buff",
      text: alt || status,
      status,
      duration,
      apply_count: parseInt(stripWikiMarkup(params.stacks) || "1", 10),
    };
    if (desc) fact.description = desc;
    return fact;
  }

  // ── Attribute Conversion (gain) ──────────────────────────────────────
  // Named:      {{skill fact|gain|source=Power|target=Condition Damage|percent=10}}
  // Positional: {{skill fact|Gain|Ferocity|Precision|12}}  (target, source, percent)
  if (type === "gain") {
    const source = normalizeAttr(stripWikiMarkup(params.source || positional[1]) || "");
    const target = normalizeAttr(stripWikiMarkup(params.target || positional[0]) || "");
    const percent = parseFloat(stripWikiMarkup(params.percent || positional[2]) || "0");
    return {
      type: "BuffConversion",
      text: "Attribute Conversion",
      source,
      target,
      percent,
    };
  }

  // ── Flat attribute bonus ──────────────────────────────────────────────
  // {{skill fact|attribute|Concentration|120}}
  if (type === "attribute") {
    const attrName = stripWikiMarkup(positional[0]) || "";
    const value = parseInt(stripWikiMarkup(positional[1] || params.base) || "0", 10);
    return {
      type: "AttributeAdjust",
      text: attrName,
      target: normalizeAttr(attrName),
      value,
    };
  }

  // ── Boons ─────────────────────────────────────────────────────────────
  if (BOONS.has(type)) {
    const statusName = type.charAt(0).toUpperCase() + type.slice(1);
    return {
      type: "Buff",
      text: statusName,
      status: statusName,
      duration: pos0Num(),
      apply_count: parseInt(stripWikiMarkup(params.stacks) || "1", 10),
    };
  }

  // ── Conditions ────────────────────────────────────────────────────────
  if (CONDITIONS.has(type)) {
    const statusName = type.charAt(0).toUpperCase() + type.slice(1);
    return {
      type: "Buff",
      text: statusName,
      status: statusName,
      duration: pos0Num(),
      apply_count: parseInt(stripWikiMarkup(params.stacks) || "1", 10),
    };
  }

  // ── Known percentage fact types ────────────────────────────────────
  // Many wiki fact types carry a percentage value (e.g. "damage reduction|33").
  // Without this, they fall through to generic Number and lose the % suffix.
  if (PERCENT_TYPES.has(type)) {
    const label = type.replace(/\b\w/g, (c) => c.toUpperCase());
    return { type: "Percent", text: label, percent: pos0Num() };
  }

  // ── Unknown but has a numeric value ────────────────────────────────
  if (positional[0] && !isNaN(parseFloat(stripWikiMarkup(positional[0])))) {
    const label = type.replace(/\b\w/g, (c) => c.toUpperCase());
    // Heuristic: fact type names containing "increase", "reduction", "chance",
    // or "rate" are almost always percentages in GW2 wiki templates.
    if (/(?:increase|reduction|chance|rate|cost|drain)$/.test(type)) {
      return { type: "Percent", text: label, percent: pos0Num() };
    }
    return { type: "Number", text: label, value: pos0Num() };
  }

  return null;
}

/**
 * Parse `{{skill fact|...}}` and `{{trait fact|...}}` templates from wikitext.
 *
 * @param {string} wikitext
 * @param {boolean} wvwGroupedWithPvp
 * @returns {{ facts: Object[], hasPveOnly: boolean }}
 */
function parseWikitextFacts(wikitext, wvwGroupedWithPvp) {
  const facts = [];
  let hasPveOnly = false;

  // Match all skill fact / trait fact templates
  const templateRe = /\{\{(?:skill|trait) fact\|([^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*)\}\}/gi;
  let match;

  while ((match = templateRe.exec(wikitext)) !== null) {
    const inner = match[1];
    const parts = splitRespectingTemplates(inner);

    // First positional is the fact type
    const factType = (parts[0] || "").trim().toLowerCase();

    // Parse named params and remaining positionals
    const positional = [];
    const params = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        const key = part.slice(0, eqIdx).trim().toLowerCase();
        const val = part.slice(eqIdx + 1).trim();
        params[key] = val;
      } else {
        positional.push(part.trim());
      }
    }

    // Determine game mode filter.
    // Real wiki data uses compound modes like "pvp wvw" or "wvw pvp" meaning
    // "this fact applies to both PvP and WvW".
    const gameMode = (params["game mode"] || "").toLowerCase().trim();
    const gameModeTokens = gameMode ? gameMode.split(/\s+/) : [];

    const mentionsWvw = gameModeTokens.includes("wvw");
    const mentionsPvp = gameModeTokens.includes("pvp");
    const mentionsPve = gameModeTokens.includes("pve");
    const isUniversal = gameModeTokens.length === 0;

    // Track PvE-only facts
    if (mentionsPve && !mentionsWvw && !mentionsPvp) {
      hasPveOnly = true;
    }

    // Decide whether to include this fact in WvW output:
    // - universal facts (no game mode): always include
    // - facts mentioning wvw: include
    // - facts mentioning only pvp: include only if wvwGroupedWithPvp
    // - facts mentioning only pve: skip
    let include = false;
    if (isUniversal) include = true;
    else if (mentionsWvw) include = true;
    else if (mentionsPvp && wvwGroupedWithPvp) include = true;

    if (!include) continue;

    // Strip wiki markup from positionals
    const cleanPositionals = positional.map((p) => stripWikiMarkup(p));

    const fact = mapWikiFactToApiFact(factType, cleanPositionals, params, mentionsWvw, isUniversal);
    if (fact) facts.push(fact);
  }

  return { facts, hasPveOnly };
}

/**
 * Parse all {{skill fact|...}} / {{trait fact|...}} templates, tagging each
 * with the game modes it applies to.
 *
 * @param {string} wikitext
 * @returns {{ facts: Object[], hasPveOnly: boolean }}
 *   Each fact has `_modes: string[]` — subset of ["pve", "wvw", "pvp"].
 *   Universal facts (no game mode tag) get _modes: ["pve", "wvw", "pvp"].
 */
function parseAllTaggedFacts(wikitext) {
  const facts = [];
  let hasPveOnly = false;

  const templateRe = /\{\{(?:skill|trait) fact\|([^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*)\}\}/gi;
  let match;

  while ((match = templateRe.exec(wikitext)) !== null) {
    const inner = match[1];
    const parts = splitRespectingTemplates(inner);

    const factType = (parts[0] || "").trim().toLowerCase();

    const positional = [];
    const params = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        const key = part.slice(0, eqIdx).trim().toLowerCase();
        const val = part.slice(eqIdx + 1).trim();
        params[key] = val;
      } else {
        positional.push(part.trim());
      }
    }

    const gameMode = (params["game mode"] || "").toLowerCase().trim();
    const gameModeTokens = gameMode ? gameMode.split(/\s+/) : [];

    const mentionsWvw = gameModeTokens.includes("wvw");
    const mentionsPvp = gameModeTokens.includes("pvp");
    const mentionsPve = gameModeTokens.includes("pve");
    const isUniversal = gameModeTokens.length === 0;

    if (mentionsPve && !mentionsWvw && !mentionsPvp) {
      hasPveOnly = true;
    }

    // Build _modes array
    const modes = [];
    if (isUniversal) {
      modes.push("pve", "wvw", "pvp");
    } else {
      if (mentionsPve) modes.push("pve");
      if (mentionsWvw) modes.push("wvw");
      if (mentionsPvp) modes.push("pvp");
    }

    const cleanPositionals = positional.map((p) => stripWikiMarkup(p));
    const fact = mapWikiFactToApiFact(factType, cleanPositionals, params, mentionsWvw, isUniversal);
    if (fact) {
      fact._modes = modes;
      facts.push(fact);
    }
  }

  return { facts, hasPveOnly };
}

/**
 * Fallback parser for infobox-style params like `| recharge wvw = 25`.
 *
 * @param {string} wikitext
 * @param {boolean} wvwGroupedWithPvp
 * @returns {Object[]}
 */
function parseInfoboxParams(wikitext, wvwGroupedWithPvp) {
  const facts = [];
  const suffix = wvwGroupedWithPvp ? "pvp" : "wvw";

  // Match lines like: | recharge wvw = 25
  const lineRe = /\|\s*(recharge)\s+(\w+)\s*=\s*([^\n|]+)/gi;
  let match;

  while ((match = lineRe.exec(wikitext)) !== null) {
    const paramName = match[1].toLowerCase();
    const mode = match[2].toLowerCase();
    const rawValue = match[3].trim();

    if (mode !== suffix) continue;

    const value = parseFloat(stripWikiMarkup(rawValue));
    if (isNaN(value)) continue;

    if (paramName === "recharge") {
      facts.push({ type: "Recharge", text: "Recharge", value });
    }
  }

  return facts;
}

module.exports = {
  splitRespectingTemplates,
  parseSplitGrouping,
  mapWikiFactToApiFact,
  parseWikitextFacts,
  parseInfoboxParams,
  parseAllTaggedFacts,
};
